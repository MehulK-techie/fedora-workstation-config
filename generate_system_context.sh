#!/usr/bin/env bash
set -e

OUT_FILE="FEDORA_MK_FULL_CONTEXT.md"
echo "# Full System & Repository Context Dump" > "$OUT_FILE"
echo "Generated on: $(date)" >> "$OUT_FILE"

append_section() {
    local title="$1"
    local cmd="$2"
    echo -e "\n## $title\n\`\`\`" >> "$OUT_FILE"
    eval "$cmd" 2>&1 >> "$OUT_FILE" || echo "[Failed or Not Found]" >> "$OUT_FILE"
    echo "\`\`\`" >> "$OUT_FILE"
}

# 1. Hardware & OS Baseline
append_section "OS & Kernel Info" "cat /etc/os-release | grep -E 'NAME|VERSION|ID'; uname -r; echo Desktop: \$XDG_CURRENT_DESKTOP; echo Session: \$XDG_SESSION_TYPE"
append_section "Video Devices (/dev/video*)" "v4l2-ctl --list-devices 2>/dev/null || ls -l /dev/video*"
append_section "SELinux Status" "sestatus"

# 2. DNF & Repositories
append_section "/etc/dnf/dnf.conf" "cat /etc/dnf/dnf.conf"
append_section "Enabled Repositories" "dnf repolist"

# 3. PAM Configurations
append_section "/etc/pam.d/sudo" "cat /etc/pam.d/sudo"
append_section "/etc/pam.d/gdm-password" "cat /etc/pam.d/gdm-password"

# 4. Howdy Configuration & Status
append_section "Howdy Config (config.ini)" "cat /etc/howdy/config.ini 2>/dev/null || cat /usr/lib64/security/howdy/config.ini 2>/dev/null || echo 'Not installed/found'"
append_section "Howdy User List" "sudo howdy list 2>/dev/null || echo 'Howdy command not executable without prompt or not installed'"

# 5. GNOME Shell & Extensions
append_section "Installed GNOME Extensions" "gnome-extensions list --details 2>/dev/null || gnome-extensions list"
append_section "User GNOME Extensions Directory" "ls -la ~/.local/share/gnome-shell/extensions/"
append_section "System GNOME Extensions Directory" "ls -la /usr/share/gnome-shell/extensions/ 2>/dev/null || echo 'None'"
append_section "Custom Indicator Extension metadata.json" "cat extensions/mk-indicator@mehulk/metadata.json 2>/dev/null || cat ~/.local/share/gnome-shell/extensions/mk-indicator@mehulk/metadata.json 2>/dev/null || echo 'Not found'"
append_section "Custom Indicator Extension extension.js" "cat extensions/mk-indicator@mehulk/extension.js 2>/dev/null || cat ~/.local/share/gnome-shell/extensions/mk-indicator@mehulk/extension.js 2>/dev/null || echo 'Not found'"

# 6. Current Repository Structure & Scripts
append_section "Repository Git Status & Tree" "git status -s; tree -L 3 -I '.git' 2>/dev/null || find . -maxdepth 3 -not -path '*/.*'"
append_section "Local setup.sh" "cat setup.sh"
append_section "Local register-face.sh" "cat register-face.sh"

echo "[✓] Complete system and repository context generated in: $OUT_FILE"
