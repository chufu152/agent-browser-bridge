# @uba/bridge — 本地通信服务

Universal Browser Agent 的本地桥接服务（M2）。北向通过 WebSocket 供 Agent 接入，南向通过 Native Messaging 连接浏览器插件。

## 架构

```
Agent（任意实现）
   │ WebSocket（ws://127.0.0.1:3000）
   ▼
Node.js Bridge
   ├── auth/         Token 认证（SHA-256 哈希 + timingSafeEqual）
   ├── session/      会话管理（断连即失效，重连新建）
   ├── dedup/        操作去重（operationId → 状态，15 分钟窗口）
   ├── audit/        审计（不含敏感值）
   ├── router/       JSON-RPC 2.0 路由（认证/会话/去重/转发）
   ├── websocket/    北向 WebSocket 服务
   └── native-messaging/ 南向 Native Messaging（长度前缀帧协议）
   │ Native Messaging（stdio）
   ▼
浏览器插件 service worker → content script → 网页 DOM
```

## 本地运行

```bash
cd packages/bridge
npm install
npm run dev          # 或 npm start
```

- WebSocket 监听 `ws://127.0.0.1:3000`（可用 `UBA_WS_PORT` 覆盖）。
- Native Messaging 走 stdin/stdout，由浏览器经 `connectNative` 拉起。

## 连接认证与调用流程

1. Agent 通过 WebSocket 连接，先发送：

   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "browser.connect",
     "params": { "agentId": "agent-a", "token": "<token>", "protocolVersion": "1.0" }
   }
   ```

2. 桥接服务校验 token，返回 `sessionId`。
3. 后续请求在 `params.sessionId` 携带会话；写操作必须携带 `operationId`。

## 原生消息 host 注册

插件通过 `com.uba.bridge` 与桥接服务通信，需注册原生消息 host：

```bash
cd packages/bridge
node native-host/register.mjs <extension-id>
```

- `<extension-id>` 见 `chrome://extensions`（加载已解压扩展后）。
- Windows 写入 `HKCU\...\NativeMessagingHosts\com.uba.bridge`。
- macOS/Linux 写入 `~/.config/*/NativeMessagingHosts/`。

## 安全

- 默认只监听 `127.0.0.1`，不暴露公网。
- Token 只存 SHA-256 哈希，验证用恒定时间比较；认证失败不泄露 Agent 是否存在。
- 断连即撤销会话；令牌撤销即时失效。
- 审计记录不含 token、输入值、页面全文。

## 测试

```bash
npm run test -w packages/bridge      # 21 个单元测试
npm run typecheck -w packages/bridge # 类型检查
```

M2 验收证据：21/21 单测通过（认证、会话、去重、路由、断连、协议版本）；`tsc --noEmit` 通过。
