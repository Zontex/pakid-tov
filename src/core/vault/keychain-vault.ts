import { AsyncEntry, findCredentialsAsync } from '@napi-rs/keyring';
import type { Vault } from './vault.ts';

/** Desktop vault: macOS Keychain, Windows Credential Manager or the Linux Secret Service. */
export class KeychainVault implements Vault {
  readonly kind = 'keychain' as const;

  private readonly service: string;

  constructor(service = 'pakid-tov') {
    this.service = service;
  }

  async get(handle: string) {
    return (await new AsyncEntry(this.service, handle).getPassword()) ?? undefined;
  }

  async set(handle: string, value: string) {
    await new AsyncEntry(this.service, handle).setPassword(value);
  }

  async delete(handle: string) {
    await new AsyncEntry(this.service, handle).deletePassword();
  }

  async list() {
    const creds = await findCredentialsAsync(this.service);
    return creds.map((c) => c.account).sort();
  }
}
