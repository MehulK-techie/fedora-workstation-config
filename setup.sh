#!/usr/bin/env bash
set -e

echo "==> [1/5] Installing System Packages & Extension Tools..."
sudo dnf install -y \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    gnome-shell-extension-manager

echo "==> [2/5] Enabling Flathub & Flatpak Applications..."
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub com.github.tenderowl.frog || true

echo "==> [3/5] Applying Workspace & Alt+Tab Preferences..."
# Enable user extensions globally
gsettings set org.gnome.shell disable-user-extensions false

# Unbind application grouping and enable single-window switching across all workspaces
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [4/5] Fixing Screenshots & Restoring Default Background..."
# Clear custom keybindings overriding PrtScn and re-enable Screenshot UI
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
gsettings reset org.gnome.shell.keybindings show-screenshot-ui
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"

# Reset wallpaper to default if the imported path is missing
BG_URI=$(gsettings get org.gnome.desktop.background picture-uri | tr -d "'")
if [[ "$BG_URI" == *"mehulkumar"* ]] || [ ! -f "${BG_URI#file://}" ]; then
    gsettings reset org.gnome.desktop.background picture-uri
    gsettings reset org.gnome.desktop.background picture-uri-dark
fi

echo "==> [5/5] Activating Desktop Extensions..."
gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true

echo "✔ Installation & configuration complete! Please restart or log out to finalize changes."