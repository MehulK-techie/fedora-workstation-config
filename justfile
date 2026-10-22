default:
    @just --list

# Complete system setup
setup:
    sudo ./setup.sh
    ./sync-shortcuts.sh

# Enroll biometric facial authentication
face:
    sudo ./register-face.sh

# Sync shortcuts and desktop keybindings
shortcuts:
    ./sync-shortcuts.sh

# Export active GNOME dconf settings to repository config
sync:
    ./sync.sh
