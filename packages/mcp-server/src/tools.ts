// MCP Server 工具定义 — 将浏览器能力暴露为 MCP Tools。
// 每个工具映射到一个或多个 BCP 方法；不重复实现 DOM Engine / Locator / Action Engine。

import type { BrowserClient, Locator } from '@uba/sdk-typescript';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'browser_get_snapshot',
    description: '获取指定标签页的结构化页面快照（地址、标题、可交互元素、页面版本）。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        maxElements: { type: 'number', description: '最大元素数，可选' }
      },
      required: ['tabId']
    }
  },
  {
    name: 'browser_get_tabs',
    description: '获取当前 Agent 有权查看的标签页列表。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'browser_get_active_tab',
    description: '获取当前活动标签页。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'browser_navigate',
    description: '在指定标签页导航到目标 URL。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        url: { type: 'string' }
      },
      required: ['tabId', 'url']
    }
  },
  {
    name: 'browser_click',
    description: '点击页面元素（语义定位或元素引用）。高风险按钮需人工确认。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        locator: { type: 'object', description: '定位条件：{ref} 或 {role,name} 或 {text} 等' }
      },
      required: ['tabId', 'locator']
    }
  },
  {
    name: 'browser_fill',
    description: '填写输入框（不适用于密码字段）。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        locator: { type: 'object' },
        value: { type: 'string' }
      },
      required: ['tabId', 'locator', 'value']
    }
  },
  {
    name: 'browser_press',
    description: '对元素执行键盘按键。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        locator: { type: 'object' },
        key: { type: 'string' }
      },
      required: ['tabId', 'locator', 'key']
    }
  },
  {
    name: 'browser_scroll',
    description: '滚动到指定元素可见区域。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        locator: { type: 'object' }
      },
      required: ['tabId', 'locator']
    }
  },
  {
    name: 'browser_batch',
    description: '顺序执行一组操作，默认遇错停止。高风险动作需单独提交。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        actions: { type: 'array', items: { type: 'object' } },
        stopOnError: { type: 'boolean' }
      },
      required: ['tabId', 'actions']
    }
  }
];

/** 将 MCP 工具调用映射到 BCP 方法 */
export async function dispatchTool(client: BrowserClient, name: string, args: Record<string, any>): Promise<unknown> {
  const tabId = args.tabId as number;
  const locator = args.locator as Locator | undefined;
  switch (name) {
    case 'browser_get_snapshot':
      return client.getSnapshot(tabId, args.maxElements ? { maxElements: args.maxElements } : undefined);
    case 'browser_get_tabs':
      return client.getTabs();
    case 'browser_get_active_tab':
      return client.getActiveTab();
    case 'browser_navigate':
      return client.goto(tabId, args.url as string);
    case 'browser_click':
      return client.click(tabId, locator!);
    case 'browser_fill':
      return client.fill(tabId, locator!, args.value as string);
    case 'browser_press':
      return client.press(tabId, locator!, args.key as string);
    case 'browser_scroll':
      return client.scrollIntoView(tabId, locator!);
    case 'browser_batch':
      return client.batch(tabId, args.actions as unknown[], args.stopOnError !== false);
    default:
      throw new Error('Unknown tool: ' + name);
  }
}
