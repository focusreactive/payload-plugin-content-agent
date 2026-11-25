import { gluedSides, inlineContext } from "./lexicalEngine.js";
import type { LexicalNode, TextNode } from "./lexicalEngine.js";

/** One text of a rich text paragraph, in document order. */
export interface GluedUnit {
  text: string;
  node?: TextNode;
  block?: LexicalNode;
  link: boolean;
}

export interface GluedBoundary {
  /** Index of the unit before the boundary; null when that text is not a unit of the list. */
  left: number | null;
  /** Index of the unit after the boundary; null when that text is not a unit of the list. */
  right: number | null;
  /** What the page shows there, with `|` at the boundary. */
  shows: string;
}

const EDGE_CHARS = 12;

/**
 * The boundaries where two words run together with no space, and the texts that put one space
 * at each of them. The space goes into the text outside a link. A unit that meets two
 * boundaries gets both spaces in one text.
 */
export function gluedBoundaries(units: GluedUnit[]): {
  glued: GluedBoundary[];
  fix: Record<number, string>;
} {
  const glued: GluedBoundary[] = [];
  const fix: Record<number, string> = {};
  const neighbour = (index: number, other: number): GluedUnit | undefined =>
    units[other]?.node && units[other].block === units[index].block ? units[other] : undefined;
  const lead = (index: number) => (fix[index] = ` ${fix[index] ?? units[index].text}`);
  const trail = (index: number) => (fix[index] = `${fix[index] ?? units[index].text} `);

  units.forEach((unit, index) => {
    if (!unit.node || !unit.block) return;
    const surrounding = inlineContext(unit.block, unit.node);
    const sides = gluedSides(unit.text, surrounding);
    const next = neighbour(index, index + 1);

    if (sides.includes("after")) {
      glued.push({
        left: index,
        right: next ? index + 1 : null,
        shows: `${unit.text.slice(-EDGE_CHARS)}|${surrounding.after.slice(0, EDGE_CHARS)}`,
      });
      if (unit.link && next && !next.link) lead(index + 1);
      else trail(index);
    }

    if (sides.includes("before") && !neighbour(index, index - 1)) {
      glued.push({
        left: null,
        right: index,
        shows: `${surrounding.before.slice(-EDGE_CHARS)}|${unit.text.slice(0, EDGE_CHARS)}`,
      });
      lead(index);
    }
  });

  return { glued, fix };
}
