# MoniKey

Phase 1 goal: **detect key/input event listeners on visited sites** using a headless browser and print/save a report.

## Quickstart

```bash
# Start local test page
npm run serve   # serves http://localhost:8080/

# Scan (requires allowlist + --ack flag)
npm run cli -- http://localhost:8080/ --ack

Reports are saved to `./reports/<timestamp>-<host>.json` and the CLI prints a human-readable summary plus heuristic findings.

## Safety

- **Allowlist**: edit `allowlist.json` to include only hosts you own/control.
- **robots.txt**: the CLI fetches and blocks disallowed paths for `User-agent: *`.
- **--ack**: you must confirm permission to scan each target.

## Dev Notes

- Node LTS via `nvm` recommended.
- Core dependency: `puppeteer` (bundled Chromium).
- Local fixtures served from `./fixtures` via `server.js`.

## License

MIT — see `LICENSE`.
