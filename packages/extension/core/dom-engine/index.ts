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

export function visibleTextOf(el: Element, maxLen = 200): string {
  const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return maxLen > 0 ? raw.slice(0, maxLen) : raw;
}

/** 从根到元素的路径（每级 tag + 在所有子节点中的下标），保证唯一且相对稳定 */
function domPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  const docEl = el.ownerDocument ? el.ownerDocument.documentElement : null;
  while (node && node !== docEl && node.parentElement) {
    const idx = Array.prototype.indexOf.call(node.parentElement.children, node);
    parts.unshift(node.tagName.toLowerCase() + '[' + idx + ']');
    node = node.parentElement;
  }
  return parts.join('/');
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

export function computeName(el: Element, maxLen = 200): string {
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
    const raw = (el.textContent || '').trim();
    return maxLen > 0 ? raw.slice(0, maxLen) : raw;
  }
  return '';
}

export function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  // 显式隐藏判定（语义可靠，不依赖浏览器布局引擎，亦兼容 jsdom 测试环境）：
  // 1) hidden 属性；2) aria-hidden；3) 自身或其祖先的 display:none / visibility:hidden。
  if (html.hasAttribute('hidden')) return false;
  if (html.getAttribute('aria-hidden') === 'true') return false;
  if (!html.isConnected) return false;

  // 快速路径：原生 checkVisibility（Chrome 105+）。
  // 原生一次性判定自身及祖先的 display/visibility/content-visibility，不走 JS 逐祖先 getComputedStyle，
  // 避免在遍历大量元素时反复触发样式重算（这是真实浏览器下的主要开销）。
  if (typeof (html as any).checkVisibility === 'function') {
    try {
      return (html as any).checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    } catch {
      /* 回退到祖先链检查 */
    }
  }

  // 回退路径（jsdom / 旧浏览器）：沿祖先链检查显式隐藏
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

export function elementFingerprint(el: Element, role?: Role, name?: string, frameKey = ''): string {
  const tag = el.tagName.toLowerCase();
  const r = role ?? computeRole(el);
  const n = name ?? computeName(el);
  const id = (el as HTMLElement).id || '';
  const path = domPath(el);
  return [tag, r, n, id, frameKey, path].join('|');
}

function collectElements(
  root: Document | ShadowRoot,
  into: ElementDescriptor[],
  frameIndex: number,
  refMap?: Map<string, Element>,
  inShadowRoot = false,
  maxTextLength = 200
): void {
  const walk = (node: Element, inShadow: boolean, frameKey: string): void => {
    const tag = node.tagName.toLowerCase();
    const contentEditable = (node as HTMLElement).isContentEditable;

    if (INTERACTIVE_TAGS.has(tag) || contentEditable) {
      const role = computeRole(node);
      if (tag === 'input' && SENSITIVE_INPUT_TYPES.has((node as HTMLInputElement).type || '')) {
        // 跳过密码字段
      } else if (role !== 'generic' || contentEditable) {
        // 语义计算只做一次，避免 elementFingerprint / name / enabled 重复计算
        const name = computeName(node, maxTextLength);
        const enabled = isEnabled(node);
        const ref = 'el_' + simpleHash(elementFingerprint(node, role, name, frameKey));
        into.push({
          ref,
          role,
          name,
          text: visibleTextOf(node, maxTextLength),
          placeholder: (node as HTMLInputElement).getAttribute
            ? (node as HTMLInputElement).getAttribute('placeholder') || undefined
            : undefined,
          tag,
          type: (node as HTMLInputElement).type || undefined,
          disabled: !enabled,
          visible: isVisible(node),
          enabled,
          frameIndex,
          inShadowRoot: inShadow || undefined
        });
        refMap?.set(ref, node);
      }
    }

    // Shadow DOM（M5）：递归遍历开放阴影根
    const shadow = (node as Element).shadowRoot;
    if (shadow) {
      for (const c of Array.from(shadow.children)) walk(c, true, frameKey);
    }

    // 同源 iframe（M5）：递归遍历其文档；跨域 contentDocument 为 null，跳过。
    // frameKey 携带 iframe 在父文档中的路径，避免跨 frame 同构元素 ref 碰撞。
    if (tag === 'iframe') {
      const iframeDoc = (node as HTMLIFrameElement).contentDocument;
      if (iframeDoc) {
        const childKey = frameKey + '#' + domPath(node);
        for (const c of Array.from(iframeDoc.body ? iframeDoc.body.children : [])) walk(c, inShadow, childKey);
      }
    }

    for (const child of Array.from(node.children)) walk(child, inShadow, frameKey);
  };

  // 用 nodeType 判定文档（9 = DOCUMENT_NODE），避免 instanceof 跨 realm 失效
  const isDocument = (root as any).nodeType === 9;
  const startEls = isDocument
    ? Array.from((root as Document).body ? (root as Document).body.children : [])
    : Array.from((root as ShadowRoot).children || []);
  for (const el of startEls) walk(el, inShadowRoot, '');
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

export function buildSnapshot(doc: Document = document, options: { maxTextLength?: number } = {}): SnapshotResult {
  const elements: ElementDescriptor[] = [];
  collectElements(doc, elements, 0, undefined, false, options.maxTextLength ?? 200);

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
