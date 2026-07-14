---
name: browser-remote-control
description: |
  Build browser remote control systems — Chrome/Firefox extensions + HTTP bridge server + CLI wrapper.
  Covers Chrome MV3 (service_worker, chrome.scripting.executeScript with world:'MAIN' for CSP bypass),
  Firefox MV2 (background scripts, browser.* API, function serialization), HTTP polling bridge architecture
  (per-browser endpoints, command queuing), and CLI wrappers with result polling.
  Trigger on: "browser extension", "remote control browser", "Chrome extension", "Firefox addon",
  "browser automation extension", "CSP bypass", "executeScript MAIN world", "bridge server for extension",
  "control browser from CLI", "browser remote control system".
  NOT for: driving the desktop GUI (use computer-use), headless browser automation (use browser tools),
  Selenium/Playwright automation (different class).
version: 1.1.0
platforms: [macos, windows, linux]
metadata:
  hermes:
    tags: [browser-extension, chrome-mv3, firefox-mv2, remote-control, http-bridge]
    category: software-development
    related_skills: [computer-use]
---

# Browser Remote Control — Agent Execution Guide

## Decision Tree (read this FIRST)

When user asks about browser remote control, follow this tree:

1. **User wants to USE an existing setup** → Check if bridge is running (`curl -s http://127.0.0.1:18923/status`). If yes, use CLI commands (see §CLI). If no, start it first (see §Quick Start).
2. **User wants to BUILD/SETUP from scratch** → Follow §Quick Start. Create project, write code, load extension.
3. **User wants to FIX something** → Check §Debugging first, then diagnose.
4. **User asks a conceptual question** → Answer from relevant sections below, don't dump the whole skill.

**Always verify before acting**: Don't assume bridge is running or extension is loaded. Check first.

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
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    const cdpResult = await Promise.race([
      chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', {
        expression: code, returnByValue: true, awaitPromise: true
      }).then(r => r?.result?.value),
      new Promise((_, rej) => setTimeout(() => rej(new Error('cdp_timeout')), 3000))
    ]);
    await chrome.debugger.detach({ tabId: tab.id });
    return { result: cdpResult, method: 'cdp' };
  } catch {
    // CDP failed — fallback to execInPage (won't work if code uses eval)
    const fallback = await execInPage((c) => { try { return eval(c); } catch(e) { return {error: e.message}; } }, tab, [code]);
    return { result: fallback, method: 'execInPage' };
  }
}
```

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

## References

- `references/react-form-automation.md` — React/SPA表单自动化（CDP eval_js + nativeInputValueSetter）
- `references/bosszhipin-selectors.md` — BOSS直聘页面元素选择器
- `references/cua-driver-cli-fallback.md` — cua-driver CLI备用方案
