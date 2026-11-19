// JSON-RPC 路由 — BCP V1.0 统一入口（M3：集成风险分类、人工确认、事件订阅、多 Agent 隔离）。
// 职责：外层校验 → 认证/会话 → 方法能力 → 参数 → 风险/确认 → 去重 → 路由（本地或转发插件）。

import { TokenManager } from '../auth/index';
import { SessionManager } from '../session/index';
import { OperationStore } from '../dedup/index';
import { AuditLog } from '../audit/index';
import { ConfirmationManager } from '../confirm/index';
import { EventBus, type EventType } from '../events/index';
import { classifyRisk, describeRisk, type RiskLevel } from '../risk/index';
import { RateLimiter } from '../ratelimit/index';
import { SmartWait } from '../smart-wait/index';
import type { ExtensionTransport } from '../transport/index';

export interface ConnectParams {
  agentId: string;
  token: string;
  protocolVersion: string;
  clientName?: string;
}

export interface RouteResult {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

const PROTOCOL_VERSION = '1.0';

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

export interface RouterDeps {
  tokens: TokenManager;
  sessions: SessionManager;
  operations: OperationStore;
  audit: AuditLog;
  confirmations: ConfirmationManager;
  events: EventBus;
  getTransport: () => ExtensionTransport | null;
}

interface SessionRef {
  agentId: string;
  sessionId: string;
}

export class JsonRpcRouter {
  private readonly rateLimiter = new RateLimiter();
  private readonly smartWait: SmartWait;

  constructor(private readonly deps: RouterDeps) {
    this.smartWait = new SmartWait(() => deps.getTransport());
  }

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

  private async dispatch(msg: { id?: string | number; method: string; params?: unknown }): Promise<RouteResult> {
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
    const id = msg.id ?? null;

    if (msg.method === 'browser.connect') {
      return this.handleConnect(id, params);
    }

    const sessionId = params.sessionId as string | undefined;
    if (!sessionId) return this.err(id, -32007, 'SESSION_EXPIRED', 'sessionId is required');
    const session = this.deps.sessions.get(sessionId);
    if (!session) return this.err(id, -32007, 'SESSION_EXPIRED', 'Session is invalid or expired');
    const sessionRef: SessionRef = { agentId: session.agentId, sessionId };

    // 速率限制
    const rl = this.rateLimiter.check(sessionId);
    if (!rl.allowed) {
      return this.err(id, -32010, 'RATE_LIMITED', 'Rate limit exceeded', { retryAfterMs: rl.retryAfterMs });
    }

    // 本地方法（不转发插件）
    if (msg.method === 'browser.getOperation') return this.localGetOperation(id, params, sessionRef);
    if (msg.method === 'page.subscribe') return this.localSubscribe(id, params, sessionRef);
    if (msg.method === 'page.unsubscribe') return this.localUnsubscribe(id, params, sessionRef);
    if (msg.method === 'browser.getEvents') return this.localGetEvents(id, params, sessionRef);

    // 智能等待（桥接层轮询）
    if (msg.method === 'page.waitForSelector' || msg.method === 'page.waitForText' || msg.method === 'page.waitForNavigation') {
      return this.handleWait(msg, params, sessionRef);
    }

    // 批量执行
    if (msg.method === 'browser.batch') {
      return this.handleBatch(msg, params, sessionRef);
    }

    // 写方法：风险 + 确认 + 去重
    if (WRITE_METHODS.has(msg.method)) {
      return this.handleWrite(msg, params, sessionRef);
    }

    // 只读方法直接路由
    return this.route(msg, sessionRef, params);
  }

  // ---------------- 本地方法 ----------------

  private localGetOperation(id: string | number | null, params: Record<string, unknown>, session: SessionRef): RouteResult {
    const op = this.deps.operations.get(params.operationId as string);
    if (!op || op.agentId !== session.agentId) {
      return this.err(id, -32001, 'ELEMENT_NOT_FOUND', 'Operation not found');
    }
    return { jsonrpc: '2.0', id, result: { operationId: op.operationId, status: op.status, result: op.result, error: op.error } };
  }

  private localSubscribe(id: string | number | null, params: Record<string, unknown>, session: SessionRef): RouteResult {
    const eventTypes = (params.eventTypes as EventType[] | undefined) ?? [];
    const tabId = params.tabId as number | undefined;
    const sub = this.deps.events.subscribe(session.sessionId, session.agentId, eventTypes, tabId);
    return { jsonrpc: '2.0', id, result: { subscriptionId: sub.subscriptionId, initialCursor: 'cur_0' } };
  }

  private localUnsubscribe(id: string | number | null, params: Record<string, unknown>, _session: SessionRef): RouteResult {
    const ok = this.deps.events.unsubscribe(params.subscriptionId as string);
    return { jsonrpc: '2.0', id, result: { unsubscribed: ok } };
  }

  private localGetEvents(id: string | number | null, params: Record<string, unknown>, session: SessionRef): RouteResult {
    const res = this.deps.events.getEvents(session.sessionId, params.cursor as string | undefined, (params.limit as number) ?? 100);
    return { jsonrpc: '2.0', id, result: res };
  }

  // ---------------- 智能等待 ----------------

  private async handleWait(
    msg: { id?: string | number; method: string },
    params: Record<string, unknown>,
    session: SessionRef
  ): Promise<RouteResult> {
    const id = msg.id ?? null;
    const tabId = params.tabId as number;
    if (tabId === undefined) return this.err(id, -32602, 'INVALID_PARAMS', 'tabId is required');
    const opts = { tabId, sessionId: session.sessionId, timeoutMs: params.timeoutMs as number | undefined, pollMs: params.pollMs as number | undefined };
    try {
      let result;
      if (msg.method === 'page.waitForSelector') result = await this.smartWait.waitForSelector(opts, (params.locator ?? {}) as Record<string, unknown>);
      else if (msg.method === 'page.waitForText') result = await this.smartWait.waitForText(opts, params.text as string);
      else result = await this.smartWait.waitForNavigation(opts, params.fromUrl as string);
      if (!result.matched) {
        return this.err(id, -32003, 'OPERATION_TIMEOUT', 'Wait condition not met within timeout', { elapsedMs: result.elapsedMs });
      }
      return { jsonrpc: '2.0', id, result };
    } catch {
      return this.err(id, -32012, 'BRIDGE_UNAVAILABLE', 'Extension is not connected');
    }
  }

  // ---------------- 批量执行 ----------------

  private async handleBatch(
    msg: { id?: string | number },
    params: Record<string, unknown>,
    session: SessionRef
  ): Promise<RouteResult> {
    const id = msg.id ?? null;
    const operationId = params.operationId as string | undefined;
    if (!operationId) return this.err(id, -32602, 'INVALID_PARAMS', 'operationId is required');
    const tabId = params.tabId as number;
    const actions = Array.isArray(params.actions) ? (params.actions as any[]) : [];
    const stopOnError = params.stopOnError !== false;

    const transport = this.deps.getTransport();
    if (!transport) return this.err(id, -32012, 'BRIDGE_UNAVAILABLE', 'Extension is not connected');

    const results: Array<Record<string, unknown>> = [];
    let stopped = false;

    for (let i = 0; i < actions.length; i++) {
      if (stopped) {
        results.push({ index: i, status: 'skipped' });
        continue;
      }
      const action = actions[i] as any;
      const method = methodForAction(action?.type);
      if (!method) {
        results.push({ index: i, status: 'failed', error: { errorType: 'INVALID_PARAMS', message: 'Unknown action type' } });
        if (stopOnError) stopped = true;
        continue;
      }

      // 逐动作风险分类（前序操作可能改变后续风险）
      const risk = classifyRisk(method, { locator: action.locator, tabId });
      if (risk === 'high') {
        results.push({
          index: i,
          status: 'blocked',
          error: { errorType: 'CONFIRMATION_REQUIRED', message: 'High-risk action requires separate submission', requiresSeparateSubmission: true }
        });
        stopped = true;
        continue;
      }

      const subOpId = `${operationId}_${i}`;
      try {
        const res = await transport.send({
          method,
          params: {
            sessionId: session.sessionId,
            tabId,
            operationId: subOpId,
            locator: action.locator,
            value: action.value,
            text: action.text,
            key: action.key,
            option: action.option
          }
        });
        const norm = normalizePluginResult(res);
        if (norm.error) {
          results.push({ index: i, status: 'failed', error: norm.error });
          if (stopOnError) stopped = true;
        } else {
          results.push({ index: i, status: 'completed', result: norm.result });
        }
      } catch (e) {
        results.push({ index: i, status: 'failed', error: { errorType: 'BRIDGE_UNAVAILABLE', message: String(e) } });
        if (stopOnError) stopped = true;
      }
    }

    const completedCount = results.filter((r) => r.status === 'completed').length;
    const status = completedCount === results.length ? 'completed' : completedCount > 0 ? 'partial' : 'failed';

    return {
      jsonrpc: '2.0',
      id,
      result: { operationId, tabId, status, transactional: false, actions: results }
    };
  }

  // ---------------- 写方法：风险 + 确认 + 去重 ----------------

  private async handleWrite(
    msg: { id?: string | number; method: string },
    params: Record<string, unknown>,
    session: SessionRef
  ): Promise<RouteResult> {
    const id = msg.id ?? null;
    const operationId = params.operationId as string | undefined;
    if (!operationId) {
      return this.err(id, -32602, 'INVALID_PARAMS', 'operationId is required for write operations');
    }

    // 操作指纹只计算业务参数，排除控制字段（sessionId / confirmationId / confirmationGrant），
    // 使“首次请求”与“携带确认编号重新提交”得到同一指纹。
    const fp = this.businessFingerprint(params);

    // 风险分类
    const risk: RiskLevel = classifyRisk(msg.method, params);

    // 高风险：需人工确认
    if (risk === 'high') {
      const confirmationId = params.confirmationId as string | undefined;
      if (!confirmationId) {
        // 首次：创建确认，返回 CONFIRMATION_REQUIRED
        const c = this.deps.confirmations.request(session.agentId, session.sessionId, operationId, fp, msg.method, describeRisk(msg.method, params));
        this.deps.operations.put({
          operationId,
          agentId: session.agentId,
          status: 'waiting_confirmation',
          paramsFingerprint: fp,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        this.deps.events.emit(session.sessionId, 'operation.confirmationRequired', {
          confirmationId: c.confirmationId,
          operationId,
          expiresAt: c.expiresAt
        });
        this.deps.audit.record({
          ts: new Date().toISOString(), agentId: session.agentId, sessionId: session.sessionId,
          method: msg.method, tabId: params.tabId as number | undefined, risk: 'high', outcome: 'error',
          errorType: 'CONFIRMATION_REQUIRED'
        });
        return this.err(id, -32008, 'CONFIRMATION_REQUIRED', 'High-risk action requires user confirmation', {
          confirmationId: c.confirmationId,
          expiresAt: c.expiresAt
        });
      }
      // 重新提交：校验确认编号
      const valid = this.deps.confirmations.validateForResubmit(session.agentId, session.sessionId, operationId, fp, confirmationId);
      if (!valid.ok) {
        const type = valid.reason === 'denied' ? 'CONFIRMATION_DENIED' : 'STALE_CONFIRMATION';
        return this.err(id, type === 'CONFIRMATION_DENIED' ? -32009 : -32014, type, 'Confirmation is ' + valid.reason);
      }
      // 已确认：附加授权标记，交给插件执行（插件据此跳过本地高风险检查）
      params = { ...params, confirmationGrant: true };
    }

    // 去重
    const resolved = this.deps.operations.resolve(operationId, session.agentId, fp);
    if (resolved.action === 'conflict') {
      return this.err(id, -32017, 'OPERATION_ID_CONFLICT', 'Same operationId with different parameters');
    }
    if (resolved.action === 'duplicate' && resolved.state) {
      if (resolved.state.status === 'processing') return this.err(id, -32016, 'DUPLICATE_OPERATION', 'Operation is already processing');
      if (resolved.state.status === 'completed') return { jsonrpc: '2.0', id, result: resolved.state.result };
      if (resolved.state.status === 'failed') return this.err(id, -32015, resolved.state.error?.errorType ?? 'OPERATION_OUTCOME_UNKNOWN', 'Operation previously failed');
      if (resolved.state.status === 'unknown') return this.err(id, -32015, 'OPERATION_OUTCOME_UNKNOWN', 'Operation outcome is unknown');
      // waiting_confirmation / confirmed_pending_retry 已被上面的确认逻辑处理
    }
    if (resolved.action === 'new') {
      this.deps.operations.put({
        operationId, agentId: session.agentId, status: 'processing',
        paramsFingerprint: fp, createdAt: Date.now(), updatedAt: Date.now()
      });
    } else {
      // resume：更新状态为 processing（确认后执行）
      this.deps.operations.update(operationId, { status: 'processing' });
    }

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

  // ---------------- 路由转发 ----------------

  private async route(
    msg: { id?: string | number; method: string },
    session: SessionRef,
    params: Record<string, unknown>
  ): Promise<RouteResult> {
    const id = msg.id ?? null;
    const transport = this.deps.getTransport();
    if (!transport) {
      return this.err(id, -32012, 'BRIDGE_UNAVAILABLE', 'Extension is not connected');
    }

    const risk = classifyRisk(msg.method, params);
    try {
      const result = await transport.send({ method: msg.method, params });
      const normalized = normalizePluginResult(result);
      this.deps.audit.record({
        ts: new Date().toISOString(), agentId: session.agentId, sessionId: session.sessionId,
        method: msg.method, tabId: params.tabId as number | undefined, risk,
        outcome: normalized.error ? 'error' : 'ok', errorType: normalized.error?.errorType
      });
      if (normalized.error) {
        return this.err(id, codeForType(normalized.error.errorType), normalized.error.errorType, normalized.error.message ?? 'Operation failed');
      }
      return { jsonrpc: '2.0', id, result: normalized.result };
    } catch (e) {
      return this.err(id, -32012, 'BRIDGE_UNAVAILABLE', String(e));
    }
  }

  // ---------------- 连接认证 ----------------

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
      result: { sessionId: session.sessionId, protocolVersion: PROTOCOL_VERSION, serverTime: new Date().toISOString() }
    };
  }

  // ---------------- 管理员确认（仅本地界面/插件可调用，Agent 路由不可达） ----------------

  adminResolveConfirmation(confirmationId: string, approved: boolean): boolean {
    const c = this.deps.confirmations.get(confirmationId);
    const ok = approved ? this.deps.confirmations.approve(confirmationId) : this.deps.confirmations.deny(confirmationId);
    if (ok && c) {
      this.deps.events.emit(c.sessionId, 'operation.confirmationResolved', {
        confirmationId,
        operationId: c.operationId,
        approved
      });
    }
    return ok;
  }

  /** 业务指纹：排除控制字段，使首次请求与确认后重提得到同一指纹 */
  private businessFingerprint(params: Record<string, unknown>): string {
    const { sessionId: _s, confirmationId: _c, confirmationGrant: _g, ...business } = params;
    return this.deps.operations.fingerprint(business);
  }

  private err(id: string | number | null, code: number, errorType: string, message: string, extra?: Record<string, unknown>): RouteResult {
    return { jsonrpc: '2.0', id, error: { code, message, data: { errorType, ...extra } } };
  }
}

interface NormalizedResult {
  result?: unknown;
  error?: { errorType: string; message?: string };
}

function methodForAction(type: string | undefined): string | null {
  const map: Record<string, string> = {
    click: 'locator.click',
    fill: 'locator.fill',
    type: 'locator.type',
    clear: 'locator.clear',
    press: 'locator.press',
    hover: 'locator.hover',
    check: 'locator.check',
    uncheck: 'locator.uncheck',
    selectOption: 'locator.selectOption',
    scrollIntoView: 'locator.scrollIntoView'
  };
  return map[type ?? ''] ?? null;
}

function normalizePluginResult(raw: unknown): NormalizedResult {
  if (raw && typeof raw === 'object') {
    const r = raw as { ok?: boolean; errorType?: string; error?: string; result?: unknown };
    if (r.ok === false) return { error: { errorType: r.errorType ?? 'INTERNAL_ERROR', message: r.error } };
    if (r.result !== undefined) return { result: r.result };
    if (r.ok === undefined && r.errorType === undefined) return { result: raw };
  }
  return { result: raw };
}

function codeForType(errorType: string): number {
  const map: Record<string, number> = {
    ELEMENT_NOT_FOUND: -32001, STALE_ELEMENT_REFERENCE: -32002, OPERATION_TIMEOUT: -32003,
    NAVIGATION_INTERRUPTED: -32004, UNSUPPORTED_PAGE: -32005, PERMISSION_DENIED: -32006,
    SESSION_EXPIRED: -32007, CONFIRMATION_REQUIRED: -32008, CONFIRMATION_DENIED: -32009,
    RATE_LIMITED: -32010, INVALID_ELEMENT_STATE: -32011, BRIDGE_UNAVAILABLE: -32012,
    AMBIGUOUS_LOCATOR: -32013, STALE_CONFIRMATION: -32014, OPERATION_OUTCOME_UNKNOWN: -32015,
    DUPLICATE_OPERATION: -32016, OPERATION_ID_CONFLICT: -32017, VERIFICATION_FAILED: -32018,
    TAB_NOT_FOUND: -32019, UNSUPPORTED_PROTOCOL_VERSION: -32020,
    INVALID_PARAMS: -32602, METHOD_NOT_FOUND: -32601, INTERNAL_ERROR: -32603
  };
  return map[errorType] ?? -32603;
}
