import { findBackdrop } from './model-presets';

/**
 * AI Studio photo tools (blueprint 3.4): edits of a garment photo the brand already has, as opposed
 * to a full model shoot. Prompts are written here, never taken from the brand, apart from an ad's
 * short headline which is quoted as text to print.
 *
 * Results are kept with the model shots (modelId "tool:<id>"), so they show in the Model gallery and
 * the Content library like any other photo.
 */

export const PHOTO_TOOL_COST = 4;

export const PHOTO_TOOLS = [
  { id: 'background', label: 'Background swap', blurb: 'Same photo, new backdrop' },
  { id: 'ghost', label: 'Ghost mannequin', blurb: 'The garment alone, shaped as if worn, on white' },
  { id: 'ad', label: 'Ad creative', blurb: 'A social ad with room for your headline' },
] as const;

export type PhotoToolId = (typeof PHOTO_TOOLS)[number]['id'];
export const PHOTO_TOOL_IDS = PHOTO_TOOLS.map((t) => t.id) as [PhotoToolId, ...PhotoToolId[]];
export const TOOL_PREFIX = 'tool:';
export const toolLabel = (modelId: string) => PHOTO_TOOLS.find((t) => `${TOOL_PREFIX}${t.id}` === modelId)?.label;

export type PhotoToolInput = { tool: PhotoToolId; backdropId?: string; format?: 'square' | 'story'; headline?: string };

const KEEP_GARMENT =
  "Reproduce the garment in image 1 exactly: its colour, print, embroidery, fabric texture, neckline, sleeves, length and every detail. Don't redesign, recolour or add anything to it.";

/** The prompt and frame shape for one tool. Throws on a missing or unknown choice. */
export function photoToolPrompt(input: PhotoToolInput): { prompt: string; aspectRatio: '3:4' | '1:1' | '9:16'; backdropId: string } {
  if (input.tool === 'background') {
    const backdrop = findBackdrop(input.backdropId ?? '');
    if (!backdrop) throw new Error('Choose a backdrop.');
    return {
      prompt:
        `Background replacement for a fashion photo. Keep the subject of image 1 (the person and the garment, or the garment alone) exactly as it is: same pose, framing, face and proportions. ` +
        `Replace only the background with ${backdrop.prompt}. Match the lighting, shadows and colour temperature on the subject to the new setting so it looks photographed there. ${KEEP_GARMENT}`,
      aspectRatio: '3:4',
      backdropId: backdrop.id,
    };
  }
  if (input.tool === 'ghost') {
    return {
      prompt:
        `Ghost mannequin product photograph (invisible mannequin) of the garment in image 1. Show the garment alone, filled out in three dimensions as if worn by an invisible body, ` +
        `with the inside of the neckline and back visible where a person would be. No person, no mannequin, no hanger, no hands. Centred, front view, on a pure white background with a soft natural shadow, ` +
        `even e-commerce lighting. ${KEEP_GARMENT}`,
      aspectRatio: '3:4',
      backdropId: 'studio-white',
    };
  }
  const backdrop = findBackdrop(input.backdropId ?? 'lavender') ?? findBackdrop('lavender')!;
  const headline = (input.headline ?? '').replace(/["\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const story = input.format === 'story';
  return {
    prompt:
      `A polished social media advertisement for an Indian fashion brand, ${story ? 'vertical 9:16 story' : 'square 1:1 post'} format. ` +
      `The hero is the garment in image 1, styled and lit beautifully against ${backdrop.prompt}. ${KEEP_GARMENT} ` +
      (headline
        ? `Print this headline once, exactly as written, in elegant modern typography with high contrast, in clear space ${story ? 'near the top' : 'along one side'}: "${headline}". No other text, logos or watermarks.`
        : `Leave generous clean space ${story ? 'at the top' : 'on one side'} for the brand to add text later. No text, logos or watermarks.`),
    aspectRatio: story ? '9:16' : '1:1',
    backdropId: backdrop.id,
  };
}
