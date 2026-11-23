/**
 * The cast and the set for a brand photoshoot.
 *
 * Everything the studio offers is declared here once: the models a garment can be put on, the poses
 * they hold, the backdrop behind them and how tight the camera is. Each preset carries the words the
 * image engine needs (`prompt`) and the photo the panel shows on its tile (`previewUrl`), so adding a
 * model is one entry here plus one rendered preview — nothing in the panel has to change.
 *
 * Preview photos are rendered once by `scripts/generate-model-previews.ts` and live in the brand
 * panel's own `public/ai-studio/models/` folder, which is why these URLs are site-relative.
 */

const PREVIEW_DIR = '/ai-studio/models';

export type ModelPreset = {
  id: string;
  label: string;
  /** One line under the tile: what this body actually is, in plain words. */
  blurb: string;
  /** How the model is described to the image engine. */
  prompt: string;
  previewUrl: string;
};

export type PosePreset = {
  id: string;
  label: string;
  prompt: string;
  previewUrl: string;
};

export type BackdropPreset = {
  id: string;
  label: string;
  prompt: string;
  /** CSS gradient for the panel's colour swatch, so the backdrop list needs no extra photos. */
  swatch: string;
};

export type FramingPreset = {
  id: string;
  label: string;
  prompt: string;
};

/**
 * Six bodies, written as measurements and proportions rather than as a type of person. The wording
 * is deliberately plain: an image engine renders "narrow shoulders, straight hips" reliably and
 * renders a fashion-industry label however it feels like that day.
 */
export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: 'slim',
    label: 'Slim',
    blurb: 'Lean, straight frame',
    prompt:
      'a slim adult fashion model with a lean, straight frame, narrow shoulders and hips, long limbs, approximately 175cm tall',
    previewUrl: `${PREVIEW_DIR}/model-slim.webp`,
  },
  {
    id: 'regular',
    label: 'Regular',
    blurb: 'The everyday fit',
    prompt:
      'an adult fashion model with an average, balanced build, medium shoulders and a natural waist, approximately 170cm tall',
    previewUrl: `${PREVIEW_DIR}/model-regular.webp`,
  },
  {
    id: 'curve',
    label: 'Curve',
    blurb: 'Fuller hips and bust',
    prompt:
      'a curvy plus-size adult fashion model with a fuller bust and hips, a defined waist and soft arms, approximately 168cm tall',
    previewUrl: `${PREVIEW_DIR}/model-curve.webp`,
  },
  {
    id: 'tall',
    label: 'Tall',
    blurb: 'Long through the leg',
    prompt:
      'a tall adult fashion model with a long torso and notably long legs, slender build, approximately 183cm tall',
    previewUrl: `${PREVIEW_DIR}/model-tall.webp`,
  },
  {
    id: 'petite',
    label: 'Petite',
    blurb: 'Short frame, small build',
    prompt: 'a petite adult fashion model with a short frame and a small build, in proportion, approximately 155cm tall',
    previewUrl: `${PREVIEW_DIR}/model-petite.webp`,
  },
  {
    id: 'broad',
    label: 'Broad',
    blurb: 'Wide shoulders, solid build',
    prompt:
      'a broad-shouldered adult fashion model with a solid, athletic build, a wide chest and strong arms, approximately 180cm tall',
    previewUrl: `${PREVIEW_DIR}/model-broad.webp`,
  },
];

/** Five poses. The preview photos all use the same reference model, so a pose reads as a pose. */
export const POSE_PRESETS: readonly PosePreset[] = [
  {
    id: 'front',
    label: 'Straight on',
    prompt:
      'standing straight on, squared to the camera, weight even on both feet, arms relaxed at the sides, looking into the lens',
    previewUrl: `${PREVIEW_DIR}/pose-front.webp`,
  },
  {
    id: 'walk',
    label: 'Walking',
    prompt:
      'caught mid-stride walking towards the camera, one leg forward, arms swinging naturally, the fabric moving with the step',
    previewUrl: `${PREVIEW_DIR}/pose-walk.webp`,
  },
  {
    id: 'turn',
    label: 'Three-quarter',
    prompt:
      'turned about forty-five degrees from the camera in a three-quarter view, shoulders angled away, head turned back towards the lens',
    previewUrl: `${PREVIEW_DIR}/pose-turn.webp`,
  },
  {
    id: 'sit',
    label: 'Seated',
    prompt:
      'seated on a plain studio block, back straight, knees together and angled to one side, hands resting on the lap',
    previewUrl: `${PREVIEW_DIR}/pose-sit.webp`,
  },
  {
    id: 'back',
    label: 'From behind',
    prompt:
      'photographed from directly behind, facing away from the camera, head turned slightly to one side, so the back of the garment is fully visible',
    previewUrl: `${PREVIEW_DIR}/pose-back.webp`,
  },
];

/** Six sets. The swatch is what the panel paints on the colour chip next to the name. */
export const BACKDROP_PRESETS: readonly BackdropPreset[] = [
  {
    id: 'studio-grey',
    label: 'Studio grey',
    prompt: 'a seamless mid-grey studio backdrop with a soft gradient falloff, clean professional softbox lighting',
    swatch: 'radial-gradient(ellipse at 50% 20%, #6a6a76 0%, #2b2b33 70%)',
  },
  {
    id: 'studio-white',
    label: 'Clean white',
    prompt: 'a seamless pure white studio backdrop, bright even high-key lighting, a soft shadow under the feet',
    swatch: 'radial-gradient(ellipse at 50% 18%, #f4f4f6 0%, #c9c9d2 75%)',
  },
  {
    id: 'lavender',
    label: 'Lavender',
    prompt: 'a seamless lavender studio backdrop with a gentle colour gradient, soft diffused editorial lighting',
    swatch: 'radial-gradient(ellipse at 50% 20%, #a894ff 0%, #4a3a8f 72%)',
  },
  {
    id: 'terrace',
    label: 'Golden hour',
    prompt:
      'an open rooftop terrace at golden hour, warm low sunlight raking across the frame, the city softly out of focus behind',
    swatch: 'linear-gradient(180deg, #ffbf7a 0%, #d8713f 45%, #4a2316 100%)',
  },
  {
    id: 'street',
    label: 'Street',
    prompt:
      'a quiet city street in soft overcast daylight, the shopfronts and pavement thrown well out of focus behind the model',
    swatch: 'linear-gradient(180deg, #2a3550 0%, #4a5a78 55%, #161d2c 100%)',
  },
  {
    id: 'festive',
    label: 'Festive',
    prompt:
      'a warm festive Indian interior at night, marigold garlands and small oil lamps glowing far out of focus behind the model',
    swatch: 'radial-gradient(ellipse at 50% 25%, #ffd27a 0%, #a32d5a 70%, #2a0a1b 100%)',
  },
];

/** How much of the model is in frame. A catalogue needs all three at different moments. */
export const FRAMING_PRESETS: readonly FramingPreset[] = [
  {
    id: 'full',
    label: 'Full length',
    prompt: 'a full-length shot with the entire body from head to footwear inside the frame and room above the head',
  },
  {
    id: 'three-quarter',
    label: 'Knee up',
    prompt: 'a three-quarter shot framed from mid-thigh upwards, so the upper garment fills most of the frame',
  },
  {
    id: 'detail',
    label: 'Close detail',
    prompt:
      'a tight detail shot of the garment on the body, framed from the shoulders to the waist, close enough to read the weave, print and stitching',
  },
];

export const MODEL_PRESET_IDS = MODEL_PRESETS.map((m) => m.id) as [string, ...string[]];
export const POSE_PRESET_IDS = POSE_PRESETS.map((p) => p.id) as [string, ...string[]];
export const BACKDROP_PRESET_IDS = BACKDROP_PRESETS.map((b) => b.id) as [string, ...string[]];
export const FRAMING_PRESET_IDS = FRAMING_PRESETS.map((f) => f.id) as [string, ...string[]];

export const findModel = (id: string) => MODEL_PRESETS.find((m) => m.id === id);
export const findPose = (id: string) => POSE_PRESETS.find((p) => p.id === id);
export const findBackdrop = (id: string) => BACKDROP_PRESETS.find((b) => b.id === id);
export const findFraming = (id: string) => FRAMING_PRESETS.find((f) => f.id === id);
