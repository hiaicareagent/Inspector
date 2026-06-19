const { app, BrowserWindow, ipcMain, contentTracing } = require('electron');
const path = require('path');
const fs = require('fs');

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const REPORTS_DIR = path.join(__dirname, 'reports');
const TARGET_URL = process.env.INSPECTOR_TARGET_URL || 'https://example.com';
const MEMORY_POLL_MS = 10000;           // check memory every 10s
const MEMORY_LEAK_THRESHOLD_MB = 500;   // flag renderers exceeding 500MB private mem
const TRACE_AUTO_STOP_MS = 30000;       // auto-stop trace after 30s

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

// ── Performance-specific stores ──
const performanceCoreWebVitals = {};   // { FCP: {value,timestamp,url}, LCP: {...}, CLS: {...} }
const performanceLongTasks = [];
const performanceMemorySnapshots = [];
let performanceTraceFilePath = null;

// ── Tracing state ──
let traceActive = false;
let traceAutoStopTimer = null;

// ── Memory monitoring timer ──
let memoryTimer = null;

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
// Content Tracing
// ──────────────────────────────────────────────

async function startTrace() {
  if (traceActive) {
    console.log('[Inspector:Trace] Trace already active, ignoring start request.');
    return;
  }

  try {
    await contentTracing.startRecording({
      categoryFilter: 'v8,blink,cc,gpu,disabled-by-default-v8.gc',
      traceOptions: 'record-until-full',
    });
    traceActive = true;
    console.log('[Inspector:Trace] Tracing started (v8, blink, cc, gpu, v8.gc).');

    // Auto-stop after TRACE_AUTO_STOP_MS
    if (traceAutoStopTimer) clearTimeout(traceAutoStopTimer);
    traceAutoStopTimer = setTimeout(async () => {
      if (traceActive) {
        await stopTrace();
      }
    }, TRACE_AUTO_STOP_MS);
  } catch (err) {
    console.error('[Inspector:Trace] Failed to start tracing:', err);
  }
}

async function stopTrace() {
  if (!traceActive) {
    console.log('[Inspector:Trace] No active trace to stop.');
    return null;
  }

  try {
    if (traceAutoStopTimer) {
      clearTimeout(traceAutoStopTimer);
      traceAutoStopTimer = null;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const traceFilePath = path.join(REPORTS_DIR, `trace-${timestamp}.json`);

    const resultPath = await contentTracing.stopRecording(traceFilePath);
    traceActive = false;
    performanceTraceFilePath = resultPath;
    console.log(`[Inspector:Trace] Trace saved to: ${resultPath}`);
    return resultPath;
  } catch (err) {
    console.error('[Inspector:Trace] Failed to stop tracing:', err);
    traceActive = false;
    return null;
  }
}

// ──────────────────────────────────────────────
// Memory Monitoring
// ──────────────────────────────────────────────

function startMemoryMonitoring() {
  if (memoryTimer) return;

  // Sample immediately
  sampleMemory();

  memoryTimer = setInterval(sampleMemory, MEMORY_POLL_MS);
}

function stopMemoryMonitoring() {
  if (memoryTimer) {
    clearInterval(memoryTimer);
    memoryTimer = null;
  }
}

function sampleMemory() {
  try {
    const metrics = app.getAppMetrics();
    const snapshot = {
      timestamp: new Date().toISOString(),
      processes: [],
    };

    for (const proc of metrics) {
      const privateMB = (proc.memory?.private || 0) / (1024 * 1024);
      const workingSetMB = (proc.memory?.workingSetSize || 0) / (1024 * 1024);
      let flag = null;

      if (privateMB > MEMORY_LEAK_THRESHOLD_MB) {
        flag = 'MEMORY_LEAK_WARNING';
        console.warn(
          `[Inspector:Memory] ⚠ MEMORY_LEAK_WARNING: Process ${proc.type} (PID ${proc.pid}) ` +
          `private memory ${privateMB.toFixed(1)}MB exceeds ${MEMORY_LEAK_THRESHOLD_MB}MB threshold.`
        );

        metricsLog.push({
          tag: 'memory_leak_warning',
          value: privateMB,
          metadata: {
            processType: proc.type,
            pid: proc.pid,
            threshold: MEMORY_LEAK_THRESHOLD_MB,
            workingSetMB: parseFloat(workingSetMB.toFixed(1)),
          },
          timestamp: new Date().toISOString(),
        });
      }

      const entry = {
        processType: proc.type,
        pid: proc.pid,
        privateMemory: parseFloat(privateMB.toFixed(1)),
        workingSet: parseFloat(workingSetMB.toFixed(1)),
        cpuPercent: proc.cpu?.percentCPUUsage || 0,
        flag,
      };

      snapshot.processes.push(entry);

      // Also log normal memory metrics
      metricsLog.push({
        tag: `memory_${proc.type}`,
        value: privateMB,
        metadata: {
          pid: proc.pid,
          workingSetMB: workingSetMB.toFixed(1),
          cpuPercent: (proc.cpu?.percentCPUUsage || 0).toFixed(1),
          flag,
        },
        timestamp: new Date().toISOString(),
      });
    }

    performanceMemorySnapshots.push(snapshot);
    // Keep last 200 snapshots
    if (performanceMemorySnapshots.length > 200) {
      performanceMemorySnapshots.splice(0, performanceMemorySnapshots.length - 200);
    }
  } catch (err) {
    console.error('[Inspector:Memory] Failed to sample memory:', err);
  }
}

// ──────────────────────────────────────────────
// IPC Handlers — receive audit events from preload
// ──────────────────────────────────────────────

function setupIPC() {
  // ── Core audit events ──

  ipcMain.on('inspector:reportMetric', (_event, { tag, value, metadata }) => {
    const entry = {
      tag,
      value,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    };
    metricsLog.push(entry);
    console.log(`[Inspector:Metric] ${tag} = ${value}`);

    // Route special performance events to structured stores
    const meta = metadata || {};
    if (meta.type === 'CoreWebVital') {
      // meta.type here is the vital name (e.g. 'FCP', 'LCP', 'CLS') carried in meta.metric
      const vitalName = meta.metric || tag;
      performanceCoreWebVitals[vitalName] = {
        value,
        timestamp: entry.timestamp,
        url: meta.currentURL || '',
      };
    }
    if (meta.type === 'perf:longTask') {
      performanceLongTasks.push({
        duration: value,
        triggerElement: meta.triggerElement || { tag: '', id: '', className: '' },
        timestamp: entry.timestamp,
        currentURL: meta.currentURL || '',
      });
    }
  });

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

  ipcMain.on('inspector:reportError', (_event, { source, message, stack }) => {
    errorLog.push({
      source,
      message,
      stack: stack || null,
      timestamp: new Date().toISOString(),
    });
    console.error(`[Inspector:Error] ${source}: ${message}`);
  });

  // ── Tracing IPC ──

  ipcMain.handle('inspector:startTrace', async () => {
    await startTrace();
    return { success: true };
  });

  ipcMain.handle('inspector:stopTrace', async () => {
    const tracePath = await stopTrace();
    return { success: !!tracePath, tracePath };
  });

  ipcMain.handle('inspector:getTraceStatus', async () => {
    return { traceActive };
  });

  // ── Report generation ──

  ipcMain.handle('inspector:generateReport', async () => {
    try {
      const { ReportAggregator } = require('./reporting');
      const aggregator = new ReportAggregator(
        metricsLog,
        complianceLog,
        uxLog,
        errorLog,
        performanceCoreWebVitals,
        performanceLongTasks,
        performanceMemorySnapshots,
        performanceTraceFilePath,
        REPORTS_DIR
      );
      const filePath = aggregator.generateReport();
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Live status ──

  ipcMain.handle('inspector:getLogCounts', async () => {
    return {
      metrics: metricsLog.length,
      compliance: complianceLog.length,
      ux: uxLog.length,
      errors: errorLog.length,
    };
  });

  // ── Window controls (for frameless window) ──

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
// Inject PerformanceObserver script into page
// ──────────────────────────────────────────────

function injectPerformanceObservers() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      // Skip if already injected
      if (window.__inspectorPerfInjected) return;
      window.__inspectorPerfInjected = true;

      // Track last clicked element for long task correlation
      var lastClickedElement = null;

      document.addEventListener('click', function(e) {
        var el = e.target;
        lastClickedElement = {
          tag: el.tagName || '',
          id: el.id || '',
          className: (el.className && typeof el.className === 'string') ? el.className : ''
        };
      }, true);

      // ── 1. Paint Timing Observer (FP, FCP) ──
      try {
        var paintObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.name === 'first-paint') {
              window.inspector.reportMetric('FP', entry.startTime, {
                type: 'CoreWebVital', metric: 'FP', currentURL: window.location.href
              });
            }
            if (entry.name === 'first-contentful-paint') {
              window.inspector.reportMetric('FCP', entry.startTime, {
                type: 'CoreWebVital', metric: 'FCP', currentURL: window.location.href
              });
            }
          }
        });
        paintObserver.observe({ type: 'paint', buffered: true });
      } catch(e) { console.warn('[Inspector] Paint observer not supported', e); }

      // ── 2. Largest Contentful Paint (LCP) ──
      try {
        var lcpObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          if (entries.length > 0) {
            var entry = entries[entries.length - 1];
            window.inspector.reportMetric('LCP', entry.startTime, {
              type: 'CoreWebVital', metric: 'LCP',
              size: entry.size || 0,
              element: entry.element ? (entry.element.tagName || '') : '',
              currentURL: window.location.href
            });
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch(e) { console.warn('[Inspector] LCP observer not supported', e); }

      // ── 3. Layout Shift (CLS) ──
      try {
        var clsValue = 0;
        var clsObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (!entries[i].hadRecentInput) {
              clsValue += entries[i].value;
            }
          }
          window.inspector.reportMetric('CLS_ongoing', clsValue, {
            type: 'CoreWebVital', metric: 'CLS', currentURL: window.location.href
          });
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });

        // Report final CLS on page unload
        window.addEventListener('beforeunload', function() {
          window.inspector.reportMetric('CLS', clsValue, {
            type: 'CoreWebVital', metric: 'CLS', currentURL: window.location.href
          });
        });
      } catch(e) { console.warn('[Inspector] CLS observer not supported', e); }

      // ── 4. Long Tasks (>50ms) ──
      try {
        var longTaskObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var task = entries[i];
            var duration = task.duration;
            var trigger = lastClickedElement || { tag: '', id: '', className: '' };

            window.inspector.reportMetric('LongTask', duration, {
              type: 'perf:longTask',
              triggerElement: trigger,
              currentURL: window.location.href
            });
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch(e) { console.warn('[Inspector] Long task observer not supported', e); }
    })();
  `).catch(function(err) {
    // Page may not be fully loaded yet; retry on next did-finish-load
    console.warn('[Inspector] Could not inject perf observers (page not ready):', err.message);
  });
}

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  ensureReportsDir();
  setupIPC();
  createMainWindow();

  // Start memory monitoring
  startMemoryMonitoring();

  // Start Chromium content tracing
  startTrace();

  // Notify the renderer of the reports directory
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('inspector:ready', {
      reportsDir: REPORTS_DIR,
      targetUrl: TARGET_URL,
    });

    // Inject PerformanceObservers into the page
    injectPerformanceObservers();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopMemoryMonitoring();
  if (process.platform !== 'darwin') app.quit();
});
