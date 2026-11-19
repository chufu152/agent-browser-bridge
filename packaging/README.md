# UBA 浏览器 Agent —— 开箱即用包

让任意 AI Agent（Claude / Cursor / WorkBuddy 等）控制浏览器。解压后运行一次安装，之后直接在 agent 里用自然语言指挥浏览器。

## 快速开始（3 步）

### 1. 安装（自动）

- Windows：双击 `setup.cmd`
- 其他：运行 `node setup.mjs`

会自动完成：注册原生消息 host、生成 token、生成 MCP 配置。

### 2. 加载扩展（唯一手动步骤）

1. 打开 `edge://extensions`，开启「开发人员模式」
2. 「加载解压缩的扩展」→ 选择本包的 `extension` 文件夹

### 3. 接入 agent

把 `mcp-config/` 里的配置贴进你的 agent：

- **Claude Desktop**：`mcp-config/claude-desktop.json` → 合并进 `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor**：`mcp-config/cursor-mcp.json` → 放进 `.cursor/mcp.json`
- **其他 MCP agent**：`mcp-config/generic.json`

## 使用

接入后直接对 agent 说：

- 「打开 bilibili.com 搜索 机器学习」
- 「看一下当前页有哪些按钮」
- 「点击登录按钮」

agent 会自动调用浏览器工具完成。

## 目录结构

```
setup.cmd / setup.mjs     一键安装脚本
bin/bridge.cjs            桥接服务（已编译，无需依赖）
bin/mcp-server.cjs        MCP 服务（已编译）
extension/                预构建浏览器扩展
mcp-config/               agent 接入配置
com.uba.bridge.json       原生消息 manifest（安装时生成）
native-host.cmd           原生消息启动器（安装时生成）
```

## 安全红线

- 高风险操作（支付/删除/发送/发布/账户安全、文件传输）会弹确认，agent 无权自确认。
- 不读取密码字段、Cookie、账号凭据；不绕过验证码/付费墙。
- 只操作用户自己已渲染在本机页面上的内容。
