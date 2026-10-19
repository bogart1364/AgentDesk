# Runs the full e2e suite twice (cleanup + fresh server each cycle), then leaves
# the server running so the platform is immediately usable at localhost:8787.
param([switch]$NoLeaveUp)

$AD = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TESTS = $PSScriptRoot

function Stop-Port8787 {
  $l = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) {
    Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1200
  }
}

function Start-Server {
  param([string]$Tag)
  $out = "$env:TEMP\ad_out_$Tag.txt"
  $err = "$env:TEMP\ad_err_$Tag.txt"
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath 'node' -ArgumentList 'src\index.js' -WorkingDirectory "$AD\server" `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  $up = $false
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 700
    try { Invoke-WebRequest -Uri 'http://localhost:8787/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true; break } catch {}
  }
  if (-not $up) {
    Write-Output "[$Tag] SERVER-DOWN"
    Get-Content $err -ErrorAction SilentlyContinue | Select-Object -First 10
    return $null
  }
  return $p
}

function Run-Cycle {
  param([int]$n)
  Stop-Port8787
  node "$TESTS\cleanup.mjs"
  $p = Start-Server -Tag "c$n"
  if (-not $p) { return $false }
  Write-Output "[c$n] SERVER-UP pid=$($p.Id)"
  node "$TESTS\api-e2e.mjs"; $a = $LASTEXITCODE
  node "$TESTS\ui-e2e.mjs"; $u = $LASTEXITCODE
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Write-Output "[c$n] API-EXIT=$a UI-EXIT=$u"
  return ($a -eq 0 -and $u -eq 0)
}

$c1 = Run-Cycle -n 1
Write-Output "CYCLE-1: $c1"
$c2 = Run-Cycle -n 2
Write-Output "CYCLE-2: $c2"
Write-Output "REPEATABILITY: c1=$c1 c2=$c2"

if ($c1 -and $c2 -and -not $NoLeaveUp) {
  Stop-Port8787
  node "$TESTS\cleanup.mjs"
  $final = Start-Server -Tag 'final'
  if ($final) {
    $h = (Invoke-WebRequest -Uri 'http://localhost:8787/api/health' -UseBasicParsing).Content
    Write-Output "FINAL-SERVER-UP pid=$($final.Id) $h"
  } else {
    Write-Output 'FINAL-SERVER-DOWN'
  }
}

if (-not ($c1 -and $c2)) { exit 1 }
Write-Output 'E2E-SCRIPT-DONE'
