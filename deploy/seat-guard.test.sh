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

exit "$fail"
