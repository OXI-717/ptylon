'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { metadataPrimary, metadataSecondary } from '@/lib/session-metadata';

export type SplitNode = {
  id: string;
  type: 'split' | 'leaf';
  direction?: 'horizontal' | 'vertical';
  children?: SplitNode[];
  sizes?: number[];
  tabId?: string; // maps to workspace tab
};

const MIN_PX = 200;
const HANDLE_PX = 6;

const normalizeSizes = (sizes: number[]) => {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => (s / sum) * 100);
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function removeLeafAndCollapse(root: SplitNode, leafId: string): SplitNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;
  const next = (root.children ?? []).map((c) => removeLeafAndCollapse(c, leafId)).filter(Boolean) as SplitNode[];
  if (next.length === 0) return null;
  if (next.length === 1) return next[0];
  return { ...root, children: next, sizes: normalizeSizes(new Array(next.length).fill(100 / next.length)) };
}

function updateNode(root: SplitNode, id: string, updater: (n: SplitNode) => SplitNode): SplitNode {
  if (root.id === id) return updater(root);
  if (root.type === 'split' && root.children) {
    return { ...root, children: root.children.map((c) => updateNode(c, id, updater)) };
  }
  return root;
}

function findLeaf(root: SplitNode, id: string): SplitNode | null {
  if (root.id === id) return root.type === 'leaf' ? root : null;
  if (root.type === 'split' && root.children) {
    for (const child of root.children) {
      const found = findLeaf(child, id);
      if (found) return found;
    }
  }
  return null;
}

function firstLeaf(root: SplitNode): SplitNode | null {
  if (root.type === 'leaf') return root;
  for (const child of root.children ?? []) {
    const found = firstLeaf(child);
    if (found) return found;
  }
  return null;
}

function useSinglePaneViewport() {
  const [singlePane, setSinglePane] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => setSinglePane(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return singlePane;
}

interface SplitContainerProps {
  tree: SplitNode;
  activeLeafId: string;
  onTreeChange: (tree: SplitNode) => void;
  onActiveChange: (id: string) => void;
  onNewLeaf: (leafId: string) => void;
  onCloseLeaf: (leafId: string, nextTree: SplitNode | null) => void;
  renderLeaf: (node: SplitNode, isActive: boolean) => React.ReactNode;
}

export default function SplitContainer({
  tree, activeLeafId, onTreeChange, onActiveChange, onNewLeaf, onCloseLeaf, renderLeaf,
}: SplitContainerProps) {
  const singlePane = useSinglePaneViewport();
  const splitLeaf = useCallback((leafId: string, direction: 'horizontal' | 'vertical') => {
    const newLeafId = crypto.randomUUID();
    onTreeChange(updateNode(tree, leafId, (node) => {
      if (node.type !== 'leaf') return node;
      return {
        id: crypto.randomUUID(),
        type: 'split',
        direction,
        children: [
          { ...node },
          { id: newLeafId, type: 'leaf' },
        ],
        sizes: [50, 50],
      };
    }));
    onNewLeaf(newLeafId);
    onActiveChange(newLeafId);
  }, [tree, onTreeChange, onNewLeaf, onActiveChange]);

  const closeLeaf = useCallback((leafId: string) => {
    const result = removeLeafAndCollapse(tree, leafId);
    onCloseLeaf(leafId, result);
    if (result) onTreeChange(result);
  }, [tree, onTreeChange, onCloseLeaf]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeLeafId) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.xterm')) return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        splitLeaf(activeLeafId, 'horizontal');
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        splitLeaf(activeLeafId, 'vertical');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeLeaf(activeLeafId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeLeafId, splitLeaf, closeLeaf]);

  const mobileLeaf = singlePane ? findLeaf(tree, activeLeafId) || firstLeaf(tree) : null;

  return (
    <div className="h-full w-full">
      <NodeView
        node={mobileLeaf || tree}
        activeLeafId={activeLeafId}
        onFocus={onActiveChange}
        splitLeaf={splitLeaf}
        closeLeaf={closeLeaf}
        renderLeaf={renderLeaf}
      />
    </div>
  );
}

interface NodeViewProps {
  node: SplitNode;
  activeLeafId: string;
  onFocus: (id: string) => void;
  splitLeaf: (id: string, dir: 'horizontal' | 'vertical') => void;
  closeLeaf: (id: string) => void;
  renderLeaf: (node: SplitNode, isActive: boolean) => React.ReactNode;
}

function NodeView({ node, activeLeafId, onFocus, splitLeaf, closeLeaf, renderLeaf }: NodeViewProps) {
  const unread = useWorkspaceStore((state) => Boolean(node.tabId && state.notifications.some((n) => !n.read && n.tabId === node.tabId)));
  const tab = useWorkspaceStore((state) => state.tabs.find((candidate) => candidate.id === node.tabId));
  const metadata = useWorkspaceStore((state) => tab?.sessionId ? state.sessionMetadata[tab.sessionId] : undefined);
  if (node.type === 'leaf') {
    const active = activeLeafId === node.id;
    return (
      <div
        onMouseDown={() => onFocus(node.id)}
        className="h-full w-full min-w-0 min-h-0 border"
        style={{
          borderColor: active || unread ? 'var(--accent)' : 'var(--border)',
          boxShadow: unread ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent)' : undefined,
        }}
      >
        <div className="h-6 border-b flex items-center px-1 gap-1" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <span
            data-session-meta={tab?.sessionId || ''}
            className="min-w-0 flex-1 truncate px-1 text-[10px] font-mono"
            style={{ color: metadata ? 'var(--muted-strong)' : 'var(--muted)' }}
            title={metadataSecondary(metadata) || metadata?.cwd || tab?.name || ''}
          >
            {metadataPrimary(metadata) || tab?.name || 'pane'}
          </span>
          <button onClick={() => splitLeaf(node.id, 'horizontal')} className="text-[10px] px-1" style={{ color: 'var(--muted)' }} title="Split H (Ctrl+Shift+H)">⬌</button>
          <button onClick={() => splitLeaf(node.id, 'vertical')} className="text-[10px] px-1" style={{ color: 'var(--muted)' }} title="Split V (Ctrl+Shift+V)">⬍</button>
          <button onClick={() => closeLeaf(node.id)} className="text-[10px] px-1" style={{ color: 'var(--muted)' }} title="Close (Ctrl+W)">×</button>
        </div>
        <div className="h-[calc(100%-24px)]">
          {renderLeaf(node, active)}
        </div>
      </div>
    );
  }

  return <SplitNodeView node={node} activeLeafId={activeLeafId} onFocus={onFocus} splitLeaf={splitLeaf} closeLeaf={closeLeaf} renderLeaf={renderLeaf} />;
}

function SplitNodeView({ node, ...props }: NodeViewProps) {
  const isRow = (node.direction ?? 'horizontal') === 'horizontal';
  const children = node.children ?? [];
  const initial = normalizeSizes(
    node.sizes?.length === children.length ? node.sizes : new Array(children.length).fill(100 / Math.max(1, children.length))
  );
  const [sizes, setSizes] = useState(initial);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSizes(initial); }, [JSON.stringify(initial)]); // eslint-disable-line

  const startDrag = (index: number, startPos: number, startSizes: number[]) => {
    const move = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const total = isRow ? rect.width : rect.height;
      if (total <= 0) return;
      const deltaPct = ((isRow ? e.clientX : e.clientY) - startPos) / total * 100;
      const next = [...startSizes];
      const minPct = (MIN_PX / total) * 100;
      next[index] = clamp(next[index] + deltaPct, minPct, 100 - minPct);
      next[index + 1] = clamp(next[index + 1] - deltaPct, minPct, 100 - minPct);
      setSizes(normalizeSizes(next));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div ref={containerRef} className={`h-full w-full flex ${isRow ? 'flex-row' : 'flex-col'}`}>
      {children.map((child, i) => (
        <React.Fragment key={child.id}>
          <div className="min-w-0 min-h-0" style={{ [isRow ? 'width' : 'height']: `${sizes[i]}%` }}>
            <NodeView node={child} {...props} />
          </div>
          {i < children.length - 1 && (
            <div
              className={`${isRow ? 'w-[6px] cursor-col-resize' : 'h-[6px] cursor-row-resize'}`}
              style={{ [isRow ? 'minWidth' : 'minHeight']: `${HANDLE_PX}px`, background: 'var(--border)' }}
              onMouseDown={(e) => startDrag(i, isRow ? e.clientX : e.clientY, sizes)}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
