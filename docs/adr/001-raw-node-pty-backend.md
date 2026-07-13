# ADR 001: Keep `node-pty` as the terminal backend

## Status

Accepted

## Context

Ptylon provides browser-accessible terminal sessions that must behave like
ordinary shell processes and remain owned by the long-lived PTY daemon.

## Decision

Use raw [`node-pty`](https://github.com/microsoft/node-pty) sessions. Do not
place tmux, zellij, or another terminal multiplexer behind the default backend.

## Consequences

PTY semantics, process ownership, and signal handling stay close to a native
terminal. The daemon can recover its own live sessions, while higher-level
multiplexer features remain an optional user choice inside a shell.
