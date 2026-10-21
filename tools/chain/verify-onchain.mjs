/**
 * Fetch a Base Verify onchain verification (integration 2 — no API key).
 *
 *   node tools/chain/verify-onchain.mjs                     # uses DEPLOYER_PRIVATE_KEY as the wallet
 *   node tools/chain/verify-onchain.mjs 0xYourWallet 0xPrivKey
 *
 * Prints the exact { identityHash, expiration, signature } to pass to
 * AgentRegistry.createAgent(identityHash, expiration, signature, name, metadataURI),
 * or the 404/400 reason from Base Verify. Docs:
 * https://docs.base.org/sdks/base-verify/verify-users-onchain
 *
 * The SIWE message must use the exact statement below and name our consumer
 * contract in Resources as eip155:<chainId>:<contract>.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const API = (process.env.BASE_VERIFY_API_URL || env.BASE_VERIFY_API_URL || 'https://verify.base.dev/v1').replace(/\/+$/, '');
const APP = (process.env.BASE_VERIFY_APP_URL || env.BASE_VERIFY_APP_URL || 'https://verify.base.dev').replace(/\/+$/, '');
const CHAIN_ID = Number(env.CHAIN_ID || 84532);
const DOMAIN = env.APP_DOMAIN || 'agentdesk.xyz';
const STATEMENT = 'Claim eligibility for a Base Verify onchain benefit.';

const key = process.argv[3] || env.DEPLOYER_PRIVATE_KEY;
if (!key) {
  console.error('No wallet key: pass a private key or set DEPLOYER_PRIVATE_KEY in .env');
  process.exit(1);
}
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
// SIWE must carry an EIP-55 checksummed address or Base Verify rejects the message
const address = getAddress(account.address);
if (process.argv[2] && getAddress(process.argv[2]) !== address) {
  console.error('The message must be signed by the wallet being verified — drop the address argument.');
  process.exit(1);
}

const contract = env.AGENT_REGISTRY_ADDRESS;
if (!/^0x[a-fA-F0-9]{40}$/.test(contract || '')) {
  console.error('AGENT_REGISTRY_ADDRESS is not set in .env');
  process.exit(1);
}

const message = [
  `${DOMAIN} wants you to sign in with your Ethereum account:`,
  address,
  '',
  STATEMENT,
  '',
  `URI: https://${DOMAIN}`,
  'Version: 1',
  `Chain ID: ${CHAIN_ID}`,
  `Nonce: ${crypto.randomBytes(16).toString('hex')}`,
  `Issued At: ${new Date().toISOString()}`,
  `Expiration Time: ${new Date(Date.now() + 600_000).toISOString()}`,
  'Resources:',
  `- eip155:${CHAIN_ID}:${contract}`,
].join('\n');

console.log('wallet  ', address);
console.log('contract', contract);
console.log('endpoint', `${API}/onchain_verifications`);

const signature = await account.signMessage({ message });
const res = await fetch(`${API}/onchain_verifications`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, signature }),
});
const body = await res.json().catch(() => ({}));

if (res.status === 200) {
  console.log('\n200 OK — submit this to AgentRegistry.createAgent:');
  console.log(JSON.stringify(body, null, 2));
} else if (res.status === 404) {
  const code = body.error || 'verification_not_found';
  console.log(`\n404 ${code}`);
  if (code !== 'contract_not_found') {
    console.log('Open this to verify the account, then re-run:');
    console.log(`${APP}?redirect_uri=https://${DOMAIN}&providers=${env.VERIFY_PROVIDER || 'coinbase'}`);
  }
} else if (res.status === 400) {
  const msg = body.message || body.error || 'bad_request';
  console.log(`\n400 ${msg}`, body.details ? JSON.stringify(body.details) : '');
  if (/siwe/i.test(msg)) console.log('Our SIWE message is malformed — this is a client bug, not a policy failure.');
  else console.log('The wallet is verified but does not satisfy this contract\'s policy (coinbase_one_active eq true).');
} else if (res.status === 401) {
  console.log('\n401 unauthorized — wrong or missing key (this endpoint normally needs none).');
} else {
  console.log(`\n${res.status}`, JSON.stringify(body));
}
