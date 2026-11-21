import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PlatformAdapter } from './adapter.ts';
import type { Ledger } from './ledger.ts';
import { missingFields, type BillerManifest } from './manifest.ts';
import type { Card, Due, Payee, Receipt, RunStatus, Slip } from './models.ts';
import { decide, type Decision, type PolicyConfig } from './policy.ts';
import { launchBrowser, type BrowserOptions } from './runner/browser.ts';
import { DryRunStop, GuardedPage, PaymentDeclined } from './runner/guarded-page.ts';
import { getCardSecret, type Vault } from './vault/vault.ts';

export interface ApprovalRequest {
  payee: Payee;
  manifest: BillerManifest;
  due: Due;
  decision: Decision;
  card: Card;
  /** The biller's confirm page, card fields masked. */
  screenshot: string;
}

/** The person: a terminal prompt, the phone app or Telegram. */
export interface Human {
  approve(req: ApprovalRequest): Promise<boolean>;
  tell(message: string): void;
}

export interface EngineDeps {
  ledger: Ledger;
  vault: Vault;
  billers: Map<string, BillerManifest>;
  platforms: Map<string, PlatformAdapter>;
  policy: PolicyConfig;
  human: Human;
  dataDir: string;
  browser?: BrowserOptions;
}

export interface PayRequest {
  payeeId: string;
  /** Fields from this slip (voucher number), merged over the payee's saved fields. */
  slipFields?: Record<string, string>;
  slip?: Slip;
  dryRun?: boolean;
  /** Force a visible browser. Defaults to visible only for hand-off. */
  visible?: boolean;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  due?: Due;
  decision?: Decision;
  receipt?: Receipt;
  screenshot?: string;
  message: string;
}

export class MissingFieldsError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Missing or invalid: ${fields.join(', ')}`);
    this.fields = fields;
  }
}

export async function payBill(deps: EngineDeps, req: PayRequest): Promise<RunResult> {
  const payee = deps.ledger.getPayee(req.payeeId);
  if (!payee) throw new Error(`No payee "${req.payeeId}".`);
  const manifest = deps.billers.get(payee.billerId);
  if (!manifest) throw new Error(`No biller "${payee.billerId}" installed.`);
  const adapter = deps.platforms.get(manifest.platform);
  if (!adapter) throw new Error(`No platform adapter "${manifest.platform}" for ${manifest.id}.`);

  const fields = { ...payee.fields, ...req.slipFields };
  const missing = missingFields(manifest, fields);
  if (missing.length) throw new MissingFieldsError(missing);

  const card = payee.cardHandle ? deps.ledger.getCard(payee.cardHandle) : undefined;
  const handoffLikely = !card || deps.policy.mode === 'handoff';

  const runId = randomUUID();
  const artifactsDir = join(deps.dataDir, 'runs', runId);
  deps.ledger.startRun(runId, payee.id, 'quoting');

  const { browser, context } = await launchBrowser({
    ...deps.browser,
    visible: req.visible ?? (handoffLikely && !req.dryRun),
  });
  const page = new GuardedPage(await context.newPage(), manifest, {
    dryRun: !!req.dryRun,
    artifactsDir,
    tell: (m) => deps.human.tell(m),
  });

  const finish = (status: RunStatus, message: string, extra: Partial<RunResult> = {}): RunResult => {
    deps.ledger.updateRun(runId, status, message);
    return { runId, status, message, ...extra };
  };

  let due: Due | undefined;
  let decision: Decision | undefined;
  try {
    due = await adapter.quote({ page, manifest, fields });
    decision = decide({
      config: deps.policy,
      payee,
      due,
      ...(req.slip ? { slip: req.slip } : {}),
      ...(card ? { card } : {}),
      monthSpentAgorot: deps.ledger.monthSpent(),
      alreadyPaid: deps.ledger.isPaid(manifest.id, due.reference),
    });
    if (decision.action === 'refuse') return finish('refused', decision.reasons.join(' '), { due, decision });

    let method: 'card' | 'handoff' = 'handoff';
    if (decision.action !== 'handoff' && card) {
      method = 'card';
      const secret = await getCardSecret(deps.vault, card.handle);
      const d = decision;
      const q = due;
      page.arm({
        card: secret,
        ...(d.action === 'approve'
          ? { approve: (screenshot: string) => deps.human.approve({ payee, manifest, due: q, decision: d, card, screenshot }) }
          : {}),
      });
      deps.ledger.updateRun(runId, d.action === 'approve' ? 'awaiting_approval' : 'paying');
    } else {
      deps.ledger.updateRun(runId, 'handoff');
    }

    const { confirmation } = await adapter.pay({ page, manifest, fields, due, method });
    const screenshot = await page.screenshot('receipt');
    const receipt: Receipt = {
      id: randomUUID(),
      runId,
      billerId: manifest.id,
      payeeId: payee.id,
      amountAgorot: due.amountAgorot,
      ...(due.reference ? { reference: due.reference } : {}),
      confirmation,
      paidAt: new Date().toISOString(),
      ...(method === 'card' && card ? { cardLast4: card.last4 } : {}),
      files: { screenshot },
    };
    deps.ledger.saveReceipt(receipt);
    return finish('paid', `Paid. Confirmation ${confirmation}.`, { due, decision, receipt, screenshot });
  } catch (err) {
    if (err instanceof DryRunStop) {
      return finish('dry_run_done', err.message, { ...(due ? { due } : {}), ...(decision ? { decision } : {}), screenshot: err.screenshot });
    }
    if (err instanceof PaymentDeclined) {
      return finish('cancelled', err.message, { ...(due ? { due } : {}), ...(decision ? { decision } : {}) });
    }
    let screenshot: string | undefined;
    try {
      screenshot = await page.screenshot('error');
    } catch {
      // page may be gone
    }
    return finish('failed', (err as Error).message, {
      ...(due ? { due } : {}),
      ...(decision ? { decision } : {}),
      ...(screenshot ? { screenshot } : {}),
    });
  } finally {
    await browser.close();
  }
}
