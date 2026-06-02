# Security notes (replay UI server)

- Default bind `127.0.0.1`; use `DURABL_API_KEY` + TLS if exposed beyond localhost.
- `DURABL_CORS_ORIGINS` for cross-origin UI.
- HITL submit rate-limited; offline exports cannot POST input.
- Logs omit journal bodies and secrets.

Routes: [`docs/BACKEND.md`](docs/BACKEND.md).
