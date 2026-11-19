// JSON-RPC 路由 — BCP V1.0 统一入口。
// 职责：外层校验 → 认证/会话 → 方法能力 → 参数 → 去重 → 路由（本地或转发插件）。
// 不解析自然语言，不读取网页 DOM。

import { TokenManager } from '../auth/index';
import { SessionManager } from '../session/index';
import { OperationStore } from '../dedup/index';
import { AuditLog } from '../audit/index';
import type { ExtensionTransport } from '../transport/index';

export interface ConnectParams {
  agentId: string;
  token: string;
  protocolVersion: string;
  clientName?: string;
}

export interface RouteContext {
  sessionId: string;
  agentId: string;
}

export interface RouteResult {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

const PROTOCOL_VERSION = '1.0';

// 需要 operationId 的写方法（见 docs/03-接口文档.md 第 3.1 节）
const WRITE_METHODS = new Set([
  'browser.createTab',
  'browser.closeTab',
  'browser.switchTab',
  'page.goto',
  'page.back',
  'page.forward',
  'page.reload',
  'locator.click',
  'locator.fill',
  'locator.type',
  'locator.clear',
  'locator.press',
  'locator.hover',
  'locator.check',
  'locator.uncheck',
  'locator.selectOption',
  'locator.scrollIntoView',
  'browser.batch'
]);

// 高风险操作（需人工确认，M3 完整闭环；M2 先识别并阻断）
const HIGH_RISK_METHODS = new Set([
  'page.goto',
  'locator.click'
]);

export interface RouterDeps {
  tokens: TokenManager;
  sessions: SessionManager;
  operations: OperationStore;
  audit: AuditLog;
  getTransport: () => ExtensionTransport | null;
}

export class JsonRpcRouter {
  constructor(private readonly deps: RouterDeps) {}

  /** 处理单条 JSON-RPC 消息 */
  async handle(raw: unknown): Promise<RouteResult> {
    if (!raw || typeof raw !== 'object') {
      return this.err(null, -32600, 'INVALID_REQUEST', 'Invalid request');
    }
    const msg = raw as { jsonrpc?: string; id?: string | number; method?: string; params?: unknown };
    if (msg.jsonrpc !== '2.0') {
      return this.err(msg.id ?? null, -32600, 'INVALID_REQUEST', 'Invalid jsonrpc version');
    }
    if (typeof msg.method !== 'string') {
      return this.err(msg.id ?? null, -32600, 'INVALID_REQUEST', 'Method is required');
    }

    try {
      return await this.dispatch({ id: msg.id, method: msg.method, params: msg.params });
    } catch (e) {
      return this.err(msg.id ?? null, -32603, 'INTERNAL_ERROR', String(e));
    }
  }

  private async dispatch(msg: {
    id?: string | number;
    method: string;
    params?: unknown;
  }): Promise<RouteResult> {
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;

    // 1) 连接认证
    if (msg.method === 'browser.connect') {
      return this.handleConnect(msg.id ?? null, params);
    }

    // 2) 会话校验
    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) {
      return this.err(msg.id ?? null, -32007, 'SESSION_EXPIRED', 'sessionId is required');
    }
    const session = this.deps.sessions.get(sessionId);
    if (!session) {
      return this.err(msg.id ?? null, -32007, 'SESSION_EXPIRED', 'Session is invalid or expired');
    }

    // 3) 操作去重（写方法）
    if (WRITE_METHODS.has(msg.method)) {
      const operationId = params.operationId as string | undefined;
      if (!operationId) {
        return this.err(msg.id ?? null, -32602, 'INVALID_PARAMS', 'operationId is required for write operations');
      }
      const fp = this.deps.operations.fingerprint(params);
      const resolved = this.deps.operations.resolve(operationId, session.agentId, fp);
      if (resolved.action === 'conflict') {
        return this.err(msg.id ?? null, -32017, 'OPERATION_ID_CONFLICT', 'Same operationId with different parameters');
      }
      if (resolved.action === 'duplicate' && resolved.state) {
        if (resolved.state.status === 'processing') {
          return this.err(msg.id ?? null, -32016, 'DUPLICATE_OPERATION', 'Operation is already processing');
        }
        if (resolved.state.status === 'completed') {
          return { jsonrpc: '2.0', id: msg.id ?? null, result: resolved.state.result };
        }
        if (resolved.state.status === 'failed') {
          return this.err(msg.id ?? null, -32015, resolved.state.error?.errorType ?? 'OPERATION_OUTCOME_UNKNOWN', 'Operation previously failed');
        }
        if (resolved.state.status === 'unknown') {
          return this.err(msg.id ?? null, -32015, 'OPERATION_OUTCOME_UNKNOWN', 'Operation outcome is unknown');
        }
      }
      // 标记 processing 并继续执行
      if (resolved.action === 'new') {
        this.deps.operations.put({
          operationId,
          agentId: session.agentId,
          status: 'processing',
          paramsFingerprint: fp,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      return this.executeWithDedup(msg, session, params, operationId);
    }

    // 4) 只读方法直接路由
    return this.route(msg, session, params);
  }

  private async executeWithDedup(
    msg: { id?: string | number; method: string },
    session: { agentId: string },
    params: Record<string, unknown>,
    operationId: string
  ): Promise<RouteResult> {
    const result = await this.route(msg, session, params);
    if (result.error) {
      this.deps.operations.update(operationId, {
        status: 'failed',
        error: { errorType: result.error.data?.errorType as string ?? 'INTERNAL_ERROR', message: result.error.message }
      });
    } else {
      this.deps.operations.update(operationId, { status: 'completed', result: result.result });
    }
    return result;
  }

  private async route(
    msg: { id?: string | number; method: string },
    session: { agentId: string },
    params: Record<string, unknown>
  ): Promise<RouteResult> {
    const { method } = msg;
    const id = msg.id ?? null;

    // 本地方法：操作结果查询
    if (method === 'browser.getOperation') {
      const op = this.deps.operations.get(params.operationId as string);
      if (!op || op.agentId !== session.agentId) {
        return this.err(id, -32001, 'ELEMENT_NOT_FOUND', 'Operation not found');
      }
      return { jsonrpc: '2.0', id, result: { operationId: op.operationId, status: op.status, result: op.result, error: op.error } };
    }

    // 转发到插件
    const transport = this.deps.getTransport();
    if (!transport) {
      return this.err(id, -32012, 'BRIDGE_UNAVAILABLE', 'Extension is not connected');
    }

    const risk = HIGH_RISK_METHODS.has(method) ? 'high' : 'normal';
    try {
      const result = await transport.send({ method, params });
      // 插件可能返回 { ok:false, errorType } 结构，规范化
      const normalized = normalizePluginResult(result);
      this.deps.audit.record({
        ts: new Date().toISOString(),
        agentId: session.agentId,
        sessionId: params.sessionId as string,
        method,
        tabId: params.tabId as number | undefined,
        risk,
        outcome: normalized.error ? 'error' : 'ok',
        errorType: normalized.error?.errorType
      });
      if (normalized.error) {
        return this.err(id, codeForType(normalized.error.errorType), normalized.error.errorType, normalized.error.message ?? 'Operation failed');
      }
      return { jsonrpc: '2.0', id, result: normalized.result };
    } catch (e) {
      return this.err(id, -32012, 'BRIDGE_UNAVAILABLE', String(e));
    }
  }

  private handleConnect(id: string | number | null, params: Record<string, unknown>): RouteResult {
    const p = params as Partial<ConnectParams>;
    if (!p.agentId || !p.token || typeof p.protocolVersion !== 'string') {
      return this.err(id, -32602, 'INVALID_PARAMS', 'agentId, token and protocolVersion are required');
    }
    if (p.protocolVersion.split('.')[0] !== PROTOCOL_VERSION.split('.')[0]) {
      return this.err(id, -32020, 'UNSUPPORTED_PROTOCOL_VERSION', 'Unsupported protocol version');
    }
    const agentId = this.deps.tokens.verify(p.token);
    if (agentId === null || agentId !== p.agentId) {
      return this.err(id, -32006, 'PERMISSION_DENIED', 'Authentication failed');
    }
    const session = this.deps.sessions.create(agentId);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        sessionId: session.sessionId,
        protocolVersion: PROTOCOL_VERSION,
        serverTime: new Date().toISOString()
      }
    };
  }

  private err(id: string | number | null, code: number, errorType: string, message: string): RouteResult {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data: { errorType } }
    };
  }
}

interface NormalizedResult {
  result?: unknown;
  error?: { errorType: string; message?: string };
}

function normalizePluginResult(raw: unknown): NormalizedResult {
  if (raw && typeof raw === 'object') {
    const r = raw as { ok?: boolean; errorType?: string; error?: string; result?: unknown };
    if (r.ok === false) {
      return { error: { errorType: r.errorType ?? 'INTERNAL_ERROR', message: r.error } };
    }
    if (r.result !== undefined) return { result: r.result };
    // 插件直接返回结果对象（无 ok 包装）
    if (r.ok === undefined && r.errorType === undefined) return { result: raw };
  }
  return { result: raw };
}

function codeForType(errorType: string): number {
  const map: Record<string, number> = {
    ELEMENT_NOT_FOUND: -32001,
    STALE_ELEMENT_REFERENCE: -32002,
    OPERATION_TIMEOUT: -32003,
    NAVIGATION_INTERRUPTED: -32004,
    UNSUPPORTED_PAGE: -32005,
    PERMISSION_DENIED: -32006,
    SESSION_EXPIRED: -32007,
    CONFIRMATION_REQUIRED: -32008,
    CONFIRMATION_DENIED: -32009,
    RATE_LIMITED: -32010,
    INVALID_ELEMENT_STATE: -32011,
    BRIDGE_UNAVAILABLE: -32012,
    AMBIGUOUS_LOCATOR: -32013,
    STALE_CONFIRMATION: -32014,
    OPERATION_OUTCOME_UNKNOWN: -32015,
    DUPLICATE_OPERATION: -32016,
    OPERATION_ID_CONFLICT: -32017,
    VERIFICATION_FAILED: -32018,
    TAB_NOT_FOUND: -32019,
    UNSUPPORTED_PROTOCOL_VERSION: -32020,
    INVALID_PARAMS: -32602,
    METHOD_NOT_FOUND: -32601,
    INTERNAL_ERROR: -32603
  };
  return map[errorType] ?? -32603;
}
