# M4 性能基准说明

## 核心优化

### 1. ref 生成 O(n²) → O(n)

`buildSnapshot` 原实现中，每个元素通过 `querySelectorAll('*')` 反向定位以生成 `ref`，整体为 O(n²)。
改为在遍历时直接计算元素指纹生成 `ref`，并同步构建 `ref -> element` 映射，整体降为 O(n)。

### 2. 语义计算去重（M5 后追加优化）

`collectElements` 原实现对每个元素重复调用 `computeName` / `computeRole` / `isEnabled`（指纹计算一次、描述符再各算一次）。
改为每个元素只算一次并复用，减少 2–3 倍语义计算。

### 3. `checkVisibility` 快路径（M5 后追加优化）

`isVisible` 在真实浏览器（Chrome 105+）改用原生 `checkVisibility({ checkVisibilityCSS: true })`，
一次性判定自身与祖先的 `display` / `visibility` / `content-visibility`，避免逐祖先 `getComputedStyle` 反复触发样式重算。
jsdom / 旧浏览器回退到祖先链检查。

## 快照缓存

`snapshot` 引擎基于「URL + title + 元素 ref 签名」计算页面版本，`sinceVersion === 当前版本` 时返回空元素列表（缓存命中），避免重复解析整页。

## 可复现基准

运行：`npx tsx bench/snapshot-bench.ts`

| 指标 | 优化前 | 优化后 | 说明 |
|---|---|---|---|
| 页面规模 | 50 交互元素 + 100 文本节点 | 同左 | jsdom 受控规模 |
| 样本数 | 50 | 50 | 预热 10 轮 |
| 中位数 | ~150 ms | ~135 ms | jsdom 环境 |
| P95 | ~167 ms | ~139 ms | jsdom 环境 |

> 注：jsdom 无 `checkVisibility` 且 `getComputedStyle` 开销远高于真实浏览器，故上述绝对数值主要反映「语义计算去重」的收益；
> `checkVisibility` 的收益只能在真实浏览器中体现。真实浏览器 P95 目标（快照 ≤ 1s、简单操作 ≤ 300ms）需在 Chrome/Edge 本机实测。

## 容量限制（M4 已实现）

| 项 | 限制 |
|---|---|
| 快照元素上限 | 5000（超出截断并标记 `truncated`） |
| 请求速率 | 每会话 50 次/秒，桶容量 100（超限 `RATE_LIMITED`） |
| 批量 | 逐项结果，遇错停止，高风险动作阻断并单独提交 |
| 事件缓存 | 每会话最多 1000 条（超出截断，序号缺口可检测） |
