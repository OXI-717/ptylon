import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_ROOT } from '@/lib/server-config';
import { BUILTIN_RECIPES, type RecipeLayout, type RecipeTab, type WorkspaceRecipe } from '@/lib/recipes';

const LAYOUTS = new Set<RecipeLayout>(['single', 'hsplit', 'hsplit3', 'quad']);

function normalizeRecipe(input: unknown, index: number): WorkspaceRecipe | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const rawTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  const tabs: RecipeTab[] = rawTabs
    .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === 'object')
    .map((tab) => ({
      type: tab.type === 'editor' || tab.type === 'files' || tab.type === 'terminal' || tab.type === 'browser' ? tab.type : 'terminal',
      name: typeof tab.name === 'string' ? tab.name : undefined,
      color: typeof tab.color === 'string' ? tab.color : undefined,
      cwd: typeof tab.cwd === 'string' ? tab.cwd : undefined,
      url: typeof tab.url === 'string' ? tab.url : undefined,
      command: typeof tab.command === 'string' ? tab.command : undefined,
      initCommand: typeof tab.initCommand === 'string' ? tab.initCommand : undefined,
      filePath: typeof tab.filePath === 'string' ? tab.filePath : undefined,
    }));

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Recipe ${index + 1}`;
  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `recipe-${index + 1}`;
  const layout = typeof raw.layout === 'string' && LAYOUTS.has(raw.layout as RecipeLayout) ? raw.layout as RecipeLayout : 'single';

  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
    layout,
    tabs: tabs.length > 0 ? tabs : [{ type: 'terminal', name: 'Terminal' }],
  };
}

export async function loadUserRecipes() {
  const recipePath = path.join(WORKSPACE_ROOT, '.web-console.json');
  try {
    const raw = await fs.readFile(recipePath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.recipes) ? parsed.recipes : [];
    return {
      path: recipePath,
      recipes: list.map(normalizeRecipe).filter(Boolean) as WorkspaceRecipe[],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: recipePath, recipes: [] };
    throw error;
  }
}

export async function loadAllRecipes() {
  const user = await loadUserRecipes();
  return {
    path: user.path,
    recipes: [...BUILTIN_RECIPES, ...user.recipes],
    userRecipes: user.recipes.length,
  };
}
