# @uba/mcp-server

将浏览器能力暴露为 MCP Tools 的标准适配层。内部通过 TypeScript SDK 调用 BCP（经桥接服务），不重复实现 DOM Engine / Locator / Action Engine。

## 提供的工具

- `browser_get_snapshot` — 页面快照
- `browser_get_tabs` / `browser_get_active_tab` — 标签页
- `browser_navigate` — 导航
- `browser_click` — 点击（高风险需人工确认）
- `browser_fill` / `browser_press` — 填写/按键
- `browser_scroll` — 滚动
- `browser_batch` — 批量操作

## 运行

```bash
export UBA_ENDPOINT=ws://127.0.0.1:3000
export UBA_AGENT_ID=my-agent
export UBA_TOKEN=<token>
npm run start -w packages/mcp-server
```

MCP 客户端（如支持 MCP 的 Agent）配置 `command` 为 `node packages/mcp-server/src/index.ts`（或 `tsx` 运行），即可自动发现上述工具。

## 错误处理

- 高风险操作返回 `isError=true`，`content` 内含 `{errorType:"CONFIRMATION_REQUIRED", data:{confirmationId}}`，Agent 需等待用户确认后重提。
- 其他 BCP 错误统一映射为 `errorType` 结构，Agent 可据此重试或提示用户。
