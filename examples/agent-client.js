/**
 * Agent-side x402 demo client
 * Run: node examples/agent-client.js
 *
 * Shows the full agent loop:
 *   1. Discover paid resource → GET /api/paid
 *   2. Attempt call → receive 402 Payment Required
 *   3. "Sign" payment → retry with PAYMENT-SIGNATURE
 *   4. Server checks on-chain policy → settle → resource
 *   5. Repeat until policy denies (budget hit) → agent stops
 */

const API = process.env.API || 'http://localhost:8787';
const AGENT_ID = Number(process.env.AGENT_ID || 1);

async function paidCall(slug) {
  const url = `${API}/api/paid/${slug}?agentId=${AGENT_ID}`;

  // attempt without payment
  let res = await fetch(url);
  if (res.status === 402) {
    const challenge = await res.json();
    const req = challenge.accepts[0];

    // production: sign EIP-3009 USDC authorization with agent key via @coinbase/x402
    const paymentSignature = JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: req.network,
      payload: { demo: true, amount: req.maxAmountRequired, payTo: req.payTo },
    });

    res = await fetch(url, { headers: { 'payment-signature': paymentSignature } });
  }
  return res;
}

async function main() {
  console.log(`Agent #${AGENT_ID} starting — API ${API}\n`);

  const catalog = await (await fetch(`${API}/api/paid`)).json();
  console.log('Paid resources:', catalog.map((r) => `${r.slug} (${r.price})`).join(', '), '\n');

  let calls = 0;
  let denied = false;

  while (calls < 60 && !denied) {
    const slug = catalog[calls % catalog.length].slug;
    const res = await paidCall(slug);

    if (res.status === 200) {
      const j = await res.json();
      calls++;
      console.log(
        `✓ call #${calls} ${slug} → ${j.payment.amountDisplay} USDC settled (${j.payment.txHash.slice(0, 14)}…) · resource: ${j.label}`
      );
    } else if (res.status === 403) {
      const j = await res.json();
      denied = true;
      console.log(`\n⛔ POLICY DENIED: ${j.reason}`);
      console.log('   Agent stops spending — policy enforced on-chain. This is the core of AgentDesk.');
    } else {
      console.log(`unexpected ${res.status}`, await res.text());
      denied = true;
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\nSession: ${calls} paid calls, terminated by ${denied ? 'policy' : 'loop limit'}.`);
  console.log('Feed:', `${API}/api/feed`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
