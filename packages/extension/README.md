# @uba/extension — MV3 浏览器插件

Universal Browser Agent 的浏览器控制核心（M1）。直接通过 DOM 与浏览器能力控制用户真实浏览器，不采用“截图识别 + 坐标预测 + 模拟点击”。

## 本地加载

1. 安装依赖并构建：
   ```bash
   cd packages/extension
   npm install
   npm run build
   ```
2. 打开 `chrome://extensions`（或 Edge `edge://extensions`），开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择 `packages/extension/.output/chrome-mv3`。
4. 打开任意网页，点击工具栏图标，使用「测试当前页快照」「测试注入连接」验证。

## 架构

```
content script（隔离世界）
  ├── core/dom-engine   元素提取、角色/名称计算、ref 生成
  ├── core/locator      定位（ref / role+name / text / label / placeholder / selector / xpath）
  ├── core/snapshot     快照与页面版本
  ├── core/observer     MutationObserver 变化监听
  └── core/actions      真实交互 + 状态核验 + 风险识别

service worker（background）
  ├── core/tabs         标签页管理（授权、枚举、创建、切换、关闭）
  └── 指令路由          把 BCP 方法路由到 content script

popup                   最小诊断界面（M1 验收用）
```

装配顺序：`dom → locator → snapshot → observer → actions`，依赖方向一致，避免循环引用。

## 插件内部命令与页面结果映射

| BCP 方法 | 内部命令 | 说明 |
|---|---|---|
| `browser.getSnapshot` | `UBA_GET_SNAPSHOT` | 生成结构化快照 + ref + 页面版本 |
| `locator.find` | `UBA_LOCATE` | 查询模式，返回列表 + ambiguous |
| `locator.*`（11 个操作） | `UBA_PERFORM_ACTION` | 定位唯一目标 → 真实交互 → 状态核验 |
| `browser.getTabs` 等 | SW 直接处理 | 标签页管理不依赖 content script |
| 诊断 | `UBA_PING` | 检查 content script 是否注入 |

## 安全红线（已实现）

- 默认不读取、不采集密码字段值。
- 高风险动作（支付/删除/发送/发布/账户安全等语义）返回 `CONFIRMATION_REQUIRED`，阻断执行。
- 真实交互：派发原生 `input`/`change`/`click` 事件后核验最终状态，不伪造成功。
- 定位要求唯一目标：多匹配返回 `AMBIGUOUS_LOCATOR`，零匹配返回 `ELEMENT_NOT_FOUND`。
- 敏感/特殊页面（浏览器内部页、扩展商店）返回 `UNSUPPORTED_PAGE`。

## 已知不支持页面与组件清单

| 项 | 状态 |
|---|---|
| 浏览器内部页面（chrome://、edge:// 等） | 不支持，返回 `UNSUPPORTED_PAGE` |
| 扩展商店页面 | 不支持（浏览器策略） |
| Shadow DOM | M1 已标记但未完整支持（M5 完成） |
| 跨域 iframe | M1 不支持（M5 完成） |
| Canvas / WebGL / 非 DOM 交互 | 不支持（按规划不做截图默认路径） |
| 密码字段值读取/填写 | 永久禁止 |

## 性能基线（M1 初始）

M1 只建立初始参考基线；正式 P95 基准（快照 ≤ 1s、简单操作 ≤ 300ms）在 M4 建立并回归。

- 测量方法：jsdom 环境重复执行 `buildSnapshot(document)`，取中位数。
- 单元测试侧证：11 个用例（含 3 页快照提取、定位语义、风险识别）总耗时约 700ms。
- 真实浏览器 P95 需在目标浏览器中测量，页面业务耗时单列，本阶段不承诺具体数值。

## 测试

```bash
npm run test -w packages/extension     # 单元测试（jsdom）
npm run typecheck -w packages/extension # 类型检查
npm run build -w packages/extension     # 构建
```

M1 验收证据：11/11 单测通过；`tsc --noEmit` 通过；`wxt build` 产出合法 MV3（service worker + content script + popup，45.8 kB）。

## 合规边界

- 只处理用户自己已渲染在本机页面上的内容。
- 不绕过登录墙、付费墙、验证码或站点安全控制。
- 不读取、不存储 Cookie 与账号凭据。
- 高风险操作必须由用户在浏览器侧确认（M3 完成完整闭环）。

> 选择器说明：第三方站点的 DOM 选择器只用语义角色 + 可访问名称，禁止依赖 Vue scoped、React `__jsx` 或构建期随机类名（这些每次构建都会变）。
