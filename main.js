const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const REPORTS_DIR = path.join(__dirname, 'reports');
const TARGET_URL = process.env.INSPECTOR_TARGET_URL || 'https://example.com';

// ──────────────────────────────────────────────
// Ensure /reports directory exists
// ──────────────────────────────────────────────

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    console.log(`[Inspector] Created reports directory: ${REPORTS_DIR}`);
  }
}

// ──────────────────────────────────────────────
// Audit data store (per-scan accumulators)
// ──────────────────────────────────────────────

let mainWindow = null;
const metricsLog = [];
const complianceLog = [];
const uxLog = [];
const errorLog = [];

// ──────────────────────────────────────────────
// Window creation
// ──────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Inspector — HIS/EMR Observability Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
    },
    backgroundColor: '#0d1117',
  });

  mainWindow.loadURL(TARGET_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ──────────────────────────────────────────────
// IPC Handlers — receive audit events from preload
// ──────────────────────────────────────────────

function setupIPC() {
  // reportMetric(tag, value, metadata?)
  ipcMain.on('inspector:reportMetric', (_event, { tag, value, metadata }) => {
    metricsLog.push({
      tag,
      value,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    });
    console.log(`[Inspector:Metric] ${tag} = ${value}`);
  });

  // reportCompliance(standard, check, passed, details?)
  ipcMain.on('inspector:reportCompliance', (_event, { standard, check, passed, details }) => {
    complianceLog.push({
      standard,
      check,
      passed,
      details: details || '',
      timestamp: new Date().toISOString(),
    });
    const icon = passed ? '\u2713' : '\u2717';
    console.log(`[Inspector:Compliance] ${icon} ${standard} \u2014 ${check}`);
  });

  // reportUX(category, score, element?, note?)
  ipcMain.on('inspector:reportUX', (_event, { category, score, element, note }) => {
    uxLog.push({
      category,
      score,
      element: element || null,
      note: note || '',
      timestamp: new Date().toISOString(),
    });
    console.log(`[Inspector:UX] ${category} score=${score}`);
  });

  // reportError(source, message, stack?)
  ipcMain.on('inspector:reportError', (_event, { source, message, stack }) => {
    errorLog.push({
      source,
      message,
      stack: stack || null,
      timestamp: new Date().toISOString(),
    });
    console.error(`[Inspector:Error] ${source}: ${message}`);
  });

  // Generate and save a report
  ipcMain.handle('inspector:generateReport', async () => {
    try {
      const { ReportAggregator } = require('./reporting');
      const aggregator = new ReportAggregator(
        metricsLog,
        complianceLog,
        uxLog,
        errorLog,
        REPORTS_DIR
      );
      const filePath = aggregator.generateReport();
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Get current log counts (for live diagnostics UI)
  ipcMain.handle('inspector:getLogCounts', async () => {
    return {
      metrics: metricsLog.length,
      compliance: complianceLog.length,
      ux: uxLog.length,
      errors: errorLog.length,
    };
  });

  // Window controls (for frameless window)
  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
  });
}

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  ensureReportsDir();
  setupIPC();
  createMainWindow();

  // Notify the renderer of the reports directory
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('inspector:ready', {
      reportsDir: REPORTS_DIR,
      targetUrl: TARGET_URL,
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
