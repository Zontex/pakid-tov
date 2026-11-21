import type { BillerManifest } from './manifest.ts';
import type { Due } from './models.ts';
import type { GuardedPage } from './runner/guarded-page.ts';

export interface QuoteContext {
  page: GuardedPage;
  manifest: BillerManifest;
  /** Payee fields merged with this slip's fields (voucher number etc). */
  fields: Record<string, string>;
}

export interface PayContext extends QuoteContext {
  due: Due;
  /**
   * "card": type the stored card with page.fillCard, then press Pay through
   * page.confirmPayment. "handoff": fill everything else, call page.handoff,
   * then wait for the biller's success page while the human pays.
   */
  method: 'card' | 'handoff';
}

/**
 * Drives one payment platform (gov.il payments, CityPay, a biller's own site).
 * Many billers share one adapter; their manifests say where to go and what to type.
 */
export interface PlatformAdapter {
  readonly id: string;
  /** Opens the biller, enters the codes, reads what is due. Must not pay. */
  quote(ctx: QuoteContext): Promise<Due>;
  /** Continues from the quote to the confirmation number. */
  pay(ctx: PayContext): Promise<{ confirmation: string }>;
}
