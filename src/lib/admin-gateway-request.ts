import { WebSocket } from 'ws';
import { signToken } from '@/lib/auth';

const WS_PORT = process.env.WS_PORT || process.env.NEXT_PUBLIC_WS_PORT || '8791';
const WS_URL = process.env.WEB_CONSOLE_ADMIN_WS_URL || `ws://127.0.0.1:${WS_PORT}`;

/**
 * Request/response variant of sendGatewayMessage. Unlike the fire-and-forget helper, this
 * tags the message with a correlation id (`_cid`) and waits for a daemon reply of
 * `expectType` carrying the same `_cid` (e.g. `create` → `created`). Used by the jobs-hook,
 * which needs the created sessionId back.
 */
export async function sendGatewayRequest(
  message: Record<string, unknown>,
  expectType: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  const token = signToken();
  const cid = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const ws = new WebSocket(WS_URL, { headers: { Cookie: `wc-token=${encodeURIComponent(token)}` } });
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('gateway connection timeout')), timeoutMs);
      ws.once('open', () => { clearTimeout(t); resolve(); });
      ws.once('error', (e: Error) => { clearTimeout(t); reject(e); });
    });

    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`gateway ${expectType} timeout`)), timeoutMs);
      ws.on('message', (raw) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return; // ignore non-JSON frames
        }
        if (msg._cid !== cid) return;
        if (msg.type === expectType) { clearTimeout(t); resolve(msg); }
        else if (msg.type === 'error') { clearTimeout(t); reject(new Error(String(msg.data || 'gateway error'))); }
      });
    });

    ws.send(JSON.stringify({ ...message, _cid: cid }));
    return await responsePromise;
  } finally {
    ws.close();
  }
}
