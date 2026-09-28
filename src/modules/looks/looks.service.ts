import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export type PoseVariant = { pose: string; imageUrl: string };

export type LookUpdateInput = {
  name?: string;
  occasion?: string;
  image?: string;
  pieces?: string[];
  poseVariants?: PoseVariant[];
  videoUrl?: string | null;
};

const MAX_POSES = 8;

function cleanPoses(value: unknown): PoseVariant[] {
  if (!Array.isArray(value)) throw new BadRequestException("poseVariants must be a list");
  return value
    .filter((p): p is PoseVariant => Boolean(p) && typeof p.pose === "string" && typeof p.imageUrl === "string" && p.imageUrl.length > 0)
    .slice(0, MAX_POSES)
    .map((p) => ({ pose: p.pose.slice(0, 40), imageUrl: p.imageUrl }));
}

@Injectable()
export class LooksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    data: { name: string; occasion: string; image: string; pieces: string[]; gradient?: string; poseVariants?: PoseVariant[]; videoUrl?: string }
  ) {
    return this.prisma.look.create({
      data: {
        userId,
        name: data.name,
        occasion: data.occasion,
        image: data.image,
        pieces: data.pieces, // Prisma will serialize array automatically for JSON field
        gradient: data.gradient || null,
        liked: false,
        poseVariants: data.poseVariants ? (cleanPoses(data.poseVariants) as any) : undefined,
        videoUrl: data.videoUrl || null,
      },
    });
  }

  async findAll(userId: string) {
    const looks = await this.prisma.look.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { stylistComments: true } } },
    });
    return looks.map(({ _count, ...look }) => ({ ...look, stylistCommentCount: _count.stylistComments }));
  }

  private async owned(id: string, userId: string) {
    const look = await this.prisma.look.findFirst({ where: { id, userId } });
    if (!look) throw new NotFoundException("Look not found");
    return look;
  }

  async findOne(id: string, userId: string) {
    await this.owned(id, userId);
    return this.prisma.look.findUnique({
      where: { id },
      include: { stylistComments: { orderBy: { createdAt: "asc" } } },
    });
  }

  async update(id: string, userId: string, data: LookUpdateInput) {
    await this.owned(id, userId);
    const patch: Record<string, unknown> = {};
    if (typeof data.name === "string" && data.name.trim()) patch.name = data.name.trim().slice(0, 80);
    if (typeof data.occasion === "string" && data.occasion) patch.occasion = data.occasion;
    if (typeof data.image === "string" && data.image) patch.image = data.image;
    if (Array.isArray(data.pieces)) patch.pieces = data.pieces.map(String);
    if (data.poseVariants !== undefined) patch.poseVariants = cleanPoses(data.poseVariants);
    if (data.videoUrl !== undefined) patch.videoUrl = data.videoUrl || null;
    return this.prisma.look.update({ where: { id }, data: patch as any });
  }

  /** Puts the look in (or takes it out of) the verified stylists' review queue. */
  async setReviewRequest(id: string, userId: string, requested: boolean) {
    await this.owned(id, userId);
    return this.prisma.look.update({
      where: { id },
      data: { stylistReviewRequested: requested, reviewRequestedAt: requested ? new Date() : null },
    });
  }

  async toggleLike(id: string, userId: string) {
    const look = await this.owned(id, userId);
    return this.prisma.look.update({
      where: { id },
      data: { liked: !look.liked },
    });
  }

  async remove(id: string, userId: string) {
    await this.owned(id, userId);

    await this.prisma.look.delete({
      where: { id },
    });

    return { success: true, message: "Look deleted successfully" };
  }
}
