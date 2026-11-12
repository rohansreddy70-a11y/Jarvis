import { loadEnvFile, buildConfig } from './config.js';
import { createApp } from './app.js';
import { createServer } from './http/server.js';

loadEnvFile();
const config = buildConfig();

for (const w of config.warnings) console.warn(`[jarvis] warning: ${w}`);
if (config.errors.length) {
  for (const e of config.errors) console.error(`[jarvis] config error: ${e}`);
  process.exit(1);
}

const app = createApp(config);
app.startBackgroundJobs();
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`[jarvis] J.A.R.V.I.S online at http://${config.host}:${config.port}`);
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
