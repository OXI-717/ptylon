# Contributing

Thanks for considering a contribution.

## Development

```bash
cp .env.example .env
pnpm install
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm test:pty-gateway
```

`pnpm test:browser-regression` requires a running Web Console instance,
Chrome, and local `.env` credentials.

## Pull Requests

- Keep changes focused and include verification notes.
- Do not commit `.env`, databases, uploads, screenshots containing secrets, or
  host-specific deployment state.
- Keep the PTY daemon localhost-only.
- Do not restart or redesign the PTY owner casually; it owns live shell
  sessions.
