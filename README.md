# Browser Remote Control

通过浏览器扩展 + HTTP桥接服务器，让CLI/AI Agent远程控制Chrome和Firefox。

## 特性

- 🌐 支持 Chrome (MV3) 和 Firefox (MV2)
- 🔄 HTTP轮询架构，Service Worker友好
- 🛡️ 绕过CSP安全策略（`chrome.scripting.executeScript` + `world: 'MAIN'`）
- 📑 标签页管理（列表/切换/新建/关闭）
- 📄 页面内容提取（文本/HTML/JS执行）
- 🖥️ CLI工具，一行命令操控浏览器

## 快速开始

```bash
# 克隆
git clone https://github.com/eiritsu/browser-remote-control.git
cd browser-remote-control

# 安装依赖并启动bridge
cd bridge && npm install && node server.js &

# 测试连接
cd .. && ./cli.sh ping
```

### 安装Chrome扩展

1. 打开 `chrome://extensions/`
2. 打开"开发者模式"
3. 点"加载已解压的扩展程序" → 选择 `extension-chrome/` 目录

### 安装Firefox扩展

**永久安装**：把 `extension-firefox.xpi` 拖入Firefox窗口

**开发模式**：`about:debugging` → 临时加载 → 选择 `extension-firefox/manifest.json`

## CLI用法

```bash
./cli.sh ping                    # 测试连接
./cli.sh list-tabs               # 列出所有标签页
./cli.sh navigate "https://..."  # 导航到URL
./cli.sh switch-tab <tab_id>     # 切换标签页
./cli.sh open-tab "https://..."  # 新开标签页
./cli.sh close-tab <tab_id>      # 关闭标签页
./cli.sh scroll down 5           # 向下滚动
./cli.sh get-text                # 获取页面文本
./cli.sh get-url                 # 获取当前URL
./cli.sh refresh                 # 刷新页面
./cli.sh go-back                 # 后退
./cli.sh go-forward              # 前进
```

指定浏览器（默认Chrome）：

```bash
./cli.sh ping firefox
./cli.sh list-tabs firefox
./cli.sh navigate "https://baidu.com" firefox
```

## HTTP API

```bash
# 发送命令
curl -s http://127.0.0.1:18923/cmd -X POST \
  -d '{"action":"get_text","browser":"chrome"}'

# 读取结果
curl -s http://127.0.0.1:18923/result?browser=chrome

# 查看状态
curl -s http://127.0.0.1:18923/status
```

## 架构

```
┌──────────────┐     POST /cmd        ┌──────────────┐     GET /poll/{browser}  ┌──────────────┐
│  CLI/Agent   │ ───────────────────▶ │  Bridge      │ ◀──────────────────────▶ │  Extension   │
│              │     GET /result      │  (Node.js)   │     POST /result         │  (Chrome/FF) │
│              │ ◀──────────────────── │  port 18923  │ ──────────────────────▶  │              │
└──────────────┘                      └──────────────┘                          └──────────────┘
```

## 支持的命令

| 分类 | 命令 | 说明 |
|------|------|------|
| 标签页 | `list_tabs` | 列出所有标签页 |
| 标签页 | `switch_tab` | 切换到指定标签页 |
| 标签页 | `open_tab` | 新开标签页 |
| 标签页 | `close_tab` | 关闭标签页 |
| 导航 | `navigate` | 跳转URL |
| 导航 | `go_back` / `go_forward` / `refresh` | 前进后退刷新 |
| 交互 | `scroll` | 滚动页面 |
| 交互 | `get_text` | 获取页面文本 |
| 交互 | `get_url` / `get_title` | 获取URL/标题 |
| 提取 | `eval_js` | 执行JavaScript |
| 健康 | `ping` | 测试连接 |

## 适用场景

- AI Agent操控浏览器搜索/采集信息
- 自动化测试
- 远程浏览器管理
- Hermes/Claude Code/Codex等agent的浏览器工具

## 许可

MIT
