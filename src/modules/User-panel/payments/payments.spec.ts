import 'reflect-metadata';
import { createHmac } from 'crypto';
import { CreditsService, OutOfCreditsException } from './credits.service';
import { PaymentsService } from './payments.service';
import { checkoutSignatureValid, webhookSignatureValid } from './razorpay';

/** Just enough of Prisma, in memory, for the credit and payment flows. */
function fakePrisma() {
    const users = new Map<string, { id: string; email: string; creditBalance: number; freeCreditsGrantedAt: Date | null }>();
    const transactions: any[] = [];
    const payments = new Map<string, any>();
    const settings = { id: 'default', freeCredits: 3, videoCost: 5, currency: 'INR' };
    const db: any = {
        users,
        transactions,
        payments,
        user: {
            findUnique: async ({ where }: any) => users.get(where.id) ?? [...users.values()].find((u) => u.email === where.email) ?? null,
            findUniqueOrThrow: async ({ where }: any) => users.get(where.id)!,
            updateMany: async ({ where, data }: any) => {
                const u = users.get(where.id);
                if (!u) return { count: 0 };
                if ('freeCreditsGrantedAt' in where && u.freeCreditsGrantedAt !== where.freeCreditsGrantedAt) return { count: 0 };
                if (where.creditBalance?.gte !== undefined && u.creditBalance < where.creditBalance.gte) return { count: 0 };
                if (data.creditBalance?.increment) u.creditBalance += data.creditBalance.increment;
                if (data.creditBalance?.decrement) u.creditBalance -= data.creditBalance.decrement;
                if (data.freeCreditsGrantedAt) u.freeCreditsGrantedAt = data.freeCreditsGrantedAt;
                return { count: 1 };
            },
            update: async ({ where, data }: any) => {
                const u = users.get(where.id)!;
                u.creditBalance += data.creditBalance.increment;
                return u;
            },
        },
        creditTransaction: {
            create: async ({ data }: any) => transactions.push(data),
            findMany: async () => [...transactions].reverse(),
        },
        billingSettings: { upsert: async () => settings },
        payment: {
            findUnique: async ({ where }: any) => payments.get(where.providerOrderId) ?? null,
            create: async ({ data }: any) => payments.set(data.providerOrderId, { id: `pay_${payments.size}`, status: 'CREATED', ...data }),
            updateMany: async ({ where, data }: any) => {
                const p = payments.get(where.providerOrderId);
                if (!p) return { count: 0 };
                if (where.status?.not && p.status === where.status.not) return { count: 0 };
                if (typeof where.status === 'string' && p.status !== where.status) return { count: 0 };
                Object.assign(p, data);
                return { count: 1 };
            },
        },
        $transaction: async (work: any) => work(db),
    };
    return db;
}

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

describe('payments', () => {
    beforeEach(() => {
        process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
        process.env.RAZORPAY_KEY_SECRET = 'key-secret';
        process.env.RAZORPAY_WEBHOOK_SECRET = 'hook-secret';
    });

    describe('signatures', () => {
        it('accepts only the Checkout signature made with the key secret', () => {
            expect(checkoutSignatureValid('order_1', 'pay_1', sign('key-secret', 'order_1|pay_1'))).toBe(true);
            expect(checkoutSignatureValid('order_1', 'pay_2', sign('key-secret', 'order_1|pay_1'))).toBe(false);
            expect(checkoutSignatureValid('order_1', 'pay_1', 'nonsense')).toBe(false);
        });

        it('checks webhooks against the raw body', () => {
            const body = '{"event":"payment.captured"}';
            expect(webhookSignatureValid(Buffer.from(body), sign('hook-secret', body))).toBe(true);
            expect(webhookSignatureValid(Buffer.from(body + ' '), sign('hook-secret', body))).toBe(false);
        });
    });

    describe('credits', () => {
        it('grants the free credits once, spends, refuses when short, and refunds failed work', async () => {
            const db = fakePrisma();
            db.users.set('u1', { id: 'u1', email: 'a@x.com', creditBalance: 0, freeCreditsGrantedAt: null });
            const credits = new CreditsService(db);

            expect(await credits.balance('u1')).toBe(3);
            expect(await credits.balance('u1')).toBe(3); // not granted twice
            expect(await credits.spend('u1', 2, 'DRAPE')).toBe(1);
            await expect(credits.spend('u1', 2, 'DRAPE')).rejects.toBeInstanceOf(OutOfCreditsException);
            expect(await credits.balance('u1')).toBe(1);

            await expect(credits.charge('u1', 1, 'DRAPE', async () => Promise.reject(new Error('render failed')))).rejects.toThrow('render failed');
            expect(await credits.balance('u1')).toBe(1);
            expect(db.transactions.map((t: any) => t.reason)).toEqual(['FREE', 'DRAPE', 'DRAPE', 'REFUND']);
        });
    });

    describe('webhook', () => {
        it('credits a captured order exactly once, even when the event repeats', async () => {
            const db = fakePrisma();
            db.users.set('u1', { id: 'u1', email: 'a@x.com', creditBalance: 0, freeCreditsGrantedAt: new Date() });
            await db.payment.create({ data: { userId: 'u1', packId: 'p1', credits: 15, amount: 4900, currency: 'INR', providerOrderId: 'order_1' } });
            const service = new PaymentsService(db, new CreditsService(db), { log: async () => undefined } as any);

            const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 4900 } } } });
            const signature = sign('hook-secret', body);
            await service.handleWebhook(Buffer.from(body), signature);
            await service.handleWebhook(Buffer.from(body), signature);

            expect(db.users.get('u1').creditBalance).toBe(15);
            expect(db.payments.get('order_1').status).toBe('PAID');
            await expect(service.handleWebhook(Buffer.from(body), 'bad')).rejects.toThrow('Invalid webhook signature');
        });

        it('ignores a capture whose amount differs from the order', async () => {
            const db = fakePrisma();
            db.users.set('u1', { id: 'u1', email: 'a@x.com', creditBalance: 0, freeCreditsGrantedAt: new Date() });
            await db.payment.create({ data: { userId: 'u1', packId: 'p1', credits: 100, amount: 29900, currency: 'INR', providerOrderId: 'order_2' } });
            const service = new PaymentsService(db, new CreditsService(db), { log: async () => undefined } as any);

            const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_2', amount: 100 } } } });
            await service.handleWebhook(Buffer.from(body), sign('hook-secret', body));
            expect(db.users.get('u1').creditBalance).toBe(0);
        });
    });
});
