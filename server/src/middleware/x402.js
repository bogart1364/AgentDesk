/**
 * x402 Payment Middleware (AgentDesk) — production edition.
 *
 * HTTP 402 handshake for agent-to-API payments on Base:
 *  1. No PAYMENT-SIGNATURE → 402 challenge (payment requirements)
 *  2. With signature:
 *      a. Policy check → real eth_call canSpend() on PolicyEngine (chain mode)
 *                        or local policy engine (local mode)
 *      b. Settlement → forward signed EIP-3009 payload to x402 facilitator
 *                      (real USDC transfer on Sepolia)
 *                      local mode: mock settle for demo
 *      c. Resource returned + X-Payment-Settlement proof header
 *
 * Payment-SIGNATURE header format (x402 v1 exact scheme):
 *   {
 *     x402Version: 1,
 *     scheme: "exact",
 *     network: "eip155:84532",
 *     payload: { signature, authorization: { from,to,value,validAfter,validBefore,nonce } }
 *   }
 */
import { cfg } from '../config.js';
import * as chain from '../chain.js';
import { policyEngine } from '../db/index.js';

const MICRO_USDC = 10n ** 6n;

/** Parse "$0.01" → 10000 (6-dec) */
export function parsePriceUsd(str) {
  const clean = String(str).replace(/[^0-9.]/g, '');
  const [whole, frac = ''] = clean.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return Number(BigInt(whole || '0') * MICRO_USDC + BigInt(fracPadded));
}

export function formatUsdc(micro) {
  const n = Number(micro) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function parsePaymentHeader(raw) {
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
  } catch {
    try {
      return JSON.parse(String(raw));
    } catch {
      return null;
    }
  }
}

/**
 * Bind the client-supplied EIP-3009 payload to what we actually asked for.
 * The facilitator proves the signature; we must prove the amount/payee match,
 * otherwise a client could settle $0.000001 for a $0.01 resource.
 */
export function validateExactPayment(payment, { payTo, amountMicro, network, usdcAddress }) {
  if (!payment || typeof payment !== 'object') return { ok: false, error: 'not_an_object' };
  if (payment.x402Version !== undefined && Number(payment.x402Version) !== 1) {
    return { ok: false, error: 'unsupported_version' };
  }
  if (String(payment.scheme || '').toLowerCase() !== 'exact') {
    return { ok: false, error: 'unsupported_scheme' };
  }
  if (payment.network && String(payment.network) !== String(network)) {
    return { ok: false, error: 'network_mismatch' };
  }

  const auth = payment.payload?.authorization;
  if (!auth || typeof auth !== 'object') return { ok: false, error: 'missing_authorization' };
  for (const f of ['from', 'to', 'value']) {
    if (!auth[f]) return { ok: false, error: `missing_${f}` };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(auth.from))) return { ok: false, error: 'invalid_from' };
  if (String(auth.to).toLowerCase() !== String(payTo).toLowerCase()) return { ok: false, error: 'wrong_payee' };

  let value;
  try {
    value = BigInt(auth.value);
  } catch {
    return { ok: false, error: 'invalid_value' };
  }
  if (value < BigInt(amountMicro)) return { ok: false, error: 'insufficient_amount' };

  const asset = auth.asset || payment.payload?.asset || payment.asset;
  if (asset && usdcAddress && String(asset).toLowerCase() !== String(usdcAddress).toLowerCase()) {
    return { ok: false, error: 'wrong_asset' };
  }

  const nowS = Math.floor(Date.now() / 1000);
  const validBefore = Number(auth.validBefore ?? payment.payload?.validBefore ?? 0);
  const validAfter = Number(auth.validAfter ?? payment.payload?.validAfter ?? 0);
  if (validBefore && validBefore < nowS) return { ok: false, error: 'expired_authorization' };
  if (validAfter && validAfter > nowS) return { ok: false, error: 'not_yet_valid' };

  return { ok: true, value, from: String(auth.from).toLowerCase() };
}

/**
 * Try real settlement via x402 facilitator (Coinbase-hosted for Base Sepolia).
 * Returns { ok, transaction } or { ok: false, error, mock? }.
 */
async function settleViaFacilitator(payment) {
  if (!cfg.facilitatorUrl) return { ok: false, error: 'facilitator_not_configured' };
  try {
    const res = await fetch(`${cfg.facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payment),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.success || data.transaction)) {
      return { ok: true, transaction: data.transaction || data.tx || data.hash, raw: data };
    }
    return { ok: false, error: data.error || data.message || `facilitator_${res.status}`, raw: data };
  } catch (e) {
    return { ok: false, error: `facilitator_unreachable: ${e.message?.slice(0, 80)}` };
  }
}

/**
 * @param {object} opts
 * @param {string|number} opts.price
 * @param {string} opts.payTo
 * @param {string} [opts.network]   - default from cfg (eip155:84532 on Sepolia)
 * @param {(req)=>number} [opts.getAgentId]
 */
export function paymentMiddleware(opts) {
  const {
    price,
    payTo,
    network = cfg.networkLabel,
    description = 'AgentDesk paid data endpoint',
    getAgentId = (req) => req.headers['x-agent-id'] || req.query.agentId,
  } = opts;

  const amountMicroNum = typeof price === 'string' ? parsePriceUsd(price) : Number(price);
  const amountStr = formatUsdc(amountMicroNum);

  return async function agentDeskPay(req, res, next) {
    // ── 1. 402 challenge ──
    const paymentRaw = req.headers['payment-signature'] || req.headers['x-payment-signature'];
    if (!paymentRaw) {
      res.status(402).json({
        x402Version: 1,
        accepts: [
          {
            scheme: 'exact',
            network,
            maxAmountRequired: String(amountMicroNum),
            asset: 'USDC',
            payTo,
            resource: req.originalUrl,
            description,
            mimeType: 'application/json',
            maxTimeoutSeconds: 60,
            extra: {
              agentDesk: {
                policyMode: cfg.mode,
                docs: 'https://docs.base.org/build-on-base/accept-payments/charge-for-an-api',
              },
            },
          },
        ],
        error: null,
      });
      return;
    }

    const agentId = Number(getAgentId(req));
    if (!agentId) {
      return res.status(400).json({ error: 'missing_agent_id', hint: 'Pass x-agent-id header or ?agentId=' });
    }

    const merchant = payTo.toLowerCase();

    // ── 2. Policy check ──
    let check;
    if (cfg.mode === 'chain') {
      check = await chain.canSpendOnChain(agentId, merchant, amountMicroNum);
    } else {
      check = policyEngine.canSpend(agentId, merchant, amountMicroNum);
    }

    if (!check.allowed) {
      return res.status(403).json({
        error: 'policy_denied',
        reason: check.reason,
        agentId,
        amount: amountStr,
        merchant,
        mode: cfg.mode,
      });
    }

    // ── 3. Settlement ──
    let txHash;
    let settled = false;
    let settleError = null;

    if (cfg.mode === 'chain') {
      // chain mode NEVER gives the resource away for free: the payload must be
      // parseable AND bound to this payee/amount, then settled by the facilitator.
      const payment = parsePaymentHeader(paymentRaw);
      if (!payment) {
        return res.status(402).json({
          error: 'invalid_payment_payload',
          hint: 'PAYMENT-SIGNATURE must be base64-JSON or JSON of an x402 v1 exact-scheme payment.',
        });
      }

      const bound = validateExactPayment(payment, {
        payTo,
        amountMicro: amountMicroNum,
        network,
        usdcAddress: cfg.usdcAddress,
      });
      if (!bound.ok) {
        return res.status(402).json({
          error: 'payment_does_not_match_requirements',
          reason: bound.error,
          required: { network, payTo, amount: String(amountMicroNum), asset: cfg.usdcAddress },
        });
      }

      const result = await settleViaFacilitator(payment);
      if (result.ok) {
        txHash = result.transaction;
        settled = true;
      } else {
        settleError = result.error;
        // if the facilitator cannot settle, deny — never hand out the resource
        return res.status(402).json({
          error: 'settlement_failed',
          detail: settleError,
          hint: 'Facilitator could not settle payment. Retry with valid EIP-3009 payload.',
        });
      }
    } else {
      // local demo mode: deterministic mock tx
      txHash =
        '0x' +
        Buffer.from(`settle:${agentId}:${Date.now()}:${amountMicroNum}`)
          .toString('hex')
          .padEnd(64, '0')
          .slice(0, 64);
      settled = true;

      policyEngine.recordSpend(agentId, merchant, amountMicroNum, req.originalUrl, txHash, check.reason || 'ok');
    }

    req.payment = {
      agentId,
      merchant,
      amountMicro: amountMicroNum,
      amountDisplay: amountStr,
      txHash,
      network,
      settled,
      mode: cfg.mode,
    };

    res.setHeader(
      'X-Payment-Settlement',
      JSON.stringify({
        network,
        transaction: txHash,
        payTo,
        amount: String(amountMicroNum),
        asset: 'USDC',
        mode: cfg.mode,
      })
    );

    next();
  };
}
