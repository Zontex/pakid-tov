import type { PlatformAdapter } from '../../core/adapter.ts';
import { parseIls } from '../../core/models.ts';

/** Drives the demo biller (src/platforms/demo/site.ts). Also the reference adapter for contributors. */
export const demoAdapter: PlatformAdapter = {
  id: 'demo',

  async quote({ page, manifest, fields }) {
    await page.goto(manifest.entry);
    const p = page.page;
    await page.fill(p.locator('#payer'), fields.payer_number ?? '');
    await page.fill(p.locator('#voucher'), fields.voucher_number ?? '');
    await p.locator('#lookup').click();
    await p.waitForLoadState('domcontentloaded');
    if (await p.locator('#error').count()) {
      throw new Error(`Biller says: ${(await p.locator('#error').innerText()).trim()}`);
    }
    return {
      billerId: manifest.id,
      amountAgorot: parseIls(await p.locator('#amount').innerText()),
      reference: (await p.locator('#ref').innerText()).trim(),
      quotedAt: new Date().toISOString(),
    };
  },

  async pay({ page, method }) {
    const p = page.page;
    await p.locator('#to-pay').click();
    await p.waitForLoadState('domcontentloaded');
    const card = p.frameLocator('#card-frame');

    if (method === 'handoff') {
      await card.locator('#cc-number').waitFor();
      await page.handoff('Enter your card in the browser window, press Save, then press the payment button.');
      await p.locator('#confirmation').waitFor({ timeout: 10 * 60_000 });
      return { confirmation: (await p.locator('#confirmation').innerText()).trim() };
    }

    await page.fillCard(card.locator('#cc-number'), 'number');
    await page.fillCard(card.locator('#cc-exp'), 'expiry');
    await page.fillCard(card.locator('#cc-cvv'), 'cvv');
    await card.locator('#cc-save').click();
    const confirm = p.locator('#confirm');
    await p.waitForFunction(() => !(document.getElementById('confirm') as HTMLButtonElement | null)?.disabled);
    await page.confirmPayment(() => confirm.click());
    await p.locator('#confirmation').waitFor();
    return { confirmation: (await p.locator('#confirmation').innerText()).trim() };
  },
};
