import type { BackdropPreset, FramingPreset, ModelPreset, PosePreset } from './model-presets';

/**
 * Turns a shoot set-up into the words the image engine is given. Kept as a pure function so the
 * wording can be read and unit-tested without an API key in the room.
 *
 * The one rule everything else serves: the garment in the reference photo is the product being
 * sold, so it must come out the same colour, the same cut and the same print it went in as. A
 * model shot that quietly restyles the piece is worse than no shot at all — it puts a garment on a
 * product page that the brand cannot actually ship.
 */

export type ShootSetup = {
  model: ModelPreset;
  pose: PosePreset;
  backdrop: BackdropPreset;
  framing: FramingPreset;
  /** What the brand sells it as: title, category, colours. Helps the engine read the flat photo. */
  garment?: { title?: string; category?: string; colors?: string[] };
  /** A free-text line from the brand ("styled with gold jhumkas"). */
  direction?: string;
};

/** Spelled out feature by feature, because "keep the garment the same" on its own is not enough. */
export const GARMENT_FIDELITY_RULE =
  'GARMENT FIDELITY IS THE TOP PRIORITY. The reference photo is the exact product being sold. Reproduce it precisely: the same colour and shade, the same print, pattern placement and scale, the same fabric, weave and sheen, the same neckline, sleeve length, hem length and overall cut, the same buttons, trims, embroidery and hardware. Do not restyle, recolour, simplify, embellish or "improve" the garment, and do not swap it for a similar one. Fit it to the body with natural drape, folds and shadow as real cloth would fall.';

/** Things an image engine volunteers unless told not to. */
export const SHOOT_NEGATIVE_RULE =
  'Do not add any text, watermark, logo, label, price tag or graphic overlay. Do not produce a collage, a split frame, a mirror, or more than one person. Do not deform hands, fingers or feet. Do not crop the garment out of the frame. Avoid a plastic, waxy or over-retouched skin finish.';

const list = (values?: string[]) => (values ?? []).map((v) => v.trim()).filter(Boolean);

/** A short description of the piece from the catalogue row, when the brand picked one. */
function describeGarment(garment?: ShootSetup['garment']): string {
  if (!garment) return 'the garment in the reference photo';
  const colors = list(garment.colors);
  const parts = [
    colors.length ? colors.slice(0, 3).join(' and ') : '',
    garment.category?.trim() ?? '',
    garment.title?.trim() ? `("${garment.title.trim()}")` : '',
  ].filter(Boolean);
  return parts.length ? `the ${parts.join(' ')} in the reference photo` : 'the garment in the reference photo';
}

/**
 * The full instruction, in the order the engine reads best: what to make, who wears it, how they
 * stand, where they are, how it is framed, then the rules that must not be broken.
 */
export function buildShootPrompt(setup: ShootSetup): string {
  const { model, pose, backdrop, framing } = setup;
  const direction = setup.direction?.trim();

  const lines = [
    `Create a professional fashion e-commerce photograph of ${describeGarment(setup.garment)}, worn by ${model.prompt}.`,
    `The model is ${pose.prompt}.`,
    `The shot is ${framing.prompt}, set against ${backdrop.prompt}.`,
    'Shot on a full-frame camera with an 85mm lens at f/4, sharp focus on the garment, true-to-life colour, the quality of a studio catalogue shoot.',
    direction ? `Art direction from the brand: ${direction}` : '',
    GARMENT_FIDELITY_RULE,
    SHOOT_NEGATIVE_RULE,
  ];

  return lines.filter(Boolean).join('\n\n');
}
