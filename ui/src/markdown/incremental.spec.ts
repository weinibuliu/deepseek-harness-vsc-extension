import { describe, expect, it } from "vitest";
import { IncrementalMarkdownParser } from "./incremental.ts";
import { parseGfm } from "./parse.ts";

describe("IncrementalMarkdownParser", () => {
  it("freezes all but the trailing blocks as the stream grows", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    let text = "";
    for (const block of ["one", "two", "three", "four", "five", "six"]) {
      text += (text === "" ? "" : "\n\n") + block;
      parser.update(text);
    }
    const { frozen, tail } = parser.update(text);
    expect(frozen.length + tail.length).toBe(6);
    expect(tail.length).toBeLessThanOrEqual(2);
    expect(frozen.length).toBeGreaterThanOrEqual(4);
  });

  it("returns the cached result for identical input", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const first = parser.update("alpha");
    const second = parser.update("alpha");
    expect(second).toBe(first);
  });

  it("bumps the generation when input stops being append-only", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    parser.update("alpha\n\nbeta\n\ngamma");
    const before = parser.update("alpha\n\nbeta\n\ngamma\n\ndelta");
    const after = parser.update("totally different");
    expect(after.generation).toBeGreaterThan(before.generation);
    expect(after.frozen.length).toBe(0);
  });
});
