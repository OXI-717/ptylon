# ADR 002: Separate the restartable WebSocket gateway from PTY ownership

## Status

Accepted

## Context

Browser connections can fail or require a gateway restart. Restarting a
browser-facing component must not terminate coding-agent or user shell work.

## Decision

The localhost-only `web-console-pty.service` owns `node-pty` processes. The
authenticated `web-console-ws.service` only proxies terminal I/O to that daemon.

## Consequences

Restarting the WebSocket gateway preserves live shell sessions. Restarting the
PTY daemon intentionally ends them, so it remains protected from unattended
automatic restarts.
