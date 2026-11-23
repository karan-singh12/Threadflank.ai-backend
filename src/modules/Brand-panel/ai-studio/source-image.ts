import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { downloadStored } from '../../../shared/storage/r2-objects';

/** The most an AI Studio render will read from one source photo. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type SourceImage = { bytes: Buffer; mimeType: string };

/**
 * The photo a render starts from, as bytes. A brand's photo reaches us three ways — pasted inline as
 * a data URI, uploaded into our own `public/` folder, or stored remotely — and every studio here
 * (video, reel, model shoot) needs all three, so the reading happens once in this file.
 *
 * Local paths are resolved under `public/` and checked, so a crafted `/../../.env` cannot be read
 * back out through a render.
 */
export async function loadSourceImage(url: string): Promise<SourceImage> {
  try {
    let bytes: Buffer;
    let mimeType = 'image/jpeg';
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (!m) throw new Error('bad data URI');
      mimeType = m[1] || mimeType;
      bytes = Buffer.from(m[3], m[2] ? 'base64' : 'utf8');
    } else if (url.startsWith('/')) {
      const root = path.resolve(process.cwd(), 'public');
      const file = path.resolve(process.cwd(), url.replace(/^\/+/, ''));
      if (!file.startsWith(root + path.sep)) throw new Error('outside public uploads');
      bytes = await fs.readFile(file);
      mimeType = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
    } else if (/^https:\/\//i.test(url)) {
      const stored = await downloadStored(url);
      bytes = stored.body;
      mimeType = stored.contentType;
    } else {
      throw new Error('unsupported URL');
    }
    if (!/^image\//.test(mimeType)) throw new Error('not an image');
    if (bytes.length > MAX_IMAGE_BYTES) throw new BadRequestException('That photo is over 10 MB. Use a smaller one.');
    return { bytes, mimeType };
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException("We couldn't read that photo. Choose another garment or upload the photo again.");
  }
}

/** The same photo as a data URI, which is how the image engines take a reference. */
export const asDataUri = (image: SourceImage) => `data:${image.mimeType};base64,${image.bytes.toString('base64')}`;
