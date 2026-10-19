param(
  [Parameter(Mandatory = $true)][string]$Address,
  [int]$Secs = 300,
  [int]$Workers = 0,
  [int]$Diff = 3,
  [switch]$Claim
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = 'https://openfaucet.org'
$valuePerNonce = 0.002
$minClaim = 0.01

if ($Address -notmatch '^0x[0-9a-fA-F]{40}$') { throw "invalid address: $Address" }

Write-Output "[1/3] session from $base ..."
$sess = curl.exe -s "$base/api/session?chainId=BASE_SEPOLIA" | ConvertFrom-Json
if (-not $sess.preimg) { throw "could not get session" }
Write-Output "      preimg=$($sess.preimg) timestamp=$($sess.timestamp) difficulty=$($sess.difficulty)"

$env:MINE_PREIMG = $sess.preimg
$env:MINE_TS = $sess.timestamp
$env:MINE_WALLET = $Address
$env:MINE_TOKEN = $sess.chainId
$env:MINE_DIFF = $sess.difficulty
$env:MINE_MS = "$($Secs * 1000)"

if ($Workers -le 0) { $Workers = [Math]::Min([Math]::Max([int]$env:NUMBER_OF_PROCESSORS - 1, 1), 8) }
$work = Join-Path $env:TEMP ("agentdesk-mine-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Output "[2/3] mining with $Workers worker(s) for $Secs s ..."
$procs = @()
for ($i = 0; $i -lt $Workers; $i++) {
  $env:MINE_ID = "$i"
  $procs += Start-Process -FilePath 'node' -ArgumentList (Join-Path $here 'mine.cjs') -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $work "out_$i.txt") -RedirectStandardError (Join-Path $work "err_$i.txt")
}
$deadline = (Get-Date).AddSeconds($Secs + 30)
while ((Get-Date) -lt $deadline -and @($procs | Where-Object { -not $_.HasExited }).Count -gt 0) { Start-Sleep -Seconds 5 }
foreach ($p in $procs) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }

$nonces = @()
foreach ($f in Get-ChildItem (Join-Path $work 'out_*.txt')) {
  foreach ($line in Get-Content $f.FullName) {
    if ($line -like 'NONCE *') { $nonces += $line.Split(' ')[1] }
  }
}
$nonces = @($nonces | Sort-Object -Unique)
$amount = [Math]::Round($nonces.Count * $valuePerNonce, 6)
Write-Output "      valid nonces: $($nonces.Count)  (~$amount ETH)"
if ($nonces.Count -eq 0) { Write-Output '      nothing found - try more -Secs'; exit 1 }

if (-not $Claim) {
  Write-Output "[3/3] not claiming (pass -Claim to submit). Nonces:"
  $nonces | ForEach-Object { Write-Output "      $_" }
  exit 0
}
if ($amount -lt $minClaim) {
  Write-Output "[3/3] need at least $minClaim ETH worth of nonces ($([int]($minClaim / $valuePerNonce)) nonces) - increase -Secs / -Workers"
  exit 1
}

$body = @{
  chainId   = 'BASE_SEPOLIA'
  wallet    = $Address
  nonces    = $nonces
  timestamp = [int64]$sess.timestamp
} | ConvertTo-Json -Compress
$bodyFile = Join-Path $work 'claim.json'
[System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "[3/3] claiming $amount ETH to $Address ..."
$resp = curl.exe -s -X POST "$base/api/claim/evm" `
  -H 'Content-Type: application/json' -H "Referer: $base/base-sepolia" -H "Origin: $base" -H 'User-Agent: Mozilla/5.0' `
  "--data-binary=@$bodyFile"
Write-Output $resp
