import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { privateKeyToAccount } from 'viem/accounts';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const account = privateKeyToAccount('0x' + '11'.repeat(32));
const ADDR = account.address;
const log = (...a) => console.log('[ui]', ...a);
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tmp', 'e2e');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => log('PAGEERROR:', String(e).slice(0, 200)));
await page.setViewport({ width: 1440, height: 900 });

await page.exposeFunction('__nodeSign', (msg) => account.signMessage({ message: msg }));
await page.evaluateOnNewDocument((addr) => {
  window.ethereum = {
    isMetaMask: true,
    chainId: '0x14a34',
    selectedAddress: addr.toLowerCase(),
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [addr];
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'personal_sign' || method === 'eth_sign') {
        const raw = method === 'personal_sign' ? params[0] : params[1];
        const msg = /^0x[0-9a-fA-F]*$/.test(raw)
          ? new TextDecoder().decode(Uint8Array.from(raw.slice(2).match(/.{1,2}/g).map((b) => parseInt(b, 16))))
          : raw;
        return await window.__nodeSign(msg);
      }
      throw new Error('unsupported method: ' + method);
    },
    on() {},
    removeListener() {},
    once() {},
  };
}, ADDR);

const txt = () => page.evaluate(() => document.body.innerText);
const clickByText = (pat) =>
  page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const b = [...document.querySelectorAll('button')].find((x) => rx.test(x.innerText));
    if (b) { b.click(); return b.innerText.trim().slice(0, 50); }
    return null;
  }, typeof pat === 'string' ? pat : pat.source);

// â”€â”€ 1. landing: no login box in hero; header button opens modal â”€â”€
await page.goto('http://localhost:8787', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));
let t = await txt();
const hasWalletAccessInPage = t.includes('WALLET ACCESS');
log('hero has login box (must be false):', hasWalletAccessInPage);
await page.screenshot({ path: shot('landing.png') });

const headerBtn = await clickByText('Connect & Login');
log('header button clicked:', headerBtn);
await new Promise((r) => setTimeout(r, 700));
t = await txt();
const modalOpen = t.includes('WALLET ACCESS') && t.includes('Connect your wallet');
log('modal opened:', modalOpen);
const coinbasePresent = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((x) => /Continue with Coinbase Wallet/i.test(x.innerText))
);
log('coinbase button present (not clicked â€” needs real extension):', coinbasePresent);
await page.screenshot({ path: shot('modal.png') });

if (!modalOpen) {
  log('FAIL: modal did not open');
  await browser.close();
  process.exit(1);
}

// â”€â”€ 2. login via injected fallback (Browser Wallet) â”€â”€
const browserBtn = await clickByText('Browser Wallet');
log('clicked Browser Wallet:', browserBtn);
await new Promise((r) => setTimeout(r, 4000));
t = await txt();
const authedOk = t.includes('AUTHENTICATED');
log('signed-in state (AUTHENTICATED):', authedOk);

// enter console
const enter = await clickByText('Enter Console');
log('clicked Enter Console:', enter);
await new Promise((r) => setTimeout(r, 1500));
t = await txt();
const inConsole = t.includes('Sign Out') && t.includes('Dashboard');
log('in console:', inConsole);
const modeLine = t.split('\n').find((l) => /MODE/.test(l));
log('mode banner:', modeLine?.trim().slice(0, 90));
await page.screenshot({ path: shot('console.png') });

// â”€â”€ 2.5. create agent (local mode) â†’ toast must disappear after ~3s â”€â”€
await clickByText('Create Agent');
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => {
  const el = document.querySelector('input[placeholder="e.g. Market Scout"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'UI Toast Agent');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const deployBtn = await clickByText('Deploy Agent');
log('clicked Deploy Agent:', deployBtn);
let toastShownAt = null;
let toastGoneAt = null;
const pollStart = Date.now();
while (Date.now() - pollStart < 8000) {
  const has = (await txt()).includes('Agent deployed');
  if (has && toastShownAt === null) toastShownAt = Date.now();
  if (toastShownAt !== null && !has) {
    toastGoneAt = Date.now();
    break;
  }
  await new Promise((r) => setTimeout(r, 150));
}
const toastMs = toastShownAt && toastGoneAt ? toastGoneAt - toastShownAt : null;
log('toast visible ms:', toastMs === null ? 'NEVER-DISAPPEARED' : toastMs);
const toastOk = toastMs !== null && toastMs >= 2400 && toastMs <= 4200;
log('toast 3s timing:', toastOk ? 'OK' : 'FAIL');
const agentPageOk = (await txt()).includes('UI Toast Agent');
log('created agent visible on detail page:', agentPageOk);
await page.screenshot({ path: shot('toast.png') });

// â”€â”€ 3. sign out â†’ gate still works â”€â”€
await clickByText('Sign Out');
await new Promise((r) => setTimeout(r, 900));
t = await txt();
const gateOk = t.includes('Authentication required');
log('gate after sign out:', gateOk);

const glyphs = await page.evaluate(() => (document.body.innerText.match(/[â†’â†âœ”âœ…âŒðŸ”¥ðŸš€âš¡ï¸ðŸŽ‰]/g) || []).join(''));
log('glyphs:', glyphs || 'CLEAN');

const results = {
  'modal opened': modalOpen,
  authenticated: authedOk,
  'enter console': enter !== null && inConsole,
  'toast 3s timing': toastOk,
  'agent detail': agentPageOk,
  'gate works': gateOk,
  'glyphs clean': glyphs === '',
};
const failed = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
log('SUMMARY:', failed.length === 0 ? 'ALL PASS' : 'FAILED: ' + failed.join(', '));
await browser.close();
log('DONE');
process.exit(failed.length ? 1 : 0);

