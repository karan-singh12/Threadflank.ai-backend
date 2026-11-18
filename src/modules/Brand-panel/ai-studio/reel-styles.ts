import { MOTION_PRESETS, type MotionPreset } from './video-presets';

/**
 * A reel style decides the whole 30-45s film: which motion look each outfit gets, how the brand's
 * opening and closing cards look, and the pace. The brand picks one style, not one look per shot.
 */
export interface ReelStyle {
  id: string;
  name: string;
  badge: string;
  description: string;
  /** Motion looks cycled across the shots, in order. Falls back to the first preset that exists. */
  presetIds: string[];
  /** Card background, as a hex colour ffmpeg understands. */
  cardColor: string;
  /** Card text colour. */
  inkColor: string;
  /** Seconds for the opening and closing cards. */
  introSec: number;
  outroSec: number;
  /** The closing line, with {brand} and {site} filled in. */
  outroLine: string;
}

export const REEL_STYLES: ReelStyle[] = [
  {
    id: 'lookbook',
    name: 'Lookbook',
    badge: 'Evergreen',
    description: 'Clean studio turns, one outfit after another, with your name opening and closing the film.',
    presetIds: ['studio_turn', 'runway_walk'],
    cardColor: '0x0B0B1E',
    inkColor: 'white',
    introSec: 2,
    outroSec: 3,
    outroLine: 'Try it on at {site}',
  },
  {
    id: 'drop_teaser',
    name: 'Drop teaser',
    badge: 'New collection',
    description: 'Fast cuts with a bold opener, built to announce a launch on Reels and Stories.',
    presetIds: ['runway_walk', 'red_carpet', 'studio_turn'],
    cardColor: '0x190C4D',
    inkColor: 'white',
    introSec: 2,
    outroSec: 3,
    outroLine: 'Out now at {site}',
  },
  {
    id: 'festive_edit',
    name: 'Festive edit',
    badge: 'Wedding / festive',
    description: 'Warm light and twirls that let lehengas, anarkalis and dupattas move.',
    presetIds: ['festive_twirl', 'red_carpet'],
    cardColor: '0x2A1208',
    inkColor: 'white',
    introSec: 2,
    outroSec: 3,
    outroLine: 'Shop the edit at {site}',
  },
  {
    id: 'detail_study',
    name: 'Detail study',
    badge: 'Craft / texture',
    description: 'Slow, close motion on fabric and embroidery, for pieces that sell on their craft.',
    presetIds: ['silk_motion', 'studio_turn'],
    cardColor: '0x101018',
    inkColor: 'white',
    introSec: 2,
    outroSec: 3,
    outroLine: 'See the craft at {site}',
  },
];

export const REEL_STYLE_IDS = REEL_STYLES.map((s) => s.id);

export const findReelStyle = (id: string) => REEL_STYLES.find((s) => s.id === id);

/** How many outfits a reel can hold. Five 8s shots plus cards lands around 45s. */
export const MIN_SHOTS = 3;
export const MAX_SHOTS = 5;

/**
 * The motion look for shot `index` of this style. Styles name their looks, but the preset list is
 * the backend's own, so anything missing falls back rather than failing the whole reel.
 */
export function presetForShot(style: ReelStyle, index: number): MotionPreset {
  for (let i = 0; i < style.presetIds.length; i += 1) {
    const id = style.presetIds[(index + i) % style.presetIds.length];
    const found = MOTION_PRESETS.find((p) => p.id === id);
    if (found) return found;
  }
  return MOTION_PRESETS[0];
}
