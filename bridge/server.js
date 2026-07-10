// bridge/server.js — HTTP polling based bridge
// Supports both Chrome and Firefox extensions simultaneously.
//
// Architecture:
//   /poll/chrome  — Chrome extension polls for commands
//   /poll/firefox — Firefox extension polls for commands
//   /result       — Extensions post results here
//   /cmd          — Hermes/CLI sends commands here (POST)
//   /status       — Health check
//   /debug        — Debug: show internal state
//
// Each browser type gets its own command queue and result store.

const http = require('http');

const PORT = 18923;

// Per-browser state: { command, commandReady, lastResult }
const browsers = {
  chrome:  { command: null, commandReady: false, lastResult: null },
  firefox: { command: null, commandReady: false, lastResult: null }
};

// Request counter for debugging
let requestCount = 0;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('invalid JSON: ' + body));
      }
    });
  });
}

function jsonResponse(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const reqId = ++requestCount;
  const ts = new Date().toISOString();

  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.end(); return; }

  const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  try {
    // ── Extension polling: /poll/chrome or /poll/firefox ───────────
    if (req.method === 'GET' && /^\/poll\/(chrome|firefox)$/.test(pathname)) {
      const browserType = pathname.split('/')[2];
      const state = browsers[browserType];
      const hasCmd = state.commandReady && state.command !== null;
      console.log(`[${reqId}] ${ts} GET /poll/${browserType} → hasCommand=${hasCmd} cmd=${hasCmd ? state.command.action : 'null'}`);
      if (hasCmd) {
        const cmd = state.command;
        state.command = null;
        state.commandReady = false;
        console.log(`[${reqId}] → dispatched ${cmd.action} to ${browserType}`);
        return jsonResponse(res, cmd);
      } else {
        return jsonResponse(res, { action: 'noop' });
      }
    }

    // ── Legacy polling: /poll (backward compat, defaults to chrome) ─
    if (req.method === 'GET' && pathname === '/poll') {
      const state = browsers.chrome;
      const hasCmd = state.commandReady && state.command !== null;
      if (hasCmd) {
        const cmd = state.command;
        state.command = null;
        state.commandReady = false;
        return jsonResponse(res, cmd);
      } else {
        return jsonResponse(res, { action: 'noop' });
      }
    }

    // ── Extension posts result: POST /result ──────────────────────
    if (req.method === 'POST' && pathname === '/result') {
      const data = await parseBody(req);
      const browserType = data.browser || 'chrome';
      console.log(`[${reqId}] ${ts} POST /result from ${browserType}: ${JSON.stringify(data).substring(0, 100)}`);
      if (browsers[browserType]) {
        browsers[browserType].lastResult = data;
      }
      return jsonResponse(res, { ok: true });
    }

    // ── Hermes reads result: GET /result?browser=firefox ──────────
    if (req.method === 'GET' && pathname === '/result') {
      const browserType = query.browser || 'chrome';
      const state = browsers[browserType];
      if (state && state.lastResult) {
        const r = state.lastResult;
        state.lastResult = null;
        return jsonResponse(res, r);
      } else {
        return jsonResponse(res, { waiting: true });
      }
    }

    // ── Hermes sends command: POST /cmd ───────────────────────────
    if (req.method === 'POST' && pathname === '/cmd') {
      const data = await parseBody(req);
      const browserType = data.browser || query.browser || 'chrome';
      if (!browsers[browserType]) {
        return jsonResponse(res, { error: `unknown browser: ${browserType}` }, 400);
      }
      const state = browsers[browserType];
      state.command = data;
      state.commandReady = true;
      state.lastResult = null;
      console.log(`[${reqId}] ${ts} POST /cmd → ${browserType}: queued ${data.action} (commandReady=${state.commandReady})`);
      return jsonResponse(res, { ok: true, queued: true, browser: browserType });
    }

    // ── Health check: GET /status ─────────────────────────────────
    if (req.method === 'GET' && pathname === '/status') {
      const status = {};
      for (const [name, state] of Object.entries(browsers)) {
        status[name] = {
          hasCommand: state.commandReady,
          pending: !!state.command,
          hasResult: !!state.lastResult
        };
      }
      return jsonResponse(res, { status: 'ok', browsers: status });
    }

    // ── Debug: show internal state ────────────────────────────────
    if (req.method === 'GET' && pathname === '/debug') {
      return jsonResponse(res, {
        browsers: {
          chrome: { ...browsers.chrome, command: browsers.chrome.command ? { action: browsers.chrome.command.action } : null },
          firefox: { ...browsers.firefox, command: browsers.firefox.command ? { action: browsers.firefox.command.action } : null }
        },
        requestCount
      });
    }

    // ── 404 ───────────────────────────────────────────────────────
    jsonResponse(res, { error: 'not found' }, 404);

  } catch (e) {
    console.error(`[${reqId}] error:`, e.message);
    jsonResponse(res, { error: e.message }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] HTTP polling server on http://127.0.0.1:${PORT}`);
  console.log('[bridge] Endpoints:');
  console.log('  GET  /poll/chrome   — Chrome extension polls for commands');
  console.log('  GET  /poll/firefox  — Firefox extension polls for commands');
  console.log('  POST /result        — Extensions post results');
  console.log('  GET  /result        — Hermes reads last result');
  console.log('  POST /cmd           — Hermes sends commands');
  console.log('  GET  /status        — Health check');
  console.log('  GET  /debug         — Debug state');
});
