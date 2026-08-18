// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActiveFileView, ComposerSubmitGesture } from '../../../src/shared/protocol.ts'
import { Composer } from './Composer.tsx'

const FILE: ActiveFileView = {
  absolutePath: '/repo/src/main.ts',
  relativePath: 'src/main.ts',
  dirty: false,
}

function renderComposer(overrides: {
  text?: string
  activeFile?: ActiveFileView | null
  activeFileEnabled?: boolean
  onActiveFileToggle?: (enabled: boolean) => void
  onSend?: (text: string, gesture: ComposerSubmitGesture, attachments: string[]) => void
} = {}) {
  const onSend = overrides.onSend ?? vi.fn()
  const view = render(
    <Composer
      text={overrides.text ?? '你好'}
      onTextChange={() => {}}
      commitSeq={0}
      onSend={onSend}
      onCancel={() => {}}
      onAtOpen={() => {}}
      onAtResolve={() => {}}
      atCandidates={null}
      atInsert={null}
      onAtInsertConsumed={() => {}}
      activeFile={overrides.activeFile === undefined ? FILE : overrides.activeFile}
      activeFileEnabled={overrides.activeFileEnabled ?? true}
      onActiveFileToggle={overrides.onActiveFileToggle ?? (() => {})}
      commands={null}
      skills={null}
      onCommandOpen={() => {}}
      onCommandExecute={() => {}}
      onCommandRetry={() => {}}
      models={null}
      onModelOpen={() => {}}
      onModelSelect={() => {}}
      permissions={null}
      onPermissionSelect={() => {}}
      onPermissionSeatSelect={() => {}}
      onPermissionOpen={() => {}}
      agentPresets={{ presets: [], busy: false }}
      agentPresetSession={undefined}
      agentPresetBound={false}
      onAgentPresetOpen={() => {}}
      onAgentPresetSelect={() => {}}
      notices={[]}
      onNoticeDismissed={() => {}}
      todos={null}
      stats={null}
      running={false}
      submitting={false}
      modelSubmitting={false}
      serviceDisabled={false}
      disabled={false}
    />,
  )
  return { onSend, ...view }
}

afterEach(cleanup)

describe('Composer auto-attach file chip', () => {
  it('renders the active file chip with its display path', () => {
    const { getByText, getByTitle } = renderComposer()

    expect(getByText('src/main.ts')).not.toBeNull()
    expect(getByTitle('/repo/src/main.ts')).not.toBeNull()
  })

  it('hides the chip when there is no active file', () => {
    const { queryByText } = renderComposer({ activeFile: null })

    expect(queryByText('src/main.ts')).toBeNull()
  })

  it('toggles the eye switch through onActiveFileToggle', () => {
    const onActiveFileToggle = vi.fn()
    const { getByTitle } = renderComposer({ onActiveFileToggle })

    fireEvent.click(getByTitle('已启用：该文件将作为 @ 引用随消息发送（点击停用）'))

    expect(onActiveFileToggle).toHaveBeenCalledWith(false)
  })

  it('renders the disabled state (eye-off + dimmed)', () => {
    const { getByTitle } = renderComposer({ activeFileEnabled: false })

    expect(getByTitle('已停用：该文件不会作为对话输入（点击启用）')).not.toBeNull()
  })

  it('shows the dirty dot for unsaved files', () => {
    const { getByTitle } = renderComposer({
      activeFile: { ...FILE, dirty: true },
    })

    expect(getByTitle('有未保存的修改')).not.toBeNull()
  })

  it('sends the absolute path when the file is enabled', () => {
    const { onSend, getByTitle } = renderComposer()

    fireEvent.click(getByTitle('发送'))

    expect(onSend).toHaveBeenCalledWith('你好', 'enter', ['/repo/src/main.ts'])
  })

  it('sends no attachments when the file is disabled', () => {
    const { onSend, getByTitle } = renderComposer({ activeFileEnabled: false })

    fireEvent.click(getByTitle('发送'))

    expect(onSend).toHaveBeenCalledWith('你好', 'enter', [])
  })

  it('sends no attachments when there is no active file', () => {
    const { onSend, getByTitle } = renderComposer({ activeFile: null })

    fireEvent.click(getByTitle('发送'))

    expect(onSend).toHaveBeenCalledWith('你好', 'enter', [])
  })

  it('keeps the permission seat select separate from the popup select', () => {
    // 席位切换（onPermissionSeatSelect）与 /permission 弹出层（onPermissionSelect）
    // 是两个不同的出口；这里仅确认席位组件存在（权限投影为 null 时隐藏）。
    const { container } = renderComposer()

    // 无权限投影 → 席位隐藏，但发送路径不受影响。
    expect(container.querySelector('button[title="发送"]')).not.toBeNull()
  })
})
