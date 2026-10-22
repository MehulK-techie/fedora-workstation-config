#!/usr/bin/env bash
set -e

MSG="${1:-update workstation configuration and dconf backups}"
BRANCH=$(git branch --show-current)

echo -e "\033[0;34m🔄 Exporting live GNOME configurations & enabled extensions...\033[0m"
mkdir -p ./config

gnome-extensions list --enabled > ./config/enabled-extensions.txt 2>/dev/null || true

dconf dump /org/gnome/shell/ > ./config/gnome-shell-full.dconf
dconf dump /org/gnome/desktop/ > ./config/gnome-desktop-full.dconf
dconf dump /org/gnome/mutter/ > ./config/gnome-mutter-full.dconf
dconf dump /org/gnome/settings-daemon/plugins/media-keys/ > ./config/gnome-media-keys.dconf 2>/dev/null || true

echo -e "\033[0;33m📦 Staging files and committing to branch [$BRANCH]...\033[0m"
git add .
git commit -m "$MSG" || echo "No changes to commit."

echo -e "\033[0;32m🚀 Pushing to GitHub origin/$BRANCH...\033[0m"
git push origin "$BRANCH"

echo -e "\033[0;32m✔ Repository synchronized successfully!\033[0m"
