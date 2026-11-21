import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { payBill, type EngineDeps, type Human } from '../src/core/engine.ts';
import { Ledger } from '../src/core/ledger.ts';
import { BillerManifest } from '../src/core/manifest.ts';
import { PolicyConfig } from '../src/core/policy.ts';
import { MemoryVault, setCardSecret } from '../src/core/vault/vault.ts';
import { platforms } from '../src/platforms/index.ts';
import { startDemoSite, type DemoSite } from '../src/platforms/demo/site.ts';

let site: DemoSite;
beforeAll(async () => {
  site = await startDemoSite();
});
afterAll(() => site.close());

function manifest(domains: string[]) {
  return BillerManifest.parse({
    id: 'demo',
    name: { he: 'דמו', en: 'Demo' },
    platform: 'demo',
    entry: site.entry,
    domains,
    fields: {
      payer_number: { label: { he: 'מ', en: 'P' }, pattern: '^\\d{4,12}$' },
      voucher_number: { label: { he: 'ש', en: 'V' }, scope: 'slip' },
    },
  });
}

async function setup(opts: { domains?: string[]; policy?: object; approve?: boolean; withCard?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pakid-test-'));
  const ledger = new Ledger(':memory:');
  const vault = new MemoryVault();
  if (opts.withCard !== false) {
    await setCardSecret(vault, 'pre', { number: '4111111111111111', expMonth: '12', expYear: '30', cvv: '123' });
    ledger.saveCard({ handle: 'pre', label: 'Prepaid', kind: 'prepaid', last4: '1111' });
  }
  ledger.savePayee({
    id: 'water',
    billerId: 'demo',
    nickname: 'Water',
    fields: { payer_number: '12345' },
    owner: 'personal',
    ...(opts.withCard !== false ? { cardHandle: 'pre' } : {}),
  });
  const asked: string[] = [];
  const human: Human = {
    approve: async (req) => {
      asked.push(req.screenshot);
      return opts.approve ?? true;
    },
    tell: () => {},
  };
  const deps: EngineDeps = {
    ledger,
    vault,
    billers: new Map([['demo', manifest(opts.domains ?? [site.billHost, site.cardHost])]]),
    platforms,
    policy: PolicyConfig.parse(opts.policy ?? { auto: { payees: ['water'] } }),
    human,
    dataDir: home,
  };
  return { deps, ledger, asked };
}

describe('paying the demo biller', { timeout: 60_000 }, () => {
  it('auto-pays, saves a receipt, then refuses the same voucher', async () => {
    const { deps, ledger } = await setup();
    const r = await payBill(deps, { payeeId: 'water', slipFields: { voucher_number: '5551' } });
    expect(r.status).toBe('paid');
    expect(r.due?.amountAgorot).toBe(41230);
    expect(r.receipt?.confirmation).toMatch(/^DEMO-\d{6}$/);
    expect(r.receipt?.cardLast4).toBe('1111');
    expect(existsSync(r.screenshot!)).toBe(true);
    expect(ledger.listReceipts()).toHaveLength(1);

    const again = await payBill(deps, { payeeId: 'water', slipFields: { voucher_number: '5551' } });
    expect(again.status).toBe('refused');
  });

  it('dry-run stops one click before paying and records nothing', async () => {
    const { deps, ledger } = await setup();
    const r = await payBill(deps, { payeeId: 'water', slipFields: { voucher_number: '5552' }, dryRun: true });
    expect(r.status).toBe('dry_run_done');
    expect(existsSync(r.screenshot!)).toBe(true);
    expect(ledger.listReceipts()).toHaveLength(0);
  });

  it('asks before paying when the policy says approve, and respects a no', async () => {
    const { deps, ledger, asked } = await setup({ policy: { mode: 'approve' }, approve: false });
    const r = await payBill(deps, { payeeId: 'water', slipFields: { voucher_number: '5553' } });
    expect(asked).toHaveLength(1);
    expect(r.status).toBe('cancelled');
    expect(ledger.listReceipts()).toHaveLength(0);
  });

  it('never types the card on a host the manifest does not pin', async () => {
    const { deps, ledger } = await setup({ domains: [site.billHost] });
    const r = await payBill(deps, { payeeId: 'water', slipFields: { voucher_number: '5554' } });
    expect(r.status).toBe('failed');
    expect(r.message).toContain('Refusing to type card details into localhost');
    expect(ledger.listReceipts()).toHaveLength(0);
  });

  it('without a card, dry-run stops at the hand-off point', async () => {
    const { deps } = await setup({ withCard: false });
    const r = await payBill(deps, { payeeId: 'water', slipFields: { voucher_number: '5555' }, dryRun: true });
    expect(r.decision?.action).toBe('handoff');
    expect(r.status).toBe('dry_run_done');
  });

  it('stops before quoting when a required field is missing', async () => {
    const { deps } = await setup();
    deps.ledger.savePayee({ id: 'bad', billerId: 'demo', nickname: 'Bad', fields: { payer_number: '12' }, owner: 'personal' });
    await expect(payBill(deps, { payeeId: 'bad' })).rejects.toThrow('payer_number');
  });
});
