# Rifle Range Estimation Trainer (RRET)

[![FFP MIL Scope Simulator](https://img.shields.io/badge/Optics-FFP_MIL%2FMRAD-orange.svg)](#)
[![Target Library](https://img.shields.io/badge/Targets-86_Built--in-blue.svg)](#)
[![Stack](https://img.shields.io/badge/Stack-HTML5_|_CSS3_|_ES6_JS-green.svg)](#)

**RRET (Rifle Range Estimation Trainer)** is a modern, high-precision First Focal Plane (FFP) scope simulator and distance estimation interactive web application. Designed for precision shooters, field competitors, snipers, and long-range enthusiasts, RRET provides real-world field scenarios to train distance estimation using MIL/MRAD reticle subtensions.

---

## 🎯 Key Features

### 1. First Focal Plane (FFP) Optics Engine
- **True FFP Parity**: Reticle subtensions and target dimensions scale in 1:1 visual parity across **1x to 25x magnification**.
- **Vector Reticle Rendering**: Crisp SVG reticles with customizable illumination color (Red, Green, Amber, White) and brightness level.
- **Realistic Pan & Zoom**: Intuitive viewport controls supporting mouse drag, touch pinch/pan, D-Pad buttons, and keyboard arrow navigation.
- **Dynamic Scenarios**: Dynamic target placement across 10 field environments (*Forest, Field, Snow, Mountain, Desert, Urban, Range, Fog, Rain, Dusk*) — left on Random by default, or pinned to a specific environment from the simulator's environment dropdown. Hunting-category targets always roll Forest or Mountain, regardless of that setting.
- **Scenario Filters**: Restrict which target categories random scenarios draw from, and/or limit them to a distance band (Close / Medium / Long / Extreme), directly from the simulator.

### 2. Comprehensive Target Library (86 Built-in Targets)
- **Swedish Field Shooting (Gevär 6,5)**: 33 official full-bore competition targets including C 15 D, S 10 D V/H, S 15 D V/H, Tunna D, C 20–C 50, S 20 V/H, S 25 V/H, 1/7, B 45, B 65, B 100, 1/8, 1/6 Rak/V/H, 1/4 Rak/V/H, 1/3, Tunna V/H, and L 1–L 3.
- **Swedish Korthåll (.22LR)**: 26 smallbore field targets (C4–C10, T4–T10, S4–S5, L9–L20, Tunna K, B5–B20).
- **Steel Gongs**: 5 circular AR500 steel gongs from 10cm to 45cm.
- **IPSC Metric Silhouettes**: 3 practical shooting metric/mini cardboard targets.
- **PRS Steel Poppers**: 4 precision rifle series poppers (4in–10in) for long-range engagement.
- **Military Silhouettes**: 3 E-type and full/half-body qualification silhouettes.
- **Hunting**: 12 broadside low-poly game silhouettes for hunting-style range estimation — deer, elk, moose, reindeer, black bear, wild boar, grey wolf, coyote, red fox, mountain hare, pheasant, and wild turkey.
- **Custom Target Builder**: Create custom targets by specifying height, width, an optional preferred distance range, and a description, then define their appearance from a preset shape, a freehand drawing (pen, line, rectangle, ellipse, eraser tools), or an uploaded image. Existing custom targets can be edited or duplicated.
- **JSON Import / Export**: Export target libraries or import custom target sets (validated on import).

### 3. Multiple Reticle Patterns
- **MIL Dot Reticle**
- **Christmas Tree Grid**
- **Tremor Tactical**
- **MRAD Grid**
- **Duplex BDC**
- **German #4**
- **Circle-Dot Horseshoe**
- **Fine Crosshair**

### 4. Interactive Learning Hub & Math Practice
- Step-by-step tutorial explaining **MIL subtension math**, height/width measurement, and distance formulas.
- Interactive calculation practice widget with instant feedback.

### 5. Training History & Web Audio Feedback
- **LocalStorage Persistence**: Saves historical rounds, average error percentage, accuracy rating, and personal best scores.
- **Synthesized Audio**: Offline Web Audio API feedback for hit confirmation chime and error cues.
- **Unit Support**: Seamless toggle between **Metric** (Meters, cm, mm) and **Imperial** (Yards, Inches).

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

RRET is built as a zero-dependency, client-side web application using HTML5, CSS3, and ES6 JavaScript modules.

Because JavaScript ES6 modules (`import/export`) and JSON `fetch()` require HTTP/HTTPS origin security policies, the application should be served over a local HTTP server rather than opened directly as `file://`.

### Method 1: Using Python (Recommended)

1. Clone or download the repository:
   ```bash
   git clone https://github.com/jozeta/RRET.git
   cd RRET
   ```

2. Start a local HTTP server:
   ```bash
   python -m http.server 8085
   ```

3. Open your browser and navigate to:
   ```text
   http://localhost:8085
   ```

### Method 2: Using Node.js (`http-server` or `serve`)

1. Install and run `http-server`:
   ```bash
   npx http-server -p 8085
   ```

2. Open your browser at `http://localhost:8085`.

### Method 3: VS Code Live Server Extension
1. Open the project folder in **Visual Studio Code**.
2. Right-click `index.html` and select **Open with Live Server**.

---

## 📂 Project Structure

```text
RRET/
├── index.html              # Main Single Page Application HTML structure
├── README.md               # Application documentation & setup guide
├── css/
│   ├── style.css           # Global tactical dark theme styling & layout
│   ├── scope.css           # Scope housing, canvas, reticle & viewport styles
│   └── learn.css           # Interactive tutorial hub styling
├── js/
│   ├── app.js              # Application entry point & SPA router
│   ├── scope.js            # FFP scope rendering engine (Canvas background + SVG reticle)
│   ├── training.js         # Distance estimation scenarios, shot timer & scoring logic
│   ├── targets.js          # Target library grid, category filter & custom target modal
│   ├── settings.js         # User preferences (units, reticle colors, sensitivity)
│   ├── tutorial.js         # Interactive learning module logic
│   ├── storage.js          # LocalStorage manager for settings, custom targets & history
│   ├── reticles.js         # Reticle catalog loader (data/reticles.json + fallback)
│   ├── drawing.js          # Freehand canvas drawing tool for the Custom Target Editor
│   └── utils.js            # Procedural SVG target renderers, Web Audio, MIL math & HTML-escaping helpers
└── data/
    ├── targets.json        # Built-in target database (86 targets with metric specifications)
    └── reticles.json       # Reticle specifications & metadata
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
