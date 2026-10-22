#!/usr/bin/env bash
set -e

echo "================================================="
echo "   Installing Fedora MK Workstation Edition     "
echo "================================================="

echo "==> [1/6] Installing System Packages & Extension Utilities..."
sudo dnf install -y --assumeyes \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    gnome-shell-extension-manager \
    gnome-tweaks

echo "==> [2/6] Enabling Flathub & Core Flatpak Applications..."
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install -y --noninteractive flathub com.github.tenderowl.frog || true

echo "==> [3/6] Deploying Custom MK Watermark Indicator..."
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
cp -r extensions/mk-indicator@mehulk "$HOME/.local/share/gnome-shell/extensions/"

echo "==> [4/6] Configuring Wayland Gestures & Workspace Navigation..."
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.mutter dynamic-workspaces true
gsettings set org.gnome.mutter workspaces-only-on-primary false

gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [5/6] Restoring Native Screenshot Keybindings & Clean Wallpaper..."
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
gsettings reset org.gnome.shell.keybindings show-screenshot-ui
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"

BG_URI=$(gsettings get org.gnome.desktop.background picture-uri | tr -d "'")
if [[ "$BG_URI" == *"mehulkumar"* ]] || [ ! -f "${BG_URI#file://}" ]; then
    gsettings reset org.gnome.desktop.background picture-uri
    gsettings reset org.gnome.desktop.background picture-uri-dark
fi

echo "==> [6/6] Activating Extensions & MK Edition Badge..."
gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true

echo "================================================="
echo "✔ MK Workstation Edition successfully deployed! "
echo "   Please log out or restart to complete setup. "
echo "================================================="
