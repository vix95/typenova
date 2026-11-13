<#
  Installs the isolated test installer (identifier pl.itvix.typenova.e2e, product TypeNovaE2E) silently for the current user, checks that the installed program works,
  uninstalls it silently and lists everything that is still on the computer. It never touches a real TypeNova installation or its data (other names, other folders).

  Build the installer first:   $env:CARGO_TARGET_DIR = "src-tauri\target-e2e"; npx tauri build --bundles nsis --config e2e\tauri.e2e.conf.json
  Run:                         powershell -ExecutionPolicy Bypass -File e2e\installer-check.ps1

  Exit code 0: installed, worked, and left nothing behind.
#>
param(
  [string]$Installer = (Get-ChildItem (Join-Path $PSScriptRoot "..\src-tauri\target-e2e\release\bundle\nsis\*_x64-setup.exe") | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
)
$ErrorActionPreference = "Stop"
$product = "TypeNovaE2E"; $identifier = "pl.itvix.typenova.e2e"; $manufacturer = "itvix"
$installDir = Join-Path $env:LOCALAPPDATA $product      # where a silent install of the per-user installer puts the program
$dataDirs = @((Join-Path $env:APPDATA $identifier), (Join-Path $env:LOCALAPPDATA $identifier))
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
$manufacturerKey = "HKCU:\Software\$manufacturer"
$ownFolders = @($installDir) + $dataDirs
$classes = @("Markdown document", "Mermaid diagram")
$extensions = @("md", "markdown", "mdown", "mkd", "mdx", "rmd", "qmd", "mdc", "mmd", "mermaid")

# What of the program is on the computer: folders (each once, with its file count), shortcuts and registry keys.
function Snapshot {
  $items = New-Object System.Collections.Generic.List[string]
  foreach ($path in $ownFolders) {
    if (Test-Path -LiteralPath $path) { $count = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object).Count; $items.Add("folder: $path ($count files)") }
  }
  foreach ($lnk in @((Join-Path $startMenu "$product.lnk"), (Join-Path $startMenu $product), (Join-Path ([Environment]::GetFolderPath("Desktop")) "$product.lnk"))) {
    if (Test-Path -LiteralPath $lnk) { $items.Add("shortcut: $lnk") }
  }
  foreach ($key in @($uninstallKey, "$manufacturerKey\$product", $manufacturerKey)) { if (Test-Path -LiteralPath $key) { $items.Add("registry: $key") } }
  # File types: the installer makes the program the owner of its extensions (and keeps what was there in "<class>_backup" values); the classes themselves are keys of their own.
  foreach ($class in $classes) { if (Test-Path -LiteralPath "HKCU:\Software\Classes\$class") { $items.Add("registry: file class '$class'") } }
  foreach ($ext in $extensions) {
    $key = "HKCU:\Software\Classes\.$ext"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $values = Get-ItemProperty -LiteralPath $key
    $default = $values."(default)"
    if ($classes -contains $default) { $items.Add("registry: .$ext is still owned by '$default'") }
    foreach ($class in $classes) { if ($values.PSObject.Properties.Name -contains "$($class)_backup") { $items.Add("registry: .$ext still has the value '$($class)_backup'") } }
    $others = @($values.PSObject.Properties | Where-Object { $_.Name -notlike "PS*" -and $_.Name -ne "(default)" })
    if (-not $others.Count -and [string]::IsNullOrEmpty($default)) { $items.Add("registry: .$ext is an empty key") }
  }
  $run = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
  if ($run -and $run.PSObject.Properties.Name -contains $product) { $items.Add("registry: Run\$product") }
  return $items
}

if (-not $Installer -or -not (Test-Path $Installer)) { throw "no installer found: build it first (see the top of this file)" }
Write-Host "Installer: $Installer ($([math]::Round((Get-Item $Installer).Length / 1MB, 2)) MB)"
if (Get-Process typenova -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" }) { throw "the test program is running from the install folder; close it first" }

$before = Snapshot
if ($before.Count) {
  Write-Host "Removing what earlier runs of the test program left (its own folders and keys only):"; $before | ForEach-Object { Write-Host "  $_" }
  foreach ($path in $ownFolders) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue }
  foreach ($key in @($uninstallKey, "$manufacturerKey\$product")) { Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction SilentlyContinue }
  foreach ($class in $classes) { Remove-Item -LiteralPath "HKCU:\Software\Classes\$class" -Recurse -Force -ErrorAction SilentlyContinue }
  foreach ($ext in $extensions) {
    $key = "HKCU:\Software\Classes\.$ext"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    foreach ($class in $classes) { Remove-ItemProperty -LiteralPath $key -Name "$($class)_backup" -ErrorAction SilentlyContinue }
    if ($classes -contains (Get-ItemProperty -LiteralPath $key)."(default)") { Set-Item -LiteralPath $key -Value "" }
    $others = @((Get-ItemProperty -LiteralPath $key).PSObject.Properties | Where-Object { $_.Name -notlike "PS*" -and $_.Name -ne "(default)" })
    if (-not $others.Count -and [string]::IsNullOrEmpty((Get-ItemProperty -LiteralPath $key)."(default)")) { & reg delete "HKCU\Software\Classes\.$ext" /f 2>&1 | Out-Null }
  }
  $before = Snapshot
  if ($before.Count) { throw "could not clean the start state: $($before -join '; ')" }
}

# 1. Install (silent, for the current user: no administrator rights needed).
Write-Host "`n== Install =="
$install = Start-Process $Installer -ArgumentList "/S" -Wait -PassThru
Write-Host "installer exit code: $($install.ExitCode)"
$exe = Join-Path $installDir "typenova.exe"
$failures = New-Object System.Collections.Generic.List[string]
if ($install.ExitCode -ne 0) { $failures.Add("the installer exited with code $($install.ExitCode)") }
if (-not (Test-Path $exe)) { $failures.Add("the program was not installed at $exe") }
if (-not (Test-Path (Join-Path $installDir "uninstall.exe"))) { $failures.Add("no uninstaller in the install folder") }
if (-not (Test-Path $uninstallKey)) { $failures.Add("not listed in Apps & features (no uninstall key)") }
else { $entry = Get-ItemProperty $uninstallKey; Write-Host ("listed as '{0}' {1}, publisher {2}, size {3} KB" -f $entry.DisplayName, $entry.DisplayVersion, $entry.Publisher, $entry.EstimatedSize) }
if (-not (Test-Path (Join-Path $startMenu "$product.lnk"))) { $failures.Add("no Start menu shortcut") }
if (Test-Path $installDir) { Write-Host ("installed files: {0} ({1} MB)" -f (Get-ChildItem $installDir -Recurse -File).Count, [math]::Round(((Get-ChildItem $installDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)) }

# 2. Does the installed program work?
if (Test-Path $exe) {
  Write-Host "`n== Run the installed program =="
  $env:TYPENOVA_E2E_EXE = $exe
  Push-Location (Join-Path $PSScriptRoot "..")
  try { & node --test --test-concurrency=1 e2e/installed.e2e.mjs; if ($LASTEXITCODE -ne 0) { $failures.Add("the installed program failed its smoke test") } }
  finally { Pop-Location; Remove-Item Env:TYPENOVA_E2E_EXE -ErrorAction SilentlyContinue }
  $existing = $dataDirs | Where-Object { Test-Path -LiteralPath $_ }
  Write-Host ("program data now: " + ($existing -join ", "))
  if (-not $existing) { $failures.Add("the program created no data folder (nothing to clean: the check would mean nothing)") }
}

# 3. Uninstall (silent). The uninstaller copies itself to a temporary folder and returns at once, so wait until the install folder is gone.
Write-Host "`n== Uninstall =="
Get-Process typenova -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" } | Stop-Process -Force
$uninstaller = Join-Path $installDir "uninstall.exe"
if (Test-Path $uninstaller) {
  $uninstall = Start-Process $uninstaller -ArgumentList "/S" -Wait -PassThru
  Write-Host "uninstaller exit code: $($uninstall.ExitCode)"
  for ($i = 0; $i -lt 120 -and (Test-Path -LiteralPath $installDir); $i++) { Start-Sleep -Milliseconds 500 }
}
Start-Sleep -Seconds 3

# 4. What is left?
Write-Host "`n== Left on the computer after uninstalling =="
$after = Snapshot
if ($after.Count) { $after | ForEach-Object { Write-Host "  $_" }; $failures.Add("$($after.Count) things were left behind") } else { Write-Host "  nothing" }

Write-Host ""
if ($failures.Count) { Write-Host "FAILED:"; $failures | ForEach-Object { Write-Host "  - $_" }; exit 1 }
Write-Host "OK: installed, worked, and uninstalled without leaving anything behind."
exit 0
