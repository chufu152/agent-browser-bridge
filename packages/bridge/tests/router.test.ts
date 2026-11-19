// M2 本地通信系统单元测试 — 覆盖认证、会话、去重、路由。

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager } from '../src/auth/index';
import { SessionManager } from '../src/session/index';
import { OperationStore } from '../src/dedup/index';
import { AuditLog } from '../src/audit/index';
import { JsonRpcRouter } from '../src/router/index';
import type { ExtensionTransport } from '../src/transport/index';

describe('TokenManager - 认证', () => {
  let tm: TokenManager;
  beforeEach(() => { tm = new TokenManager(); });

  it('签发并验证成功', () => {
    const token = tm.issue('agent-a');
    expect(tm.verify(token)).toBe('agent-a');
  });

  it('错误 token 返回 null', () => {
    tm.issue('agent-a');
    expect(tm.verify('wrong-token')).toBeNull();
  });

  it('撤销后验证失败', () => {
    const token = tm.issue('agent-a');
    expect(tm.revoke('agent-a')).toBe(true);
    expect(tm.verify(token)).toBeNull();
  });

  it('不同 Agent token 互不干扰', () => {
    const a = tm.issue('agent-a');
    const b = tm.issue('agent-b');
    expect(tm.verify(a)).toBe('agent-a');
    expect(tm.verify(b)).toBe('agent-b');
  });
});

describe('SessionManager - 会话', () => {
  it('创建并可获取', () => {
    const sm = new SessionManager();
    const s = sm.create('agent-a');
    expect(sm.get(s.sessionId)?.agentId).toBe('agent-a');
  });

  it('过期后失效', () => {
    const sm = new SessionManager(10); // 10ms
    const s = sm.create('agent-a');
    // 直接推进过期时间
    (sm as any).sessions.get(s.sessionId).expiresAt = Date.now() - 1;
    expect(sm.get(s.sessionId)).toBeNull();
  });

  it('撤销 Agent 全部会话', () => {
    const sm = new SessionManager();
    const s1 = sm.create('agent-a');
    const s2 = sm.create('agent-a');
    const s3 = sm.create('agent-b');
    sm.revokeAllForAgent('agent-a');
    expect(sm.get(s1.sessionId)).toBeNull();
    expect(sm.get(s2.sessionId)).toBeNull();
    expect(sm.get(s3.sessionId)).not.toBeNull();
  });
});

describe('OperationStore - 去重', () => {
  let store: OperationStore;
  beforeEach(() => { store = new OperationStore(); });

  it('首次操作为 new', () => {
    const fp = store.fingerprint({ a: 1 });
    expect(store.resolve('op1', 'agent-a', fp).action).toBe('new');
  });

  it('相同参数重复为 duplicate，不同参数为 conflict', () => {
    const fp = store.fingerprint({ a: 1 });
    store.put({ operationId: 'op1', agentId: 'agent-a', status: 'completed', paramsFingerprint: fp, createdAt: Date.now(), updatedAt: Date.now() });
    expect(store.resolve('op1', 'agent-a', fp).action).toBe('duplicate');
    expect(store.resolve('op1', 'agent-a', store.fingerprint({ a: 2 })).action).toBe('conflict');
  });

  it('跨 Agent 使用同一 operationId 为 conflict', () => {
    const fp = store.fingerprint({ a: 1 });
    store.put({ operationId: 'op1', agentId: 'agent-a', status: 'completed', paramsFingerprint: fp, createdAt: Date.now(), updatedAt: Date.now() });
    expect(store.resolve('op1', 'agent-b', fp).action).toBe('conflict');
  });

  it('waiting_confirmation 允许 resume', () => {
    const fp = store.fingerprint({ a: 1 });
    store.put({ operationId: 'op1', agentId: 'agent-a', status: 'waiting_confirmation', paramsFingerprint: fp, createdAt: Date.now(), updatedAt: Date.now() });
    expect(store.resolve('op1', 'agent-a', fp).action).toBe('resume');
  });
});

describe('JsonRpcRouter - 路由与接入', () => {
  let deps: any;
  let router: JsonRpcRouter;
  let transportCalls: any[];

  beforeEach(() => {
    transportCalls = [];
    const mockTransport: ExtensionTransport = {
      send: async (cmd) => {
        transportCalls.push(cmd);
        return { ok: true, result: { url: 'https://example.com', title: 'Example', elements: [] } };
      },
      onDisconnect: () => {}
    };
    const tm = new TokenManager();
    const sm = new SessionManager();
    const store = new OperationStore();
    const audit = new AuditLog();
    deps = { tm, sm, store, audit, mockTransport };
    router = new JsonRpcRouter({
      tokens: tm,
      sessions: sm,
      operations: store,
      audit,
      getTransport: () => mockTransport
    });
  });

  it('错误 token 认证失败（PERMISSION_DENIED）', async () => {
    const res = await router.handle({
      jsonrpc: '2.0', id: 1, method: 'browser.connect',
      params: { agentId: 'agent-a', token: 'bad', protocolVersion: '1.0' }
    });
    expect(res.error?.data?.errorType).toBe('PERMISSION_DENIED');
  });

  it('正确 token 建立会话', async () => {
    const token = deps.tm.issue('agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 1, method: 'browser.connect',
      params: { agentId: 'agent-a', token, protocolVersion: '1.0' }
    });
    expect(res.result).toBeDefined();
    expect((res.result as any).sessionId).toMatch(/^ses_/);
  });

  it('未认证会话请求被拒绝（SESSION_EXPIRED）', async () => {
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'browser.getSnapshot', params: { sessionId: 'ses_bogus', tabId: 1 }
    });
    expect(res.error?.data?.errorType).toBe('SESSION_EXPIRED');
  });

  it('只读方法经认证后转发到插件', async () => {
    const token = deps.tm.issue('agent-a');
    const conn = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '1.0' } });
    const sessionId = (conn.result as any).sessionId;
    const res = await router.handle({ jsonrpc: '2.0', id: 2, method: 'browser.getSnapshot', params: { sessionId, tabId: 1 } });
    expect(res.result).toBeDefined();
    expect(transportCalls.length).toBe(1);
    expect(transportCalls[0].method).toBe('browser.getSnapshot');
  });

  it('写方法缺少 operationId 被拒绝', async () => {
    const token = deps.tm.issue('agent-a');
    const conn = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '1.0' } });
    const sessionId = (conn.result as any).sessionId;
    const res = await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params: { sessionId, tabId: 1, locator: { ref: 'x' } } });
    expect(res.error?.data?.errorType).toBe('INVALID_PARAMS');
  });

  it('相同 operationId 相同参数返回去重结果', async () => {
    const token = deps.tm.issue('agent-a');
    const conn = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '1.0' } });
    const sessionId = (conn.result as any).sessionId;
    const params = { sessionId, tabId: 1, operationId: 'op-1', locator: { ref: 'x' } };
    const first = await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params });
    expect(first.result).toBeDefined();
    const second = await router.handle({ jsonrpc: '2.0', id: 3, method: 'locator.click', params });
    expect(second.result).toBeDefined();
    // 只转发一次到插件
    expect(transportCalls.length).toBe(1);
  });

  it('相同 operationId 不同参数返回冲突', async () => {
    const token = deps.tm.issue('agent-a');
    const conn = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '1.0' } });
    const sessionId = (conn.result as any).sessionId;
    await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params: { sessionId, tabId: 1, operationId: 'op-1', locator: { ref: 'x' } } });
    const res = await router.handle({ jsonrpc: '2.0', id: 3, method: 'locator.click', params: { sessionId, tabId: 2, operationId: 'op-1', locator: { ref: 'x' } } });
    expect(res.error?.data?.errorType).toBe('OPERATION_ID_CONFLICT');
  });

  it('browser.getOperation 可查询本地操作结果', async () => {
    const token = deps.tm.issue('agent-a');
    const conn = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '1.0' } });
    const sessionId = (conn.result as any).sessionId;
    await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params: { sessionId, tabId: 1, operationId: 'op-1', locator: { ref: 'x' } } });
    const res = await router.handle({ jsonrpc: '2.0', id: 3, method: 'browser.getOperation', params: { sessionId, operationId: 'op-1' } });
    expect((res.result as any).status).toBe('completed');
  });

  it('插件断开后返回 BRIDGE_UNAVAILABLE', async () => {
    const tm = new TokenManager();
    const sm = new SessionManager();
    const router2 = new JsonRpcRouter({
      tokens: tm, sessions: sm, operations: new OperationStore(), audit: new AuditLog(),
      getTransport: () => null
    });
    const token = tm.issue('agent-a');
    const conn = await router2.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '1.0' } });
    const sessionId = (conn.result as any).sessionId;
    const res = await router2.handle({ jsonrpc: '2.0', id: 2, method: 'browser.getSnapshot', params: { sessionId, tabId: 1 } });
    expect(res.error?.data?.errorType).toBe('BRIDGE_UNAVAILABLE');
  });

  it('不支持的协议主版本被拒绝', async () => {
    const token = deps.tm.issue('agent-a');
    const res = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId: 'agent-a', token, protocolVersion: '2.0' } });
    expect(res.error?.data?.errorType).toBe('UNSUPPORTED_PROTOCOL_VERSION');
  });
});
