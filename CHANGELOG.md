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

### Targets, scenery and size accuracy
- Every target is verified end to end: an automated browser test renders all 86 targets at three distances each and measures them in pixels against size × 1000 / distance.
- Animals redrawn as true-to-proportion silhouettes in natural colours, with realistic sizes (height measured to the top of the antlers/ears). Previous sizes were far too small, e.g. a 0.9 m deer and a 2.0 m moose including antlers.
- People, IPSC (metric, mini and an octagonal classic at 46 × 58 cm), PRS poppers and steel gongs redrawn; field figures get a matte painted finish.
- Known sizes on the scenario card no longer round misleadingly (a 36 mm figure showed as "4 cm").
- True-size optics are now the default: at 1× a target looks as large as to the naked eye, and at 10× ten times larger, assuming a typical screen at 60 cm (calibrate in Settings for exact size). The old enlarged scale (about 8× a real 1× view) remains as an option, and saved settings switch to true size once.
- Reticle numerals are hidden when magnification is too low for them to be readable.
- The landscape is built to real-world scale behind the target: trees, buildings, berms and mountains have real sizes and distances, the horizon is at eye level and the target stands on the ground in front of them.

### Design
- New visual identity: spruce and cartridge-brass palette, Archivo variable type, sentence case throughout, calmer panels and segmented controls; a redrawn scope-view hero on Home.

### Added
- Coach mode (reading error vs maths error), station mode (fältskytte) with printable range cards, progress analytics with CSV export, realistic optics calibration.
- Works offline and can be installed as an app; all assets self-hosted with a Content-Security-Policy.
- Mobile layout with the answer bar beside the scope; accessibility labels and focus styles.
- "Show solution" button in free practice: reveals the distance, MIL readings and calculation without scoring the round.
- Version number in the footer and About page.
- Unit tests, browser smoke tests and GitHub Actions CI.

## 1.0.0

Initial release: FFP MIL scope simulator, 86 built-in targets, 8 reticles, Learn page, custom targets, local history.
