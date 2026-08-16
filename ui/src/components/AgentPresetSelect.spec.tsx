// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentPresetSelectView, SessionSummary } from '../../../src/shared/protocol.ts'
import { AgentPresetSelect } from './AgentPresetSelect.tsx'

const VALUE: AgentPresetSelectView = {
  presets: [
    { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整 Agent' },
    { id: 'code', trust: 'system', isDefault: false, name: 'PTC 模式' },
    { id: 'mine', trust: 'user', isDefault: false, name: '我的模式' },
    { id: 'broken', trust: 'user', isDefault: false, name: '坏模式', broken: 'bad yaml' },
  ],
  busy: false,
}

function summary(patch: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 's1',
    updatedAt: 1,
    running: false,
    blank: true,
    ...patch,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AgentPresetSelect', () => {
  it('uses the deployment default, preserves badges, and filters broken choices', () => {
    const onSelect = vi.fn()
    const view = render(
      <AgentPresetSelect
        value={VALUE}
        session={undefined}
        bound={false}
        onOpen={vi.fn()}
        onSelect={onSelect}
        disabled={false}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '标准模式' }))

    expect(view.getAllByText('内置')).toHaveLength(2)
    expect(view.getByText('自定义')).toBeTruthy()
    expect(view.getByText('默认')).toBeTruthy()
    expect(view.queryByText('坏模式')).toBeNull()
    fireEvent.click(view.getByRole('menuitem', { name: /PTC 模式/ }))
    expect(onSelect).toHaveBeenCalledWith('code')
  })

  it('renders a stage ahead of the bound blank session preset', () => {
    const view = render(
      <AgentPresetSelect
        value={{ ...VALUE, staged: 'code' }}
        session={summary({ agentPreset: 'standard' })}
        bound
        onOpen={vi.fn()}
        onSelect={vi.fn()}
        disabled={false}
      />,
    )

    expect(view.getByRole('button', { name: 'PTC 模式' })).toBeTruthy()
  })

  it('keeps a started session inspectable while disabling every other mode', () => {
    const view = render(
      <AgentPresetSelect
        value={VALUE}
        session={summary({ blank: false, agentPreset: 'standard' })}
        bound
        onOpen={vi.fn()}
        onSelect={vi.fn()}
        disabled={false}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '标准模式' }))
    expect(view.getByText(/模式已锁定/)).toBeTruthy()
    expect((view.getByRole('menuitem', { name: /PTC 模式/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('menuitem', { name: /标准模式/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a session preset id even when the selectable roster is empty', () => {
    const view = render(
      <AgentPresetSelect
        value={{ presets: [], busy: false }}
        session={summary({ blank: false, agentPreset: 'removed-preset' })}
        bound
        onOpen={vi.fn()}
        onSelect={vi.fn()}
        disabled={false}
      />,
    )

    expect(view.getByRole('button', { name: 'removed-preset' })).toBeTruthy()
  })
})
