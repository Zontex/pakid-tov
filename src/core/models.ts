import { z } from 'zod';

/** Money is always integer agorot (1 ILS = 100 agorot). Never floats. */
export const Agorot = z.number().int().nonnegative();

export const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Field values a biller asks for: payer number, voucher number, contract number... */
export const FieldValues = z.record(z.string(), z.string());

export const Slip = z.object({
  id: z.string(),
  source: z.object({
    kind: z.enum(['photo', 'pdf', 'email', 'manual']),
    file: z.string().optional(),
  }),
  billerId: z.string().optional(),
  fields: FieldValues,
  amountAgorot: Agorot.optional(),
  dueDate: ISODate.optional(),
  period: z.string().optional(),
  barcode: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  readAt: z.string(),
});
export type Slip = z.infer<typeof Slip>;

export const Payee = z.object({
  id: z.string(),
  billerId: z.string(),
  nickname: z.string(),
  fields: FieldValues,
  owner: z.enum(['personal', 'business']).default('personal'),
  cardHandle: z.string().optional(),
});
export type Payee = z.infer<typeof Payee>;

/** What the biller's own system says is due. This amount is the truth, not the slip. */
export const Due = z.object({
  billerId: z.string(),
  amountAgorot: Agorot,
  reference: z.string().optional(),
  payableUntil: ISODate.optional(),
  breakdown: z.array(z.object({ label: z.string(), amountAgorot: Agorot })).optional(),
  quotedAt: z.string(),
});
export type Due = z.infer<typeof Due>;

export const Receipt = z.object({
  id: z.string(),
  runId: z.string(),
  billerId: z.string(),
  payeeId: z.string(),
  amountAgorot: Agorot,
  reference: z.string().optional(),
  confirmation: z.string(),
  paidAt: z.string(),
  cardLast4: z.string().regex(/^\d{4}$/).optional(),
  files: z.object({ screenshot: z.string().optional(), pdf: z.string().optional() }),
});
export type Receipt = z.infer<typeof Receipt>;

/**
 * A stored card. Only the label, kind and last 4 digits live here; the number,
 * expiry, CVV and holder ID live in the vault under `handle`.
 */
export const Card = z.object({
  handle: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  label: z.string(),
  kind: z.enum(['prepaid', 'personal']),
  last4: z.string().regex(/^\d{4}$/),
});
export type Card = z.infer<typeof Card>;

export const CardSecret = z.object({
  number: z.string().regex(/^\d{12,19}$/),
  expMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
  expYear: z.string().regex(/^\d{2}$/),
  cvv: z.string().regex(/^\d{3,4}$/),
  holderId: z.string().regex(/^\d{5,9}$/).optional(),
});
export type CardSecret = z.infer<typeof CardSecret>;

export const RunStatus = z.enum([
  'quoting',
  'awaiting_approval',
  'paying',
  'handoff',
  'paid',
  'dry_run_done',
  'refused',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export function formatIls(agorot: number): string {
  const sign = agorot < 0 ? '-' : '';
  const abs = Math.abs(agorot);
  const shekels = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}${shekels}.${String(abs % 100).padStart(2, '0')} ILS`;
}

/** Parses "1,234.50" or "1234.5" into agorot without float rounding errors. */
export function parseIls(text: string): number {
  const clean = text.replace(/[^\d.]/g, '');
  const m = clean.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`Not an amount: "${text}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}
