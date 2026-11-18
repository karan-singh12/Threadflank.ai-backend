export interface MotionPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  cameraMovement: string;
  lighting: string;
  /** The motion and setting, written for the video model. Also shown as the placeholder for the brand's own direction. */
  promptSuggestion: string;
  estimatedSeconds: number;
}

/** Looks a brand can pick for a motion video. The order is the order the studio shows them. */
export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'studio_turn',
    name: 'Studio Turn',
    badge: 'Product page',
    description: 'A slow turn on a clean studio set, so shoppers see the front, side and back of the piece.',
    cameraMovement: 'Locked-off camera, model turns in place',
    lighting: 'Soft, even studio light',
    promptSuggestion:
      'The model slowly turns in place to show the front, side and back of the outfit, then faces the camera again. Clean light-grey seamless studio, soft even lighting, locked-off camera.',
    estimatedSeconds: 8,
  },
  {
    id: 'runway_walk',
    name: 'Runway Walk',
    badge: 'Editorial',
    description: 'A confident walk towards the camera with the fabric moving naturally at every step.',
    cameraMovement: 'Slow tracking shot',
    lighting: 'Crisp natural daylight',
    promptSuggestion:
      'The model walks confidently towards the camera like on a runway, natural stride, the fabric moving with each step. Smooth tracking camera, crisp natural daylight.',
    estimatedSeconds: 8,
  },
  {
    id: 'festive_twirl',
    name: 'Festive Twirl',
    badge: 'Ethnic wear',
    description: 'A graceful twirl that lets lehengas, anarkalis and dupattas flare and settle.',
    cameraMovement: 'Gentle push-in',
    lighting: 'Warm festive lights, softly blurred',
    promptSuggestion:
      'The model does a slow, graceful twirl so the skirt and dupatta flare out and settle, then smiles at the camera. Warm festive fairy lights softly blurred in the background, gentle push-in.',
    estimatedSeconds: 8,
  },
  {
    id: 'red_carpet',
    name: 'Red Carpet Glow',
    badge: 'Gala / Evening',
    description: 'A slow, majestic dolly-in with warm spotlights and a subtle breeze through the fabric.',
    cameraMovement: 'Slow dolly-in',
    lighting: 'Warm tungsten with a rim light',
    promptSuggestion:
      'Slow elegant dolly-in towards the model at a luxury evening gala, warm spotlights, a subtle breeze moving the fabric, rich texture shimmering in the light.',
    estimatedSeconds: 8,
  },
  {
    id: 'silk_motion',
    name: 'Silk Motion',
    badge: 'Fabric detail',
    description: 'A slow-motion close orbit that shows zari, embroidery and the way the fabric falls.',
    cameraMovement: 'Slow macro orbit',
    lighting: 'Diffused studio softbox',
    promptSuggestion:
      'Slow-motion close-up orbit around the garment, soft airflow revealing the sheen of the threads, embroidery and fabric drape in fine detail, diffused studio light.',
    estimatedSeconds: 8,
  },
  {
    id: 'velvet_glow',
    name: 'Velvet Glow',
    badge: 'Night / Moody',
    description: 'Moody low-key light and a slow swivel that brings out deep colours and rich textures.',
    cameraMovement: 'Slow half-circle swivel',
    lighting: 'Low-key with specular highlights',
    promptSuggestion:
      'Royal night-time mood, the camera slowly circles the model, dramatic low-key light with specular highlights on rich fabric and jewel tones.',
    estimatedSeconds: 8,
  },
];

export const findPreset = (id: string) => MOTION_PRESETS.find((p) => p.id === id);

/** Kept the same in every prompt: the garment must not change, and nothing is added on top. */
export const VIDEO_NEGATIVE_PROMPT =
  'text, captions, watermark, logo, changing the garment colour or pattern, different outfit, extra limbs, distorted hands, distorted face, blurry, low quality, cartoon';

/** The full prompt for one render: the look, the brand's own direction, and the garment rules. */
export function buildVideoPrompt(opts: { preset: MotionPreset; direction?: string; garment?: { title: string; category?: string | null; colors?: string[] } }) {
  const { preset, direction, garment } = opts;
  const piece = garment ? `The outfit is ${garment.title}${garment.category ? ` (${garment.category.toLowerCase()})` : ''}${garment.colors?.length ? ` in ${garment.colors.join(', ')}` : ''}.` : '';
  return [
    'A short, photorealistic fashion film made from this photo.',
    preset.promptSuggestion,
    direction?.trim() ? `Creative direction: ${direction.trim()}.` : '',
    piece,
    'Keep the garment exactly as in the photo: the same colour, pattern, embroidery, fabric and fit. Keep the person the same. Natural, realistic fabric movement. No text, logos or watermarks on screen.',
  ]
    .filter(Boolean)
    .join(' ');
}
