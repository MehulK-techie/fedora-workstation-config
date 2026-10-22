#!/usr/bin/env bash
set -e

echo "================================================="
echo "   Installing Fedora MK Workstation Edition     "
echo "================================================="

REAL_USER=${SUDO_USER:-$USER}
USER_HOME=$(eval echo "~$REAL_USER")

echo "==> [1/6] Installing Packages via DNF..."
sudo dnf copr enable -y principis/howdy || true
sudo dnf install -y --skip-unavailable \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    extension-manager \
    gnome-tweaks \
    howdy || true

echo "==> [2/6] Configuring Flathub & Core Flatpaks..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --system -y com.github.tenderowl.frog || true

echo "==> [3/6] Deploying MK Indicator Extension..."
mkdir -p "$USER_HOME/.local/share/gnome-shell/extensions"
if [ -d "extensions/mk-indicator@mehulk" ]; then
    cp -r extensions/mk-indicator@mehulk "$USER_HOME/.local/share/gnome-shell/extensions/"
    chown -R "$REAL_USER:$REAL_USER" "$USER_HOME/.local/share/gnome-shell/extensions/mk-indicator@mehulk"
fi

echo "==> [4/6] Configuring User Preferences & Alt+Tab..."
sudo -u "$REAL_USER" gsettings set org.gnome.shell disable-user-extensions false
sudo -u "$REAL_USER" gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
sudo -u "$REAL_USER" gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
sudo -u "$REAL_USER" gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
sudo -u "$REAL_USER" gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
sudo -u "$REAL_USER" gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [5/6] Restoring Screenshot Key & Dock Workspace Isolation..."
sudo -u "$REAL_USER" gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
sudo -u "$REAL_USER" gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"

sudo -u "$REAL_USER" gsettings set org.gnome.shell.extensions.dash-to-dock isolate-workspaces true 2>/dev/null || true
sudo -u "$REAL_USER" gsettings set org.gnome.shell.extensions.dash-to-dock isolate-monitors true 2>/dev/null || true

echo "==> [6/6] Enabling GNOME Extensions..."
sudo -u "$REAL_USER" gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
sudo -u "$REAL_USER" gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true

echo "================================================="
echo "✔ MK Workstation Edition deployment complete!   "
echo "================================================="
