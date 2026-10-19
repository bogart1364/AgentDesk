const DURATION = Number(process.env.MINE_MS || 60000);
const ID = Number(process.env.MINE_ID || 0);
const PREIMG = process.env.MINE_PREIMG;
const TS = process.env.MINE_TS;
const WALLET = process.env.MINE_WALLET;
const TOKEN = process.env.MINE_TOKEN || 'BASE_SEPOLIA';
const DIFF = Number(process.env.MINE_DIFF || 3);

const nonces = [];
let attempts = 0;

const realLog = console.log.bind(console);
console.log = (...a) => {
  const s = a.map(String).join(' ');
  if (s.includes('minerrrrr') || s.includes('Starting Miner')) return;
  realLog(...a);
};

globalThis.__onMsg = (m) => {
  if (!m) return;
  if (m.type === 'progress') { attempts = m.attempts; return; }
  if (m.nonce) {
    if (!nonces.includes(m.nonce)) {
      nonces.push(m.nonce);
      realLog(`NONCE ${m.nonce} ${m.result}`);
    }
  }
};

globalThis.self = globalThis;
globalThis.postMessage = (m) => { if (globalThis.__onMsg) globalThis.__onMsg(m); };

require('./PoWMiner.js');

globalThis.__setHandler({
  data: {
    action: 'start',
    id: ID,
    preimg: PREIMG,
    timestamp: TS,
    wallet: WALLET,
    token: TOKEN,
    difficulty: DIFF,
  },
});

const keepAlive = setInterval(() => {}, 1000);

setTimeout(() => {
  clearInterval(keepAlive);
  realLog(`RESULT ${JSON.stringify({ id: ID, attempts, count: nonces.length, nonces })}`);
  process.exit(0);
}, DURATION);

