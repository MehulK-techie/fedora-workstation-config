#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: System Provisioning Engine (Root Scope)
# ==============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "[-] Error: setup.sh requires root privileges. Run with sudo." >&2
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
user_gsettings() { as_user gsettings "$@"; }

echo "[+] Initializing System Provisioning..."

# 1. Deduplicate & optimize DNF
DNF_CONF="/etc/dnf/dnf.conf"
if [[ -f "$DNF_CONF" ]]; then
    echo "==> Configuring DNF performance flags..."
    sed -i -E '/^[[:space:]]*(max_parallel_downloads|fastestmirror|defaultyes)[[:space:]]*=/d' "$DNF_CONF"
    grep -q '^\[main\]' "$DNF_CONF" || echo '[main]' >> "$DNF_CONF"
    sed -i '/^\[main\]/a max_parallel_downloads=10\nfastestmirror=True\ndefaultyes=True' "$DNF_CONF"
fi

# 2. RPM Fusion & Copr
echo "==> Verifying repositories..."
FEDORA_VER=$(rpm -E %fedora)
if ! rpm -q rpmfusion-free-release rpmfusion-nonfree-release >/dev/null 2>&1; then
    dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm" \
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm"
fi
dnf copr enable -y principis/howdy

# 3. Batch Package Installation from Declarative Manifest
echo "==> Installing Howdy face authentication..."
dnf install -y howdy

if [[ -f "$SCRIPT_DIR/apps/dnf-packages.txt" ]]; then
    echo "==> Installing packages from apps/dnf-packages.txt..."
    mapfile -t PACKAGES < <(grep -vE '^\s*(#|$)' "$SCRIPT_DIR/apps/dnf-packages.txt" || true)
    (( ${#PACKAGES[@]} )) && dnf install -y --skip-unavailable "${PACKAGES[@]}"
    for pkg in "${PACKAGES[@]}"; do
        rpm -q --whatprovides "$pkg" >/dev/null 2>&1 || WARNINGS+=("DNF package not installed: $pkg")
    done
fi

# 4. Flathub Core Runtime
echo "==> Configuring Flathub..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
if [[ -f "$SCRIPT_DIR/apps/flatpaks.txt" ]]; then
    while IFS= read -r app || [[ -n "$app" ]]; do
        [[ -z "$app" || "$app" =~ ^# ]] && continue
        flatpak install --system -y flathub "$app" || WARNINGS+=("Flatpak failed to install: $app")
    done < "$SCRIPT_DIR/apps/flatpaks.txt"
fi

# 5. Hardware / SELinux Permissions
if command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
    echo "==> Configuring SELinux biometric camera rule..."
    setsebool -P authlogin_camera 1 || WARNINGS+=("Could not set SELinux boolean authlogin_camera")
fi

# ==============================================================================
# Desktop session settings (need the user's live GNOME session)
# ==============================================================================
if [[ "$REAL_USER" == "root" ]]; then
    WARNINGS+=("Run via sudo from your desktop user to apply GNOME settings")
elif [[ ! -S "$USER_RUNTIME/bus" ]]; then
    WARNINGS+=("No session bus for $REAL_USER at $USER_RUNTIME/bus; log into GNOME and re-run to apply desktop settings")
else

# ------------------------------------------------------------------------------
# GNOME Navigation: Alt+Tab Window Switching
# ------------------------------------------------------------------------------
echo "Configuring Alt+Tab window switching..."

# Clear Alt+Tab from App Switching
user_gsettings set org.gnome.desktop.wm.keybindings switch-applications "['<Super>Tab']"
user_gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "['<Shift><Super>Tab']"

# Apply Alt+Tab to Window Switching
user_gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
user_gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
user_gsettings set org.gnome.shell.window-switcher current-workspace-only false

# ------------------------------------------------------------------------------
# GNOME Extensions Enabled State (Active 8)
# ------------------------------------------------------------------------------
echo "Enabling active 8 GNOME extensions..."

# Append to enabled-extensions rather than overwrite it, so extensions the user
# enabled themselves stay on. `gnome-extensions enable` can't be used here: on
# Wayland it fails for extensions the running shell hasn't loaded yet.
enable_extensions() {
    local current uuid
    current=$(user_gsettings get org.gnome.shell enabled-extensions)
    for uuid in "$@"; do
        [[ "$current" == *"'$uuid'"* ]] && continue
        if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
            current="['$uuid']"
        else
            current="${current%]}, '$uuid']"
        fi
    done
    user_gsettings set org.gnome.shell enabled-extensions "$current"
}

enable_extensions \
    touchpad-gesture-customization@coooolapps.com \
    blur-my-shell@aunetx \
    monitor@astraext.github.io \
    transparent-top-bar@ftpix.com \
    wack-shell@rinzler69-wastaken.github.com \
    text-extractor@imshaaz21.github.com \
    places-menu@gnome-shell-extensions.gcampax.github.com \
    dash-to-dock@micxgx.gmail.com

# ------------------------------------------------------------------------------
# Custom Keybindings & Modern Modal Dialog Aesthetics
# ------------------------------------------------------------------------------
echo "Configuring Super+Q window close & Shutdown shortcuts..."

# Super + Q -> Close Window
user_gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# Super+Backspace, Super+Shift+X, Ctrl+Alt+Delete -> Shutdown / Restart Prompt
user_gsettings set org.gnome.settings-daemon.plugins.media-keys power-off "['<Super>BackSpace', '<Super><Shift>x', '<Control><Alt>Delete', 'XF86PowerOff']"

# Enable Frosted Glass Blur on Shutdown & Modal Dialogs (only if this
# blur-my-shell version ships the schema; a missing schema aborts under set -e)
BMS_MODAL="org.gnome.shell.extensions.blur-my-shell.modal-dialogs"
if user_gsettings list-schemas | grep -qx "$BMS_MODAL"; then
    user_gsettings set "$BMS_MODAL" blur true
    user_gsettings set "$BMS_MODAL" brightness 0.65
    user_gsettings set "$BMS_MODAL" sigma 30
else
    WARNINGS+=("blur-my-shell has no modal-dialogs schema; skipped modal blur")
fi

# Apply Custom Modal CSS to user profile (once; re-runs must not append again)
SHELL_CSS="$USER_HOME/.config/gnome-shell/gnome-shell.css"
CSS_MARKER="/* MK Workstation: modal dialog styling */"
as_user mkdir -p "$USER_HOME/.config/gnome-shell"
if ! grep -qF "$CSS_MARKER" "$SHELL_CSS" 2>/dev/null; then
    as_user tee -a "$SHELL_CSS" >/dev/null << CSSEOF

$CSS_MARKER
.modal-dialog {
  border-radius: 24px !important;
  background-color: rgba(20, 20, 28, 0.82) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6) !important;
  padding: 18px !important;
}

.end-session-dialog {
  border-radius: 24px !important;
}

.modal-dialog-linked-button {
  border-radius: 12px !important;
  font-weight: bold !important;
  padding: 10px 20px !important;
  margin: 4px !important;
  transition: all 200ms ease-in-out !important;
}

.modal-dialog-linked-button:hover {
  background-color: rgba(255, 255, 255, 0.18) !important;
}

.modal-dialog-linked-button:last-child {
  background-color: #e64553 !important;
  color: #ffffff !important;
}

.modal-dialog-linked-button:last-child:hover {
  background-color: #f38ba8 !important;
}
CSSEOF
fi

fi

if (( ${#WARNINGS[@]} )); then
    echo "⚠ Completed with warnings:"
    printf '    - %s\n' "${WARNINGS[@]}"
fi
echo "✔ System-level setup complete. Next: run ./sync.sh (without sudo) for desktop user setup."
