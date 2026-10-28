#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: System Provisioning Engine (Root Scope)
# ==============================================================================
set -euo pipefail

usage() {
    cat << 'EOF'
Usage: ./setup.sh [--no-face]     (asks for your password; sudo ./setup.sh works too)

Installs packages, repositories, codecs and Flatpaks, then applies the MK
desktop settings (sync.sh) for the user who ran sudo. Safe to run more than
once. A log of every run is kept in /var/log/mk-workstation-setup.log.

  --no-face   Skip Howdy face unlock (it is also skipped when no camera exists)
  -h, --help  Show this help
EOF
}

INSTALL_FACE=1
for arg in "$@"; do
    case "$arg" in
        --no-face) INSTALL_FACE=0 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[-] Unknown option: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

# ./setup.sh works too: it asks for your password and runs itself with sudo,
# keeping you as the desktop user whose settings get applied.
if [[ $EUID -ne 0 ]]; then
    echo "[*] setup.sh needs administrator rights; asking sudo..."
    exec sudo --preserve-env=DISPLAY,WAYLAND_DISPLAY "$0" "$@"
fi

# shellcheck source=/dev/null
. /etc/os-release
if [[ "${ID:-}" != "fedora" ]]; then
    echo "[-] Error: This suite supports Fedora only (found: ${PRETTY_NAME:-unknown})." >&2
    exit 1
fi
if [[ -e /run/ostree-booted ]]; then
    echo "[-] Error: Fedora Atomic (Silverblue, Kinoite, ...) installs packages with rpm-ostree," >&2
    echo "    which this script doesn't support. Use Fedora Workstation." >&2
    exit 1
fi

LOG_FILE="/var/log/mk-workstation-setup.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "[+] $(date -Is) MK Workstation setup started (log: $LOG_FILE)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_USER="${SUDO_USER:-$USER}"
REAL_UID=$(id -u "$REAL_USER")
USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
USER_RUNTIME="/run/user/$REAL_UID"
WARNINGS=()

# Run a command as the desktop user inside their live session. Under sudo the
# session bus address is lost, so gsettings would otherwise write nowhere.
as_user() {
    sudo -u "$REAL_USER" env \
        HOME="$USER_HOME" \
        XDG_RUNTIME_DIR="$USER_RUNTIME" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_RUNTIME/bus" \
        "$@"
}

# Install packages only if missing, recording failures instead of aborting.
ensure_pkgs() {
    local missing=() pkg
    for pkg in "$@"; do
        rpm -q "$pkg" &>/dev/null || missing+=("$pkg")
    done
    (( ${#missing[@]} )) || return 0
    dnf install -y "${missing[@]}" || WARNINGS+=("Could not install: ${missing[*]}")
}

echo "[+] Initializing System Provisioning..."

# 1. Deduplicate & optimize DNF
DNF_CONF="/etc/dnf/dnf.conf"
if [[ -f "$DNF_CONF" ]]; then
    echo "==> Configuring DNF performance flags..."
    [[ -f "${DNF_CONF}.bak" ]] || cp -a "$DNF_CONF" "${DNF_CONF}.bak"
    sed -i -E '/^[[:space:]]*(max_parallel_downloads|fastestmirror|defaultyes)[[:space:]]*=/d' "$DNF_CONF"
    grep -q '^\[main\]' "$DNF_CONF" || echo '[main]' >> "$DNF_CONF"
    sed -i '/^\[main\]/a max_parallel_downloads=10\nfastestmirror=True\ndefaultyes=True' "$DNF_CONF"
fi

# 2. Repositories: RPM Fusion and Microsoft's VS Code repo
echo "==> Verifying repositories..."
FEDORA_VER=$(rpm -E %fedora)
if ! rpm -q rpmfusion-free-release rpmfusion-nonfree-release >/dev/null 2>&1; then
    dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm" \
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm"
fi
if [[ ! -f /etc/yum.repos.d/vscode.repo ]]; then
    rpm --import https://packages.microsoft.com/keys/microsoft.asc
    cat > /etc/yum.repos.d/vscode.repo << 'EOF'
[code]
name=Visual Studio Code
baseurl=https://packages.microsoft.com/yumrepos/vscode
enabled=1
autorefresh=1
type=rpm-md
gpgcheck=1
gpgkey=https://packages.microsoft.com/keys/microsoft.asc
EOF
fi

# 3. Howdy face unlock (optional; needs a camera)
if (( !INSTALL_FACE )); then
    echo "==> Skipping Howdy face unlock (--no-face)."
elif ! compgen -G "/dev/video*" >/dev/null; then
    WARNINGS+=("No camera found; skipped Howdy face unlock")
else
    echo "==> Installing Howdy face authentication..."
    # The COPR may lag behind new Fedora releases; report it instead of aborting setup.
    if ! { dnf copr enable -y principis/howdy && dnf install -y howdy; }; then
        WARNINGS+=("Howdy could not be installed (COPR principis/howdy may not support Fedora ${FEDORA_VER} yet)")
    fi
fi

# 4. Batch Package Installation from Declarative Manifest
if [[ -f "$SCRIPT_DIR/apps/dnf-packages.txt" ]]; then
    echo "==> Installing packages from apps/dnf-packages.txt..."
    mapfile -t PACKAGES < <(grep -vE '^\s*(#|$)' "$SCRIPT_DIR/apps/dnf-packages.txt" || true)
    (( ${#PACKAGES[@]} )) && dnf install -y --skip-unavailable "${PACKAGES[@]}"
    for pkg in "${PACKAGES[@]}"; do
        rpm -q --whatprovides "$pkg" >/dev/null 2>&1 || WARNINGS+=("DNF package not installed: $pkg")
    done
fi

# mk lock: the polkit action that asks "is it you?" (fingerprint or your
# password) before a locked app starts or a locked folder opens.
install -m 644 "$SCRIPT_DIR/assets/polkit/io.github.mehulk.mk-lock.policy" /usr/share/polkit-1/actions/
# mk optimize ram / top bar "Free cached memory": no password for the person
# at the computer (a no-argument helper; see its policy file).
install -m 644 "$SCRIPT_DIR/assets/polkit/io.github.mehulk.mk-drop-caches.policy" /usr/share/polkit-1/actions/
install -D -m 755 "$SCRIPT_DIR/assets/libexec/mk-drop-caches" /usr/local/libexec/mk-drop-caches
# Its root-only key store for locked folders (keys released after that check).
install -D -m 755 "$SCRIPT_DIR/assets/libexec/mk-lock-key" /usr/local/libexec/mk-lock-key
# mk security: its root half (read-only scan; fixes only when asked by name).
install -D -m 755 "$SCRIPT_DIR/assets/libexec/mk-security-scan" /usr/local/libexec/mk-security-scan

# Apps MK replaced: gThumb (Loupe, GNOME's image viewer, opens images now).
REMOVE_PKGS=(gthumb)
# IBus Typing Booster runs in the background (about 100 MB) even when it isn't
# one of your input sources; the MK emoji board (Super+.) covers emoji. Kept
# when you use it as an input source.
if [[ "$REAL_USER" != root ]] && ! as_user gsettings get org.gnome.desktop.input-sources sources 2> /dev/null | grep -q typing-booster; then
    REMOVE_PKGS+=(ibus-typing-booster)
fi
for pkg in "${REMOVE_PKGS[@]}"; do
    if rpm -q "$pkg" &>/dev/null; then
        echo "==> Removing $pkg (replaced)..."
        dnf remove -y "$pkg" || WARNINGS+=("Could not remove $pkg")
    fi
done

# 5. Multimedia codecs & hardware video decoding (RPM Fusion)
echo "==> Enabling full multimedia codecs..."
if rpm -q ffmpeg-free &>/dev/null && ! rpm -q ffmpeg &>/dev/null; then
    dnf swap -y ffmpeg-free ffmpeg --allowerasing || WARNINGS+=("Could not replace ffmpeg-free with the full ffmpeg")
fi

GPU_INFO=$(lspci 2>/dev/null | grep -iE 'vga|3d|display' || true)
if grep -qwE 'AMD|ATI' <<< "$GPU_INFO" && ! rpm -q mesa-va-drivers-freeworld &>/dev/null; then
    echo "==> AMD graphics: enabling hardware video decoding..."
    if rpm -q mesa-va-drivers &>/dev/null; then
        dnf swap -y mesa-va-drivers mesa-va-drivers-freeworld --allowerasing \
            || WARNINGS+=("Could not install mesa-va-drivers-freeworld (AMD video decoding)")
    else
        ensure_pkgs mesa-va-drivers-freeworld
    fi
fi
if grep -qw Intel <<< "$GPU_INFO"; then
    echo "==> Intel graphics: enabling hardware video decoding..."
    ensure_pkgs intel-media-driver
fi
if grep -qiw nvidia <<< "$GPU_INFO"; then
    ensure_pkgs libva-nvidia-driver
    if ! rpm -q akmod-nvidia &>/dev/null; then
        WARNINGS+=("NVIDIA GPU found: the proprietary driver isn't installed automatically (Secure Boot needs key enrollment); see docs/GUIDE.md")
    fi
fi

# 6. Flathub Core Runtime
echo "==> Configuring Flathub..."
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
if [[ -f "$SCRIPT_DIR/apps/flatpaks.txt" ]]; then
    while IFS= read -r app || [[ -n "$app" ]]; do
        [[ -z "$app" || "$app" =~ ^# ]] && continue
        flatpak install --system -y --noninteractive flathub "$app" || WARNINGS+=("Flatpak failed to install: $app")
    done < "$SCRIPT_DIR/apps/flatpaks.txt"
fi
flatpak update --system -y --noninteractive || WARNINGS+=("Flatpak update failed")

# 7. Hardware / SELinux Permissions
if (( INSTALL_FACE )) && command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
    echo "==> Configuring SELinux biometric camera rule..."
    setsebool -P authlogin_camera 1 || WARNINGS+=("Could not set SELinux boolean authlogin_camera")
fi

# 7b. Hardware this computer actually has (detected, so any laptop gets what it needs)
echo "==> Detecting hardware..."
# Fingerprint reader: login, lock screen and sudo. scripts/fingerprint-pam.sh
# turns on authselect's with-fingerprint and keeps gdm-password off the reader
# (backing it up first), so the lock screen's finger prompt isn't refused.
if gdbus call --system --dest net.reactivated.Fprint \
        --object-path /net/reactivated/Fprint/Manager \
        --method net.reactivated.Fprint.Manager.GetDevices 2>/dev/null | grep -q 'Device/'; then
    echo "    Fingerprint reader found"
    "$SCRIPT_DIR/scripts/fingerprint-pam.sh" \
        || WARNINGS+=("Fingerprint setup incomplete; see the messages above (sudo scripts/fingerprint-pam.sh)")
    if ! sudo -u "$REAL_USER" fprintd-list "$REAL_USER" 2>/dev/null | grep -q '^ - '; then
        WARNINGS+=("Fingerprint reader ready, but no finger is enrolled: run 'mk fingerprint'")
    fi
fi
# Bluetooth and Airplane mode: systemd-rfkill keeps each radio's on/off
# state across reboots. Masked, Bluetooth can come up blocked at every boot.
if systemctl is-enabled systemd-rfkill.service 2>/dev/null | grep -q masked; then
    echo "    Radios: unmasking systemd-rfkill (Bluetooth/Airplane state survives reboots)"
    systemctl unmask systemd-rfkill.service systemd-rfkill.socket \
        || WARNINGS+=("Could not unmask systemd-rfkill")
    systemctl enable --now systemd-rfkill.socket 2>/dev/null || true
fi
# 2-in-1 laptops: the sensor service GNOME uses for auto-rotation and tablet mode.
case "$(hostnamectl chassis 2>/dev/null)" in
    convertible|tablet)
        echo "    2-in-1 detected: screen rotation and tablet mode"
        ensure_pkgs iio-sensor-proxy
        ;;
esac
# Login screen in your resolution and scaling, so logging in doesn't flash
# through a display mode change between the login screen and the desktop.
USER_MONITORS="$USER_HOME/.config/monitors.xml"
GDM_MONITORS="/var/lib/gdm/.config/monitors.xml"
if [[ -f "$USER_MONITORS" ]] && id gdm &>/dev/null && ! cmp -s "$USER_MONITORS" "$GDM_MONITORS"; then
    echo "    Login screen: using your display layout"
    [[ -f "$GDM_MONITORS" && ! -f "$GDM_MONITORS.bak" ]] && cp -a "$GDM_MONITORS" "$GDM_MONITORS.bak"
    install -d -o gdm -g gdm -m 700 "$(dirname "$GDM_MONITORS")"
    install -o gdm -g gdm -m 644 "$USER_MONITORS" "$GDM_MONITORS"
    restorecon "$GDM_MONITORS" 2>/dev/null || true
fi

# 7b-2. Wrong-password lockout: 5 failed attempts within 15 minutes lock the
# account for 5 minutes (pam_faillock, through authselect). Fingerprint and
# face unlock still work while it's locked; the lock ends by itself, or
# early with: faillock --user NAME --reset (as root).
if authselect current &>/dev/null; then
    echo "==> Login lockout after 5 failed passwords..."
    if ! authselect current | grep -q with-faillock; then
        authselect enable-feature -b with-faillock || WARNINGS+=("Could not enable with-faillock")
    fi
    FAILLOCK_CONF=/etc/security/faillock.conf
    if [[ -f "$FAILLOCK_CONF" ]]; then
        [[ -f "$FAILLOCK_CONF.bak" ]] || cp -a "$FAILLOCK_CONF" "$FAILLOCK_CONF.bak"
        # Drop our keys wherever they are, then add them once: no duplicates on re-runs.
        sed -i -E '/^[[:space:]]*(deny|unlock_time|fail_interval)[[:space:]]*=/d; /^# MK Workstation lockout$/d' "$FAILLOCK_CONF"
        printf '# MK Workstation lockout\ndeny = 5\nfail_interval = 900\nunlock_time = 300\n' >> "$FAILLOCK_CONF"
    fi
fi

# 7b-3. Shutting down: systemd asks every service and app to close (SIGTERM),
# waits, then stops what's left (SIGKILL). Fedora waits up to 45 s per
# service, which looks like a frozen power-off; 15 s is plenty for apps to
# save and close cleanly. Our own drop-in files: delete them to undo.
echo "==> Quicker, clean power-off (15 s for apps to close)..."
for scope in system user; do
    install -d "/etc/systemd/$scope.conf.d"
    printf '# MK Workstation (setup.sh): apps get 15 s to close at power-off\n[Manager]\nDefaultTimeoutStopSec=15s\n' \
        > "/etc/systemd/$scope.conf.d/90-mk-shutdown.conf"
done
systemctl daemon-reload

# 7c. Smooth under heavy load: memory and disk-write tuning for a desktop.
# Fedora swaps to zram (compressed RAM, very fast), so swapping early is cheap
# and beats dropping cached files that then have to be read back from disk;
# small dirty-write limits stop big copies from stalling everything at once.
# Our own file (sorts last, so it wins); remove it to go back to the defaults.
echo "==> Tuning memory and disk writes for a responsive desktop..."
SYSCTL_FILE="/etc/sysctl.d/99-mk-desktop.conf"
cat > "$SYSCTL_FILE" << 'SYSCTL'
# MK Workstation: responsive desktop under heavy load (setup.sh writes this file)
# zram swap is fast: swap anonymous memory before evicting the file cache
vm.swappiness = 180
# read one page at a time from zram, not 8 (it has no seek cost)
vm.page-cluster = 0
# keep directory and inode caches a bit longer
vm.vfs_cache_pressure = 50
# write back in small batches: no multi-second stalls after a big copy
vm.dirty_bytes = 268435456
vm.dirty_background_bytes = 67108864
SYSCTL
if swapon --show=NAME --noheadings 2> /dev/null | grep -q zram; then
    sysctl --system > /dev/null && echo "    [+] Applied (zram swap found)"
else
    # Without zram, swapping goes to disk: keep the kernel's usual eagerness.
    sed -i 's/^vm.swappiness = 180/vm.swappiness = 60/; s/^vm.page-cluster = 0/vm.page-cluster = 3/' "$SYSCTL_FILE"
    sysctl --system > /dev/null && echo "    [+] Applied (disk swap: swappiness 60)"
fi

# 8. Firmware: report available updates, never flash automatically
if command -v fwupdmgr &>/dev/null; then
    echo "==> Checking for firmware updates..."
    fwupdmgr refresh --force &>/dev/null || true
    if fwupdmgr get-updates --no-unreported-check --no-metadata-check < /dev/null &>/dev/null; then
        WARNINGS+=("Firmware updates are available: review and apply them with 'fwupdmgr update'")
    fi
fi

# 9. Desktop settings, applied as the desktop user (sync.sh is the single source)
if [[ "$REAL_USER" == "root" ]]; then
    WARNINGS+=("Run via sudo from your desktop user to apply GNOME settings")
elif [[ ! -S "$USER_RUNTIME/bus" ]]; then
    WARNINGS+=("No GNOME session for $REAL_USER; log into GNOME and run ./sync.sh to apply desktop settings")
else
    echo "==> Applying desktop settings for $REAL_USER..."
    as_user "$SCRIPT_DIR/sync.sh" || WARNINGS+=("Desktop settings failed; run ./sync.sh from your GNOME terminal")
fi

if (( ${#WARNINGS[@]} )); then
    echo "⚠ Completed with warnings:"
    printf '    - %s\n' "${WARNINGS[@]}"
fi
echo "✔ Setup complete. Log out and back in to load extensions."
if (( INSTALL_FACE )) && command -v howdy &>/dev/null; then
    echo "  Optional: sudo ./register-face.sh to enroll face unlock."
fi
