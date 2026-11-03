# Changelog

The version shown in the app's footer and About page comes from `js/version.js`.
To release: bump it there, in `package.json` and in `sw.js` (`CACHE_VERSION`),
add an entry below, and tag the merge commit `vX.Y.Z`. `npm test` fails if
these disagree.

## Unreleased

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
- The scope readout states what the reticle's marks are worth (for example "25.0× · fine ticks 0.2 MIL"), because at high power the numbered marks are often outside the view. Corrected two reticle descriptions that didn't match the drawn reticle.
- The landscape is built to real-world scale behind the target: trees, buildings, berms and mountains have real sizes and distances, the horizon is at eye level and the target stands on the ground in front of them.

### Reticles
- New reticle engine: every reticle is defined in MIL with real etched line widths, drawn thin and crisp at every magnification; fine marks hide when they would merge. Black (non-illuminated) is the new default; illuminated colours remain.
- 12 reticles, including four new ranging designs: ½ MIL hash, 0.2 MIL fine milling, 0.1 MIL ranging scale, and a PSO-1-style 1.7 m rangefinder curve.
- Every reticle has a help panel: a drawing with a worked example, what each mark is worth and where it sits, and step-by-step ranging instructions. Available from the simulator, Settings and the Learn page, whose previews now use the same engine.

### Realism
- Fur, paint, cardboard and steel textures on all targets (clipped to the outline, so sizes are unchanged).
- Clouds, textured ground, horizon haze, shaded and textured spruce, rock faces, earth berms and concrete facades, all anchored to the world as you pan and zoom.

### Training
- Field conditions you can switch on: mirage (beyond 250 m), hold sway, grass covering the target's base, finding the target, and low light. Recorded with each round.
- Club sessions: "Share a set" makes a link that gives everyone the same targets, distances and conditions, with progress and a summary at the end.
- Coach mode now says in words whether a miss came from the reading or the arithmetic, and which way.
- Home stats: rounds within 5%, current streak and best streak replace the abstract accuracy figures.
- Learn: quiz answers are shuffled; the calculator no longer invents values for empty fields.

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
