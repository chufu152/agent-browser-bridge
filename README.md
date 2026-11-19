# Universal Browser Agent (UBA)

让任意 AI Agent 通过统一接口，直接控制用户授权的真实浏览器。

## 定位

- **模型无关、Agent 无关**：所有 Agent 通过同一套 Browser Control Protocol (BCP) 接入。
- **直接 DOM 操作**：默认通过浏览器原生 DOM 和扩展能力执行，不采用“截图识别 + 坐标预测 + 模拟点击”的视觉 Agent 路径。
- **安全可控**：本地接入、Token 认证、最小权限、高风险操作由用户在浏览器侧确认。

## 里程碑

| 阶段 | 名称 | 状态 |
|---|---|---|
| M0 | 需求与协议基线 | ✅ 已完成（`docs/`） |
| M1 | 浏览器控制核心 | ✅ 已完成（`packages/extension/`） |
| M2 | 本地通信系统 | ✅ 已完成（`packages/bridge/`） |
| M3 | 通用 Agent 接入 | ✅ 已完成（`packages/mcp-server/`、`sdk-typescript/`、`sdk-python/`） |
| M4 | 性能与规模优化 | 进行中 |
| M5 | 高级能力与发布准备 | 待开始 |

## 目录结构

```
packages/
  extension/      MV3 浏览器插件（DOM Engine / Locator / Snapshot / Observer / Actions / Tabs）
  bridge/         Node.js 本地桥接服务（WebSocket + Native Messaging + Auth + Router）
  protocol/       BCP 协议类型、方法、Schema
  mcp-server/     MCP Server（将浏览器能力暴露为 MCP Tools）
  sdk-typescript/ TypeScript SDK
  sdk-python/     Python SDK
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
- 不读取、不存储 Cookie 与账号凭据；不读取密码字段值。
- 高风险操作（支付、删除、发送、发布、账户安全修改）必须由用户在浏览器侧确认。

详见 `docs/02-系统架构设计.md` 第 5 章与 `docs/05-测试文档.md`。
