/**
 * The markdown renderer's micromark grammars. Mirrors
 * dsh-client-ui-primitives parse.ts so the syntax face matches dsh web: the
 * streaming and settled arms both parse GFM plus TeX math
 * (micromark-extension-math plus the compatibility delimiters). The streaming
 * arm omits the fenced `$$` block — its standard `mathFlow` construct accepts
 * an unclosed fence at EOF, which would flash a KaTeX error or swallow
 * same-line content mid-stream — so it streams only delimiter math ($, \(…\),
 * \[…\], and same-line $$) and defers the $$ fence to the settled parse. A
 * GFM-only grammar is kept as the no-math baseline for tests and for callers
 * that must not emit math.
 */

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { cjkFriendlyStrong } from "./cjkFriendlyStrong.ts";
import { mathCompatibility } from "./mathCompatibility.ts";

/**
 * Parse GFM markdown without TeX math.
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters
 * (the settled arm's grammar, including the multi-line `$$` fence).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
}

/**
 * Parse GFM plus delimiter math for the streaming arm: inline `$…$`, `\(…\)`,
 * `\[…\]`, and same-line `$$…$$` parse as math, while the multi-line `$$…$$`
 * fence is left out so an unclosed fence stays literal rather than flashing a
 * KaTeX error or swallowing same-line content (the standard `mathFlow` accepts
 * an unclosed fence at EOF). The fence re-enters via {@link parseGfmWithMath}
 * on the settled swap.
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMathStreaming(text: string): Root {
  const mathInline = math();
  return fromMarkdown(text, {
    extensions: [
      gfm(),
      cjkFriendlyStrong(),
      mathCompatibility(),
      { text: mathInline.text },
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
}
