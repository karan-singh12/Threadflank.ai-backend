export interface WardrobeCombosInput {
  occasion?: string;
  count?: number;
  /** Prefer items that are rarely or never worn. */
  focusUnderused?: boolean;
  notes?: string;
}

export interface ComboPromptItem {
  id: string;
  name: string;
  category: string;
  color: string | null;
  brand: string | null;
  tags: string[];
  wornCount: number;
  daysSinceWorn: number | null;
}

/** v1 — system prompt for wardrobe combination generation (feature #4). */
export function wardrobeCombosSystemPrompt(): string {
  return [
    "You are Threadflank's personal stylist. Build complete outfits ONLY from the user's own wardrobe items listed below.",
    'Rules:',
    '- Each outfit needs either a top + bottom, or a one-piece (dress, saree, lehenga, kurta set, sherwani), plus footwear when available.',
    '- Add at most one outer layer and at most two accessories (bags, jewellery, eyewear).',
    '- Respect Indian ethnic-wear pairings (e.g. kurta with churidar/palazzo, saree with blouse and heels/juttis, sherwani with mojaris).',
    '- Keep colours harmonious and suit the requested occasion.',
    '- Never invent items or ids. Use each outfit only once; vary the pieces across outfits.',
    'Answer ONLY with JSON: {"combos":[{"name":"","occasion":"","itemIds":["id"],"reason":"one sentence on why it works"}]}',
  ].join('\n');
}

export function wardrobeCombosUserPrompt(input: WardrobeCombosInput, items: ComboPromptItem[]): string {
  const lines = items.map((i) =>
    [
      `id=${i.id}`,
      i.category,
      i.name,
      i.color ? `colour=${i.color}` : '',
      i.brand ? `brand=${i.brand}` : '',
      i.tags.length ? `tags=${i.tags.join('/')}` : '',
      `worn=${i.wornCount}`,
      i.daysSinceWorn != null ? `lastWorn=${i.daysSinceWorn}d ago` : 'neverWorn',
    ]
      .filter(Boolean)
      .join(' | '),
  );
  return [
    `Create ${Math.min(6, Math.max(1, input.count ?? 3))} outfits.`,
    input.occasion ? `Occasion: ${input.occasion}` : 'Occasion: any, label each outfit with the best fit.',
    input.focusUnderused ? 'Prioritise pieces that are rarely or never worn so they get used.' : '',
    input.notes ? `Notes: ${input.notes.slice(0, 300)}` : '',
    '',
    'Wardrobe:',
    ...lines,
  ]
    .filter((l) => l !== '')
    .join('\n');
}
