import { Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Stitches a reel with ffmpeg: every shot is re-encoded to the same shape, codec and frame rate,
 * the brand's opening and closing cards are drawn the same way, and the lot is concatenated
 * without another encode. Doing it in two steps (normalise, then concat) is far more predictable
 * than one large filter graph, and a single bad clip fails on its own line.
 *
 * Nothing the brand typed is ever interpolated into a filter string. drawtext reads its text from
 * a file (`textfile=`) and every path ffmpeg sees is a plain relative name inside a temp directory
 * it runs in, so a colon, quote or backslash in a brand or garment name cannot break the command.
 *
 * ffmpeg is expected on PATH; the Docker image installs it with the DejaVu fonts.
 */

const logger = new Logger('BrandReelCompose');

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];

let ffmpegChecked: Promise<boolean> | null = null;
let fontPath: string | null | undefined;

/** Whether ffmpeg can be run at all. Checked once per process. */
export function hasFfmpeg(): Promise<boolean> {
  ffmpegChecked ??= run(['-version'])
    .then(() => true)
    .catch(() => {
      logger.warn('ffmpeg is not on PATH: reels cannot be stitched on this host.');
      return false;
    });
  return ffmpegChecked;
}

async function findFont(): Promise<string | null> {
  if (fontPath !== undefined) return fontPath;
  for (const candidate of FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      fontPath = candidate;
      return fontPath;
    } catch {
      /* try the next one */
    }
  }
  logger.warn('No usable font found: reel cards will be rendered without text.');
  fontPath = null;
  return null;
}

/** Runs ffmpeg and rejects with the tail of its stderr, which is where it says what went wrong. */
function run(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const tail = err.trim().split('\n').slice(-4).join(' ').slice(0, 400);
      reject(new Error(tail || `ffmpeg exited with ${code}`));
    });
  });
}

const SILENT_AUDIO = ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];

/** One encoder setting for every segment, so the pieces join without a second encode. */
const ENCODE = [
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '21',
  '-pix_fmt', 'yuv420p',
  '-profile:v', 'high',
  '-level', '4.0',
  '-r', String(FPS),
  '-video_track_timescale', '30000',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-ar', '44100',
  '-ac', '2',
  '-movflags', '+faststart',
];

/** Fills the frame at 1080x1920 whatever shape the engine returned. */
const FIT = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},setsar=1`;

export type ReelShotInput = {
  /** The rendered clip on disk. */
  file: string;
  /** Lower-third headline, usually the garment's name. */
  label: string;
  /** Lower-third second line, usually the price. */
  caption: string;
};

export type ComposeInput = {
  shots: ReelShotInput[];
  brandName: string;
  /** Drawn on the closing card, e.g. "yourbrand.com". */
  site: string;
  outroLine: string;
  cardColor: string;
  introSec: number;
  outroSec: number;
  /** Seconds each rendered clip runs, used for the reported length. */
  shotSeconds: number;
  /** The brand's logo on disk, for the opening card. Optional. */
  logoFile?: string;
};

/** Builds the reel and returns its bytes plus how long it runs. */
export async function composeReel(input: ComposeInput): Promise<{ video: Buffer; durationSec: number }> {
  if (!(await hasFfmpeg())) throw new Error('Video stitching is not available on this server.');

  // Everything ffmpeg touches lives here and is named plainly, so no path ever needs escaping.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-reel-'));
  const text = new TextWriter(dir);
  try {
    let typeface: string | null = null;
    const found = await findFont();
    if (found) {
      // Copied in so the filter can name it "font.ttf" rather than an absolute path.
      await fs.copyFile(found, path.join(dir, 'font.ttf'));
      typeface = 'font.ttf';
    }

    let logo: string | undefined;
    if (input.logoFile) {
      logo = 'logo.img';
      await fs.copyFile(input.logoFile, path.join(dir, logo));
    }

    const segments: string[] = [];

    // Opening card: the brand's name, under its logo when it has one.
    segments.push(
      await card(dir, 'seg-000.mp4', {
        seconds: input.introSec,
        color: input.cardColor,
        lines: [
          { file: await text.write(input.brandName), size: 84, y: '(h/2)-40' },
          { file: await text.write('Try it on before you buy'), size: 40, y: '(h/2)+70', alpha: 0.72 },
        ],
        logo,
        typeface,
      }),
    );

    // One normalised segment per outfit, with its lower-third burned in.
    for (const [i, shot] of input.shots.entries()) {
      const name = `seg-${String(i + 1).padStart(3, '0')}.mp4`;
      const local = `in-${i}.mp4`;
      await fs.copyFile(shot.file, path.join(dir, local));
      await normalizeShot(dir, name, local, shot, typeface, text);
      segments.push(name);
    }

    // Closing card: where to buy.
    segments.push(
      await card(dir, 'seg-999.mp4', {
        seconds: input.outroSec,
        color: input.cardColor,
        lines: [
          { file: await text.write(input.outroLine), size: 56, y: '(h/2)-30' },
          { file: await text.write(input.site), size: 44, y: '(h/2)+60', alpha: 0.75 },
        ],
        logo,
        typeface,
      }),
    );

    // Every segment now shares a codec and shape, so joining them needs no second encode.
    // The names are ours and contain no quotes, so the list file is safe as written.
    await fs.writeFile(path.join(dir, 'segments.txt'), segments.map((s) => `file '${s}'`).join('\n'), 'utf8');
    await run(['-y', '-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', '-movflags', '+faststart', 'reel.mp4'], dir);

    const video = await fs.readFile(path.join(dir, 'reel.mp4'));
    const durationSec = Math.round(input.introSec + input.outroSec + input.shots.length * input.shotSeconds);
    return { video, durationSec };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Writes each caption to its own small file, so drawtext never parses brand-supplied punctuation. */
class TextWriter {
  private n = 0;
  constructor(private readonly dir: string) {}
  /** Returns the relative filename, or null when there is nothing to draw. */
  async write(value: string): Promise<string | null> {
    const clean = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
    if (!clean) return null;
    const name = `t${this.n++}.txt`;
    await fs.writeFile(path.join(this.dir, name), clean, 'utf8');
    return name;
  }
}

/** One outfit: filled to 1080x1920 with its name and price along the bottom. */
async function normalizeShot(
  dir: string,
  out: string,
  input: string,
  shot: ReelShotInput,
  typeface: string | null,
  text: TextWriter,
) {
  const overlays: string[] = [];
  if (typeface) {
    const label = await text.write(shot.label);
    const caption = await text.write(shot.caption);
    if (label) {
      overlays.push(
        `drawtext=fontfile=${typeface}:textfile=${label}:fontcolor=white:fontsize=54:x=72:y=h-280` +
          `:box=1:boxcolor=0x000000@0.42:boxborderw=22:enable=gte(t\\,0.4)`,
      );
    }
    if (caption) {
      overlays.push(
        `drawtext=fontfile=${typeface}:textfile=${caption}:fontcolor=0xE6E6F0:fontsize=38:x=72:y=h-196` +
          `:box=1:boxcolor=0x000000@0.42:boxborderw=18:enable=gte(t\\,0.6)`,
      );
    }
  }
  const chain = [FIT, ...overlays].join(',');
  await run(
    ['-y', '-i', input, ...SILENT_AUDIO, '-filter_complex', `[0:v]${chain}[v]`, '-map', '[v]', '-map', '1:a', '-shortest', ...ENCODE, out],
    dir,
  );
}

type CardLine = { file: string | null; size: number; y: string; alpha?: number };

/** A plain brand card: solid colour, optional logo, one or two lines of text. */
async function card(
  dir: string,
  out: string,
  opts: { seconds: number; color: string; lines: CardLine[]; logo?: string; typeface: string | null },
): Promise<string> {
  const inputs = ['-f', 'lavfi', '-i', `color=c=${opts.color}:s=${WIDTH}x${HEIGHT}:d=${opts.seconds}`, ...SILENT_AUDIO];
  let graph: string;
  if (opts.logo) {
    inputs.push('-i', opts.logo);
    graph =
      `[2:v]scale=200:200:force_original_aspect_ratio=decrease[lg];` +
      `[0:v]fps=${FPS},setsar=1[bg];[bg][lg]overlay=(W-w)/2:(H/2)-280[base]`;
  } else {
    graph = `[0:v]fps=${FPS},setsar=1[base]`;
  }

  const drawn: string[] = [];
  if (opts.typeface) {
    for (const line of opts.lines) {
      if (!line.file) continue;
      const colour = line.alpha ? `white@${line.alpha}` : 'white';
      drawn.push(`drawtext=fontfile=${opts.typeface}:textfile=${line.file}:fontcolor=${colour}:fontsize=${line.size}:x=(w-text_w)/2:y=${line.y}`);
    }
  }
  graph += drawn.length ? `;[base]${drawn.join(',')}[v]` : `;[base]null[v]`;

  await run(['-y', ...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '1:a', '-t', String(opts.seconds), ...ENCODE, out], dir);
  return out;
}
