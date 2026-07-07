'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceRecipe } from '@/lib/recipes';

interface CommandPaletteProps {
  open: boolean;
  recipes: WorkspaceRecipe[];
  onClose: () => void;
  onRunRecipe: (recipe: WorkspaceRecipe) => void;
  onNewTerminal: () => void;
  onNewBrowser: () => void;
  onToggleSidebar: () => void;
  onOpenThemeGallery: () => void;
}

export default function CommandPalette({
  open, recipes, onClose, onRunRecipe, onNewTerminal, onNewBrowser, onToggleSidebar, onOpenThemeGallery,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const commands = useMemo(() => {
    const builtins = [
      { id: 'new-terminal', label: 'New terminal', hint: 'Open terminal in active pane', run: onNewTerminal },
      { id: 'new-browser', label: 'New browser', hint: 'Open browser preview panel', run: onNewBrowser },
      { id: 'toggle-sidebar', label: 'Toggle workspaces', hint: 'Show or hide workspace sidebar', run: onToggleSidebar },
      { id: 'theme-gallery', label: 'Theme gallery', hint: 'Preview, apply, import, and export themes', run: onOpenThemeGallery },
    ];
    const recipeCommands = recipes.map((recipe) => ({
      id: `recipe-${recipe.id}`,
      label: recipe.name,
      hint: recipe.description || `${recipe.tabs.length} pane${recipe.tabs.length === 1 ? '' : 's'}`,
      run: () => onRunRecipe(recipe),
    }));
    const q = query.trim().toLowerCase();
    return [...builtins, ...recipeCommands].filter((command) => {
      if (!q) return true;
      return `${command.label} ${command.hint}`.toLowerCase().includes(q);
    }).slice(0, 12);
  }, [onNewBrowser, onNewTerminal, onOpenThemeGallery, onRunRecipe, onToggleSidebar, query, recipes]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-3 pt-14 sm:pt-24" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden border shadow-2xl"
        style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', borderRadius: 8 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'Enter' && commands[0]) {
              commands[0].run();
              onClose();
            }
          }}
          className="h-11 w-full border-b bg-transparent px-3 font-mono text-sm outline-none"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          placeholder="Run command or recipe"
        />
        <div className="max-h-[360px] overflow-y-auto py-1">
          {commands.map((command) => (
            <button
              key={command.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono text-xs"
              style={{ color: 'var(--foreground)' }}
              onClick={() => {
                command.run();
                onClose();
              }}
            >
              <span className="min-w-0 truncate">{command.label}</span>
              <span className="shrink-0 truncate text-[10px]" style={{ color: 'var(--muted)' }}>{command.hint}</span>
            </button>
          ))}
          {commands.length === 0 && (
            <div className="px-3 py-6 text-center font-mono text-xs" style={{ color: 'var(--muted)' }}>
              No commands
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
