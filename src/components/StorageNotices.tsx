import { useEffect } from 'react';
import { subscribeNotices } from '../store/notices';
import { useToast } from './UI';

/** 存储/同步层通知的 UI 边界：订阅通知总线并转发到 Toast。
 *  挂载在 ToastProvider 与 AppProvider 之间，保证启动期通知不丢失（总线另有队列兜底）。 */
export function StorageNotices() {
  const { toast } = useToast();
  useEffect(() => subscribeNotices((notice) => toast(notice.text, notice.kind)), [toast]);
  return null;
}
