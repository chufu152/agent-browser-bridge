// vitest 全局 setup：为 jsdom 补齐布局 API，使 isVisible 在测试中可用。

import { vi } from 'vitest';

// jsdom 不支持真实布局，offsetParent 恒为 null、getClientRects 恒为空。
// 为让 isVisible 按“display/visibility/hidden”判定，这里 mock 布局 API。
if (typeof Element !== 'undefined') {
  Element.prototype.getClientRects = function () {
    // 返回非空，表示元素“存在布局盒”（仅用于测试）
    const list = [] as unknown as DOMRectList;
    const rect = { x: 0, y: 0, width: 1, height: 1, top: 0, right: 1, bottom: 1, left: 1, toJSON: () => ({}) } as DOMRect;
    list[0] = rect;
    list.item = () => rect;
    (list as any).length = 1;
    return list;
  };
}

// 关闭未实现的 CSS 解析告警噪音（可选）
vi.stubGlobal('scrollTo', () => {});
