import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { loadWorkspaceState, saveWorkspaceState } from '@/lib/db';
import { buildWorkspaceFromRecipe } from '@/lib/recipes';
import { loadAllRecipes } from '@/lib/recipe-loader';

type WorkspaceState = {
  tabs?: unknown[];
  activeTabId?: string | null;
  splitTree?: unknown;
  workspaces?: Array<{ id: string; name: string; tabs?: unknown[]; splitTree?: unknown; activeTabId?: string | null }>;
  activeWorkspaceId?: string | null;
  sidebarOpen?: boolean;
  _version?: number;
  _savedAt?: number;
};

function loadState(): WorkspaceState {
  const raw = loadWorkspaceState();
  if (!raw) return { tabs: [], activeTabId: null, splitTree: null, workspaces: [], activeWorkspaceId: null, sidebarOpen: false, _version: 2 };
  try {
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return { tabs: [], activeTabId: null, splitTree: null, workspaces: [], activeWorkspaceId: null, sidebarOpen: false, _version: 2 };
  }
}

export async function GET(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const state = loadState();
  return NextResponse.json({
    activeWorkspaceId: state.activeWorkspaceId || null,
    workspaces: (state.workspaces || []).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      tabs: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const recipeKey = String(body?.recipe || body?.recipeId || body?.name || '').trim().toLowerCase();
    if (!recipeKey) return NextResponse.json({ error: 'recipe is required' }, { status: 400 });

    const { recipes } = await loadAllRecipes();
    const recipe = recipes.find((candidate) =>
      candidate.id.toLowerCase() === recipeKey || candidate.name.toLowerCase() === recipeKey
    );
    if (!recipe) return NextResponse.json({ error: `Recipe not found: ${recipeKey}` }, { status: 404 });

    const workspace = buildWorkspaceFromRecipe(recipe);
    const state = loadState();
    const nextWorkspaces = [...(Array.isArray(state.workspaces) ? state.workspaces : []), workspace];
    const nextState = {
      ...state,
      tabs: workspace.tabs,
      activeTabId: workspace.activeTabId,
      splitTree: workspace.splitTree,
      workspaces: nextWorkspaces,
      activeWorkspaceId: workspace.id,
      sidebarOpen: state.sidebarOpen ?? false,
      _version: 2,
      _savedAt: Date.now(),
    };
    saveWorkspaceState(JSON.stringify(nextState));
    await sendGatewayMessage({ type: 'workspace_updated', workspaceId: workspace.id });
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const id = req.nextUrl.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const state = loadState();
    const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
    if (!workspaces.some((workspace) => workspace.id === id)) {
      return NextResponse.json({ error: `Workspace not found: ${id}` }, { status: 404 });
    }
    if (workspaces.length <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last workspace' }, { status: 400 });
    }

    const nextWorkspaces = workspaces.filter((workspace) => workspace.id !== id);
    const activeWorkspace = state.activeWorkspaceId === id
      ? nextWorkspaces[0]
      : nextWorkspaces.find((workspace) => workspace.id === state.activeWorkspaceId) || nextWorkspaces[0];
    const nextState = {
      ...state,
      tabs: activeWorkspace.tabs || [],
      activeTabId: activeWorkspace.activeTabId || null,
      splitTree: activeWorkspace.splitTree || null,
      workspaces: nextWorkspaces,
      activeWorkspaceId: activeWorkspace.id,
      sidebarOpen: state.sidebarOpen ?? false,
      _version: 2,
      _savedAt: Date.now(),
    };
    saveWorkspaceState(JSON.stringify(nextState));
    await sendGatewayMessage({ type: 'workspace_updated', workspaceId: activeWorkspace.id });
    return NextResponse.json({ ok: true, deleted: id, activeWorkspaceId: activeWorkspace.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
