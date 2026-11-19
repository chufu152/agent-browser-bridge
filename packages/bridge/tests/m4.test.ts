// M4 性能与规模优化单元测试 — 批量执行、智能等待、速率限制。

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager } from '../src/auth/index';
import { SessionManager } from '../src/session/index';
import { OperationStore } from '../src/dedup/index';
import { AuditLog } from '../src/audit/index';
import { ConfirmationManager } from '../src/confirm/index';
import { EventBus } from '../src/events/index';
import { RateLimiter } from '../src/ratelimit/index';
import { JsonRpcRouter } from '../src/router/index';
import type { ExtensionTransport } from '../src/transport/index';

async function connect(router: JsonRpcRouter, tm: TokenManager, agentId: string) {
  const token = tm.issue(agentId);
  const res = await router.handle({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId, token, protocolVersion: '1.0' } });
  return (res.result as any).sessionId as string;
}

describe('RateLimiter - 限流', () => {
  it('超限后拒绝（RATE_LIMITED）', () => {
    const rl = new RateLimiter(1, 0); // 容量 1，无补充
    expect(rl.check('s1').allowed).toBe(true);
    expect(rl.check('s1').allowed).toBe(false);
  });

  it('不同会话互不影响', () => {
    const rl = new RateLimiter(1, 0);
    expect(rl.check('s1').allowed).toBe(true);
    expect(rl.check('s2').allowed).toBe(true);
  });
});

describe('JsonRpcRouter - 批量执行', () => {
  let router: JsonRpcRouter;
  let tm: TokenManager;
  let transportCalls: any[];
  let transport: ExtensionTransport;

  beforeEach(() => {
    transportCalls = [];
    transport = {
      send: async (cmd) => {
        transportCalls.push(cmd);
        if (cmd.method === 'locator.fill' && (cmd.params as any).value === 'FAIL') {
          return { ok: false, errorType: 'INVALID_ELEMENT_STATE', error: 'cannot fill' };
        }
        return { ok: true, result: { ok: true } };
      },
      onDisconnect: () => {}
    };
    tm = new TokenManager();
    router = new JsonRpcRouter({
      tokens: tm, sessions: new SessionManager(), operations: new OperationStore(), audit: new AuditLog(),
      confirmations: new ConfirmationManager(), events: new EventBus(), getTransport: () => transport
    });
  });

  it('顺序批量执行，逐项结果完整', async () => {
    const sessionId = await connect(router, tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'browser.batch',
      params: {
        sessionId, tabId: 1, operationId: 'batch-1', stopOnError: true,
        actions: [
          { type: 'fill', locator: { ref: 'el_1' }, value: 'x' },
          { type: 'click', locator: { ref: 'el_2' } }
        ]
      }
    });
    const result = res.result as any;
    expect(result.status).toBe('completed');
    expect(result.transactional).toBe(false);
    expect(result.actions.length).toBe(2);
    expect(result.actions[0].status).toBe('completed');
    expect(result.actions[1].status).toBe('completed');
    expect(transportCalls.length).toBe(2);
  });

  it('中间失败遇错停止，后续项标记 skipped', async () => {
    const sessionId = await connect(router, tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'browser.batch',
      params: {
        sessionId, tabId: 1, operationId: 'batch-2', stopOnError: true,
        actions: [
          { type: 'fill', locator: { ref: 'el_1' }, value: 'ok' },
          { type: 'fill', locator: { ref: 'el_2' }, value: 'FAIL' },
          { type: 'click', locator: { ref: 'el_3' } }
        ]
      }
    });
    const result = res.result as any;
    expect(result.status).toBe('partial');
    expect(result.actions[0].status).toBe('completed');
    expect(result.actions[1].status).toBe('failed');
    expect(result.actions[2].status).toBe('skipped');
  });

  it('批次中高风险动作被阻断（blocked + skipped）', async () => {
    const sessionId = await connect(router, tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'browser.batch',
      params: {
        sessionId, tabId: 1, operationId: 'batch-3', stopOnError: true,
        actions: [
          { type: 'fill', locator: { ref: 'el_1' }, value: 'x' },
          { type: 'click', locator: { role: 'button', name: '确认支付' } },
          { type: 'click', locator: { ref: 'el_3' } }
        ]
      }
    });
    const result = res.result as any;
    expect(result.actions[1].status).toBe('blocked');
    expect((result.actions[1].error as any).requiresSeparateSubmission).toBe(true);
    expect(result.actions[2].status).toBe('skipped');
  });
});

describe('JsonRpcRouter - 智能等待', () => {
  it('waitForText 条件满足后返回 matched', async () => {
    let calls = 0;
    const transport: ExtensionTransport = {
      send: async (cmd) => {
        if (cmd.method === 'browser.getSnapshot') {
          calls++;
          // 第三次调用才出现目标文本
          const text = calls >= 3 ? '目标文本' : '初始';
          return { ok: true, result: { url: 'https://x.com', title: 'T', snapshotVersion: 'sv_' + calls, elements: [{ ref: 'e1', role: 'generic', name: '', text, tag: 'div', disabled: false, visible: true, enabled: true }] } };
        }
        return { ok: true, result: {} };
      },
      onDisconnect: () => {}
    };
    const tm = new TokenManager();
    const router = new JsonRpcRouter({
      tokens: tm, sessions: new SessionManager(), operations: new OperationStore(), audit: new AuditLog(),
      confirmations: new ConfirmationManager(), events: new EventBus(), getTransport: () => transport
    });
    const sessionId = await connect(router, tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'page.waitForText',
      params: { sessionId, tabId: 1, text: '目标文本', timeoutMs: 2000, pollMs: 20 }
    });
    expect((res.result as any).matched).toBe(true);
  });

  it('waitForSelector 超时返回 OPERATION_TIMEOUT', async () => {
    const transport: ExtensionTransport = {
      send: async () => ({ ok: true, result: { url: 'https://x.com', title: 'T', snapshotVersion: 'sv_1', elements: [] } }),
      onDisconnect: () => {}
    };
    const tm = new TokenManager();
    const router = new JsonRpcRouter({
      tokens: tm, sessions: new SessionManager(), operations: new OperationStore(), audit: new AuditLog(),
      confirmations: new ConfirmationManager(), events: new EventBus(), getTransport: () => transport
    });
    const sessionId = await connect(router, tm, 'agent-a');
    const res = await router.handle({
      jsonrpc: '2.0', id: 2, method: 'page.waitForSelector',
      params: { sessionId, tabId: 1, locator: { role: 'button', name: 'X' }, timeoutMs: 100, pollMs: 10 }
    });
    expect(res.error?.data?.errorType).toBe('OPERATION_TIMEOUT');
  });
});
