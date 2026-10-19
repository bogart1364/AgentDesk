// Removes agents owned by the e2e wallets so agent-limit (1) tests are repeatable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = path.join(ROOT, 'server', 'src', 'db', 'agentdesk-data.json');
const OWNERS = [
  '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a', // UI e2e wallet (0x11 key)
  '0x1563915e194d8cfba1943570603f7606a3115508', // API e2e wallet (0x22 key)
];

const db = JSON.parse(fs.readFileSync(P, 'utf8'));
const ids = (db.agents || [])
  .filter((a) => OWNERS.includes(String(a.owner_address).toLowerCase()))
  .map((a) => a.id);
if (!ids.length) {
  console.log('[cleanup] nothing to remove');
  process.exit(0);
}
db.agents = db.agents.filter((a) => !ids.includes(a.id));
for (const id of ids) delete db.policies[String(id)];
for (const id of ids) delete db.allowlist[String(id)];
db.spendLogs = (db.spendLogs || []).filter((l) => !ids.includes(l.agent_id));
fs.writeFileSync(P, JSON.stringify(db));
console.log(`[cleanup] removed agents ${ids.join(',')}`);
