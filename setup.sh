#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== Starting Fedora Workstation Suite Installation ===${NC}\n"

# 1. System Package Installation
echo -e "${YELLOW}[1/6] Installing DNF system dependencies...${NC}"
if [ -f "./apps/dnf-packages.txt" ]; then
    sudo dnf install -y $(cat ./apps/dnf-packages.txt)
fi

# 2. Flatpak Dependencies
echo -e "${YELLOW}[2/6] Setting up Flathub & Flatpak applications...${NC}"
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo 2>/dev/null || true
if [ -f "./apps/flatpaks.txt" ]; then
    while read -r pkg; do
        [ -n "$pkg" ] && flatpak install -y flathub "$pkg" 2>/dev/null || true
    done < ./apps/flatpaks.txt
fi

# 3. Deploy Custom Executables & Extensions
echo -e "${YELLOW}[3/6] Deploying custom binaries & local extension suite...${NC}"
mkdir -p ~/.local/bin
if [ -d "./bin" ]; then
    chmod +x ./bin/* 2>/dev/null || true
    cp -r ./bin/* ~/.local/bin/
fi

mkdir -p ~/.local/share/gnome-shell/extensions
if [ -d "./extensions" ]; then
    cp -r ./extensions/* ~/.local/share/gnome-shell/extensions/
    for ext_dir in ./extensions/*; do
        if [ -d "$ext_dir/schemas" ]; then
            glib-compile-schemas "$ext_dir/schemas" 2>/dev/null || true
        fi
    done
fi

# 4. Unbind System Hotkey Collisions
echo -e "${YELLOW}[4/6] Clearing default shortcut conflicts...${NC}"
gsettings set org.freedesktop.ibus.panel.emoji hotkey "@as []" 2>/dev/null || true
gsettings set org.freedesktop.ibus.panel.emoji unicode-hotkey "@as []" 2>/dev/null || true
gsettings set org.gnome.desktop.wm.keybindings insert-emoji "[]" 2>/dev/null || true

# 5. Restore dconf System Settings
echo -e "${YELLOW}[5/6] Restoring GNOME dconf profiles...${NC}"
[ -f "./config/gnome-shell-full.dconf" ] && dconf load /org/gnome/shell/ < ./config/gnome-shell-full.dconf
[ -f "./config/gnome-desktop-full.dconf" ] && dconf load /org/gnome/desktop/ < ./config/gnome-desktop-full.dconf
[ -f "./config/gnome-mutter-full.dconf" ] && dconf load /org/gnome/mutter/ < ./config/gnome-mutter-full.dconf

# 6. Enable Extensions
echo -e "${YELLOW}[6/6] Activating GNOME Shell extensions...${NC}"
if [ -f "./config/enabled-extensions.txt" ]; then
    while read -r ext; do
        if [ -n "$ext" ]; then
            gnome-extensions enable "$ext" 2>/dev/null || true
        fi
    done < ./config/enabled-extensions.txt
fi

echo -e "\n${GREEN}✔ Installation complete! Please log out or restart to apply GNOME Shell extension mappings.${NC}"
