/**
 * Fill the two language tokens the translate prompt names.
 *
 * Deliberately not part of `fillPlaceholders`: that helper is shared by every
 * command and has no business knowing about translation. The single-pass
 * alternation and the replacer function are copied from it for the same two
 * reasons documented there — chained replaces re-scan text they just
 * substituted, and a string replacement expands "$&" and "$1".
 */
export function fillLanguages(template: string, languages: { source: string; target: string }): string {
  return template.replace(/\{(source|target)\}/g, (_match, key: string) =>
    key === "source" ? languages.source : languages.target,
  );
}
