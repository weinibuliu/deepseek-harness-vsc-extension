// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PermissionSelectView } from '../../../src/shared/protocol.ts'
import { PermissionSelect } from './PermissionSelect.tsx'

const VALUE: PermissionSelectView = {
  currentValue: 'workspace-write',
  options: [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ],
}

function rect(values: Partial<DOMRect>): DOMRect {
  return {
    bottom: 528,
    height: 28,
    left: 128,
    right: 238,
    top: 500,
    width: 110,
    x: 128,
    y: 500,
    toJSON: () => ({}),
    ...values,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PermissionSelect menu placement', () => {
  it('keeps the menu inside a narrow viewport when another control trails the trigger', () => {
    vi.stubGlobal('innerWidth', 350)
    vi.stubGlobal('innerHeight', 700)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240)

    const view = render(<PermissionSelect value={VALUE} onSelect={vi.fn()} disabled={false} />)
    const root = view.container.firstElementChild as HTMLDivElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect({}))

    fireEvent.click(view.getByRole('button', { name: '工作区写入' }))

    const menu = document.querySelector<HTMLElement>('.w-72')
    expect(menu).not.toBeNull()
    expect(Number.parseFloat(menu?.style.left ?? '')).toBeGreaterThanOrEqual(16)
  })

  it('keeps portaled menu items interactive', () => {
    vi.stubGlobal('innerWidth', 350)
    vi.stubGlobal('innerHeight', 700)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240)
    const onSelect = vi.fn()

    const view = render(<PermissionSelect value={VALUE} onSelect={onSelect} disabled={false} />)
    const root = view.container.firstElementChild as HTMLDivElement
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect({}))
    fireEvent.click(view.getByRole('button', { name: '工作区写入' }))

    const option = view.getByRole('menuitem', { name: '只读' })
    fireEvent.mouseDown(option)
    fireEvent.click(option)

    expect(onSelect).toHaveBeenCalledWith('read-only')
    expect(view.queryByRole('menu')).toBeNull()
  })
})
