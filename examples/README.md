# UBA 示例 Agent 与统一接入指南

展示不同实现的 Agent 如何通过同一套 BCP 接入。所有示例不内置大模型，仅演示协议调用。

## 统一接入四步

1. **获得 token**：由桥接服务管理员为你的 Agent 签发（`bridge.tokens.issue(agentId)`）。
2. **建立连接**：WebSocket 连接 `ws://127.0.0.1:3000`，发送 `browser.connect`。
3. **调用方法**：请求携带 `sessionId`；写操作携带 `operationId`。
4. **处理确认**：高风险操作先返回 `CONFIRMATION_REQUIRED`（含 `confirmationId`），用户在浏览器侧确认后，用相同 `operationId` + `confirmationId` 重新提交。

## 示例：Node Agent

见 `examples/node-agent/`。运行：

```bash
export UBA_TOKEN=<token>
npm run start -w packages/sdk-typescript   # 先确保桥接服务已启动
# 直接运行示例：
npx tsx examples/node-agent/index.ts
```

## 示例：Python Agent

见 `examples/python-agent/`。运行：

```bash
pip install websocket-client
export UBA_TOKEN=<token>
python examples/python-agent/main.py
```

## 三种接入形态

| 形态 | 适用 | 说明 |
|---|---|---|
| SDK（TS/Python） | 自定义 Agent | 封装认证、错误、事件、重连 |
| MCP Server | 支持 MCP 的 Agent | 自动发现 `browser_*` 工具 |
| 直接 WebSocket | 任意语言 | 用 BCP 的 JSON-RPC 2.0 报文 |

所有形态最终都映射到同一 BCP，不重复实现浏览器控制引擎。
