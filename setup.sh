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
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm" || true
fi
dnf copr enable -y principis/howdy || true

# 3. Batch Package Installation from Declarative Manifest
if [[ -f "$SCRIPT_DIR/apps/dnf-packages.txt" ]]; then
    echo "==> Installing packages from apps/dnf-packages.txt..."
    grep -vE '^\s*(#|$)' "$SCRIPT_DIR/apps/dnf-packages.txt" | xargs dnf install -y --skip-unavailable || true
fi

# 4. Flathub Core Runtime
echo "==> Configuring Flathub..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
if [[ -f "$SCRIPT_DIR/apps/flatpaks.txt" ]]; then
    while IFS= read -r app || [[ -n "$app" ]]; do
        [[ -z "$app" || "$app" =~ ^# ]] && continue
        flatpak install --system -y flathub "$app" || true
    done < "$SCRIPT_DIR/apps/flatpaks.txt"
fi

# 5. Hardware / SELinux Permissions
if command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
    echo "==> Configuring SELinux biometric camera rule..."
    setsebool -P authlogin_camera 1 2>/dev/null || true
fi

echo "✔ System-level setup complete. Next: run ./sync.sh (without sudo) for desktop user setup."

# ==============================================================================
# GNOME Navigation: Alt+Tab Window Switching
# ==============================================================================
echo "Configuring Alt+Tab window switching..."
REAL_USER="${SUDO_USER:-$USER}"
REAL_UID=$(id -u "$REAL_USER")
DBUS_ENV="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$REAL_UID/bus"

# Clear Alt+Tab from App Switching
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.desktop.wm.keybindings switch-applications "['<Super>Tab']"
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "['<Shift><Super>Tab']"

# Apply Alt+Tab to Window Switching
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.shell.window-switcher current-workspace-only false

# ==============================================================================
# GNOME Extensions Enabled State
# ==============================================================================
echo "Enabling preferred GNOME extensions..."
REAL_USER="${SUDO_USER:-$USER}"
REAL_UID=$(id -u "$REAL_USER")
DBUS_ENV="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$REAL_UID/bus"

sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.shell enabled-extensions "[
  'text-extractor@imshaaz21.github.com',
  'touchpad-gesture-customization@coooolapps.com',
  'transparent-top-bar@ftpix.com',
  'wack-shell@rinzler69-wastaken.github.com',
  'dash-to-dock@micxgx.gmail.com',
  'places-menu@gnome-shell-extensions.gcampax.github.com'
]"

# ==============================================================================
# GNOME Extensions Enabled State (Active 8)
# ==============================================================================
echo "Enabling active 8 GNOME extensions..."
REAL_USER="${SUDO_USER:-$USER}"
REAL_UID=$(id -u "$REAL_USER")
DBUS_ENV="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$REAL_UID/bus"

sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.shell enabled-extensions "[
  'touchpad-gesture-customization@coooolapps.com',
  'blur-my-shell@aunetx',
  'monitor@astraext.github.io',
  'transparent-top-bar@ftpix.com',
  'wack-shell@rinzler69-wastaken.github.com',
  'text-extractor@imshaaz21.github.com',
  'places-menu@gnome-shell-extensions.gcampax.github.com',
  'dash-to-dock@micxgx.gmail.com'
]"

# ==============================================================================
# Custom Keybindings & Modern Modal Dialog Aesthetics
# ==============================================================================
echo "Configuring Super+Q window close & Shutdown shortcuts..."
REAL_USER="${SUDO_USER:-$USER}"
REAL_UID=$(id -u "$REAL_USER")
DBUS_ENV="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$REAL_UID/bus"

# Super + Q -> Close Window
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q', '<Alt>F4']"

# Super + Shift + S & Super + Backspace -> Shutdown / Restart Prompt
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.settings-daemon.plugins.media-keys power-off "['<Super><Shift>s', '<Super>BackSpace', 'XF86PowerOff']"

# Enable Frosted Glass Blur on Shutdown & Modal Dialogs
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.shell.extensions.blur-my-shell.modal-dialogs blur true
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.shell.extensions.blur-my-shell.modal-dialogs brightness 0.65
sudo -u "$REAL_USER" $DBUS_ENV gsettings set org.gnome.shell.extensions.blur-my-shell.modal-dialogs sigma 30

# Apply Custom Modal CSS to user profile
USER_HOME="/home/$REAL_USER"
mkdir -p "$USER_HOME/.config/gnome-shell"
cat << 'CSSEOF' >> "$USER_HOME/.config/gnome-shell/gnome-shell.css"

/* Custom Modern Shutdown & Modal Dialog Styling */
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
chown -R "$REAL_USER:$REAL_USER" "$USER_HOME/.config/gnome-shell"
