"""UBA Python SDK — BrowserClient

封装认证、请求、错误、事件与重连，与 TypeScript SDK 使用同一套 BCP 语义。
依赖：websocket-client（pip install websocket-client）。
"""

from __future__ import annotations

import json
import threading
import uuid
from typing import Any, Callable, Dict, Optional

try:
    import websocket  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "缺少 websocket-client，请执行: pip install websocket-client"
    ) from exc


class UbaError(Exception):
    """BCP 标准错误。"""

    def __init__(
        self,
        code: int,
        error_type: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.error_type = error_type
        self.data = data or {}


class BrowserClient:
    """通过 WebSocket 连接 UBA 桥接服务的浏览器控制客户端。"""

    def __init__(
        self,
        endpoint: str,
        agent_id: str,
        token: str,
        protocol_version: str = "1.0",
    ) -> None:
        self.endpoint = endpoint
        self.agent_id = agent_id
        self.token = token
        self.protocol_version = protocol_version

        self._ws: Optional[websocket.WebSocket] = None
        self._session_id: Optional[str] = None
        self._id_seq = 0
        self._lock = threading.Lock()
        self._pending: Dict[int, Dict[str, Any]] = {}
        self._listeners: Dict[str, list] = {}

    # ---------- 连接 ----------

    def connect(self) -> None:
        self._ws = websocket.create_connection(self.endpoint, timeout=15)
        result = self._call("browser.connect", {
            "agentId": self.agent_id,
            "token": self.token,
            "protocolVersion": self.protocol_version,
        })
        self._session_id = result["sessionId"]

    def close(self) -> None:
        if self._ws:
            self._ws.close()
            self._ws = None
            self._session_id = None

    @property
    def session_id(self) -> Optional[str]:
        return self._session_id

    # ---------- 内部 ----------

    def _next_id(self) -> int:
        with self._lock:
            self._id_seq += 1
            return self._id_seq

    def _call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if self._ws is None:
            raise UbaError(-32012, "BRIDGE_UNAVAILABLE", "Not connected")
        req_id = self._next_id()
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {},
        })
        self._ws.send(payload)
        while True:
            raw = self._ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == req_id:
                if "error" in msg:
                    err = msg["error"]
                    raise UbaError(
                        err.get("code", -32603),
                        (err.get("data") or {}).get("errorType", "INTERNAL_ERROR"),
                        err.get("message", "error"),
                        err.get("data"),
                    )
                return msg.get("result")
            # 通知（无 id）：分发到监听器
            if "method" in msg and "id" not in msg:
                for cb in self._listeners.get(msg["method"], []):
                    cb(msg.get("params"))

    def _call_with_session(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if self._session_id is None:
            raise UbaError(-32007, "SESSION_EXPIRED", "Not authenticated")
        merged = dict(params or {})
        merged["sessionId"] = self._session_id
        return self._call(method, merged)

    def _next_op(self, prefix: str) -> str:
        return f"op_{prefix}_{uuid.uuid4().hex}"

    def on(self, method: str, cb: Callable[[Any], None]) -> None:
        self._listeners.setdefault(method, []).append(cb)

    # ---------- Browser ----------

    def get_info(self) -> Any:
        return self._call_with_session("browser.getInfo")

    def get_snapshot(self, tab_id: int, options: Optional[Dict[str, Any]] = None) -> Any:
        return self._call_with_session("browser.getSnapshot", {"tabId": tab_id, "options": options or {}})

    def get_tabs(self) -> Any:
        return self._call_with_session("browser.getTabs")

    def get_active_tab(self) -> Any:
        return self._call_with_session("browser.getActiveTab")

    def create_tab(self, url: str, active: bool = True) -> Any:
        return self._call_with_session("browser.createTab", {
            "url": url, "active": active, "operationId": self._next_op("createTab"),
        })

    def close_tab(self, tab_id: int) -> Any:
        return self._call_with_session("browser.closeTab", {
            "tabId": tab_id, "operationId": self._next_op("closeTab"),
        })

    def switch_tab(self, tab_id: int) -> Any:
        return self._call_with_session("browser.switchTab", {
            "tabId": tab_id, "operationId": self._next_op("switchTab"),
        })

    def get_operation(self, operation_id: str) -> Any:
        return self._call_with_session("browser.getOperation", {"operationId": operation_id})

    def get_events(self, cursor: Optional[str] = None, limit: int = 100) -> Any:
        return self._call_with_session("browser.getEvents", {"cursor": cursor, "limit": limit})

    # ---------- Page ----------

    def goto(self, tab_id: int, url: str) -> Any:
        return self._call_with_session("page.goto", {"tabId": tab_id, "url": url, "operationId": self._next_op("goto")})

    def back(self, tab_id: int) -> Any:
        return self._call_with_session("page.back", {"tabId": tab_id, "operationId": self._next_op("back")})

    def forward(self, tab_id: int) -> Any:
        return self._call_with_session("page.forward", {"tabId": tab_id, "operationId": self._next_op("forward")})

    def reload(self, tab_id: int) -> Any:
        return self._call_with_session("page.reload", {"tabId": tab_id, "operationId": self._next_op("reload")})

    def get_url(self, tab_id: int) -> Any:
        return self._call_with_session("page.getUrl", {"tabId": tab_id})

    def get_title(self, tab_id: int) -> Any:
        return self._call_with_session("page.getTitle", {"tabId": tab_id})

    def subscribe(self, tab_id: int, event_types: list) -> Any:
        return self._call_with_session("page.subscribe", {"tabId": tab_id, "eventTypes": event_types})

    def unsubscribe(self, subscription_id: str) -> Any:
        return self._call_with_session("page.unsubscribe", {"subscriptionId": subscription_id})

    # ---------- Locator ----------

    def find(self, tab_id: int, locator: Dict[str, Any]) -> Any:
        return self._call_with_session("locator.find", {"tabId": tab_id, "locator": locator})

    def click(self, tab_id: int, locator: Dict[str, Any], operation_id: Optional[str] = None, confirmation_id: Optional[str] = None) -> Any:
        params: Dict[str, Any] = {"tabId": tab_id, "locator": locator, "operationId": operation_id or self._next_op("click")}
        if confirmation_id:
            params["confirmationId"] = confirmation_id
        return self._call_with_session("locator.click", params)

    def fill(self, tab_id: int, locator: Dict[str, Any], value: str) -> Any:
        return self._call_with_session("locator.fill", {"tabId": tab_id, "locator": locator, "value": value, "operationId": self._next_op("fill")})

    def type(self, tab_id: int, locator: Dict[str, Any], text: str) -> Any:
        return self._call_with_session("locator.type", {"tabId": tab_id, "locator": locator, "text": text, "operationId": self._next_op("type")})

    def clear(self, tab_id: int, locator: Dict[str, Any]) -> Any:
        return self._call_with_session("locator.clear", {"tabId": tab_id, "locator": locator, "operationId": self._next_op("clear")})

    def press(self, tab_id: int, locator: Dict[str, Any], key: str) -> Any:
        return self._call_with_session("locator.press", {"tabId": tab_id, "locator": locator, "key": key, "operationId": self._next_op("press")})

    def hover(self, tab_id: int, locator: Dict[str, Any]) -> Any:
        return self._call_with_session("locator.hover", {"tabId": tab_id, "locator": locator, "operationId": self._next_op("hover")})

    def check(self, tab_id: int, locator: Dict[str, Any]) -> Any:
        return self._call_with_session("locator.check", {"tabId": tab_id, "locator": locator, "operationId": self._next_op("check")})

    def uncheck(self, tab_id: int, locator: Dict[str, Any]) -> Any:
        return self._call_with_session("locator.uncheck", {"tabId": tab_id, "locator": locator, "operationId": self._next_op("uncheck")})

    def select_option(self, tab_id: int, locator: Dict[str, Any], option: str) -> Any:
        return self._call_with_session("locator.selectOption", {"tabId": tab_id, "locator": locator, "option": option, "operationId": self._next_op("selectOption")})

    def scroll_into_view(self, tab_id: int, locator: Dict[str, Any]) -> Any:
        return self._call_with_session("locator.scrollIntoView", {"tabId": tab_id, "locator": locator, "operationId": self._next_op("scrollIntoView")})

    def batch(self, tab_id: int, actions: list, stop_on_error: bool = True) -> Any:
        return self._call_with_session("browser.batch", {"tabId": tab_id, "actions": actions, "stopOnError": stop_on_error, "operationId": self._next_op("batch")})
