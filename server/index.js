import { loadEnvFile, buildConfig } from './config.js';
import { createApp } from './app.js';
import { createServer } from './http/server.js';

const envHint = loadEnvFile();
const config = buildConfig();
if (envHint) console.warn(`[jarvis] warning: ${envHint}`);

for (const w of config.warnings) console.warn(`[jarvis] warning: ${w}`);
if (config.errors.length) {
  for (const e of config.errors) console.error(`[jarvis] config error: ${e}`);
  process.exit(1);
}

const app = createApp(config);
app.startBackgroundJobs();
const server = createServer(app);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[jarvis] Port ${config.port} is already in use — JARVIS may already be running in another window. Close it, or set JARVIS_PORT=3001 in .env.`);
  } else {
    console.error(`[jarvis] Could not start the server: ${err.message}`);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`[jarvis] J.A.R.V.I.S online at http://${config.host}:${config.port}`);
  console.log('[jarvis] Open that address in Chrome. Keep this window open while you use JARVIS (Ctrl+C stops it).');
  console.log(`[jarvis] AI engine: ${config.ai.configured ? `${config.ai.label} · ${config.ai.model}` : `NOT CONFIGURED (missing: ${config.ai.missing.join(', ')})`}`);
  console.log(`[jarvis] Time zone: ${config.timezone} · Auth: ${config.accessToken ? 'token required' : 'local only (no token)'}`);
});

const shutdown = () => {
  server.close();
  app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
