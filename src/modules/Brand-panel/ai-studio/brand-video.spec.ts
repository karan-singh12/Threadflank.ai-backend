import 'reflect-metadata';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BrandVideoService, VIDEO_COST } from './brand-video.service';
import { buildVideoPrompt, findPreset } from './video-presets';
import type { VideoCheck, VideoEngine } from './video-engines';

const PHOTO = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;

/** A fake engine: start() returns a job id; check() returns whatever the test queues next. */
function fakeEngine(checks: VideoCheck[] = [], opts: { startError?: Error } = {}): VideoEngine & { started: any[] } {
  const started: any[] = [];
  return {
    id: 'veo',
    aspectRatios: ['9:16', '16:9'],
    durationSec: 8,
    started,
    model: async () => 'veo-test',
    start: async (input) => {
      if (opts.startError) throw opts.startError;
      started.push(input);
      return { operation: 'operations/op1', model: 'veo-test' };
    },
    check: async () => checks.shift() ?? { state: 'running' },
  };
}

/** An in-memory BrandVideo table plus the credit SQL, enough for the service. */
function fakeDb(credits = 100) {
  const rows: any[] = [];
  const state = { credits, grants: 0 };
  const prisma: any = {
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, ...vals: any[]) => {
      const cost = vals[0];
      if (state.credits < cost) return [];
      state.credits -= cost;
      return [{ credits: state.credits }];
    }),
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ...vals: any[]) => {
      state.credits += vals[0];
      state.grants += 1;
    }),
    brandVideo: {
      count: jest.fn(async ({ where }: any) => rows.filter((r) => r.brandId === where.brandId && r.status === where.status).length),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `v${rows.length + 1}`, status: 'RENDERING', refunded: false, videoUrl: null, error: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.brandId === where.brandId) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id)),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.brandId === where.brandId)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => r.id === where.id && (!where.status || r.status === where.status) && (where.refunded === undefined || r.refunded === where.refunded));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      delete: jest.fn(async ({ where }: any) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)),
    },
  };
  return { prisma, rows, state };
}

function build(engine: VideoEngine | null, credits = 100) {
  const db = fakeDb(credits);
  const storage: any = { save: jest.fn(async (o: any) => ({ url: `https://cdn.test/${o.folder}/${o.filename}`, path: o.filename, size: o.buffer.length })) };
  const catalog: any = { findOne: jest.fn(async () => ({ id: 'g1', title: 'Zari Lehenga', category: 'Lehenga', colors: ['Maroon'], images: [PHOTO] })) };
  const svc = new BrandVideoService(db.prisma, catalog, storage);
  svc.engines = engine ? [engine] : [];
  return { svc, storage, catalog, ...db };
}

describe('Brand motion videos', () => {
  it('takes the credits, starts the render, and stores the finished clip in our storage', async () => {
    const engine = fakeEngine([{ state: 'running' }, { state: 'done', video: Buffer.from('mp4'), mimeType: 'video/mp4' }]);
    const { svc, state, storage } = build(engine);

    const { video, remainingCredits } = await svc.create('b1', { garmentId: 'g1', presetId: 'festive_twirl', aspectRatio: '9:16', prompt: 'warm diwali lights' });
    expect(video.status).toBe('RENDERING');
    expect(remainingCredits).toBe(100 - VIDEO_COST);
    expect(state.credits).toBe(100 - VIDEO_COST);
    // The garment's own details and the brand's direction reach the engine, with the photo bytes.
    expect(engine.started[0].prompt).toContain('Zari Lehenga');
    expect(engine.started[0].prompt).toContain('warm diwali lights');
    expect(engine.started[0].image.bytes.toString()).toBe('jpeg-bytes');
    expect(engine.started[0].aspectRatio).toBe('9:16');

    expect((await svc.get('b1', video.id)).status).toBe('RENDERING');
    const done = await svc.get('b1', video.id);
    expect(done.status).toBe('READY');
    expect(done.videoUrl).toBe(`https://cdn.test/brand-videos/brand-video-${video.id}.mp4`);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(state.credits).toBe(100 - VIDEO_COST);
  });

  it('marks a failed render failed and gives the credits back exactly once', async () => {
    const engine = fakeEngine([{ state: 'failed', reason: 'blocked by safety filter' }]);
    const { svc, state } = build(engine);
    const { video } = await svc.create('b1', { garmentId: 'g1', presetId: 'studio_turn' });

    const failed = await svc.get('b1', video.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toContain('safety filter');
    expect(failed.refunded).toBe(true);
    expect(state.credits).toBe(100);
    // Checking again (or listing) does not refund a second time.
    await svc.get('b1', video.id);
    await svc.list('b1');
    expect(state.grants).toBe(1);
    expect(state.credits).toBe(100);
  });

  it('refunds at once when the engine refuses to start', async () => {
    const { svc, state, rows } = build(fakeEngine([], { startError: new Error('quota exceeded') }));
    await expect(svc.create('b1', { garmentId: 'g1', presetId: 'studio_turn' })).rejects.toThrow(ServiceUnavailableException);
    expect(state.credits).toBe(100);
    expect(rows).toHaveLength(0);
  });

  it('keeps a render going through a temporary error while checking', async () => {
    const engine = fakeEngine();
    engine.check = async () => {
      throw new Error('socket hang up');
    };
    const { svc, state } = build(engine);
    const { video } = await svc.create('b1', { garmentId: 'g1', presetId: 'studio_turn' });
    expect((await svc.get('b1', video.id)).status).toBe('RENDERING');
    expect(state.credits).toBe(100 - VIDEO_COST);
  });

  it('refuses without enough credits, before calling the engine', async () => {
    const engine = fakeEngine();
    const { svc } = build(engine, VIDEO_COST - 1);
    await expect(svc.create('b1', { garmentId: 'g1', presetId: 'studio_turn' })).rejects.toThrow(BadRequestException);
    expect(engine.started).toHaveLength(0);
  });

  it('allows two renders at a time per brand', async () => {
    const { svc } = build(fakeEngine());
    await svc.create('b1', { garmentId: 'g1', presetId: 'studio_turn' });
    await svc.create('b1', { garmentId: 'g1', presetId: 'runway_walk' });
    await expect(svc.create('b1', { garmentId: 'g1', presetId: 'velvet_glow' })).rejects.toThrow(/already have 2 videos rendering/);
  });

  it('does not delete a video while it is still rendering', async () => {
    const { svc } = build(fakeEngine());
    const { video } = await svc.create('b1', { garmentId: 'g1', presetId: 'studio_turn' });
    await expect(svc.remove('b1', video.id)).rejects.toThrow(BadRequestException);
  });

  it('writes a prompt that protects the garment and keeps text off the screen', () => {
    const prompt = buildVideoPrompt({ preset: findPreset('silk_motion')!, garment: { title: 'Banarasi Saree', category: 'Saree', colors: ['Gold'] } });
    expect(prompt).toContain('Banarasi Saree (saree) in Gold');
    expect(prompt).toContain('Keep the garment exactly as in the photo');
    expect(prompt).toContain('No text, logos or watermarks');
  });
});
