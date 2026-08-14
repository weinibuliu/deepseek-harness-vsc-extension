// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseGfmWithMath } from './parse.ts'
import { MarkdownText } from './MarkdownText.tsx'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
  type MarkdownFileMentions, type MarkdownRenderContext,
} from './render.tsx'

interface RenderOptions {
  streaming?: boolean
  fileMentions?: MarkdownFileMentions
  onOpenExternalUrl?: (url: string) => void
}

/** Render one markdown document through the settled (or streaming) pipeline. */
function renderMarkdown(text: string, options: RenderOptions = {}) {
  const root = parseGfmWithMath(text)
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  const context: MarkdownRenderContext = {
    streaming: options.streaming === true,
    codeLabels: undefined,
    fileMentions: options.fileMentions,
    onOpenExternalUrl: options.onOpenExternalUrl,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  const blocks = renderBlocks(root.children.map((node, index) => ({ node, key: index })), context)
  const section = renderFootnoteSection(context)
  const elements = section === null ? blocks : [...blocks, section]
  return render(<div>{elements}</div>)
}

describe('markdown rendering (semantic DOM)', () => {
  it('renders headings', () => {
    const { container } = renderMarkdown('# one\n\n## two\n\n### three')
    expect(container.querySelector('h1')?.textContent).toBe('one')
    expect(container.querySelector('h2')?.textContent).toBe('two')
    expect(container.querySelector('h3')?.textContent).toBe('three')
  })

  it('renders inline emphasis', () => {
    const { container } = renderMarkdown('**bold** *em* ~~gone~~ `code`')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('em')
    expect(container.querySelector('del')?.textContent).toBe('gone')
    expect(container.querySelector('code')?.textContent).toBe('code')
  })

  it('renders tight lists without paragraph wrappers', () => {
    const { container } = renderMarkdown('- a\n- b')
    expect([...container.querySelectorAll('ul > li')].map(li => li.textContent)).toEqual(['a', 'b'])
    expect(container.querySelector('ul > li > p')).toBeNull()
  })

  it('renders loose lists with paragraph wrappers', () => {
    const { container } = renderMarkdown('- a\n\n- b')
    expect(container.querySelector('ul > li > p')).not.toBeNull()
  })

  it('renders task-list checkboxes', () => {
    const { container } = renderMarkdown('- [x] done')
    const checkbox = container.querySelector('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })

  it('renders blockquote, thematic break, and tables', () => {
    const { container } = renderMarkdown('> quote\n\n---\n\n| h |\n| - |\n| c |')
    expect(container.querySelector('blockquote')?.textContent).toBe('quote')
    expect(container.querySelector('hr')).not.toBeNull()
    expect(container.querySelector('table th')?.textContent).toBe('h')
    expect(container.querySelector('table td')?.textContent).toBe('c')
  })

  it('renders raw HTML as literal text', () => {
    const { container } = renderMarkdown('<b>x</b>')
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>x</b>')
  })

  it('degrades images to alt text (no <img>, CSP has no remote img-src)', () => {
    const { container } = renderMarkdown('![alt text](https://example.com/a.png)')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('alt text')
  })

  it('renders an allowlisted link and routes clicks through the opener', () => {
    const open = vi.fn()
    const { container } = renderMarkdown('[x](https://example.com)', { onOpenExternalUrl: open })
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com')
    if (link) fireEvent.click(link)
    expect(open).toHaveBeenCalledWith('https://example.com')
  })

  it('unwraps disallowed-protocol links to plain text', () => {
    const { container } = renderMarkdown('[x](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('x')
  })
})

describe('code fences (finalize swap)', () => {
  it('renders plain during streaming and highlighted once settled', () => {
    const source = '```ts\nconst answer: number = 42\n```'
    const streaming = renderMarkdown(source, { streaming: true })
    expect(streaming.container.querySelector('.shiki')).toBeNull()
    expect(streaming.container.querySelector('pre code')).not.toBeNull()
    streaming.unmount()

    const settled = renderMarkdown(source)
    expect(settled.container.querySelector('.shiki')).not.toBeNull()
    settled.unmount()
  })

  it('falls back to plain text for an unknown language', () => {
    const { container } = renderMarkdown('```unknownlang\nbody\n```')
    expect(container.querySelector('.shiki')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('body')
  })
})

describe('file mentions', () => {
  it('turns a matching inline-code token into a clickable open button', () => {
    const open = vi.fn()
    const mentions: MarkdownFileMentions = {
      resolve: (value) => value === 'src/foo.ts'
        ? { open: () => open('src/foo.ts'), label: 'src/foo.ts', title: 'src/foo.ts' }
        : undefined,
    }
    const { container } = renderMarkdown('`src/foo.ts`', { fileMentions: mentions })
    const button = container.querySelector('button.md-file-mention')
    expect(button).not.toBeNull()
    if (button) fireEvent.click(button)
    expect(open).toHaveBeenCalledWith('src/foo.ts')
  })

  it('leaves non-matching inline-code tokens inert', () => {
    const mentions: MarkdownFileMentions = { resolve: () => undefined }
    const { container } = renderMarkdown('`not-a-file`', { fileMentions: mentions })
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('not-a-file')
  })
})

describe('footnotes', () => {
  it('renders a numbered superscript and a footnote section', () => {
    const { container } = renderMarkdown('note[^1]\n\n[^1]: body')
    expect(container.querySelector('sup')?.textContent).toBe('1')
    const section = container.querySelector('[data-footnotes]')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('body')
  })
})

describe('TeX math (KaTeX)', () => {
  it('renders inline and display math as KaTeX', () => {
    const inline = renderMarkdown('$x^2$')
    expect(inline.container.querySelector('.katex')).not.toBeNull()
    inline.unmount()

    const display = renderMarkdown('$$x^2$$')
    expect(display.container.querySelector('.katex')).not.toBeNull()
    display.unmount()
  })

  it('renders delimiter math as KaTeX while streaming', () => {
    const inline = renderMarkdown('$E = mc^2$', { streaming: true })
    expect(inline.container.querySelector('.katex')).not.toBeNull()
    inline.unmount()

    const display = renderMarkdown('$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$', { streaming: true })
    expect(display.container.querySelector('.katex')).not.toBeNull()
    display.unmount()

    const brackets = renderMarkdown('\\[\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\\]', { streaming: true })
    expect(brackets.container.querySelector('.katex')).not.toBeNull()
    brackets.unmount()
  })

  it('renders delimiter math mid-stream through MarkdownText', () => {
    const inline = render(<MarkdownText text="$E = mc^2$" streaming />)
    expect(inline.container.querySelector('.katex')).not.toBeNull()
    inline.unmount()

    const display = render(<MarkdownText text={'$$a^2 + b^2 = c^2$$'} streaming />)
    expect(display.container.querySelector('.katex')).not.toBeNull()
    display.unmount()
  })

  it('flips an open delimiter to KaTeX once it closes mid-stream', () => {
    const { container, rerender } = render(<MarkdownText text="$x^2" streaming />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toContain('$x^2')

    rerender(<MarkdownText text="$x^2$" streaming />)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it.each<[string, boolean]>([
    ['$x^2', false],
    ['$$a + b', false],
    ['$$\na + b', false],
    ['$$\n\\frac{1}{', false],
    ['$x^2$', true],
    ['$$a + b$$', true],
    ['\\[x + 1\\]', true],
    ['\\(x + 1\\)', true],
  ])('streams %j as katex=%s without a katex-error', (text, expectKatex) => {
    const { container } = render(<MarkdownText text={text} streaming />)
    expect(container.querySelector('.katex') !== null).toBe(expectKatex)
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('flips a same-line $$ block to KaTeX once it closes mid-stream', () => {
    const { container, rerender } = render(<MarkdownText text="$$a + b" streaming />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toContain('$$a + b')

    rerender(<MarkdownText text="$$a + b$$" streaming />)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('renders ```math fences as display KaTeX once settled', () => {
    const streaming = renderMarkdown('```math\nx+1\n```', { streaming: true })
    expect(streaming.container.querySelector('.katex')).toBeNull()
    streaming.unmount()

    const settled = renderMarkdown('```math\nx+1\n```')
    expect(settled.container.querySelector('.katex')).not.toBeNull()
    settled.unmount()
  })
})
