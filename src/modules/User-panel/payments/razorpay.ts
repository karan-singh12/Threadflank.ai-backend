import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Minimal Razorpay client: Orders API plus signature checks, over plain HTTPS.
 *
 * Configured from the environment:
 *   RAZORPAY_KEY_ID          rzp_test_… or rzp_live_… (also sent to the browser for Checkout)
 *   RAZORPAY_KEY_SECRET      signs API calls and Checkout responses
 *   RAZORPAY_WEBHOOK_SECRET  the secret entered when adding the webhook in the Razorpay dashboard
 *   PAYMENTS_SANDBOX         "true" / "false". See `sandboxAllowed`.
 *
 * Until the keys are set, payments run in sandbox mode (outside production): orders are made
 * locally, the panels show a test checkout instead of Razorpay, and paying there grants the
 * credits or plan without moving any money. Setting the keys switches sandbox off by itself,
 * and any sandbox order still open at that point can no longer be confirmed.
 */
const API = 'https://api.razorpay.com/v1';

/** Order and payment ids made in sandbox mode start with this, so they can never be mistaken for Razorpay's. */
export const SANDBOX_PREFIX = 'sandbox_';

/**
 * Sandbox needs an explicit PAYMENTS_SANDBOX=true in production, so a live server missing its keys
 * never hands out free credits. Elsewhere it is on unless PAYMENTS_SANDBOX=false.
 */
function sandboxAllowed() {
    const flag = process.env.PAYMENTS_SANDBOX?.trim().toLowerCase();
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return process.env.NODE_ENV !== 'production';
}

export type PaymentsMode = 'live' | 'test' | 'sandbox' | null;

export function razorpayConfig() {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
    const enabled = Boolean(keyId && keySecret);
    const sandbox = !enabled && sandboxAllowed();
    const mode: PaymentsMode = enabled ? (keyId.startsWith('rzp_live_') ? 'live' : 'test') : sandbox ? 'sandbox' : null;
    return {
        keyId,
        keySecret,
        webhookSecret,
        /** Real Razorpay is configured. */
        enabled,
        /** No keys, and test checkout is allowed instead. */
        sandbox,
        /** Something can be bought: real Razorpay or the sandbox. What the panels call `paymentsEnabled`. */
        open: enabled || sandbox,
        mode,
    };
}

export const isSandboxId = (id: string) => id.startsWith(SANDBOX_PREFIX);

/** A local stand-in for a Razorpay order, used in sandbox mode. Same shape as the real thing. */
export function createSandboxOrder(amount: number, currency = 'INR'): RazorpayOrder {
    return { id: `${SANDBOX_PREFIX}order_${randomBytes(9).toString('hex')}`, amount, currency, status: 'created' };
}

/** The payment id recorded when a sandbox order is paid. Made on the server, never taken from the browser. */
export const sandboxPaymentId = () => `${SANDBOX_PREFIX}pay_${randomBytes(9).toString('hex')}`;

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string };

export async function createRazorpayOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
}): Promise<RazorpayOrder> {
    const { keyId, keySecret } = razorpayConfig();
    const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(body?.error?.description || `Razorpay order failed (HTTP ${res.status})`);
    return body as RazorpayOrder;
}

/** Constant-time check of a hex HMAC-SHA256 signature. */
function signatureMatches(secret: string, payload: string | Buffer, signature: string) {
    if (!secret || !signature) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The signature Checkout returns: HMAC(order_id|payment_id) with the key secret. */
export function checkoutSignatureValid(orderId: string, paymentId: string, signature: string) {
    return signatureMatches(razorpayConfig().keySecret, `${orderId}|${paymentId}`, signature);
}

/** The X-Razorpay-Signature header: HMAC of the raw request body with the webhook secret. */
export function webhookSignatureValid(rawBody: Buffer, signature: string) {
    return signatureMatches(razorpayConfig().webhookSecret, rawBody, signature);
}
