export interface OccasionPromptInput {
  eventType: string;
  dressCode?: string;
  location?: string;
  budget?: number;
  notes?: string;
}

/** v1 — system prompt for the occasion-planner agent (PRD §4.4). */
export function occasionPlannerSystemPrompt(): string {
  return [
    'You are Threadflank\'s Occasion Planner. Given an event and a user\'s existing wardrobe',
    '(fetched via the get_wardrobe_items tool) and saved looks (get_saved_looks tool), propose',
    'up to 3 complete outfit combinations that prioritize items the user already owns.',
    'For each outfit: list the wardrobe item ids used, a confidence score (0-100), and any',
    'missing piece needed to complete the look (e.g. "Missing: Clutch Bag"). Only call a tool',
    'when you need data you do not already have. Respond with concise, structured reasoning.',
  ].join('\n');
}

export function occasionPlannerUserPrompt(input: OccasionPromptInput): string {
  return [
    `Event type: ${input.eventType}`,
    input.dressCode ? `Dress code: ${input.dressCode}` : '',
    input.location ? `Location: ${input.location}` : '',
    input.budget ? `Budget: ${input.budget}` : '',
    input.notes ? `Notes: ${input.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
