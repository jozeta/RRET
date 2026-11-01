# Rifle Range Estimation Trainer (RRET)

[![Live Demo](https://img.shields.io/badge/Live_Demo-jozeta.github.io%2FRRET-success.svg)](https://jozeta.github.io/RRET/)
[![FFP MIL Scope Simulator](https://img.shields.io/badge/Optics-FFP_MIL%2FMRAD-orange.svg)](#)
[![Target Library](https://img.shields.io/badge/Targets-86_Built--in-blue.svg)](#)
[![Stack](https://img.shields.io/badge/Stack-HTML5_|_CSS3_|_ES6_JS-green.svg)](#)

**RRET (Rifle Range Estimation Trainer)** is a modern, high-precision First Focal Plane (FFP) scope simulator and distance estimation interactive web application. Designed for precision shooters, field competitors, snipers, and long-range enthusiasts, RRET provides real-world field scenarios to train distance estimation using MIL/MRAD reticle subtensions.

**🔗 Try it live: [jozeta.github.io/RRET](https://jozeta.github.io/RRET/)** — no install or setup required, runs entirely in your browser.

---

## 🎯 Key Features

### 1. First Focal Plane (FFP) Optics Engine
- **True FFP Parity**: Reticle subtensions, targets and the whole landscape scale together across **1x to 25x magnification**. Every target is drawn to exactly its stated height and width, verified by an automated test that measures all 86 targets on screen, so a perfect MIL reading gives a perfect answer.
- **A landscape to real scale**: Trees, buildings, berms and mountains have real sizes and stand at real distances behind the target, with the horizon at eye level, so an animal never looks bigger than the forest behind it.
- **True-size optics (default)**: At 1× a target looks as large as to the naked eye; at 10× ten times larger. Sizes assume a typical screen at 60 cm; calibrate with a bank card in Settings for exact size. Scope profiles: Full range 1–25x, LPVO 1–10x, Hunting 3–18x, Precision 5–25x. An "Enlarged" scale (about 8× bigger) is available if you prefer.
- **Vector Reticle Rendering**: Crisp SVG reticles with customizable illumination color (Red, Green, Amber, White) and brightness level.
- **Realistic Pan & Zoom**: Panning turns the scope across a fixed landscape, and the target stays planted on its ground. Controls: mouse drag, proportional trackpad/wheel and pinch zoom, D-pad buttons, and keyboard (arrow keys pan, `+`/`-` zoom, `C` re-centres).
- **Sharp on any screen**: The scope renders at the device's pixel density, and targets are re-rasterized as you zoom in, so edges stay crisp at 25x on retina displays.
- **Dynamic Scenarios**: Dynamic target placement across 10 field environments (*Forest, Field, Snow, Mountain, Desert, Urban, Range, Fog, Rain, Dusk*) — left on Random by default, or pinned to a specific environment from the simulator's environment dropdown. Hunting-category targets always roll Forest or Mountain, regardless of that setting.
- **Scenario Filters**: Restrict which target categories random scenarios draw from, and/or limit them to a distance band (Close / Medium / Long / Extreme). A live count shows how many targets match. If nothing matches, the app says so instead of silently ignoring the filters. Filter and reticle choices are remembered.

### 2. Training Modes
- **Free practice**: One target at a time, with a full calculation breakdown after each answer (height and width, in your units) and orange brackets showing the target's true MIL size. Stuck? **Show solution** reveals the answer and the working without scoring the round.
- **Coach mode**: Optionally enter the MIL value you read as well. The result then separates *reading error* (how far off your reticle reading was) from *maths error* (whether your arithmetic matched your own reading).
- **Station mode (fältskytte)**: A timed station of 3–6 figures from one series, with no feedback until the station is done. Distances come from each figure's competition window.
- **Printable range card (lathund)**: For any series, a MIL-reading → distance table per figure, ready to print.

### 3. Comprehensive Target Library (86 Built-in Targets)
- **Swedish Field Shooting (Gevär 6,5)**: 33 official full-bore competition targets including C 15 D, S 10 D V/H, S 15 D V/H, Tunna D, C 20–C 50, S 20 V/H, S 25 V/H, 1/7, B 45, B 65, B 100, 1/8, 1/6 Rak/V/H, 1/4 Rak/V/H, 1/3, Tunna V/H, and L 1–L 3.
- **Swedish Korthåll (.22LR)**: 26 smallbore field targets (C4–C10, T4–T10, S4–S5, L9–L20, Tunna K, B5–B20).
- **Steel Gongs**: 5 circular AR500 steel gongs from 10cm to 45cm.
- **IPSC Metric Silhouettes**: 3 practical shooting metric/mini cardboard targets.
- **PRS Steel Poppers**: 4 precision rifle series poppers (4in–10in) for long-range engagement.
- **Military Silhouettes**: 3 E-type and full/half-body qualification silhouettes.
- **Hunting**: 12 broadside game animals drawn to real proportions and sizes (height to the top of antlers/ears): white-tailed deer, elk, moose, reindeer, black bear, wild boar, grey wolf, coyote, red fox, mountain hare, pheasant and wild turkey.
- **Custom Target Builder**: Create custom targets by specifying height, width, an optional preferred distance range, and a description, then define their appearance from a preset shape, a freehand drawing (pen, line, rectangle, ellipse, eraser tools), or an uploaded image. Existing custom targets can be edited or duplicated.
- **JSON Import / Export**: Export your custom targets and import them on another device. Imports are validated, size-limited and idempotent: re-importing the same file updates targets instead of duplicating them, and built-in targets are never duplicated.

### 4. Multiple Reticle Patterns
- **MIL Dot Reticle**
- **Christmas Tree Grid**
- **Tremor Tactical**
- **MRAD Grid**
- **Duplex BDC**
- **German #4**
- **Circle-Dot Horseshoe**
- **Fine Crosshair**

### 5. Interactive Learning Hub & Math Practice
- Step-by-step tutorial explaining **MIL subtension math**, height/width measurement, and distance formulas.
- Interactive calculation practice widget with instant feedback.

### 6. Progress Analytics, History & Audio
- **Progress analytics**: Your systematic bias (do you over- or under-estimate?), share of rounds within 5%, mean error by category and by distance band, and a trend chart. Every chart has a table view, and history exports to CSV.
- **LocalStorage Persistence**: Saves up to 1,000 rounds of history, from which all stats are calculated. Each scenario can be scored only once.
- **Synthesized Audio**: Offline Web Audio API feedback for hit confirmation chime and error cues.
- **Unit Support**: Seamless toggle between **Metric** (Meters, cm, mm) and **Imperial** (Yards, Inches). In imperial mode, distances are whole yards.

### 7. Works Offline, Installable
- Installable as an app (PWA). After one visit it works without a network connection, which is handy at the range.
- No third-party requests: Bootstrap, icons and fonts are self-hosted (see `vendor/README.md`), with a strict Content-Security-Policy.

---

## 📐 Distance Estimation Math

Distance is calculated using the standard milliradian formula:

$$\text{Distance (meters)} = \frac{\text{Target Height (meters)} \times 1000}{\text{MIL Reading}}$$

For horizontal measurement:

$$\text{Distance (meters)} = \frac{\text{Target Width (meters)} \times 1000}{\text{MIL Reading}}$$

### Imperial Equivalents

$$\text{Distance (yards)} = \frac{\text{Target Height (inches)} \times 27.77}{\text{MIL Reading}}$$

$$\text{Distance (yards)} = \frac{\text{Target Size (yards)} \times 1000}{\text{MIL Reading}}$$

---

## 🚀 Quick Start / Local Installation

Just want to try it? Skip all of this and use the **[live demo](https://jozeta.github.io/RRET/)** instead. The steps below are only for running it locally (e.g. to make changes).

RRET is a build-free, client-side web application using HTML5, CSS3, and ES6 JavaScript modules. It has no runtime dependencies to install: Bootstrap 5.3, Bootstrap Icons and the fonts are vendored in `vendor/`.

Because JavaScript ES6 modules (`import/export`) and JSON `fetch()` require HTTP/HTTPS origin security policies, the application should be served over a local HTTP server rather than opened directly as `file://`.

### Method 1: Included dev server (Recommended)

1. Clone or download the repository:
   ```bash
   git clone https://github.com/jozeta/RRET.git
   cd RRET
   ```

2. Start the server (Python 3, no install needed):
   ```bash
   python3 scripts/dev_server.py 8085
   ```
   Plain `python -m http.server` also works, but its small connection queue can drop some of the app's parallel module requests (`ERR_CONNECTION_RESET`). The included server fixes that and disables caching.

3. Open your browser and navigate to:
   ```text
   http://localhost:8085
   ```

### Method 2: Using Node.js (`http-server` or `serve`)

1. Install and run `http-server`:
   ```bash
   npx http-server -p 8085 -c-1
   ```

2. Open your browser at `http://localhost:8085`.

### Method 3: VS Code Live Server Extension
1. Open the project folder in **Visual Studio Code**.
2. Right-click `index.html` and select **Open with Live Server**.

---

## 🧪 Tests

No dependencies to install. Requires Node 22+; the browser tests also need Chrome or Chromium.

```bash
npm run check          # syntax-check every module
npm test               # unit tests: MIL maths, scoring, scenario rules, storage/migration, import validation, reticle geometry, data integrity, PWA precache list
npm run test:browser   # 24 end-to-end checks, including an on-screen size measurement of all 86 targets in headless Chrome (set CHROME_PATH if it isn't found)
```

GitHub Actions runs all three on every push and pull request (`.github/workflows/ci.yml`).

---

## 📂 Project Structure

```text
RRET/
├── index.html              # Single-page app markup (6 hash-routed pages)
├── sw.js                   # Service worker: offline support (network-first)
├── manifest.webmanifest    # Installable-app manifest
├── css/
│   ├── style.css           # Theme, layout, toasts, analytics, mobile & print styles
│   ├── scope.css           # Scope housing, canvas, reticle & viewport styles
│   └── learn.css           # Interactive tutorial hub styling
├── js/
│   ├── app.js              # Entry point, hash router, stats/history table
│   ├── scope.js            # FFP scope engine: world-anchored scene, target raster, SVG reticles, input
│   ├── training.js         # Free-practice loop: scenarios, answer form, timer, result card
│   ├── station.js          # Station mode (fältskytte) and printable range cards
│   ├── coach.js            # Coach mode: reading error vs maths error
│   ├── analytics.js        # Progress analytics charts and CSV export
│   ├── scenario-logic.js   # Pure scenario rules: filters, distance bands, seeded RNG, formatting
│   ├── target-schema.js    # Pure target validation and import planning
│   ├── targets.js          # Target library grid, custom target editor, import/export
│   ├── settings.js         # Preferences, themes, optics calibration
│   ├── storage.js          # localStorage access, migrations, stats derived from history
│   ├── tutorial.js         # Learn page: diagrams, calculator, quiz
│   ├── reticles.js         # Reticle catalog loader
│   ├── drawing.js          # Freehand drawing canvas for custom targets
│   ├── ui.js               # Toasts and inline form validation
│   └── utils.js            # MIL maths, scoring, audio, procedural target SVGs
├── data/
│   ├── targets.json        # 86 built-in targets (metric dimensions + competition windows)
│   └── reticles.json       # Reticle metadata
├── vendor/                 # Self-hosted Bootstrap, Bootstrap Icons, fonts (see vendor/README.md)
├── icons/                  # App icons
├── scripts/dev_server.py   # Local dev server
└── tests/                  # Node unit tests + tests/browser/smoke.mjs
```

---

## 🏆 Scoring System

Training rounds evaluate estimation precision based on absolute percentage error:

| Error Margin | Score | Rating |
|---|---|---|
| **$\le$ 0.5%** | 100 PTS | Bullseye Perfect! |
| **$\le$ 1.0%** | 95 PTS | Exceptional |
| **$\le$ 2.0%** | 90 PTS | Excellent |
| **$\le$ 5.0%** | 80 PTS | Good Match |
| **$\le$ 10.0%** | 60 PTS | Acceptable |
| **> 10.0%** | 0 PTS | Off Target |

---

## 💻 Browser Compatibility

Tested and compatible with modern web browsers:
- Google Chrome / Chromium (Desktop & Mobile)
- Mozilla Firefox
- Microsoft Edge
- Apple Safari (macOS & iOS)

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for details.
