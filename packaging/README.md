# UBA 浏览器 Agent —— 零安装开箱即用包（CDP 版）

让任意 AI Agent（Claude / Cursor / Qoder / WorkBuddy 等）控制浏览器。
**不装扩展、不写注册表、不需要重载或刷新页面。** 解压后跑一条命令，全部自动完成。

## 快速开始（1 步）

- Windows：双击 `setup.cmd`
- 其他 / agent 自动执行：`node setup.mjs`

脚本自动完成：

1. 生成 Agent token（`~/.uba/agents.json`，已有则复用）
2. 拉起一个**带你的登录态**的受控浏览器窗口（从日常 Edge/Chrome 复制 Cookies，独立 profile，不影响日常浏览器）
3. 启动桥接服务（控制通道 + 本地人工确认页）
4. 生成 MCP 配置并做连通自检

完成后把 `mcp-config/generic.json` 的内容接入你的 agent（或直接让 agent 读取该文件自行配置），即可用自然语言控制浏览器：

- 「打开 bilibili.com 搜索 机器学习」
- 「读一下当前页面的完整内容」
- 「把这个表单填了」

## 原理

受控浏览器以调试端口（CDP）启动，桥接服务直连 DevTools 协议，把与扩展版同一套 DOM/定位/动作引擎注入页面执行。没有扩展，就没有安装/重载/刷新这些前置。

## 目录结构

```
setup.cmd / setup.mjs     一键安装脚本（唯一入口）
uba-browser.mjs           受控浏览器启动器（幂等，可单独重跑）
bin/bridge.cjs            桥接服务（已编译，无依赖）
bin/mcp-server.cjs        MCP 服务（已编译）
bin/page-engine.js        页面引擎（注入受控浏览器）
bin/smoke.cjs             连通自检
mcp-config/               agent 接入配置（安装时生成）
```

## 日常使用

- 受控浏览器窗口关掉后：重跑 `node uba-browser.mjs` 即可（登录态保留在独立 profile）。
- 桥接服务挂了：重跑 `node setup.mjs`（全程幂等）。
- 登录态过期：在受控浏览器窗口里正常登录一次即可。

## 安全红线

- 高风险操作（支付/删除/发送/发布/账户安全、文件传输）会在受控浏览器自动打开确认页，由你批准；agent 无权自确认。
- 不读取密码字段、不向外传输 Cookie/凭据；复制 Cookies 仅用于在本机重建你的登录态。
- 不绕过验证码/付费墙；只操作用户自己已渲染在本机页面上的内容。