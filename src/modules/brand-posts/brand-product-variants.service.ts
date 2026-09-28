import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandAccessService } from '../brands/brand-access.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

export interface VariantInput {
  productName?: string;
  size?: string;
  color?: string;
  colorHex?: string | null;
  price?: number | null;
  inStock?: boolean;
  stockCount?: number | null;
  productUrl?: string | null;
  imageUrl?: string | null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const whole = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Numbers must be zero or more');
  return n;
};

/**
 * Size/colour/stock rows for the products tagged in a brand post, so the
 * Discover feed can show real availability next to "Try on your twin".
 */
@Injectable()
export class BrandProductVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
    private readonly audit: AuditLogService,
  ) {}

  private async post(postId: string, admin: AuthenticatedAdmin) {
    const post = await this.prisma.brandPost.findFirst({ where: { id: postId, isDeleted: false } });
    if (!post) throw new NotFoundException('Brand post not found');
    await this.brandAccess.assertAccess(admin, post.brandId);
    return post;
  }

  private data(input: VariantInput, partial: boolean) {
    const productName = text(input.productName, 120);
    const size = text(input.size, 20);
    const color = text(input.color, 40);
    if (!partial && (!productName || !size || !color)) throw new BadRequestException('Product name, size and colour are required');
    const stockCount = input.stockCount !== undefined ? whole(input.stockCount) : undefined;
    return {
      ...(productName ? { productName } : {}),
      ...(size ? { size } : {}),
      ...(color ? { color } : {}),
      ...(input.colorHex !== undefined ? { colorHex: text(input.colorHex, 9) } : {}),
      ...(input.price !== undefined ? { price: whole(input.price) } : {}),
      ...(stockCount !== undefined ? { stockCount } : {}),
      // A stock count of 0 always means out of stock.
      ...(input.inStock !== undefined || stockCount !== undefined ? { inStock: stockCount === 0 ? false : input.inStock ?? true } : {}),
      ...(input.productUrl !== undefined ? { productUrl: text(input.productUrl, 500) } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: text(input.imageUrl, 500) } : {}),
    };
  }

  async list(postId: string, admin: AuthenticatedAdmin) {
    await this.post(postId, admin);
    return this.prisma.brandProductVariant.findMany({ where: { brandPostId: postId }, orderBy: [{ productName: 'asc' }, { createdAt: 'asc' }] });
  }

  async create(postId: string, input: VariantInput, admin: AuthenticatedAdmin) {
    await this.post(postId, admin);
    const created = await this.prisma.brandProductVariant.create({ data: { brandPostId: postId, ...(this.data(input, false) as any) } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'PRODUCT_VARIANT_CREATED', entityType: 'BrandProductVariant', entityId: created.id, metadata: { postId } });
    return created;
  }

  private async variant(id: string, admin: AuthenticatedAdmin) {
    const v = await this.prisma.brandProductVariant.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Variant not found');
    await this.post(v.brandPostId, admin);
    return v;
  }

  async update(id: string, input: VariantInput, admin: AuthenticatedAdmin) {
    await this.variant(id, admin);
    const updated = await this.prisma.brandProductVariant.update({ where: { id }, data: this.data(input, true) });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'PRODUCT_VARIANT_UPDATED', entityType: 'BrandProductVariant', entityId: id, metadata: { changes: input as any } });
    return updated;
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    await this.variant(id, admin);
    await this.prisma.brandProductVariant.delete({ where: { id } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'PRODUCT_VARIANT_DELETED', entityType: 'BrandProductVariant', entityId: id });
    return { deleted: true };
  }
}
