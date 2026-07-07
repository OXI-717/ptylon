'use client';

import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { extractTerminalNotifications, type Osc99State, type TerminalNotificationPayload } from '@/lib/terminal-notifications';

interface TerminalPanelProps {
  sessionId: string | null;
  ws: WebSocket | null;
  isActive: boolean;
  onSessionCreated?: (sessionId: string) => void;
  onNotification?: (notification: TerminalNotificationPayload) => void;
  cwd?: string;
  initCommand?: string; // auto-run after PTY creation
}

const DEFAULT_UPLOAD_DIR = process.env.NEXT_PUBLIC_UPLOAD_DIR || '';

interface XtermRenderDimensions {
  css?: {
    cell?: {
      width?: number;
      height?: number;
    };
  };
}

interface XtermInternalCore {
  _renderService?: {
    dimensions?: XtermRenderDimensions;
  };
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getTerminalTheme(): ITheme {
  return {
    background: cssVar('--terminal-bg', '#0a0e14'),
    foreground: cssVar('--terminal-fg', '#e0e0e0'),
    cursor: cssVar('--terminal-cursor', '#40E0D0'),
    cursorAccent: cssVar('--terminal-bg', '#0a0e14'),
    selectionBackground: cssVar('--terminal-selection', '#40E0D040'),
    black: cssVar('--ansi-black', '#1a1e24'),
    red: cssVar('--ansi-red', '#ff6b6b'),
    green: cssVar('--ansi-green', '#69db7c'),
    yellow: cssVar('--ansi-yellow', '#ffd43b'),
    blue: cssVar('--ansi-blue', '#74c0fc'),
    magenta: cssVar('--ansi-magenta', '#da77f2'),
    cyan: cssVar('--ansi-cyan', '#40E0D0'),
    white: cssVar('--ansi-white', '#e0e0e0'),
    brightBlack: cssVar('--ansi-bright-black', '#495057'),
    brightRed: cssVar('--ansi-bright-red', '#ff8787'),
    brightGreen: cssVar('--ansi-bright-green', '#8ce99a'),
    brightYellow: cssVar('--ansi-bright-yellow', '#ffe066'),
    brightBlue: cssVar('--ansi-bright-blue', '#a5d8ff'),
    brightMagenta: cssVar('--ansi-bright-magenta', '#e599f7'),
    brightCyan: cssVar('--ansi-bright-cyan', '#63e6be'),
    brightWhite: cssVar('--ansi-bright-white', '#ffffff'),
  };
}

export default function TerminalPanel({ sessionId, ws, isActive, onSessionCreated, onNotification, cwd, initCommand }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const wsRef = useRef<WebSocket | null>(ws);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onNotificationRef = useRef(onNotification);
  const cwdRef = useRef(cwd);
  const osc99StateRef = useRef<Osc99State>(new Map());
  const initCommandRef = useRef(initCommand);
  const initCommandSent = useRef(false);
  const correlationIdRef = useRef<string>(crypto.randomUUID()); // unique per instance
  const createInFlightRef = useRef(false);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  // Keep refs in sync with props
  sessionIdRef.current = sessionId;
  wsRef.current = ws;
  onSessionCreatedRef.current = onSessionCreated;
  onNotificationRef.current = onNotification;
  cwdRef.current = cwd;
  initCommandRef.current = initCommand;

  // Main init — runs once
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let cleanupClickHandlers: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      const { WebglAddon } = await import('@xterm/addon-webgl');

      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        scrollback: 5000,
        theme: getTerminalTheme(),
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      term.open(containerRef.current!);

      // WebGL renderer for performance (fallback to canvas if unavailable)
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        console.warn('[Terminal] WebGL not available, using canvas renderer');
      }
      fitAddon.fit();

      // Kill accessibility tree — it causes blue selection artifacts over the canvas
      const a11yEl = term.element?.querySelector('.xterm-accessibility');
      if (a11yEl) (a11yEl as HTMLElement).style.display = 'none';

      // --- PuTTY-style: auto-copy on selection (best-effort) ---
      // Note: navigator.clipboard.writeText may be blocked by browser if no "user activation".
      // Reliable copy via Ctrl+Shift+C below.
      term.onSelectionChange(() => {
        const selection = term.getSelection();
        if (selection && selection.length > 0) {
          navigator.clipboard?.writeText(selection).catch(() => {});
        }
      });

      // --- Ctrl+V / Ctrl+Shift+C: intercept via xterm custom key handler ---
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        // Ctrl+Shift+C: copy selection (reliable — keydown = user activation)
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
          const selection = term.getSelection();
          if (selection && selection.length > 0) {
            navigator.clipboard.writeText(selection).catch(() => {});
          }
          return false; // don't send to terminal
        }
        if (e.type === 'keydown' && e.ctrlKey && e.key.toLowerCase() === 'v') {
          // Try to read clipboard for images via async API
          navigator.clipboard.read().then(async (clipItems) => {
            for (const clipItem of clipItems) {
              const imageType = clipItem.types.find(t => t.startsWith('image/'));
              if (imageType) {
                const blob = await clipItem.getType(imageType);
                const ts = Date.now();
                const ext = imageType.split('/')[1] || 'png';
                const formData = new FormData();
                formData.append('files', new File([blob], `clipboard-${ts}.${ext}`, { type: imageType }));
                if (DEFAULT_UPLOAD_DIR) formData.append('targetDir', DEFAULT_UPLOAD_DIR);
                try {
                  const res = await fetch('/api/upload', { method: 'POST', body: formData });
                  const data = await res.json();
                  if (data.ok && data.files?.[0]?.path) {
                    const sock = wsRef.current;
                    const sid = sessionIdRef.current;
                    if (sock && sock.readyState === WebSocket.OPEN && sid) {
                      sock.send(JSON.stringify({ type: 'input', sessionId: sid, data: data.files[0].path + ' ' }));
                    }
                  }
                } catch { /* upload failed */ }
                return;
              }
            }
            // No image — let xterm handle text paste normally (already happened)
          }).catch(() => {
            // Clipboard API denied — xterm handles text paste as fallback
          });
          // Return true to let xterm also handle the event (for text paste)
          // The image handler above runs async and won't conflict
          return true;
        }
        // Alt+M: voice toggle — let it bubble to window handler
        if (e.type === 'keydown' && e.altKey && e.key.toLowerCase() === 'm') {
          return false;
        }
        return true; // allow all other keys
      });

      // --- Right-click paste (PuTTY-style) ---
      const onContextMenu = async (e: MouseEvent) => {
        e.preventDefault();
        const sock = wsRef.current;
        const sid = sessionIdRef.current;
        if (!sock || sock.readyState !== WebSocket.OPEN || !sid) return;
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            sock.send(JSON.stringify({ type: 'input', sessionId: sid, data: text }));
          }
        } catch { /* clipboard access denied */ }
      };
      containerRef.current!.addEventListener('contextmenu', onContextMenu);

      // Click-to-position cursor: document-level CAPTURE phase
      // xterm.js stopPropagation() on its elements — only capture phase works reliably
      let mouseDownX = 0, mouseDownY = 0;
      const container = containerRef.current!;
      const onDocMouseDown = (e: MouseEvent) => {
        if (!container.contains(e.target as Node)) return;
        if (e.button === 0) { mouseDownX = e.clientX; mouseDownY = e.clientY; }
      };
      const onDocMouseUp = (e: MouseEvent) => {
        if (!container.contains(e.target as Node)) return;
        if (e.button !== 0) return;
        if (Math.abs(e.clientX - mouseDownX) > 5 || Math.abs(e.clientY - mouseDownY) > 5) return;

        // Delay to let xterm finalize selection state
        setTimeout(() => {
          const sock = wsRef.current;
          const sid = sessionIdRef.current;
          if (!sock || sock.readyState !== WebSocket.OPEN || !sid) {
            return;
          }
          const sel = term.getSelection();
          if (sel?.length) {
            return;
          }

          const el = term.element;
          if (!el) return;

          // Get EXACT cell dimensions from xterm internals (same as xterm's own mouse handling)
          const core = (term as unknown as { _core?: XtermInternalCore })._core;
          const dims = core?._renderService?.dimensions?.css?.cell;

          // Use .xterm-viewport as coordinate reference (not .xterm-screen which includes scrollback!)
          const viewportEl = el.querySelector('.xterm-viewport') as HTMLElement;
          if (!viewportEl) return;
          const rect = viewportEl.getBoundingClientRect();

          const cellWidth = dims?.width || (term.cols > 0 ? rect.width / term.cols : 0);
          const cellHeight = dims?.height || (term.rows > 0 ? rect.height / term.rows : 0);
          if (!cellWidth || !cellHeight) return;

          const clickCol = Math.floor((e.clientX - rect.left) / cellWidth);
          const clickRow = Math.floor((e.clientY - rect.top) / cellHeight);
          if (clickRow < 0 || clickRow >= term.rows || clickCol < 0 || clickCol >= term.cols) return;

          const cursorY = term.buffer.active.cursorY;
          const cursorX = term.buffer.active.cursorX;

          const clickOffset = clickRow * term.cols + clickCol;
          const cursorOffset = cursorY * term.cols + cursorX;
          const delta = clickOffset - cursorOffset;
          if (delta === 0) return;

          const arrow = delta > 0 ? '\x1b[C' : '\x1b[D';
          sock.send(JSON.stringify({ type: 'input', sessionId: sid, data: arrow.repeat(Math.abs(delta)) }));
        }, 50);
      };
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('mouseup', onDocMouseUp, true);
      cleanupClickHandlers = () => {
        document.removeEventListener('mousedown', onDocMouseDown, true);
        document.removeEventListener('mouseup', onDocMouseUp, true);
        container.removeEventListener('contextmenu', onContextMenu);
      };

      // Send create/attach — retry until WS is ready
      function trySendInit() {
        const sock = wsRef.current;
        if (!sock || sock.readyState !== WebSocket.OPEN) {
          if (!disposed) setTimeout(trySendInit, 200);
          return;
        }
        if (sessionIdRef.current) {
          sock.send(JSON.stringify({ type: 'attach', sessionId: sessionIdRef.current, cols: term.cols, rows: term.rows }));
        } else if (!createInFlightRef.current) {
          createInFlightRef.current = true;
          sock.send(JSON.stringify({ type: 'create', cols: term.cols, rows: term.rows, cwd: cwdRef.current, _cid: correlationIdRef.current }));
        }
      }
      trySendInit();

      // Terminal input → WS (uses refs for latest values)
      term.onData((data: string) => {
        const sock = wsRef.current;
        const sid = sessionIdRef.current;
        if (sock && sock.readyState === WebSocket.OPEN && sid) {
          sock.send(JSON.stringify({ type: 'input', sessionId: sid, data }));
        }
      });

      // Resize observer with debounce (CODEX review: prevent resize storm)
      const observer = new ResizeObserver(() => {
        if (!disposed && fitAddon) {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            fitAddon.fit();
            const sock = wsRef.current;
            const sid = sessionIdRef.current;
            if (sock && sock.readyState === WebSocket.OPEN && sid) {
              sock.send(JSON.stringify({ type: 'resize', sessionId: sid, cols: term.cols, rows: term.rows }));
            }
          }, 100);
        }
      });
      resizeObserver = observer;
      observer.observe(containerRef.current!);
    }

    init();

    return () => {
      disposed = true;
      cleanupClickHandlers?.();
      resizeObserver?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // WS message handler — uses refs so no stale closure
  useEffect(() => {
    if (!ws) return;

    function handleMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data);

        // For 'created' — only claim if correlation ID matches (prevents multi-create collision)
        if (msg.type === 'created' && !sessionIdRef.current) {
          if (msg._cid && msg._cid !== correlationIdRef.current) return; // not our session
          createInFlightRef.current = false;
          sessionIdRef.current = msg.sessionId;
          if (onSessionCreatedRef.current) onSessionCreatedRef.current(msg.sessionId);
          setStatus('connected');
          // Auto-run initCommand if set (workspace templates)
          if (initCommandRef.current && !initCommandSent.current) {
            initCommandSent.current = true;
            const sock = wsRef.current;
            if (sock && sock.readyState === WebSocket.OPEN) {
              setTimeout(() => {
                sock.send(JSON.stringify({ type: 'input', sessionId: msg.sessionId, data: initCommandRef.current + '\n' }));
              }, 300); // small delay for shell to be ready
            }
          }
          return;
        }

        // Filter messages for other sessions
        if (msg.sessionId && msg.sessionId !== sessionIdRef.current) return;

        switch (msg.type) {
          case 'attached':
            setStatus('connected');
            break;
          case 'output':
            if (termRef.current) {
              const data = String(msg.data || '');
              for (const notification of extractTerminalNotifications(data, osc99StateRef.current)) {
                onNotificationRef.current?.(notification);
              }
              termRef.current.write(data);
            }
            break;
          case 'scrollback':
            if (termRef.current) {
              termRef.current.clear(); // Clear before replay to avoid duplication
              termRef.current.write(msg.data);
            }
            break;
          case 'exit':
            setStatus('disconnected');
            break;
        }
      } catch {
        // ignore
      }
    }

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  // Re-attach when WS reconnects (new socket after disconnect)
  useEffect(() => {
    if (!ws) {
      setStatus('disconnected');
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    const sid = sessionIdRef.current;
    if (sid) {
      setStatus('connected');
      // WS changed but we have an existing sessionId — re-attach to get scrollback
      ws.send(JSON.stringify({
        type: 'attach',
        sessionId: sid,
        cols: termRef.current?.cols,
        rows: termRef.current?.rows,
      }));
      return;
    }
    if (!termRef.current || createInFlightRef.current) return;
    setStatus('connecting');
    createInFlightRef.current = true;
    ws.send(JSON.stringify({
      type: 'create',
      cols: termRef.current.cols,
      rows: termRef.current.rows,
      cwd: cwdRef.current,
      _cid: correlationIdRef.current,
    }));
  }, [ws, sessionId]);

  useEffect(() => {
    const applyTheme = () => {
      const term = termRef.current;
      if (!term) return;
      term.options.theme = getTerminalTheme();
      term.element?.style.setProperty('background', cssVar('--terminal-bg', '#0a0e14'));
    };
    applyTheme();
    window.addEventListener('circadian-theme-change', applyTheme);
    return () => window.removeEventListener('circadian-theme-change', applyTheme);
  }, []);

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (isActive && termRef.current) {
      termRef.current.focus();
      fitAddonRef.current?.fit();
    }
  }, [isActive]);

  return (
    <div className="h-full w-full relative">
      <div className="absolute top-2 right-2 z-10 hidden items-center gap-1.5 sm:flex">
        <div
          className={`w-2 h-2 rounded-full ${
            status === 'connected'
              ? 'bg-green-400 animate-pulse'
              : status === 'connecting'
              ? 'bg-amber-400 animate-pulse'
              : 'bg-red-400'
          }`}
        />
        <span className="text-xs text-gray-500 font-mono">{status}</span>
      </div>
      <div ref={containerRef} className="h-full w-full" style={{ padding: '4px' }} />
    </div>
  );
}
