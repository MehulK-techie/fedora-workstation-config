# MK Workstation tasks. Run `just` to list them.

default:
    @just --list

# Install everything: repos, codecs, apps and desktop settings (add --no-face to skip Howdy)
setup *ARGS:
    sudo ./setup.sh {{ARGS}}

# Re-apply desktop settings only (no sudo)
sync:
    ./sync.sh

# Enroll face unlock with Howdy
face:
    sudo ./register-face.sh

# Save this machine's GNOME settings and extensions into the repo
export:
    ./scripts/update-repo.sh

# Pull the latest version and re-apply desktop settings
update:
    git pull --ff-only
    ./sync.sh

# Syntax-check and lint every script
check:
    ./scripts/lint.sh
