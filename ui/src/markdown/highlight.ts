/**
 * The webview's syntax highlighter for markdown code fences: a synchronous
 * fine-grained shiki core (JavaScript regex engine — no oniguruma WASM) with
 * an explicit grammar allowlist and a CSS-variables theme. Token colors live
 * as `--shiki-*` custom properties in markdown.css (mapped to `--vscode-*`),
 * never here.
 *
 * The three boot grammars (TypeScript, shell, JSON) load at module eval; the
 * wider set imports lazily on first use, so a session that never renders a
 * fence in one of those languages pays nothing for its grammar module. An
 * unknown or not-yet-loaded language falls back to plain text — never an error.
 */

import { createHighlighterCoreSync, createCssVariablesTheme } from "shiki/core";
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from "shiki/engine/javascript";
import langTs from "@shikijs/langs/typescript";
import langBash from "@shikijs/langs/shellscript";
import langJson from "@shikijs/langs/json";
import type { HighlighterCore } from "shiki/core";

/** A shiki grammar module's default export (a `LanguageRegistration[]`). */
type LangModule = { default: typeof langTs };

/**
 * Grammars the singleton loads at boot. JS-family aliases resolve to the
 * TypeScript grammar (shiki's TS grammar tokenizes plain TS/JS exactly and
 * JSX/TSX approximately), keeping the boot set to one JS-family grammar.
 */
const LANGS = [langTs, langBash, langJson];

/** Grammars loaded lazily on first use, keyed by their registration name. */
const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ["python", () => import("@shikijs/langs/python")],
  ["ruby", () => import("@shikijs/langs/ruby")],
  ["go", () => import("@shikijs/langs/go")],
  ["rust", () => import("@shikijs/langs/rust")],
  ["java", () => import("@shikijs/langs/java")],
  ["c", () => import("@shikijs/langs/c")],
  ["cpp", () => import("@shikijs/langs/cpp")],
  ["csharp", () => import("@shikijs/langs/csharp")],
  ["kotlin", () => import("@shikijs/langs/kotlin")],
  ["swift", () => import("@shikijs/langs/swift")],
  ["php", () => import("@shikijs/langs/php")],
  ["yaml", () => import("@shikijs/langs/yaml")],
  ["toml", () => import("@shikijs/langs/toml")],
  ["ini", () => import("@shikijs/langs/ini")],
  ["markdown", () => import("@shikijs/langs/markdown")],
  ["mdx", () => import("@shikijs/langs/mdx")],
  ["html", () => import("@shikijs/langs/html")],
  ["css", () => import("@shikijs/langs/css")],
  ["scss", () => import("@shikijs/langs/scss")],
  ["less", () => import("@shikijs/langs/less")],
  ["sql", () => import("@shikijs/langs/sql")],
  ["xml", () => import("@shikijs/langs/xml")],
  ["lua", () => import("@shikijs/langs/lua")],
]);

/**
 * Language ids (and aliases) the highlighter accepts; everything else renders
 * plain. A Map, not an object: fence info strings are assistant-authored, so a
 * label like `constructor` must miss instead of resolving an inherited property.
 * The JS family maps to the TypeScript grammar (see {@link LANGS}).
 */
const LANG_ALIASES = new Map<string, string>([
  ["typescript", "typescript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["javascript", "typescript"],
  ["js", "typescript"],
  ["jsx", "typescript"],
  ["shellscript", "shellscript"],
  ["bash", "shellscript"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["zsh", "shellscript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["py", "python"],
  ["python", "python"],
  ["rb", "ruby"],
  ["ruby", "ruby"],
  ["go", "go"],
  ["rs", "rust"],
  ["rust", "rust"],
  ["java", "java"],
  ["c", "c"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["csharp", "csharp"],
  ["kotlin", "kotlin"],
  ["swift", "swift"],
  ["php", "php"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "toml"],
  ["ini", "ini"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["mdx", "mdx"],
  ["html", "html"],
  ["css", "css"],
  ["scss", "scss"],
  ["less", "less"],
  ["sql", "sql"],
  ["xml", "xml"],
  ["lua", "lua"],
]);

/** All token colors resolve through `--shiki-*` custom properties (markdown.css). */
const cssVariablesTheme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  fontStyle: true,
});

/**
 * The regex engine compiles each TextMate pattern when its scanner is created.
 * Eager compilation leaves shiki's per-line tokenize budget for user content.
 */
const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: (pattern) =>
    defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    }),
});

let singleton: HighlighterCore | undefined;

/** Representative paths through every boot grammar, compiled before user content is timed. */
const BOOT_GRAMMAR_WARMUPS = [
  { lang: "typescript", code: "const answer: number = 42" },
  { lang: "shellscript", code: "printf '%s\\n' \"$HOME\"" },
  { lang: "json", code: '{"ready":true}' },
] as const;

/** Construct and pre-tokenize the boot grammars outside the user-content scan budget. */
function createHighlighter(): HighlighterCore {
  const instance = createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  });
  for (const sample of BOOT_GRAMMAR_WARMUPS) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: "css-variables",
      tokenizeTimeLimit: 0,
    });
  }
  return instance;
}

/** The synchronous highlighter (one instance per document); pre-warmed below. */
function highlighter(): HighlighterCore {
  singleton ??= createHighlighter();
  return singleton;
}

/** Grammar ids whose lazy import is in flight or done, so it is requested once. */
const requested = new Set<string>();
/** Subscribers re-rendered after a lazy grammar registers (React callers). */
const listeners = new Set<() => void>();
/** Bumped on each lazy-grammar load; the `useSyncExternalStore` snapshot. */
let loadCount = 0;

/**
 * Subscribe to lazy-grammar load completions.
 * @param listener - invoked (no args) on each grammar-load completion.
 * @returns a disposer that removes the listener.
 */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The lazy-grammar load counter — a value that changes on every load, so a
 * `useSyncExternalStore` snapshot re-renders the subscriber when a grammar
 * registers.
 * @returns the current load count.
 */
export function grammarLoadCount(): number {
  return loadCount;
}

/**
 * Ensure the grammar `resolved` names is registered. A boot grammar and an
 * already-loaded lazy grammar report ready synchronously; a lazy grammar not
 * yet loaded starts its import (once) and reports not-ready.
 * @param resolved - the grammar id an alias resolved to.
 * @returns whether the grammar is registered and ready to tokenize now.
 */
function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved);
  if (load === undefined) return true;
  if (highlighter().getLoadedLanguages().includes(resolved)) return true;
  if (!requested.has(resolved)) {
    requested.add(resolved);
    void load().then((mod) => {
      highlighter().loadLanguageSync(mod.default);
      loadCount += 1;
      for (const listener of listeners) listener();
    });
  }
  return false;
}

// Engine + grammar construction costs a long task (~120-175ms); warming the
// singleton at module load moves it out of the first finalized fence's render.
setTimeout(() => {
  highlighter();
}, 0);

/**
 * Highlight `code` into shiki's HTML (a single `<pre class="shiki">` tree)
 * when `lang` maps to a registered grammar; `undefined` means the caller
 * renders its plain fallback. A lazy grammar not yet loaded returns `undefined`
 * for this call and loads in the background.
 * @param code - the source text.
 * @param lang - the language hint (a markdown fence info string).
 * @returns the highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightToHtml(
  code: string,
  lang: string | undefined,
): string | undefined {
  const resolved =
    lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase());
  if (resolved === undefined) return undefined;
  if (!ensureGrammar(resolved)) return undefined;
  return highlighter().codeToHtml(code, {
    lang: resolved,
    theme: "css-variables",
  });
}
