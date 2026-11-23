import 'reflect-metadata';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BrandModelService, MODEL_SHOT_COST } from './brand-model.service';
import { buildShootPrompt } from './model-prompt';
import { BACKDROP_PRESETS, FRAMING_PRESETS, MODEL_PRESETS, POSE_PRESETS, findBackdrop, findFraming, findModel, findPose } from './model-presets';

const PHOTO = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;
const RENDERED = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;

const SETUP = { modelId: 'curve', poseId: 'walk', backdropId: 'terrace', framingId: 'full', customImageUrl: PHOTO };

/** An in-memory BrandModelShot table plus the two credit statements the service leans on. */
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
    brandModelShot: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `s${rows.length + 1}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      count: jest.fn(async ({ where }: any) => rows.filter((r) => r.brandId === where.brandId).length),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.brandId === where.brandId)),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.brandId === where.brandId) ?? null),
      deleteMany: jest.fn(async ({ where }: any) => {
        const hit = rows.filter((r) => r.id === where.id && r.brandId === where.brandId);
        hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
        return { count: hit.length };
      }),
    },
  };
  return { prisma, rows, state };
}

type ImagesOpts = { configured?: boolean; error?: Error };

function fakeImages(opts: ImagesOpts = {}) {
  const calls: any[] = [];
  return {
    calls,
    hasEngine: () => opts.configured !== false,
    generate: jest.fn(async (job: any) => {
      calls.push(job);
      if (opts.error) throw opts.error;
      return { url: RENDERED, provider: 'gemini', model: 'gemini-3.1-flash-image' };
    }),
  } as any;
}

const fakeStorage = () => ({ save: jest.fn(async ({ filename }: any) => ({ url: `/public/brand-model-shots/${filename}`, path: filename, size: 10 })), delete: jest.fn() }) as any;

const fakeCatalog = (garment?: any) => ({ findOne: jest.fn(async () => garment ?? null) }) as any;

function makeService(opts: { credits?: number; images?: ImagesOpts; garment?: any } = {}) {
  const db = fakeDb(opts.credits ?? 100);
  const images = fakeImages(opts.images);
  const storage = fakeStorage();
  const service = new BrandModelService(db.prisma, fakeCatalog(opts.garment), images, storage);
  return { service, db, images, storage };
}

describe('model and pose presets', () => {
  it('gives every preset a distinct id', () => {
    for (const list of [MODEL_PRESETS, POSE_PRESETS, BACKDROP_PRESETS, FRAMING_PRESETS]) {
      expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    }
  });

  it('points every model and pose tile at a preview photo the panel can serve', () => {
    for (const preset of [...MODEL_PRESETS, ...POSE_PRESETS]) {
      expect(preset.previewUrl).toMatch(/^\/ai-studio\/models\/[a-z-]+\.webp$/);
    }
  });
});

describe('buildShootPrompt', () => {
  const base = { model: findModel('curve')!, pose: findPose('walk')!, backdrop: findBackdrop('terrace')!, framing: findFraming('full')! };

  it('names the body, the pose, the set and the framing', () => {
    const prompt = buildShootPrompt(base);
    expect(prompt).toContain('curvy plus-size');
    expect(prompt).toContain('mid-stride');
    expect(prompt).toContain('golden hour');
    expect(prompt).toContain('full-length shot');
  });

  it('always demands the garment comes out as it went in', () => {
    expect(buildShootPrompt(base)).toContain('GARMENT FIDELITY IS THE TOP PRIORITY');
    expect(buildShootPrompt(base)).toContain('Do not add any text, watermark, logo');
  });

  it('describes the piece from the catalogue row when one was picked', () => {
    const prompt = buildShootPrompt({ ...base, garment: { title: 'Banarasi Kurta', category: 'Kurta', colors: ['ivory', 'gold'] } });
    expect(prompt).toContain('ivory and gold Kurta');
    expect(prompt).toContain('Banarasi Kurta');
  });

  it("carries the brand's own art direction through", () => {
    expect(buildShootPrompt({ ...base, direction: 'styled with gold jhumkas' })).toContain('styled with gold jhumkas');
  });
});

describe('BrandModelService.create', () => {
  it('renders the shot, stores it and takes the credits once', async () => {
    const { service, db, images, storage } = makeService({ credits: 20 });

    const { shot, remainingCredits } = await service.create('b1', SETUP as any);

    expect(images.generate).toHaveBeenCalledTimes(1);
    // The flat photo has to reach the engine, or it would invent a garment.
    expect(images.calls[0].images).toEqual([PHOTO]);
    expect(images.calls[0].engines).toEqual(['gemini']);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(shot.imageUrl).toContain('/brand-model-shots/');
    expect(shot.modelLabel).toBe('Curve');
    expect(shot.poseLabel).toBe('Walking');
    expect(remainingCredits).toBe(20 - MODEL_SHOT_COST);
    expect(db.state.grants).toBe(0);
  });

  it('shoots a close detail square and everything else tall', async () => {
    const { service, images } = makeService();
    await service.create('b1', { ...SETUP, framingId: 'detail' } as any);
    expect(images.calls[0].aspectRatio).toBe('1:1');

    await service.create('b1', SETUP as any);
    expect(images.calls[1].aspectRatio).toBe('3:4');
  });

  it('gives the credits back when the engine fails, and says why', async () => {
    const { service, db } = makeService({ credits: 20, images: { error: new Error('RESOURCE_EXHAUSTED: quota') } });

    await expect(service.create('b1', SETUP as any)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.create('b1', SETUP as any)).rejects.toThrow(/out of quota/);
    expect(db.state.credits).toBe(20);
    expect(db.state.grants).toBe(2);
  });

  it('charges nothing when the brand cannot afford a shot', async () => {
    const { service, images } = makeService({ credits: MODEL_SHOT_COST - 1 });
    await expect(service.create('b1', SETUP as any)).rejects.toThrow(BadRequestException);
    expect(images.generate).not.toHaveBeenCalled();
  });

  it('charges nothing when no image engine is connected', async () => {
    const { service, db } = makeService({ images: { configured: false } });
    await expect(service.create('b1', SETUP as any)).rejects.toThrow(/not connected yet/);
    expect(db.state.credits).toBe(100);
  });

  it('refuses a shoot with no photo to work from', async () => {
    const { service } = makeService({ garment: { id: 'g1', title: 'Kurta', category: 'Kurta', colors: [], images: [] } });
    await expect(service.create('b1', { ...SETUP, customImageUrl: undefined, garmentId: 'g1' } as any)).rejects.toThrow(/upload one/);
  });

  it('refuses a model, pose or backdrop that is not in the studio', async () => {
    const { service } = makeService();
    await expect(service.create('b1', { ...SETUP, modelId: 'nobody' } as any)).rejects.toThrow(BadRequestException);
  });
});

describe('BrandModelService gallery', () => {
  it('lists only this brand and deletes only its own shot', async () => {
    const { service } = makeService();
    const { shot } = await service.create('b1', SETUP as any);
    await service.create('b2', SETUP as any);

    expect(await service.list('b1')).toHaveLength(1);
    await expect(service.remove('b2', shot.id)).rejects.toThrow(/not found/);
    expect(await service.remove('b1', shot.id)).toEqual({ success: true, id: shot.id });
    expect(await service.list('b1')).toHaveLength(0);
  });

  it('reports the cost and whether shoots can run', () => {
    expect(makeService().service.status()).toEqual({ available: true, cost: MODEL_SHOT_COST });
    expect(makeService({ images: { configured: false } }).service.status().available).toBe(false);
  });
});
