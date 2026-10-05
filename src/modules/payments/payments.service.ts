import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { CreditsService } from './credits.service';
import { checkoutSignatureValid, createRazorpayOrder, razorpayConfig, webhookSignatureValid } from './razorpay';
import { AdjustCreditsDto, CreditPackDto, PaymentsFilterDto, UpdateBillingSettingsDto, VerifyPaymentDto } from './dto/billing.dto';

/** Where the Razorpay dashboard should send webhooks (behind the API's /api prefix). */
export const WEBHOOK_PATH = '/api/billing/razorpay/webhook';

const toPublicPack = (p: { id: string; name: string; description: string | null; pricePaise: number; credits: number; isFeatured: boolean }) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.pricePaise / 100,
    credits: p.credits,
    featured: p.isFeatured,
});

/**
 * Buying credit packs with Razorpay: the server creates an order, the browser pays it in
 * Razorpay Checkout, and the order is credited once — by the Checkout callback (verified
 * signature) or by the `payment.captured` / `order.paid` webhook, whichever arrives first.
 */
@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly credits: CreditsService,
        private readonly audit: AuditLogService,
    ) {}

    // ── Public / user ────────────────────────────────────────────────────────

    /** The pricing page: free credits and the active packs. */
    async catalogue() {
        const [settings, packs] = await Promise.all([
            this.credits.settings(),
            this.prisma.creditPack.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { pricePaise: 'asc' }] }),
        ]);
        return {
            paymentsEnabled: razorpayConfig().enabled,
            currency: settings.currency,
            freeCredits: settings.freeCredits,
            videoCost: settings.videoCost,
            packs: packs.map(toPublicPack),
        };
    }

    async wallet(userId: string) {
        const [balance, settings] = await Promise.all([this.credits.balance(userId), this.credits.settings()]);
        return {
            balance,
            freeCredits: settings.freeCredits,
            imageCost: 1,
            videoCost: settings.videoCost,
            paymentsEnabled: razorpayConfig().enabled,
        };
    }

    async createOrder(userId: string, packId: string) {
        const config = razorpayConfig();
        if (!config.enabled) throw new ServiceUnavailableException('Payments are not available yet. Please check back soon.');
        const pack = await this.prisma.creditPack.findFirst({ where: { id: packId, isActive: true } });
        if (!pack) throw new NotFoundException('That credit pack is no longer available.');

        let order;
        try {
            order = await createRazorpayOrder({
                amount: pack.pricePaise,
                currency: 'INR',
                // Razorpay caps receipts at 40 characters.
                receipt: `tf_${Date.now().toString(36)}_${userId.slice(-10)}`,
                notes: { userId, packId: pack.id, credits: String(pack.credits) },
            });
        } catch (err) {
            this.logger.error(`Razorpay order failed: ${err}`);
            throw new BadGatewayException('Couldn’t start the payment. Please try again.');
        }

        await this.prisma.payment.create({
            data: { userId, packId: pack.id, credits: pack.credits, amount: order.amount, currency: order.currency, providerOrderId: order.id },
        });
        return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.keyId, pack: toPublicPack(pack) };
    }

    /** Checkout's success callback. Credits the order (once) and returns the new balance. */
    async verifyCheckout(userId: string, dto: VerifyPaymentDto) {
        if (!checkoutSignatureValid(dto.orderId, dto.paymentId, dto.signature)) throw new BadRequestException('The payment couldn’t be verified.');
        const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: dto.orderId } });
        if (!payment || payment.userId !== userId) throw new NotFoundException('Payment not found.');
        await this.markPaid(dto.orderId, dto.paymentId);
        return { balance: await this.credits.balance(userId), credits: payment.credits };
    }

    async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
        if (!razorpayConfig().webhookSecret) throw new ServiceUnavailableException('Webhook secret is not configured.');
        if (!rawBody || !signature || !webhookSignatureValid(rawBody, signature)) throw new UnauthorizedException('Invalid webhook signature.');

        const event = JSON.parse(rawBody.toString('utf8'));
        const payment = event?.payload?.payment?.entity;
        const orderId: string | undefined = payment?.order_id ?? event?.payload?.order?.entity?.id;
        if (!orderId) return { received: true };

        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            const known = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
            if (!known) return { received: true }; // not one of our orders
            if (payment?.amount && payment.amount !== known.amount) {
                this.logger.error(`Amount mismatch on ${orderId}: paid ${payment.amount}, expected ${known.amount}`);
                return { received: true };
            }
            await this.markPaid(orderId, payment?.id ?? null);
        } else if (event.event === 'payment.failed') {
            await this.prisma.payment.updateMany({
                where: { providerOrderId: orderId, status: PaymentStatus.CREATED },
                data: { status: PaymentStatus.FAILED, failureReason: payment?.error_description ?? 'Payment failed', providerPaymentId: payment?.id ?? undefined },
            });
        }
        return { received: true };
    }

    /** Marks the order paid and grants its credits. Safe to call more than once: only the first call credits. */
    private markPaid(orderId: string, paymentId: string | null) {
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.payment.updateMany({
                where: { providerOrderId: orderId, status: { not: PaymentStatus.PAID } },
                data: { status: PaymentStatus.PAID, paidAt: new Date(), failureReason: null, ...(paymentId ? { providerPaymentId: paymentId } : {}) },
            });
            const payment = await tx.payment.findUnique({ where: { providerOrderId: orderId } });
            if (payment && updated.count) {
                await this.credits.grant(payment.userId, payment.credits, 'PURCHASE', { refId: payment.id, tx });
            }
            return payment;
        });
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    async adminOverview() {
        const config = razorpayConfig();
        const [settings, revenue, paidCount, pending] = await Promise.all([
            this.credits.settings(),
            this.prisma.payment.aggregate({ where: { status: PaymentStatus.PAID }, _sum: { amount: true, credits: true } }),
            this.prisma.payment.count({ where: { status: PaymentStatus.PAID } }),
            this.prisma.payment.count({ where: { status: PaymentStatus.CREATED } }),
        ]);
        return {
            settings,
            razorpay: { keyConfigured: config.enabled, webhookConfigured: Boolean(config.webhookSecret), mode: config.mode, webhookPath: WEBHOOK_PATH },
            stats: { revenue: (revenue._sum.amount ?? 0) / 100, creditsSold: revenue._sum.credits ?? 0, paidCount, pending },
        };
    }

    async updateSettings(dto: UpdateBillingSettingsDto, adminUserId: string) {
        const settings = await this.credits.updateSettings(dto);
        await this.audit.log({ adminUserId, action: 'BILLING_SETTINGS_UPDATED', entityType: 'BillingSettings', entityId: 'default', metadata: { ...dto } });
        return settings;
    }

    listPacks() {
        return this.prisma.creditPack.findMany({ orderBy: [{ order: 'asc' }, { pricePaise: 'asc' }] });
    }

    async createPack(dto: CreditPackDto, adminUserId: string) {
        const pack = await this.prisma.creditPack.create({ data: this.packData(dto) as Prisma.CreditPackCreateInput });
        await this.audit.log({ adminUserId, action: 'CREDIT_PACK_CREATED', entityType: 'CreditPack', entityId: pack.id, metadata: { ...dto } });
        return pack;
    }

    async updatePack(id: string, dto: Partial<CreditPackDto>, adminUserId: string) {
        await this.findPack(id);
        const pack = await this.prisma.creditPack.update({ where: { id }, data: this.packData(dto) });
        await this.audit.log({ adminUserId, action: 'CREDIT_PACK_UPDATED', entityType: 'CreditPack', entityId: id, metadata: { ...dto } });
        return pack;
    }

    async deletePack(id: string, adminUserId: string) {
        await this.findPack(id);
        // Packs with purchases are kept for the records and just hidden.
        const used = await this.prisma.payment.count({ where: { packId: id } });
        if (used) await this.prisma.creditPack.update({ where: { id }, data: { isActive: false } });
        else await this.prisma.creditPack.delete({ where: { id } });
        await this.audit.log({ adminUserId, action: used ? 'CREDIT_PACK_HIDDEN' : 'CREDIT_PACK_DELETED', entityType: 'CreditPack', entityId: id });
        return { deleted: !used, hidden: Boolean(used) };
    }

    async listPayments(filter: PaymentsFilterDto) {
        const page = filter.page ?? 1;
        const limit = Math.min(filter.limit ?? 20, 100);
        let userIds: string[] | undefined;
        if (filter.search?.trim()) {
            const users = await this.prisma.user.findMany({
                where: { OR: [{ email: { contains: filter.search.trim(), mode: 'insensitive' } }, { username: { contains: filter.search.trim(), mode: 'insensitive' } }] },
                select: { id: true },
                take: 200,
            });
            userIds = users.map((u) => u.id);
        }
        const where: Prisma.PaymentWhereInput = {
            ...(filter.status ? { status: filter.status } : {}),
            ...(userIds ? { userId: { in: userIds } } : {}),
        };
        const [rows, total] = await Promise.all([
            this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { pack: { select: { name: true } } } }),
            this.prisma.payment.count({ where }),
        ]);
        const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, email: true, username: true } });
        const byId = new Map(users.map((u) => [u.id, u]));
        return {
            payments: rows.map((r) => ({ ...r, amount: r.amount / 100, packName: r.pack?.name ?? null, user: byId.get(r.userId) ?? null })),
            meta: buildPaginationMeta(total, page, limit),
        };
    }

    /** Adds (positive) or removes (negative) credits for a user, found by email. */
    async adjustCredits(dto: AdjustCreditsDto, adminUserId: string) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, select: { id: true, email: true } });
        if (!user) throw new NotFoundException('No user with that email.');
        const note = dto.note?.trim() || 'Adjusted by admin';
        const balance =
            dto.delta > 0
                ? await this.credits.grant(user.id, dto.delta, 'ADMIN', { note })
                : await this.credits.spend(user.id, -dto.delta, 'ADMIN').catch(() => {
                      throw new BadRequestException('The user doesn’t have that many credits.');
                  });
        await this.audit.log({ adminUserId, action: 'CREDITS_ADJUSTED', entityType: 'User', entityId: user.id, metadata: { delta: dto.delta, note } });
        return { email: user.email, balance };
    }

    private async findPack(id: string) {
        const pack = await this.prisma.creditPack.findUnique({ where: { id } });
        if (!pack) throw new NotFoundException('Credit pack not found');
        return pack;
    }

    private packData(dto: Partial<CreditPackDto>): Prisma.CreditPackUpdateInput {
        return {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
            ...(dto.price !== undefined ? { pricePaise: Math.round(dto.price * 100) } : {}),
            ...(dto.credits !== undefined ? { credits: dto.credits } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
            ...(dto.order !== undefined ? { order: dto.order } : {}),
        };
    }
}
