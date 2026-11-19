# UBA 浏览器 MCP 接入指南

把浏览器控制能力做成一个 **MCP 服务**。配置一次后，你在 Claude / Cursor / WorkBuddy 等 agent 界面里直接说「帮我打开 B站搜 XX」「帮我点这个按钮」，agent 就会自动调用浏览器工具完成，你什么都不用手动做。

## 一、前置条件（都已自动就绪）

- ✅ 扩展已加载到 Edge，原生 host 已注册（`start.cmd` 一键完成）
- ✅ 打开 Edge 停在任意网页时，桥接服务会自动运行（`ws://127.0.0.1:3000`）
- ✅ Agent token 已生成在 `~/.uba/agents.json`，MCP 服务会自动读取

> 使用前只需保持 **Edge 开着、停在普通网页** 即可。

## 二、接入你的 Agent（选一种）

### Claude Desktop

1. 打开配置文件 `%APPDATA%\Claude\claude_desktop_config.json`
2. 把 `mcp-config/claude-desktop.json` 的内容合并进去（或直接复制粘贴）
3. 重启 Claude Desktop

### Cursor

1. 在项目根目录新建/编辑 `.cursor/mcp.json`
2. 把 `mcp-config/cursor-mcp.json` 的内容复制进去
3. 重启 Cursor

### WorkBuddy

1. 聊天窗口左下角「+」→ 自定义连接器 → 添加 MCP
2. 命令填：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`
3. 参数填：`D:\ai-chajian\node_modules\tsx\dist\cli.mjs D:\ai-chajian\packages\mcp-server\src\index.ts`

### 其他支持 MCP 的 agent

通用配置（`command` + `args`）：

```json
{
  "mcpServers": {
    "uba-browser": {
      "command": "C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node.exe",
      "args": [
        "D:\\ai-chajian\\node_modules\\tsx\\dist\\cli.mjs",
        "D:\\ai-chajian\\packages\\mcp-server\\src\\index.ts"
      ]
    }
  }
}
```

## 三、使用示例

接入后，直接对 agent 说（自然语言）：

- 「打开 bilibili.com，搜索 机器学习」
- 「看一下当前页面有哪些按钮」
- 「点击『登录』按钮」
- 「在搜索框输入 天气，然后回车」

agent 会自动调用这些工具：`browser_get_snapshot`、`browser_navigate`、`browser_click`、`browser_fill`、`browser_press`、`browser_scroll`、`browser_batch` 等。

## 四、工具清单

| 工具 | 作用 |
|---|---|
| `browser_get_snapshot` | 读取页面结构化快照（标题、可交互元素） |
| `browser_get_tabs` / `browser_get_active_tab` | 查看标签页 |
| `browser_navigate` | 导航到 URL |
| `browser_click` | 点击元素（高风险按钮会要求你确认） |
| `browser_fill` | 填写输入框 |
| `browser_press` | 键盘按键 |
| `browser_scroll` | 滚动到元素 |
| `browser_batch` | 批量执行 |

## 五、安全红线（内置，不可绕过）

- 高风险操作（支付/删除/发送/发布/账户安全、文件传输）会**弹确认**，你在扩展弹窗里点「确认/拒绝」，agent 无权自确认。
- 不读取密码字段、Cookie、账号凭据；不绕过验证码/付费墙。

## 六、手动测试（可选）

```bash
node D:\ai-chajian\mcp.cmd
# 或
node D:\ai-chajian\agent.mjs 关键词
```
