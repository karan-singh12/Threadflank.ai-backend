import { ContentLibraryService, normaliseMeta } from './library.service';

describe('content library', () => {
  it('cleans folders and tags', () => {
    expect(normaliseMeta({ folder: '  Diwali   2026 ', tags: ['Festive', 'festive ', '', 'Bridal'] })).toEqual({ folder: 'Diwali 2026', tags: ['festive', 'bridal'] });
    expect(normaliseMeta({ folder: '   ' }).folder).toBeNull();
    expect(normaliseMeta({ folder: null }).folder).toBeNull();
    expect(normaliseMeta({}).folder).toBeUndefined();
  });

  const at = (d: string) => new Date(`2026-11-${d}T10:00:00Z`);
  const svc = (metas: unknown[] = []) =>
    new ContentLibraryService({
      brandContentItem: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', title: 'Caption', body: 'Festive drop', contentType: 'INSTAGRAM_CAPTION', createdAt: at('03') }]) },
      brandModelShot: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', imageUrl: 'https://x/p.png', direction: null, modelId: 'slim', poseId: 'walk', backdropId: 'studio', createdAt: at('05') }]) },
      brandVideo: { findMany: jest.fn().mockResolvedValue([]) },
      brandReel: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', title: 'Launch reel', videoUrl: 'https://x/r.mp4', durationSec: 12, aspectRatio: '9:16', createdAt: at('04') }]) },
      brandLibraryMeta: { findMany: jest.fn().mockResolvedValue(metas) },
    } as any);

  it('merges every kind newest first, with folders and tags', async () => {
    const r = await svc([{ kind: 'reel', itemId: 'r1', folder: 'Launch', tags: ['diwali'] }]).list('b1');
    expect(r.items.map((i) => i.id)).toEqual(['p1', 'r1', 'c1']);
    expect(r.counts).toEqual({ copy: 1, photo: 1, video: 0, reel: 1 });
    expect(r.folders).toEqual([{ name: 'Launch', count: 1 }]);
    expect(r.tags).toEqual([{ name: 'diwali', count: 1 }]);
  });

  it('filters by folder, unfiled, tag and text', async () => {
    const s = svc([{ kind: 'reel', itemId: 'r1', folder: 'Launch', tags: ['diwali'] }]);
    expect((await s.list('b1', { folder: 'Launch' })).items.map((i) => i.id)).toEqual(['r1']);
    expect((await s.list('b1', { folder: '__none' })).items.map((i) => i.id)).toEqual(['p1', 'c1']);
    expect((await s.list('b1', { tag: 'Diwali' })).items.map((i) => i.id)).toEqual(['r1']);
    expect((await s.list('b1', { q: 'festive' })).items.map((i) => i.id)).toEqual(['c1']);
  });
});
