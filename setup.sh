#!/bin/bash
set +e
USER_HOME="$HOME"

echo "=== 1. Enabling Flathub ==="
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

echo "=== 2. Installing DNF Packages ==="
if [ -f ./apps/dnf-packages.txt ]; then
    sudo dnf install -y $(grep -v '^#' ./apps/dnf-packages.txt | xargs)
fi

echo "=== 3. Installing Flatpaks ==="
if [ -f ./apps/flatpaks.txt ]; then
    flatpak install -y flathub $(grep -v '^#' ./apps/flatpaks.txt | xargs)
fi

echo "=== 4. Deploying Extension Binaries ==="
mkdir -p "$USER_HOME/.local/share/gnome-shell/extensions"
if [ -d ./extensions ]; then
    cp -r ./extensions/* "$USER_HOME/.local/share/gnome-shell/extensions/" 2>/dev/null || true
fi

echo "=== 5. Restoring Interface & Keybindings ==="
[ -f ./config/gnome-shell-full.dconf ] && dconf load /org/gnome/shell/ < ./config/gnome-shell-full.dconf
[ -f ./config/gnome-desktop-full.dconf ] && dconf load /org/gnome/desktop/ < ./config/gnome-desktop-full.dconf
[ -f ./config/gnome-mutter-full.dconf ] && dconf load /org/gnome/mutter/ < ./config/gnome-mutter-full.dconf

if [ -f ./config/keybindings.dconf ]; then
    sed "s|__USER_HOME__|$USER_HOME|g" ./config/keybindings.dconf | dconf load /org/gnome/settings-daemon/plugins/media-keys/
fi

echo "=== 6. Activating Extensions ==="
if [ -f ./config/enabled-extensions.txt ]; then
    while IFS= read -r ext_id; do
        gnome-extensions enable "$ext_id" 2>/dev/null || true
    done < ./config/enabled-extensions.txt
fi

echo "=== 7. Syncing Custom Utilities ==="
mkdir -p "$USER_HOME/.local/bin"
if [ -f ./bin/ocr-snip ]; then
    cp ./bin/ocr-snip "$USER_HOME/.local/bin/ocr-snip"
    chmod +x "$USER_HOME/.local/bin/ocr-snip"
fi

echo "=== 8. Applying Hardware & Physics Optimizations ==="
sudo systemctl enable --now fprintd.service 2>/dev/null || true
if lsusb | grep -qi -E 'fingerprint|synaptics|goodix|validity'; then
    echo "Fingerprint reader found. Enabling PAM authentication..."
    sudo authselect enable-feature with-fingerprint 2>/dev/null || true
    sudo authselect apply-changes 2>/dev/null || true
fi

sudo systemctl disable NetworkManager-wait-online.service 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock animation-time 0.25 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock show-delay 0.05 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock hide-delay 0.18 2>/dev/null || true

gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']" 2>/dev/null || true
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]" 2>/dev/null || true
gsettings set org.gnome.shell.window-switcher current-workspace-only false 2>/dev/null || true

dconf update 2>/dev/null || true

echo "========================================================"
echo " Setup Complete! Restart or log out to apply changes.   "
echo "========================================================"
