/**
 * Export ABIs from hardhat artifacts → shared JSON files used by server + web.
 * Run: node scripts/export-abis.js
 */
const fs = require('fs');
const path = require('path');

const targets = ['AgentRegistry', 'PolicyEngine'];
const outDirs = [
  path.join(__dirname, '..', 'abi'),
  path.join(__dirname, '..', '..', 'server', 'src', 'abi'),
  path.join(__dirname, '..', '..', 'web', 'src', 'abi'),
];

for (const name of targets) {
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'src', `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const abi = artifact.abi;
  for (const dir of outDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(abi, null, 2));
  }
  console.log(`ABI exported: ${name}.json (${abi.length} entries) → contracts/abi, server/src/abi, web/src/abi`);
}
