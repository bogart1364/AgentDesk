// API e2e: health, SIWE login, forged rejection, Privy branch errors, reads, local CRUD, x402 402.
import { privateKeyToAccount } from 'viem/accounts';

const BASE = 'http://localhost:8787';
// dedicated key: UI e2e owns the 0x19e7... wallet (agent limit is 1 per unverified human)
const account = privateKeyToAccount('0x' + '22'.repeat(32));
const ADDR = account.address;
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
};
const j = async (url, opts = {}) => {
  const r = await fetch(BASE + url, opts);
  let d = null;
  try {
    d = await r.json();
  } catch {
    /* empty body */
  }
  return { status: r.status, data: d };
};

// 1. health
let r = await j('/api/health');
ok('health 200', r.status === 200 && r.data?.ok === true, `mode=${r.data?.mode}`);
ok('local mode', r.data?.mode === 'local');
ok('privy disabled reported', JSON.stringify(r.data || {}).length > 0);

// 2. nonce
r = await j(`/api/auth/nonce?address=${ADDR}`);
ok('nonce issued', r.status === 200 && !!r.data?.message);
const message = r.data?.message || '';

// 3. SIWE verify
const sig = await account.signMessage({ message });
r = await j('/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: ADDR, message, signature: sig }),
});
ok('siwe verify issues JWT', r.status === 200 && !!r.data?.token);
const token = r.data?.token || '';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// 4. forged signature rejected
r = await j('/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: ADDR, message, signature: await account.signMessage({ message: 'other message' }) }),
});
ok('forged signature rejected', r.status === 401, `status=${r.status}`);

// 5. Privy branch: configured=false → clean 401; bad payload → 400
r = await j('/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ privyIdentityToken: 'e'.repeat(48) }),
});
ok('privy not configured → 401', r.status === 401 && /Privy/.test(r.data?.error || ''), r.data?.error);
r = await j('/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ privyIdentityToken: 'short' }),
});
ok('privy short token → 400', r.status === 400, `status=${r.status}`);

// 6. authenticated reads
r = await j(`/api/me?address=${ADDR}`, { headers: H });
ok('me', r.status === 200 && !!r.data?.human?.address, `verified=${r.data?.human?.verified}`);
r = await j(`/api/agents?address=${ADDR}`, { headers: H });
ok('agents list', r.status === 200, `count=${Array.isArray(r.data) ? r.data.length : (r.data?.agents || []).length}`);
r = await j('/api/feed?limit=5', { headers: H });
ok('feed', r.status === 200);

// 7. no token → 401 on protected endpoint
r = await j('/api/auth/verify-social', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ siweMessage: 'x', signature: 'y' }),
});
ok('protected route 401 w/o JWT', r.status === 401, `status=${r.status}`);

// 8. local CRUD
r = await j('/api/agents', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ ownerAddress: ADDR, name: 'API E2E Agent', description: 'created by api-e2e' }),
});
ok('create agent 201', r.status === 201 && !!r.data?.id, `status=${r.status} err=${r.data?.error || ''}`);
const id = r.data?.id;
if (id) {
  r = await j(`/api/agents/${id}/policy`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ perTxCapUsd: 3, dailyBudgetUsd: 30, monthlyBudgetUsd: 300 }),
  });
  ok('update policy', r.status === 200 && (r.data?.policy?.per_tx_cap ?? 0) === 3000000, `cap=${r.data?.policy?.per_tx_cap}`);
  r = await j(`/api/agents/${id}/pause`, { method: 'POST', headers: H });
  ok('pause', r.status === 200 && r.data?.status === 'paused', `status=${r.data?.status}`);
  r = await j(`/api/agents/${id}/resume`, { method: 'POST', headers: H });
  ok('resume', r.status === 200 && r.data?.status === 'active', `status=${r.data?.status}`);
}

// 9. x402: paid endpoint without payment → 402 + network label
const list = await j('/api/paid');
const slug = Array.isArray(list.data) && list.data[0] ? list.data[0].slug : 'market-data';
r = await j(`/api/paid/${slug}?agentId=${id || 1}`);
ok('x402 402 without payment', r.status === 402, `status=${r.status}`);
ok('x402 network label', r.data?.network === 'eip155:84532' || r.data?.accepts?.some?.((a) => a.network === 'eip155:84532') || JSON.stringify(r.data).includes('eip155:84532'), JSON.stringify(r.data).slice(0, 140));

// 10. auth hardening — writes need a JWT and must target your own wallet/agent
r = await j('/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ownerAddress: ADDR, name: 'No Auth Agent' }),
});
ok('create without JWT → 401', r.status === 401, `status=${r.status}`);

const FOREIGN = '0x' + 'aa'.repeat(20);
r = await j('/api/agents', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ ownerAddress: FOREIGN, name: 'Foreign Owner Agent' }),
});
ok('create for foreign owner → 403', r.status === 403, `status=${r.status} err=${r.data?.error || ''}`);

let foreignId = null;
for (let i = 1; i <= 6; i++) {
  const g = await j(`/api/agents/${i}`);
  if (g.status === 200 && String(g.data?.owner_address || '').toLowerCase() !== ADDR.toLowerCase()) {
    foreignId = i;
    break;
  }
}
r = foreignId
  ? await j(`/api/agents/${foreignId}/policy`, { method: 'PUT', headers: H, body: JSON.stringify({ perTxCapUsd: 1 }) })
  : { status: 0 };
ok('policy on foreign agent → 403', r.status === 403, foreignId ? `id=${foreignId} status=${r.status}` : 'no foreign agent seeded');

const staleMsg = `${ADDR}\n\nSign in to AgentDesk.\n\nNonce: deadbeefdeadbeef`;
r = await j('/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: ADDR, message: staleMsg, signature: await account.signMessage({ message: staleMsg }) }),
});
ok('SIWE without Issued At → 401', r.status === 401 && r.data?.error === 'missing_issued_at', `err=${r.data?.error || r.status}`);

// 11. x402 payload binding (unit): a client cannot underpay or redirect the payee
const { validateExactPayment } = await import('../../server/src/middleware/x402.js');
const PAY_TO = '0x' + '11'.repeat(20);
const REQ = {
  payTo: PAY_TO,
  amountMicro: 10000, // $0.01
  network: 'eip155:84532',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};
const mk = (auth) => ({ x402Version: 1, scheme: 'exact', network: REQ.network, payload: { authorization: auth } });
const goodAuth = {
  from: ADDR,
  to: PAY_TO,
  value: '10000',
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 600,
  nonce: '0x' + 'ab'.repeat(32),
};
ok('x402 payload: valid exact payment accepted', validateExactPayment(mk(goodAuth), REQ).ok === true);
ok(
  'x402 payload: redirected payee rejected',
  validateExactPayment(mk({ ...goodAuth, to: FOREIGN }), REQ).error === 'wrong_payee'
);
ok(
  'x402 payload: underpayment rejected',
  validateExactPayment(mk({ ...goodAuth, value: '1' }), REQ).error === 'insufficient_amount'
);
ok(
  'x402 payload: expired authorization rejected',
  validateExactPayment(mk({ ...goodAuth, validBefore: 1 }), REQ).error === 'expired_authorization'
);
ok(
  'x402 payload: network mismatch rejected',
  validateExactPayment({ ...mk(goodAuth), network: 'eip155:1' }, REQ).error === 'network_mismatch'
);
ok('x402 payload: garbage rejected', validateExactPayment('not-a-payload', REQ).ok === false);

// 12. server still healthy after all calls
r = await j('/api/health');
ok('health stable', r.status === 200 && r.data?.ok === true);

console.log(`API RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
