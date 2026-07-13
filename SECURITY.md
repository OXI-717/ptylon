# Security Policy

## Supported Versions

Security fixes are handled on the `main` branch.

## Reporting a Vulnerability

Please report vulnerabilities through GitHub Security Advisories for this
repository. Do not open a public issue for suspected credential exposure,
authentication bypasses, path traversal, or remote command execution issues.

If GitHub Security Advisories are unavailable, open a minimal issue asking for
a private contact channel without including exploit details.

## Deployment Notes

Web Console is a self-hosted terminal and browser workspace. Treat it as a
privileged internal service:

- Keep the app behind HTTPS and an external access gate when exposed beyond
  localhost.
- Use strong `AUTH_PASSWORD`, `JWT_SECRET`, and `WEB_CONSOLE_ADMIN_TOKEN`
  values.
- Keep `/api/admin/*`, `web-console-ws.service`, and `web-console-pty.service`
  private to the host or trusted network.
- Run the supplied services as the dedicated unprivileged `webconsole` user;
  never deploy the public defaults as `root`.
- Set `FILE_ACCESS_ROOT` to a dedicated workspace and leave
  `ALLOW_FULL_FILESYSTEM=false`.
- Rotate local `.env` secrets before making a private fork public.
