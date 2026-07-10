// background.js — Chrome MV3 service worker
// HTTP polling bridge client for full browser remote control
//
// Supported commands:
//   Tab Management: list_tabs, switch_tab, open_tab, close_tab
//   Navigation:     navigate, go_back, go_forward, refresh
//   Page Interaction: scroll, get_text, get_url, get_title, check_login
//   Content Extraction: extract_jobs, eval_js, page_info
//   Health: ping

const BRIDGE = 'http://127.0.0.1:18923';
const BROWSER_TYPE = 'chrome';
const POLL_INTERVAL_MS = 600;
let busy = false;

// ── Polling ──────────────────────────────────────────────────────────
async function poll() {
  try {
    const resp = await fetch(`${BRIDGE}/poll/${BROWSER_TYPE}`);
    const cmd = await resp.json();
    if (cmd && cmd.action && cmd.action !== 'noop' && !busy) {
      busy = true;
      try {
        const result = await execute(cmd);
        await fetch(`${BRIDGE}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser: BROWSER_TYPE, ...result })
        });
      } catch (e) {
        await fetch(`${BRIDGE}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser: BROWSER_TYPE, error: e.message })
        });
      }
      busy = false;
    }
  } catch (e) {
    // Bridge offline — silent retry
  }
  setTimeout(poll, POLL_INTERVAL_MS);
}

// Chrome alarms for keep-alive (MV3 service workers sleep after ~30s idle)
chrome.alarms.create('poll', { periodInMinutes: 0.02 }); // ~1.2s
chrome.alarms.onAlarm.addListener(() => poll());
poll();

// ── Helpers ──────────────────────────────────────────────────────────

/** Execute JS via CDP Runtime.evaluate — bypasses all CSP */
async function cdpEval(tabId, expression) {
  // Detach first to avoid stale connections
  try { await chrome.debugger.detach({ tabId }); } catch(e) {}
  await chrome.debugger.attach({ tabId }, '1.3');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { chrome.debugger.detach({ tabId }); } catch(e) {}
      reject(new Error('CDP timeout'));
    }, 10000);

    const listener = (source, method, params) => {
      if (source.tabId === tabId && method === 'Runtime.evaluate') {
        clearTimeout(timeout);
        chrome.debugger.onDetach.removeListener(listener);
        const val = params?.result?.value ?? params?.result?.description ?? '';
        resolve(val);
      }
    };
    chrome.debugger.onDetach.addListener(listener);

    chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }).catch(e => { clearTimeout(timeout); reject(e); });
  });
}

/** Get the active tab in the current window */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Execute a function in the page's MAIN world (bypasses CSP).
 * Optionally passes arguments to the function.
 */
async function execInPage(func, tab, args = []) {
  if (!tab) throw new Error('no active tab');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    world: 'MAIN',
    func,
    args
  });
  return results?.[0]?.result;
}

// ── Command dispatcher ───────────────────────────────────────────────
async function execute(cmd) {
  const { action } = cmd;

  // ── Health ───────────────────────────────────────────────────────
  if (action === 'ping') {
    return { ok: true, browser: BROWSER_TYPE, version: '2.0' };
  }

  // ── Tab Management ───────────────────────────────────────────────
  if (action === 'list_tabs') {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return {
      tabs: tabs.map(t => ({
        id: t.id,
        title: t.title || '',
        url: t.url || '',
        active: t.active,
        pinned: t.pinned
      }))
    };
  }

  if (action === 'switch_tab') {
    const tabId = parseInt(cmd.id, 10);
    if (isNaN(tabId)) return { error: 'invalid tab id' };
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true, tabId };
  }

  if (action === 'open_tab') {
    if (!cmd.url) return { error: 'missing url' };
    const tab = await chrome.tabs.create({ url: cmd.url, active: cmd.active !== false });
    return { ok: true, tabId: tab.id, url: tab.url };
  }

  if (action === 'close_tab') {
    const tabId = parseInt(cmd.id, 10);
    if (isNaN(tabId)) return { error: 'invalid tab id' };
    await chrome.tabs.remove(tabId);
    return { ok: true, tabId };
  }

  // ── Navigation ───────────────────────────────────────────────────
  if (action === 'navigate') {
    if (!cmd.url) return { error: 'missing url' };
    const tab = await getActiveTab();
    if (!tab) return { error: 'no active tab' };
    await chrome.tabs.update(tab.id, { url: cmd.url });
    await new Promise(r => setTimeout(r, 3000));
    return { ok: true, url: cmd.url };
  }

  if (action === 'go_back') {
    const tab = await getActiveTab();
    if (!tab) return { error: 'no active tab' };
    await chrome.tabs.goBack(tab.id);
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true };
  }

  if (action === 'go_forward') {
    const tab = await getActiveTab();
    if (!tab) return { error: 'no active tab' };
    await chrome.tabs.goForward(tab.id);
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true };
  }

  if (action === 'refresh') {
    const tab = await getActiveTab();
    if (!tab) return { error: 'no active tab' };
    await chrome.tabs.reload(tab.id);
    await new Promise(r => setTimeout(r, 2000));
    return { ok: true };
  }

  // ── Page Interaction ─────────────────────────────────────────────
  if (action === 'scroll') {
    const direction = cmd.direction || 'down';
    const amount = parseInt(cmd.amount, 10) || 500;
    const tab = await getActiveTab();
    await execInPage((dir, amt) => {
      switch (dir) {
        case 'down':  window.scrollBy(0, amt); break;
        case 'up':    window.scrollBy(0, -amt); break;
        case 'right': window.scrollBy(amt, 0); break;
        case 'left':  window.scrollBy(-amt, 0); break;
      }
      return { scrollY: window.scrollY, scrollX: window.scrollX };
    }, tab, [direction, amount]);
    return { ok: true, direction, amount };
  }

  if (action === 'get_text') {
    try {
      const tab = await getActiveTab();
      const text = await execInPage(() => document.body?.innerText || '', tab);
      return { text: text || '' };
    } catch (e) {
      return { text: '', error: e.message };
    }
  }

  if (action === 'get_url') {
    const tab = await getActiveTab();
    return { url: tab?.url || '', title: tab?.title || '' };
  }

  if (action === 'get_title') {
    try {
      const tab = await getActiveTab();
      const title = await execInPage(() => document.title, tab);
      return { title: title || '' };
    } catch (e) {
      return { title: '', error: e.message };
    }
  }

  if (action === 'check_login') {
    try {
      const tab = await getActiveTab();
      const info = await execInPage(() => {
        const loginBtn = document.querySelector(
          '.btn-signin, [class*="login-btn"], .nav-login, ' +
          'a[href*="login"], [class*="sign-in"]'
        );
        const userEl = document.querySelector(
          '.user-nav .label-text, [class*="user-name"], ' +
          '.nav-figure img, [class*="avatar"], [class*="username"]'
        );
        // BOSS直聘 specific selectors
        const bossLogin = document.querySelector(
          '.header-login-btn, .nologin, [class*="login-btn"]'
        );
        const bossUser = document.querySelector(
          '.user-nav, [class*="user-nav"], .nav-figure'
        );
        return {
          hasLogin: !!(loginBtn || bossLogin),
          hasUser: !!(userEl || bossUser),
          url: location.href,
          title: document.title
        };
      }, tab);
      return info || {};
    } catch (e) {
      return { error: e.message };
    }
  }

  // ── Content Extraction ───────────────────────────────────────────
  if (action === 'extract_jobs') {
    try {
      const tab = await getActiveTab();
      const jobs = await execInPage(() => {
        const results = [];
        // Multiple selector strategies for BOSS直聘
        const cards = document.querySelectorAll(
          '.job-card-wrapper, [class*="job-card-box"], ' +
          '[ka*="search_list_job"], .job-list-box .job-card-wrapper, ' +
          '[class*="search-job-result"] li'
        );
        cards.forEach(card => {
          const title = card.querySelector(
            '.job-name, [class*="job-name"], a[title]'
          )?.textContent?.trim() ||
            card.querySelector('a[title]')?.getAttribute('title') || '';
          const company = card.querySelector(
            '.company-name, [class*="company-name"], .company-text a'
          )?.textContent?.trim() || '';
          const salary = card.querySelector(
            '.salary, .job-limit .red, [class*="salary"], span.salary'
          )?.textContent?.trim() || '';
          const area = card.querySelector(
            '.job-area, [class*="job-area"], .job-area-wrapper span'
          )?.textContent?.trim() || '';
          const tags = [...(card.querySelectorAll(
            '.job-info .tag-list li, .tag-list span, [class*="tags"] span'
          ) || [])].map(t => t.textContent.trim()).filter(Boolean);
          const link = card.querySelector('a')?.href || '';
          const experience = card.querySelector(
            '.job-info .tag-list li:nth-child(1), [class*="experience"]'
          )?.textContent?.trim() || '';
          const education = card.querySelector(
            '.job-info .tag-list li:nth-child(2), [class*="education"]'
          )?.textContent?.trim() || '';
          if (title || company) {
            results.push({
              title, company, salary, area, tags,
              experience, education, link
            });
          }
        });
        return results;
      }, tab);
      return { jobs: jobs || [], count: (jobs || []).length };
    } catch (e) {
      return { jobs: [], error: e.message };
    }
  }

  if (action === 'eval_js') {
    try {
      if (!cmd.code) return { error: 'missing code' };
      const tab = await getActiveTab();
      if (!tab) return { error: 'no active tab' };

      // Try CDP first (bypasses CSP)
      try {
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch(e) {}
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');

        const cdpResult = await Promise.race([
          new Promise((resolve, reject) => {
            chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', {
              expression: cmd.code, returnByValue: true, awaitPromise: true
            }).then(r => resolve(r?.result?.value ?? r?.result?.description ?? ''))
              .catch(reject);
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('cdp_timeout')), 3000))
        ]);

        try { await chrome.debugger.detach({ tabId: tab.id }); } catch(e) {}
        return { result: cdpResult, method: 'cdp' };

      } catch (cdpErr) {
        // CDP failed — fall back to execInPage (may not work if code uses eval)
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch(e) {}
        try {
          const fallbackResult = await execInPage((code) => {
            try { return String(Function('return ' + code)()); }
            catch(e) { return 'ERR:' + e.message + ' (use cdp for eval)'; }
          }, tab, [cmd.code]);
          return { result: fallbackResult, method: 'execInPage' };
        } catch (e2) {
          return { error: `CDP failed: ${cdpErr.message}, fallback failed: ${e2.message}` };
        }
      }
    } catch (e) {
      return { error: e.message };
    }
  }

  if (action === 'page_info') {
    try {
      const tab = await getActiveTab();
      const info = await execInPage(() => ({
        title: document.title,
        url: location.href,
        bodyLen: document.body?.innerText?.length || 0,
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        bodySnippet: (document.body?.innerText || '').substring(0, 500)
      }), tab);
      return info || {};
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: `unknown action: ${action}` };
}
