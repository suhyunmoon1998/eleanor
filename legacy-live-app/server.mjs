import http from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname);

loadDotEnv(join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const STORAGE_DIR = resolve(ROOT, process.env.SESSION_STORAGE_DIR || 'storage');
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 12_000_000);
const PROMPT = await readFile(join(ROOT, 'eleanor_v3_round1a_prompt.txt'), 'utf8');
const ATLAS = JSON.parse(await readFile(join(ROOT, 'eleanor_v3_trigger_atlas.json'), 'utf8'));
await mkdir(STORAGE_DIR, { recursive: true });

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function securityHeaders(type = 'text/plain; charset=utf-8') {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'microphone=(self)',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://api.openai.com; media-src 'self' blob:; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
}

function send(res, status, body, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders(type), ...extraHeaders });
  res.end(body);
}

function json(res, status, value, extraHeaders = {}) {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8', extraHeaders);
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  return await new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

function requireApiKey(res) {
  if (process.env.OPENAI_API_KEY) return true;
  json(res, 503, {
    error: 'OPENAI_API_KEY is not configured on the Eleanor server.',
    action: 'Copy .env.example to .env, add the key, and restart Eleanor.',
  });
  return false;
}

function authEnabled() {
  return Boolean(process.env.APP_PASSWORD);
}

function isAuthorized(req) {
  if (!authEnabled()) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const username = i >= 0 ? decoded.slice(0, i) : '';
    const password = i >= 0 ? decoded.slice(i + 1) : decoded;
    const expectedUser = process.env.APP_USERNAME || 'jacklaw';
    const userOk = crypto.timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser));
    const passOk = crypto.timingSafeEqual(Buffer.from(password), Buffer.from(process.env.APP_PASSWORD));
    return userOk && passOk;
  } catch {
    return false;
  }
}

function challenge(res) {
  send(res, 401, 'Authentication required.', 'text/plain; charset=utf-8', {
    'WWW-Authenticate': 'Basic realm="Eleanor v3 Live", charset="UTF-8"',
  });
}

function safeSessionId(value) {
  const raw = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{8,100}$/.test(raw)) return raw;
  return crypto.randomUUID();
}

function sessionPath(id) {
  return join(STORAGE_DIR, `${safeSessionId(id)}.json`);
}

async function atomicWriteJson(path, value) {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}

async function health(_req, res) {
  json(res, 200, {
    ok: true,
    app: 'Eleanor v3 Live',
    version: '3.1.0-live',
    api_configured: Boolean(process.env.OPENAI_API_KEY),
    realtime_model: process.env.REALTIME_MODEL || 'gpt-realtime',
    realtime_voice: process.env.REALTIME_VOICE || 'marin',
    extraction_model: process.env.EXTRACTION_MODEL || 'gpt-5-mini',
    persistence: true,
    storage_directory: 'server-managed',
    basic_auth_enabled: authEnabled(),
    expected_atomic_triggers: 227,
    interview_families: 49,
  });
}

async function createRealtimeSession(req, res) {
  if (!requireApiKey(res)) return;
  const sdp = (await readBody(req, 1_500_000)).toString('utf8');
  if (!sdp.includes('v=0')) {
    json(res, 400, { error: 'Expected a WebRTC SDP offer.' });
    return;
  }

  const session = {
    type: 'realtime',
    model: process.env.REALTIME_MODEL || 'gpt-realtime',
    output_modalities: ['audio'],
    audio: {
      input: {
        noise_reduction: { type: process.env.NOISE_REDUCTION || 'near_field' },
        transcription: {
          model: process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
          language: 'en',
          prompt: 'Jack Law litigation practice, CaseSync, CMC, CM-110, SOL, PHS, POS, G Frogs, E Frogs, SROGs, RFP, RFA, PMQ, M&C, MTC, IDC, FSC, MSC, MIL.',
        },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: process.env.VAD_EAGERNESS || 'auto',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        voice: process.env.REALTIME_VOICE || 'marin',
      },
    },
    instructions: PROMPT,
  };

  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(session));

  const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  const answer = await upstream.text();
  if (!upstream.ok) {
    send(res, upstream.status, answer, upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    return;
  }
  send(res, 200, answer, 'application/sdp');
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    signals: {
      type: 'object',
      properties: {
        sequence: { type: 'boolean' },
        trigger_identity: { type: 'boolean' },
        participants: { type: 'boolean' },
        actions: { type: 'boolean' },
        timing: { type: 'boolean' },
        outputs: { type: 'boolean' },
        communication: { type: 'boolean' },
        judgment: { type: 'boolean' },
        case_development: { type: 'boolean' },
        client_development: { type: 'boolean' },
        oversight: { type: 'boolean' },
        completion: { type: 'boolean' },
        exceptions: { type: 'boolean' },
        next_event: { type: 'boolean' },
      },
      required: ['sequence', 'trigger_identity', 'participants', 'actions', 'timing', 'outputs', 'communication', 'judgment', 'case_development', 'client_development', 'oversight', 'completion', 'exceptions', 'next_event'],
      additionalProperties: false,
    },
    corrections: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
    case_development_leads: { type: 'array', items: { type: 'string' } },
    client_development_leads: { type: 'array', items: { type: 'string' } },
    atomic_trigger_ids: { type: 'array', items: { type: 'string' } },
    reusable_defaults: { type: 'array', items: { type: 'string' } },
    expert_moves: { type: 'array', items: { type: 'string' } },
    completion_evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['signals', 'corrections', 'open_questions', 'case_development_leads', 'client_development_leads', 'atomic_trigger_ids', 'reusable_defaults', 'expert_moves', 'completion_evidence'],
  additionalProperties: false,
};

function findFamily(familyId) {
  return ATLAS.families.find((f) => f.family_id === familyId) || null;
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const pieces = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') pieces.push(part.text);
    }
  }
  return pieces.join('');
}

async function extractTurn(req, res) {
  if (!requireApiKey(res)) return;
  const payload = parseJsonBuffer(await readBody(req, 2_000_000));
  if (!payload) {
    json(res, 400, { error: 'Invalid JSON request.' });
    return;
  }

  const family = findFamily(String(payload.family_id || ''));
  if (!family || typeof payload.answer !== 'string') {
    json(res, 400, { error: 'family_id and answer are required.' });
    return;
  }

  const system = [
    'You extract Jack Law practice knowledge from one interview answer.',
    'Return only facts stated or strongly and unambiguously implied by the answer.',
    'Do not invent legal rules, firm procedures, dates, calendar language, documents, or strategy.',
    'Treat prior material as provisional context, not as confirmed fact.',
    'A correction is something that contradicts or modifies the provisional baseline.',
    'An open question must be consequential and not already answered.',
    'Case-development leads strengthen evidence, damages, witnesses, themes, leverage, or value.',
    'Client-development leads concern referrals, family/coworker prospects, community, UGC, advocacy, charity, work, or deeper collaboration; merely tag them.',
    'Use empty arrays when no supported item exists.',
  ].join('\n');

  const user = JSON.stringify({
    family: {
      family_id: family.family_id,
      title: family.title,
      expected_triggers: family.expected_triggers,
      provisional_summary: family.prior_summary,
      provisional_rules: family.prior_rules,
      provisional_actions: family.prior_actions,
    },
    question: payload.question || '',
    answer: payload.answer,
    current_family_state: payload.current_family_state || {},
  });

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.EXTRACTION_MODEL || 'gpt-5-mini',
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'eleanor_v3_turn_patch',
          description: 'A conservative structured patch extracted from one Jack Law interview answer.',
          strict: true,
          schema: EXTRACTION_SCHEMA,
        },
      },
    }),
  });

  const response = await upstream.json().catch(() => null);
  if (!upstream.ok || !response) {
    json(res, upstream.status || 502, response || { error: 'The extraction request failed.' });
    return;
  }

  try {
    const parsed = JSON.parse(extractOutputText(response));
    json(res, 200, parsed);
  } catch {
    json(res, 502, { error: 'The extraction response could not be parsed.', response_id: response.id || null });
  }
}

async function saveSession(req, res) {
  const payload = parseJsonBuffer(await readBody(req));
  if (!payload || typeof payload !== 'object') {
    json(res, 400, { error: 'A JSON session payload is required.' });
    return;
  }
  const id = safeSessionId(payload.session_id || payload.session_state?.session_id);
  const record = {
    session_id: id,
    version: '3.1.0-live',
    updated_at: new Date().toISOString(),
    created_at: payload.created_at || new Date().toISOString(),
    session_state: payload.session_state || payload.state || payload,
    expertise_ledger: payload.expertise_ledger || null,
  };
  record.session_state.session_id = id;
  await atomicWriteJson(sessionPath(id), record);
  json(res, 200, { ok: true, session_id: id, updated_at: record.updated_at });
}

async function getSession(_req, res, id) {
  const safe = safeSessionId(id);
  try {
    const text = await readFile(sessionPath(safe), 'utf8');
    json(res, 200, JSON.parse(text));
  } catch {
    json(res, 404, { error: 'Session not found.' });
  }
}

async function listSessions(_req, res) {
  const files = (await readdir(STORAGE_DIR)).filter((name) => name.endsWith('.json'));
  const items = [];
  for (const name of files) {
    try {
      const text = await readFile(join(STORAGE_DIR, name), 'utf8');
      const record = JSON.parse(text);
      items.push({
        session_id: record.session_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
        round: record.session_state?.round || null,
        current_family_index: record.session_state?.currentFamilyIndex ?? null,
        turns: Array.isArray(record.session_state?.turns) ? record.session_state.turns.length : 0,
      });
    } catch {
      // Ignore a damaged file rather than failing the list.
    }
  }
  items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  json(res, 200, { sessions: items });
}

async function deleteSession(_req, res, id) {
  try {
    await unlink(sessionPath(id));
    json(res, 200, { ok: true });
  } catch {
    json(res, 404, { error: 'Session not found.' });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let filePath = normalize(join(ROOT, decodeURIComponent(requested)));
  if (!filePath.startsWith(ROOT) || filePath.startsWith(STORAGE_DIR)) {
    send(res, 403, 'Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, securityHeaders(type));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      challenge(res);
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/health') {
      await health(req, res);
      return;
    }
    if (req.method === 'POST' && (path === '/api/realtime/session' || path === '/session')) {
      await createRealtimeSession(req, res);
      return;
    }
    if (req.method === 'POST' && (path === '/api/extract' || path === '/extract')) {
      await extractTurn(req, res);
      return;
    }
    if (req.method === 'POST' && path === '/api/sessions') {
      await saveSession(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/api/sessions') {
      await listSessions(req, res);
      return;
    }
    const sessionMatch = path.match(/^\/api\/sessions\/([A-Za-z0-9_-]{8,100})$/);
    if (sessionMatch && req.method === 'GET') {
      await getSession(req, res, sessionMatch[1]);
      return;
    }
    if (sessionMatch && req.method === 'DELETE') {
      await deleteSession(req, res, sessionMatch[1]);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, path);
      return;
    }
    send(res, 405, 'Method not allowed');
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      json(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Eleanor v3 Live is available at http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? 'Realtime voice and structured extraction are enabled.' : 'OPENAI_API_KEY is missing; add it to .env and restart.');
  console.log(`Persistent sessions are stored in ${STORAGE_DIR}`);
  if (authEnabled()) console.log('Basic authentication is enabled.');
});
