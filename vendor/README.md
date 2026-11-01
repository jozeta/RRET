# Vendored third-party assets

Self-hosted so the app works offline (installable PWA) and loads nothing from
third-party origins (CSP `default-src 'self'`).

| Asset | Version | Source | Licence |
|---|---|---|---|
| `bootstrap/bootstrap.min.css`, `bootstrap/bootstrap.bundle.min.js` | Bootstrap 5.3.2 | cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist | MIT |
| `bootstrap-icons/` | Bootstrap Icons 1.11.1 | cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font | MIT |
| `fonts/` | Inter, Rajdhani, Roboto Mono (latin subset) | fonts.googleapis.com | SIL OFL 1.1 |

Bootstrap and Bootstrap Icons files were verified against jsDelivr's published
SHA-256 hashes, and the two Bootstrap files also against Bootstrap's official
SRI hashes (sha384-T3c6CoIi…, sha384-C6RzsynM…).

When upgrading: replace the files, re-verify the hashes, and bump
`CACHE_VERSION` in `sw.js`.
