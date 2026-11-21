import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { PolicyConfig } from './policy.ts';

export const Config = z.object({
  policy: PolicyConfig.default(PolicyConfig.parse({})),
  /** keychain on a desktop, file on the clerk-box (no OS keychain there). */
  vault: z.enum(['keychain', 'file']).default('keychain'),
  browser: z.object({ executablePath: z.string().optional() }).default({}),
});
export type Config = z.infer<typeof Config>;

/** ~/.pakid by default; holds config.yaml, ledger.sqlite, vault.enc, runs/ and private billers/. */
export function pakidHome(): string {
  return process.env.PAKID_HOME ?? join(homedir(), '.pakid');
}

export function loadConfig(home = pakidHome()): Config {
  const path = join(home, 'config.yaml');
  return Config.parse(existsSync(path) ? (parse(readFileSync(path, 'utf8')) ?? {}) : {});
}

/** The installed package's root (works from src/ and from dist/src/). */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('package.json not found');
    dir = up;
  }
  return dir;
}

/** Bundled billers, then private ones in ~/.pakid/billers (which win on the same id). */
export function billerDirs(home = pakidHome()): string[] {
  return [join(packageRoot(), 'billers'), join(home, 'billers')];
}
