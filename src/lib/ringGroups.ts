/**
 * Rings split into the groups each is drawn with: `counts[i]` rings in the
 * i-th, in order. Rings past the counts are a group each.
 *
 * A network's coverage may be several rings, holes among them, which only
 * mean holes when traced as one path; the forecast step's cut wash
 * (`layers/dwd.ts`) erases each network's ground this way, so another
 * country's island in Denmark's sea stays washed.
 */
export function groupRings<T>(rings: readonly T[], counts: readonly number[]): T[][] {
  const groups: T[][] = [];
  let at = 0;
  for (const count of counts) {
    if (at >= rings.length) break;
    groups.push(rings.slice(at, at + count));
    at += count;
  }
  for (; at < rings.length; at += 1) groups.push([rings[at]]);
  return groups;
}
