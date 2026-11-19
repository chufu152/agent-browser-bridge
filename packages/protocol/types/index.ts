// UBA 协议共享类型（BCP V1.0）
// 插件、桥接服务、MCP Server 与 SDK 共享同一套结构语义。

export type Role =
  | 'button'
  | 'link'
  | 'textbox'
  | 'textarea'
  | 'checkbox'
  | 'radio'
  | 'combobox'
  | 'listbox'
  | 'option'
  | 'form'
  | 'heading'
  | 'img'
  | 'generic';

export interface ElementDescriptor {
  /** 不透明元素引用，绑定页面文档与元素身份 */
  ref: string;
  role: Role;
  /** 可访问名称 */
  name: string;
  /** 可见文本 */
  text: string;
  placeholder?: string;
  tag: string;
  type?: string;
  disabled: boolean;
  visible: boolean;
  enabled: boolean;
  /** 是否位于 Shadow DOM 内（M5 能力） */
  inShadowRoot?: boolean;
  frameIndex?: number;
}

export interface Snapshot {
  url: string;
  title: string;
  snapshotVersion: string;
  elements: ElementDescriptor[];
  truncated: boolean;
  fullSync: boolean;
  generatedAt: string;
}

export interface OperationResult {
  operationId: string;
  tabId: number;
  status: 'completed';
  snapshotVersion?: string;
  navigation?: {
    occurred: boolean;
    url?: string;
  };
  verified: boolean;
  completedAt: string;
}

export interface BatchActionResult {
  index: number;
  status: 'completed' | 'failed' | 'skipped' | 'blocked';
  result?: OperationResult;
  error?: JsonRpcErrorObject;
}

export interface BatchResult {
  operationId: string;
  tabId: number;
  status: 'completed' | 'partial' | 'failed';
  transactional: false;
  actions: BatchActionResult[];
}

// --- JSON-RPC 2.0 ---

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: {
    errorType: string;
    retryable: boolean;
    operationId?: string;
    snapshotVersion?: string;
    requiresSeparateSubmission?: boolean;
    details?: Record<string, unknown>;
  };
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

// --- 标准错误类型（与 docs/03-接口文档.md 第 8.2 节一致） ---

export const ErrorType = {
  PARSE_ERROR: 'PARSE_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  STALE_ELEMENT_REFERENCE: 'STALE_ELEMENT_REFERENCE',
  OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
  NAVIGATION_INTERRUPTED: 'NAVIGATION_INTERRUPTED',
  UNSUPPORTED_PAGE: 'UNSUPPORTED_PAGE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CONFIRMATION_DENIED: 'CONFIRMATION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_ELEMENT_STATE: 'INVALID_ELEMENT_STATE',
  BRIDGE_UNAVAILABLE: 'BRIDGE_UNAVAILABLE',
  AMBIGUOUS_LOCATOR: 'AMBIGUOUS_LOCATOR',
  STALE_CONFIRMATION: 'STALE_CONFIRMATION',
  OPERATION_OUTCOME_UNKNOWN: 'OPERATION_OUTCOME_UNKNOWN',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  OPERATION_ID_CONFLICT: 'OPERATION_ID_CONFLICT',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  TAB_NOT_FOUND: 'TAB_NOT_FOUND',
  UNSUPPORTED_PROTOCOL_VERSION: 'UNSUPPORTED_PROTOCOL_VERSION'
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export const ErrorCode: Record<ErrorType, number> = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  ELEMENT_NOT_FOUND: -32001,
  STALE_ELEMENT_REFERENCE: -32002,
  OPERATION_TIMEOUT: -32003,
  NAVIGATION_INTERRUPTED: -32004,
  UNSUPPORTED_PAGE: -32005,
  PERMISSION_DENIED: -32006,
  SESSION_EXPIRED: -32007,
  CONFIRMATION_REQUIRED: -32008,
  CONFIRMATION_DENIED: -32009,
  RATE_LIMITED: -32010,
  INVALID_ELEMENT_STATE: -32011,
  BRIDGE_UNAVAILABLE: -32012,
  AMBIGUOUS_LOCATOR: -32013,
  STALE_CONFIRMATION: -32014,
  OPERATION_OUTCOME_UNKNOWN: -32015,
  DUPLICATE_OPERATION: -32016,
  OPERATION_ID_CONFLICT: -32017,
  VERIFICATION_FAILED: -32018,
  TAB_NOT_FOUND: -32019,
  UNSUPPORTED_PROTOCOL_VERSION: -32020
};

export function makeError(
  errorType: ErrorType,
  message?: string,
  extra?: Partial<NonNullable<JsonRpcErrorObject['data']>>
): JsonRpcErrorObject {
  return {
    code: ErrorCode[errorType],
    message: message ?? errorType,
    data: {
      errorType,
      retryable: false,
      ...extra
    }
  };
}

// --- 定位模型 ---

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

// --- 操作风险分级 ---

export type RiskLevel = 'normal' | 'restricted' | 'high';

// --- 事件模型 ---

export type EventType =
  | 'page.changed'
  | 'page.navigationStarted'
  | 'page.navigationCompleted'
  | 'browser.tabUpdated'
  | 'operation.confirmationRequired'
  | 'operation.confirmationResolved'
  | 'session.closed';

export interface EventEnvelope {
  eventId: string;
  sequence: number;
  sessionId: string;
  subscriptionId?: string;
  tabId?: number;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface OperationState {
  operationId: string;
  agentId: string;
  status:
    | 'processing'
    | 'waiting_confirmation'
    | 'confirmed_pending_retry'
    | 'completed'
    | 'failed'
    | 'unknown';
  paramsFingerprint: string;
  result?: OperationResult;
  error?: JsonRpcErrorObject;
  createdAt: string;
  updatedAt: string;
}
