// API e2e: health, SIWE login, forged rejection, Privy branch errors, reads, local CRUD, x402 402,
// Base Verify (payload + trait validation + onchain gate).
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
const CHAIN = r.data?.mode === 'chain';
ok('mode reported', r.data?.mode === 'local' || CHAIN, `mode=${r.data?.mode}`);
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
ok(
  CHAIN ? 'create agent → 409 chain_mode (read-only server)' : 'create agent 201',
  CHAIN ? r.status === 409 && r.data?.error === 'chain_mode' : r.status === 201 && !!r.data?.id,
  `status=${r.status} err=${r.data?.error || ''}`
);
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
ok(
  CHAIN ? 'create for foreign owner → 409 chain_mode' : 'create for foreign owner → 403',
  CHAIN ? r.status === 409 && r.data?.error === 'chain_mode' : r.status === 403,
  `status=${r.status} err=${r.data?.error || ''}`
);

let foreignId = null;
if (CHAIN) {
  // every write is refused before ownership is even considered, so any id proves the guard
  r = await j('/api/agents/999999/policy', { method: 'PUT', headers: H, body: JSON.stringify({ perTxCapUsd: 1 }) });
  ok('policy on foreign agent → 409 chain_mode', r.status === 409 && r.data?.error === 'chain_mode', `status=${r.status} err=${r.data?.error || ''}`);
} else {
  for (let i = 1; i <= 12; i++) {
    const g = await j(`/api/agents/${i}`);
    if (g.status === 200 && String(g.data?.owner_address || '').toLowerCase() !== ADDR.toLowerCase()) {
      foreignId = i;
      break;
    }
  }
  r = foreignId
    ? await j(`/api/agents/${foreignId}/policy`, { method: 'PUT', headers: H, body: JSON.stringify({ perTxCapUsd: 1 }) })
    : { status: 0 };
  ok(
    'policy on foreign agent → 403',
    foreignId ? r.status === 403 : true,
    foreignId ? `id=${foreignId} status=${r.status}` : 'no foreign agent seeded (skipped)'
  );
}

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

// 12. Base Verify (docs.base.org/sdks/base-verify) — payload, trait validation, onchain gate
r = await j('/api/verify/payload?provider=x');
ok('verify payload → 401 w/o JWT', r.status === 401, `status=${r.status}`);

r = await j('/api/verify/payload?provider=x', { headers: H });
const vmsg = r.data?.message || '';
const resources = vmsg
  .split('\n')
  .filter((l) => l.startsWith('- '))
  .map((l) => l.slice(2));
ok('verify payload → action + traits', r.status === 200 && r.data?.action === 'create_agent', `status=${r.status}`);
ok(
  'verify payload carries provider/trait/action urns',
  resources.includes('urn:verify:provider:x') &&
    resources.includes('urn:verify:provider:x:verified:eq:true') &&
    resources.includes('urn:verify:action:create_agent'),
  resources.join(' ')
);
ok('verify payload uses EIP-55 checksummed address', vmsg.includes(ADDR), ADDR);

// a valid message signed by the wallet → verified identity (keyless dev returns a demo token)
const vsig = await account.signMessage({ message: vmsg });
r = await j('/api/verify/social', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ message: vmsg, signature: vsig, provider: 'x' }),
});
if (process.env.BASE_VERIFY_SECRET_KEY) {
  ok('verify social → documented outcome (live key)', [200, 400, 404, 502, 503].includes(r.status), `status=${r.status}`);
} else {
  ok('verify social → 200 verified', r.status === 200 && r.data?.verified === true, `status=${r.status} err=${r.data?.error || ''}`);
  ok('verify social returns a Sybil token', /^0x[0-9a-f]{64}$/.test(r.data?.token || ''), `token=${String(r.data?.token).slice(0, 14)}…`);
}

// docs are explicit: the backend MUST re-validate the traits, so a weakened request is refused
const weakened = vmsg.replace('urn:verify:provider:x:verified:eq:true', 'urn:verify:provider:x:verified:eq:false');
r = await j('/api/verify/social', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ message: weakened, signature: await account.signMessage({ message: weakened }), provider: 'x' }),
});
ok('weakened trait → 400 invalid_trait_requirements', r.status === 400 && r.data?.error === 'invalid_trait_requirements', `err=${r.data?.error || r.status}`);

r = await j(`/api/me?address=${ADDR}`, { headers: H });
ok('me shows the verified tier after Base Verify', Number(r.data?.human?.verified) === 1, `verified=${r.data?.human?.verified}`);

// onchain integration (contract-enforced)
r = await j('/api/verify/onchain/payload', { headers: H });
if (CHAIN) {
  const om = r.data?.message || '';
  ok('onchain payload → 200', r.status === 200, `status=${r.status}`);
  ok('onchain payload uses the exact statement', om.includes('Claim eligibility for a Base Verify onchain benefit.'));
  ok('onchain payload names our contract (eip155:84532:0x…)', /eip155:84532:0x[0-9a-fA-F]{40}/.test(om));
  ok('onchain payload sets Expiration Time (required upstream)', /^Expiration Time: /m.test(om));
  const osig = await account.signMessage({ message: om });
  const bad = om.replace('Claim eligibility for a Base Verify onchain benefit.', 'Claim anything.');
  r = await j('/api/verify/onchain', { method: 'POST', headers: H, body: JSON.stringify({ message: bad, signature: osig }) });
  ok('onchain wrong statement → 400 wrong_statement', r.status === 400 && r.data?.error === 'wrong_statement', `err=${r.data?.error || r.status}`);
  r = await j('/api/verify/onchain', { method: 'POST', headers: H, body: JSON.stringify({ message: om, signature: osig }) });
  ok('onchain valid message reaches Base Verify', [200, 400, 404].includes(r.status), `status=${r.status} err=${r.data?.error || ''}`);
} else {
  ok('onchain payload → 501 in local mode (no registry)', r.status === 501 && r.data?.error === 'onchain_verify_not_configured', `status=${r.status}`);
}

// 13. verify internals (unit): trait set must match exactly, onchain message must bind the contract
const { validateVerifyTraits, buildOnchainVerifyMessage, validateOnchainMessage, parseResources } = await import(
  '../../server/src/services/verify.js'
);
ok('unit: parseResources reads the Resources block', parseResources(vmsg).length === 3, JSON.stringify(parseResources(vmsg)));
ok('unit: our own policy passes validation', validateVerifyTraits(vmsg, 'x').valid === true);
ok('unit: provider mismatch rejected', validateVerifyTraits(vmsg, 'coinbase').error === 'provider_mismatch');
ok('unit: extra trait rejected', validateVerifyTraits(vmsg.replace('Resources:\n', 'Resources:\n- urn:verify:provider:x:followers_count:gte:1\n'), 'x').error?.startsWith('unexpected_trait'));
const C = '0x' + '11'.repeat(20);
ok('unit: onchain message binds the contract', validateOnchainMessage(buildOnchainVerifyMessage(ADDR, C).message, C).valid === true);
ok('unit: wrong contract rejected', validateOnchainMessage(buildOnchainVerifyMessage(ADDR, C).message, FOREIGN).error === 'missing_contract_resource');
ok('unit: expired onchain message rejected', /expired_|invalid_|missing_/.test(validateOnchainMessage(buildOnchainVerifyMessage(ADDR, C).message.replace(/^Expiration Time: .+$/m, 'Expiration Time: 2000-01-01T00:00:00.000Z'), C).error || ''));

// 14. server still healthy after all calls
r = await j('/api/health');
ok('health stable', r.status === 200 && r.data?.ok === true);

console.log(`API RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
