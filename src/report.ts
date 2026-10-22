import { SEVERITIES, type FailOn, type Finding } from './types.js';

/** The findings that make --fail-on match: that severity or higher, or any finding. */
export function matchFailOn(findings: Finding[], failOn: FailOn | null): Finding[] {
  if (failOn === null) return [];
  if (failOn === 'any') return findings;
  const limit = SEVERITIES.indexOf(failOn);
  return findings.filter((f) => SEVERITIES.indexOf(f.severity) <= limit);
}

export function failOnMessage(failOn: FailOn, matched: Finding[]): string {
  const noun = matched.length === 1 ? 'problem' : 'problems';
  const level =
    failOn === 'any'
      ? ''
      : failOn === 'high'
        ? ' with high severity'
        : ` with ${failOn} severity or higher`;
  return `fail-on ${failOn} matched: ${matched.length} ${noun}${level}.`;
}
