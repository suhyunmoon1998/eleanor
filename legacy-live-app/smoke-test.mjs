import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const port = 34791;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), APP_PASSWORD: '', OPENAI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await pause(700);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
  if (!health.ok || health.expected_atomic_triggers !== 227 || health.interview_families !== 49) {
    throw new Error('Health check did not return the Eleanor v3 map.');
  }
  const home = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  if (!home.includes('Eleanor v3 LIVE') || !home.includes('Start Eleanor live')) {
    throw new Error('Live interface did not load.');
  }
  const sessionId = 'smoke-session-12345';
  const save = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, session_state: { version: '3.0', turns: [], session_id: sessionId } }),
  }).then((r) => r.json());
  if (!save.ok) throw new Error('Session save failed.');
  const loaded = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`).then((r) => r.json());
  if (loaded.session_id !== sessionId) throw new Error('Session retrieval failed.');
  await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, { method: 'DELETE' });
  console.log('Eleanor v3 LIVE smoke test passed.');
} finally {
  child.kill('SIGTERM');
}
