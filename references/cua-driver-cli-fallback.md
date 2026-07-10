# cua-driver CLI Fallback

When `computer_use` tool is unavailable (model limitation, tool not registered,
or config issue), cua-driver can be driven directly from the terminal.

## Prerequisites
- cua-driver installed and running: `hermes computer-use doctor` (all ✅)
- TCC permissions granted: Accessibility + Screen Recording for CuaDriver.app

## Available tools
```bash
/Applications/CuaDriver.app/Contents/MacOS/cua-driver list-tools
```

Key tools: `get_desktop_state`, `get_window_state`, `list_windows`, `list_apps`,
`click`, `scroll`, `type_text`, `press_key`, `page`

## Common operations

### Screenshot the full desktop
```bash
cua-driver call get_desktop_state | python3 -c "
import sys, json, base64
data = json.loads(sys.stdin.read())
img = base64.b64decode(data['screenshot_png_b64'])
with open('/tmp/desktop.png', 'wb') as f: f.write(img)
print(f'Saved: {len(img)} bytes')
"
```

### Get Chrome window list
```bash
cua-driver call list_windows | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
chrome_pid = $(pgrep -f 'Google Chrome' | head -1)
for w in data.get('windows', []):
    if w.get('pid') == chrome_pid:
        print(f'{w[\"window_id\"]}: {w.get(\"title\",\"\")[:60]}')
"
```

### Read page accessibility tree
```bash
cua-driver call get_window_state '{"pid":PID,"window_id":WID}'
```

### Click at coordinates
```bash
cua-driver call click '{"pid":PID,"window_id":WID,"x":X,"y":Y}'
```

## Limitations
- Requires the window to be visible (not minimized)
- AX tree may not expose SPA-rendered content well (Vue/React)
- Screenshot + vision analysis is more reliable than AX tree for dynamic pages
- Cannot bypass CSP (unlike extension's `world: 'MAIN'`)

## When to use vs extension
| Scenario | Use CLI | Use Extension |
|----------|---------|---------------|
| Quick screenshot check | ✅ | ❌ |
| Read page text reliably | ❌ | ✅ |
| Interact with SPA content | ❌ | ✅ |
| Tab management | ❌ | ✅ |
| Bypass CSP | ❌ | ✅ |
| Drive non-browser apps | ✅ | ❌ |
