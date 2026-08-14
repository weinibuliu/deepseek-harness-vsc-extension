/**
 * Direct mdast→React markdown renderer (the extension's own renderer, aligning
 * dsh web's MarkdownText semantics without reusing its frontend code). One
 * switch over parsed nodes so streaming can cache frozen blocks as React
 * elements.
 *
 * Untrusted-output policy (aligned with dsh): link destinations pass a
 * protocol allowlist (http/https/mailto), raw HTML renders as literal text,
 * KaTeX runs without trusted commands, and images degrade to alt text because
 * the webview CSP allows no remote img-src.
 */

import { Fragment, createElement } from 'react'
import type { Key, ReactNode } from 'react'
import type * as Md from 'mdast'
import type {} from 'mdast-util-math'
import { normalizeUri } from 'micromark-util-sanitize-uri'
import { CodeBlock } from './CodeBlock.tsx'
import { renderTexToReact } from './katex.tsx'
import type { PositionedBlock } from './incremental.ts'

/** Copy-button labels forwarded to fence CodeBlocks. */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

/**
 * File-mention affordance for inline code: the owner resolves an authored
 * token to the file it names, using its own vocabulary of real files — the
 * renderer never guesses at what looks like a path.
 */
export interface MarkdownFileMentions {
  /**
   * Resolve one inline-code token.
   * @param value - The authored token, exactly as written.
   * @returns The opener with its accessible label and full-path title, or
   * undefined when the token names no known file — it then stays inert code.
   */
  resolve(value: string): { open: () => void; label: string; title: string } | undefined
}

/** Link/image reference targets collected from a document (first definition per identifier wins). */
export interface ReferenceTargets {
  /** Link/image definitions keyed by upper-cased identifier. */
  definitions: Map<string, Md.Definition>
  /** Footnote definitions keyed by upper-cased identifier. */
  footnotes: Map<string, Md.FootnoteDefinition>
}

/** One render pass's state. */
export interface MarkdownRenderContext {
  /** Streaming arm: fences render plain; delimiter math renders, multi-line $$ and fenced ```math defer to settled. */
  readonly streaming: boolean
  /** Localized fence copy-button labels. */
  readonly codeLabels: MarkdownCodeLabels | undefined
  /** Inline-code file mentions; absent wherever no opener vocabulary exists. */
  readonly fileMentions: MarkdownFileMentions | undefined
  /** External-link opener; when set, links route through it instead of navigating. */
  readonly onOpenExternalUrl: ((url: string) => void) | undefined
  /** Inside an anchor's children: interactive mentions must not nest there. */
  readonly inLink?: boolean
  /** Reference targets visible to this pass. */
  readonly targets: ReferenceTargets
  /** Footnote identifiers in first-reference order; a footnote's number is its 1-based index here. */
  readonly footnoteOrder: string[]
  /** References rendered per identifier; drives the section's back-reference count. */
  readonly footnoteCounts: Map<string, number>
}

/** Create an empty {@link ReferenceTargets}. */
export function createReferenceTargets(): ReferenceTargets {
  return { definitions: new Map(), footnotes: new Map() }
}

/**
 * Record every definition and footnote definition under `nodes` into
 * `targets`, depth-first, keeping the first definition per identifier.
 * @param nodes - Subtrees to walk (top-level blocks or any nested children).
 * @param targets - Accumulator, typically shared across incremental segments.
 */
export function collectReferenceTargets(
  nodes: readonly Md.RootContent[],
  targets: ReferenceTargets,
): void {
  for (const node of nodes) {
    if (node.type === 'definition') {
      const id = node.identifier.toUpperCase()
      if (!targets.definitions.has(id)) targets.definitions.set(id, node)
    } else if (node.type === 'footnoteDefinition') {
      const id = node.identifier.toUpperCase()
      if (!targets.footnotes.has(id)) targets.footnotes.set(id, node)
    }
    if ('children' in node) collectReferenceTargets(node.children, targets)
  }
}

function sanitizeUrl(url: string): string {
  try {
    switch (new URL(url).protocol) {
      case 'http:':
      case 'https:':
      case 'mailto:':
        return url
      default:
        return ''
    }
  } catch {
    // Relative and otherwise unparsable destinations are disallowed alongside
    // disallowed protocols.
    return ''
  }
}

/** The complete inline-code value when it is exactly an absolute HTTP(S) URL. */
function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/** Anchor over an already-authored href: allowlisted or unwrapped. */
function renderSafeLink(href: string, children: ReactNode[], key: Key, context: MarkdownRenderContext): ReactNode {
  const safeHref = sanitizeUrl(href)
  if (safeHref === '') return <Fragment key={key}>{children}</Fragment>
  const onOpen = context.onOpenExternalUrl
  if (onOpen === undefined) {
    return <a key={key} href={safeHref}>{children}</a>
  }
  return (
    <a
      key={key}
      href={safeHref}
      className="cursor-pointer text-link hover:underline"
      onClick={(event) => {
        event.preventDefault()
        onOpen(safeHref)
      }}
    >
      {children}
    </a>
  )
}

/** Anchor over a parsed markdown destination, which hast normalized before the allowlist saw it. */
function renderAnchor(url: string, children: ReactNode[], key: Key, context: MarkdownRenderContext): ReactNode {
  return renderSafeLink(normalizeUri(url), children, key, context)
}

function renderImage(url: string, alt: string, key: Key): ReactNode {
  // The webview CSP allows no remote img-src, so images degrade to alt text
  // instead of a broken <img> (an intentional deviation from dsh web, which
  // renders absolute http(s) images in a browser context).
  void url
  return <span key={key}>{alt}</span>
}

/** The bracketed source text a reference reverts to when its definition is missing. */
function referenceSuffix(node: Md.LinkReference | Md.ImageReference): string {
  if (node.referenceType === 'collapsed') return '][]'
  if (node.referenceType === 'full') return `][${node.label ?? node.identifier}]`
  return ']'
}

function renderLinkReference(
  node: Md.LinkReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase())
  if (definition === undefined) {
    return <Fragment key={key}>{'['}{renderChildren(node.children, context)}{referenceSuffix(node)}</Fragment>
  }
  return renderAnchor(definition.url, renderChildren(node.children, { ...context, inLink: true }), key, context)
}

function renderImageReference(
  node: Md.ImageReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase())
  if (definition === undefined) return `![${node.alt ?? ''}${referenceSuffix(node)}`
  return renderImage(definition.url, node.alt ?? '', key)
}

function renderFootnoteReference(
  node: Md.FootnoteReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const id = node.identifier.toUpperCase()
  const seen = context.footnoteCounts.get(id)
  if (seen === undefined) context.footnoteOrder.push(id)
  context.footnoteCounts.set(id, (seen ?? 0) + 1)
  return <sup key={key}>{String(context.footnoteOrder.indexOf(id) + 1)}</sup>
}

function renderCode(node: Md.Code, key: Key, context: MarkdownRenderContext): ReactNode {
  const language = node.lang ?? undefined
  if (node.value === '') {
    return (
      <pre key={key}>
        <code className={language === undefined ? undefined : `language-${language}`} />
      </pre>
    )
  }
  const lang = language === undefined ? undefined : /^[\w-]+/.exec(language)?.[0]
  if (!context.streaming && lang === 'math') {
    // ```math fences render as display TeX only once settled: an unclosed
    // fence mid-stream can carry incomplete TeX, unlike delimiter math whose
    // closing delimiter guarantees completeness.
    return <Fragment key={key}>{renderTexToReact(`${node.value}\n`, true)}</Fragment>
  }
  return (
    <CodeBlock
      key={key}
      // The appended synthetic newline matches the source's trailing blank
      // line; CodeBlock's display trim then removes only that one.
      code={`${node.value}\n`}
      lang={context.streaming ? undefined : lang}
      copyLabel={context.codeLabels?.copyLabel}
      copiedLabel={context.codeLabels?.copiedLabel}
    />
  )
}

/** A list is loose when it or any of its items is spread; every item then keeps its paragraphs. */
function listLoose(list: Md.List): boolean {
  return (list.spread ?? false) || list.children.some(listItemLoose)
}

function listItemLoose(item: Md.ListItem): boolean {
  return item.spread ?? item.children.length > 1
}

function renderList(node: Md.List, key: Key, context: MarkdownRenderContext): ReactNode {
  const loose = listLoose(node)
  const properties: { start?: number; className?: string } = {}
  if (typeof node.start === 'number' && node.start !== 1) properties.start = node.start
  if (node.children.some(item => typeof item.checked === 'boolean')) {
    properties.className = 'contains-task-list'
  }
  return createElement(
    node.ordered === true ? 'ol' : 'ul',
    { key, ...properties },
    ...node.children.map((item, index) => renderListItem(item, loose, index, context)),
  )
}

function renderListItem(
  item: Md.ListItem,
  loose: boolean,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const entries = renderBlockEntries(item.children, context)
  const task = typeof item.checked === 'boolean'
  if (task) {
    const checkbox = <input key="task-checkbox" type="checkbox" checked={item.checked === true} disabled />
    const head = entries[0]
    if (head !== undefined && 'paragraph' in head) {
      head.paragraph = head.paragraph.length > 0 ? [checkbox, ' ', ...head.paragraph] : [checkbox]
    } else {
      entries.unshift({ paragraph: [checkbox] })
    }
  }
  const parts: ReactNode[] = []
  for (const [index, entry] of entries.entries()) {
    if ('paragraph' in entry) {
      parts.push(loose ? <p key={`p-${index}`}>{entry.paragraph}</p> : <Fragment key={`p-${index}`}>{entry.paragraph}</Fragment>)
    } else {
      parts.push(entry.element)
    }
  }
  return (
    <li key={key} className={task ? 'task-list-item' : undefined}>
      {parts}
    </li>
  )
}

function renderTable(node: Md.Table, key: Key, context: MarkdownRenderContext): ReactNode {
  const align = node.align ?? null
  const [headRow, ...bodyRows] = node.children
  return (
    <div key={key} className="md-table-scroll">
      <table>
        {headRow !== undefined && <thead>{renderTableRow(headRow, 'th', align, 0, context)}</thead>}
        {bodyRows.length > 0 && (
          <tbody>
            {bodyRows.map((row, index) => renderTableRow(row, 'td', align, index + 1, context))}
          </tbody>
        )}
      </table>
    </div>
  )
}

function renderTableRow(
  row: Md.TableRow,
  cellTag: 'th' | 'td',
  align: readonly Md.AlignType[] | null,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const length = align === null ? row.children.length : align.length
  const cells: ReactNode[] = []
  for (let index = 0; index < length; index++) {
    const cell = row.children[index]
    const alignValue = align?.[index]
    cells.push(createElement(
      cellTag,
      { key: index, style: alignValue == null ? undefined : { textAlign: alignValue } },
      ...(cell === undefined ? [] : renderChildren(cell.children, context)),
    ))
  }
  return <tr key={key}>{cells}</tr>
}

/** A block child rendered for a parent that must tell paragraphs apart from other blocks. */
type BlockEntry = { paragraph: ReactNode[] } | { element: ReactNode }

/** Render container children into {@link BlockEntry} values, dropping empty renders. */
function renderBlockEntries(
  blocks: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): BlockEntry[] {
  const entries: BlockEntry[] = []
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'paragraph') {
      entries.push({ paragraph: renderChildren(block.children, context) })
    } else {
      const element = renderNode(block, index, context)
      if (element !== null) entries.push({ element })
    }
  }
  return entries
}

function renderChildren(
  nodes: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index, context))
}

function renderNode(node: Md.RootContent, key: Key, context: MarkdownRenderContext): ReactNode {
  switch (node.type) {
    case 'text':
      return node.value
    case 'paragraph':
      return <p key={key}>{renderChildren(node.children, context)}</p>
    case 'heading':
      return createElement(`h${node.depth}`, { key }, ...renderChildren(node.children, context))
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node.children, context)}</blockquote>
    case 'thematicBreak':
      return <hr key={key} />
    case 'break':
      return <br key={key} />
    case 'strong':
      return <strong key={key}>{renderChildren(node.children, context)}</strong>
    case 'emphasis':
      return <em key={key}>{renderChildren(node.children, context)}</em>
    case 'delete':
      return <del key={key}>{renderChildren(node.children, context)}</del>
    case 'inlineCode': {
      const value = node.value.replace(/\r?\n|\r/g, ' ')
      // An inline-code token that is entirely an absolute HTTP(S) URL keeps its
      // code chrome and gains the same safe external anchor as a link.
      const href = inlineCodeHttpUrl(value)
      if (href !== undefined) return <code key={key}>{renderSafeLink(href, [value], 'link', context)}</code>
      // A token the owner's file-mention vocabulary recognizes opens that file.
      const mention = context.inLink === true ? undefined : context.fileMentions?.resolve(value)
      if (mention !== undefined) {
        return (
          <code key={key}>
            <button
              type="button"
              className="md-file-mention"
              title={mention.title}
              aria-label={mention.label}
              onClick={mention.open}
            >
              {value}
            </button>
          </code>
        )
      }
      return <code key={key}>{value}</code>
    }
    case 'html':
      // No HTML parser enters the pipeline: raw HTML stays literal text.
      return node.value
    case 'code':
      return renderCode(node, key, context)
    case 'math':
      return <Fragment key={key}>{renderTexToReact(node.value, true)}</Fragment>
    case 'inlineMath':
      return <Fragment key={key}>{renderTexToReact(node.value, false)}</Fragment>
    case 'list':
      return renderList(node, key, context)
    case 'listItem':
      return renderListItem(node, listItemLoose(node), key, context)
    case 'table':
      return renderTable(node, key, context)
    case 'link':
      return renderAnchor(node.url, renderChildren(node.children, { ...context, inLink: true }), key, context)
    case 'linkReference':
      return renderLinkReference(node, key, context)
    case 'image':
      return renderImage(node.url, node.alt ?? '', key)
    case 'imageReference':
      return renderImageReference(node, key, context)
    case 'footnoteReference':
      return renderFootnoteReference(node, key, context)
    case 'definition':
    case 'footnoteDefinition':
      // Targets render elsewhere: definitions resolve references in place;
      // footnote bodies render in the trailing section.
      return null
    default:
      // Node types without a mapping (tableRow/tableCell outside a table,
      // frontmatter, future grammar contributions) render nothing.
      return null
  }
}

/** Render top-level blocks, dropping nodes that render nothing. */
export function renderBlocks(
  blocks: readonly PositionedBlock[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return blocks.map(block => renderNode(block.node, block.key, context)).filter(element => element !== null)
}

/**
 * Render the trailing footnote section for every footnote referenced during
 * the pass, in first-reference order, with one plain-text back-reference
 * marker per rendered reference.
 * @param context - The pass state after all blocks rendered.
 * @returns The section, or null when no referenced footnote has a definition.
 */
export function renderFootnoteSection(context: MarkdownRenderContext): ReactNode | null {
  const items: ReactNode[] = []
  for (const id of context.footnoteOrder) {
    const definition = context.targets.footnotes.get(id)
    if (definition === undefined) continue
    const count = context.footnoteCounts.get(id) ?? 0
    const backrefs: ReactNode[] = []
    for (let reference = 1; reference <= count; reference++) {
      if (backrefs.length > 0) backrefs.push(' ')
      backrefs.push('↩')
      if (reference > 1) backrefs.push(<sup key={`re-${reference}`}>{String(reference)}</sup>)
    }
    const entries = renderBlockEntries(definition.children, context)
    const tail = entries[entries.length - 1]
    const body: ReactNode[] = entries.map((entry, index) => (
      'paragraph' in entry
        ? (
          <p key={`p-${index}`}>
            {entry.paragraph}
            {entry === tail && <>{' '}{backrefs}</>}
          </p>
        )
        : entry.element
    ))
    if (tail === undefined || !('paragraph' in tail)) body.push(...backrefs)
    items.push(<li key={id}>{body}</li>)
  }
  if (items.length === 0) return null
  return (
    <section key="footnotes" data-footnotes className="footnotes">
      <h2 className="sr-only">Footnotes</h2>
      <ol>{items}</ol>
    </section>
  )
}
