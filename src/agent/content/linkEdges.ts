export interface EdgeUnit {
  text: string;
  /** The unit is the text of a link. */
  link: boolean;
  /** Units of one paragraph share a group. A unit with no group has no neighbours. */
  group: unknown;
}

/**
 * A space a write adds at the edge of a link text belongs outside the link: inside it the
 * link grows a space that is underlined and clickable. The space moves to the neighbouring
 * text of the same paragraph. With no such neighbour the value stays as it was sent.
 *
 * `values` maps a key to the new text; the unit of a key is `units[Number(key) - offset]`.
 */
export function keepSpacesOutOfLinks(
  values: Record<string, string>,
  units: EdgeUnit[],
  offset = 0
): Record<string, string> {
  const out: Record<string, string> = { ...values };
  const keyOf = (index: number) => String(index + offset);

  const outside = (index: number, other: number): EdgeUnit | undefined => {
    const unit = units[other];
    const group = units[index].group;

    return unit && !unit.link && group !== undefined && unit.group === group ? unit : undefined;
  };

  for (const [key, value] of Object.entries(values)) {
    const index = Number(key) - offset;
    const unit = units[index];

    if (typeof value !== "string" || !unit?.link || !value.trim()) continue;
    let text = value;
    const lead = /^\s+/u.exec(text)?.[0];
    const before = outside(index, index - 1);

    if (lead && before && !/^\s/u.test(unit.text)) {
      const base = out[keyOf(index - 1)] ?? before.text;

      out[keyOf(index - 1)] = /\s$/u.test(base) ? base : base + lead;
      text = text.slice(lead.length);
    }

    const trail = /\s+$/u.exec(text)?.[0];
    const after = outside(index, index + 1);

    if (trail && after && !/\s$/u.test(unit.text)) {
      const base = out[keyOf(index + 1)] ?? after.text;

      out[keyOf(index + 1)] = /^\s/u.test(base) ? base : trail + base;
      text = text.slice(0, -trail.length);
    }

    out[key] = text;
  }

  return out;
}
