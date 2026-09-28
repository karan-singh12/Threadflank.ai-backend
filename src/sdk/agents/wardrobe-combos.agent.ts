import { BadRequestException, Injectable } from '@nestjs/common';
import { ModelRouter } from '../core/router/model-router';
import { PrismaService } from '../../prisma/prisma.service';
import { wardrobeCombosSystemPrompt, wardrobeCombosUserPrompt, WardrobeCombosInput, ComboPromptItem } from '../prompts/wardrobe-combos.prompt';

export interface WardrobeCombo {
  name: string;
  occasion: string;
  itemIds: string[];
  reason: string;
}

const MIN_ITEMS = 2;

/**
 * Proposes new outfits built only from what the user owns (feature #4),
 * nudged toward under-used pieces so the closet earns its keep. The model
 * only sees item ids + attributes and must answer in JSON; every id it
 * returns is re-checked against the user's wardrobe before we trust it.
 */
@Injectable()
export class WardrobeCombosAgent {
  constructor(
    private readonly router: ModelRouter,
    private readonly prisma: PrismaService,
  ) {}

  async run(userId: string, input: WardrobeCombosInput): Promise<{ combos: WardrobeCombo[] }> {
    const items = await this.prisma.wardrobeItem.findMany({
      where: { userId },
      select: { id: true, name: true, brand: true, category: true, color: true, tags: true, wornCount: true, lastWornAt: true },
      take: 150,
      orderBy: { wornCount: 'asc' },
    });
    if (items.length < MIN_ITEMS) throw new BadRequestException('Add a few more items to your wardrobe first');

    const promptItems: ComboPromptItem[] = items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      color: i.color,
      brand: i.brand,
      tags: parseTags(i.tags),
      wornCount: i.wornCount,
      daysSinceWorn: i.lastWornAt ? Math.floor((Date.now() - i.lastWornAt.getTime()) / 86_400_000) : null,
    }));

    const response = await this.router.execute({
      taskType: 'wardrobe-combos',
      messages: [
        { role: 'system', content: wardrobeCombosSystemPrompt() },
        { role: 'user', content: wardrobeCombosUserPrompt(input, promptItems) },
      ],
      temperature: 0.8,
      maxTokens: 1500,
      requestedBy: userId,
    });

    const owned = new Set(items.map((i) => i.id));
    const parsed = parseJson(response.content);
    const combos = (Array.isArray(parsed?.combos) ? parsed.combos : [])
      .map((c: any): WardrobeCombo => ({
        name: String(c?.name ?? 'Outfit').slice(0, 60),
        occasion: String(c?.occasion ?? input.occasion ?? 'casual').toLowerCase().slice(0, 30),
        itemIds: [...new Set<string>((Array.isArray(c?.itemIds) ? c.itemIds : []).map(String))].filter((id) => owned.has(id)),
        reason: String(c?.reason ?? '').slice(0, 240),
      }))
      .filter((c: WardrobeCombo) => c.itemIds.length >= MIN_ITEMS)
      .slice(0, Math.min(6, input.count ?? 3));

    return { combos };
  }
}

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === 'string') {
    try {
      const v = JSON.parse(tags);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJson(content: string): any {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : content);
  } catch {
    return null;
  }
}
