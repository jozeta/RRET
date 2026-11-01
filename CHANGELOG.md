# Changelog

The version shown in the app's footer and About page comes from `js/version.js`.
To release: bump it there, in `package.json` and in `sw.js` (`CACHE_VERSION`),
add an entry below, and tag the merge commit `vX.Y.Z`. `npm test` fails if
these disagree.

## 2.0.0 — 2026-11-01

Audit fixes and new training features (pull request #1).

### Fixed
- Targets are drawn exactly at their stated height and width (S/L/popper and hunting figures were up to ~48% too small).
- Each answer is recorded once, and a scenario can't be scored twice; existing history is cleaned up once (backup kept).
- Category filter no longer blanks the scope; filters that match nothing say so; filter and reticle choices are remembered.
- Export/import no longer duplicates the built-in library; storage-full errors are reported.
- The scope behaves like a real scope: the landscape, weather and target move and zoom together, and the target stays on the ground.
- Sharp rendering on high-resolution screens; proportional trackpad zoom; arrow keys pan; Back button works; mobile menu closes.
- Result card in the selected units; whole-yard imperial distances; Tremor reticle 3 MIL tick; timer pauses off-page.

### Added
- Coach mode (reading error vs maths error), station mode (fältskytte) with printable range cards, progress analytics with CSV export, realistic optics calibration.
- Works offline and can be installed as an app; all assets self-hosted with a Content-Security-Policy.
- Mobile layout with the answer bar beside the scope; accessibility labels and focus styles.
- Version number in the footer and About page.
- Unit tests, browser smoke tests and GitHub Actions CI.

## 1.0.0

Initial release: FFP MIL scope simulator, 86 built-in targets, 8 reticles, Learn page, custom targets, local history.
