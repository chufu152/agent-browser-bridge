"""示例 Python Agent — 演示用 SDK 完成“读取快照 + 填写 + 点击”任务。"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "packages", "sdk-python"))

from uba_sdk import BrowserClient, UbaError  # noqa: E402


def main() -> None:
    client = BrowserClient(
        endpoint=os.environ.get("UBA_ENDPOINT", "ws://127.0.0.1:3000"),
        agent_id=os.environ.get("UBA_AGENT_ID", "python-agent"),
        token=os.environ.get("UBA_TOKEN", ""),
    )
    client.connect()
    print("[python-agent] connected, session=", client.session_id)

    tab_id = 1
    snapshot = client.get_snapshot(tab_id)
    print(f"[python-agent] page={snapshot.get('title')} elements={len(snapshot.get('elements', []))}")

    client.fill(tab_id, {"role": "textbox", "name": "搜索"}, "示例关键词")
    print("[python-agent] filled search box")

    try:
        client.click(tab_id, {"role": "button", "name": "搜索"})
        print("[python-agent] clicked search button")
    except UbaError as e:
        print("[python-agent] click error:", e.error_type, e.message)

    client.close()


if __name__ == "__main__":
    main()
