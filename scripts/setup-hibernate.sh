#!/usr/bin/env bash
# Set up hibernation on Fedora (run it yourself, once: sudo scripts/setup-hibernate.sh).
#
#   1. a swap file the size of your RAM (Fedora's own swap is zram, in memory,
#      which can't hold a hibernation image): /var/swap/swapfile, in its own
#      Btrfs subvolume (no copy-on-write) on Btrfs, a plain file otherwise
#   2. it in /etc/fstab (backed up first to /etc/fstab.bak, never overwritten)
#   3. the kernel's resume= and resume_offset= (grubby, every installed kernel)
#   4. dracut's resume module, and the initramfs rebuilt
#   5. the polkit rule /etc/polkit-1/rules.d/10-enable-hibernate.rules: you (an
#      active, local session) may hibernate without a password
#
#   sudo scripts/setup-hibernate.sh [--size GiB] [--dry-run]
#
# Safe to run again: each step checks what's there first. Afterwards restart,
# then try: mk-hibernate --check
# Secure Boot: Fedora's kernel locks itself down then, and refuses to hibernate;
# this script says so and still prepares the rest.
set -euo pipefail

SWAPDIR=/var/swap
SWAPFILE=$SWAPDIR/swapfile
POLKIT=/etc/polkit-1/rules.d/10-enable-hibernate.rules
DRACUT=/etc/dracut.conf.d/90-mk-resume.conf
DRY=0
SIZE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --size) SIZE="${2:?--size needs a number of GiB}"; shift 2 ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 && $DRY -eq 0 ]]; then
    echo "Run it as root: sudo $0" >&2
    exit 1
fi

run() {
    if [[ $DRY -eq 1 ]]; then
        printf 'would run: %s\n' "$*"
    else
        "$@"
    fi
}

backup() {
    # a copy before the first change, never overwriting an older one
    if [[ -f "$1" && ! -e "$1.bak" ]]; then
        run cp -a "$1" "$1.bak"
    fi
}

ram_gib=$(awk '/MemTotal/ { printf "%d", ($2 / 1048576) + 1 }' /proc/meminfo)
SIZE=${SIZE:-$ram_gib}
echo "RAM: about ${ram_gib} GiB; swap file: ${SIZE} GiB at $SWAPFILE"

if [[ -r /sys/kernel/security/lockdown ]] && grep -qE '\[(integrity|confidentiality)\]' /sys/kernel/security/lockdown; then
    echo "Note: kernel lockdown is on (Secure Boot). The kernel will refuse to hibernate until Secure Boot is off;"
    echo "      everything else is set up anyway."
fi

# ----- 1. the swap file
fstype=$(findmnt -no FSTYPE -T /var)
if [[ -f "$SWAPFILE" ]]; then
    echo "Swap file: already there"
else
    if [[ "$fstype" == "btrfs" ]]; then
        if ! btrfs subvolume show "$SWAPDIR" > /dev/null 2>&1; then
            [[ -e "$SWAPDIR" ]] && { echo "$SWAPDIR exists and isn't a Btrfs subvolume: move it aside first." >&2; exit 1; }
            run btrfs subvolume create "$SWAPDIR"
        fi
        run btrfs filesystem mkswapfile --size "${SIZE}g" --uuid clear "$SWAPFILE"
    else
        run mkdir -p "$SWAPDIR"
        run fallocate -l "${SIZE}G" "$SWAPFILE"
        run chmod 600 "$SWAPFILE"
        run mkswap "$SWAPFILE"
    fi
    if command -v semanage > /dev/null; then
        semanage fcontext -l 2>/dev/null | grep -q "^$SWAPDIR(/.\*)?" || run semanage fcontext -a -t swapfile_t "$SWAPDIR(/.*)?"
        run restorecon -RF "$SWAPDIR"
    fi
fi

# ----- 2. /etc/fstab (a low priority: zram stays the swap used day to day)
if grep -qE "^[[:space:]]*${SWAPFILE}[[:space:]]" /etc/fstab; then
    echo "fstab: already lists the swap file"
else
    backup /etc/fstab
    if [[ $DRY -eq 1 ]]; then
        echo "would add to /etc/fstab: $SWAPFILE none swap defaults,pri=0 0 0"
    else
        printf '%s none swap defaults,pri=0 0 0\n' "$SWAPFILE" >> /etc/fstab
    fi
fi
if [[ $DRY -eq 0 ]] && ! swapon --show=NAME --noheadings | grep -qx "$SWAPFILE"; then
    swapon --priority 0 "$SWAPFILE"
fi

# ----- 3. resume= and resume_offset=
uuid=$(findmnt -no UUID -T "$SWAPFILE" 2>/dev/null || true)
if [[ "$fstype" == "btrfs" ]]; then
    offset=$(btrfs inspect-internal map-swapfile -r "$SWAPFILE" 2>/dev/null || true)
else
    offset=$(filefrag -v "$SWAPFILE" 2>/dev/null | awk '$1 == "0:" { sub(/\.\./, "", $4); print $4; exit }')
fi
if [[ -z "$uuid" || -z "$offset" ]]; then
    if [[ $DRY -eq 1 ]]; then
        echo "would set: resume=UUID=<the file system's> resume_offset=<the swap file's>"
    else
        echo "Couldn't read the swap file's UUID or offset; resume= not set." >&2
        exit 1
    fi
else
    args="resume=UUID=$uuid resume_offset=$offset"
    if grep -q -- "resume_offset=$offset" /proc/cmdline 2>/dev/null && grubby --info=DEFAULT | grep -q -- "$args"; then
        echo "Kernel: already resumes from the swap file"
    else
        run grubby --update-kernel=ALL --args="$args"
    fi
fi

# ----- 4. dracut's resume module
if [[ -f "$DRACUT" ]] && grep -q 'resume' "$DRACUT"; then
    echo "dracut: resume module already on"
else
    if [[ $DRY -eq 1 ]]; then
        echo "would write $DRACUT and rebuild the initramfs"
    else
        printf '# MK Workstation: hibernation (scripts/setup-hibernate.sh)\nadd_dracutmodules+=" resume "\n' > "$DRACUT"
        dracut -f
    fi
fi

# ----- 5. polkit: an active, local session may hibernate
rule='// MK Workstation (scripts/setup-hibernate.sh): an active, local session may hibernate.
polkit.addRule(function (action, subject) {
    if ((action.id == "org.freedesktop.login1.hibernate" ||
         action.id == "org.freedesktop.login1.hibernate-multiple-sessions" ||
         action.id == "org.freedesktop.login1.handle-hibernate-key") &&
        subject.active && subject.local) {
        return polkit.Result.YES;
    }
});'
if [[ -f "$POLKIT" ]] && [[ "$(cat "$POLKIT")" == "$rule" ]]; then
    echo "polkit: rule already in place"
else
    backup "$POLKIT"
    if [[ $DRY -eq 1 ]]; then
        echo "would write $POLKIT"
    else
        printf '%s\n' "$rule" > "$POLKIT"
        chmod 644 "$POLKIT"
    fi
fi

echo
echo "Done. Restart, then check with: mk-hibernate --check"
