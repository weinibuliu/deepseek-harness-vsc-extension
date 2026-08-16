/**
 * Minimal semver comparison with prerelease support, used for the dsh
 * version-floor gate (D11: 版本下限探测). Sufficient for the version formats
 * dsh ships (e.g. `0.1.0-rc.6`); rejects garbage by returning null from parse.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers, e.g. ['rc', '6']; empty when absent. */
  prerelease: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Parse a semver string; returns null when the string is not a valid semver. */
export function parseVersion(raw: string): SemVer | null {
  const match = VERSION_RE.exec(raw.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

/**
 * Compare two parsed versions.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 * Prerelease ordering follows semver: 1.0.0-rc.6 < 1.0.0, and identifiers
 * compare dot-segment by dot-segment (numeric segments numerically, others
 * ASCII).
 */
export function compareVersions(a: SemVer, b: SemVer): -1 | 0 | 1 {
  const core = compareCore(a, b);
  if (core !== 0) return core;
  // Equal core: a release beats a prerelease; two prereleases compare by id.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const cmp = compareIdentifier(x, y);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function compareCore(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

function compareIdentifier(x: string, y: string): -1 | 0 | 1 {
  const xn = Number(x);
  const yn = Number(y);
  const xIsNum = /^\d+$/.test(x);
  const yIsNum = /^\d+$/.test(y);
  if (xIsNum && yIsNum) return xn < yn ? -1 : xn > yn ? 1 : 0;
  if (xIsNum) return -1; // numeric ids sort before alphanumeric
  if (yIsNum) return 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** True when `actual` is >= `minimum` (both parsed; unparsable input is below). */
export function isAtLeast(actual: string, minimum: string): boolean {
  const a = parseVersion(actual);
  const m = parseVersion(minimum);
  if (a === null || m === null) return false;
  return compareVersions(a, m) >= 0;
}
