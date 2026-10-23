#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: System Provisioning Engine (Root Scope)
# ==============================================================================
set -euo pipefail

usage() {
    cat << 'EOF'
Usage: sudo ./setup.sh [--no-face]

Installs packages, repositories and Flatpaks, then applies the MK desktop
settings (sync.sh) for the user who ran sudo. Safe to run more than once.

  --no-face   Skip Howdy face unlock (it is also skipped when no camera exists)
  -h, --help  Show this help
EOF
}

INSTALL_FACE=1
for arg in "$@"; do
    case "$arg" in
        --no-face) INSTALL_FACE=0 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[-] Unknown option: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "[-] Error: setup.sh requires root privileges. Run with sudo." >&2
    exit 1
fi

# shellcheck source=/dev/null
. /etc/os-release
if [[ "${ID:-}" != "fedora" ]]; then
    echo "[-] Error: This suite supports Fedora only (found: ${PRETTY_NAME:-unknown})." >&2
    exit 1
fi
if [[ -e /run/ostree-booted ]]; then
    echo "[-] Error: Fedora Atomic (Silverblue, Kinoite, ...) installs packages with rpm-ostree," >&2
    echo "    which this script doesn't support. Use Fedora Workstation." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_USER="${SUDO_USER:-$USER}"
REAL_UID=$(id -u "$REAL_USER")
USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
USER_RUNTIME="/run/user/$REAL_UID"
WARNINGS=()

# Run a command as the desktop user inside their live session. Under sudo the
# session bus address is lost, so gsettings would otherwise write nowhere.
as_user() {
    sudo -u "$REAL_USER" env \
        HOME="$USER_HOME" \
        XDG_RUNTIME_DIR="$USER_RUNTIME" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_RUNTIME/bus" \
        "$@"
}

echo "[+] Initializing System Provisioning..."

# 1. Deduplicate & optimize DNF
DNF_CONF="/etc/dnf/dnf.conf"
if [[ -f "$DNF_CONF" ]]; then
    echo "==> Configuring DNF performance flags..."
    [[ -f "${DNF_CONF}.bak" ]] || cp -a "$DNF_CONF" "${DNF_CONF}.bak"
    sed -i -E '/^[[:space:]]*(max_parallel_downloads|fastestmirror|defaultyes)[[:space:]]*=/d' "$DNF_CONF"
    grep -q '^\[main\]' "$DNF_CONF" || echo '[main]' >> "$DNF_CONF"
    sed -i '/^\[main\]/a max_parallel_downloads=10\nfastestmirror=True\ndefaultyes=True' "$DNF_CONF"
fi

# 2. RPM Fusion
echo "==> Verifying repositories..."
FEDORA_VER=$(rpm -E %fedora)
if ! rpm -q rpmfusion-free-release rpmfusion-nonfree-release >/dev/null 2>&1; then
    dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm" \
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm"
fi

# 3. Howdy face unlock (optional; needs a camera)
if (( !INSTALL_FACE )); then
    echo "==> Skipping Howdy face unlock (--no-face)."
elif ! compgen -G "/dev/video*" >/dev/null; then
    WARNINGS+=("No camera found; skipped Howdy face unlock")
else
    echo "==> Installing Howdy face authentication..."
    # The COPR may lag behind new Fedora releases; report it instead of aborting setup.
    if ! { dnf copr enable -y principis/howdy && dnf install -y howdy; }; then
        WARNINGS+=("Howdy could not be installed (COPR principis/howdy may not support Fedora ${FEDORA_VER} yet)")
    fi
fi

# 4. Batch Package Installation from Declarative Manifest
if [[ -f "$SCRIPT_DIR/apps/dnf-packages.txt" ]]; then
    echo "==> Installing packages from apps/dnf-packages.txt..."
    mapfile -t PACKAGES < <(grep -vE '^\s*(#|$)' "$SCRIPT_DIR/apps/dnf-packages.txt" || true)
    (( ${#PACKAGES[@]} )) && dnf install -y --skip-unavailable "${PACKAGES[@]}"
    for pkg in "${PACKAGES[@]}"; do
        rpm -q --whatprovides "$pkg" >/dev/null 2>&1 || WARNINGS+=("DNF package not installed: $pkg")
    done
fi

# 5. Flathub Core Runtime
echo "==> Configuring Flathub..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
if [[ -f "$SCRIPT_DIR/apps/flatpaks.txt" ]]; then
    while IFS= read -r app || [[ -n "$app" ]]; do
        [[ -z "$app" || "$app" =~ ^# ]] && continue
        flatpak install --system -y flathub "$app" || WARNINGS+=("Flatpak failed to install: $app")
    done < "$SCRIPT_DIR/apps/flatpaks.txt"
fi

# 6. Hardware / SELinux Permissions
if (( INSTALL_FACE )) && command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
    echo "==> Configuring SELinux biometric camera rule..."
    setsebool -P authlogin_camera 1 || WARNINGS+=("Could not set SELinux boolean authlogin_camera")
fi

# 7. Desktop settings, applied as the desktop user (sync.sh is the single source)
if [[ "$REAL_USER" == "root" ]]; then
    WARNINGS+=("Run via sudo from your desktop user to apply GNOME settings")
elif [[ ! -S "$USER_RUNTIME/bus" ]]; then
    WARNINGS+=("No GNOME session for $REAL_USER; log into GNOME and run ./sync.sh to apply desktop settings")
else
    echo "==> Applying desktop settings for $REAL_USER..."
    as_user "$SCRIPT_DIR/sync.sh" || WARNINGS+=("Desktop settings failed; run ./sync.sh from your GNOME terminal")
fi

if (( ${#WARNINGS[@]} )); then
    echo "⚠ Completed with warnings:"
    printf '    - %s\n' "${WARNINGS[@]}"
fi
echo "✔ Setup complete. Log out and back in to load extensions."
if (( INSTALL_FACE )) && command -v howdy &>/dev/null; then
    echo "  Optional: sudo ./register-face.sh to enroll face unlock."
fi
