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

echo "==> [2/7] Enabling Flathub & Core Flatpaks..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --system -y com.github.tenderowl.frog || true

echo "==> [3/7] Deploying Custom MK Watermark Indicator..."
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
cp -r extensions/mk-indicator@mehulk "$HOME/.local/share/gnome-shell/extensions/"

echo "==> [4/7] Permanent Alt+Tab Single-Window Switcher Fix..."
gsettings set org.gnome.shell disable-user-extensions false

# Clear all grouped application switching handlers
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-group "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-group-backward "[]"

# Bind Alt+Tab directly to individual window switching across all workspaces
gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [5/7] Restoring Screenshot Keybindings & Dock Workspace Isolation..."
# Restore standard & advanced screenshot shortcuts
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"
gsettings set org.gnome.settings-daemon.plugins.media-keys screenshot "['<Control>Print']"
gsettings set org.gnome.settings-daemon.plugins.media-keys area-screenshot "['<Shift>Print']"
gsettings set org.gnome.settings-daemon.plugins.media-keys window-screenshot "['<Alt>Print']"

# Isolate dock items to current active workspace
gsettings set org.gnome.shell.extensions.dash-to-dock isolate-workspaces true 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock isolate-monitors true 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock middle-click-action 'launch-new-app' 2>/dev/null || true

# Fallback clean wallpaper
BG_URI=$(gsettings get org.gnome.desktop.background picture-uri | tr -d "'")
if [[ "$BG_URI" == *"mehulkumar"* ]] || [ ! -f "${BG_URI#file://}" ]; then
    gsettings reset org.gnome.desktop.background picture-uri
    gsettings reset org.gnome.desktop.background picture-uri-dark
fi

echo "==> [6/7] Configuring Howdy Facial Recognition PAM Hooks..."
for pam_file in /etc/pam.d/sudo /etc/pam.d/gdm-password; do
    if [ -f "$pam_file" ] && ! grep -q "pam_howdy" "$pam_file"; then
        sudo sed -i '1i auth sufficient pam_python.so /lib64/security/howdy/pam.py' "$pam_file" 2>/dev/null || true
    fi
done

echo "==> [7/7] Activating Extensions..."
gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true

echo "================================================="
echo "✔ MK Workstation setup completed successfully!  "
echo "================================================="

# Ask if user wants to register face scan right now
read -p "Would you like to register your face for Howdy unlock now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ./register-face.sh
fi
