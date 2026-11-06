# MK Workstation: terminal helpers. Sourced from ~/.bashrc (sync.sh adds the
# line once); edit this file in the repo, not the copy.

# alert-when-done CMD...: run CMD; if it took 15 s or more, a desktop
# notification says so (with its exit code). Returns CMD's exit code.
#   alert-when-done make -j8
alert-when-done() {
    local start_time elapsed exit_code
    start_time=$(date +%s)
    "$@"
    exit_code=$?
    elapsed=$(( $(date +%s) - start_time ))
    if (( elapsed >= 15 )) && command -v notify-send >/dev/null; then
        notify-send -u normal -i utilities-terminal "Command Completed (${elapsed}s)" "$* (exit: $exit_code)"
    fi
    return "$exit_code"
}
