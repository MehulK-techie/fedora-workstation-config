#!/bin/bash
echo "=== Syncing Local Settings to Repo ==="
dconf dump /org/gnome/shell/ > ./config/gnome-shell-full.dconf
dconf dump /org/gnome/desktop/ > ./config/gnome-desktop-full.dconf
dconf dump /org/gnome/mutter/ > ./config/gnome-mutter-full.dconf
gnome-extensions list --enabled > ./config/enabled-extensions.txt
dconf dump /org/gnome/settings-daemon/plugins/media-keys/ | sed "s|/home/$(whoami)|__USER_HOME__|g" > ./config/keybindings.dconf

rm -rf ./extensions/*
cp -r ~/.local/share/gnome-shell/extensions/* ./extensions/ 2>/dev/null || true
echo "Sync Complete!"
