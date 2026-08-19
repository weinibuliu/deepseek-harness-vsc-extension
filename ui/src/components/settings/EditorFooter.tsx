/**
 * 编辑卡底部动作行：左取消、右提交（对齐官方 EditorFooter）。取消仅在提交
 * 进行中拒绝输入；卡片因只读/禁用仍可关闭。
 */
import { t } from '../../i18n.ts'

interface EditorFooterProps {
  busy: boolean
  submitDisabled: boolean
  submitLabel?: string
  submitBusyLabel?: string
  cancelLabel?: string
  onCancel: () => void
  onSubmit: () => void
}

export function EditorFooter({
  busy,
  submitDisabled,
  submitLabel = t('action.apply'),
  submitBusyLabel = t('common.applying'),
  cancelLabel = t('action.cancel'),
  onCancel,
  onSubmit,
}: EditorFooterProps) {
  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover disabled:opacity-50"
        disabled={busy}
        onClick={onCancel}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        className="rounded-xs bg-button-background px-2.5 py-1 text-xs text-button-foreground hover:bg-button-hover disabled:opacity-50"
        disabled={submitDisabled}
        onClick={onSubmit}
      >
        {busy ? submitBusyLabel : submitLabel}
      </button>
    </div>
  )
}
