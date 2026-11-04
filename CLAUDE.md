# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RRET (Rifle Range Estimation Trainer) is a first-focal-plane (FFP) MIL/MRAD scope simulator and
distance-estimation trainer: 86 real-size targets (Swedish fältskytte and korthåll figures,
steel, IPSC, PRS, military, game animals), 12 reticles, free practice, coach and station modes,
printable range cards. Build-free ES-module web app and installable offline PWA. Live at
https://jozeta.github.io/RRET/ (GitHub Pages).

## Commands

```sh
python3 scripts/dev_server.py 8085   # or: npm run serve → http://localhost:8085
npm run check                        # node --check every module
npm test                             # node:test unit tests (Node 22+, no deps)
npm run test:browser                 # 24 headless-Chrome smoke checks (set CHROME_PATH if needed)
npm run test:all
```

Use the bundled dev server, not `python -m http.server` (its small queue drops parallel module
requests with `ERR_CONNECTION_RESET`). CI runs check, test and browser tests on every push and PR.

## Architecture

- `index.html`: single page, 6 hash-routed pages. `js/app.js` is the entry and router.
- `js/scope.js`: the FFP engine: world-anchored scene, target rasterisation, SVG reticles,
  pan/zoom input. Reticles, targets and landscape all scale together with magnification.
- `js/training.js` (free practice), `js/station.js` (station mode, range cards), `js/coach.js`
  (reading error vs maths error), `js/analytics.js`, `js/tutorial.js` (Learn page).
- **Pure, unit-tested logic:** `js/scenario-logic.js` (filters, distance bands, seeded RNG),
  `js/target-schema.js` (validation, import planning), `js/utils.js` (MIL maths, scoring),
  `js/storage.js` (localStorage, migrations), `js/shared-set.js` (club-session links).
- Reticles: `js/reticles.js`, `js/reticle-designs.js`, `js/reticle-help.js` (defined in JS;
  the README's mention of `data/reticles.json` is out of date).
- Data: `data/targets.json` (metric dimensions + competition windows).
- `vendor/`: self-hosted Bootstrap, icons, fonts (no CDN).

Core formula: `distance (m) = size (m) × 1000 / MIL reading` (height or width).

## Rules (tests enforce these)

- **Every target must render at exactly its stated size.** The browser test measures all 86
  on screen. Don't change scaling without running `npm run test:browser`.
- **Version in three places:** `js/version.js` (`APP_VERSION`), `package.json` and
  `CACHE_VERSION` in `sw.js` must match (`tests/version.test.mjs`). Bump on every release and add
  a `CHANGELOG.md` entry.
- **Service worker precache:** every app file must be in `PRECACHE` in `sw.js`
  (`tests/pwa.test.mjs`). Add new files there and bump `CACHE_VERSION`.
- Storage format changes need a migration in `js/storage.js`; imports stay validated,
  size-limited and idempotent (built-ins never duplicated).
- Hunting-category targets always roll Forest or Mountain environments.

## App standards

This repo follows the app standards in `~/Desktop/code/tools/standards/STANDARDS.md` (rule IDs,
severities; decisions and waivers in `.claude-standards`). `claude-check --repo .` checks it.

```sh
npm ci && npm run lint   # ESLint (dev-only), incl. the no-unsanitized rule; CI runs it too
npm run test:all         # the tests CI runs
```

Unsafe DOM sinks and unused variables are lint **warnings** for now (existing code); new code
shouldn't add any. Errors (eval, undefined names, parse errors) fail CI.
