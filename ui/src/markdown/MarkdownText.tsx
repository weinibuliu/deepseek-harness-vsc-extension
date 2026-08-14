/**
 * Untrusted assistant-Markdown renderer over the direct mdast pipeline:
 * `parse.ts` grammars, the incremental streaming parser, and `render.tsx`.
 * While a message streams, all but the trailing two blocks freeze as cached
 * React elements and only the source tail behind them re-parses per chunk.
 * Delimiter math ($, \( \), \[ \], and same-line $$) renders as KaTeX as soon
 * as its closing delimiter lands, so formulas appear mid-stream; the multi-line
 * `$$` fence and fenced ```math stay plain until the settled swap because an
 * unclosed fence can carry incomplete TeX.
 * Known deviation while streaming: a reference-style link or footnote whose
 * definition sits on the other side of the freeze boundary renders literally
 * until the settled full parse self-heals it.
 */

import { memo, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { IncrementalMarkdownParser } from './incremental.ts'
import { parseGfmWithMath, parseGfmWithMathStreaming } from './parse.ts'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
} from './render.tsx'
import type {
  MarkdownCodeLabels, MarkdownFileMentions, MarkdownRenderContext, ReferenceTargets,
} from './render.tsx'
import 'katex/dist/katex.min.css'
import './markdown.css'

export type { MarkdownCodeLabels, MarkdownFileMentions } from './render.tsx'

/** One settled full render: parse with math, resolve references, append the footnote section. */
function renderSettled(
  text: string,
  codeLabels: MarkdownCodeLabels | undefined,
  fileMentions: MarkdownFileMentions | undefined,
  onOpenExternalUrl: ((url: string) => void) | undefined,
): ReactNode[] {
  const root = parseGfmWithMath(text)
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  const context: MarkdownRenderContext = {
    streaming: false,
    codeLabels,
    fileMentions,
    onOpenExternalUrl,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  const blocks = renderBlocks(root.children.map((node, index) => ({ node, key: index })), context)
  const section = renderFootnoteSection(context)
  return section === null ? blocks : [...blocks, section]
}

/** Streaming render state for one growing message. */
class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfmWithMathStreaming)
  private generation = -1
  private frozenCount = 0
  private frozenElements: ReactNode[] = []
  private frozenTargets: ReferenceTargets = createReferenceTargets()
  private frozenFootnoteOrder: string[] = []
  private frozenFootnoteCounts = new Map<string, number>()
  private lastText: string | null = null
  private lastRendered: ReactNode[] = []

  /** @param codeLabels - Fence copy labels baked into cached elements; the owner replaces the renderer when they change. */
  constructor(
    private readonly codeLabels: MarkdownCodeLabels | undefined,
    private readonly onOpenExternalUrl: ((url: string) => void) | undefined,
  ) {}

  /** Render the current accumulated text; idempotent per text value. */
  render(text: string): ReactNode[] {
    if (text === this.lastText) return this.lastRendered
    const { frozen, tail, generation } = this.parser.update(text)
    if (generation !== this.generation) {
      this.generation = generation
      this.frozenCount = 0
      this.frozenElements = []
      this.frozenTargets = createReferenceTargets()
      this.frozenFootnoteOrder = []
      this.frozenFootnoteCounts = new Map()
    }
    const newlyFrozen = frozen.slice(this.frozenCount)
    collectReferenceTargets(newlyFrozen.map(block => block.node), this.frozenTargets)
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    }
    collectReferenceTargets(tail.map(block => block.node), frameTargets)
    if (newlyFrozen.length > 0) {
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        codeLabels: this.codeLabels,
        fileMentions: undefined,
        onOpenExternalUrl: this.onOpenExternalUrl,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      }
      const batch = [...this.frozenElements]
      for (const element of renderBlocks(newlyFrozen, frozenContext)) batch.push(element)
      this.frozenElements = batch
      this.frozenCount = frozen.length
    }
    const tailContext: MarkdownRenderContext = {
      streaming: true,
      codeLabels: this.codeLabels,
      fileMentions: undefined,
      onOpenExternalUrl: this.onOpenExternalUrl,
      targets: frameTargets,
      footnoteOrder: [...this.frozenFootnoteOrder],
      footnoteCounts: new Map(this.frozenFootnoteCounts),
    }
    const children = [...this.frozenElements]
    for (const element of renderBlocks(tail, tailContext)) children.push(element)
    const section = renderFootnoteSection(tailContext)
    if (section !== null) children.push(section)
    this.lastText = text
    this.lastRendered = children
    return this.lastRendered
  }
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - `streaming` parses incrementally across chunks and renders
 * delimiter math ($, \( \), \[ \], and same-line $$) as KaTeX mid-stream; the
 * multi-line $$ fence and fenced ```math stay plain (shiki highlighting and
 * both fences land on the finalize swap).
 * `fileMentions` links inline-code tokens its resolver recognizes as real
 * files and applies to settled renders only.
 */
export const MarkdownText = memo(function MarkdownText({
  text, streaming = false, codeLabels, fileMentions, onOpenExternalUrl,
}: {
  text: string
  streaming?: boolean
  codeLabels?: MarkdownCodeLabels | undefined
  fileMentions?: MarkdownFileMentions | undefined
  onOpenExternalUrl?: ((url: string) => void) | undefined
}) {
  const streamRef = useRef<StreamingRenderer | null>(null)
  const streamCodeLabelsRef = useRef<MarkdownCodeLabels | undefined>(codeLabels)
  const streamOnOpenRef = useRef<((url: string) => void) | undefined>(onOpenExternalUrl)
  const children = useMemo(() => {
    if (!streaming) {
      streamRef.current = null
      return renderSettled(text, codeLabels, fileMentions, onOpenExternalUrl)
    }
    if (streamRef.current === null || streamCodeLabelsRef.current !== codeLabels || streamOnOpenRef.current !== onOpenExternalUrl) {
      streamRef.current = new StreamingRenderer(codeLabels, onOpenExternalUrl)
      streamCodeLabelsRef.current = codeLabels
      streamOnOpenRef.current = onOpenExternalUrl
    }
    return streamRef.current.render(text)
  }, [text, streaming, codeLabels, fileMentions, onOpenExternalUrl])
  return <div className="markdown">{children}</div>
})
