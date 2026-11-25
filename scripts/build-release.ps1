# Builds the installer of a release and signs it for the updater.
# The private key and its password are read from the folder of the keys outside the repository (see README.txt there); they are
# put into the environment of this build only and are never written anywhere.
# Usage: pwsh scripts/build-release.ps1 "<one general sentence about the release>"
param([string]$Notes = "")
$ErrorActionPreference = "Stop"
$keys = if ($env:TYPENOVA_KEYS) { $env:TYPENOVA_KEYS } else { "D:/KeysCerts/typenova" }
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$keys/updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$keys/updater-key-password.txt" -Raw).Trim()
npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw "the build failed" }
node scripts/make-latest-json.mjs $Notes
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
