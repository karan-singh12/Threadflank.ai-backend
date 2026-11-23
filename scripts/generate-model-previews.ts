/**
 * Renders the photographs on the AI Studio's model and pose tiles, once.
 *
 *   npm run studio:previews                    # only the tiles that have no photo yet
 *   npm run studio:previews -- --engine openai # render with OpenAI instead of Gemini
 *   npm run studio:previews -- --force         # re-render everything
 *   npm run studio:previews -- --only model-slim,pose-walk
 *
 * These are presets, not brand content: the same eleven photographs ship to every brand, so they
 * are rendered here and committed as static files rather than generated per request. The panel
 * loads them straight from its own `public/` folder, which costs nothing and cannot fail at the
 * moment a brand opens the tab.
 *
 * Needs an image key in Backend/.env: GEMINI_API_KEY with image generation actually enabled on it
 * (an image model on the free tier has a quota of zero and answers 429), or OPENAI_API_KEY with
 * `--engine openai`. Whichever key has credit is the right one — these are eleven one-off files.
 *
 * `sharp`, if it is installed, shrinks each frame to a tile-sized WebP; the brand panel serves
 * `public/` unoptimised, so a 1.5 MB PNG per tile would be paid for on every page load. Without
 * sharp the frames are written as PNG and the panel falls back to them, which works but is heavy.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { MODEL_PRESETS, POSE_PRESETS } from '../src/modules/Brand-panel/ai-studio/model/model-presets';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/** Where the brand panel keeps them. The preset `previewUrl`s are paths inside this folder. */
const OUT_DIR = path.resolve(__dirname, '..', '..', 'Brand-panel', 'public', 'ai-studio', 'models');
/** Tile photos are shown at roughly 150px wide; 512 keeps them crisp on a retina screen. */
const TILE_WIDTH = 512;

/**
 * One model stands in for every pose tile, so a pose reads as a pose rather than as a different
 * body. "Regular" is the least remarkable build, which is what a pose demonstration wants.
 */
const POSE_REFERENCE_MODEL = MODEL_PRESETS.find((m) => m.id === 'regular') ?? MODEL_PRESETS[0];
/** The model tiles are all shot straight on, so the only thing changing between them is the body. */
const MODEL_REFERENCE_POSE = POSE_PRESETS.find((p) => p.id === 'front') ?? POSE_PRESETS[0];

/**
 * What the models wear in the preview. Plain, unbranded, close-fitting basics: the tile has to show
 * a body and a pose, and any actual garment here would compete with the brand's own piece.
 */
const WARDROBE =
  'wearing plain unbranded light-grey close-fitting basics (a simple scoop-neck top and leggings) with bare feet, no accessories, no jewellery, no print, no logo';

const SET =
  'a seamless mid-grey studio backdrop with a soft gradient falloff, even professional softbox lighting from the front, a soft contact shadow at the feet';

const RULES =
  'Photorealistic editorial fashion photography, shot on a full-frame camera with an 85mm lens at f/5.6, sharp focus, natural skin texture, true-to-life colour. The entire body from the top of the head to the feet is inside the frame with clear margin above and below. Exactly one person, centred, facing as described. Do not add any text, watermark, logo or graphic. Do not produce a collage or split frame. Do not deform hands, fingers or feet. Avoid a plastic, waxy or over-retouched finish.';

type Job = { name: string; prompt: string };

/** One tile per model (all straight on) and one per pose (all the same model). */
function jobs(): Job[] {
  const models = MODEL_PRESETS.map((m) => ({
    name: `model-${m.id}`,
    prompt: `A full-length studio photograph of ${m.prompt}, ${MODEL_REFERENCE_POSE.prompt}, ${WARDROBE}, against ${SET}. ${RULES}`,
  }));
  const poses = POSE_PRESETS.map((p) => ({
    name: `pose-${p.id}`,
    prompt: `A full-length studio photograph of ${POSE_REFERENCE_MODEL.prompt}, ${p.prompt}, ${WARDROBE}, against ${SET}. ${RULES}`,
  }));
  return [...models, ...poses];
}

type Engine = { name: string; model: string; render: (prompt: string) => Promise<Buffer> };

function geminiEngine(): Engine {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in Backend/.env.');
  const model = process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-3.1-flash-image';

  return {
    name: 'gemini',
    model,
    render: async (prompt) => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:4' } },
        }),
      });

      const body = await res.text();
      if (!res.ok) {
        const hint =
          res.status === 429
            ? ' — this key has no image-generation quota. Enable billing on it in Google AI Studio, or rerun with --engine openai'
            : '';
        throw new Error(`${model} answered ${res.status}${hint}: ${body.slice(0, 300)}`);
      }

      const inline = JSON.parse(body)?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
      if (!inline?.data) throw new Error(`${model} returned no image: ${body.slice(0, 300)}`);
      return Buffer.from(inline.data, 'base64');
    },
  };
}

function openaiEngine(): Engine {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set in Backend/.env.');
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1';

  return {
    name: 'openai',
    model,
    render: async (prompt) => {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        // 1024x1536 is the portrait shape; a model standing up needs the height.
        body: JSON.stringify({ model, prompt, size: '1024x1536', n: 1 }),
      });

      const body = await res.text();
      if (!res.ok) throw new Error(`${model} answered ${res.status}: ${body.slice(0, 300)}`);

      const first = JSON.parse(body)?.data?.[0];
      if (first?.b64_json) return Buffer.from(first.b64_json, 'base64');
      if (first?.url) return Buffer.from(await (await fetch(first.url)).arrayBuffer());
      throw new Error(`${model} returned no image: ${body.slice(0, 300)}`);
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.find((a) => a.startsWith('--only'));
  const only = new Set(
    (onlyArg?.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf('--only') + 1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const engineArg = (args.find((a) => a.startsWith('--engine='))?.split('=')[1] ?? (args.includes('--engine') ? args[args.indexOf('--engine') + 1] : '')).trim();
  if (engineArg && engineArg !== 'gemini' && engineArg !== 'openai') throw new Error(`Unknown engine "${engineArg}". Use gemini or openai.`);
  const engine = engineArg === 'openai' ? openaiEngine() : geminiEngine();

  /**
   * Shrinking to a tile-sized WebP is what keeps these files small, but it is not worth failing the
   * whole run over: without sharp the frames are written as PNG and the panel falls back to those.
   */
  let sharp: typeof import('sharp') | null = null;
  try {
    sharp = require('sharp');
  } catch {
    console.warn('sharp is not installed, so frames are written as full-size PNG.');
    console.warn('For tile-sized WebP files instead:  npm install --save-dev sharp\n');
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const todo = jobs().filter((j) => only.size === 0 || only.has(j.name));
  console.log(`Rendering ${todo.length} preview photo(s) with ${engine.model} into ${OUT_DIR}\n`);

  let made = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const job of todo) {
    const out = path.join(OUT_DIR, `${job.name}.${sharp ? 'webp' : 'png'}`);
    if (!force && (await fs.stat(out).catch(() => null))) {
      console.log(`  = ${job.name}  (already there; --force to replace)`);
      skipped += 1;
      continue;
    }
    try {
      const raw = await engine.render(job.prompt);
      const bytes = sharp ? await sharp(raw).resize({ width: TILE_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer() : raw;
      await fs.writeFile(out, bytes);
      console.log(`  + ${path.basename(out)}  (${Math.round(bytes.length / 1024)} KB)`);
      made += 1;
    } catch (err) {
      console.error(`  ! ${job.name}  ${(err as Error).message}`);
      failed.push(job.name);
    }
  }

  console.log(`\nDone: ${made} rendered, ${skipped} already there, ${failed.length} failed.`);
  if (failed.length) {
    console.log(`Retry just those with:  npm run studio:previews -- --only ${failed.join(',')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
});
