import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import {
  clickBrowserPoint,
  frameBrowser,
  navigateBrowserHistory,
  openOrNavigateBrowserSession,
  reloadBrowser,
  scrollBrowser,
  typeBrowserText,
} from '@/lib/browser-automation';

export const runtime = 'nodejs';

function authed(req: NextRequest) {
  const token = req.cookies.get('wc-token')?.value;
  return !!token && verifyToken(token);
}

function normalizeUrl(input: unknown) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return 'about:blank';
  if (/^(https?:|about:|data:)/i.test(raw)) return raw;
  if (/^localhost(:|\/|$)/i.test(raw) || /^127\.0\.0\.1(:|\/|$)/.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const action = String(body?.action || '').trim();
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
    const url = body?.url === undefined ? undefined : normalizeUrl(body.url);

    if (action === 'open' || action === 'frame') {
      const session = await openOrNavigateBrowserSession({ url, sessionId });
      return NextResponse.json({ ok: true, frame: await frameBrowser(session, { width: body?.width, height: body?.height }) });
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

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
