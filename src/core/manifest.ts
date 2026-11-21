import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const Label = z.object({ he: z.string(), en: z.string() });

export const BillerManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: Label,
  /** The platform adapter that drives this biller's payment site. */
  platform: z.string(),
  entry: z.url(),
  /**
   * Hosts where Pakid Tov may type secrets (card, passwords). Card fields in a
   * payment provider's iframe need that provider's host here too. A host
   * matches itself and its subdomains.
   */
  domains: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1),
  fields: z.record(
    z.string(),
    z.object({
      label: Label,
      pattern: z.string().optional(),
      required: z.boolean().default(true),
      /** Saved on the payee (payer number) vs. new on every slip (voucher number). */
      scope: z.enum(['payee', 'slip']).default('payee'),
    }),
  ),
  recognize: z
    .object({
      keywords: z.array(z.string()).default([]),
      barcodePrefixes: z.array(z.string()).default([]),
    })
    .default({ keywords: [], barcodePrefixes: [] }),
  standingOrder: z.boolean().default(false),
  /** Free-form settings for the platform adapter. */
  options: z.record(z.string(), z.unknown()).default({}),
});
export type BillerManifest = z.infer<typeof BillerManifest>;

export function loadManifest(dir: string): BillerManifest {
  const raw = parse(readFileSync(join(dir, 'manifest.yaml'), 'utf8'));
  return BillerManifest.parse(raw);
}

export function loadBillers(root: string): Map<string, BillerManifest> {
  const out = new Map<string, BillerManifest>();
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(root, entry.name, 'manifest.yaml'))) continue;
    const m = loadManifest(join(root, entry.name));
    if (m.id !== entry.name) throw new Error(`billers/${entry.name}: manifest id "${m.id}" must match its folder`);
    out.set(m.id, m);
  }
  return out;
}

export function hostAllowed(manifest: Pick<BillerManifest, 'domains'>, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return manifest.domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Checks that every required field is present and matches its pattern. */
export function missingFields(manifest: BillerManifest, values: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const [key, spec] of Object.entries(manifest.fields)) {
    const v = values[key];
    if (v === undefined || v === '') {
      if (spec.required) missing.push(key);
      continue;
    }
    if (spec.pattern && !new RegExp(spec.pattern).test(v)) missing.push(key);
  }
  return missing;
}
