// 风险分类 — 结合方法 + 目标语义判定普通/受限/高风险（docs/02 第 5.2 节）。
// 高风险（需人工确认）：支付、删除、发送、发布、账户安全修改等语义的点击。
// 受限（需显式授权）：敏感页面导航、文件传输、关闭标签页。

export type RiskLevel = 'normal' | 'restricted' | 'high';

const HIGH_RISK_PATTERNS = [
  '支付', '付款', '购买', '下单', '确认支付', '立即支付', 'pay', 'checkout',
  '删除', '移除', '永久删除', 'delete', 'remove forever',
  '发送', '发布', '提交', 'publish', 'submit', 'send',
  '注销', '解绑', '关闭账户', 'delete account',
  '修改密码', '更改密码', 'change password'
];

function hasHighRiskText(text: string): boolean {
  const lower = text.toLowerCase();
  return HIGH_RISK_PATTERNS.some((p) => lower.indexOf(p.toLowerCase()) !== -1);
}

export function classifyRisk(method: string, params: Record<string, unknown>): RiskLevel {
  // 元素点击：检查定位条件中的语义字段
  if (method === 'locator.click') {
    const loc = (params.locator ?? {}) as Record<string, unknown>;
    const text = [loc.name, loc.text, loc.label].filter((v) => typeof v === 'string').join(' ');
    if (hasHighRiskText(text)) return 'high';
  }

  // 敏感页面导航 / 重要表单填写 → 受限（需显式授权，但非每次人工确认）
  if (method === 'page.goto') return 'restricted';
  if (method === 'locator.fill' || method === 'locator.type') {
    const loc = (params.locator ?? {}) as Record<string, unknown>;
    const text = [loc.name, loc.text, loc.label].filter((v) => typeof v === 'string').join(' ');
    if (hasHighRiskText(text)) return 'restricted';
  }

  // 关闭标签页 → 受限
  if (method === 'browser.closeTab') return 'restricted';

  // 文件上传/下载（M5）→ 高风险，需每次人工确认
  if (method === 'browser.uploadFile' || method === 'browser.downloadFile') return 'high';

  return 'normal';
}

export function describeRisk(method: string, params: Record<string, unknown>): { site?: string; action?: string; target?: string } {
  const loc = (params.locator ?? {}) as Record<string, unknown>;
  return {
    action: method,
    target: [loc.name, loc.text, loc.label].filter((v) => typeof v === 'string').join(' ') || undefined,
    site: (params as any).url as string | undefined
  };
}
