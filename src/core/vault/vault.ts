import { CardSecret } from '../models.ts';

/**
 * Where secrets live: card numbers, passwords, ID numbers used to log in.
 * Code refers to a secret by handle; only the browser runner reads values,
 * and only to type them into a pinned domain. Values never reach a model,
 * a log or the ledger.
 */
export interface Vault {
  readonly kind: 'keychain' | 'file' | 'memory';
  get(handle: string): Promise<string | undefined>;
  set(handle: string, value: string): Promise<void>;
  delete(handle: string): Promise<void>;
  list(): Promise<string[]>;
}

export async function getCardSecret(vault: Vault, cardHandle: string): Promise<CardSecret> {
  const raw = await vault.get(`card:${cardHandle}`);
  if (!raw) throw new Error(`No card "${cardHandle}" in the vault. Add it with: pakid card add ${cardHandle}`);
  return CardSecret.parse(JSON.parse(raw));
}

export async function setCardSecret(vault: Vault, cardHandle: string, secret: CardSecret): Promise<void> {
  await vault.set(`card:${cardHandle}`, JSON.stringify(CardSecret.parse(secret)));
}

/** For tests and one-off runs. */
export class MemoryVault implements Vault {
  readonly kind = 'memory' as const;
  private readonly values = new Map<string, string>();
  async get(handle: string) {
    return this.values.get(handle);
  }
  async set(handle: string, value: string) {
    this.values.set(handle, value);
  }
  async delete(handle: string) {
    this.values.delete(handle);
  }
  async list() {
    return [...this.values.keys()].sort();
  }
}
