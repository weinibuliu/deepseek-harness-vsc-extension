import { describe, expect, it } from "vitest";
import { foldDriveLetter } from "../src/services/path-util.ts";

describe("foldDriveLetter", () => {
  it("folds a Windows drive letter to lowercase on win32", () => {
    expect(foldDriveLetter("C:\\Users\\buliu\\repo", "win32")).toBe(
      "c:\\Users\\buliu\\repo",
    );
    expect(foldDriveLetter("c:\\Users\\buliu\\repo", "win32")).toBe(
      "c:\\Users\\buliu\\repo",
    );
  });

  it("leaves UNC paths (no single-letter drive) untouched on win32", () => {
    expect(foldDriveLetter("\\\\server\\share\\dir", "win32")).toBe(
      "\\\\server\\share\\dir",
    );
  });

  it("leaves paths untouched on non-win32 platforms", () => {
    expect(foldDriveLetter("C:\\Users\\buliu\\repo", "linux")).toBe(
      "C:\\Users\\buliu\\repo",
    );
    expect(foldDriveLetter("C:\\Users\\buliu\\repo", "darwin")).toBe(
      "C:\\Users\\buliu\\repo",
    );
  });
});
