import type { SplitNode } from '@/components/SplitContainer';
import type { Tab, TabType, Workspace } from '@/stores/workspace-store';

export type RecipeLayout = 'single' | 'hsplit' | 'hsplit3' | 'quad';

export interface RecipeTab {
  type?: TabType;
  name?: string;
  color?: string;
  cwd?: string;
  url?: string;
  command?: string;
  initCommand?: string;
  filePath?: string;
}

export interface WorkspaceRecipe {
  id: string;
  name: string;
  description?: string;
  color?: string;
  layout?: RecipeLayout;
  tabs: RecipeTab[];
}

export const BUILTIN_RECIPES: WorkspaceRecipe[] = [
  {
    id: 'shell-pair',
    name: 'Shell Pair',
    description: 'Two clean shell panes',
    layout: 'hsplit',
    tabs: [
      { type: 'terminal', name: 'shell A', color: '#40E0D0' },
      { type: 'terminal', name: 'shell B', color: '#74c0fc' },
    ],
  },
  {
    id: 'devops',
    name: 'DevOps',
    description: 'htop, logs, and shell panes',
    layout: 'hsplit3',
    tabs: [
      { type: 'terminal', name: 'htop', color: '#ff6b6b', command: 'htop' },
      { type: 'terminal', name: 'logs', color: '#ffd43b', command: 'journalctl -f --no-pager -n 50' },
      { type: 'terminal', name: 'shell', color: '#40E0D0' },
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Claude terminal with file manager',
    layout: 'hsplit',
    tabs: [
      { type: 'terminal', name: 'Claude', color: '#da77f2', command: 'claude' },
      { type: 'files', name: 'Files', color: '#69db7c' },
    ],
  },
  {
    id: 'browser-shell',
    name: 'Browser + Shell',
    description: 'Browser preview beside a project shell',
    layout: 'hsplit',
    tabs: [
      { type: 'browser', name: 'Browser', color: '#f59f00', url: 'http://127.0.0.1:8790' },
      { type: 'terminal', name: 'shell', color: '#40E0D0' },
    ],
  },
  {
    id: 'monitoring',
    name: 'Monitoring',
    description: 'Top, logs, network, and disk panes',
    layout: 'quad',
    tabs: [
      { type: 'terminal', name: 'top', color: '#ff6b6b', command: 'top -d 2' },
      { type: 'terminal', name: 'logs', color: '#ffd43b', command: 'journalctl -f --no-pager -n 30' },
      { type: 'terminal', name: 'net', color: '#74c0fc', command: 'ss -tlnp; echo "---"; ss -tnp | head -20' },
      { type: 'terminal', name: 'disk', color: '#69db7c', command: 'df -h; echo "---"; iostat -x 2 2>/dev/null || echo "iostat not installed, showing df -h loop"; watch -n 5 df -h' },
    ],
  },
];

function newId() {
  return crypto.randomUUID();
}

function splitForTabs(tabs: Tab[], layout: RecipeLayout): SplitNode {
  if (tabs.length === 1 || layout === 'single') {
    return { id: newId(), type: 'leaf', tabId: tabs[0].id };
  }
  if (layout === 'hsplit') {
    return {
      id: newId(), type: 'split', direction: 'horizontal',
      children: [
        { id: newId(), type: 'leaf', tabId: tabs[0].id },
        { id: newId(), type: 'leaf', tabId: tabs[1]?.id || tabs[0].id },
      ],
      sizes: [60, 40],
    };
  }
  if (layout === 'hsplit3') {
    return {
      id: newId(), type: 'split', direction: 'horizontal',
      children: [
        { id: newId(), type: 'leaf', tabId: tabs[0].id },
        {
          id: newId(), type: 'split', direction: 'vertical',
          children: [
            { id: newId(), type: 'leaf', tabId: tabs[1]?.id || tabs[0].id },
            { id: newId(), type: 'leaf', tabId: tabs[2]?.id || tabs[0].id },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [40, 60],
    };
  }

  return {
    id: newId(), type: 'split', direction: 'horizontal',
    children: [
      {
        id: newId(), type: 'split', direction: 'vertical',
        children: [
          { id: newId(), type: 'leaf', tabId: tabs[0].id },
          { id: newId(), type: 'leaf', tabId: tabs[1]?.id || tabs[0].id },
        ],
        sizes: [50, 50],
      },
      {
        id: newId(), type: 'split', direction: 'vertical',
        children: [
          { id: newId(), type: 'leaf', tabId: tabs[2]?.id || tabs[0].id },
          { id: newId(), type: 'leaf', tabId: tabs[3]?.id || tabs[0].id },
        ],
        sizes: [50, 50],
      },
    ],
    sizes: [50, 50],
  };
}

export function buildWorkspaceFromRecipe(recipe: WorkspaceRecipe): Workspace {
  const sourceTabs: RecipeTab[] = recipe.tabs.length > 0 ? recipe.tabs : [{ type: 'terminal', name: 'Terminal' }];
  const tabs: Tab[] = sourceTabs.map((tab, index) => ({
    id: newId(),
    type: (tab.type || 'terminal') as TabType,
    name: tab.name || `Terminal ${index + 1}`,
    color: tab.color || recipe.color || '#40E0D0',
    cwd: tab.cwd,
    url: tab.url,
    filePath: tab.filePath,
    initCommand: tab.initCommand || tab.command,
  }));

  return {
    id: newId(),
    name: recipe.name,
    color: recipe.color || tabs[0]?.color || '#40E0D0',
    tabs,
    splitTree: splitForTabs(tabs, recipe.layout || 'single'),
    activeTabId: tabs[0]?.id || null,
  };
}
