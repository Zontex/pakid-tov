<p align="center">
  <img src=".github/assets/header.webp" alt="A government office: a long queue out the door, the clerk asleep on a pile of forms, and at the next window a small computer box stamping PAID on a tall stack of bills" width="100%">
</p>

<h1 align="center">Pakid Tov</h1>

<p align="center"><strong>Finally, a good clerk.</strong><br>
Pays Israeli bills straight from the payment slip, on your own machine.</p>

<p align="center">
  <a href="https://github.com/Zontex/pakid-tov/actions/workflows/ci.yml"><img src="https://github.com/Zontex/pakid-tov/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A524-339933" alt="Node 24 or later">
  <img src="https://img.shields.io/badge/status-early-orange" alt="Status: early">
</p>

<p align="center">
  <a href="#try-it">Try it</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#payment-modes">Payment modes</a> ·
  <a href="#where-it-runs">Where it runs</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#adding-a-biller">Add a biller</a>
</p>

---

Every Israeli bill lives on its own website, behind its own codes: payer number, voucher number, contract number, property number. Pakid Tov reads the slip, opens the biller's site, types the codes, checks what the biller's system says is due, and pays. Or it fills in everything and leaves the card and the Pay button to you.

It runs on your machine, with your card, on the biller's own checkout page. It is not a service and never holds your money.

> [!WARNING]
> **Early days.** The engine pays a demo biller end to end. Real billers are being added now, so don't point it at your real bills yet.

## Try it

Needs Node 24 and Chrome or Chromium. Nothing real is touched: a fake water company runs on your machine and a test card lives in a throwaway vault.

```bash
git clone https://github.com/Zontex/pakid-tov && cd pakid-tov
npm install
npm run pakid -- demo
```

```text
Due: 412.30 ILS (ref 98765432)
Decision: auto. Within your auto-pay rules.
paid: Paid. Confirmation DEMO-461875.
```

Then try the other modes:

| Command | What you'll see |
|---|---|
| `npm run pakid -- demo --mode approve` | Stops at the biller's confirm page and asks you first |
| `npm run pakid -- demo --mode handoff` | Opens the browser with everything filled in except the card |
| `npm run pakid -- demo --dry-run` | Goes all the way to the Pay button and stops |

## How it works

1. **Read the slip.** A photo, a scan or the PDF the biller emailed you. Pakid Tov pulls out the biller, the codes, the amount and the due date. *(in progress)*
2. **Ask the biller.** It opens the biller's own site, types the codes and reads what is really due. The biller's system wins over the paper.
3. **Pay, or ask, or hand over.** Your rules decide: pay on its own, ask you first, or fill everything and let you press Pay.
4. **Keep the proof.** Confirmation number, screenshot and a row in a local ledger. The same voucher is never paid twice.

## Payment modes

| Mode | Card | Who presses Pay |
|---|---|---|
| **Auto** | A stored prepaid (rechargeable) card | Pakid Tov, inside your limits |
| **Approve** | A stored card | Pakid Tov, after you say yes to the confirm page |
| **Hand-off** | None stored | You. Everything else is already filled in |

A prepaid card is the recommended setup: the most you can ever lose is its balance. On top of it you set a per-bill limit, a monthly limit and the list of payees allowed to auto-pay.

## Where it runs

| | How you use it |
|---|---|
| **Laptop** | The `pakid` command. Hand-off opens a normal browser window. |
| **Clerk-box** | A Raspberry Pi on your shelf. Send it a photo of the slip on Telegram, tap Approve, get the stamped receipt back. *(in progress)* |
| **Any server** | A Docker image for Linux, x64 or ARM. *(planned)* |

## Roadmap

- [x] Core engine: quote, policy, pay, receipts, ledger, vault
- [x] Demo biller and end-to-end tests
- [x] Tested on Debian 13 for ARM (the base of Raspberry Pi OS) with the system Chromium
- [ ] Slip reader with a tested prompt per slip type
- [ ] Billers: gov.il payments (vehicle licence, fines), Israel Electric, Mei Sheva, arnona via CityPay, Bituach Leumi
- [ ] Telegram bot and Mini App (approve, live view, add card)
- [ ] Clerk-box image for Raspberry Pi
- [ ] MCP server, so AI assistants can pay a slip you hand them
- [ ] Explore mode: drafts a new biller from a guided first run

## Adding a biller

A biller is one folder. Billers on the same payment platform share one adapter.

```text
billers/
  demo/
    manifest.yaml     name, pinned domains, the fields it needs
src/platforms/
  demo/
    adapter.ts        quote() and pay() for one payment platform
```

Copy `billers/demo`, point the manifest at the real site, and reuse an existing platform adapter or write a new one. Every adapter supports `--dry-run`, so you can build and test it without paying anything.

## Responsibility

Pakid Tov is for paying your own bills with your own card. You are responsible for the payments you make and for each site's terms of use.

[MIT](LICENSE), no warranty.
