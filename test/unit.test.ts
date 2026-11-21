import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { formatIls, parseIls } from '../src/core/models.ts';
import { decide, PolicyConfig } from '../src/core/policy.ts';
import { FileVault } from '../src/core/vault/file-vault.ts';
import { BillerManifest, hostAllowed, loadBillers, missingFields } from '../src/core/manifest.ts';
import { Ledger } from '../src/core/ledger.ts';

describe('money', () => {
  it('parses and formats without floats', () => {
    expect(parseIls('412.30')).toBe(41230);
    expect(parseIls('1,234.5')).toBe(123450);
    expect(parseIls('7')).toBe(700);
    expect(formatIls(123450)).toBe('1,234.50 ILS');
    expect(() => parseIls('abc')).toThrow();
  });
});

describe('policy', () => {
  const payee = { id: 'water', billerId: 'demo', nickname: 'Water', fields: {}, owner: 'personal' as const };
  const due = { billerId: 'demo', amountAgorot: 41230, reference: 'v1', quotedAt: '' };
  const prepaid = { handle: 'pre', label: 'Prepaid', kind: 'prepaid' as const, last4: '1111' };
  const personal = { ...prepaid, handle: 'mine', kind: 'personal' as const };
  const base = { payee, due, monthSpentAgorot: 0, alreadyPaid: false };
  const autoFor = (ids: string[]) => PolicyConfig.parse({ auto: { payees: ids } });

  it('auto-pays an allow-listed payee on a prepaid card within limits', () => {
    expect(decide({ ...base, config: autoFor(['water']), card: prepaid }).action).toBe('auto');
  });
  it('asks when the payee is not on the auto list', () => {
    expect(decide({ ...base, config: autoFor([]), card: prepaid }).action).toBe('approve');
  });
  it('always asks for a personal card', () => {
    expect(decide({ ...base, config: autoFor(['water']), card: personal }).action).toBe('approve');
  });
  it('hands off when there is no card', () => {
    expect(decide({ ...base, config: autoFor(['water']) }).action).toBe('handoff');
  });
  it('refuses a bill that was already paid', () => {
    expect(decide({ ...base, config: autoFor(['water']), card: prepaid, alreadyPaid: true }).action).toBe('refuse');
  });
  it('asks when the system amount differs from the slip', () => {
    const slip = { id: 's', source: { kind: 'manual' as const }, fields: {}, amountAgorot: 30000, readAt: '' };
    const d = decide({ ...base, config: autoFor(['water']), card: prepaid, slip });
    expect(d.action).toBe('approve');
    expect(d.reasons.join(' ')).toContain('the slip says 300.00 ILS');
  });
  it('asks above the per-bill and monthly limits', () => {
    const cfg = PolicyConfig.parse({ auto: { payees: ['water'], maxPerBillAgorot: 40000 } });
    expect(decide({ ...base, config: cfg, card: prepaid }).action).toBe('approve');
    const monthly = PolicyConfig.parse({ auto: { payees: ['water'], maxPerMonthAgorot: 50000 } });
    expect(decide({ ...base, config: monthly, card: prepaid, monthSpentAgorot: 10000 }).action).toBe('approve');
  });
});

describe('file vault', () => {
  it('round-trips, rejects a wrong passphrase, and stores no plaintext', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pakid-vault-')), 'vault.enc');
    const v = new FileVault(path);
    v.unlock('correct horse');
    await v.set('card:pre', '{"number":"4111111111111111"}');
    expect(readFileSync(path, 'utf8')).not.toContain('4111');

    const again = new FileVault(path);
    expect(() => again.unlock('wrong passphrase')).toThrow('Wrong vault passphrase');
    again.unlock('correct horse');
    expect(await again.get('card:pre')).toContain('4111111111111111');
    again.lock();
    await expect(again.get('card:pre')).rejects.toThrow('locked');
  });
});

describe('manifests', () => {
  const m = BillerManifest.parse({
    id: 'x',
    name: { he: 'א', en: 'X' },
    platform: 'demo',
    entry: 'https://pay.example.co.il/',
    domains: ['example.co.il'],
    fields: { payer: { label: { he: 'מ', en: 'P' }, pattern: '^\\d{4}$' } },
  });
  it('pins hosts including subdomains, nothing else', () => {
    expect(hostAllowed(m, 'https://pay.example.co.il/x')).toBe(true);
    expect(hostAllowed(m, 'https://example.co.il.evil.com/')).toBe(false);
    expect(hostAllowed(m, 'https://notexample.co.il/')).toBe(false);
  });
  it('reports missing and malformed fields', () => {
    expect(missingFields(m, {})).toEqual(['payer']);
    expect(missingFields(m, { payer: '12' })).toEqual(['payer']);
    expect(missingFields(m, { payer: '1234' })).toEqual([]);
  });
  it('loads the bundled billers', () => {
    expect(loadBillers(join(import.meta.dirname, '..', 'billers')).get('demo')?.platform).toBe('demo');
  });
});

describe('ledger', () => {
  it('tracks duplicates and the monthly total', () => {
    const l = new Ledger(':memory:');
    l.saveReceipt({
      id: 'r1', runId: 'run1', billerId: 'demo', payeeId: 'p', amountAgorot: 1000, reference: 'v1',
      confirmation: 'C', paidAt: new Date().toISOString(), files: {},
    });
    expect(l.isPaid('demo', 'v1')).toBe(true);
    expect(l.isPaid('demo', 'v2')).toBe(false);
    expect(l.monthSpent()).toBe(1000);
  });
});

describe('module boundaries', () => {
  it('core never imports the shells (cli, server, web, channels) or platforms', () => {
    const coreDir = join(import.meta.dirname, '..', 'src', 'core');
    const files = readdirSync(coreDir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const text = readFileSync(join(coreDir, f), 'utf8');
      for (const m of text.matchAll(/from '(\.[^']+)'/g)) {
        const target = relative(coreDir, join(coreDir, f, '..', m[1]!));
        expect(target.startsWith('..'), `${f} imports ${m[1]}`).toBe(false);
      }
    }
  });
});
