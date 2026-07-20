#!/usr/bin/env bash

# Minimal fail-safe guard for engine bash sessions.
# Blocks a small set of destructive command strings and defaults to "block on doubt".
oxi_guard_token() {
    local token="${1-}"

    while :; do
        case "$token" in
            *[\\\;\&\|])
                token="${token%?}"
                ;;
            *)
                break
                ;;
        esac
    done

    while :; do
        case "$token" in
            \"*\")
                token="${token#\"}"
                token="${token%\"}"
                ;;
            \'*\')
                token="${token#\'}"
                token="${token%\'}"
                ;;
            *)
                break
                ;;
        esac
    done

    printf '%s' "$token"
}

oxi_guard_check() {
    local cmd="${1-}"
    local -a argv=()
    local token target
    local saw_rm=0 saw_r=0 saw_f=0

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

    read -r -a argv <<<"$cmd"
    for token in "${argv[@]}"; do
        token="$(oxi_guard_token "$token")"

        case "$token" in
            sudo)
                continue
                ;;
            rm)
                saw_rm=1
                continue
                ;;
        esac

        if [ "$saw_rm" -eq 0 ]; then
            continue
        fi

        case "$token" in
            -*)
                case "$token" in
                    *r*) saw_r=1 ;;
                esac
                case "$token" in
                    *f*) saw_f=1 ;;
                esac
                continue
                ;;
            --)
                continue
                ;;
        esac

        if [ "$saw_r" -eq 1 ] && [ "$saw_f" -eq 1 ]; then
            target="$token"
            case "$target" in
                /workspace|/workspace/*)
                    return 0
                    ;;
                /|\~|'$HOME'|'${HOME}'|/etc|/etc/*|/*)
                    return 1
                    ;;
            esac
        fi
    done

    case "$cmd" in
        *'> /etc/'*|*'>> /etc/'*|*'>/etc/'*|*'>>/etc/'*|*'| tee /etc/'*|*'|sudo tee /etc/'*|*'tee /etc/'*|*'install '*'/etc/'*|*'cp '*'/etc/'*|*'mv '*'/etc/'*|*'rsync '*'/etc/'*)
            return 1
            ;;
    esac

    return 0
}

oxi_guard_arm() {
    shopt -s extdebug 2>/dev/null || return 0
    trap 'oxi_guard_trap' DEBUG
}

oxi_guard_trap() {
    local cmd="${BASH_COMMAND-}"

    if ! oxi_guard_check "$cmd"; then
        printf '[seat-guard] blocked: %s\n' "$cmd" >&2
        return 1
    fi

    return 0
}
