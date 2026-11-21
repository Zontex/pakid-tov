import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Vault } from './vault.ts';

interface VaultFile {
  v: 1;
  kdf: { salt: string; N: number; r: number; p: number };
  iv: string;
  tag: string;
  ct: string;
  /** Lets a wrong passphrase fail clearly instead of as a decrypt error. */
  check: string;
}

const KDF = { N: 2 ** 15, r: 8, p: 1 };

/**
 * Encrypted file vault for machines without an OS keychain (the clerk-box).
 * AES-256-GCM, key from scrypt(passphrase). Locked until `unlock()`; the key
 * stays in memory only.
 */
export class FileVault implements Vault {
  readonly kind = 'file' as const;
  private key: Buffer | undefined;
  private salt: Buffer | undefined;
  private values = new Map<string, string>();

  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get exists(): boolean {
    return existsSync(this.path);
  }

  get locked(): boolean {
    return !this.key;
  }

  /** Opens an existing vault, or creates a new one with this passphrase. */
  unlock(passphrase: string): void {
    if (passphrase.length < 8) throw new Error('Vault passphrase must be at least 8 characters.');
    if (!this.exists) {
      this.salt = randomBytes(16);
      this.key = derive(passphrase, this.salt);
      this.values = new Map();
      this.save();
      return;
    }
    const file = JSON.parse(readFileSync(this.path, 'utf8')) as VaultFile;
    const salt = Buffer.from(file.kdf.salt, 'base64');
    const key = derive(passphrase, salt, file.kdf);
    const check = Buffer.from(file.check, 'base64');
    if (!timingSafeEqual(check, checkValue(key))) throw new Error('Wrong vault passphrase.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.ct, 'base64')), decipher.final()]);
    this.values = new Map(Object.entries(JSON.parse(plain.toString('utf8')) as Record<string, string>));
    this.key = key;
    this.salt = salt;
  }

  lock(): void {
    this.key = undefined;
    this.values = new Map();
  }

  async get(handle: string) {
    this.assertUnlocked();
    return this.values.get(handle);
  }

  async set(handle: string, value: string) {
    this.assertUnlocked();
    this.values.set(handle, value);
    this.save();
  }

  async delete(handle: string) {
    this.assertUnlocked();
    this.values.delete(handle);
    this.save();
  }

  async list() {
    this.assertUnlocked();
    return [...this.values.keys()].sort();
  }

  private assertUnlocked(): void {
    if (!this.key) throw new Error('The vault is locked. Unlock it with your passphrase first.');
  }

  private save(): void {
    if (!this.key || !this.salt) throw new Error('The vault is locked.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(this.values)), 'utf8'), cipher.final()]);
    const file: VaultFile = {
      v: 1,
      kdf: { salt: this.salt.toString('base64'), ...KDF },
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
      check: checkValue(this.key).toString('base64'),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

function derive(passphrase: string, salt: Buffer, params = KDF): Buffer {
  return scryptSync(passphrase, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 });
}

function checkValue(key: Buffer): Buffer {
  return createHmac('sha256', key).update('pakid-tov-vault-check').digest();
}
