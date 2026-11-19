/** 极简通知总线：store/持久化/同步层发出语义通知，UI 层（StorageNotices）订阅并渲染 Toast。
 *  目的：解除 store → components(useToast) 的依赖；通知时机与文案与原有实现保持一致。
 *  单订阅者模型；订阅前的通知进入队列，订阅时立即补发（保证启动期通知不丢失）。 */

export type NoticeKind = 'success' | 'error' | 'info';

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

type Listener = (notice: Notice) => void;

let listener: Listener | null = null;
const queue: Notice[] = [];
let seq = 0;

export function emitNotice(kind: NoticeKind, text: string): void {
  const notice: Notice = { id: ++seq, kind, text };
  if (listener) listener(notice);
  else queue.push(notice);
}

export function subscribeNotices(fn: Listener): () => void {
  if (listener) {
    // 单订阅者：重复订阅直接忽略，返回空清理函数，避免重复 Toast
    return () => undefined;
  }
  listener = fn;
  const pending = queue.splice(0, queue.length);
  for (const notice of pending) fn(notice);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** 仅测试使用：清空订阅与队列。 */
export function resetNoticeBusForTest(): void {
  listener = null;
  queue.length = 0;
  seq = 0;
}
