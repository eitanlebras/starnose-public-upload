import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

export { createProxyServer, stopServer } from './server.js';
export { getDb, resetDb, closeDb, getDbPath, getStarnoseDir, ensureDir } from './db.js';
export { estimateCost, getPricing } from './pricing.js';
export { parseSystemPrompt, extractToolCalls, extractUserMessages, detectMissingContext, categorizeToolCall } from './parsing.js';
export { getOrCreateSession, getCurrentSessionId, getNextCallIndex, updateSessionStats, setSessionStatus, resetSessionState } from './sessions.js';
export { addSSEClient, broadcast, getClientCount, stopSSE } from './sse.js';
export { setLiveCall, getLiveCall, updateLiveActivity } from './live.js';
export { countTokens } from './tokens.js';

// CLI entry point for daemon mode
async function main() {
  if (process.argv[1] && (process.argv[1].endsWith('proxy/dist/index.js') || process.argv[1].endsWith('proxy/src/index.ts'))) {
    const { createProxyServer } = await import('./server.js');
    const { ensureDir } = await import('./db.js');

    ensureDir();

    const port = parseInt(process.env.STARNOSE_PORT ?? '3001', 10);
    const { server, port: actualPort } = await createProxyServer(port);
    console.log(`starnose proxy listening on port ${actualPort}`);

    process.on('SIGTERM', () => {
      server.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      server.close(() => process.exit(0));
    });
  }
}

main().catch(console.error);
