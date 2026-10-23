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

# Update everything: repo, new apps, settings, extensions, system (--check to preview)
update *ARGS:
    ./bin/mk update {{ARGS}}

# Capture apps, extensions and settings you added, and commit them
save:
    ./bin/mk save

# Syntax-check and lint every script
check:
    ./scripts/lint.sh
