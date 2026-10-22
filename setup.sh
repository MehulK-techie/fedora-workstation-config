#!/usr/bin/env bash
set -e

echo "================================================="
echo "   Installing Fedora MK Workstation Edition     "
echo "================================================="

echo "==> [1/6] Installing Extension Manager & Core Utilities..."
sudo dnf install -y --assumeyes \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    gnome-shell-extension-manager \
    gnome-tweaks

echo "==> [2/6] Configuring Flathub & Flatpak Applications..."
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install -y --noninteractive flathub com.github.tenderowl.frog || true

echo "==> [3/6] Deploying MK Workstation Indicator Badge..."
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
cp -r extensions/mk-indicator@mehulk "$HOME/.local/share/gnome-shell/extensions/"

echo "==> [4/6] Fixing Alt+Tab & Workspace Navigation..."
# Enable user extensions globally
gsettings set org.gnome.shell disable-user-extensions false

# Hard-reset keybindings to clean up old imported conflicts
gsettings reset-recursively org.gnome.desktop.wm.keybindings
gsettings reset-recursively org.gnome.shell.keybindings

# Configure Alt+Tab for direct single-window switching across workspaces
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [5/6] Isolating Dock Workspaces & Restoring Screenshot Key..."
# Isolate dock per workspace so apps stay on the workspace they were launched in
gsettings set org.gnome.shell.extensions.dash-to-dock isolate-workspaces true
gsettings set org.gnome.shell.extensions.dash-to-dock isolate-monitors true
gsettings set org.gnome.shell.extensions.dash-to-dock middle-click-action 'launch-new-instance'

# Restore standard PrtScn screenshot behavior
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"

# Fallback clean wallpaper
BG_URI=$(gsettings get org.gnome.desktop.background picture-uri | tr -d "'")
if [[ "$BG_URI" == *"mehulkumar"* ]] || [ ! -f "${BG_URI#file://}" ]; then
    gsettings reset org.gnome.desktop.background picture-uri
    gsettings reset org.gnome.desktop.background picture-uri-dark
fi

echo "==> [6/6] Activating Extensions & System Profiles..."
gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true

echo "================================================="
echo "✔ Deployment complete! Logging out to finalize..."
echo "================================================="
