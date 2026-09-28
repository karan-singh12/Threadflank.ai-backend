import { PrismaService } from '../../prisma/prisma.service';
import { AgentTool } from './tool.types';

/** Read-only tools the occasion-planner agent uses to reason over the
 * user's EXISTING WardrobeItem/Look data (never writes). */
export function buildWardrobeTools(prisma: PrismaService): AgentTool[] {
  return [
    {
      definition: {
        name: 'get_wardrobe_items',
        description: "Fetch the user's owned wardrobe items, optionally filtered by category.",
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Optional category filter (e.g. "Tops", "Footwear")' },
          },
        },
      },
      execute: async (args, ctx) => {
        const items = await prisma.wardrobeItem.findMany({
          where: {
            userId: ctx.userId,
            ...(args.category ? { category: String(args.category) } : {}),
          },
          select: { id: true, name: true, brand: true, category: true, color: true, tags: true },
          take: 100,
        });
        return { items };
      },
    },
    {
      definition: {
        name: 'get_saved_looks',
        description: "Fetch the user's previously saved outfit looks.",
        parameters: {
          type: 'object',
          properties: {
            occasion: { type: 'string', description: 'Optional occasion filter (e.g. "formal", "casual")' },
          },
        },
      },
      execute: async (args, ctx) => {
        const looks = await prisma.look.findMany({
          where: {
            userId: ctx.userId,
            ...(args.occasion ? { occasion: String(args.occasion) } : {}),
          },
          select: { id: true, name: true, occasion: true, pieces: true },
          take: 50,
        });
        return { looks };
      },
    },
  ];
}
