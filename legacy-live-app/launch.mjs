import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline/promises';

const ROOT = dirname(fileURLToPath(import.meta.url));
const envPath = join(ROOT, '.env');
const examplePath = join(ROOT, '.env.example');

function parseEnv(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) result[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return result;
}

async function ensureEnv() {
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8');
  let values = parseEnv(text);
  if (values.OPENAI_API_KEY) return values;

  console.log('\nEleanor v3 LIVE — first-time setup');
  console.log('Your OpenAI API key will be saved only in this local .env file.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const key = (await rl.question('Paste the OpenAI API key and press Enter: ')).trim();
  const password = (await rl.question('Optional app password for browser access (press Enter to skip locally): ')).trim();
  rl.close();
  if (!key) throw new Error('An OpenAI API key is required for the live voice interviewer.');

  text = text.replace(/^OPENAI_API_KEY=.*$/m, `OPENAI_API_KEY=${key}`);
  if (password) text = text.replace(/^APP_PASSWORD=.*$/m, `APP_PASSWORD=${password}`);
  writeFileSync(envPath, text, { encoding: 'utf8', mode: 0o600 });
  values = parseEnv(text);
  console.log('Configuration saved.');
  return values;
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open'; args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd'; args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open'; args = [url];
  }
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

try {
  const values = await ensureEnv();
  const port = Number(values.PORT || 3000);
  const url = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: 'inherit' });
  setTimeout(() => openBrowser(url), 1200);
  console.log(`\nOpening Eleanor at ${url}`);
  console.log('Keep this window open during the interview. Press Ctrl+C to stop Eleanor.\n');
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch (error) {
  console.error(`\nCould not start Eleanor: ${error.message}`);
  process.exit(1);
}
