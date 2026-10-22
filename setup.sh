#!/usr/bin/env bash
# ==============================================================================
# Fedora MK Workstation — Master Deployment Script
# Target: Fedora Workstation (GNOME / Wayland)
# ==============================================================================

set -euo pipefail

echo "================================================="
echo "   Installing Fedora MK Workstation Edition     "
echo "================================================="

# 1. Identity & DBus Runtime Resolution
if [[ $EUID -ne 0 ]]; then
    echo "[-] Error: setup.sh must be executed with sudo." >&2
    exit 1
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
REAL_UID=$(id -u "$REAL_USER")
USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_BUS="/run/user/$REAL_UID/bus"

echo "[+] Target User: ${REAL_USER} (UID: ${REAL_UID})"
echo "[+] Target Home: ${USER_HOME}"

# DBus Session Helper for GNOME / GSettings
as_user() {
    sudo -u "$REAL_USER" env \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_BUS" \
        XDG_RUNTIME_DIR="/run/user/$REAL_UID" \
        "$@"
}
user_gsettings() { as_user gsettings "$@"; }

# ------------------------------------------------------------------------------
# 2. DNF Configuration & Optimization (Clean & Deduplicated)
# ------------------------------------------------------------------------------
echo "==> [1/8] Optimizing DNF (/etc/dnf/dnf.conf)..."
DNF_CONF="/etc/dnf/dnf.conf"

if [[ -f "$DNF_CONF" ]]; then
    [ -f "${DNF_CONF}.bak" ] || cp -a "$DNF_CONF" "${DNF_CONF}.bak"

    # Remove any existing occurrences to prevent duplicates
    sed -i -E '/^[[:space:]]*(max_parallel_downloads|fastestmirror|defaultyes)[[:space:]]*=/d' "$DNF_CONF"

    # Ensure [main] section exists
    if ! grep -q '^\[main\]' "$DNF_CONF"; then
        echo '[main]' >> "$DNF_CONF"
    fi

    # Append single clean values under [main]
    sed -i '/^\[main\]/a max_parallel_downloads=10\nfastestmirror=True\ndefaultyes=True' "$DNF_CONF"
fi

# ------------------------------------------------------------------------------
# 3. Enable RPM Fusion Repositories
# ------------------------------------------------------------------------------
echo "==> [2/8] Enabling RPM Fusion Repositories..."
FEDORA_VER=$(rpm -E %fedora)
if ! rpm -q rpmfusion-free-release rpmfusion-nonfree-release >/dev/null 2>&1; then
    dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm" \
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm"
else
    echo "    RPM Fusion already active."
fi

# ------------------------------------------------------------------------------
# 4. Install Packages via DNF
# ------------------------------------------------------------------------------
echo "==> [3/8] Installing Packages via DNF & Copr..."
dnf copr enable -y principis/howdy || true

dnf install -y --skip-unavailable \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    extension-manager \
    gnome-tweaks \
    v4l-utils \
    ffmpeg \
    howdy || true

# ------------------------------------------------------------------------------
# 5. Flatpak & Core Applications
# ------------------------------------------------------------------------------
echo "==> [4/8] Configuring Flathub & Core Flatpaks..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --system -y flathub com.github.tenderowl.frog || true

# ------------------------------------------------------------------------------
# 6. Deploy Custom MK Extensions
# ------------------------------------------------------------------------------
echo "==> [5/8] Deploying MK Indicator Extension..."
EXT_DIR="$USER_HOME/.local/share/gnome-shell/extensions"
as_user mkdir -p "$EXT_DIR"

if [[ -d "$SCRIPT_DIR/extensions/mk-indicator@mehulk" ]]; then
    rm -rf "$EXT_DIR/mk-indicator@mehulk"
    cp -r "$SCRIPT_DIR/extensions/mk-indicator@mehulk" "$EXT_DIR/"
    chown -R "$REAL_USER:$REAL_USER" "$EXT_DIR/mk-indicator@mehulk"
fi

# ------------------------------------------------------------------------------
# 7. GNOME GSettings & Session Configuration
# ------------------------------------------------------------------------------
if [[ ! -S "$USER_BUS" ]]; then
    echo "[-] Warning: No active DBus session bus at $USER_BUS."
    echo "    Skipping GSettings. Log in graphically and re-run."
else
    echo "==> [6/8] Configuring User Preferences & Window Management..."
    user_gsettings set org.gnome.shell disable-user-extensions false
    user_gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
    user_gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
    user_gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
    user_gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
    user_gsettings set org.gnome.shell.app-switcher current-workspace-only false

    echo "==> [7/8] Restoring Screenshot Key & Dock Workspace Isolation..."
    user_gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
    user_gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"
    user_gsettings set org.gnome.shell.extensions.dash-to-dock isolate-workspaces true 2>/dev/null || true
    user_gsettings set org.gnome.shell.extensions.dash-to-dock isolate-monitors true 2>/dev/null || true

    echo "==> [8/8] Enabling GNOME Extensions..."
    as_user gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
    as_user gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# 8. SELinux Security Rule for Camera / Login
# ------------------------------------------------------------------------------
if command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
    echo "[+] Configuring SELinux boolean for GDM login camera access..."
    setsebool -P authlogin_camera 1 2>/dev/null || true
fi

echo "================================================="
echo "✔ MK Workstation Edition deployment complete!   "
echo "================================================="