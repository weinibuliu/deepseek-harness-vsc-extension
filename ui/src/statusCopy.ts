/**
 * dsh 服务状态 → 用户可见文案（「状态文案」的单一事实来源，实际文案在共享 i18n 目录）。
 * 未知值回落原串：契约跟随——dsh 升级新增状态值时文案缺失不崩、原样显示，
 * 不静默吞掉真实状态。
 */
import { t, type MessageKey } from './i18n.ts'

const STATUS_KEYS: Record<string, MessageKey> = {
  discovering: 'status.discovering',
  starting: 'status.starting',
  ready: 'status.ready',
  reconnecting: 'status.reconnecting',
  stopped: 'status.stopped',
  error: 'status.error',
}

export function statusCopy(status: string): string {
  const key = STATUS_KEYS[status]
  return key === undefined ? status : t(key)
}
