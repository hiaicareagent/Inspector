# Inspector Browser

A Chromium-based enterprise web application monitoring browser with built-in performance, security, style, and network auditing tools.

Built on **Electron** — a mature, cross-platform Chromium wrapper with full access to Chrome DevTools Protocol (CDP) for deep instrumentation.

## Features

- **Tabbed Browsing** — Full-featured browser with multiple tabs, navigation controls, and address bar
- **Performance Monitor** — Real-time page load metrics (DOM content, paint timing, resource sizes, memory usage)
- **Network Inspector** — Live HTTP request logging with method, status, timing, size, and security header analysis
- **Console Viewer** — Captures all console output (log, warn, error) from the monitored page
- **Security Scanner** — Checks for HTTPS usage, mixed content, missing security headers, eval() usage, and third-party scripts
- **Style Audit** — Reviews HTML semantics, accessible viewports, alt text, heading hierarchy, and deprecated tags
- **Resizable Monitor Panel** — Side panel toggles on/off and can be resized

## Prerequisites

- **Node.js** (v18 or later): [https://nodejs.org/](https://nodejs.org/)
- **npm** (comes with Node.js)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode
npm start

# 3. Build portable EXE
npm run build
```

The built portable EXE will be in the `dist/` folder as `Inspector-Browser-portable.exe`. You can run it from anywhere — no installation needed.

## Build for Production

```bash
npm run build
```

This creates a self-contained portable executable at `dist/Inspector-Browser-portable.exe` using `electron-builder`. The EXE bundles Electron + Chromium, so it's ready to run on any Windows x64 machine.

## Project Structure

```
Inspector/
├── main.js              # Electron main process
├── preload.js           # IPC bridge (contextIsolation)
├── package.json         # Dependencies & build config
├── src/
│   ├── index.html       # Browser chrome UI
│   ├── styles.css       # Dark theme styling
│   └── renderer.js      # UI logic & monitoring panels
└── dist/                # Built portable EXE (after npm run build)
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Main Process (main.js)             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ App/Session │  │ Tab Manager  │  │ Monitoring │ │
│  │ Management  │  │ (IPC router) │  │ (CDP)      │ │
│  └─────────────┘  └──────────────┘  └────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────┐
│              Renderer Process (src/)                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Browser  │  │ Webview Tabs │  │ Monitor Panel│  │
│  │ Chrome   │  │ (Chromium)   │  │ (5 panels)   │  │
│  └──────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Security

Security header manipulation (`upgrade-insecure-requests`) is **disabled by default** to avoid breaking enterprise applications that may use mixed content during development. To enable it, set `upgradeInsecureRequests: true` in `main.js` under `SECURITY_POLICIES`.
