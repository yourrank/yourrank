$pgBin = "$env:USERPROFILE\.local\pgsql\pgsql\bin"
$pgData = "$env:USERPROFILE\.local\pgsql\data"
$env:Path = "$pgBin;$env:Path"
$env:PGPASSWORD = "postgres"

# Check & start local Postgres if needed
& "$pgBin\pg_isready.exe" -h 127.0.0.1 -p 5432 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Starting local PostgreSQL..." -ForegroundColor Yellow
  Start-Process -FilePath "$pgBin\postgres.exe" -ArgumentList @("-D", "`"$pgData`"") -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgresql://postgres:postgres@localhost:5432/yourrank"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/yourrank"

# Start Next.js marketing app
Start-Process powershell -ArgumentList "-NoExit", "-Command", "bun run --cwd apps/web dev --port 3000"

# Start Bot Worker
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = 'postgresql://postgres:postgres@localhost:5432/yourrank'; bun run --cwd apps/bot dev --port 8788 --ip 127.0.0.1"

# Start Leaderboard Worker
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = 'postgresql://postgres:postgres@localhost:5432/yourrank'; bun run --cwd apps/leaderboard dev --port 8787 --ip 127.0.0.1"

Write-Host "Services started in background windows:" -ForegroundColor Green
Write-Host " - Leaderboard & Dashboard: http://127.0.0.1:8787"
Write-Host "   - Demo Login: http://127.0.0.1:8787/auth/demo"
Write-Host "   - Public Board: http://127.0.0.1:8787/demo-board"
Write-Host " - Telegram Bot Worker: http://127.0.0.1:8788/bot"
Write-Host " - Marketing Homepage: http://localhost:3000"
