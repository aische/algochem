import type { Term } from "../lambda/term";
import { familyKey, type FamilyInfo } from "../chem/family";
import { OTHER, PLAIN } from "./renderer";
import { theme } from "./theme";

/** A family needs at least this many molecules to get a color. */
const MIN_COUNT = 3;

/**
 * Assigns the family hues to the largest families. A family keeps its color
 * for as long as it stays among the largest, so colors follow families, not
 * ranks; a hue freed by a family that dropped out goes to the next newcomer.
 */
export class FamilyColors {
  enabled = false;
  private slots = new Map<string, number>();

  /** Re-rank from a fresh family summary (about once a second is plenty). */
  update(families: FamilyInfo[]): void {
    const top = families
      .filter((f) => f.count >= MIN_COUNT)
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
      .slice(0, OTHER)
      .map((f) => f.key);
    const keep = new Set(top);
    for (const key of this.slots.keys()) if (!keep.has(key)) this.slots.delete(key);
    const taken = new Set(this.slots.values());
    let free = 0;
    for (const key of top) {
      if (this.slots.has(key)) continue;
      while (taken.has(free)) free++;
      this.slots.set(key, free);
      taken.add(free);
    }
  }

  reset(): void {
    this.slots.clear();
  }

  /** Color slot of a molecule for the renderer. */
  slotOf = (t: Term): number => {
    if (!this.enabled) return PLAIN;
    return this.slots.get(familyKey(t)) ?? OTHER;
  };

  /** CSS color of a family, or null if it has none. */
  colorOf(key: string): string | null {
    if (!this.enabled) return null;
    const slot = this.slots.get(key);
    return slot === undefined ? null : theme.families[slot];
  }
}
