#!/usr/bin/env bash
set -e

echo "================================================="
echo "   Installing Fedora MK Workstation Edition     "
echo "================================================="

echo "==> [1/7] Enabling Howdy COPR & Installing Packages..."
sudo dnf copr enable -y principis/howdy || true
sudo dnf install -y --skip-unavailable \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    extension-manager \
    gnome-tweaks \
    howdy || true

echo "==> [2/7] Configuring Flathub & Flatpak Applications..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --system -y com.github.tenderowl.frog || true

echo "==> [3/7] Deploying MK Workstation Indicator Badge..."
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
cp -r extensions/mk-indicator@mehulk "$HOME/.local/share/gnome-shell/extensions/"

echo "==> [4/7] Fixing Alt+Tab & Keybindings..."
gsettings set org.gnome.shell disable-user-extensions false

# Clear grouped application switching shortcuts
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"

# Bind Alt+Tab strictly to individual window switching across all workspaces
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [5/7] Isolating Workspace Dock & Restoring Screenshot Key..."
gsettings set org.gnome.shell.extensions.dash-to-dock isolate-workspaces true 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock isolate-monitors true 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock middle-click-action 'launch-new-app' 2>/dev/null || true

# Restore standard PrtScn screenshot keybinding
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"

# Fallback clean wallpaper
BG_URI=$(gsettings get org.gnome.desktop.background picture-uri | tr -d "'")
if [[ "$BG_URI" == *"mehulkumar"* ]] || [ ! -f "${BG_URI#file://}" ]; then
    gsettings reset org.gnome.desktop.background picture-uri
    gsettings reset org.gnome.desktop.background picture-uri-dark
fi

echo "==> [6/7] Configuring Howdy PAM Permissions..."
if [ -f /etc/pam.d/sudo ] && ! grep -q "pam_python" /etc/pam.d/sudo; then
    sudo sed -i '1i auth sufficient pam_python.so /lib64/security/howdy/pam.py' /etc/pam.d/sudo 2>/dev/null || true
fi

echo "==> [7/7] Activating Extensions..."
gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true

echo "================================================="
echo "✔ Setup complete! Please log out or restart.     "
echo "================================================="
