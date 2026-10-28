import type { IntlShape } from 'react-intl';

/** UI label of a stored enum value (decided 2026-10-29: English labels, Indonesian in id.json). Unknown/empty → "—". */
export function enumLabel(
  intl: IntlShape,
  group: string,
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const id = `enum.${group}.${String(value)}`;
  return intl.messages[id] ? intl.formatMessage({ id }) : String(value);
}
