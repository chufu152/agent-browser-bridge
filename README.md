# Universal Browser Agent (UBA)

让任意 AI Agent 通过统一接口，直接控制用户授权的真实浏览器。

## 定位

- **模型无关、Agent 无关**：所有 Agent 通过同一套 Browser Control Protocol (BCP) 接入。
- **直接 DOM 操作**：默认通过浏览器原生 DOM 执行，不采用“截图识别 + 坐标预测 + 模拟点击”的视觉 Agent 路径。
- **安全可控**：本地接入、Token 认证、最小权限、高风险操作由用户在本地确认页批准。

## 快速开始（零安装 CDP 版，推荐）

不装扩展、不写注册表、无需重载/刷新。解压 `dist/uba-browser-agent.zip` 后运行一次：

```
node setup.mjs        # Windows 可双击 setup.cmd
```

自动完成：拉起带登录态的受控浏览器（CDP 调试端口）→ 启动桥接 → 生成 MCP 配置 → 连通自检。
把 `mcp-config/generic.json` 接入任意 MCP agent 即可用自然语言控制浏览器。

原理：桥接经 CDP 直连浏览器，把与扩展同一套 DOM/Locator/Action 引擎注入页面执行
（`packages/bridge/src/cdp/` + `packages/extension/core/page-entry.ts`）。
扩展 + Native Messaging 为遗留通道，代码保留但不再是默认路径。

实战验证：`node stress-test.mjs` 在真实浏览器跑满 100 题复刻作业页
（70 组 radio + 30 个 UEditor 式 iframe contenteditable），读回验证 + 高风险红线验证，
P50 ≈ 6ms / P95 ≈ 24ms。

## 里程碑

| 阶段 | 名称 | 状态 |
|---|---|---|
| M0 | 需求与协议基线 | ✅ 已完成（`docs/`） |
| M1 | 浏览器控制核心 | ✅ 已完成（`packages/extension/`） |
| M2 | 本地通信系统 | ✅ 已完成（`packages/bridge/`） |
| M3 | 通用 Agent 接入 | ✅ 已完成（`packages/mcp-server/`、`sdk-typescript/`、`sdk-python/`） |
| M4 | 性能与规模优化 | ✅ 已完成（快照缓存/批量/智能等待/限流/基准） |
| M5 | 高级能力与发布准备 | ✅ 已完成（Shadow DOM/文件授权/管理界面/发布回滚） |

## 目录结构

```
packages/
  extension/      MV3 浏览器插件（遗留通道）+ 共享页面引擎（core/，CDP 版复用）
  bridge/         Node.js 本地桥接服务（WebSocket + CDP + Auth + Router + 确认页）
  protocol/       BCP 协议类型、方法、Schema
  mcp-server/     MCP Server（将浏览器能力暴露为 MCP Tools）
  sdk-typescript/ TypeScript SDK
  sdk-python/     Python SDK
uba-browser.mjs   受控浏览器启动器（登录态复制 + CDP 拉起，幂等）
stress-test.mjs   100 题实战压测（test-pages/ 复刻页）
examples/         示例 Agent（node + python）
docs/             项目规划文档
```

## 规划文档

- `docs/01-项目概述.md`
- `docs/02-系统架构设计.md`
- `docs/03-接口文档.md`
- `docs/04-项目里程碑.md`
- `docs/05-测试文档.md`

## 合规红线

- 只处理用户自己已渲染在本机页面上的内容，用于个人用途。
- 不绕过登录墙 / 付费墙 / 验证码 / 站点安全控制。
- 不读取密码字段值；Cookie/凭据不向外传输、不提供给 agent（安装器仅在本机复制 Cookies 重建登录态）。
- 高风险操作（支付、删除、发送、发布、账户安全修改）必须由用户在本地确认页批准，agent 无权自确认。

详见 `docs/02-系统架构设计.md` 第 5 章与 `docs/05-测试文档.md`。
