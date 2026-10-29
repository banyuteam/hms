/**
 * How many tabs fit before "More ▾" (OQ-52, decided 2026-10-29): as many as fit, never more than `cap`,
 * and everything when all of them fit and do not exceed the cap.
 * `widths` are the measured tab widths in px, `moreWidth` the width of the More button.
 */
export function visibleTabCount(
  widths: readonly number[],
  available: number,
  moreWidth: number,
  cap: number,
): number {
  const total = widths.reduce((a, b) => a + b, 0);
  if (widths.length <= cap && total <= available) return widths.length;
  let sum = 0;
  let count = 0;
  for (const w of widths) {
    if (count >= cap || sum + w > available - moreWidth) break;
    sum += w;
    count += 1;
  }
  return Math.max(1, count);
}
