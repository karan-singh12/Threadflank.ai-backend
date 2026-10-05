import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BillingSettings, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Why a balance changed, stored on each CreditTransaction. */
export type CreditReason = 'FREE' | 'PURCHASE' | 'DRAPE' | 'LOOK_EDIT' | 'VIDEO' | 'REFUND' | 'ADMIN';

/** Packs created the first time the table is empty; prices and credits are edited in the admin panel. */
const DEFAULT_PACKS: Prisma.CreditPackCreateManyInput[] = [
    { name: 'Starter', description: '15 AI looks', pricePaise: 4900, credits: 15, order: 0 },
    { name: 'Creator', description: '100 AI looks — best value', pricePaise: 29900, credits: 100, order: 1, isFeatured: true },
];

/** 402 with the balance, so the app can offer a credit pack. */
export class OutOfCreditsException extends HttpException {
    constructor(balance: number, needed: number) {
        super(
            {
                message: `This needs ${needed} credit${needed === 1 ? '' : 's'} and you have ${balance}. Buy a credit pack to keep creating.`,
                error: 'OUT_OF_CREDITS',
                balance,
                needed,
            },
            HttpStatus.PAYMENT_REQUIRED,
        );
    }
}

type Tx = Prisma.TransactionClient;

/**
 * Image credits. Every generated image costs 1 credit (a motion video costs the admin-set
 * amount); every account gets the free credits once, the first time its balance is read.
 * The balance lives on User.creditBalance and every change is logged as a CreditTransaction.
 */
@Injectable()
export class CreditsService implements OnModuleInit {
    private readonly logger = new Logger(CreditsService.name);

    constructor(private readonly prisma: PrismaService) {}

    async onModuleInit() {
        try {
            if ((await this.prisma.creditPack.count()) === 0) {
                await this.prisma.creditPack.createMany({ data: DEFAULT_PACKS });
                this.logger.log('Created the default credit packs');
            }
        } catch (err) {
            // The tables don't exist until the schema is pushed; billing just stays empty until then.
            this.logger.warn(`Credit packs not seeded: ${err instanceof Error ? err.message : err}`);
        }
    }

    settings(): Promise<BillingSettings> {
        return this.prisma.billingSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    }

    updateSettings(input: { freeCredits?: number; videoCost?: number }) {
        return this.prisma.billingSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...input }, update: input });
    }

    /** The current balance, after granting the free credits if this account hasn't had them yet. */
    async balance(userId: string): Promise<number> {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true, freeCreditsGrantedAt: true } });
        if (!user) throw new NotFoundException('User not found');
        if (user.freeCreditsGrantedAt) return user.creditBalance;

        const { freeCredits } = await this.settings();
        return this.prisma.$transaction(async (tx) => {
            // The condition makes this run once even if two requests race here.
            const granted = await tx.user.updateMany({
                where: { id: userId, freeCreditsGrantedAt: null },
                data: { creditBalance: { increment: freeCredits }, freeCreditsGrantedAt: new Date() },
            });
            const after = await this.currentBalance(tx, userId);
            if (granted.count && freeCredits > 0) {
                await tx.creditTransaction.create({ data: { userId, delta: freeCredits, balanceAfter: after, reason: 'FREE' } });
            }
            return after;
        });
    }

    /** Takes `cost` credits, or throws OutOfCreditsException without changing anything. Returns the new balance. */
    async spend(userId: string, cost: number, reason: CreditReason, refId?: string): Promise<number> {
        const balance = await this.balance(userId);
        if (cost <= 0) return balance;
        return this.prisma.$transaction(async (tx) => {
            const taken = await tx.user.updateMany({
                where: { id: userId, creditBalance: { gte: cost } },
                data: { creditBalance: { decrement: cost } },
            });
            const after = await this.currentBalance(tx, userId);
            if (!taken.count) throw new OutOfCreditsException(after, cost);
            await tx.creditTransaction.create({ data: { userId, delta: -cost, balanceAfter: after, reason, refId } });
            return after;
        });
    }

    /** Adds credits (purchases, refunds, admin grants). Pass `tx` to join an existing transaction. */
    async grant(userId: string, amount: number, reason: CreditReason, opts: { refId?: string; note?: string; tx?: Tx } = {}): Promise<number> {
        if (amount <= 0) return this.balance(userId);
        const run = async (tx: Tx) => {
            await tx.user.update({ where: { id: userId }, data: { creditBalance: { increment: amount } } });
            const after = await this.currentBalance(tx, userId);
            await tx.creditTransaction.create({ data: { userId, delta: amount, balanceAfter: after, reason, refId: opts.refId, note: opts.note } });
            return after;
        };
        return opts.tx ? run(opts.tx) : this.prisma.$transaction(run);
    }

    /** Spends `cost`, runs `work`, and refunds the credits if `work` fails. */
    async charge<T>(userId: string, cost: number, reason: CreditReason, work: () => Promise<T>): Promise<T> {
        await this.spend(userId, cost, reason);
        try {
            return await work();
        } catch (err) {
            await this.refund(userId, cost, `${reason} failed`);
            throw err;
        }
    }

    /** Gives credits back for renders that failed. Never throws: a refund must not mask the original error. */
    async refund(userId: string, amount: number, note: string) {
        try {
            await this.grant(userId, amount, 'REFUND', { note });
        } catch (err) {
            this.logger.error(`Refund of ${amount} credits to ${userId} failed: ${err}`);
        }
    }

    /** Recent balance changes, newest first. */
    history(userId: string, take = 30) {
        return this.prisma.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
    }

    private async currentBalance(tx: Tx, userId: string) {
        const row = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { creditBalance: true } });
        return row.creditBalance;
    }
}
