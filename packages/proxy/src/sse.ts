import { IncomingMessage, ServerResponse } from 'http';

export type SSEEvent = {
  type: string;
  [key: string]: any;
};

const clients: Set<ServerResponse> = new Set();
let pingInterval: NodeJS.Timeout | null = null;

export function addSSEClient(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  // Send initial comment so client knows connection is alive
  res.write(': connected\n\n');

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });

  // Start keep-alive pings if not already running
  if (!pingInterval) {
    pingInterval = setInterval(() => {
      // SSE keep-alive comment format
      const ping = ': ping\n\n';
      for (const client of clients) {
        try {
          if (!client.destroyed && client.writable) {
            client.write(ping);
          } else {
            clients.delete(client);
          }
        } catch {
          clients.delete(client);
        }
      }
    }, 15_000);
  }
}

export function broadcast(event: SSEEvent): void {
  if (clients.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      if (!client.destroyed && client.writable) {
        client.write(data);
      } else {
        clients.delete(client);
      }
    } catch {
      clients.delete(client);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

export function stopSSE(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  for (const client of clients) {
    try { client.end(); } catch { /* ignore */ }
  }
  clients.clear();
}
