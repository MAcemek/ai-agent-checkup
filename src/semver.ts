/** A version such as 1.2.3 or 0.40.0-preview.3. A leading "v" is allowed. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease identifiers, empty for a release. */
  pre: (string | number)[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text.trim());
  if (!match) return null;
  const pre = (match[4] ?? '')
    .split('.')
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre };
}

function compareCore(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Semantic Versioning 2.0.0 precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: Version, b: Version): number {
  const core = compareCore(a, b);
  if (core !== 0) return core;
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `version` contains a fix that shipped in the `fixed` versions. A release is fixed when
 * it is at least the lowest fixed release. A prerelease is compared with a fixed prerelease of
 * the same x.y.z when there is one; otherwise it is fixed when its x.y.z is above every fixed
 * release.
 */
export function isFixedVersion(version: Version, fixed: Version[]): boolean {
  const releases = fixed.filter((v) => v.pre.length === 0);
  if (version.pre.length === 0) {
    return releases.some((v) => compareVersions(version, v) >= 0);
  }
  const sameCore = fixed.filter((v) => v.pre.length > 0 && compareCore(v, version) === 0);
  if (sameCore.length > 0) return sameCore.some((v) => compareVersions(version, v) >= 0);
  return releases.length > 0 && releases.every((v) => compareCore(version, v) > 0);
}
