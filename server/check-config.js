// `npm run check-config` — validates .env without printing any secret values.
import { loadEnvFile, buildConfig } from './config.js';
import { createApp } from './app.js';

loadEnvFile();
const config = buildConfig();
console.log('JARVIS configuration check\n');
console.log(`Server     ${config.host}:${config.port}  auth=${config.accessToken ? 'token set' : 'none (local only)'}`);
console.log(`Time zone  ${config.timezone}`);
console.log(`Database   ${config.dbPath}\n`);
const app = config.errors.length ? null : createApp(config);
for (const i of app ? app.services.integrations.status() : []) {
  const mark = i.connected ? '✔' : i.status === 'not_implemented' ? '·' : '✘';
  const extra = i.connected ? '' : i.requires.length ? `  needs: ${i.requires.join(', ')}` : '';
  console.log(`${mark} ${i.name.padEnd(20)} ${i.status}${extra}`);
}
for (const w of config.warnings) console.log(`\nwarning: ${w}`);
for (const e of config.errors) console.log(`\nERROR: ${e}`);
app?.close();
process.exit(config.errors.length ? 1 : 0);
