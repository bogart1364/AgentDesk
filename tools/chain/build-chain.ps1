# Builds the web UI in CHAIN mode: instead of calling the local demo API for
# writes, the UI sends createAgent / setPolicy straight to the Base Sepolia
# contracts from the connected wallet. Use this before serving the UI from the
# chain-mode server, or set the same VITE_ vars in Vercel for production.
$ErrorActionPreference = 'Stop'
$env:VITE_CHAIN_ID = '84532'
$env:VITE_RPC_URL = 'https://sepolia.base.org'
$env:VITE_AGENT_REGISTRY_ADDRESS = '0x4b9F26A00C0c5Cd940221d6A44326F203aa59Be5'
$env:VITE_POLICY_ENGINE_ADDRESS = '0x5545EaC0b1ACadDB117b9E12aE59290cBDe18a4C'
$env:VITE_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
Write-Output "building web (chain mode) ..."
Push-Location (Join-Path $PSScriptRoot '..\..\web')
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "vite build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$hit = Select-String -Path (Join-Path $PSScriptRoot '..\..\web\dist\assets\*.js') -Pattern '0x4b9F26A00C0c5Cd940221d6A44326F203aa59Be5' -List
if ($hit) { Write-Output "OK: dist bundle contains the registry address" }
else { Write-Output "WARNING: registry address not found in dist bundle" }
