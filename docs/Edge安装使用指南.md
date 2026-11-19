# Edge 安装使用指南

## 一、加载插件到 Edge

1. 打开 Edge，地址栏输入 `edge://extensions` 回车。
2. 打开左侧/底部的 **「开发人员模式」**（Developer mode）开关。
3. 点击 **「加载解压缩的扩展」**（Load unpacked）。
4. 选择文件夹：

   ```
   D:\ai-chajian\packages\extension\.output\chrome-mv3
   ```

5. 加载成功后，插件卡片会显示名称 **Universal Browser Agent** 和一段 **扩展 ID**（形如 `abcdefghijklmnopqrstuvwxyzabcd`），记下这个 ID，下一步要用。

> 说明：Edge 与 Chrome 同为 Chromium，MV3 清单完全兼容，`chrome-mv3` 产物可直接在 Edge 加载。
> 若只需分发，可用 `packages/extension/.output/ubaextension-0.1.0-chrome.zip`（此 zip 用于 Edge 外接程序商店提交，本地加载请用上面的文件夹）。

## 二、注册原生消息 host（让插件能连桥接服务）

插件通过「原生消息」与本机桥接服务通信，需要注册一次：

```bash
cd D:/ai-chajian/packages/bridge
node native-host/register.mjs <上一步的扩展ID>
```

- Windows 会同时写入 Chrome 与 Edge 的注册表键（`HKCU\...\NativeMessagingHosts\com.uba.bridge`）。
- 注册成功后，回到 `edge://extensions` 点击插件的 **「重新加载」**。

## 三、启动桥接服务

```bash
cd D:/ai-chajian
npm run start -w packages/bridge
```

看到以下输出即成功：

```
[uba-bridge] WebSocket listening on ws://127.0.0.1:3000
[uba-bridge] Native messaging channel on stdin/stdout
```

## 四、验证

1. 打开任意普通网页（不要用 `edge://` 内部页）。
2. 点击工具栏的 Universal Browser Agent 图标，弹出面板应显示 **「当前页已注入」**。
3. 点 **「测试当前页快照」**，下方应出现该页的结构化 JSON（地址、标题、可交互元素）。

## 五、让 Agent 接入（进阶）

### 5.1 为 Agent 签发 token

在桥接服务进程中（或本地管理界面）为你的 Agent 生成一次性 token，例如在 Node 环境：

```js
const { createBridge } = require('./packages/bridge/dist/index.js');
const bridge = createBridge();
console.log(bridge.tokens.issue('my-agent'));
```

### 5.2 用 SDK 连接

TypeScript：
```ts
import { BrowserClient } from '@uba/sdk-typescript';
const client = new BrowserClient({ endpoint: 'ws://127.0.0.1:3000', agentId: 'my-agent', token: '<token>' });
await client.connect();
const snap = await client.getSnapshot(1);
```

Python：
```python
from uba_sdk import BrowserClient
client = BrowserClient(endpoint='ws://127.0.0.1:3000', agent_id='my-agent', token='<token>')
client.connect()
snap = client.get_snapshot(1)
```

或用 MCP Server：`npm run start -w packages/mcp-server`（环境变量 `UBA_ENDPOINT` / `UBA_AGENT_ID` / `UBA_TOKEN`）。

## 六、常见问题

| 现象 | 处理 |
|---|---|
| 面板显示「未注入（特殊页面）」 | 当前页是 `edge://` 内部页或商店页，换成普通网页 |
| 插件连不上桥接服务 | 确认已注册原生 host、已启动桥接服务、已重新加载插件 |
| 高风险操作卡住 | 在插件 popup 的「待确认操作」里点「确认/拒绝」 |

## 七、合规红线

- 只操作用户自己已渲染在本机页面上的内容。
- 不绕过登录墙 / 付费墙 / 验证码；不读取密码字段值、Cookie 与账号凭据。
- 高风险操作（支付/删除/发送/发布/账户安全、文件传输）必须人工确认，Agent 无权自确认。
