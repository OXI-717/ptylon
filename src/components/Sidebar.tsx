'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import { useWorkspaceStore, Workspace, Tab } from '@/stores/workspace-store';
import { metadataPrimary } from '@/lib/session-metadata';
import { BUILTIN_RECIPES, buildWorkspaceFromRecipe } from '@/lib/recipes';

// --- Sidebar Component ---

function countTabs(ws: Workspace, currentTabs: Tab[], activeId: string | null): number {
  return ws.id === activeId ? currentTabs.length : ws.tabs.length;
}

function workspaceTabIds(ws: Workspace, currentTabs: Tab[], activeId: string | null) {
  return new Set((ws.id === activeId ? currentTabs : ws.tabs).map((tab) => tab.id));
}

export default function Sidebar() {
  const {
    workspaces, activeWorkspaceId, tabs, notifications, sessionMetadata,
    switchWorkspace, addWorkspace, removeWorkspace, renameWorkspace, duplicateWorkspace,
  } = useWorkspaceStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleNewEmpty() {
    const id = crypto.randomUUID();
    const tabId = crypto.randomUUID();
    const ws: Workspace = {
      id,
      name: `Workspace ${workspaces.length + 1}`,
      color: '#40E0D0',
      tabs: [{ id: tabId, type: 'terminal', name: 'Terminal 1', color: '#40E0D0' }],
      splitTree: { id: crypto.randomUUID(), type: 'leaf', tabId },
      activeTabId: tabId,
    };
    addWorkspace(ws);
    switchWorkspace(id);
  }

  function handleNewFromTemplate(name: string) {
    const recipe = BUILTIN_RECIPES.find((candidate) => candidate.name === name) || BUILTIN_RECIPES[0];
    const ws = buildWorkspaceFromRecipe(recipe);
    addWorkspace(ws);
    switchWorkspace(ws.id);
    setShowTemplates(false);
  }

  function handleDoubleClick(ws: Workspace) {
    setEditingId(ws.id);
    setEditValue(ws.name);
    setTimeout(() => inputRef.current?.select(), 50);
  }

  function handleEditDone(id: string) {
    if (editValue.trim()) renameWorkspace(id, editValue.trim());
    setEditingId(null);
  }

  function handleEditKeyDown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') handleEditDone(id);
    if (e.key === 'Escape') setEditingId(null);
  }

  function handleContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }

  function handleWorkspaceMenu(e: React.MouseEvent<HTMLButtonElement>, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ id, x: rect.left, y: rect.bottom + 4 });
  }

  function handleExport() {
    const data = JSON.stringify(workspaces, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'web-console-workspaces.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text) as Workspace[];
        if (!Array.isArray(imported)) return;
        for (const ws of imported) {
          if (ws.id && ws.name && ws.tabs) {
            addWorkspace({ ...ws, id: crypto.randomUUID() });
          }
        }
      } catch { /* invalid json */ }
    };
    input.click();
  }

  return (
    <div className="fixed left-0 top-9 bottom-6 z-40 flex w-64 max-w-[85vw] flex-col border-r shadow-2xl sm:static sm:h-full sm:w-52 sm:max-w-none sm:shrink-0 sm:shadow-none" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="h-9 flex items-center px-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-mono uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Workspaces</span>
      </div>

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto py-1">
        {workspaces.map((ws) => {
          const tabIds = workspaceTabIds(ws, tabs, activeWorkspaceId);
          const unread = notifications
            .filter((n) => !n.read && (n.workspaceId === ws.id || tabIds.has(n.tabId)))
            .sort((a, b) => b.createdAt - a.createdAt);
          const latestMeta = (ws.id === activeWorkspaceId ? tabs : ws.tabs)
            .map((tab) => tab.sessionId ? sessionMetadata[tab.sessionId] : undefined)
            .filter(Boolean)
            .sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0))[0];
          return (
            <div
              key={ws.id}
              onClick={() => switchWorkspace(ws.id)}
              onDoubleClick={() => handleDoubleClick(ws)}
              onContextMenu={(e) => handleContextMenu(e, ws.id)}
              className="group flex cursor-pointer items-start gap-2 px-3 py-1.5 transition-colors"
              style={{
                background: activeWorkspaceId === ws.id ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                color: activeWorkspaceId === ws.id ? 'var(--foreground)' : 'var(--muted)',
              }}
            >
              <div
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${activeWorkspaceId === ws.id || unread.length > 0 ? 'ring-1 ring-[#40E0D0]/50' : ''}`}
                style={{ backgroundColor: unread.length > 0 ? 'var(--accent)' : ws.color }}
              />
              <div className="min-w-0 flex-1">
                {editingId === ws.id ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleEditDone(ws.id)}
                    onKeyDown={(e) => handleEditKeyDown(e, ws.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent border-b text-xs font-mono outline-none w-full min-w-0"
                    style={{ borderColor: 'var(--accent)', color: 'var(--foreground)' }}
                    autoFocus
                  />
                ) : (
                  <span className="block text-xs font-mono truncate">{ws.name}</span>
                )}
                {(unread[0] || latestMeta) && (
                  <span className="block truncate text-[10px] font-mono" style={{ color: unread[0] ? 'var(--accent)' : 'var(--muted)' }}>
                    {unread[0]?.title || metadataPrimary(latestMeta)}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-[10px] font-mono" style={{ color: unread.length > 0 ? 'var(--accent)' : 'var(--muted)' }}>
                  {unread.length > 0 ? unread.length : countTabs(ws, tabs, activeWorkspaceId)}
                </span>
                <button
                  type="button"
                  onClick={(event) => handleWorkspaceMenu(event, ws.id)}
                  className="h-6 w-6 text-[13px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  style={{ color: 'var(--muted-strong)' }}
                  title="Workspace actions"
                  aria-label={`Actions for ${ws.name}`}
                >
                  ...
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="border-t py-1" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={handleNewEmpty}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          <span>+</span> New workspace
        </button>
        <div className="relative">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <span>&#9776;</span> Templates
          </button>
          {showTemplates && (
            <div className="absolute bottom-full left-0 w-full border rounded shadow-lg z-50" style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
              {BUILTIN_RECIPES.map((recipe) => (
                <button
                  key={recipe.id}
                  onClick={() => handleNewFromTemplate(recipe.name)}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono transition-colors"
                  style={{ color: 'var(--foreground)' }}
                >
                  {recipe.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex">
          <button
            onClick={handleExport}
            className="flex-1 px-3 py-1.5 text-[10px] font-mono transition-colors"
            style={{ color: 'var(--muted)' }}
            title="Export workspaces"
          >
            Export
          </button>
          <button
            onClick={handleImport}
            className="flex-1 px-3 py-1.5 text-[10px] font-mono transition-colors"
            style={{ color: 'var(--muted)' }}
            title="Import workspaces"
          >
            Import
          </button>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 border rounded shadow-lg py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--surface-raised)', borderColor: 'var(--border)' }}
          >
            <button
              onClick={() => { handleDoubleClick(workspaces.find(w => w.id === contextMenu.id)!); setContextMenu(null); }}
              className="w-full text-left px-3 py-1 text-xs font-mono"
              style={{ color: 'var(--foreground)' }}
            >
              Rename
            </button>
            <button
              onClick={() => { duplicateWorkspace(contextMenu.id); setContextMenu(null); }}
              className="w-full text-left px-3 py-1 text-xs font-mono"
              style={{ color: 'var(--foreground)' }}
            >
              Duplicate
            </button>
            {workspaces.length > 1 && (
              <button
                onClick={() => { removeWorkspace(contextMenu.id); setContextMenu(null); }}
                className="w-full text-left px-3 py-1 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-[#1a1e24]"
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
