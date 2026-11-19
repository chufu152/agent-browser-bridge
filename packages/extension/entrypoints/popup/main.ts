// popup 主逻辑 — 提供最小诊断界面（M1 验收用）

async function currentTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function dispatch(command: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'UBA_DISPATCH', command }, (resp) => {
      resolve(resp);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const dot = document.getElementById('status-dot')!;
  const statusText = document.getElementById('status-text')!;
  const output = document.getElementById('output')!;

  // 检查内容脚本可用性
  currentTabId().then(async (tabId) => {
    if (tabId === undefined) return;
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'UBA_PING', payload: {} });
      if (resp?.ok) {
        dot.classList.remove('off');
        statusText.textContent = '当前页已注入';
      } else {
        dot.classList.add('off');
        statusText.textContent = '当前页未注入（特殊页面）';
      }
    } catch {
      dot.classList.add('off');
      statusText.textContent = '当前页未注入（特殊页面）';
    }
  });

  document.getElementById('test-ping')!.addEventListener('click', async () => {
    output.textContent = JSON.stringify(
      await dispatch({ method: 'browser.getActiveTab', params: {} }),
      null,
      2
    );
  });

  document.getElementById('test-snapshot')!.addEventListener('click', async () => {
    const tabId = await currentTabId();
    const res = await dispatch({ method: 'browser.getSnapshot', params: { tabId } });
    output.textContent = JSON.stringify(res, null, 2);
  });

  // 管理员操作：经 background 转发到桥接服务
  function admin(action: string, confirmationId?: string): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'UBA_ADMIN', action, confirmationId }, (resp) => resolve(resp));
    });
  }

  async function refreshConfirmations(): Promise<void> {
    const container = document.getElementById('confirmations')!;
    const res = await admin('listConfirmations');
    const list = Array.isArray(res) ? res : [];
    if (list.length === 0) {
      container.textContent = '（无待确认操作）';
      return;
    }
    container.innerHTML = '';
    for (const c of list) {
      const item = document.createElement('div');
      item.className = 'item';
      const summary = c.riskSummary?.target || c.method || '';
      item.innerHTML = `<div>${summary}</div><div>操作 ${c.operationId}</div>`;
      const row = document.createElement('div');
      row.className = 'row';
      const ok = document.createElement('button');
      ok.className = 'approve';
      ok.textContent = '确认';
      ok.addEventListener('click', async () => {
        await admin('approve', c.confirmationId);
        refreshConfirmations();
      });
      const no = document.createElement('button');
      no.className = 'deny';
      no.textContent = '拒绝';
      no.addEventListener('click', async () => {
        await admin('deny', c.confirmationId);
        refreshConfirmations();
      });
      row.appendChild(ok);
      row.appendChild(no);
      item.appendChild(row);
      container.appendChild(item);
    }
  }

  async function refreshAudit(): Promise<void> {
    const container = document.getElementById('audit')!;
    const res = await admin('listAudit');
    const list = Array.isArray(res) ? res : [];
    if (list.length === 0) {
      container.textContent = '（无审计记录）';
      return;
    }
    const recent = list.slice(-8).reverse();
    container.innerHTML = '';
    for (const a of recent) {
      const item = document.createElement('div');
      item.className = 'item';
      item.textContent = `${a.method} · ${a.outcome}${a.errorType ? ' · ' + a.errorType : ''}`;
      container.appendChild(item);
    }
  }

  document.getElementById('refresh-confirmations')!.addEventListener('click', () => {
    refreshConfirmations();
    refreshAudit();
  });

  // 初始加载
  refreshConfirmations();
  refreshAudit();
});
