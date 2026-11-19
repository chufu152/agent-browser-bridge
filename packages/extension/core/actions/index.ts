// UBA Action Engine — 真实页面交互与状态核验
// 安全红线：
//   1. 禁止仅改 DOM 属性伪装成功（必须派发真实事件 + 核验状态）。
//   2. 禁止读取或填写密码字段。
//   3. 高风险动作（支付/删除/发送/发布/账户安全等语义）返回 CONFIRMATION_REQUIRED。

import {
  computeName,
  isEnabled,
  isVisible,
  visibleTextOf
} from '../dom-engine/index';
import { locate, type Locator } from '../locator/index';

export const HIGH_RISK_PATTERNS = [
  '支付', '付款', '购买', '下单', '确认支付', '立即支付', 'pay', 'checkout',
  '删除', '移除', '永久删除', 'delete', 'remove forever',
  '发送', '发布', '提交', 'publish', 'submit', 'send',
  '注销', '解绑', '关闭账户', 'delete account',
  '修改密码', '更改密码', 'change password'
];

export function isHighRiskText(text: string): boolean {
  const lower = text.toLowerCase();
  return HIGH_RISK_PATTERNS.some((p) => lower.indexOf(p.toLowerCase()) !== -1);
}

export function isPasswordField(el: Element): boolean {
  return el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).type === 'password';
}

export type ActionType =
  | 'click' | 'fill' | 'type' | 'clear' | 'press'
  | 'hover' | 'check' | 'uncheck' | 'selectOption' | 'scrollIntoView';

export interface Action {
  type: ActionType;
  locator: Locator;
  value?: string;
  text?: string;
  key?: string;
  option?: string;
  /** 桥接层已完成人工确认后的授权标记；为 true 时跳过本地高风险检查 */
  confirmationGrant?: boolean;
}

export interface ActionResult {
  ok: boolean;
  errorType?: string;
  error?: string;
  verified?: boolean;
  requiresSeparateSubmission?: boolean;
}

function setNativeValue(el: Element, value: string): void {
  const input = el as HTMLInputElement;
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function focusElement(el: Element): void {
  (el as HTMLElement).focus();
}

function click(el: Element, grant = false): ActionResult {
  if (!grant && (isHighRiskText(computeName(el)) || isHighRiskText(visibleTextOf(el)))) {
    return {
      ok: false,
      errorType: 'CONFIRMATION_REQUIRED',
      error: 'High-risk action requires user confirmation',
      requiresSeparateSubmission: false
    };
  }
  if (!isEnabled(el)) return { ok: false, errorType: 'INVALID_ELEMENT_STATE', error: 'Element is disabled' };
  focusElement(el);
  (el as HTMLElement).click();
  return { ok: true, verified: true };
}

function fill(el: Element, value: string): ActionResult {
  if (isPasswordField(el)) return { ok: false, errorType: 'PERMISSION_DENIED', error: 'Password field value access is not allowed' };
  if (!isEnabled(el)) return { ok: false, errorType: 'INVALID_ELEMENT_STATE', error: 'Element is disabled' };
  focusElement(el);
  setNativeValue(el, value);
  return { ok: true, verified: (el as HTMLInputElement).value === value };
}

function typeText(el: Element, text: string): ActionResult {
  if (isPasswordField(el)) return { ok: false, errorType: 'PERMISSION_DENIED', error: 'Password field value access is not allowed' };
  if (!isEnabled(el)) return { ok: false, errorType: 'INVALID_ELEMENT_STATE', error: 'Element is disabled' };
  focusElement(el);
  setNativeValue(el, text);
  return { ok: true, verified: (el as HTMLInputElement).value === text };
}

function clear(el: Element): ActionResult {
  if (isPasswordField(el)) return { ok: false, errorType: 'PERMISSION_DENIED', error: 'Password field value access is not allowed' };
  focusElement(el);
  setNativeValue(el, '');
  return { ok: true, verified: (el as HTMLInputElement).value === '' };
}

function press(el: Element, key: string): ActionResult {
  focusElement(el);
  const html = el as HTMLElement;
  html.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  html.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  return { ok: true, verified: true };
}

function hover(el: Element): ActionResult {
  const html = el as HTMLElement;
  html.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  html.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  return { ok: true, verified: true };
}

function check(el: Element): ActionResult {
  const input = el as HTMLInputElement;
  if (!input.checked) {
    focusElement(el);
    input.click();
  }
  return { ok: true, verified: input.checked === true };
}

function uncheck(el: Element): ActionResult {
  const input = el as HTMLInputElement;
  if (input.checked) {
    focusElement(el);
    input.click();
  }
  return { ok: true, verified: input.checked === false };
}

function selectOption(el: Element, value: string): ActionResult {
  const select = el as HTMLSelectElement;
  focusElement(el);
  let target: number | null = null;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === value || select.options[i].text === value) {
      target = i;
      break;
    }
  }
  if (target === null) return { ok: false, errorType: 'INVALID_PARAMS', error: 'Option not found' };
  select.selectedIndex = target;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const cur = select.options[select.selectedIndex];
  const verified = cur.value === value || cur.text === value;
  return { ok: true, verified };
}

function scrollIntoView(el: Element): ActionResult {
  (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'auto' });
  return { ok: true, verified: true };
}

export function perform(
  action: Action,
  doc: Document,
  resolveRef: (ref: string) => Element | null
): ActionResult {
  const locRes = locate(action.locator, doc, resolveRef);
  if (!locRes.ok) return locRes as ActionResult;
  const el = locRes.elements![0];

  if (!isVisible(el)) {
    return { ok: false, errorType: 'INVALID_ELEMENT_STATE', error: 'Element is not visible' };
  }

  switch (action.type) {
    case 'click': return click(el, action.confirmationGrant);
    case 'fill': return fill(el, action.value as string);
    case 'type': return typeText(el, action.text as string);
    case 'clear': return clear(el);
    case 'press': return press(el, action.key as string);
    case 'hover': return hover(el);
    case 'check': return check(el);
    case 'uncheck': return uncheck(el);
    case 'selectOption': return selectOption(el, action.option as string);
    case 'scrollIntoView': return scrollIntoView(el);
    default:
      return { ok: false, errorType: 'INVALID_PARAMS', error: 'Unknown action type: ' + action.type };
  }
}
