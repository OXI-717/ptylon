'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

type Entry = { name: string; path: string; type: 'dir' | 'file' | 'other'; size: number; mtime: string };

interface FileManagerProps {
  rootPath?: string;
  onOpenFile?: (path: string) => void;
  navigateTo?: string; // External navigation trigger — directory path
}

const FM_PATH_KEY = 'web-console-fm-path';
const DEFAULT_WORKSPACE_ROOT = process.env.NEXT_PUBLIC_WORKSPACE_ROOT || '/';

export default function FileManager({ rootPath = '/', onOpenFile, navigateTo }: FileManagerProps) {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WORKSPACE_ROOT;
    return localStorage.getItem(FM_PATH_KEY) || DEFAULT_WORKSPACE_ROOT;
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: Entry } | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setEntries(json.entries ?? []);
      setCurrentPath(path);
      localStorage.setItem(FM_PATH_KEY, path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadDir(currentPath); }, [currentPath, loadDir]);

  // Navigate to directory when external prop changes (e.g. switching editor tabs)
  useEffect(() => {
    if (navigateTo && navigateTo !== currentPath) {
      void loadDir(navigateTo);
    }
  }, [navigateTo, currentPath, loadDir]);

  const crumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    const out: { label: string; path: string }[] = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) { acc += `/${p}`; out.push({ label: p, path: acc }); }
    return out;
  }, [currentPath]);

  async function handleClick(item: Entry) {
    if (item.type === 'dir') return void (await loadDir(item.path));
    onOpenFile?.(item.path);
  }

  async function handleDelete(path: string) {
    if (!confirm(`Delete ${path}?`)) return;
    await fetch(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    await loadDir(currentPath);
  }

  async function handleRename(oldPath: string) {
    const newPath = prompt('New path:', oldPath);
    if (!newPath || newPath === oldPath) return;
    await fetch('/api/files/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPath, newPath }) });
    await loadDir(currentPath);
  }

  async function handleNewFile() {
    const name = prompt('File name:');
    if (!name) return;
    await fetch('/api/files/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `${currentPath}/${name}`, content: '' }) });
    await loadDir(currentPath);
  }

  async function handleNewFolder() {
    const name = prompt('Folder name:');
    if (!name) return;
    await fetch('/api/files/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `${currentPath}/${name}` }) });
    await loadDir(currentPath);
  }

  const [dragOver, setDragOver] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append('files', f));
    formData.append('targetDir', currentPath);
    try {
      setUploadMsg('Uploading...');
      const res = await fetch('/api/upload', { method: 'POST', body: formData, credentials: 'include' });
      const json = await res.json();
      if (json.ok) {
        setUploadMsg(`Uploaded ${json.files.length} file(s) to ${currentPath}`);
        await loadDir(currentPath);
      } else {
        setUploadMsg('Upload failed');
      }
    } catch {
      setUploadMsg('Upload error');
    }
    setTimeout(() => setUploadMsg(null), 3000);
  }

  return (
    <div
      className={`h-full flex flex-col bg-[#0a0e14] text-gray-200 ${dragOver ? 'ring-2 ring-inset ring-[#40E0D0]' : ''}`}
      onClick={() => setMenu(null)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-[#1a1e24] shrink-0">
        <span className="text-xs text-[#40E0D0] font-mono font-bold">FILES</span>
        <div className="flex gap-1">
          <button onClick={handleNewFile} className="text-xs text-gray-500 hover:text-[#40E0D0] px-1" title="New File">+📄</button>
          <button onClick={handleNewFolder} className="text-xs text-gray-500 hover:text-[#40E0D0] px-1" title="New Folder">+📁</button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="px-2 py-1 text-[10px] font-mono flex gap-0.5 flex-wrap border-b border-[#1a1e24] shrink-0">
        {crumbs.map((c, i) => (
          <button key={i} className="hover:text-[#40E0D0] text-gray-500" onClick={() => void loadDir(c.path)}>
            {c.label}{i < crumbs.length - 1 ? ' /' : ''}
          </button>
        ))}
      </div>

      {/* Upload status */}
      {uploadMsg && <div className="px-2 py-1 text-[10px] text-[#40E0D0] font-mono bg-[#40E0D0]/5 border-b border-[#1a1e24]">{uploadMsg}</div>}
      {dragOver && <div className="px-2 py-1 text-[10px] text-[#40E0D0] font-mono bg-[#40E0D0]/10 border-b border-[#1a1e24]">Drop files here → {currentPath}</div>}

      {/* Entries — virtual scroll for large directories */}
      <VirtualList
        entries={entries}
        loading={loading}
        error={error}
        onReset={() => void loadDir(rootPath)}
        onClick={handleClick}
        onContext={(e, item) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item }); }}
      />

      {/* Context menu */}
      {menu && (
        <div className="fixed z-50 min-w-36 rounded border border-[#2a2e34] bg-[#0d1117] text-sm shadow-xl py-1" style={{ left: menu.x, top: menu.y }}>
          <button className="w-full text-left px-3 py-1.5 hover:bg-[#1a1e24]" onClick={() => { handleClick(menu.item); setMenu(null); }}>Open</button>
          {menu.item.type === 'file' && <button className="w-full text-left px-3 py-1.5 hover:bg-[#1a1e24]" onClick={() => { onOpenFile?.(menu.item.path); setMenu(null); }}>Edit</button>}
          <button className="w-full text-left px-3 py-1.5 hover:bg-[#1a1e24]" onClick={() => { handleRename(menu.item.path); setMenu(null); }}>Rename</button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-[#1a1e24] text-red-400" onClick={() => { handleDelete(menu.item.path); setMenu(null); }}>Delete</button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-[#1a1e24]" onClick={() => { navigator.clipboard.writeText(menu.item.path); setMenu(null); }}>Copy Path</button>
        </div>
      )}
    </div>
  );
}

// --- Virtual Scroll List for large directories ---
const ITEM_HEIGHT = 28; // px per row
const OVERSCAN = 5;

function iconForStatic(e: Entry) {
  return e.type === 'dir' ? '📁' : /\.(png|jpe?g|gif|webp|svg)$/i.test(e.name) ? '🖼' : /\.(md|txt)$/i.test(e.name) ? '📝' : '📄';
}

function VirtualList({ entries, loading, error, onReset, onClick, onContext }: {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  onReset: () => void;
  onClick: (item: Entry) => void;
  onContext: (e: React.MouseEvent, item: Entry) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const totalHeight = entries.length * ITEM_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(entries.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN);
  const visible = entries.slice(startIdx, endIdx);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto"
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      {loading && <div className="p-3 text-xs text-gray-600 animate-pulse">Loading...</div>}
      {error && (
        <div className="p-3 text-xs text-red-400">
          <span>Error: {error}</span>
          <button onClick={onReset} className="ml-2 text-[#40E0D0] hover:underline">Reset</button>
        </div>
      )}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: startIdx * ITEM_HEIGHT, left: 0, right: 0 }}>
          {visible.map((item) => (
            <div
              key={item.path}
              className="flex items-center gap-2 px-3 text-sm hover:bg-[#1a1e24] cursor-pointer group"
              style={{ height: ITEM_HEIGHT }}
              onClick={() => onClick(item)}
              onContextMenu={(e) => onContext(e, item)}
            >
              <span className="text-xs">{iconForStatic(item)}</span>
              <span className="truncate flex-1">{item.name}</span>
              {item.type === 'file' && <span className="text-[10px] text-gray-600">{(item.size / 1024).toFixed(1)}K</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
