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
version: 1.0.0
platforms: [macos, windows, linux]
metadata:
  hermes:
    tags: [browser-extension, chrome-mv3, firefox-mv2, remote-control, http-bridge]
    category: software-development
    related_skills: [computer-use]
---

# Browser Remote Control System

Build systems that let an external process (CLI, AI agent, HTTP client) fully control Chrome and Firefox
through extensions + an HTTP bridge server.

## Architecture Overview

```
┌──────────────┐     POST /cmd        ┌──────────────┐     GET /poll/{browser}  ┌──────────────┐
│  Caller      │ ───────────────────▶ │  Bridge      │ ◀──────────────────────▶ │  Extension   │
│  (CLI/Agent) │     GET /result      │  (Node.js)   │     POST /result         │  (Chrome/FF) │
│              │ ◀──────────────────── │  port 18923  │ ──────────────────────▶  │              │
└──────────────┘                      └──────────────┘                          └──────────────┘
```

## Chrome MV3 Extension

### Key patterns
- **Service worker**: background.js runs as a service worker (not persistent)
- **Keep-alive**: Use `chrome.alarms` with `periodInMinutes: 0.02` (~1.2s) to prevent worker sleep
- **CSP bypass**: `chrome.scripting.executeScript` with `world: 'MAIN'` runs code in the page's main world, bypassing Content Security Policy
- **Permissions**: `activeTab`, `scripting`, `tabs`, `alarms`, `storage`, `<all_urls>` host permission

### Manifest V3 structure
```json
{
  "manifest_version": 3,
  "name": "Remote Control",
  "permissions": ["activeTab", "scripting", "tabs", "alarms", "storage"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"] }]
}
```

### execInPage with arguments
```javascript
async function execInPage(func, tab, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    world: 'MAIN',
    func,
    args  // ← arguments passed to the function
  });
  return results?.[0]?.result;
}

// Usage:
const result = await execInPage((dir, amt) => {
  window.scrollBy(dir === 'down' ? amt : -amt, 0);
  return { scrollY: window.scrollY };
}, tab, ['down', 500]);
```

### Polling pattern
```javascript
const BRIDGE = 'http://127.0.0.1:18923';
const BROWSER = 'chrome';

async function poll() {
  try {
    const resp = await fetch(`${BRIDGE}/poll/${BROWSER}`);
    const cmd = await resp.json();
    if (cmd.action && cmd.action !== 'noop') {
      const result = await execute(cmd);
      await fetch(`${BRIDGE}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser: BROWSER, ...result })
      });
    }
  } catch (e) { /* bridge offline */ }
  setTimeout(poll, 600);
}

chrome.alarms.create('poll', { periodInMinutes: 0.02 });
chrome.alarms.onAlarm.addListener(() => poll());
poll();
```

## Firefox MV2 Extension

### Key differences from Chrome MV3
- **Background scripts**: `"background": { "scripts": ["background.js"], "persistent": false }`
- **API namespace**: Use `browser.*` instead of `chrome.*` (promises-based)
- **No `chrome.scripting`**: Use `browser.tabs.executeScript` instead
- **Function serialization**: Must serialize functions as strings to pass arguments
- **Manifest**: Requires `browser_specific_settings.gecko.id`

### Manifest V2 structure
```json
{
  "manifest_version": 2,
  "name": "Remote Control",
  "browser_specific_settings": {
    "gecko": { "id": "remote-control@myext", "strict_min_version": "57.0" }
  },
  "permissions": ["activeTab", "tabs", "alarms", "storage", "<all_urls>"],
  "background": { "scripts": ["background.js"], "persistent": false }
}
```

### execInPage for Firefox (function serialization)
```javascript
async function execInPage(func, tab, args = []) {
  if (!tab) throw new Error('no active tab');
  const funcStr = func.toString();
  const results = await browser.tabs.executeScript(tab.id, {
    code: `(${funcStr}).apply(null, ${JSON.stringify(args)})`,
    runAt: 'document_idle'
  });
  return results?.[0];
}
```

## Bridge Server (Node.js)

### Design principles
- **Per-browser endpoints**: `/poll/chrome`, `/poll/firefox` — each browser gets its own command queue
- **Backward compat**: `/poll` defaults to chrome for old extensions
- **No dependencies**: Only Node.js stdlib (`http`, `url`)
- **CORS**: All responses include `Access-Control-Allow-Origin: *`

### Endpoint reference
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/poll/chrome` | GET | Chrome extension polls for commands |
| `/poll/firefox` | GET | Firefox extension polls for commands |
| `/cmd?browser=chrome` | POST | Send command (JSON body with `action` field) |
| `/result?browser=chrome` | GET | Read last result |
| `/result` | POST | Extension posts results here |
| `/status` | GET | Health check |
| `/debug` | GET | Show internal state |

### State management
```javascript
const browsers = {
  chrome:  { command: null, commandReady: false, lastResult: null },
  firefox: { command: null, commandReady: false, lastResult: null }
};
```

### URL parsing
Use `new URL(req.url, base)` instead of deprecated `url.parse()`:
```javascript
const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
const pathname = parsedUrl.pathname;
const query = Object.fromEntries(parsedUrl.searchParams);
```

## Quick Start (GitHub Clone)

```bash
git clone <repo-url> browser-remote-control
cd browser-remote-control
npm install --prefix bridge
cd bridge && node server.js &
# 在 Chrome/Firefox 中加载对应扩展
# CLI 使用：
cd .. && ./cli.sh ping
```

## 目录结构

```
browser-remote-control/
├── SKILL.md              # Hermes skill文档（部署到~/.hermes/skills/时用）
├── README.md             # GitHub说明
├── BROWSER_CONTROL.md    # 快速参考
├── extension-chrome/     # Chrome MV3扩展 → chrome://extensions 加载
├── extension-firefox/    # Firefox MV2扩展 → about:debugging 临时加载
├── bridge/
│   ├── server.js         # Node.js桥接服务（端口18923）
│   └── package.json
├── cli.sh                # CLI工具
├── references/           # 技术参考文档
└── templates/            # 扩展模板
```

## Extension Packaging & Distribution

### Chrome (.zip)
```bash
cd extension-chrome
zip -r ../extension-chrome.zip manifest.json background.js content.js
```
Users load via `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 (选zip解压后的文件夹)

### Firefox (.xpi)
```bash
cd extension-firefox
zip -r ../extension-firefox.xpi manifest.json background.js content.js
```
Users install by **拖拽.xpi文件到Firefox窗口** → 点"添加"。永久安装，重启不丢失。

### 项目目录约定
上传GitHub时，所有文件放一个目录：skill文档(SKILL.md) + 运行时代码 + 打包文件。不要把skill和运行时分开存——用户clone后应该能直接用。

```
project/
├── SKILL.md              # Hermes skill文档
├── README.md             # GitHub说明
├── extension-chrome/     # Chrome扩展源码
├── extension-chrome.zip  # Chrome扩展打包
├── extension-firefox/    # Firefox扩展源码
├── extension-firefox.xpi # Firefox扩展打包（拖入浏览器安装）
├── bridge/server.js      # 桥接服务
├── cli.sh                # CLI工具
├── references/           # 技术参考
└── templates/            # 模板
```

## CLI用法

```bash
./cli.sh ping                          # 测试连接
./cli.sh list-tabs                     # 列出标签页
./cli.sh navigate "https://..."        # 导航
./cli.sh switch-tab <tab_id>           # 切换标签
./cli.sh open-tab "https://..."        # 新开标签
./cli.sh close-tab <tab_id>            # 关闭标签
./cli.sh scroll down 5                 # 滚动
./cli.sh get-text                      # 页面文本
./cli.sh get-url                       # 当前URL
./cli.sh navigate "https://..." firefox # 指定Firefox
```

## CLI Wrapper Pattern

```bash
#!/usr/bin/env bash
BRIDGE="${BRIDGE_URL:-http://127.0.0.1:18923}"

post_cmd() {
  local browser="$1" action="$2"
  shift 2
  # Build JSON payload from remaining key-value pairs
  # Send POST /cmd, then poll GET /result until response or timeout
  curl -s -X POST "$BRIDGE/cmd?browser=$browser" \
    -H 'Content-Type: application/json' \
    -d "$payload" > /dev/null

  # Poll for result with timeout
  local elapsed=0
  while [ $elapsed -lt 15 ]; do
    sleep 0.5
    local result=$(curl -s "$BRIDGE/result?browser=$browser")
    echo "$result" | grep -q '"waiting":true' && continue
    echo "$result" | python3 -m json.tool
    return 0
  done
}
```

## Debugging Pitfalls

### 0. `computer_use` tool not available
**Symptom**: The `computer_use` tool doesn't appear in your tool list, even after config changes and restart.
**Cause**: Some models (e.g., mimo-v2.5) don't register the `computer_use` tool. It's a model-level limitation.
**Fix**: Use `cua-driver` CLI directly (see `references/cua-driver-cli-fallback.md`) or build a Chrome
extension with HTTP bridge (this skill). The `computer_use` tool requires Accessibility + Screen Recording
permissions granted to CuaDriver.app — verify with `hermes computer-use doctor`.

### 0b. Chrome `--remote-debugging-port` not working
**Symptom**: Chrome starts with `--remote-debugging-port=9222` but `curl localhost:9222` returns empty.
**Cause**: Chrome was already running when you launched with the flag. Chrome connects to the existing
instance instead of starting a new one with debugging enabled.
**Fix**: Must fully quit Chrome first (`killall "Google Chrome"` or Cmd+Q), then launch with the flag.
Verify with `lsof -i :9222` — the port must show Chrome listening on it.

### 1. Old extension consuming commands
**Symptom**: Send command to Chrome, poll returns noop, but result appears.
**Cause**: An old version of the extension is still installed and polling `/poll` (legacy endpoint).
**Fix**: Check server logs for `← chrome: result received` between cmd send and poll.
The system is working correctly — the old extension is processing commands.
To use new commands (list_tabs, scroll, eval_js), load the new extension.

### 2. `url.parse()` deprecation warning
**Symptom**: `(node:NNNN) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized`
**Fix**: Replace `url.parse(req.url, true)` with `new URL(req.url, base)`.

### 3. Firefox function serialization
**Symptom**: `browser.tabs.executeScript` doesn't accept function objects.
**Fix**: Serialize the function to a string and wrap in an IIFE:
```javascript
code: `(${func.toString()}).apply(null, ${JSON.stringify(args)})`
```

### 4. Chrome service worker sleep
**Symptom**: Extension stops polling after ~30 seconds.
**Fix**: Use `chrome.alarms` with short period to keep the service worker alive:
```javascript
chrome.alarms.create('poll', { periodInMinutes: 0.02 });
chrome.alarms.onAlarm.addListener(() => poll());
```

### 5. CSP bypass not working
**Symptom**: `chrome.scripting.executeScript` fails on strict CSP sites.
**Fix**: Ensure you're using `world: 'MAIN'` (not default `ISOLATED` world).
```javascript
chrome.scripting.executeScript({
  target: { tabId, allFrames: false },
  world: 'MAIN',
  func: myFunction
});
```

### 8. `eval()` blocked by CSP even with `world: 'MAIN'` — CDP fallback pattern
**Symptom**: `execInPage` with `eval(code)` or `new Function(code)` inside the function body throws CSP violation on strict sites (GitHub, BOSS直聘, banking sites).
**Root cause**: `world: 'MAIN'` bypasses extension's isolated world CSP, but the page's own CSP still blocks `eval()`. The injected function runs fine, but if it calls `eval()` internally, that call is blocked.
**Fix**: For `eval_js` action, use CDP `Runtime.evaluate` via `chrome.debugger` API. CDP operates at DevTools protocol level, completely bypassing all CSP. But `chrome.debugger` in MV3 service workers is unreliable (events may not fire, promises hang). Always use `Promise.race` with 3s timeout and fall back to `execInPage`:
```javascript
// eval_js action — CDP with fallback
try {
  await chrome.debugger.attach({ tabId }, '1.3');
  const cdpResult = await Promise.race([
    chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: userCode, returnByValue: true, awaitPromise: true
    }).then(r => r?.result?.value),
    new Promise((_, rej) => setTimeout(() => rej(new Error('cdp_timeout')), 3000))
  ]);
  await chrome.debugger.detach({ tabId });
  return { result: cdpResult, method: 'cdp' };
} catch {
  const fallback = await execInPage(func, tab, args);
  return { result: fallback, method: 'execInPage' };
}
```
**For non-eval code**: Write dedicated handler functions per action instead of using eval.

### 5c. `new Function()` blocked by CSP even in MAIN world
**Symptom**: Passing `new Function(code)` or `eval()` as the `func` parameter to `executeScript` with `world: 'MAIN'` still gets blocked by CSP on sites like GitHub, BOSS直聘.
**Cause**: CSP `script-src` directive blocks `new Function()` regardless of which world it runs in. The MAIN world bypass only works for **direct function references**, not dynamically constructed functions.
**Fix**: Do NOT use `eval`/`new Function`. Instead, write dedicated handler functions for each action:
```javascript
// ❌ FAILS on CSP sites
const result = await executeScript(() => new Function(code)());

// ✅ WORKS — direct function reference
const result = await executeScript(() => document.title);
const result = await executeScript(() => document.body?.innerText || '');
```

## References

- `references/react-form-automation.md` — React/SPA表单自动化技巧（CDP eval_js + nativeInputValueSetter）
- `references/bosszhipin-selectors.md` — BOSS直聘页面元素选择器
- `references/cua-driver-cli-fallback.md` — cua-driver CLI备用方案

## Command Reference

Standard commands for browser remote control:

**Tab Management**: `list_tabs`, `switch_tab`, `open_tab`, `close_tab`
**Navigation**: `navigate`, `go_back`, `go_forward`, `refresh`
**Page Interaction**: `scroll`, `get_text`, `get_url`, `get_title`, `check_login`
**Content Extraction**: `eval_js`, `page_info`
**Health**: `ping`

Each command returns a JSON object. Errors include an `error` field.
