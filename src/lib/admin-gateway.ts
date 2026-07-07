import { WebSocket } from 'ws';
import { signToken } from '@/lib/auth';

const WS_PORT = process.env.WS_PORT || process.env.NEXT_PUBLIC_WS_PORT || '8791';
const WS_URL = process.env.WEB_CONSOLE_ADMIN_WS_URL || `ws://127.0.0.1:${WS_PORT}`;

export async function sendGatewayMessage(message: Record<string, unknown>) {
  const token = signToken();
  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway connection timeout')), 3000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  ws.send(JSON.stringify(message));
  await new Promise((resolve) => setTimeout(resolve, 100));
  ws.close();
}
