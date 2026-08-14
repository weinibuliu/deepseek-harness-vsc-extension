/**
 * The markdown renderer's two micromark grammars. Mirrors
 * dsh-client-ui-primitives parse.ts so the syntax face matches dsh web: the
 * streaming and settled arms both parse GFM plus TeX math
 * (micromark-extension-math plus the compatibility delimiters), so formulas
 * render as soon as their closing delimiter lands. A GFM-only grammar is kept
 * as the no-math baseline for tests and for callers that must not emit math.
 */

import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'

/**
 * Parse GFM markdown without TeX math.
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters
 * (the grammar shared by the streaming and settled arms).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
}
