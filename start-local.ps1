param(
  [switch]$bot,
  [switch]$stop
)

$root = $PSScriptRoot
$pgBin = "$env:USERPROFILE\.local\pgsql\pgsql\bin"
$pgData = "$env:USERPROFILE\.local\pgsql\data"
$nodeDir = "C:\Program Files\nodejs"
$bunDir = "$env:USERPROFILE\.bun\bin"
$wrangler = "$root\node_modules\.bin\wrangler.exe"
$nodeExe = "$nodeDir\node.exe"
$logs = "$root\.local-logs"

$env:Path = "$pgBin;$nodeDir;$bunDir;$root\node_modules\.bin;$env:Path"
$env:PGPASSWORD = "postgres"
$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgresql://postgres:postgres@localhost:5432/yourrank"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/yourrank"
$env:SESSION_COOKIE_DOMAIN = "localhost"

if ($stop) {
  Write-Host "[stop] Stopping Workers..."
  Get-Process wrangler, workerd -ErrorAction SilentlyContinue | Stop-Process -Force
  Write-Host "[stop] Stopping Postgres..."
  & "$pgBin\pg_ctl.exe" -D "$pgData" stop 2>&1 | Out-Null
  Write-Host "[stop] Done."
  return
}

# 1. Start Postgres if not running
& "$pgBin\pg_isready.exe" -h localhost -q 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[db] Starting Postgres..."
  & "$pgBin\pg_ctl.exe" -D "$pgData" -l "$pgData\logfile.log" start 2>&1 | Out-Null
  Start-Sleep -Seconds 3
}

# 2. Ensure .dev.vars exist
if (-not (Test-Path "$root\apps\leaderboard\.dev.vars")) {
  Copy-Item "$root\apps\leaderboard\.dev.vars.example" "$root\apps\leaderboard\.dev.vars"
}
if ($bot -and -not (Test-Path "$root\apps\bot\.dev.vars")) {
  Copy-Item "$root\apps\bot\.dev.vars.example" "$root\apps\bot\.dev.vars"
}

# 3. Build shared workspace package
Write-Host "[build] Compiling packages/shared..."
& bun run --cwd "$root\packages\shared" build 2>&1 | Out-Null

# 4. Build leaderboard assets (build.js resolves paths relative to apps/leaderboard)
Write-Host "[build] Bundling leaderboard assets..."
Push-Location "$root\apps\leaderboard"
try {
  & $nodeExe "$root\apps\leaderboard\build.js" 2>&1 | Out-Null
} finally {
  Pop-Location
}

# 5. Start Workers
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Write-Host "[dev] Starting leaderboard Worker on http://localhost:8787"
$lbJob = Start-Process -WindowStyle Hidden -FilePath $wrangler -ArgumentList @("dev", "--port", "8787", "--ip", "127.0.0.1") -WorkingDirectory "$root\apps\leaderboard" -RedirectStandardOutput "$logs\lb.log" -RedirectStandardError "$logs\lb.err.log" -PassThru

if ($bot) {
  Write-Host "[dev] Starting bot Worker on http://localhost:8788"
  $botJob = Start-Process -WindowStyle Hidden -FilePath $wrangler -ArgumentList @("dev", "--port", "8788", "--ip", "127.0.0.1") -WorkingDirectory "$root\apps\bot" -RedirectStandardOutput "$logs\bot.log" -RedirectStandardError "$logs\bot.err.log" -PassThru
}

Write-Host ""
Write-Host "[dev] Workers starting (logs in $logs):"
Write-Host "      Leaderboard → http://localhost:8787"
if ($bot) { Write-Host "      Bot         → http://localhost:8788" }
Write-Host "[dev] Press Ctrl+C to stop (or run: start-local.ps1 -stop)"
Write-Host ""

# Wait for Ctrl+C
try {
  while ($true) { Start-Sleep -Seconds 1 }
} finally {
  Write-Host "[stop] Shutting down..."
  if ($lbJob -and -not $lbJob.HasExited) { $lbJob.Kill() }
  if ($botJob -and -not $botJob.HasExited) { $botJob.Kill() }
  Write-Host "[stop] Workers stopped. Postgres is still running."
}
