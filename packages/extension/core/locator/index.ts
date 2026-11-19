// UBA Locator — 定位语义
// 策略：ref（最快）→ role+name（首选语义）→ text → label → placeholder → selector → xpath。
// 执行要求唯一目标；find 查询模式返回列表 + ambiguous。

import {
  computeName,
  computeRole,
  isVisible,
  type Role
} from '../dom-engine/index';

export interface Locator {
  ref?: string;
  role?: Role;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  selector?: string;
  xpath?: string;
  exact?: boolean;
}

export interface LocateResult {
  ok: boolean;
  error?: string;
  errorType?: string;
  elements?: Element[];
  ambiguous?: boolean;
  ref?: string;
}

export interface RefResolver {
  (ref: string): Element | null;
}

function finish(matches: Element[]): LocateResult {
  const visible = matches.filter((el) => isVisible(el));
  if (visible.length === 0) {
    return { ok: false, errorType: 'ELEMENT_NOT_FOUND', error: 'Element not found' };
  }
  if (visible.length > 1) {
    return {
      ok: false,
      errorType: 'AMBIGUOUS_LOCATOR',
      error: 'Ambiguous locator: multiple elements matched',
      ambiguous: true,
      elements: visible
    };
  }
  return { ok: true, elements: visible };
}

function byRoleName(loc: Locator, doc: Document): LocateResult {
  const all = doc.querySelectorAll('*');
  const matches: Element[] = [];
  for (const el of Array.from(all)) {
    if (computeRole(el) !== loc.role) continue;
    if (loc.name !== undefined) {
      const n = computeName(el);
      if (loc.exact ? n === loc.name : n.toLowerCase() === (loc.name as string).toLowerCase()) {
        matches.push(el);
      }
    } else {
      matches.push(el);
    }
  }
  return finish(matches);
}

function byText(loc: Locator, doc: Document): LocateResult {
  const all = doc.querySelectorAll('*');
  const matches: Element[] = [];
  for (const el of Array.from(all)) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (loc.exact ? t === loc.text : t.toLowerCase().includes((loc.text as string).toLowerCase())) {
      matches.push(el);
    }
  }
  return finish(matches);
}

function byLabel(loc: Locator, doc: Document): LocateResult {
  const all = doc.querySelectorAll('*');
  const matches: Element[] = [];
  for (const el of Array.from(all)) {
    if (computeName(el) === loc.label) matches.push(el);
  }
  return finish(matches);
}

function byPlaceholder(loc: Locator, doc: Document): LocateResult {
  const all = doc.querySelectorAll('input, textarea');
  const matches: Element[] = [];
  for (const el of Array.from(all)) {
    if ((el as HTMLInputElement).getAttribute('placeholder') === loc.placeholder) matches.push(el);
  }
  return finish(matches);
}

function bySelector(loc: Locator, doc: Document): LocateResult {
  try {
    return finish(Array.from(doc.querySelectorAll(loc.selector as string)));
  } catch {
    return { ok: false, errorType: 'INVALID_PARAMS', error: 'Invalid selector' };
  }
}

function byXpath(loc: Locator, doc: Document): LocateResult {
  try {
    const result = doc.evaluate(
      loc.xpath as string,
      doc,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const matches: Element[] = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node && node.nodeType === Node.ELEMENT_NODE) matches.push(node as Element);
    }
    return finish(matches);
  } catch {
    return { ok: false, errorType: 'INVALID_PARAMS', error: 'Invalid xpath' };
  }
}

export function locate(
  loc: Locator,
  doc: Document,
  resolveRef: RefResolver
): LocateResult {
  if (!loc) return { ok: false, errorType: 'INVALID_PARAMS', error: 'Locator is required' };
  if (loc.ref !== undefined && loc.ref !== '') {
    const el = resolveRef(loc.ref);
    if (!el || !el.isConnected) {
      return { ok: false, errorType: 'STALE_ELEMENT_REFERENCE', error: 'Element reference is stale or invalid' };
    }
    return { ok: true, elements: [el], ref: loc.ref };
  }
  if (loc.role !== undefined) return byRoleName(loc, doc);
  if (loc.text !== undefined) return byText(loc, doc);
  if (loc.label !== undefined) return byLabel(loc, doc);
  if (loc.placeholder !== undefined) return byPlaceholder(loc, doc);
  if (loc.selector !== undefined) return bySelector(loc, doc);
  if (loc.xpath !== undefined) return byXpath(loc, doc);
  return { ok: false, errorType: 'INVALID_PARAMS', error: 'At least one locator strategy is required' };
}

export function find(loc: Locator, doc: Document, resolveRef: RefResolver): LocateResult {
  if (!loc) return { ok: true, elements: [], ambiguous: false };
  const hasStrategy =
    loc.ref !== undefined ||
    loc.role !== undefined ||
    loc.text !== undefined ||
    loc.label !== undefined ||
    loc.placeholder !== undefined ||
    loc.selector !== undefined ||
    loc.xpath !== undefined;
  if (!hasStrategy) return { ok: true, elements: [], ambiguous: false };

  if (loc.ref !== undefined) {
    const el = resolveRef(loc.ref);
    return { ok: true, elements: el && el.isConnected ? [el] : [], ambiguous: false };
  }
  const r = locate(loc, doc, resolveRef);
  if (r.ok) return r;
  if (r.errorType === 'ELEMENT_NOT_FOUND') return { ok: true, elements: [], ambiguous: false };
  if (r.errorType === 'AMBIGUOUS_LOCATOR') return { ok: true, elements: r.elements || [], ambiguous: true };
  return r;
}
