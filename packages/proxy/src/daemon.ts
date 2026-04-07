import { createProxyServer } from './server.js';
import { ensureDir } from './db.js';

ensureDir();

const port = parseInt(process.env.STARNOSE_PORT ?? '3001', 10);
const { server, port: actualPort } = await createProxyServer(port);
console.log(`starnose proxy listening on port ${actualPort}`);

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
