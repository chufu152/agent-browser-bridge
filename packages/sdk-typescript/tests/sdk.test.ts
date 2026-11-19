// M3 集成测试：两个独立 Agent 经 WebSocket 接入同一桥接服务，验证协议互通与隔离。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startBridge, type Bridge } from '../../bridge/src/main';
import type { ExtensionTransport } from '../../bridge/src/transport/index';
import { BrowserClient } from '../src/index';

let bridge: Bridge;
let port: number;

function makeTransport(): ExtensionTransport {
  return {
    send: async (cmd) => {
      if (cmd.method === 'browser.getSnapshot') {
        return { ok: true, result: { url: 'https://example.com', title: 'Example', snapshotVersion: 'sv_1', elements: [{ ref: 'el_1', role: 'button', name: '提交', text: '提交', tag: 'button', disabled: false, visible: true, enabled: true }], truncated: false, fullSync: true } };
      }
      if (cmd.method === 'locator.click') {
        return { ok: true, result: { operationId: cmd.params?.operationId, tabId: cmd.params?.tabId, status: 'completed', verified: true } };
      }
      return { ok: true, result: {} };
    },
    onDisconnect: () => {}
  };
}

beforeAll(async () => {
  port = 4001;
  bridge = startBridge({ host: '127.0.0.1', port, verbose: false });
  bridge.setTransport(makeTransport());
  // 预签发两个 Agent 的 token
  bridge.tokens.issue('agent-a');
  bridge.tokens.issue('agent-b');
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(() => {
  bridge.close();
});

describe('M3 通用 Agent 接入（两个独立 Agent）', () => {
  it('两个 Agent 用同一协议完成快照读取', async () => {
    const a = new BrowserClient({ endpoint: `ws://127.0.0.1:${port}`, agentId: 'agent-a', token: bridge.tokens.issue('agent-a') });
    const b = new BrowserClient({ endpoint: `ws://127.0.0.1:${port}`, agentId: 'agent-b', token: bridge.tokens.issue('agent-b') });
    await a.connect();
    await b.connect();

    const snapA = await a.getSnapshot(1);
    const snapB = await b.getSnapshot(1);
    expect(snapA.title).toBe('Example');
    expect(snapB.title).toBe('Example');

    await a.close();
    await b.close();
  });

  it('两个 Agent 会话隔离：操作结果互不可见', async () => {
    const a = new BrowserClient({ endpoint: `ws://127.0.0.1:${port}`, agentId: 'agent-a', token: bridge.tokens.issue('agent-a') });
    const b = new BrowserClient({ endpoint: `ws://127.0.0.1:${port}`, agentId: 'agent-b', token: bridge.tokens.issue('agent-b') });
    await a.connect();
    await b.connect();

    await a.click(1, { ref: 'el_1' }, 'op_iso_1');

    // Agent B 查询 Agent A 的操作 → 不可见
    await expect(b.getOperation('op_iso_1')).rejects.toMatchObject({ errorType: 'ELEMENT_NOT_FOUND' });

    await a.close();
    await b.close();
  });

  it('高风险操作经 SDK 需人工确认后重提', async () => {
    const a = new BrowserClient({ endpoint: `ws://127.0.0.1:${port}`, agentId: 'agent-a', token: bridge.tokens.issue('agent-a') });
    await a.connect();

    // 高风险点击 → CONFIRMATION_REQUIRED
    let confirmError: any;
    try {
      await a.click(1, { role: 'button', name: '确认支付' }, 'op_risk_1');
    } catch (e) {
      confirmError = e;
    }
    expect(confirmError.errorType).toBe('CONFIRMATION_REQUIRED');
    const confirmationId = confirmError.data.confirmationId;

    // 管理员确认
    bridge.approveConfirmation(confirmationId, true);

    // 重新提交（携带 confirmationId）
    const res = await a.click(1, { role: 'button', name: '确认支付' }, 'op_risk_1', confirmationId);
    expect(res).toBeDefined();

    await a.close();
  });

  it('高风险操作未经确认执行成功数为零', async () => {
    const a = new BrowserClient({ endpoint: `ws://127.0.0.1:${port}`, agentId: 'agent-a', token: bridge.tokens.issue('agent-a') });
    await a.connect();

    // 未确认直接点击高风险 → 拒绝
    await expect(a.click(1, { role: 'button', name: '删除账号' }, 'op_risk_2')).rejects.toMatchObject({ errorType: 'CONFIRMATION_REQUIRED' });

    await a.close();
  });
});
