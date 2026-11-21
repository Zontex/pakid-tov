import { createServer, type Server } from 'node:http';
import { randomInt } from 'node:crypto';

/**
 * A fake biller for trying Pakid Tov and for tests: lookup form, bill page,
 * a card form in an iframe on a second host (like a real payment provider),
 * and a confirmation page. Nothing is charged; card values are never stored.
 */
export interface DemoSite {
  entry: string;
  billHost: string;
  cardHost: string;
  close(): Promise<void>;
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:40px;max-width:520px}label{display:block;margin:12px 0 4px}
input{font:inherit;padding:6px;width:100%}button{font:inherit;margin-top:16px;padding:8px 16px}
iframe{border:1px solid #ccc;width:100%;height:320px}</style></head><body>${body}</body></html>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function startDemoSite(opts: { billPort?: number; cardPort?: number; amount?: string } = {}): Promise<DemoSite> {
  const amount = opts.amount ?? '412.30';
  let cardOrigin = '';

  const bill = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const q = (k: string) => esc(url.searchParams.get(k) ?? '');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    switch (url.pathname) {
      case '/':
        return res.end(
          page(
            'תשלום חשבון',
            `<h1>תאגיד הדמו: תשלום חשבון</h1>
<form action="/bill"><label for="payer">מספר משלם</label><input id="payer" name="payer">
<label for="voucher">מספר שובר</label><input id="voucher" name="voucher">
<button id="lookup">חיפוש</button></form>`,
          ),
        );
      case '/bill':
        if (!/^\d{4,12}$/.test(url.searchParams.get('payer') ?? '')) {
          return res.end(page('שגיאה', '<p id="error">מספר משלם לא נמצא</p>'));
        }
        return res.end(
          page(
            'חשבון',
            `<h1>חשבון לתשלום</h1><p>שובר <span id="ref">${q('voucher')}</span></p>
<p>סכום לתשלום: <span id="amount">${amount}</span> ש"ח</p>
<a id="to-pay" href="/pay?ref=${q('voucher')}">המשך לתשלום</a>`,
          ),
        );
      case '/pay':
        return res.end(
          page(
            'תשלום',
            `<h1>פרטי כרטיס</h1><iframe id="card-frame" src="${cardOrigin}/card"></iframe>
<button id="confirm" disabled>אישור תשלום</button>
<script>let last4='';addEventListener('message',e=>{if(e.origin!=='${cardOrigin}')return;
if(e.data&&e.data.ok){last4=e.data.last4;document.getElementById('confirm').disabled=false}});
document.getElementById('confirm').onclick=()=>{location.href='/done?ref=${q('ref')}&last4='+last4};</script>`,
          ),
        );
      case '/done':
        return res.end(
          page(
            'אושר',
            `<h1>התשלום התקבל</h1><p>מספר אישור: <span id="confirmation">DEMO-${randomInt(100000, 999999)}</span></p>
<p>שובר ${q('ref')}, כרטיס המסתיים ב-${q('last4')}</p>`,
          ),
        );
      default:
        res.statusCode = 404;
        return res.end('not found');
    }
  });

  const card = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      page(
        'כרטיס',
        `<label for="cc-number">מספר כרטיס</label><input id="cc-number" autocomplete="cc-number">
<label for="cc-exp">תוקף (MM/YY)</label><input id="cc-exp" autocomplete="cc-exp">
<label for="cc-cvv">CVV</label><input id="cc-cvv" autocomplete="cc-csc">
<button id="cc-save">שמירה</button><p id="cc-error"></p>
<script>document.getElementById('cc-save').onclick=()=>{const n=document.getElementById('cc-number').value.replace(/\\D/g,'');
const ok=n.length>=12&&/^\\d{2}\\/\\d{2}$/.test(document.getElementById('cc-exp').value)&&/^\\d{3,4}$/.test(document.getElementById('cc-cvv').value);
document.getElementById('cc-error').textContent=ok?'':'פרטי כרטיס שגויים';
if(ok)parent.postMessage({ok:true,last4:n.slice(-4)},'*');};</script>`,
      ),
    );
  });

  const listen = (s: Server, port: number, host: string) =>
    new Promise<number>((resolve) => s.listen(port, host, () => resolve((s.address() as { port: number }).port)));

  const billPort = await listen(bill, opts.billPort ?? 0, '127.0.0.1');
  const cardPort = await listen(card, opts.cardPort ?? 0, '127.0.0.1');
  cardOrigin = `http://localhost:${cardPort}`;

  return {
    entry: `http://127.0.0.1:${billPort}/`,
    billHost: '127.0.0.1',
    cardHost: 'localhost',
    close: async () => {
      await Promise.all([bill, card].map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}
