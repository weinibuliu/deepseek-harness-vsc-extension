import { describe, expect, it } from "vitest";
import {
  parseGfm,
  parseGfmWithMath,
  parseGfmWithMathStreaming,
} from "./parse.ts";

describe("parseGfm (GFM only)", () => {
  it("parses GFM block constructs to their mdast node types", () => {
    const root = parseGfm(
      [
        "# Heading",
        "",
        "- a",
        "- b",
        "",
        "| h |",
        "| - |",
        "| c |",
        "",
        "> quote",
        "",
        "~~~",
        "fenced",
        "~~~",
      ].join("\n"),
    );
    expect(root.children.map((node) => node.type)).toEqual([
      "heading",
      "list",
      "table",
      "blockquote",
      "code",
    ]);
  });

  it("parses inline constructs (strong, delete, inline code, link)", () => {
    const root = parseGfm("**bold** ~~gone~~ `code` [x](https://example.com)");
    const paragraph = root.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children.map((node) => node.type)).toEqual([
      "strong",
      "text",
      "delete",
      "text",
      "inlineCode",
      "text",
      "link",
    ]);
  });

  it("parses footnotes and task-list items (GFM extensions)", () => {
    const root = parseGfm("- [x] done\n\nnote[^1]\n\n[^1]: body");
    const list = root.children[0];
    expect(list?.type).toBe("list");
    if (list?.type !== "list") throw new Error("expected list");
    expect(list.children[0]?.type).toBe("listItem");
    expect(
      root.children.some((node) => node.type === "footnoteDefinition"),
    ).toBe(true);
    expect(
      root.children.some(
        (node) =>
          node.type === "paragraph" &&
          "children" in node &&
          node.children.some((child) => child.type === "footnoteReference"),
      ),
    ).toBe(true);
  });

  it("keeps raw HTML as html nodes (rendered literally downstream)", () => {
    // Block-level HTML becomes a top-level html node.
    const block = parseGfm("<div>x</div>");
    expect(block.children[0]?.type).toBe("html");
    // Inline HTML stays an html child inside its paragraph.
    const inline = parseGfm("a <b>x</b>");
    const paragraph = inline.children[0];
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children.some((node) => node.type === "html")).toBe(true);
  });
});

describe("parseGfmWithMath (GFM + math)", () => {
  it("parses inline and display TeX math", () => {
    const root = parseGfmWithMath("$x$\n\n$$y$$");
    const paragraph = root.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children.some((node) => node.type === "inlineMath")).toBe(
      true,
    );
    expect(root.children.some((node) => node.type === "math")).toBe(true);
  });

  it("parses compatibility delimiters \\( … \\) and \\[ … \\]", () => {
    const root = parseGfmWithMath("text \\(a+b\\) and \\[c\\]");
    const paragraph = root.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children.some((node) => node.type === "inlineMath")).toBe(
      true,
    );
  });

  it("omits math in the GFM-only grammar", () => {
    const root = parseGfm("$x$");
    const paragraph = root.children[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");
    expect(paragraph.children.every((node) => node.type === "text")).toBe(true);
  });
});

describe("parseGfmWithMathStreaming (streaming grammar, no $$ fence)", () => {
  it("keeps an unclosed $$ fence literal instead of a math node", () => {
    // Same-line: the standard mathFlow would swallow `a + b` as fence meta.
    const sameline = parseGfmWithMathStreaming("$$a + b");
    expect(sameline.children[0]?.type).toBe("paragraph");

    // Multi-line: the standard mathFlow would accept it at EOF (premature math).
    const multiline = parseGfmWithMathStreaming("$$\na + b");
    expect(multiline.children[0]?.type).toBe("paragraph");
  });

  it("still parses delimiter math and same-line $$", () => {
    const inline = parseGfmWithMathStreaming("$x^2$");
    const inlineParagraph = inline.children[0];
    if (inlineParagraph?.type !== "paragraph")
      throw new Error("expected paragraph");
    expect(
      inlineParagraph.children.some((node) => node.type === "inlineMath"),
    ).toBe(true);

    const display = parseGfmWithMathStreaming("$$a + b$$");
    expect(display.children[0]?.type).toBe("math");
  });
});
