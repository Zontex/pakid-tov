#!/usr/bin/env node
import { Command, Option } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { billerDirs, loadConfig, pakidHome } from '../core/config.ts';
import { payBill, MissingFieldsError, type EngineDeps, type Human } from '../core/engine.ts';
import { Ledger } from '../core/ledger.ts';
import { loadBillers, type BillerManifest } from '../core/manifest.ts';
import { formatIls, CardSecret, type Card } from '../core/models.ts';
import { PolicyConfig } from '../core/policy.ts';
import { FileVault } from '../core/vault/file-vault.ts';
import { KeychainVault } from '../core/vault/keychain-vault.ts';
import { MemoryVault, setCardSecret, type Vault } from '../core/vault/vault.ts';
import { platforms } from '../platforms/index.ts';
import { startDemoSite } from '../platforms/demo/site.ts';
import { ask, askHidden, parsePairs } from './prompt.ts';

function allBillers(): Map<string, BillerManifest> {
  const out = new Map<string, BillerManifest>();
  for (const dir of billerDirs()) for (const [id, m] of loadBillers(dir)) out.set(id, m);
  return out;
}

async function openVault(kind: 'keychain' | 'file', home: string): Promise<Vault> {
  if (kind === 'keychain') return new KeychainVault();
  const vault = new FileVault(join(home, 'vault.enc'));
  const pass =
    process.env.PAKID_VAULT_PASSPHRASE ??
    (await askHidden(vault.exists ? 'Vault passphrase: ' : 'New vault passphrase (8+ characters): '));
  vault.unlock(pass);
  return vault;
}

const cliHuman: Human = {
  async approve({ manifest, payee, due, decision, card, screenshot }) {
    console.log(`\n${manifest.name.en} (${payee.nickname}): ${formatIls(due.amountAgorot)}`);
    for (const r of decision.reasons) console.log(`  ${r}`);
    console.log(`  Card: ${card.label} ending ${card.last4}`);
    console.log(`  Confirm page: ${screenshot}`);
    return (await ask('Pay now? [y/N] ')).trim().toLowerCase() === 'y';
  },
  tell(message) {
    console.log(`\n${message}`);
  },
};

const program = new Command()
  .name('pakid')
  .description('Pakid Tov. Finally, a good clerk.')
  .version('0.0.1');

program
  .command('billers')
  .description('List installed billers')
  .action(() => {
    for (const m of allBillers().values()) {
      console.log(`${m.id.padEnd(16)} ${m.name.en} / ${m.name.he}  [${Object.keys(m.fields).join(', ')}]`);
    }
  });

const payee = program.command('payee').description('Saved payees (one per account you pay)');
payee
  .command('add <id>')
  .requiredOption('--biller <biller>', 'biller id, see `pakid billers`')
  .requiredOption('--name <nickname>', 'what you call it, e.g. "Electricity, home"')
  .option('--field <key=value...>', 'saved fields, e.g. payer_number=12345', [])
  .option('--card <handle>', 'card to pay with; leave out for hand-off')
  .option('--business', 'a business expense')
  .action((id: string, o: { biller: string; name: string; field: string[]; card?: string; business?: boolean }) => {
    if (!allBillers().has(o.biller)) throw new Error(`Unknown biller "${o.biller}".`);
    const ledger = new Ledger(join(pakidHome(), 'ledger.sqlite'));
    ledger.savePayee({
      id,
      billerId: o.biller,
      nickname: o.name,
      fields: parsePairs(o.field),
      owner: o.business ? 'business' : 'personal',
      ...(o.card ? { cardHandle: o.card } : {}),
    });
    console.log(`Saved payee ${id}.`);
  });

program
  .command('payees')
  .description('List saved payees')
  .action(() => {
    const ledger = new Ledger(join(pakidHome(), 'ledger.sqlite'));
    for (const p of ledger.listPayees()) {
      console.log(`${p.id.padEnd(16)} ${p.billerId.padEnd(14)} ${p.nickname}${p.cardHandle ? `  card:${p.cardHandle}` : '  hand-off'}`);
    }
  });

program
  .command('card')
  .description('Store a card. The number goes to the vault; only the last 4 digits stay in the ledger.')
  .command('add <handle>')
  .requiredOption('--label <label>', 'e.g. "Prepaid bills card"')
  .addOption(new Option('--kind <kind>', 'prepaid cards can auto-pay within limits; personal cards always ask').choices(['prepaid', 'personal']).makeOptionMandatory())
  .action(async (handle: string, o: { label: string; kind: 'prepaid' | 'personal' }) => {
    const home = pakidHome();
    const config = loadConfig(home);
    const number = (await askHidden('Card number: ')).replace(/\D/g, '');
    const [expMonth = '', expYear = ''] = (await ask('Expiry (MM/YY): ')).trim().split('/');
    const cvv = await askHidden('CVV: ');
    const holderId = (await askHidden('Card holder ID number (Enter to skip): ')).trim();
    const secret = CardSecret.parse({ number, expMonth, expYear, cvv, ...(holderId ? { holderId } : {}) });
    const vault = await openVault(config.vault, home);
    await setCardSecret(vault, handle, secret);
    const card: Card = { handle, label: o.label, kind: o.kind, last4: number.slice(-4) };
    new Ledger(join(home, 'ledger.sqlite')).saveCard(card);
    console.log(`Stored ${o.kind} card ${handle} ending ${card.last4} in the ${vault.kind} vault.`);
  });

program
  .command('pay <payeeId>')
  .description('Quote and pay a bill for a saved payee')
  .option('--field <key=value...>', "this slip's fields, e.g. voucher_number=123456", [])
  .option('--dry-run', 'go all the way to the Pay button and stop')
  .option('--visible', 'show the browser window')
  .action(async (payeeId: string, o: { field: string[]; dryRun?: boolean; visible?: boolean }) => {
    const home = pakidHome();
    const config = loadConfig(home);
    const ledger = new Ledger(join(home, 'ledger.sqlite'));
    const needsVault = !o.dryRun || !!ledger.getPayee(payeeId)?.cardHandle;
    const deps: EngineDeps = {
      ledger,
      vault: needsVault ? await openVault(config.vault, home) : new MemoryVault(),
      billers: allBillers(),
      platforms,
      policy: config.policy,
      human: cliHuman,
      dataDir: home,
      browser: config.browser,
    };
    await runPay(deps, { payeeId, slipFields: parsePairs(o.field), dryRun: !!o.dryRun, ...(o.visible ? { visible: true } : {}) });
  });

program
  .command('receipts')
  .description('List paid bills')
  .action(() => {
    const ledger = new Ledger(join(pakidHome(), 'ledger.sqlite'));
    for (const r of ledger.listReceipts()) {
      console.log(`${r.paidAt.slice(0, 10)}  ${r.billerId.padEnd(14)} ${formatIls(r.amountAgorot).padStart(14)}  ${r.confirmation}  ${r.files.screenshot ?? ''}`);
    }
  });

program
  .command('demo-site')
  .description('Run the fake demo biller on 127.0.0.1:4555 (card iframe on localhost:4556)')
  .action(async () => {
    const site = await startDemoSite({ billPort: 4555, cardPort: 4556 });
    console.log(`Demo biller at ${site.entry}. Ctrl+C to stop.`);
  });

program
  .command('demo')
  .description('Pay a fake bill end to end in a throwaway home, with a test card. Nothing real is touched.')
  .addOption(new Option('--mode <mode>', 'how the bill gets paid').choices(['auto', 'approve', 'handoff']).default('auto'))
  .option('--dry-run', 'stop one click before paying')
  .action(async (o: { mode: 'auto' | 'approve' | 'handoff'; dryRun?: boolean }) => {
    const home = mkdtempSync(join(tmpdir(), 'pakid-demo-'));
    const site = await startDemoSite({ billPort: 4555, cardPort: 4556 });
    const ledger = new Ledger(join(home, 'ledger.sqlite'));
    const vault = new MemoryVault();
    try {
      if (o.mode !== 'handoff') {
        await setCardSecret(vault, 'test', { number: '4111111111111111', expMonth: '12', expYear: '30', cvv: '123' });
        ledger.saveCard({ handle: 'test', label: 'Test card', kind: 'prepaid', last4: '1111' });
      }
      ledger.savePayee({
        id: 'demo-water',
        billerId: 'demo',
        nickname: 'Demo water, home',
        fields: { payer_number: '12345' },
        owner: 'personal',
        ...(o.mode !== 'handoff' ? { cardHandle: 'test' } : {}),
      });
      const policy = PolicyConfig.parse({ mode: o.mode === 'auto' ? 'auto' : o.mode });
      await runPay(
        { ledger, vault, billers: allBillers(), platforms, policy, human: cliHuman, dataDir: home },
        { payeeId: 'demo-water', slipFields: { voucher_number: '98765432' }, dryRun: !!o.dryRun },
      );
      console.log(`Demo files: ${home}`);
    } finally {
      ledger.close();
      await site.close();
    }
    if (process.env.PAKID_DEMO_CLEANUP) rmSync(home, { recursive: true, force: true });
  });

async function runPay(deps: EngineDeps, req: Parameters<typeof payBill>[1]): Promise<void> {
  try {
    const result = await payBill(deps, req);
    if (result.due) console.log(`Due: ${formatIls(result.due.amountAgorot)}${result.due.reference ? ` (ref ${result.due.reference})` : ''}`);
    if (result.decision) console.log(`Decision: ${result.decision.action}. ${result.decision.reasons.join(' ')}`);
    console.log(`${result.status}: ${result.message}`);
    if (result.screenshot) console.log(`Screenshot: ${result.screenshot}`);
    if (result.status === 'failed') process.exitCode = 1;
  } catch (err) {
    if (err instanceof MissingFieldsError) {
      console.error(`Missing fields: ${err.fields.join(', ')}. Pass them with --field key=value.`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

program.parseAsync().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
