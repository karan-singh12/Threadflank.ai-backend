import { buildInvoice, invoiceNumber } from './brand-billing.service';
import { createSandboxOrder, isSandboxId, razorpayConfig, sandboxPaymentId } from '../../User-panel/payments/razorpay';

const paid = new Date('2026-11-20T10:00:00Z');
const row = (over: Partial<Parameters<typeof buildInvoice>[0]> = {}) => ({
  id: 'cmabcdef1234wxyz5678',
  packId: 'plan_growth',
  credits: 100,
  amount: 99_900,
  currency: 'INR',
  couponCode: null,
  providerOrderId: 'order_123',
  providerPaymentId: 'pay_123',
  paidAt: paid,
  createdAt: paid,
  brand: { name: 'Raw Mango', gstin: '27AAPFU0939F1ZV', gstVerifiedAt: paid },
  ...over,
});

describe('invoices', () => {
  it('numbers by paid month and the end of the row id', () => {
    expect(invoiceNumber(row())).toBe('TF-202611-WXYZ5678');
  });

  it('works the 18% GST back out of a GST-inclusive price, to the paisa', () => {
    const inv = buildInvoice(row());
    expect(inv.amounts.total).toBe(999);
    expect(inv.amounts.taxable).toBe(846.61);
    // Another state's GSTIN (27 = Maharashtra) is shown as IGST.
    expect(inv.amounts).toMatchObject({ igst: 152.39 });
    expect(inv.line.description).toContain('Growth plan');
  });

  it('splits into CGST and SGST for a buyer in the seller state, and the halves add up', () => {
    const inv = buildInvoice(row({ brand: { name: 'Jaipur Co', gstin: '08AAPFU0939F1ZV', gstVerifiedAt: null } }));
    const a = inv.amounts as { cgst: number; sgst: number; taxable: number; total: number };
    expect(Math.round((a.cgst + a.sgst + a.taxable) * 100)).toBe(a.total * 100);
    expect(inv.buyer.gstVerified).toBe(false);
  });

  it('marks a sandbox purchase', () => {
    expect(buildInvoice(row({ providerOrderId: 'sandbox_order_abc' })).sandbox).toBe(true);
    expect(buildInvoice(row()).sandbox).toBe(false);
  });
});

describe('payment sandbox', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const set = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it('is on without keys outside production', () => {
    set({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, PAYMENTS_SANDBOX: undefined, NODE_ENV: 'development' });
    expect(razorpayConfig()).toMatchObject({ enabled: false, sandbox: true, open: true, mode: 'sandbox' });
  });

  it('stays off in production unless asked for', () => {
    set({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, PAYMENTS_SANDBOX: undefined, NODE_ENV: 'production' });
    expect(razorpayConfig()).toMatchObject({ sandbox: false, open: false, mode: null });
    set({ PAYMENTS_SANDBOX: 'true' });
    expect(razorpayConfig().sandbox).toBe(true);
  });

  it('can be switched off, and real keys always win', () => {
    set({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, PAYMENTS_SANDBOX: 'false', NODE_ENV: 'development' });
    expect(razorpayConfig().open).toBe(false);
    set({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'secret', PAYMENTS_SANDBOX: 'true' });
    expect(razorpayConfig()).toMatchObject({ enabled: true, sandbox: false, mode: 'test' });
  });

  it('makes ids that can never be mistaken for Razorpay ones', () => {
    const order = createSandboxOrder(49_900);
    expect(isSandboxId(order.id)).toBe(true);
    expect(order.amount).toBe(49_900);
    expect(isSandboxId(sandboxPaymentId())).toBe(true);
    expect(isSandboxId('order_Nx8a')).toBe(false);
  });
});
