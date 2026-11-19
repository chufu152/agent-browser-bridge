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
});
