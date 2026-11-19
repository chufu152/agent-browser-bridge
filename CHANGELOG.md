# 变更日志

本项目遵循「每个里程碑完成并验证后推送 main」的发布规则。

## [0.1.0] - 2026-11-19

首个完整里程碑交付（M0–M5）。

### M0 需求与协议基线
- 五份规划文档（项目概述、系统架构、接口、里程碑、测试）。

### M1 浏览器控制核心
- MV3 插件（content script + service worker + popup）。
- DOM Engine、Locator（7 种策略）、Snapshot（页面版本）、Observer、Action Engine、Tab Manager。

### M2 本地通信系统
- Node.js Bridge（WebSocket + Native Messaging）。
- Token 认证、会话管理、操作去重、JSON-RPC 路由、审计。

### M3 通用 Agent 接入
- 高风险确认闭环、事件总线、多 Agent 隔离。
- TypeScript SDK、Python SDK、MCP Server（9 个工具）、示例 Agent。

### M4 性能与规模优化
- ref 生成 O(n²)→O(n)、快照缓存、批量执行、智能等待、速率限制、性能基准。

### M5 高级能力与发布准备
- Shadow DOM / 同源 iframe 遍历、文件操作授权门、权限审计管理界面。
- 发布候选版本与回滚方案。

### 验证汇总
- 单元/集成测试 41 项全部通过（bridge 24 + extension 13 + SDK 4）。
- `tsc --noEmit` 全部通过。
- `wxt build` 产出合法 MV3（49.4 kB）。
- MCP Server 冒烟通过；WebSocket 认证冒烟通过。
