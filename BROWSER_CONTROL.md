# Browser Remote Control

本地浏览器远程控制系统，支持 Chrome 和 Firefox。

## 启动

```bash
cd /Users/y/Desktop/browser-remote-control/bridge && node server.js &
```

## CLI 用法

```bash
CLI=/Users/y/Desktop/browser-remote-control/cli.sh

$CLI ping                          # 测试连接
$CLI list-tabs                     # 列出所有标签页
$CLI navigate "https://..."        # 导航到URL
$CLI switch-tab <tab_id>           # 切换标签页
$CLI open-tab "https://..."        # 新开标签页
$CLI close-tab <tab_id>            # 关闭标签页
$CLI scroll down 5                 # 向下滚动
$CLI get-text                      # 获取页面文本
$CLI get-url                       # 获取当前URL
$CLI extract-jobs                  # 提取BOSS直聘职位
$CLI refresh                       # 刷新页面
$CLI go-back                       # 后退
$CLI go-forward                    # 前进
```

## 多浏览器

CLI最后一个参数指定浏览器（默认chrome）：

```bash
$CLI ping firefox
$CLI list-tabs firefox
$CLI navigate "https://baidu.com" firefox
```

## HTTP API

```bash
# 发送命令
curl -s http://127.0.0.1:18923/cmd -X POST \
  -d '{"action":"get_text","browser":"chrome"}'

# 读取结果
curl -s http://127.0.0.1:18923/result?browser=chrome

# 状态
curl -s http://127.0.0.1:18923/status
```

## 前提条件

1. Bridge服务运行中（`node server.js`）
2. Chrome已安装extension-chrome扩展
3. Firefox已加载extension-firefox附加组件
