#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/seat-guard.sh"

fail=0

expect_block() {
  if oxi_guard_check "$1"; then
    printf 'FAIL: should block: %s\n' "$1"
    fail=1
  else
    printf 'ok block: %s\n' "$1"
  fi
}

expect_allow() {
  if oxi_guard_check "$1"; then
    printf 'ok allow: %s\n' "$1"
  else
    printf 'FAIL: should allow: %s\n' "$1"
    fail=1
  fi
}

expect_shell_block() {
  local tmpdir guard_path

  tmpdir="$(mktemp -d)"
  guard_path="$(cd "$(dirname "$0")" && pwd)/seat-guard.sh"
  cat >"$tmpdir/.bashrc" <<EOF
source "$guard_path" && oxi_guard_arm
EOF

  if HOME="$tmpdir" bash -ic "$1" >/dev/null 2>&1; then
    printf 'FAIL: should block in shell: %s\n' "$1"
    fail=1
  else
    printf 'ok shell block: %s\n' "$1"
  fi
}

expect_block 'rm -rf /'
expect_block 'rm -rf "/"'
expect_block 'rm -rf /*'
expect_block 'rm -rf $HOME'
expect_block 'rm -rf ~'
expect_block ':(){ :|:& };:'
expect_block 'mkfs.ext4 /dev/sda'
expect_block 'echo ok > /etc/hosts'
expect_block 'cat <<EOF > /etc/profile.d/x.sh'
expect_allow 'rm -rf /workspace/build'
expect_allow 'python3 -c "print(1+1)"'
expect_allow 'git commit -m x'
expect_shell_block 'rm -rf /'

exit "$fail"
