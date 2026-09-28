/**
 * Minimal {{variable}} interpolation for email templates / prompt templates.
 * Unresolved placeholders are left as-is so missing-variable typos are visible
 * in a preview rather than silently disappearing.
 */
export function renderTemplate(source: string, variables: Record<string, unknown> = {}): string {
  return source.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Extracts the `{{variable}}` names referenced in a template string, in order of first appearance. */
export function extractTemplateVariables(source: string): string[] {
  const matches = source.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g);
  const seen = new Set<string>();
  for (const m of matches) seen.add(m[1]);
  return Array.from(seen);
}
