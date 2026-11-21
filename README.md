# Pakid Tov

**סוף סוף, פקיד טוב.** Finally, a good clerk.

Every Israeli bill lives on its own website, behind its own codes: מספר משלם, מספר שובר, מספר חוזה, מספר נכס. Pakid Tov reads the payment slip, opens the biller's site, enters the codes, reads what the biller's system says is due, and pays. Or, if you prefer, it fills in everything and lets you type the card and press Pay yourself.

It runs on your own machine (a laptop, a server, or a Raspberry Pi on your shelf), with your own card, on the biller's own checkout page. It is not a service and never holds your money.

> **Status: early.** The core engine works end to end against a demo biller. Real billers are being added now. Don't point it at your real bills yet.

## Try it (nothing real is touched)

Needs Node 24 and Chrome or Chromium.

```bash
npm install
npm run pakid -- demo
```

This starts a fake water company on your machine, stores a test card in a throwaway vault, pays a fake bill and saves the receipt. Try `--mode approve` (asks you first), `--mode handoff` (you type the card in a visible browser) and `--dry-run` (stops one click before paying).

## How it pays

| Mode | Card | Who presses Pay |
|---|---|---|
| Auto | A stored prepaid (rechargeable) card | Pakid Tov, within your limits |
| Approve | A stored card | Pakid Tov, after you say yes to the biller's confirm page |
| Hand-off | None stored | You. Everything else is already filled in |

A prepaid card is the recommended setup: the most you can ever lose is its balance. On top of that, a policy sets per-bill and monthly limits, an auto-pay list, and refuses to pay the same voucher twice.

## What it never does

- Solve CAPTCHAs or get around bot detection. Those come back to you.
- Automate national digital ID login or read your SMS codes. Those come back to you.
- Type a secret on a site the biller's manifest doesn't list. A fake "electricity company" link can't catch it.
- Show your card or passwords to an AI model, a log or a screenshot.
- Send anything anywhere except the biller's own site. No telemetry.

## Adding a biller

A biller is one folder in `billers/`: a `manifest.yaml` (name, pinned domains, the fields it needs) plus a slip reader. Billers on the same payment platform share one adapter in `src/platforms/`. See `billers/demo` and `src/platforms/demo` for the reference.

## Responsibility

Pakid Tov is for paying your own bills with your own card. You are responsible for the payments you make and for each site's terms of use. MIT licensed, no warranty.
