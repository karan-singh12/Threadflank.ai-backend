import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Minimal Razorpay client: Orders API plus signature checks, over plain HTTPS.
 *
 * Configured from the environment; payments stay switched off until the keys are set:
 *   RAZORPAY_KEY_ID          rzp_test_… or rzp_live_… (also sent to the browser for Checkout)
 *   RAZORPAY_KEY_SECRET      signs API calls and Checkout responses
 *   RAZORPAY_WEBHOOK_SECRET  the secret entered when adding the webhook in the Razorpay dashboard
 */
const API = 'https://api.razorpay.com/v1';

export function razorpayConfig() {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
    return {
        keyId,
        keySecret,
        webhookSecret,
        enabled: Boolean(keyId && keySecret),
        mode: keyId.startsWith('rzp_live_') ? ('live' as const) : keyId ? ('test' as const) : null,
    };
}

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
