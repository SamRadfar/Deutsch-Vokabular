import rawMaps from '../../../data/legacy/dvok5-index-maps.v1.json';
import type { Dvok5IndexMap } from '../../../models/legacy';

export interface Dvok5MapSet {
  versions: Dvok5IndexMap[];
}

export const dvok5Maps = rawMaps as Dvok5MapSet;

/**
 * The entry count of a dvok5 blob identifies the writing version only if no two
 * historical vocabularies share a checkbox count. Returns the problems found (empty = OK).
 */
export function verifyDvok5MapsUnambiguous(maps: Dvok5MapSet = dvok5Maps): string[] {
  const problems: string[] = [];
  const counts = new Map<number, Dvok5IndexMap[]>();
  for (const v of maps.versions) {
    if (v.keys.length !== v.checkboxCount) problems.push(`map ${v.dataSha256.slice(0, 12)}: keys.length ≠ checkboxCount`);
    counts.set(v.checkboxCount, [...(counts.get(v.checkboxCount) ?? []), v]);
  }
  for (const [count, list] of counts) {
    if (new Set(list.map((v) => v.dataSha256)).size > 1) problems.push(`checkbox count ${count} is shared by different vocabularies`);
  }
  return problems;
}

export function findDvok5Map(entryCount: number, maps: Dvok5MapSet = dvok5Maps): Dvok5IndexMap | undefined {
  if (verifyDvok5MapsUnambiguous(maps).length) return undefined; // never guess
  return maps.versions.find((v) => v.checkboxCount === entryCount);
}
