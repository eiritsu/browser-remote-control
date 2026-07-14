---
name: browser-remote-control
description: |
  Control the user's REAL Chrome/Firefox browser via extension + HTTP bridge + cli.sh.
  USE THIS when user asks to open/navigate/interact with their actual browser, logged-in sessions,
  or says "在浏览器里", "帮我看看浏览器", "打开Chrome".
  DO NOT use for fetching URLs (use web_extract) or headless inspection (use browser_* tools).
  Trigger on: "open Chrome", "control browser", "browser remote", "在浏览器里", "浏览器打开",
  "帮我看看浏览器", "cli.sh", "CDP", "debugger protocol", "bridge server", "CSP bypass".
version: 1.3.0
platforms: [macos, windows, linux]
metadata:
  hermes:
    tags: [browser-extension, chrome-mv3, firefox-mv2, remote-control, http-bridge]
    category: software-development
    related_skills: [computer-use]
---

# Browser Remote Control — Agent Execution Guide

## ⚠️ Web Tool Routing (read FIRST)

Hermes has 4 ways to access web content. Choose the simplest one that works:

| Need | Tool | Example |
|------|------|---------|
| Find information | `web_search` | "搜索XX的最新价格" |
| Read a public page's content | `web_extract` | "看看这个链接的内容" |
| Click/fill/interact with a page (no login needed) | Built-in `browser_*` | "帮我在这个页面点XX按钮" |
| Control user's real browser (login, cookies, visible tabs) | `cli.sh` | "在浏览器里打开XX", "帮我看看Chrome" |

**Decision flow**:
1. Just need info? → `web_search`
2. Need content from a specific URL? → `web_extract`
3. Need to click/fill forms but no login state needed? → `browser_*` (headless)
4. Need user's real browser / logged-in session / user must see the page? → `cli.sh`

**Key rule**: If user says "浏览器" or needs their actual browser → `cli.sh`.
If just fetching content → `web_extract` (uses Firecrawl under the hood, handles JS-rendered pages).
Never use `browser_navigate` to "open a page for the user" — it's a headless session they can't see.

## Decision Tree (read this FIRST)

When user asks about browser remote control, follow this tree:

1. **User wants to USE an existing setup** → Check if bridge is running (`curl -s http://127.0.0.1:18923/status`). If yes, use CLI commands (see §CLI). If no, start it first (see §Quick Start).
2. **User wants to BUILD/SETUP from scratch** → Follow §Quick Start. Create project, write code, load extension.
3. **User wants to FIX something** → Check §Debugging first, then diagnose.
4. **User asks a conceptual question** → Answer from relevant sections below, don't dump the whole skill.

**Always verify before acting**: Don't assume bridge is running or extension is loaded. Check first.

**ALWAYS use `cli.sh`**: Never build raw `curl` commands when `cli.sh` exists. The CLI handles payload construction, polling, and timeout. Use `./cli.sh <command>` from the skill directory. Only fall back to raw curl if `cli.sh` itself is broken.

## Hermes Agent Usage Pattern (critical)

When using this skill from Hermes, follow this exact sequence:

### 1. Start bridge as a long-lived background process
```bash
# WRONG — foreground terminal gets killed, bridge dies mid-session
terminal("cd bridge && node server.js")

# CORRECT — background=true keeps it alive for the whole session
terminal("cd /path/to/bridge && node server.js", background=true, notify_on_complete=false)
```
Bridge is a long-lived server (never exits on its own). Use `background=true` WITHOUT `notify_on_complete`. Poll with `process(action='poll')` if you need to check it's alive.

### 2. Use cli.sh for ALL operations
```bash
# Run from the skill directory
cd /Users/y/.hermes/skills/software-development/browser-remote-control
./cli.sh list-tabs
./cli.sh get-text
./cli.sh navigate "https://example.com"
```
Do NOT mix bridge server output and CLI output in the same terminal. They must be separate sessions.

### 3. Verify bridge before first command
```bash
curl -s http://127.0.0.1:18923/status
# Expected: {"status":"ok","browsers":{"chrome":{...},"firefox":{...}}}
```
If bridge is down, restart it (step 1). If extension is not polling, the `GET /poll/chrome` lines won't appear in bridge logs.

## Quick Start (step by step)

Execute these steps IN ORDER. Do not skip steps.

### Step 1: Create project directory
```bash
mkdir -p ~/Desktop/browser-remote-control/{extension-chrome,extension-firefox,bridge}
cd ~/Desktop/browser-remote-control
```

### Step 2: Write bridge server
Write `bridge/server.js` — a Node.js HTTP server on port 18923. Key requirements:
- Per-browser endpoints: `/poll/chrome`, `/poll/firefox` (each browser gets its own command queue)
- `/poll` defaults to chrome (backward compat)
- `/cmd?browser=chrome` POST — accepts JSON body with `action` field
- `/result?browser=chrome` GET — returns last result
- `/result` POST — extension posts results here
- `/status` GET — health check
- `/debug` GET — show internal state
- All responses: `Access-Control-Allow-Origin: *`
- Use `new URL(req.url, base)` NOT deprecated `url.parse()`
- No dependencies — Node.js stdlib only (`http`, `url`)
- State per browser: `{ command: null, commandReady: false, lastResult: null }`

### Step 3: Write Chrome MV3 extension
Files needed: `manifest.json`, `background.js`, `content.js`

**manifest.json**:
```json
{
  "manifest_version": 3,
  "name": "Remote Control",
  "permissions": ["activeTab", "scripting", "tabs", "alarms", "storage", "debugger"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"] }]
}
```

**background.js** — MUST implement:
- Polling loop: fetch `/poll/chrome` every 600ms via `setTimeout` (NOT `setInterval`)
- Keep-alive: `chrome.alarms.create('poll', { periodInMinutes: 0.02 })` + alarm listener triggers poll
- `execInPage(func, tab, args)`: uses `chrome.scripting.executeScript` with `world: 'MAIN'` and passes `args` array
- Command dispatcher: switch on `cmd.action` — `list_tabs`, `switch_tab`, `open_tab`, `close_tab`, `navigate`, `scroll`, `get_text`, `get_url`, `get_title`, `eval_js`, `page_info`, `ping`
- `eval_js` action: MUST use CDP fallback (see §eval_js CDP pattern)
- Post result back to bridge: `fetch(BRIDGE + '/result', { method: 'POST', body: JSON.stringify({browser:'chrome', ...result}) })`

**content.js**: Minimal — handles messages from background if needed.

### Step 4: Write Firefox MV2 extension
Same commands as Chrome, key differences:
- `manifest_version: 2`, requires `browser_specific_settings.gecko.id`
- Background: `"scripts": ["background.js"], "persistent": false`
- Use `browser.*` API (promise-based), NOT `chrome.*`
- No `chrome.scripting` — use `browser.tabs.executeScript` with serialized function string:
  ```javascript
  code: `(${func.toString()}).apply(null, ${JSON.stringify(args)})`
  ```

### Step 5: Write CLI wrapper (`cli.sh`)
```bash
#!/usr/bin/env bash
BRIDGE="${BRIDGE_URL:-http://127.0.0.1:18923}"
# Usage: ./cli.sh <action> [args...] [browser]
# Default browser: chrome
# Commands: ping, list-tabs, navigate <url>, switch-tab <id>, open-tab <url>,
#           close-tab <id>, scroll <up|down> [amount], get-text, get-url, get-title,
#           eval-js <code>, page-info
```
Pattern: POST to `/cmd?browser=$browser` → poll `/result?browser=$browser` until not `waiting:true` (timeout 15s, poll every 500ms).

### Step 6: Start and verify
```bash
cd bridge && node server.js &    # Start bridge
curl -s http://127.0.0.1:18923/status   # Should return {status:"ok"}
# Load extension in Chrome: chrome://extensions → Developer mode → Load unpacked → select extension-chrome/
# Then: ../cli.sh ping   # Should return {pong: true}
```

## eval_js CDP Pattern (critical)

When `eval_js` receives arbitrary user code, `execInPage` with `eval()` or `new Function()` WILL fail on CSP-strict sites (GitHub, BOSS直聘, banking). Use this pattern:

```javascript
// In background.js, for eval_js action:
async function handleEvalJs(code, tab) {
  // Try CDP first (bypasses ALL CSP)
  try {
    // Detach first to clean up any stale debugger connections
    try { await chrome.debugger.detach({ tabId: tab.id }); } catch(e) {}
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');

    const cdpResult = await Promise.race([
      chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', {
        expression: code, returnByValue: true, awaitPromise: true
      }).then(r => r?.result?.value ?? r?.result?.description ?? ''),
      new Promise((_, rej) => setTimeout(() => rej(new Error('cdp_timeout')), 3000))
    ]);
    try { await chrome.debugger.detach({ tabId: tab.id }); } catch(e) {}
    return { result: cdpResult, method: 'cdp' };
  } catch (cdpErr) {
    // CDP failed — fallback to execInPage (won't work if code uses eval)
    try { await chrome.debugger.detach({ tabId: tab.id }); } catch(e) {}
    try {
      const fallback = await execInPage((code) => {
        try { return String(Function('return ' + code)()); }
        catch(e) { return 'ERR:' + e.message + ' (use cdp for eval)'; }
      }, tab, [code]);
      return { result: fallback, method: 'execInPage' };
    } catch (e2) {
      return { error: `CDP failed: ${cdpErr.message}, fallback failed: ${e2.message}` };
    }
  }
}
```

### CDP Pitfall: `sendCommand` returns a Promise, NOT an event

The `cdpEval` helper MUST use `await sendCommand().then()` — NOT `chrome.debugger.onDetach` event listener. `Runtime.evaluate` is a CDP **command** that returns a result via the Promise, not an event that fires. The old pattern with `onDetach.addListener` hangs forever because the event never fires.

**WRONG** (hangs):
```javascript
// Runtime.evaluate is a command, not an event — this never fires
chrome.debugger.onDetach.addListener((source, method, params) => {
  if (method === 'Runtime.evaluate') { resolve(params.result.value); }
});
chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { ... });
```

**CORRECT**:
```javascript
const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
  expression, returnByValue: true, awaitPromise: true
});
return result?.result?.value ?? result?.result?.description ?? '';
```

### CDP Pitfall: multi-line code strings timeout

When passing code via `cli.sh eval-js`, shell quoting may break multi-line strings. Keep expressions short and single-line for reliability. Complex multi-line eval-js calls frequently timeout — prefer `get-text` for page content extraction.

**For non-eval code**: Always write dedicated handler functions per action. Never wrap user code in `eval()` when you can avoid it.

## CLI Commands Reference

| Command | Action | Args |
|---------|--------|------|
| `ping` | `ping` | — |
| `list-tabs` | `list_tabs` | — |
| `navigate <url>` | `navigate` | `url` |
| `switch-tab <id>` | `switch_tab` | `tabId` |
| `open-tab <url>` | `open_tab` | `url` |
| `close-tab <id>` | `close_tab` | `tabId` |
| `scroll <dir> [amt]` | `scroll` | `direction`, `amount` (default 500) |
| `get-text` | `get_text` | — |
| `get-url` | `get_url` | — |
| `get-title` | `get_title` | — |
| `eval-js <code>` | `eval_js` | `code` |
| `page-info` | `page_info` | — |

CLI syntax: `./cli.sh <command> [args...] [chrome|firefox]` (default browser: chrome)

## Architecture

```
Caller (CLI/Agent)  ──POST /cmd──▶  Bridge (Node.js:18923)  ◀──GET /poll──  Extension (Chrome/FF)
                  ◀──GET /result──                              ──POST /result──▶
```

- Bridge is a command queue: caller posts command, extension polls and executes, posts result back
- Each browser has independent state (command, commandReady, lastResult)
- Bridge uses only Node.js stdlib (http, url), no npm dependencies

## Chrome MV3 Key Patterns

- **Service worker** is not persistent — MUST use `chrome.alarms` keep-alive
- **CSP bypass**: `chrome.scripting.executeScript({ world: 'MAIN', func, args })` — `world:'MAIN'` runs in page context
- **Arguments**: Pass via `args` array, NOT by closing over variables (service worker may restart)
- **execInPage**: Always use direct function references, never `new Function(code)` or `eval()` (CSP blocks these even in MAIN world)

## Firefox MV2 Key Differences

- `browser.*` API (promise-based), not `chrome.*`
- No `chrome.scripting` — use `browser.tabs.executeScript` with serialized code string
- Function serialization: `code: \`(${func.toString()}).apply(null, ${JSON.stringify(args)})\``
- Requires `browser_specific_settings.gecko.id` in manifest

## Debugging

**Bridge not responding**: Check `curl http://127.0.0.1:18923/status`. If fails, start bridge: `cd bridge && node server.js`.

**Old extension consuming commands**: Check server logs for `← chrome: result received`. An old extension version may be polling `/poll` (legacy endpoint). Load the new extension.

**Chrome service worker dies after ~30s**: Missing `chrome.alarms` keep-alive. Add `chrome.alarms.create('poll', { periodInMinutes: 0.02 })`.

**CSP blocks eval on sites**: See §eval_js CDP Pattern. Must use CDP fallback for arbitrary code execution.

**Firefox executeScript error**: Functions must be serialized to strings. See §Firefox MV2 Key Differences.

**`url.parse()` deprecation**: Use `new URL(req.url, base)` instead.

**`cdpEval` hangs forever / times out**: The extension's `cdpEval` function MUST use `await sendCommand().then()` to get the result. Using `chrome.debugger.onDetach.addListener` to listen for `Runtime.evaluate` events hangs forever because `Runtime.evaluate` is a CDP command (returns via Promise), not an event. If the extension code uses the event-listener pattern, fix it to use direct Promise resolution. See the SKILL.md CDP Pitfall section for the correct pattern.

## Pitfalls

### Bridge server dying mid-session

**Symptom**: `cli.sh` commands return `"error": "timeout waiting for response"` or `curl: (7) Failed to connect`. Bridge was working earlier but stopped.

**Cause**: Bridge was started in a foreground `terminal()` call that got cleaned up by the session lifecycle. The `node server.js` process exits when its parent terminal session closes.

**Fix**: Always start bridge as a long-lived background process:
```bash
# ✅ CORRECT — stays alive for entire session
terminal("cd /path/to/bridge && node server.js", background=true, notify_on_complete=false)
```
Never use `notify_on_complete=true` for the bridge — it never exits on its own, so the notification would never fire. Use `process(action='poll')` to check if it's still running.

### eval-js complex expressions timeout

Short one-liners work reliably via CDP. Multi-line expressions with loops, `filter()`, `map()`, or `join()` frequently timeout (>15s) due to CDP overhead + shell quoting issues. Use `get-text` for bulk content extraction instead. See `references/github-cdom-limitations.md` for details.

### GitHub React components resist CDOM manipulation

GitHub's dropdowns, selects, and toggle buttons are React custom components, NOT native HTML elements. `document.querySelector('select')` returns 0 elements. Changing values via `select.value` or dispatching native events has no effect. These must be done manually by the user.

## References

- `references/react-form-automation.md` — React/SPA表单自动化（CDP eval_js + nativeInputValueSetter）
- `references/bosszhipin-selectors.md` — BOSS直聘页面元素选择器
- `references/cua-driver-cli-fallback.md` — cua-driver CLI备用方案
