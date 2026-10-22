param(
    [switch]$BuildInstaller
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot

# Keep a complete log next to the project so native build failures are diagnosable.
$script:BuildLogPath = Join-Path $PSScriptRoot 'typenova-build.log'
$script:TranscriptStarted = $false
try {
    Start-Transcript -LiteralPath $script:BuildLogPath -Append -Force | Out-Null
    $script:TranscriptStarted = $true
} catch {
    $script:BuildLogPath = Join-Path $env:TEMP "TypeNova-build-$PID.log"
    try {
        Start-Transcript -LiteralPath $script:BuildLogPath -Append -Force | Out-Null
        $script:TranscriptStarted = $true
    } catch {
        Write-Host "WARNING: Unable to write the build log: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
if ($script:TranscriptStarted) {
    Write-Host "Build log: $script:BuildLogPath" -ForegroundColor Gray
}

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}
function Stop-WithMessage([string]$Message) {
    Write-Host "`nERROR: $Message" -ForegroundColor Red
    Write-Host "Full log: $script:BuildLogPath" -ForegroundColor Yellow
    Write-Host "Copy the end of the log and send it to TypeNova support." -ForegroundColor Yellow
    if ($script:TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
        $script:TranscriptStarted = $false
    }
    Read-Host 'Press Enter to close'
    exit 1
}
function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin"
}
function Find-Winget {
    $cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}
function Install-WingetPackage([string]$Id, [string]$Override = '') {
    $winget = Find-Winget
    if (-not $winget) {
        Stop-WithMessage "winget was not found. Install App Installer from the Microsoft Store and rerun this script. Required package: $Id"
    }
    Write-Step "Installing $Id with winget"
    $args = @('install', '--id', $Id, '--exact', '--accept-source-agreements', '--accept-package-agreements', '--silent')
    if ($Override) { $args += @('--override', $Override) }
    & $winget @args
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage "The $Id installer exited with code $LASTEXITCODE. Review the message above, check administrator permissions, and try again."
    }
    Refresh-Path
}
function Test-VcBuildTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $false }
    $found = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    return [bool]($found -and (Test-Path $found))
}
function Test-WebView2 {
    $paths = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
        (Join-Path $env:ProgramFiles 'Microsoft\EdgeWebView\Application')
    )
    foreach ($path in $paths) {
        if ((Test-Path $path) -and (Get-ChildItem -LiteralPath $path -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+\.' } | Select-Object -First 1)) { return $true }
    }
    return $false
}

Write-Host @'
 TypeNova
 TypeNova - Automated Setup and Launch
 This script checks prerequisites and installs any missing tools,
 downloads project dependencies, and launches the application.
'@ -ForegroundColor Yellow
Write-Host "Project directory: $PSScriptRoot"

if (-not (Test-Path (Join-Path $PSScriptRoot 'package.json'))) {
    Stop-WithMessage 'package.json was not found. Run this script from the extracted TypeNova project folder.'
}

# Node.js
Refresh-Path
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Install-WingetPackage 'OpenJS.NodeJS.LTS'
    Refresh-Path
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        Stop-WithMessage 'Node.js was installed but is not yet available on PATH. Restart Windows or PowerShell, then run INSTALL-AND-RUN.bat again.'
    }
}
Write-Host "Node: $(& node --version) | npm: $(& npm --version)" -ForegroundColor Green

# Rust / Cargo
Refresh-Path
if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue) -or -not (Get-Command rustc.exe -ErrorAction SilentlyContinue)) {
    Install-WingetPackage 'Rustlang.Rustup'
    Refresh-Path
}
if (Get-Command rustup.exe -ErrorAction SilentlyContinue) {
    Write-Step 'Configuring the Rust compiler for Windows MSVC'
    & rustup toolchain install stable-x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Failed to install the Rust MSVC toolchain.' }
    & rustup default stable-x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Failed to set the default Rust toolchain.' }
    Refresh-Path
}
if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Cargo is still unavailable. Restart Windows, then run INSTALL-AND-RUN.bat again.'
}
$rustVersionText = & rustc.exe --version 2>$null
if ($LASTEXITCODE -ne 0 -or $rustVersionText -notmatch 'rustc\s+(\d+\.\d+\.\d+)') {
    Stop-WithMessage 'Unable to read the rustc version. Reinstall Rust with rustup and rerun this script.'
}
$rustVersion = [version]$Matches[1]
if ($rustVersion -lt [version]'1.90.0') {
    Stop-WithMessage "Rust 1.90.0 or newer is required by the current Tauri dependencies. Detected: $rustVersionText. Update the toolchain with rustup and try again."
}
Write-Host "Rust: $rustVersionText (required >= 1.90.0)" -ForegroundColor Green

# MSVC C++ Build Tools
if (-not (Test-VcBuildTools)) {
    Write-Step 'Installing Microsoft C++ Build Tools and Windows SDK (several GB may be downloaded)'
    Install-WingetPackage 'Microsoft.VisualStudio.2022.BuildTools' '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    if (-not (Test-VcBuildTools)) {
        Stop-WithMessage 'The MSVC compiler was not detected after installation. Open Visual Studio Installer, verify the Desktop development with C++ workload, and rerun this script.'
    }
}
Write-Host 'Microsoft C++ Build Tools: OK' -ForegroundColor Green

# WebView2 Runtime
if (-not (Test-WebView2)) {
    Write-Step 'Installing Microsoft Edge WebView2 Runtime'
    $bootstrapper = Join-Path $env:TEMP 'MicrosoftEdgeWebView2Setup.exe'
    try {
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper -UseBasicParsing
        $process = Start-Process -FilePath $bootstrapper -ArgumentList '/silent', '/install' -Wait -PassThru
        if ($process.ExitCode -ne 0 -and -not (Test-WebView2)) {
            Stop-WithMessage "The WebView2 installer returned exit code $($process.ExitCode). Install the WebView2 Runtime from Microsoft and rerun this script."
        }
    } catch {
        Stop-WithMessage "Automatic WebView2 installation failed: $($_.Exception.Message). Install the WebView2 Runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and rerun this script."
    }
}
Write-Host 'WebView2 Runtime: OK' -ForegroundColor Green

# npm dependencies
Write-Step 'Installing TypeNova dependencies (npm install)'
& npm install --no-audit --no-fund --fetch-retries=3 --fetch-timeout=60000
if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'npm install failed. Check connectivity to the npm registry, proxy settings, and the npm install section of the log.' }

if ($BuildInstaller) {
    Write-Step 'Building the Windows installer (npm run tauri:build)'
    & npm run tauri:build
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'The Windows installer build failed. Copy the last 40-60 lines of the error output.' }
    Write-Host "`nBuild complete. Output folder: $PSScriptRoot\src-tauri\target\release\bundle" -ForegroundColor Green
    Start-Process explorer.exe (Join-Path $PSScriptRoot 'src-tauri\target\release\bundle')
} else {
    Write-Step 'Launching TypeNova (npm run tauri:dev)'
    Write-Host 'The application will open in a separate window. Close it normally to finish.' -ForegroundColor Yellow
    & npm run tauri:dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nTypeNova exited with code $LASTEXITCODE." -ForegroundColor Red
        Write-Host 'If an error occurred, copy the final lines from this window.' -ForegroundColor Yellow
        Read-Host 'Press Enter to close'
        exit $LASTEXITCODE
    }
}

if ($script:TranscriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
    $script:TranscriptStarted = $false
}
