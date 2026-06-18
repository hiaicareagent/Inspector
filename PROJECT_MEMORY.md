# Inspector Project - Persistent Memory

## Project Overview:
Enterprise monitoring Chromium-based desktop browser built on Electron. Designed to inspect, audit, and monitor enterprise web applications for performance, security, style, and network issues.

## GitHub Repo:
https://github.com/hiaicareagent/Inspector.git

## Tech Stack & Architecture:
- **Runtime:** Electron (Chromium + Node.js)
- **Language:** Vanilla JavaScript (no framework)
- **UI:** Custom dark theme CSS
- **Build:** electron-builder (portable EXE target)
- **IPC:** contextBridge + ipcRenderer/ipcMain
- **Monitoring:** Chrome DevTools Protocol via webview API + webRequest + executeJavaScript
- **Persistence:** localStorage (bookmarks)

## Built So Far:
- [2024-06-18] Initial project scaffold (package.json, main.js, preload.js)
- [2024-06-18] Browser chrome (frameless window, tab bar, nav bar, address bar, status bar)
- [2024-06-18] Webview-based tab system (create, switch, close tabs)
- [2024-06-18] Performance monitoring panel (navigation timing, paint metrics, memory, resource summary)
- [2024-06-18] Network request inspector (method/status/duration/size, security header analysis, expandable details)
- [2024-06-18] Console log capture (info, warning, error levels)
- [2024-06-18] Security scanner (HTTPS check, mixed content, missing CSP/HSTS/XFO headers, eval, third-party scripts, localStorage)
- [2024-06-18] Style audit (viewport meta, deprecated HTML, alt text, heading hierarchy, inline styles)
- [2024-06-18] Resizable monitor panel (drag-to-resize splitter, toggle button)
- [2024-06-18] Bookmarks manager (persistent bar, star toggle in URL bar, modal with edit/delete, Ctrl+D shortcut)
- [2024-06-18] JSON export (save dialog, comprehensive report with all 5 panels, fresh audit on export)

## File Structure (Key Files):
- `main.js` — Electron main process: window management, IPC handlers, CDP-based monitoring (performance, network, console), session security policies
- `preload.js` — Secure IPC bridge exposing electronAPI to renderer
- `src/index.html` — Browser chrome UI layout (titlebar, tab bar, nav bar, bookmarks bar, webview container, monitor panel, status bar, bookmarks modal)
- `src/renderer.js` — Full browser logic: InspectorBrowser class (tabs, navigation, monitoring, audits, export) + BookmarksManager class + initialization
- `src/styles.css` — Complete dark theme: ~800 lines covering all UI components with CSS variables, animations, conic gradients

## Project Goals & Roadmap:
- Full-featured enterprise monitoring browser
- Run enterprise web apps through it to detect issues
- Portable EXE for easy distribution
- Future: auto-export, HTML reports, report comparison, drag-and-drop bookmark reordering

## Known Issues & TODOs:
- Network webRequest listeners registered per-tab on shared session can cause duplicate entries (mitigated by dedup in renderer)
- No cleanup of main-process event listeners on tab close (minor memory leak over very long sessions)

## Important Decisions Made:
- **Electron over WebView2/CEF:** Cross-platform, mature ecosystem, massive library support, full CDP access
- **No framework:** Keeps the app lightweight and dependency-free; monitoring tools don't need reactive UI complexity
- **webContents.fromId() over event.sender:** Correct approach for getting webview webContents from renderer IPC
- **localStorage for bookmarks:** Simple, no server needed, survives restarts
- **electron-builder portable target:** Self-contained EXE, no installation required, run from anywhere
