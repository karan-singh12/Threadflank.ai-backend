import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { toolLabel } from './model/photo-tools';

export const LIBRARY_KINDS = ['copy', 'photo', 'video', 'reel'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export type LibraryItem = {
  kind: LibraryKind;
  id: string;
  title: string;
  /** Image or video address; empty for copy. */
  url: string;
  /** The text, for copy; a short note (prompt or style) for media. */
  text: string;
  /** e.g. "Instagram caption" for copy, "Slim · studio" for a model shot. */
  detail: string;
  folder: string | null;
  tags: string[];
  createdAt: string;
};

const PER_KIND = 300;
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Folder and tag rules, kept small and predictable. Exported for tests. */
export function normaliseMeta(input: { folder?: string | null; tags?: string[] }) {
  const folder = input.folder === undefined ? undefined : input.folder === null ? null : clean(input.folder).slice(0, 40) || null;
  const tags = input.tags === undefined ? undefined : [...new Set(input.tags.map((t) => clean(t).toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 12);
  return { folder, tags };
}

/**
 * The Content Library (blueprint 3.11): everything a brand made in AI Studio in one place, saved
 * copy, model shots, videos and reels, with its own folders and tags. Items stay in their own
 * tables; the folders and tags sit alongside in BrandLibraryMeta.
 */
@Injectable()
export class ContentLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(brandId: string, q: { kind?: string; folder?: string; tag?: string; q?: string } = {}) {
    const want = (k: LibraryKind) => !q.kind || q.kind === k;
    const [copy, photos, videos, reels, metas] = await Promise.all([
      want('copy') ? this.prisma.brandContentItem.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: PER_KIND }) : [],
      want('photo') ? this.prisma.brandModelShot.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: PER_KIND }) : [],
      want('video') ? this.prisma.brandVideo.findMany({ where: { brandId, status: 'READY', videoUrl: { not: null } }, orderBy: { createdAt: 'desc' }, take: PER_KIND }) : [],
      want('reel') ? this.prisma.brandReel.findMany({ where: { brandId, status: 'READY', videoUrl: { not: null } }, orderBy: { createdAt: 'desc' }, take: PER_KIND }) : [],
      this.prisma.brandLibraryMeta.findMany({ where: { brandId } }),
    ]);
    const meta = new Map(metas.map((m) => [`${m.kind}:${m.itemId}`, m]));
    const withMeta = (kind: LibraryKind, id: string) => {
      const m = meta.get(`${kind}:${id}`);
      return { folder: m?.folder ?? null, tags: m?.tags ?? [] };
    };

    const items: LibraryItem[] = [
      ...copy.map((c) => ({ kind: 'copy' as const, id: c.id, title: c.title, url: '', text: c.body, detail: c.contentType.replace(/_/g, ' ').toLowerCase(), createdAt: c.createdAt.toISOString(), ...withMeta('copy', c.id) })),
      ...photos.map((p) => ({ kind: 'photo' as const, id: p.id, title: toolLabel(p.modelId) ?? 'Model shot', url: p.imageUrl, text: p.direction ?? '', detail: toolLabel(p.modelId) ? p.backdropId : [p.modelId, p.poseId, p.backdropId].join(' · '), createdAt: p.createdAt.toISOString(), ...withMeta('photo', p.id) })),
      ...videos.map((v) => ({ kind: 'video' as const, id: v.id, title: 'Motion video', url: v.videoUrl!, text: v.prompt, detail: `${v.durationSec}s · ${v.aspectRatio}`, createdAt: v.createdAt.toISOString(), ...withMeta('video', v.id) })),
      ...reels.map((r) => ({ kind: 'reel' as const, id: r.id, title: r.title || 'Reel', url: r.videoUrl!, text: '', detail: `${r.durationSec}s · ${r.aspectRatio}`, createdAt: r.createdAt.toISOString(), ...withMeta('reel', r.id) })),
    ];

    const needle = q.q?.trim().toLowerCase();
    const filtered = items
      .filter((i) => (q.folder ? (q.folder === '__none' ? !i.folder : i.folder === q.folder) : true))
      .filter((i) => (q.tag ? i.tags.includes(q.tag.toLowerCase()) : true))
      .filter((i) => (needle ? `${i.title} ${i.text} ${i.detail} ${i.tags.join(' ')}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const folders = new Map<string, number>();
    const tags = new Map<string, number>();
    for (const i of items) {
      if (i.folder) folders.set(i.folder, (folders.get(i.folder) ?? 0) + 1);
      for (const t of i.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    return {
      items: filtered,
      counts: Object.fromEntries(LIBRARY_KINDS.map((k) => [k, items.filter((i) => i.kind === k).length])),
      folders: [...folders].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
      tags: [...tags].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 40),
    };
  }

  /** Files an item in a folder and/or sets its tags. Only the brand's own items can be changed. */
  async setMeta(brandId: string, kind: string, itemId: string, input: { folder?: string | null; tags?: string[] }) {
    if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Unknown item type.');
    const where = { id: itemId, brandId };
    const owned =
      kind === 'copy'
        ? await this.prisma.brandContentItem.count({ where })
        : kind === 'photo'
          ? await this.prisma.brandModelShot.count({ where })
          : kind === 'video'
            ? await this.prisma.brandVideo.count({ where })
            : await this.prisma.brandReel.count({ where });
    if (!owned) throw new NotFoundException('Item not found.');
    const { folder, tags } = normaliseMeta(input);
    const row = await this.prisma.brandLibraryMeta.upsert({
      where: { kind_itemId: { kind, itemId } },
      create: { brandId, kind, itemId, folder: folder ?? null, tags: tags ?? [] },
      update: { ...(folder !== undefined ? { folder } : {}), ...(tags !== undefined ? { tags } : {}) },
    });
    return { kind, id: itemId, folder: row.folder, tags: row.tags };
  }
}
