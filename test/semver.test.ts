import { describe, expect, it } from 'vitest';
import { compareVersions, isFixedVersion, parseVersion, type Version } from '../src/semver.js';

function v(text: string): Version {
  const version = parseVersion(text);
  if (!version) throw new Error(`not a version: ${text}`);
  return version;
}

const GEMINI_FIXED = [v('0.39.1'), v('0.40.0-preview.3')];

describe('parseVersion', () => {
  it('reads releases, prereleases and a leading v', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion('v0.40.0-preview.3')).toEqual({
      major: 0,
      minor: 40,
      patch: 0,
      pre: ['preview', 3],
    });
    expect(parseVersion(' 2.1.163+build.5 ')).toEqual({ major: 2, minor: 1, patch: 163, pre: [] });
  });

  it('rejects tags that are not full versions', () => {
    for (const text of ['v1', 'v1.0', 'latest', 'main', '', '1.2.3.4', 'x1.2.3']) {
      expect(parseVersion(text), text).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders versions by Semantic Versioning precedence', () => {
    const ordered = [
      '0.39.0',
      '0.39.1',
      '0.40.0-nightly.1',
      '0.40.0-preview.2',
      '0.40.0-preview.3',
      '0.40.0-preview.10',
      '0.40.0',
      '1.0.0',
      '2.1.162',
      '2.1.163',
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(
        compareVersions(v(ordered[i - 1] ?? ''), v(ordered[i] ?? '')),
        ordered[i],
      ).toBeLessThan(0);
    }
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-alpha.1'))).toBeLessThan(0);
    expect(compareVersions(v('1.0.0-1'), v('1.0.0-alpha'))).toBeLessThan(0);
    expect(compareVersions(v('v1.2.3'), v('1.2.3'))).toBe(0);
  });
});

describe('isFixedVersion', () => {
  it.each([
    ['0.38.0', false],
    ['0.39.0', false],
    ['0.39.1', true],
    ['0.39.2', true],
    ['0.40.0', true],
    ['1.0.0', true],
    ['0.39.0-preview.5', false],
    ['0.39.2-preview.1', true],
    ['0.40.0-preview.1', false],
    ['0.40.0-preview.3', true],
    ['0.40.0-preview.4', true],
    ['0.41.0-nightly.20261001', true],
  ])('Gemini CLI %s fixed: %s', (text, fixed) => {
    expect(isFixedVersion(v(text), GEMINI_FIXED)).toBe(fixed);
  });

  it('compares against one release', () => {
    expect(isFixedVersion(v('2.1.162'), [v('2.1.163')])).toBe(false);
    expect(isFixedVersion(v('2.1.163'), [v('2.1.163')])).toBe(true);
    expect(isFixedVersion(v('2.1.164-beta.1'), [v('2.1.163')])).toBe(true);
    expect(isFixedVersion(v('2.1.163-beta.1'), [v('2.1.163')])).toBe(false);
  });
});
