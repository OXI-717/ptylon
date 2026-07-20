#!/usr/bin/env bash

# Minimal fail-safe guard for engine bash sessions.
# Blocks a small set of destructive command strings and defaults to "block on doubt".
oxi_guard_check() {
    local cmd="${1-}"

    case "$cmd" in
        *':(){'*|*':|:&'*|*'};:'*)
            return 1
            ;;
    esac

    case "$cmd" in
        *mkfs*)
            return 1
            ;;
    esac

    if printf '%s' "$cmd" | grep -Eq '(^|[[:space:];|&])(sudo[[:space:]]+)?rm([[:space:]-]+[^;&|]*)*[[:space:]]+-[^;&|]*r[^;&|]*f[^;&|]*[[:space:]]+(/([[:space:]]|$)|~([[:space:]]|$)|\$HOME([[:space:]]|$)|\$\{HOME\}([[:space:]]|$)|/etc(/|[[:space:]]|$))'; then
        return 1
    fi

    case "$cmd" in
        *'> /etc/'*|*'>> /etc/'*|*'>/etc/'*|*'>>/etc/'*|*'| tee /etc/'*|*'|sudo tee /etc/'*|*'tee /etc/'*|*'install '*'/etc/'*|*'cp '*'/etc/'*|*'mv '*'/etc/'*|*'rsync '*'/etc/'*)
            return 1
            ;;
    esac

    return 0
}
