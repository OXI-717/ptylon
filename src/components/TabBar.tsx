'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { useWorkspaceStore, Tab } from '@/stores/workspace-store';
import { metadataPrimary } from '@/lib/session-metadata';

interface TabBarProps {
  onTabClick?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTerminal?: () => void;
  onNewFiles?: () => void;
  onNewBrowser?: () => void;
  activeLeafTabId?: string | null;
}

export default function TabBar({ onTabClick, onCloseTab, onNewTerminal, onNewFiles, onNewBrowser, activeLeafTabId }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab, removeTab, updateTab, addTab, ws, notifications, sessionMetadata } =
    useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef<number>(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touch: swipe left/right to switch tabs
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 50) return; // too short
    const state = useWorkspaceStore.getState();
    const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (idx < 0) return;
    const next = dx < 0
      ? state.tabs[(idx + 1) % state.tabs.length]
      : state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length];
    if (onTabClick) onTabClick(next.id); else setActiveTab(next.id);
  }, [onTabClick, setActiveTab]);

  // Touch: long press to close tab
  const handleTabTouchStart = useCallback((tabId: string) => {
    longPressTimer.current = setTimeout(() => {
      if (onCloseTab) onCloseTab(tabId);
      else {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.sessionId && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'kill', sessionId: tab.sessionId }));
        }
        removeTab(tabId);
      }
    }, 600);
  }, [tabs, ws, onCloseTab, removeTab]);
  const handleTabTouchEnd = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // Use activeLeafTabId for highlighting if provided, otherwise activeTabId
  const highlightId = activeLeafTabId !== undefined ? activeLeafTabId : activeTabId;

  function handleClick(tabId: string) {
    if (onTabClick) return onTabClick(tabId);
    setActiveTab(tabId);
  }

  function handleNewTerminalClick() {
    if (onNewTerminal) return onNewTerminal();
    const id = crypto.randomUUID();
    addTab({ id, type: 'terminal', name: `Terminal ${tabs.filter(t => t.type === 'terminal').length + 1}`, color: '#40E0D0' });
  }

  function handleNewFilesClick() {
    if (onNewFiles) return onNewFiles();
    const existing = tabs.find(t => t.type === 'files');
    if (existing) { setActiveTab(existing.id); return; }
    const id = crypto.randomUUID();
    addTab({ id, type: 'files', name: 'Files', color: '#69db7c' });
  }

  function handleNewBrowserClick() {
    if (onNewBrowser) return onNewBrowser();
    const id = crypto.randomUUID();
    addTab({ id, type: 'browser', name: 'Browser', color: '#f59f00', url: 'http://127.0.0.1:8790' });
  }

  function handleDoubleClick(tab: Tab) {
    setEditingId(tab.id);
    setEditValue(tab.name);
    setTimeout(() => inputRef.current?.select(), 50);
  }

  function handleEditDone(id: string) {
    if (editValue.trim()) {
      updateTab(id, { name: editValue.trim() });
      if (ws && ws.readyState === WebSocket.OPEN) {
        const tab = tabs.find((t) => t.id === id);
        if (tab?.sessionId) {
          ws.send(JSON.stringify({ type: 'update', sessionId: tab.sessionId, name: editValue.trim() }));
        }
      }
    }
    setEditingId(null);
  }

  function handleEditKeyDown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') handleEditDone(id);
    if (e.key === 'Escape') setEditingId(null);
  }

  function handleClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (onCloseTab) return onCloseTab(id);
    const tab = tabs.find((t) => t.id === id);
    if (tab?.sessionId && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kill', sessionId: tab.sessionId }));
    }
    removeTab(id);
  }

  return (
    <div
      className="flex items-center h-9 border-b overflow-x-auto scrollbar-none"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {tabs.map((tab) => {
        const unreadCount = notifications.filter((n) => !n.read && n.tabId === tab.id).length;
        const meta = tab.sessionId ? sessionMetadata[tab.sessionId] : undefined;
        return (
          <div
            key={tab.id}
            onClick={() => handleClick(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
            onTouchStart={() => handleTabTouchStart(tab.id)}
            onTouchEnd={handleTabTouchEnd}
            className="group relative flex items-center gap-1.5 px-3 h-full cursor-pointer border-r transition-colors min-w-[130px] max-w-[220px] shrink-0"
            style={{
              borderColor: unreadCount ? 'var(--accent)' : 'var(--border)',
              background: highlightId === tab.id ? 'var(--terminal-bg)' : 'var(--surface)',
              color: highlightId === tab.id ? 'var(--terminal-fg)' : 'var(--muted)',
              boxShadow: unreadCount ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent)' : undefined,
            }}
          >
          {/* Color dot */}
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: tab.color }}
          />

          {/* Tab name */}
          {editingId === tab.id ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleEditDone(tab.id)}
              onKeyDown={(e) => handleEditKeyDown(e, tab.id)}
              className="bg-transparent border-b text-xs font-mono outline-none w-full min-w-0"
              style={{ borderColor: 'var(--accent)', color: 'var(--foreground)' }}
              autoFocus
            />
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-mono">{tab.name}</span>
              {meta && (
                <span className="block truncate text-[10px] leading-3 font-mono" style={{ color: 'var(--muted)' }}>
                  {metadataPrimary(meta)}
                </span>
              )}
            </span>
          )}

            {unreadCount > 0 && (
              <span
                className="ml-auto rounded px-1 text-[10px] leading-4 font-mono"
                style={{ background: 'var(--accent)', color: 'var(--background)' }}
                title={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}

            {/* Close button */}
            <button
              onClick={(e) => handleClose(e, tab.id)}
              className={`${unreadCount > 0 ? '' : 'ml-auto'} shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity`}
              style={{ color: 'var(--muted)' }}
            >
              ×
            </button>

          {/* Active indicator */}
            {highlightId === tab.id && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: unreadCount ? 'var(--accent)' : tab.color }}
              />
            )}
          </div>
        );
      })}

      {/* New terminal */}
      <button
        onClick={handleNewTerminalClick}
        className="flex items-center justify-center px-2 h-full shrink-0 transition-colors font-mono text-xs"
        style={{ color: 'var(--accent)' }}
        title="New Terminal (splits active pane)"
      >
        +⌘
      </button>
      {/* Files tab */}
      <button
        onClick={handleNewFilesClick}
        className="flex items-center justify-center px-2 h-full shrink-0 transition-colors font-mono text-xs"
        style={{ color: 'var(--muted-strong)' }}
        title="File Manager"
      >
        +📁
      </button>
      {/* Browser tab */}
      <button
        onClick={handleNewBrowserClick}
        className="flex items-center justify-center px-2 h-full shrink-0 transition-colors font-mono text-xs"
        style={{ color: 'var(--muted-strong)' }}
        title="Browser Panel"
      >
        +☉
      </button>
    </div>
  );
}
