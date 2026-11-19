// M2 + M3 通信系统单元测试 — 认证、会话、去重、路由、高风险确认、事件、多 Agent 隔离。

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager } from '../src/auth/index';
import { SessionManager } from '../src/session/index';
import { OperationStore } from '../src/dedup/index';
import { AuditLog } from '../src/audit/index';
import { ConfirmationManager } from '../src/confirm/index';
import { EventBus } from '../src/events/index';
import { JsonRpcRouter } from '../src/router/index';
import type { ExtensionTransport } from '../src/transport/index';

function makeDeps(transport: ExtensionTransport | null) {
  const tm = new TokenManager();
  const sm = new SessionManager();
  const store = new OperationStore();
  const audit = new AuditLog();
  const confirmations = new ConfirmationManager();
  const events = new EventBus();
  return { tm, sm, store, audit, confirmations, events, transport };
}

async function connect(router: JsonRpcRouter, tm: TokenManager, agentId: string, id = 1) {
  const token = tm.issue(agentId);
  const res = await router.handle({
    jsonrpc: '2.0', id, method: 'browser.connect',
    params: { agentId, token, protocolVersion: '1.0' }
  });
  return (res.result as any).sessionId as string;
}

describe('TokenManager - 认证', () => {
  let tm: TokenManager;
  beforeEach(() => { tm = new TokenManager(); });
  it('签发并验证成功', () => {
    const token = tm.issue('agent-a');
    expect(tm.verify(token)).toBe('agent-a');
  });
  it('错误 token 返回 null', () => {
    tm.issue('agent-a');
    expect(tm.verify('wrong')).toBeNull();
  });
  it('撤销后验证失败', () => {
    const token = tm.issue('agent-a');
    tm.revoke('agent-a');
    expect(tm.verify(token)).toBeNull();
  });
});

describe('SessionManager - 会话', () => {
  it('创建/获取/撤销', () => {
    const sm = new SessionManager();
    const s = sm.create('agent-a');
    expect(sm.get(s.sessionId)?.agentId).toBe('agent-a');
    sm.revoke(s.sessionId);
    expect(sm.get(s.sessionId)).toBeNull();
  });
});

describe('OperationStore - 去重', () => {
  it('new / duplicate / conflict / resume', () => {
    const store = new OperationStore();
    const fp = store.fingerprint({ a: 1 });
    expect(store.resolve('op1', 'agent-a', fp).action).toBe('new');
    store.put({ operationId: 'op1', agentId: 'agent-a', status: 'completed', paramsFingerprint: fp, createdAt: Date.now(), updatedAt: Date.now() });
    expect(store.resolve('op1', 'agent-a', fp).action).toBe('duplicate');
    expect(store.resolve('op1', 'agent-a', store.fingerprint({ a: 2 })).action).toBe('conflict');
    store.update('op1', { status: 'waiting_confirmation' });
    expect(store.resolve('op1', 'agent-a', fp).action).toBe('resume');
  });
});

describe('ConfirmationManager - 高风险确认闭环', () => {
  let cm: ConfirmationManager;
  beforeEach(() => { cm = new ConfirmationManager(); });

  it('请求 → 确认 → 校验通过', () => {
    const c = cm.request('a', 's1', 'op1', 'fp1', 'locator.click', { target: '确认支付' });
    expect(c.status).toBe('pending');
    expect(cm.approve(c.confirmationId)).toBe(true);
    expect(cm.validateForResubmit('a', 's1', 'op1', 'fp1', c.confirmationId).ok).toBe(true);
  });

  it('拒绝后校验失败（denied）', () => {
    const c = cm.request('a', 's1', 'op1', 'fp1', 'locator.click', {});
    cm.deny(c.confirmationId);
    const v = cm.validateForResubmit('a', 's1', 'op1', 'fp1', c.confirmationId);
    expect(v.ok).toBe(false);
    expect((v as any).reason).toBe('denied');
  });

  it('跨 Agent/会话/参数复用确认编号失败（stale）', () => {
    const c = cm.request('a', 's1', 'op1', 'fp1', 'locator.click', {});
    cm.approve(c.confirmationId);
    expect(cm.validateForResubmit('b', 's1', 'op1', 'fp1', c.confirmationId).ok).toBe(false);
    expect(cm.validateForResubmit('a', 's2', 'op1', 'fp1', c.confirmationId).ok).toBe(false);
    expect(cm.validateForResubmit('a', 's1', 'op1', 'fp2', c.confirmationId).ok).toBe(false);
  });
});

describe('EventBus - 事件', () => {
  it('事件序列单调递增，getEvents 按游标返回', () => {
    const eb = new EventBus();
    eb.subscribe('s1', 'a', ['page.changed']);
    const e1 = eb.emit('s1', 'page.changed', {});
    const e2 = eb.emit('s1', 'page.changed', {});
    expect(e1!.sequence).toBe(1);
    expect(e2!.sequence).toBe(2);
    const res = eb.getEvents('s1', 'cur_0');
    expect(res.events.length).toBe(2);
    expect(res.nextCursor).toBe('cur_2');
  });

  it('订阅过滤 + 会话隔离', () => {
    const eb = new EventBus();
    eb.subscribe('s1', 'a', ['page.changed']);
    eb.subscribe('s2', 'b', ['page.changed']);
    eb.emit('s1', 'page.changed', {});
    expect(eb.getEvents('s1', 'cur_0').events.length).toBe(1);
    expect(eb.getEvents('s2', 'cur_0').events.length).toBe(0);
  });
});

describe('JsonRpcRouter - 高风险确认与多 Agent 隔离', () => {
  let deps: ReturnType<typeof makeDeps>;
  let router: JsonRpcRouter;
  let transportCalls: any[];

  beforeEach(() => {
    transportCalls = [];
    const transport: ExtensionTransport = {
      send: async (cmd) => {
        transportCalls.push(cmd);
        return { ok: true, result: { clicked: true } };
      },
      onDisconnect: () => {}
    };
    deps = makeDeps(transport);
    router = new JsonRpcRouter({
      tokens: deps.tm, sessions: deps.sm, operations: deps.store, audit: deps.audit,
      confirmations: deps.confirmations, events: deps.events, getTransport: () => transport
    });
  });

  it('高风险点击首次返回 CONFIRMATION_REQUIRED 且不转发插件', async () => {
    const sessionId = await connect(router, deps.tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'locator.click',
      params: { sessionId, tabId: 1, operationId: 'op-1', locator: { role: 'button', name: '确认支付' } }
    });
    expect(res.error?.data?.errorType).toBe('CONFIRMATION_REQUIRED');
    expect((res.error?.data as any).confirmationId).toMatch(/^cfm_/);
    expect(transportCalls.length).toBe(0); // 未执行
  });

  it('确认后携带 confirmationId 重新提交才执行', async () => {
    const sessionId = await connect(router, deps.tm, 'agent-a');
    const params = { sessionId, tabId: 1, operationId: 'op-1', locator: { role: 'button', name: '确认支付' } };
    const first = await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params });
    const confirmationId = (first.error?.data as any).confirmationId;
    // 管理员确认（本地界面）
    router.adminResolveConfirmation(confirmationId, true);
    // Agent 重新提交
    const second = await router.handle({ jsonrpc: '2.0', id: 3, method: 'locator.click', params: { ...params, confirmationId } });
    expect(second.result).toBeDefined();
    expect(transportCalls.length).toBe(1);
    expect((transportCalls[0].params as any).confirmationGrant).toBe(true);
  });

  it('用户拒绝后重新提交返回 CONFIRMATION_DENIED', async () => {
    const sessionId = await connect(router, deps.tm, 'agent-a');
    const params = { sessionId, tabId: 1, operationId: 'op-1', locator: { role: 'button', name: '删除账号' } };
    const first = await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params });
    const confirmationId = (first.error?.data as any).confirmationId;
    router.adminResolveConfirmation(confirmationId, false);
    const second = await router.handle({ jsonrpc: '2.0', id: 3, method: 'locator.click', params: { ...params, confirmationId } });
    expect(second.error?.data?.errorType).toBe('CONFIRMATION_DENIED');
    expect(transportCalls.length).toBe(0);
  });

  it('伪造 confirmationId 返回 STALE_CONFIRMATION', async () => {
    const sessionId = await connect(router, deps.tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'locator.click',
      params: { sessionId, tabId: 1, operationId: 'op-1', locator: { role: 'button', name: '确认支付' }, confirmationId: 'cfm_forged' }
    });
    expect(res.error?.data?.errorType).toBe('STALE_CONFIRMATION');
  });

  it('多 Agent 隔离：Agent B 无法查询 Agent A 的操作', async () => {
    const sessionA = await connect(router, deps.tm, 'agent-a', 1);
    await router.handle({ jsonrpc: '2.0', id: 2, method: 'locator.click', params: { sessionId: sessionA, tabId: 1, operationId: 'op-a', locator: { ref: 'x' } } });
    const sessionB = await connect(router, deps.tm, 'agent-b', 3);
    const res = await router.handle({ jsonrpc: '2.0', id: 4, method: 'browser.getOperation', params: { sessionId: sessionB, operationId: 'op-a' } });
    expect(res.error?.data?.errorType).toBe('ELEMENT_NOT_FOUND');
  });

  it('事件订阅与查询（会话内）', async () => {
    const sessionId = await connect(router, deps.tm, 'agent-a');
    const sub = await router.handle({ jsonrpc: '2.0', id: 2, method: 'page.subscribe', params: { sessionId, eventTypes: ['page.changed'] } });
    expect((sub.result as any).subscriptionId).toMatch(/^sub_/);
    const ev = await router.handle({ jsonrpc: '2.0', id: 3, method: 'browser.getEvents', params: { sessionId, cursor: 'cur_0' } });
    expect((ev.result as any).events).toBeDefined();
  });
});
