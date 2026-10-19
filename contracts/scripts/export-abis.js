/**
 * Export ABIs from hardhat artifacts → shared JSON files used by server + web.
 * Run: node scripts/export-abis.js
 */
const fs = require('fs');
const path = require('path');

const targets = ['AgentRegistry', 'PolicyEngine'];
const outDir = path.join(__dirname, '..', 'abi');
fs.mkdirSync(outDir, { recursive: true });

for (const name of targets) {
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'src', `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const abi = artifact.abi;
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(abi, null, 2));
  console.log(`ABI exported: ${name}.json (${abi.length} entries)`);
}
