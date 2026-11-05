#!/usr/bin/env bash
# TypeNova setup and launch for Linux (counterpart of install-and-run.ps1).
# Usage: ./install-and-run.sh [--build-installer]

set -euo pipefail

BUILD_INSTALLER=0
for arg in "$@"; do
    case "$arg" in
        --build-installer) BUILD_INSTALLER=1 ;;
        -h|--help)
            echo "Usage: $0 [--build-installer]"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$SCRIPT_DIR"

# Keep a complete log next to the project so native build failures are diagnosable.
BUILD_LOG_PATH="$SCRIPT_DIR/typenova-build.log"
if ! touch -- "$BUILD_LOG_PATH" 2>/dev/null; then
    BUILD_LOG_PATH="${TMPDIR:-/tmp}/TypeNova-build-$$.log"
fi
exec > >(tee -a -- "$BUILD_LOG_PATH") 2>&1
echo "Build log: $BUILD_LOG_PATH"

MIN_NODE_MAJOR=20
MIN_RUST_VERSION="1.90.0"

# Print a highlighted step header.
write_step() {
    printf '\n\033[36m==> %s\033[0m\n' "$1"
}

# Print an OK line in green.
write_ok() {
    printf '\033[32m%s\033[0m\n' "$1"
}

# Print an error with the log location and exit with code 1.
stop_with_message() {
    printf '\n\033[31mERROR: %s\033[0m\n' "$1"
    printf '\033[33mFull log: %s\033[0m\n' "$BUILD_LOG_PATH"
    printf '\033[33mCopy the end of the log and send it to TypeNova support.\033[0m\n'
    exit 1
}

# Ask a yes/no question; default is yes. Returns non-zero on "no".
confirm() {
    local answer
    read -r -p "$1 [Y/n] " answer || answer="n"
    [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

# Return success when version $1 is greater than or equal to version $2.
version_ge() {
    [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

# Return success when the WebKitGTK 4.1 headers and a C compiler are available.
has_system_deps() {
    command -v cc >/dev/null 2>&1 \
        && command -v pkg-config >/dev/null 2>&1 \
        && pkg-config --exists webkit2gtk-4.1 \
        && pkg-config --exists librsvg-2.0
}

# Install the Tauri 2 system packages with the distribution's package manager.
# Package lists follow https://tauri.app/start/prerequisites/#linux
# No -y/--noconfirm: the package manager lists what it will install and asks first.
install_system_deps() {
    local -a cmd
    if command -v apt-get >/dev/null 2>&1; then
        cmd=(apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file
             libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config)
        sudo apt-get update || stop_with_message 'apt-get update failed.'
    elif command -v dnf >/dev/null 2>&1; then
        cmd=(dnf install webkit2gtk4.1-devel openssl-devel curl wget file
             libappindicator-gtk3-devel librsvg2-devel libxdo-devel gcc gcc-c++ make pkgconf-pkg-config)
    elif command -v pacman >/dev/null 2>&1; then
        cmd=(pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl
             appmenu-gtk-module libappindicator-gtk3 librsvg xdotool)
    else
        stop_with_message 'Unsupported package manager. Install the Tauri Linux prerequisites manually (https://tauri.app/start/prerequisites/#linux) and rerun this script.'
    fi
    echo "Command: sudo ${cmd[*]}"
    sudo "${cmd[@]}" || stop_with_message 'Installing the system packages failed. Review the message above and try again.'
}

printf '\033[33m%s\033[0m\n' \
    ' TypeNova' \
    ' TypeNova - Automated Setup and Launch' \
    ' This script checks prerequisites and installs any missing tools,' \
    ' downloads project dependencies, and launches the application.'
echo "Project directory: $SCRIPT_DIR"

if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
    stop_with_message 'package.json was not found. Run this script from the extracted TypeNova project folder.'
fi

# Node.js: not installed automatically because distribution packages are often too old for Vite 6.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    stop_with_message "Node.js $MIN_NODE_MAJOR or newer with npm is required. Install it (for example with nvm: https://github.com/nvm-sh/nvm) and rerun this script."
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < MIN_NODE_MAJOR )); then
    stop_with_message "Node.js $MIN_NODE_MAJOR or newer is required. Detected: $(node --version)."
fi
write_ok "Node: $(node --version) | npm: $(npm --version)"

# Rust / Cargo
if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
fi
if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
    write_step 'Rust was not found'
    if ! confirm 'Install Rust with rustup (https://rustup.rs) into your home directory?'; then
        stop_with_message 'Rust is required. Install it with rustup and rerun this script.'
    fi
    command -v curl >/dev/null 2>&1 || stop_with_message 'curl is required to install Rust. Install curl and rerun this script.'
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
        || stop_with_message 'The rustup installer failed.'
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
fi
rust_version_text="$(rustc --version 2>/dev/null)" || stop_with_message 'Unable to read the rustc version. Reinstall Rust with rustup and rerun this script.'
rust_version="$(sed -nE 's/^rustc ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' <<<"$rust_version_text")"
[[ -n "$rust_version" ]] || stop_with_message "Unable to parse the rustc version: $rust_version_text"
if ! version_ge "$rust_version" "$MIN_RUST_VERSION"; then
    if command -v rustup >/dev/null 2>&1; then
        write_step "Updating Rust (detected $rust_version, required >= $MIN_RUST_VERSION)"
        rustup update stable || stop_with_message 'rustup update failed.'
        rust_version_text="$(rustc --version)"
        rust_version="$(sed -nE 's/^rustc ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' <<<"$rust_version_text")"
    fi
    if ! version_ge "$rust_version" "$MIN_RUST_VERSION"; then
        stop_with_message "Rust $MIN_RUST_VERSION or newer is required by the current Tauri dependencies. Detected: $rust_version_text. A distribution-packaged Rust cannot be updated here; install Rust with rustup instead."
    fi
fi
write_ok "Rust: $rust_version_text (required >= $MIN_RUST_VERSION)"

# System libraries for Tauri (WebKitGTK, GTK, compiler)
if ! has_system_deps; then
    write_step 'Tauri system libraries are missing (WebKitGTK 4.1, librsvg, C compiler)'
    if ! confirm 'Install them now with your package manager (needs sudo)?'; then
        stop_with_message 'Install the Tauri Linux prerequisites (https://tauri.app/start/prerequisites/#linux) and rerun this script.'
    fi
    install_system_deps
    has_system_deps || stop_with_message 'The system libraries are still not detected after installation (pkg-config webkit2gtk-4.1).'
fi
write_ok 'Tauri system libraries: OK'

# npm dependencies
write_step 'Installing TypeNova dependencies (npm install)'
npm install --no-audit --no-fund --fetch-retries=3 --fetch-timeout=60000 \
    || stop_with_message 'npm install failed. Check connectivity to the npm registry, proxy settings, and the npm install section of the log.'

if (( BUILD_INSTALLER )); then
    # tauri.conf.json also lists Windows targets; Tauri builds only the ones this system supports.
    write_step 'Building the Linux packages (npm run tauri:build)'
    npm run tauri:build || stop_with_message 'The Linux package build failed. Copy the last 40-60 lines of the error output.'
    bundle_dir="$SCRIPT_DIR/src-tauri/target/release/bundle"
    write_ok "Build complete. Output folder: $bundle_dir"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$bundle_dir" >/dev/null 2>&1 || true
    fi
else
    write_step 'Launching TypeNova (npm run tauri:dev)'
    printf '\033[33m%s\033[0m\n' 'The application will open in a separate window. Close it normally to finish.'
    if ! npm run tauri:dev; then
        printf '\n\033[31mTypeNova exited with an error.\033[0m\n'
        printf '\033[33m%s\033[0m\n' 'If an error occurred, copy the final lines from this window.'
        exit 1
    fi
fi
