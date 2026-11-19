// UBA DOM Engine — 元素提取与 ref 解析
// 语义定位核心：只用语义角色 + 可访问名称，禁止依赖 Vue scoped / React __jsx / 构建期随机类。
// 本模块为纯函数集合，content 入口负责挂载到 window.UBA；测试可直接 import。

export type Role = string;

export interface ElementDescriptor {
  ref: string;
  role: Role;
  name: string;
  text: string;
  placeholder?: string;
  tag: string;
  type?: string;
  disabled: boolean;
  visible: boolean;
  enabled: boolean;
  inShadowRoot?: boolean;
  frameIndex?: number;
}

export const SENSITIVE_INPUT_TYPES = new Set(['password']);
export const INTERACTIVE_TAGS = new Set([
  'button', 'a', 'input', 'textarea', 'select', 'option', 'form', 'summary'
]);

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && (CSS as any).escape) return (CSS as any).escape(s);
  return s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

export function visibleTextOf(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function indexAmongSiblings(el: Element): number {
  if (!el.parentElement) return 0;
  const same = Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName);
  return same.indexOf(el);
}

export function computeRole(el: Element): Role {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type || 'text';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'combobox';
  if (tag === 'option') return 'option';
  if (tag === 'form') return 'form';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'img') return 'img';
  if ((el as HTMLElement).isContentEditable) return 'textbox';
  const roleAttr = el.getAttribute('role');
  if (roleAttr) return roleAttr;
  return 'generic';
}

export function computeName(el: Element): string {
  const html = el as HTMLElement;
  const doc = el.ownerDocument;
  const ariaLabel = html.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = html.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = doc.getElementById(labelledBy.split(/\s+/)[0]);
    if (labelEl) return visibleTextOf(labelEl).trim();
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const input = el as HTMLInputElement;
    if (input.id) {
      const label = doc.querySelector('label[for="' + cssEscape(input.id) + '"]');
      if (label) return visibleTextOf(label).trim();
    }
    const placeholder = input.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
  }
  if (tag === 'img') return (el as HTMLImageElement).alt || '';
  if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
    return (el.textContent || '').trim().slice(0, 200);
  }
  return '';
}

export function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  // 显式隐藏判定（语义可靠，不依赖浏览器布局引擎，亦兼容 jsdom 测试环境）：
  // 1) hidden 属性；2) aria-hidden；3) 自身或其祖先的内联 display:none / visibility:hidden。
  if (html.hasAttribute('hidden')) return false;
  if (html.getAttribute('aria-hidden') === 'true') return false;
  if (!html.isConnected) return false;

  // 沿祖先链检查显式隐藏（内联样式在真实浏览器与 jsdom 中均可靠）
  let node: Element | null = html;
  while (node) {
    const win = node.ownerDocument.defaultView;
    const style = win ? win.getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    node = node.parentElement;
  }
  return true;
}

export function isEnabled(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.getAttribute('aria-disabled') === 'true') return false;
  if ('disabled' in html && (html as HTMLInputElement).disabled) return false;
  return true;
}

export function elementFingerprint(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = computeRole(el);
  const name = computeName(el);
  const id = (el as HTMLElement).id || '';
  const parent = el.parentElement ? el.parentElement.tagName.toLowerCase() : '';
  const idx = indexAmongSiblings(el);
  return [tag, role, name, id, parent, idx].join('|');
}

function collectElements(
  root: Document | ShadowRoot,
  into: ElementDescriptor[],
  frameIndex: number,
  refMap?: Map<string, Element>,
  inShadowRoot = false
): void {
  const walk = (node: Element, inShadow: boolean): void => {
    const tag = node.tagName.toLowerCase();
    const contentEditable = (node as HTMLElement).isContentEditable;

    if (INTERACTIVE_TAGS.has(tag) || contentEditable) {
      const role = computeRole(node);
      if (tag === 'input' && SENSITIVE_INPUT_TYPES.has((node as HTMLInputElement).type || '')) {
        // 跳过密码字段
      } else if (role !== 'generic' || contentEditable) {
        const ref = 'el_' + simpleHash(elementFingerprint(node));
        into.push({
          ref,
          role,
          name: computeName(node),
          text: visibleTextOf(node),
          placeholder: (node as HTMLInputElement).getAttribute
            ? (node as HTMLInputElement).getAttribute('placeholder') || undefined
            : undefined,
          tag,
          type: (node as HTMLInputElement).type || undefined,
          disabled: !isEnabled(node),
          visible: isVisible(node),
          enabled: isEnabled(node),
          frameIndex,
          inShadowRoot: inShadow || undefined
        });
        refMap?.set(ref, node);
      }
    }

    // Shadow DOM（M5）：递归遍历开放阴影根
    const shadow = (node as Element).shadowRoot;
    if (shadow) {
      for (const c of Array.from(shadow.children)) walk(c, true);
    }

    // 同源 iframe（M5）：递归遍历其文档；跨域 contentDocument 为 null，跳过
    if (tag === 'iframe') {
      const iframeDoc = (node as HTMLIFrameElement).contentDocument;
      if (iframeDoc) {
        for (const c of Array.from(iframeDoc.body ? iframeDoc.body.children : [])) walk(c, inShadow);
      }
    }

    for (const child of Array.from(node.children)) walk(child, inShadow);
  };

  // 用 nodeType 判定文档（9 = DOCUMENT_NODE），避免 instanceof 跨 realm 失效
  const isDocument = (root as any).nodeType === 9;
  const startEls = isDocument
    ? Array.from((root as Document).body ? (root as Document).body.children : [])
    : Array.from((root as ShadowRoot).children || []);
  for (const el of startEls) walk(el, inShadowRoot);
}

/** 深遍历收集所有元素（含 Shadow DOM 与同源 iframe），供定位器匹配 */
export function queryAllDeep(doc: Document): Element[] {
  const result: Element[] = [];
  const walk = (node: Element): void => {
    result.push(node);
    const shadow = (node as Element).shadowRoot;
    if (shadow) for (const c of Array.from(shadow.children)) walk(c);
    if (node.tagName.toLowerCase() === 'iframe') {
      const iframeDoc = (node as HTMLIFrameElement).contentDocument;
      if (iframeDoc) for (const c of Array.from(iframeDoc.body ? iframeDoc.body.children : [])) walk(c);
    }
    for (const child of Array.from(node.children)) walk(child);
  };
  for (const el of Array.from(doc.body ? doc.body.children : [])) walk(el);
  return result;
}

function simpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export interface SnapshotResult {
  url: string;
  title: string;
  elements: ElementDescriptor[];
  truncated: boolean;
}

export function buildSnapshot(doc: Document = document): SnapshotResult {
  const elements: ElementDescriptor[] = [];
  collectElements(doc, elements, 0);

  const MAX = 5000;
  const truncated = elements.length > MAX;
  const slice = elements.slice(0, MAX);

  return {
    url: (doc.defaultView ? doc.defaultView.location.href : ''),
    title: doc.title,
    elements: slice,
    truncated
  };
}

/** 单次遍历构建 ref -> element 映射（O(n)，替代 O(n²) 的反查） */
export function buildRefMap(doc: Document = document): Map<string, Element> {
  const map = new Map<string, Element>();
  const arr: ElementDescriptor[] = [];
  collectElements(doc, arr, 0, map);
  return map;
}
