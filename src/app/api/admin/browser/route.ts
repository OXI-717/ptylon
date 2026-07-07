import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { loadWorkspaceState, saveWorkspaceState } from '@/lib/db';
import {
  clickBrowser,
  clickBrowserPoint,
  closeBrowserSession,
  evalBrowser,
  fillBrowser,
  frameBrowser,
  navigateBrowserHistory,
  listBrowserSessions,
  openOrNavigateBrowserSession,
  reloadBrowser,
  screenshotBrowser,
  scrollBrowser,
  snapshotBrowser,
  typeBrowserText,
} from '@/lib/browser-automation';
import type { SplitNode } from '@/components/SplitContainer';
import type { Tab, Workspace } from '@/stores/workspace-store';

export const runtime = 'nodejs';

type WorkspaceState = {
  tabs?: Tab[];
  activeTabId?: string | null;
  splitTree?: SplitNode | null;
  workspaces?: Workspace[];
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

function normalizeUrl(input: unknown) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return 'about:blank';
  if (/^(https?:|about:|data:)/i.test(raw)) return raw;
  if (/^localhost(:|\/|$)/i.test(raw) || /^127\.0\.0\.1(:|\/|$)/.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}

function browserName(url: string) {
  try {
    const host = new URL(url).hostname;
    return host ? `Browser ${host}` : 'Browser';
  } catch {
    return 'Browser';
  }
}

async function openPanel(url: string, name?: string) {
  const session = await openOrNavigateBrowserSession({ url });
  const snapshot = await snapshotBrowser(session);
  const tab: Tab = {
    id: crypto.randomUUID(),
    type: 'browser',
    name: name || browserName(snapshot.url),
    color: '#f59f00',
    url: snapshot.url,
    browserSessionId: session.id,
  };
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: tab.name,
    color: tab.color,
    tabs: [tab],
    splitTree: { id: crypto.randomUUID(), type: 'leaf', tabId: tab.id },
    activeTabId: tab.id,
  };
  const state = loadState();
  const nextWorkspaces = [...(Array.isArray(state.workspaces) ? state.workspaces : []), workspace];
  const nextState: WorkspaceState = {
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
  return { workspace, tab, snapshot };
}

export async function GET(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  return NextResponse.json({ sessions: listBrowserSessions() });
}

export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const action = String(body?.action || '').trim();
    const url = body?.url === undefined ? undefined : normalizeUrl(body.url);
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;

    if (action === 'panelOpen') {
      const opened = await openPanel(normalizeUrl(body?.url), typeof body?.name === 'string' ? body.name : undefined);
      return NextResponse.json({ ok: true, ...opened });
    }

    if (action === 'open') {
      const session = await openOrNavigateBrowserSession({ url, sessionId });
      return NextResponse.json({ ok: true, snapshot: await snapshotBrowser(session) });
    }

    if (action === 'snapshot') {
      const session = await openOrNavigateBrowserSession({ url, sessionId });
      return NextResponse.json({ ok: true, snapshot: await snapshotBrowser(session) });
    }

    if (action === 'frame') {
      const session = await openOrNavigateBrowserSession({ url, sessionId });
      return NextResponse.json({ ok: true, frame: await frameBrowser(session, { width: body?.width, height: body?.height }) });
    }

    if (action === 'click') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      const selector = typeof body?.selector === 'string' ? body.selector : '';
      if (!selector) return NextResponse.json({ error: 'selector is required' }, { status: 400 });
      const session = await openOrNavigateBrowserSession({ sessionId });
      await clickBrowser(session, selector);
      return NextResponse.json({ ok: true, snapshot: await snapshotBrowser(session) });
    }

    if (action === 'pointClick') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      const session = await openOrNavigateBrowserSession({ sessionId });
      await clickBrowserPoint(session, body?.x, body?.y);
      return NextResponse.json({ ok: true, frame: await frameBrowser(session, { width: body?.width, height: body?.height }) });
    }

    if (action === 'reload' || action === 'back' || action === 'forward') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      const session = await openOrNavigateBrowserSession({ sessionId });
      if (action === 'reload') await reloadBrowser(session);
      if (action === 'back') await navigateBrowserHistory(session, 'back');
      if (action === 'forward') await navigateBrowserHistory(session, 'forward');
      return NextResponse.json({ ok: true, frame: await frameBrowser(session, { width: body?.width, height: body?.height }) });
    }

    if (action === 'fill') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      const selector = typeof body?.selector === 'string' ? body.selector : '';
      const text = typeof body?.text === 'string' ? body.text : '';
      if (!selector) return NextResponse.json({ error: 'selector is required' }, { status: 400 });
      const session = await openOrNavigateBrowserSession({ sessionId });
      await fillBrowser(session, selector, text);
      return NextResponse.json({ ok: true, snapshot: await snapshotBrowser(session) });
    }

    if (action === 'type') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      const text = typeof body?.text === 'string' ? body.text : '';
      const session = await openOrNavigateBrowserSession({ sessionId });
      await typeBrowserText(session, text);
      return NextResponse.json({ ok: true, frame: await frameBrowser(session, { width: body?.width, height: body?.height }) });
    }

    if (action === 'scroll') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      const session = await openOrNavigateBrowserSession({ sessionId });
      await scrollBrowser(session, body?.x, body?.y, body?.deltaX, body?.deltaY);
      return NextResponse.json({ ok: true, frame: await frameBrowser(session, { width: body?.width, height: body?.height }) });
    }

    if (action === 'eval') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      if (body?.allowUnsafeEval !== true) {
        return NextResponse.json({ error: 'eval requires allowUnsafeEval=true' }, { status: 400 });
      }
      const expression = typeof body?.expression === 'string' ? body.expression : '';
      if (!expression) return NextResponse.json({ error: 'expression is required' }, { status: 400 });
      const session = await openOrNavigateBrowserSession({ sessionId });
      return NextResponse.json({ ok: true, sessionId, value: await evalBrowser(session, expression) });
    }

    if (action === 'screenshot') {
      const session = await openOrNavigateBrowserSession({ url, sessionId });
      return NextResponse.json({ ok: true, sessionId: session.id, screenshot: await screenshotBrowser(session, body?.allowUnsafeScreenshot === true) });
    }

    if (action === 'console') {
      const session = await openOrNavigateBrowserSession({ url, sessionId });
      const snapshot = await snapshotBrowser(session);
      return NextResponse.json({ ok: true, sessionId: session.id, consoleErrors: snapshot.consoleErrors });
    }

    if (action === 'close') {
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      return NextResponse.json({ ok: await closeBrowserSession(sessionId) });
    }

    if (action === 'list') {
      return NextResponse.json({ ok: true, sessions: listBrowserSessions() });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
