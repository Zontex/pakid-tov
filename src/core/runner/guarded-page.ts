import type { Locator, Page } from 'playwright-core';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { hostAllowed, type BillerManifest } from '../manifest.ts';
import type { CardSecret } from '../models.ts';

export class DryRunStop extends Error {
  readonly screenshot: string;
  constructor(screenshot: string) {
    super('Dry run: stopped one click before paying.');
    this.screenshot = screenshot;
  }
}

export class PinnedDomainError extends Error {}

export class PaymentDeclined extends Error {}

/**
 * The only way adapters touch a biller site. It enforces three rules:
 * 1. Navigation and secret typing only on the manifest's pinned domains.
 * 2. Secrets are typed from the card the run was given; adapters name the
 *    part ("number", "cvv"), never see the value, and typed fields are masked
 *    in every screenshot.
 * 3. The final Pay click goes through `confirmPayment`, which stops in dry-run
 *    and waits for approval when the policy asks for it.
 */
export interface GuardedPageOptions {
  dryRun: boolean;
  artifactsDir: string;
  /** Tells the human something (hand-off instructions). */
  tell?: (message: string) => void;
}

export class GuardedPage {
  private readonly secretFields: Locator[] = [];
  private shots = 0;

  readonly page: Page;
  private readonly manifest: BillerManifest;
  private readonly opts: GuardedPageOptions;

  constructor(page: Page, manifest: BillerManifest, opts: GuardedPageOptions) {
    this.page = page;
    this.manifest = manifest;
    this.opts = opts;
    mkdirSync(opts.artifactsDir, { recursive: true });
  }

  private card: CardSecret | undefined;
  /** Called with the confirm-page screenshot; resolves true to press Pay. */
  private approve: ((screenshot: string) => Promise<boolean>) | undefined;

  /** Set after the quote, once the policy has decided how this bill gets paid. */
  arm(payment: { card?: CardSecret; approve?: (screenshot: string) => Promise<boolean> }): void {
    this.card = payment.card;
    this.approve = payment.approve;
  }

  async goto(url: string): Promise<void> {
    if (!hostAllowed(this.manifest, url)) {
      throw new PinnedDomainError(`Refusing to open ${new URL(url).hostname}: not in ${this.manifest.id}'s domains.`);
    }
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    this.assertOnPinnedDomain();
  }

  /** Types a plain value (payer number, voucher number). Not secret. */
  async fill(target: Locator, value: string): Promise<void> {
    this.assertOnPinnedDomain();
    await target.fill(value);
  }

  /** Types one part of the run's card into a field, after checking the field's frame is pinned. */
  async fillCard(target: Locator, part: keyof CardSecret | 'expiry'): Promise<void> {
    const card = this.card;
    if (!card) throw new Error('No card for this run (hand-off mode types nothing).');
    const handle = await target.elementHandle({ timeout: 15_000 });
    if (!handle) throw new Error('Card field not found.');
    const frame = await handle.ownerFrame();
    const frameUrl = frame?.url() ?? '';
    if (!hostAllowed(this.manifest, frameUrl)) {
      throw new PinnedDomainError(`Refusing to type card details into ${safeHost(frameUrl)}: not in ${this.manifest.id}'s domains.`);
    }
    const value = part === 'expiry' ? `${card.expMonth}/${card.expYear}` : card[part];
    if (value === undefined) throw new Error(`The stored card has no ${part}.`);
    await handle.fill(value);
    await handle.dispose();
    this.secretFields.push(target);
  }

  async screenshot(name: string): Promise<string> {
    const path = join(this.opts.artifactsDir, `${String(++this.shots).padStart(2, '0')}-${name}.png`);
    await this.page.screenshot({ path, fullPage: true, mask: this.secretFields, maskColor: '#222' });
    return path;
  }

  /**
   * Wraps the final Pay click. Dry-run stops here with a screenshot. With an
   * approver, the confirm page screenshot goes to the human first.
   */
  async confirmPayment(click: () => Promise<void>): Promise<void> {
    this.assertOnPinnedDomain();
    const shot = await this.screenshot('confirm');
    if (this.opts.dryRun) throw new DryRunStop(shot);
    if (this.approve && !(await this.approve(shot))) {
      throw new PaymentDeclined('You declined the payment.');
    }
    await click();
  }

  /**
   * Hand-off point: everything is filled except the card. Dry-run stops here;
   * otherwise the human is told to finish in the browser, and the adapter then
   * waits for the biller's success page.
   */
  async handoff(message: string): Promise<void> {
    this.assertOnPinnedDomain();
    const shot = await this.screenshot('handoff');
    if (this.opts.dryRun) throw new DryRunStop(shot);
    this.opts.tell?.(message);
  }

  private assertOnPinnedDomain(): void {
    const url = this.page.url();
    if (url !== 'about:blank' && !hostAllowed(this.manifest, url)) {
      throw new PinnedDomainError(`The page moved to ${safeHost(url)}, which is not in ${this.manifest.id}'s domains. Stopped.`);
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'an unknown page';
  }
}
