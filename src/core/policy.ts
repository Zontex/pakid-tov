import { z } from 'zod';
import { Agorot, type Card, type Due, type Payee, type Slip, formatIls } from './models.ts';

export const PolicyConfig = z.object({
  /** What happens when no rule allows auto: ask on the phone, or hand the card step to the user. */
  mode: z.enum(['approve', 'auto', 'handoff']).default('approve'),
  auto: z
    .object({
      /** Payee ids allowed to pay without a tap. Empty = none, unless mode is "auto". */
      payees: z.array(z.string()).default([]),
      maxPerBillAgorot: Agorot.default(150_000),
      maxPerMonthAgorot: Agorot.default(400_000),
      /** Allowed gap between the slip amount and the biller's system amount, in percent. */
      slipTolerancePercent: z.number().min(0).max(100).default(2),
    })
    .default({ payees: [], maxPerBillAgorot: 150_000, maxPerMonthAgorot: 400_000, slipTolerancePercent: 2 }),
});
export type PolicyConfig = z.infer<typeof PolicyConfig>;

export type Decision =
  | { action: 'auto'; reasons: string[] }
  | { action: 'approve'; reasons: string[] }
  | { action: 'handoff'; reasons: string[] }
  | { action: 'refuse'; reasons: string[] };

export interface DecisionInput {
  config: PolicyConfig;
  payee: Payee;
  due: Due;
  slip?: Slip;
  card?: Card;
  /** Paid so far this calendar month, all payees. */
  monthSpentAgorot: number;
  /** Same biller + reference already paid. */
  alreadyPaid: boolean;
}

export function decide(input: DecisionInput): Decision {
  const { config, payee, due, slip, card, monthSpentAgorot, alreadyPaid } = input;

  if (alreadyPaid) return { action: 'refuse', reasons: ['This bill was already paid.'] };
  if (due.amountAgorot === 0) return { action: 'refuse', reasons: ['Nothing is due.'] };

  const reasons: string[] = [];
  let canAuto = true;

  if (slip?.amountAgorot !== undefined) {
    const gap = Math.abs(due.amountAgorot - slip.amountAgorot);
    const limit = (slip.amountAgorot * config.auto.slipTolerancePercent) / 100;
    if (gap > limit) {
      canAuto = false;
      reasons.push(
        `The biller's system says ${formatIls(due.amountAgorot)}, the slip says ${formatIls(slip.amountAgorot)}.`,
      );
    }
  }

  if (config.mode === 'handoff' || !card) {
    return { action: 'handoff', reasons: [...reasons, card ? 'Hand-off mode is on.' : 'No stored card for this payee.'] };
  }

  if (card.kind === 'personal') {
    return { action: 'approve', reasons: [...reasons, 'Personal cards always need your approval.'] };
  }

  const allowedPayee = config.mode === 'auto' || config.auto.payees.includes(payee.id);
  if (!allowedPayee) {
    canAuto = false;
    reasons.push('This payee is not on the auto-pay list.');
  }
  if (due.amountAgorot > config.auto.maxPerBillAgorot) {
    canAuto = false;
    reasons.push(`Above the per-bill limit of ${formatIls(config.auto.maxPerBillAgorot)}.`);
  }
  if (monthSpentAgorot + due.amountAgorot > config.auto.maxPerMonthAgorot) {
    canAuto = false;
    reasons.push(`Would pass the monthly limit of ${formatIls(config.auto.maxPerMonthAgorot)}.`);
  }

  return canAuto ? { action: 'auto', reasons: ['Within your auto-pay rules.'] } : { action: 'approve', reasons };
}
