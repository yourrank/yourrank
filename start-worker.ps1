$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgresql://postgres:postgres@localhost:5432/yourrank"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/yourrank"
$env:ALLOW_DEMO_LOGIN = "true"
$env:DEMO_USER_EMAIL = "admin@yourrank.site"

Set-Location "$PSScriptRoot\apps\leaderboard"
& "$PSScriptRoot\node_modules\.bin\wrangler.exe" dev --port 8787 --ip 127.0.0.1 2>&1
