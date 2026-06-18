# Inspector Browser - Project Context

## Project Type
- Electron-based Chromium desktop browser for enterprise web app monitoring
- Built with Electron, vanilla JS, custom dark theme CSS

## Main Files
- `main.js` - Electron main process (tab management, monitoring via CDP)
- `preload.js` - Secure IPC bridge
- `src/index.html` - Browser chrome UI
- `src/renderer.js` - Full browser logic + 5-panel monitoring suite
- `src/styles.css` - Professional dark theme
- `package.json` - Dependencies + electron-builder config for portable EXE

## GitHub Repository
- **URL:** https://github.com/hiaicareagent/Inspector
- **Remote:** origin → https://github.com/hiaicareagent/Inspector.git
- **Branch:** main
- **Git User:** hiaicareagent
- **Git Email:** hi.aicare.agent@gmail.com

## Git Setup (Bash Path Fix)
The terminal tools (basher, tmux_cli) require bash.exe to run commands.
On this system, bash is at: `C:\Program Files\Git\bin\bash.exe`
To make terminal commands work, set: `CODEBUFF_GIT_BASH_PATH=C:\Program Files\Git\bin\bash.exe`

## Git Workflow (Verified — all commands work)
```bash
cd /c/repo/Inspector
git add -A
git commit -m "type: message"
git push origin main
```

### ⚠️ Key Lesson: "git push fails with 'remote end hung up unexpectedly'"
This is **NOT** a network issue. Root cause: `dist/` (181 MB Inspector.exe) or `node_modules/` were committed to git history, exceeding GitHub's 100 MB file limit.

**To fix if it happens again:**
```bash
# Remove large dirs from all git history
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch -r dist && git rm --cached --ignore-unmatch -r node_modules" --prune-empty HEAD
# Garbage collect old objects
git reflog expire --expire=now --all && git gc --prune=now --aggressive
# Force push
git push origin main --force
```

### Other gotchas:
- **Stale lock file:** `rm -f /c/repo/Inspector/.git/index.lock`
- **Bash works fine** (`ls`, `rm`, `mv`, `cp`) — no Windows cmd needed

## Build Command
```bash
cd /c/repo/Inspector && npm install && npm run build
```
Output: `dist/Inspector-Browser-portable.exe`

## Key Features Built
- Tabbed browsing with frameless window
- Performance monitoring (navigation timing, paint, memory)
- Network request inspector with security header analysis
- Console log capture
- Security scanner (HTTPS, mixed content, CSP, eval, third-party scripts)
- Style/accessibility audit (viewport, alt text, headings, deprecated HTML)
- Bookmark manager with bar + modal + Ctrl+D shortcut
- JSON export of complete monitoring reports via save dialog
