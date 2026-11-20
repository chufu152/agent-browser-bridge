// Bridge 主入口 — 组装认证、会话、去重、审计、确认、事件、路由、WebSocket 与 CDP 南向通道。

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { TokenManager } from './auth/index';
import { SessionManager } from './session/index';
import { OperationStore } from './dedup/index';
import { AuditLog } from './audit/index';
import { ConfirmationManager } from './confirm/index';
import { EventBus } from './events/index';
import { JsonRpcRouter } from './router/index';
import { CdpTransport } from './cdp/index';
import { startConfirmUI } from './confirm-ui/index';
import { createWebSocketServer, type WebSocketServerHandle } from './websocket/server';
import type { ExtensionTransport } from './transport/index';
import type { EventEnvelope } from './events/index';

interface AgentConfig {
  agentId: string;
  token: string;
}

/** 读取预授权 Agent 配置（~/.uba/agents.json），配置缺失或损坏时返回空 */
function loadAgentsConfig(): AgentConfig[] {
  const file = process.env.UBA_AGENTS_FILE ?? join(homedir(), '.uba', 'agents.json');
  try {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    if (Array.isArray(raw?.agents)) {
      return raw.agents.filter(
        (a: any) => typeof a?.agentId === 'string' && typeof a?.token === 'string'
      );
    }
  } catch {
    /* 配置损坏时静默降级 */
  }
  return [];
}

export interface Bridge {
  tokens: TokenManager;
  sessions: SessionManager;
  operations: OperationStore;
  audit: AuditLog;
  confirmations: ConfirmationManager;
  events: EventBus;
  router: JsonRpcRouter;
  setTransport(t: ExtensionTransport | null): void;
  getTransport(): ExtensionTransport | null;
  /** 本地管理员确认（仅本地界面/插件可调用，不经 Agent 路由） */
  approveConfirmation(confirmationId: string, approved: boolean): boolean;
  /** 关闭 WebSocket 服务（测试用） */
  close(): void;
}

export function createBridge(): Bridge {
  const tokens = new TokenManager();
  const sessions = new SessionManager();
  const operations = new OperationStore();
  const audit = new AuditLog();
  const confirmations = new ConfirmationManager();
  const events = new EventBus();

  let transport: ExtensionTransport | null = null;

  const router = new JsonRpcRouter({
    tokens, sessions, operations, audit, confirmations, events,
    getTransport: () => transport
  });

  return {
    tokens, sessions, operations, audit, confirmations, events, router,
    setTransport(t) { transport = t; },
    getTransport() { return transport; },
    approveConfirmation(id, approved) { return router.adminResolveConfirmation(id, approved); },
    close() { /* no-op（无独立 WS 句柄时） */ }
  };
}

export function startBridge(opts: { host?: string; port?: number; verbose?: boolean } = {}): Bridge {
  const bridge = createBridge();
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.UBA_WS_PORT ?? 3000);

  // 预授权 Agent：从配置文件导入 token（让外部 Agent 免交互接入）
  loadAgentsConfig().forEach((a) => bridge.tokens.register(a.agentId, a.token));

  // 南向：CDP 直连浏览器（零扩展安装）。引擎脚本与 bridge 同目录分发。
  const engineFile = resolveEngineFile();
  const cdp = new CdpTransport({ engineFile });
  let cdpAlive = false;
  const probe = async () => {
    const alive = await cdp.isAlive();
    if (alive !== cdpAlive) {
      cdpAlive = alive;
      bridge.setTransport(alive ? cdp : null);
      console.error(`[uba-bridge] CDP browser ${alive ? 'connected' : 'disconnected'}`);
    }
  };
  probe();
  const probeTimer = setInterval(probe, 3000);

  // 本地人工确认界面（高风险批准/拒绝，Agent 路由不可达）
  const confirmUI = startConfirmUI({
    confirmations: bridge.confirmations,
    resolve: (id, approved) => bridge.approveConfirmation(id, approved)
  });

  // 高风险请求出现时，自动在受控浏览器打开确认页，用户无需记地址
  bridge.events.onEmit((event: EventEnvelope) => {
    if (event.data.eventType === 'operation.confirmationRequired' && cdpAlive) {
      cdp.send({ method: 'browser.createTab', params: { url: confirmUI.url } }).catch(() => {});
    }
  });

  // 北向：WebSocket
  const handle: WebSocketServerHandle = createWebSocketServer({
    host, port, router: bridge.router, sessions: bridge.sessions, audit: bridge.audit, events: bridge.events
  });

  // 事件实时推送：按订阅过滤
  bridge.events.onEmit((event: EventEnvelope) => {
    for (const sub of bridge.events.subscriptionsForSession(event.sessionId)) {
      if (bridge.events.matchesSubscription(sub, event)) {
        handle.pushToSession(event.sessionId, { jsonrpc: '2.0', method: event.data.eventType, params: event });
      }
    }
  });

  if (opts.verbose !== false) {
    console.error(`[uba-bridge] WebSocket listening on ws://${host}:${port}`);
    console.error(`[uba-bridge] CDP endpoint: http://127.0.0.1:${process.env.UBA_CDP_PORT ?? 9222}`);
    console.error(`[uba-bridge] confirm UI: ${confirmUI.url}`);
    console.error('[uba-bridge] registered agents:', bridge.tokens.listAgents().join(', ') || '(none)');
  }

  handle.server.on('error', (e) => console.error('[uba-bridge] websocket error', e));

  // 覆盖 close 以关闭 WS / 确认页 / 探活
  const origClose = bridge.close;
  bridge.close = () => {
    clearInterval(probeTimer);
    confirmUI.server.close();
    handle.server.close();
    origClose();
  };

  return bridge;
}

/** 页面引擎脚本定位：环境变量 → 与入口脚本同目录 → 仓库 dist/bin */
function resolveEngineFile(): string {
  if (process.env.UBA_ENGINE_FILE && existsSync(process.env.UBA_ENGINE_FILE)) return process.env.UBA_ENGINE_FILE;
  const candidates = [
    join(dirname(process.argv[1] ?? '.'), 'page-engine.js'),
    join(process.cwd(), 'dist', 'bin', 'page-engine.js'),
    join(process.cwd(), 'dist', 'zip', 'bin', 'page-engine.js')
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0];
}
