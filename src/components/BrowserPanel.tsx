'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react';

interface BrowserPanelProps {
  url?: string;
  browserSessionId?: string;
  isActive?: boolean;
  onBrowserChange?: (changes: { url?: string; browserSessionId?: string }) => void;
}

type BrowserFrame = {
  sessionId: string;
  url: string;
  title: string;
  width: number;
  height: number;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  screenshot: {
    mimeType: string;
    data: string;
  };
  updatedAt: number;
};

function normalizeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^(https?:|about:|data:)/i.test(trimmed)) return trimmed;
  if (/^localhost(:|\/|$)/i.test(trimmed) || /^127\.0\.0\.1(:|\/|$)/.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function externalUrl(url: string) {
  if (url === 'about:blank') return '';
  return url;
}

export default function BrowserPanel({ url, browserSessionId, isActive, onBrowserChange }: BrowserPanelProps) {
  const [draftUrl, setDraftUrl] = useState(url || 'http://127.0.0.1:8790');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const inputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef('');
  const reportedRef = useRef('');
  const textBufferRef = useRef('');
  const textTimerRef = useRef<number | null>(null);
  const wheelTimerRef = useRef<number | null>(null);
  const wheelRef = useRef({ x: 0, y: 0, deltaX: 0, deltaY: 0 });
  const currentUrl = useMemo(() => normalizeUrl(url || draftUrl), [url, draftUrl]);
  const activeSessionId = browserSessionId || sessionId;

  useEffect(() => {
    setSessionId(browserSessionId);
  }, [browserSessionId]);

  useEffect(() => {
    if (url) setDraftUrl(url);
  }, [url]);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect) return;
      setViewport({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(240, Math.round(rect.height)),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const applyFrame = useCallback((nextFrame: BrowserFrame) => {
    setFrame(nextFrame);
    setSessionId(nextFrame.sessionId);
    if (document.activeElement !== inputRef.current) setDraftUrl(nextFrame.url);
    const reportKey = `${nextFrame.sessionId}:${nextFrame.url}`;
    if (reportedRef.current !== reportKey) {
      reportedRef.current = reportKey;
      onBrowserChange?.({ url: nextFrame.url, browserSessionId: nextFrame.sessionId });
    }
  }, [onBrowserChange]);

  const requestBrowser = useCallback(async (body: Record<string, unknown>) => {
    const quiet = body.action === 'frame';
    if (!quiet) setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: viewport.width, height: viewport.height, ...body }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Browser request failed');
      if (data.frame) applyFrame(data.frame);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser request failed');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applyFrame, viewport.height, viewport.width]);

  const refreshFrame = useCallback(() => {
    if (activeSessionId) {
      void requestBrowser({ action: 'frame', sessionId: activeSessionId });
      return;
    }
    void requestBrowser({ action: 'open', url: currentUrl });
  }, [activeSessionId, currentUrl, requestBrowser]);

  useEffect(() => {
    const key = activeSessionId ? `session:${activeSessionId}` : `url:${currentUrl}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    refreshFrame();
  }, [activeSessionId, currentUrl, refreshFrame]);

  useEffect(() => {
    if (!isActive || !activeSessionId) return;
    const timer = window.setInterval(() => {
      void requestBrowser({ action: 'frame', sessionId: activeSessionId });
    }, frame?.loading ? 1000 : 4000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, frame?.loading, isActive, requestBrowser]);

  useEffect(() => () => {
    if (textTimerRef.current) window.clearTimeout(textTimerRef.current);
    if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
  }, []);

  function navigate(next: string) {
    const normalized = normalizeUrl(next);
    setDraftUrl(normalized);
    onBrowserChange?.({ url: normalized, browserSessionId: activeSessionId });
    void requestBrowser({ action: 'open', url: normalized, sessionId: activeSessionId });
  }

  function framePoint(event: MouseEvent | WheelEvent) {
    const image = event.currentTarget as HTMLElement;
    const rect = image.getBoundingClientRect();
    const scaleX = (frame?.width || viewport.width) / Math.max(1, rect.width);
    const scaleY = (frame?.height || viewport.height) / Math.max(1, rect.height);
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
    };
  }

  function sendTextNow(text: string) {
    if (!activeSessionId || !text) return;
    void requestBrowser({ action: 'type', sessionId: activeSessionId, text });
  }

  function flushText() {
    if (textTimerRef.current) {
      window.clearTimeout(textTimerRef.current);
      textTimerRef.current = null;
    }
    const text = textBufferRef.current;
    textBufferRef.current = '';
    sendTextNow(text);
  }

  function queueText(text: string) {
    if (!activeSessionId || !text) return;
    textBufferRef.current += text;
    if (textTimerRef.current) window.clearTimeout(textTimerRef.current);
    textTimerRef.current = window.setTimeout(flushText, 120);
  }

  function queueScroll(point: { x: number; y: number }, deltaX: number, deltaY: number) {
    if (!activeSessionId) return;
    wheelRef.current = {
      x: point.x,
      y: point.y,
      deltaX: wheelRef.current.deltaX + deltaX,
      deltaY: wheelRef.current.deltaY + deltaY,
    };
    if (wheelTimerRef.current) return;
    wheelTimerRef.current = window.setTimeout(() => {
      wheelTimerRef.current = null;
      const wheel = wheelRef.current;
      wheelRef.current = { x: wheel.x, y: wheel.y, deltaX: 0, deltaY: 0 };
      void requestBrowser({
        action: 'scroll',
        sessionId: activeSessionId,
        x: wheel.x,
        y: wheel.y,
        deltaX: wheel.deltaX,
        deltaY: wheel.deltaY,
      });
    }, 100);
  }

  function browserCommand(action: 'back' | 'forward' | 'reload') {
    if (!activeSessionId) {
      refreshFrame();
      return;
    }
    void requestBrowser({ action, sessionId: activeSessionId });
  }

  function buttonStyle(enabled = true) {
    return {
      borderColor: 'var(--border)',
      color: enabled ? 'var(--muted-strong)' : 'var(--muted)',
      opacity: enabled ? 1 : 0.45,
    };
  }

  return (
    <div className="h-full min-h-0 flex flex-col" style={{ background: 'var(--terminal-bg)' }}>
      <div
        className="h-10 shrink-0 border-b flex items-center gap-2 px-2"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <button
          type="button"
          className="h-7 w-7 shrink-0 border text-xs font-mono"
          style={buttonStyle(!!frame?.canGoBack)}
          title="Back"
          disabled={!frame?.canGoBack}
          onClick={() => browserCommand('back')}
        >
          ←
        </button>
        <button
          type="button"
          className="h-7 w-7 shrink-0 border text-xs font-mono"
          style={buttonStyle(!!frame?.canGoForward)}
          title="Forward"
          disabled={!frame?.canGoForward}
          onClick={() => browserCommand('forward')}
        >
          →
        </button>
        <button
          type="button"
          className="h-7 w-7 shrink-0 border text-xs font-mono"
          style={buttonStyle(true)}
          title="Reload"
          onClick={() => browserCommand('reload')}
        >
          ↻
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(draftUrl);
            inputRef.current?.blur();
          }}
        >
          <input
            ref={inputRef}
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="h-7 w-full border bg-transparent px-2 font-mono text-xs outline-none"
            style={{ borderColor: isActive ? 'var(--accent)' : 'var(--border)', color: 'var(--terminal-fg)' }}
            aria-label="Browser URL"
            spellCheck={false}
          />
        </form>
        <button
          type="button"
          className="h-7 w-7 shrink-0 border text-xs font-mono"
          style={{ borderColor: 'var(--border)', color: externalUrl(currentUrl) ? 'var(--accent)' : 'var(--muted)' }}
          title="Open in new tab"
          onClick={() => {
            const href = externalUrl(currentUrl);
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
          }}
        >
          ↗
        </button>
      </div>
      <div ref={surfaceRef} className="relative min-h-0 flex-1 overflow-hidden">
        {currentUrl === 'about:blank' ? (
          <div className="h-full flex items-center justify-center font-mono text-sm" style={{ color: 'var(--muted)' }}>
            Browser ready
          </div>
        ) : frame ? (
          <div
            data-browser-surface="server"
            role="application"
            tabIndex={0}
            className="h-full w-full outline-none"
            onClick={(event) => {
              if (!activeSessionId) return;
              flushText();
              event.currentTarget.focus();
              const point = framePoint(event);
              void requestBrowser({ action: 'pointClick', sessionId: activeSessionId, ...point });
            }}
            onWheel={(event) => {
              if (!activeSessionId) return;
              event.preventDefault();
              const point = framePoint(event);
              queueScroll(point, event.deltaX, event.deltaY);
            }}
            onKeyDown={(event) => {
              if (event.metaKey || event.ctrlKey || event.altKey) return;
              if (event.key.length === 1) {
                event.preventDefault();
                queueText(event.key);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                flushText();
                sendTextNow('\n');
              } else if (event.key === 'Backspace') {
                event.preventDefault();
                flushText();
                sendTextNow('\b');
              } else if (event.key === 'Tab') {
                event.preventDefault();
                flushText();
                sendTextNow('\t');
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text/plain');
              if (!text) return;
              event.preventDefault();
              queueText(text);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- CDP frames are short-lived data URLs, not static web images. */}
            <img
              src={`data:${frame.screenshot.mimeType};base64,${frame.screenshot.data}`}
              alt={`Server browser ${frame.url}`}
              className="h-full w-full select-none"
              draggable={false}
            />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center font-mono text-sm" style={{ color: 'var(--muted)' }}>
            Starting server browser...
          </div>
        )}
        {(loading || frame?.loading || error) && (
          <div
            className="absolute bottom-2 left-2 right-2 border px-2 py-1 font-mono text-xs"
            style={{
              background: 'var(--surface)',
              borderColor: error ? '#ff6b6b' : 'var(--border)',
              color: error ? '#ff8787' : 'var(--muted-strong)',
            }}
          >
            {error || (frame?.loading ? 'Loading server browser...' : 'Updating server browser...')}
          </div>
        )}
      </div>
    </div>
  );
}
