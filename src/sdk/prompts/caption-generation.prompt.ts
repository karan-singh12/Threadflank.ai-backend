export interface CaptionPromptInput {
  itemName: string;
  brand?: string;
  category?: string;
  tone?: string;
}

/** v1 — social caption generation for a garment / brand drop. */
export function captionGenerationPrompt(input: CaptionPromptInput): string {
  const tone = input.tone || 'stylish, concise, editorial';
  return [
    'You write short social captions for a fashion Discover feed.',
    `Item: ${input.itemName}${input.brand ? ` by ${input.brand}` : ''}`,
    input.category ? `Category: ${input.category}` : '',
    `Tone: ${tone}`,
    'Write one caption, under 220 characters, no hashtags, no quotation marks around the output.',
  ]
    .filter(Boolean)
    .join('\n');
}
