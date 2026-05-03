$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tokenFile = Join-Path $projectRoot "oauth-token-result.json"

if (-not (Test-Path $tokenFile)) {
  throw "Missing oauth-token-result.json. Generate the OAuth refresh token first."
}

$token = Get-Content $tokenFile | ConvertFrom-Json

if (-not $env:DRIVE_ROOT_FOLDER_ID) {
  $env:DRIVE_ROOT_FOLDER_ID = "1iRfZfmsHuWyXf-aNf_SHG0xyr-k3uI5o"
}

$env:LOCAL_MODE = "0"
$env:USE_OAUTH = "1"
$env:GOOGLE_CLIENT_ID = $token.clientId
$env:GOOGLE_CLIENT_SECRET = $token.clientSecret
$env:GOOGLE_REFRESH_TOKEN = $token.refreshToken

if (-not $env:JWT_SECRET) {
  $env:JWT_SECRET = "local_drive_mode_secret_change_me"
}

Set-Location $projectRoot
node server.js
