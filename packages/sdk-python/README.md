# @uba/sdk-python

UBA 的 Python SDK，与 TypeScript SDK 使用同一套 BCP 语义。示例：

```python
from uba_sdk import BrowserClient, UbaError

client = BrowserClient(
    endpoint="ws://127.0.0.1:3000",
    agent_id="my-agent",
    token="<token>",
)
client.connect()

snapshot = client.get_snapshot(1)
print(snapshot["title"])

try:
    client.click(1, {"role": "button", "name": "确认支付"}, operation_id="op-1")
except UbaError as e:
    if e.error_type == "CONFIRMATION_REQUIRED":
        confirmation_id = e.data["confirmationId"]
        # 等待用户在浏览器侧确认后重提
        client.click(1, {"role": "button", "name": "确认支付"}, "op-1", confirmation_id)

client.close()
```

## 安装

```bash
pip install websocket-client
```

## 安全

- 与 TS SDK 一致：token 只用于连接认证，写入本地环境变量，不写入日志。
- 高风险操作须经用户确认后重提，SDK 不提供自确认接口。
