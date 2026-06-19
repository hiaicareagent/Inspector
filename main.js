const { app, BrowserWindow, ipcMain, contentTracing, powerMonitor, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Pre-load axe-core source (read once, cache for injection) ──
let axeCoreSource = '';
try {
  const axePath = require.resolve('axe-core/axe.min.js');
  axeCoreSource = fs.readFileSync(axePath, 'utf-8');
  console.log('[Inspector:Axe] axe-core loaded (' + (axeCoreSource.length / 1024).toFixed(0) + 'KB).');
} catch (err) {
  console.warn('[Inspector:Axe] axe-core not found. Run: npm install axe-core');
}

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const REPORTS_DIR = path.join(__dirname, 'reports');
const SCREENSHOTS_DIR = path.join(REPORTS_DIR, 'screenshots');
const FHIR_SCHEMA_PATH = path.join(__dirname, 'fhir-r4-schema.json');
const TARGET_URL = process.env.INSPECTOR_TARGET_URL || 'https://example.com';
const MEMORY_POLL_MS = 10000;
const MEMORY_LEAK_THRESHOLD_MB = 500;
const TRACE_AUTO_STOP_MS = 30000;
const AUTOLOGOFF_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_POLL_MS = 5000;
const STORAGE_SCAN_DELAY_MS = 1500;

// ──────────────────────────────────────────────
// Ensure directories exist
// ──────────────────────────────────────────────

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    console.log(`[Inspector] Created reports directory: ${REPORTS_DIR}`);
  }
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    console.log(`[Inspector] Created screenshots directory: ${SCREENSHOTS_DIR}`);
  }
}

// ──────────────────────────────────────────────
// Audit data store
// ──────────────────────────────────────────────

let mainWindow = null;

const metricsLog = [];
const complianceLog = [];
const uxLog = [];
const errorLog = [];

// ── Performance-specific stores (Pillar 1) ──
const performanceCoreWebVitals = {};
const performanceLongTasks = [];
const performanceMemorySnapshots = [];
let performanceTraceFilePath = null;

// ── Compliance-specific stores (Pillar 2) ──
const fhirViolations = [];
const phiUnencryptedTransmissions = [];
const phiStorageFlags = [];
const jciIpsg1Violations = [];
const autoLogoffViolations = [];
let lastInteractionTimestamp = null;
let longestInactivity = 0;

// ── Workflow Intelligence stores (Pillar 5) ──
const completedWorkflows = [];
const abandonedWorkflows = [];
const slowWorkflows = [];
const navigationConfusion = [];
const concurrentPatientSessions = [];

// ── Telemetry-specific stores (Pillar 4) ──
const consoleErrors = [];
const consoleWarnings = [];
const rendererCrashes = [];
let sessionStartTime = new Date().toISOString();

// ── UX-specific stores (Pillar 3) ──
const rageClicks = [];
const deadClicks = [];
const layoutShifts = [];
const accessibilityAudit = {
  score: null,
  totalViolations: 0,
  criticalViolations: [],
  seriousViolations: [],
  moderateViolations: [],
};
let previousScreenshotPath = null;
let previousScreenshotHash = null;
let lastLayoutShiftCapture = 0;

// ── Tracing state ──
let traceActive = false;
let traceAutoStopTimer = null;

// ── Memory monitoring timer ──
let memoryTimer = null;

// ── Auto-logoff timer ──
let idleTimer = null;

// ── FHIR Schema ──
let fhirSchema = null;
let ajvValidator = null;

const FHIR_RESOURCE_TYPES = new Set([
  'patient','observation','bundle','encounter','condition','medicationrequest',
  'diagnosticreport','procedure','organization','practitioner','practitionerrole',
  'location','appointment','careplan','careteam','claim','communication',
  'composition','consent','coverage','device','documentreference','familyhistory',
  'goal','imagingstudy','immunization','list','measure','medication','medicationadministration',
  'medicationdispense','molecularsequence','nutritionorder','operationoutcome',
  'person','procedure','provenance','questionnaire','questionnaireresponse',
  'relatedperson','researchstudy','riskassessment','schedule','servicerequest',
  'slot','specimen','structuredefinition','subscription','supplydelivery','task','valueset'
]);

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
      session: session.defaultSession,
    },
    backgroundColor: '#0d1117',
  });

  mainWindow.loadURL(TARGET_URL);

  // ── Telemetry: console-message interception ──
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const entry = {
      level,
      message: message.substring(0, 2000),
      sourceURL: sourceId || '',
      lineNumber: line,
      currentURL: mainWindow ? mainWindow.webContents.getURL() : '',
      timestamp: new Date().toISOString(),
    };

    if (level >= 3) {  // ERROR
      entry.category = 'CONSOLE_ERROR';
      consoleErrors.push(entry);
      errorLog.push({
        source: sourceId || 'console',
        message: `[CONSOLE_ERROR] ${message}`,
        stack: `Line ${line}`,
        timestamp: entry.timestamp,
      });
    } else if (level === 2) {  // WARNING
      entry.category = 'CONSOLE_WARNING';
      consoleWarnings.push(entry);
    }
  });

  // ── Telemetry: renderer crash / unresponsive ──
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const entry = {
      reason: details.reason,
      exitCode: details.exitCode,
      type: 'RENDERER_CRASH',
      currentURL: mainWindow ? mainWindow.webContents.getURL() : '',
      timestamp: new Date().toISOString(),
    };
    rendererCrashes.push(entry);
    errorLog.push({
      source: 'renderer',
      message: `RENDERER_CRASH: ${details.reason} (exit code ${details.exitCode})`,
      stack: details.reason,
      timestamp: entry.timestamp,
    });
    console.error(`[Inspector:Telemetry] ⚠ RENDERER_CRASH: ${details.reason} (exit code ${details.exitCode})`);
  });

  mainWindow.webContents.on('unresponsive', () => {
    const entry = {
      type: 'RENDERER_UNRESPONSIVE',
      currentURL: mainWindow ? mainWindow.webContents.getURL() : '',
      timestamp: new Date().toISOString(),
    };
    rendererCrashes.push(entry);
    errorLog.push({
      source: 'renderer',
      message: 'RENDERER_UNRESPONSIVE: The renderer process is not responding',
      stack: '',
      timestamp: entry.timestamp,
    });
    console.error('[Inspector:Telemetry] ⚠ RENDERER_UNRESPONSIVE');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ──────────────────────────────────────────────
// FHIR R4 Schema Loading (Pillar 2)
// ──────────────────────────────────────────────

function loadFHIRSchema() {
  try {
    if (!fs.existsSync(FHIR_SCHEMA_PATH)) {
      console.warn('[Inspector:FHIR] Schema file not found at', FHIR_SCHEMA_PATH);
      return false;
    }
    const schemaData = fs.readFileSync(FHIR_SCHEMA_PATH, 'utf-8');
    fhirSchema = JSON.parse(schemaData);

    try {
      const Ajv = require('ajv');
      const ajv = new Ajv({
        allErrors: true,
        verbose: false,
        strict: false,
        validateSchema: false,
      });
      ajv.addFormat('uri', true);
      ajv.addFormat('date-time', true);
      const validate = ajv.compile(fhirSchema);
      ajvValidator = validate;
      console.log('[Inspector:FHIR] Schema loaded and compiled successfully.');
      return true;
    } catch (ajvErr) {
      console.error('[Inspector:FHIR] AJV compilation failed:', ajvErr.message);
      ajvValidator = null;
      return false;
    }
  } catch (err) {
    console.error('[Inspector:FHIR] Failed to load schema:', err.message);
    return false;
  }
}

function validateFHIRResource(url, bodyText) {
  const violations = [];
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    violations.push({
      url,
      timestamp: new Date().toISOString(),
      errorType: 'INVALID_JSON',
      errorDetails: `Response body is not valid JSON: ${e.message}`,
    });
    return violations;
  }

  if (!parsed.resourceType) {
    violations.push({
      url,
      timestamp: new Date().toISOString(),
      errorType: 'MISSING_RESOURCE_TYPE',
      errorDetails: 'FHIR resource is missing required "resourceType" field',
    });
    return violations;
  }

  if (!FHIR_RESOURCE_TYPES.has(parsed.resourceType.toLowerCase())) {
    violations.push({
      url,
      timestamp: new Date().toISOString(),
      errorType: 'INVALID_RESOURCE_TYPE',
      errorDetails: `"${parsed.resourceType}" is not a recognized FHIR R4 resource type`,
    });
  }

  if (ajvValidator) {
    const valid = ajvValidator(parsed);
    if (!valid && ajvValidator.errors) {
      for (const err of ajvValidator.errors) {
        violations.push({
          url,
          timestamp: new Date().toISOString(),
          errorType: 'FHIR_SCHEMA_VIOLATION',
          errorDetails: `Schema violation at ${err.schemaPath || err.instancePath}: ${err.message}`,
        });
      }
    }
  }

  if (parsed.id !== undefined && typeof parsed.id === 'string') {
    if (!/^[A-Za-z0-9\-\\.]{1,64}$/.test(parsed.id)) {
      violations.push({
        url,
        timestamp: new Date().toISOString(),
        errorType: 'FHIR_SCHEMA_VIOLATION',
        errorDetails: `Resource id "${parsed.id}" does not match FHIR id pattern (1-64 alphanumeric, hyphens, dots)`,
      });
    }
  }

  if (parsed.meta && parsed.meta.lastUpdated) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parsed.meta.lastUpdated)) {
      violations.push({
        url,
        timestamp: new Date().toISOString(),
        errorType: 'FHIR_SCHEMA_VIOLATION',
        errorDetails: `meta.lastUpdated "${parsed.meta.lastUpdated}" is not a valid ISO 8601 date-time`,
      });
    }
  }

  return violations;
}

// ──────────────────────────────────────────────
// Content Tracing (Pillar 1)
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
// Memory Monitoring (Pillar 1)
// ──────────────────────────────────────────────

function startMemoryMonitoring() {
  if (memoryTimer) return;
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
    const snapshot = { timestamp: new Date().toISOString(), processes: [] };

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
          tag: 'memory_leak_warning', value: privateMB,
          metadata: { processType: proc.type, pid: proc.pid, threshold: MEMORY_LEAK_THRESHOLD_MB, workingSetMB: parseFloat(workingSetMB.toFixed(1)) },
          timestamp: new Date().toISOString(),
        });
      }

      snapshot.processes.push({
        processType: proc.type, pid: proc.pid,
        privateMemory: parseFloat(privateMB.toFixed(1)),
        workingSet: parseFloat(workingSetMB.toFixed(1)),
        cpuPercent: proc.cpu?.percentCPUUsage || 0, flag,
      });

      metricsLog.push({
        tag: `memory_${proc.type}`, value: privateMB,
        metadata: { pid: proc.pid, workingSetMB: workingSetMB.toFixed(1), cpuPercent: (proc.cpu?.percentCPUUsage || 0).toFixed(1), flag },
        timestamp: new Date().toISOString(),
      });
    }

    performanceMemorySnapshots.push(snapshot);
    if (performanceMemorySnapshots.length > 200) {
      performanceMemorySnapshots.splice(0, performanceMemorySnapshots.length - 200);
    }
  } catch (err) {
    console.error('[Inspector:Memory] Failed to sample memory:', err);
  }
}

// ──────────────────────────────────────────────
// Network Interception (Pillar 2)
// ──────────────────────────────────────────────

function setupNetworkInterception() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const filter = { urls: ['http://*/*', 'https://*/*'] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    const urlLower = details.url.toLowerCase();
    const phiKeywords = ['patient', 'mrn', 'medical', 'emr', 'ehr', 'clinical',
                         'diagnosis', 'sensitive', 'phi', 'hipaa', 'provider',
                         'identifier', 'ssn', 'treatment', 'record'];
    if (details.url.startsWith('http://') && phiKeywords.some(kw => urlLower.includes(kw))) {
      if (!phiUnencryptedTransmissions.find(t => t.url === details.url)) {
        const entry = { url: details.url, timestamp: new Date().toISOString(), statusCode: null, resourceType: details.type || 'unknown' };
        phiUnencryptedTransmissions.push(entry);
        complianceLog.push({ standard: 'HIPAA', check: 'PHI_UNENCRYPTED_TRANSMISSION', passed: false, details: JSON.stringify(entry), timestamp: entry.timestamp });
        console.warn(`[Inspector:PHI] ⚠ PHI_UNENCRYPTED_TRANSMISSION (onBeforeRequest) — ${details.url}`);
      }
    }
    callback({ cancel: false });
  });

  try {
    const dbg = mainWindow.webContents.debugger;
    if (!dbg.isAttached()) { dbg.attach('1.3'); }

    dbg.on('message', (_event, method, params) => {
      if (method === 'Network.responseReceived') {
        const { requestId, response, type } = params;
        const headers = response.headers || {};
        const contentType = headers['content-type'] || headers['Content-Type'] || headers['CONTENT-TYPE'] || '';
        const contentTypeLower = contentType.toLowerCase();

        const isFHIR = contentTypeLower.includes('application/fhir+json') ||
          (type === 'XHR' && contentTypeLower.includes('json') &&
           (response.url.toLowerCase().includes('/fhir/') || response.url.toLowerCase().includes('/r4/') ||
            response.url.toLowerCase().includes('/patient/') || response.url.toLowerCase().includes('/observation/')));

        if (isFHIR) {
          setTimeout(async () => {
            try {
              const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId });
              const bodyText = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
              const violations = validateFHIRResource(response.url, bodyText);
              for (const v of violations) {
                fhirViolations.push(v);
                complianceLog.push({ standard: 'FHIR_R4', check: `FHIR_VIOLATION: ${v.errorType} at ${response.url}`, passed: false, details: JSON.stringify(v), timestamp: v.timestamp });
                console.warn(`[Inspector:FHIR] ⚠ ${v.errorType} — ${response.url}: ${v.errorDetails}`);
              }
            } catch (bodyErr) {
              if (!bodyErr.message.includes('No resource')) {
                console.warn('[Inspector:Network] Could not get response body:', bodyErr.message);
              }
            }
          }, 100);
        }

        if (response.url.startsWith('http://')) {
          const urlLower = response.url.toLowerCase();
          const phiKeywords = ['patient', 'mrn', 'medical', 'emr', 'ehr', 'clinical',
                               'diagnosis', 'sensitive', 'phi', 'hipaa', 'provider',
                               'identifier', 'ssn', 'treatment', 'record'];
          if (phiKeywords.some(kw => urlLower.includes(kw))) {
            if (!phiUnencryptedTransmissions.find(t => t.url === response.url)) {
              const entry = { url: response.url, timestamp: new Date().toISOString(), statusCode: response.status, resourceType: type };
              phiUnencryptedTransmissions.push(entry);
              complianceLog.push({ standard: 'HIPAA', check: 'PHI_UNENCRYPTED_TRANSMISSION', passed: false, details: JSON.stringify(entry), timestamp: entry.timestamp });
              console.warn(`[Inspector:PHI] ⚠ PHI_UNENCRYPTED_TRANSMISSION — ${response.url}`);
            }
          }
        }

        if (!contentTypeLower.includes('application/fhir+json') && type === 'XHR') {
          const fhirPattern = /\/(fhir|r4|metadata|patient|observation|condition|encounter|medication|procedure|diagnosticreport|bundle)\b/i;
          if (fhirPattern.test(response.url.toLowerCase())) {
            setTimeout(async () => {
              try {
                const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId });
                const bodyText = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
                try {
                  const parsed = JSON.parse(bodyText);
                  if (parsed.resourceType) {
                    const violations = validateFHIRResource(response.url, bodyText);
                    for (const v of violations) {
                      fhirViolations.push(v);
                      complianceLog.push({ standard: 'FHIR_R4', check: `FHIR_VIOLATION: ${v.errorType} at ${response.url}`, passed: false, details: JSON.stringify(v), timestamp: v.timestamp });
                      console.warn(`[Inspector:FHIR] ⚠ ${v.errorType} — ${response.url}: ${v.errorDetails}`);
                    }
                  }
                } catch (_) { /* not JSON */ }
              } catch (_) { /* body unavailable */ }
            }, 100);
          }
        }
      }
    });

    dbg.sendCommand('Network.enable', { maxTotalBufferSize: 10000000, maxResourceBufferSize: 5000000, maxPostDataSize: 5000000 });
    console.log('[Inspector:Network] Network interception enabled (FHIR validation + PHI detection).');
  } catch (err) {
    console.error('[Inspector:Network] Failed to setup network interception:', err.message);
  }
}

// ──────────────────────────────────────────────
// Auto-Logoff Audit (Pillar 2)
// ──────────────────────────────────────────────

function startAutoLogoffAudit() {
  if (idleTimer) return;
  checkIdleTime();
  idleTimer = setInterval(checkIdleTime, IDLE_POLL_MS);
}

function stopAutoLogoffAudit() {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
}

function checkIdleTime() {
  try {
    const systemIdleSeconds = powerMonitor.getSystemIdleTime();
    const interactionMs = lastInteractionTimestamp ? Date.now() - lastInteractionTimestamp : systemIdleSeconds * 1000;
    const effectiveInactiveMs = Math.max(systemIdleSeconds * 1000, interactionMs);
    longestInactivity = Math.max(longestInactivity, effectiveInactiveMs);

    if (effectiveInactiveMs > AUTOLOGOFF_TIMEOUT_MS) {
      const lastViolation = autoLogoffViolations[autoLogoffViolations.length - 1];
      const alreadyFlagged = lastViolation && Math.abs(new Date(lastViolation.timestamp) - Date.now()) < 60000;
      if (!alreadyFlagged) {
        const entry = { systemIdleSeconds, timeSinceLastInteractionMs: interactionMs, effectiveInactiveMs, timeoutLimitMs: AUTOLOGOFF_TIMEOUT_MS, timestamp: new Date().toISOString() };
        autoLogoffViolations.push(entry);
        complianceLog.push({ standard: 'HIPAA', check: 'AUTOLOGOFF_FAILURE', passed: false, details: JSON.stringify(entry), timestamp: entry.timestamp });
        console.warn(`[Inspector:AutoLogoff] ⚠ AUTOLOGOFF_FAILURE: idle ${Math.round(effectiveInactiveMs/60000)}min exceeds ${AUTOLOGOFF_TIMEOUT_MS/60000}min limit.`);
      }
    }
  } catch (err) {
    if (!err.message.includes('powerMonitor')) {
      console.error('[Inspector:AutoLogoff] Failed to check idle time:', err.message);
    }
  }
}

// ──────────────────────────────────────────────
// Layout Shift Screenshot Capture (Pillar 3)
// ──────────────────────────────────────────────

/**
 * Compute a simple pixel hash from a nativeImage by averaging blocks
 */
function computeImageHash(image) {
  const size = image.getSize();
  if (!size || size.width === 0 || size.height === 0) return null;

  const bitmap = image.toBitmap(); // Buffer RGBA
  const blockSize = 16;
  const hash = [];

  for (let y = 0; y < size.height; y += blockSize) {
    for (let x = 0; x < size.width; x += blockSize) {
      let r = 0, g = 0, b = 0, count = 0;
      const maxDy = Math.min(blockSize, size.height - y);
      const maxDx = Math.min(blockSize, size.width - x);
      for (let dy = 0; dy < maxDy; dy++) {
        for (let dx = 0; dx < maxDx; dx++) {
          const idx = ((y + dy) * size.width + (x + dx)) * 4;
          r += bitmap[idx];
          g += bitmap[idx + 1];
          b += bitmap[idx + 2];
          count++;
        }
      }
      hash.push(Math.round(r / count), Math.round(g / count), Math.round(b / count));
    }
  }
  return hash;
}

/**
 * Compare two pixel hashes and return a diff percentage (0-100)
 */
function compareHashes(hash1, hash2) {
  if (!hash1 || !hash2) return 100;
  const minLen = Math.min(hash1.length, hash2.length);
  if (minLen === 0) return 100;
  let totalDiff = 0;
  for (let i = 0; i < minLen; i++) {
    totalDiff += Math.abs(hash1[i] - hash2[i]);
  }
  // Maximum possible diff: minLen * 255
  return (totalDiff / (minLen * 255)) * 100;
}

/**
 * Capture a screenshot when a layout shift is detected (throttled to 1 capture per 2s)
 */
async function captureLayoutShift(shiftValue) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Throttle: at most one capture every 2 seconds
  const now = Date.now();
  if (now - lastLayoutShiftCapture < 2000) return;
  lastLayoutShiftCapture = now;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(SCREENSHOTS_DIR, `shift-${timestamp}.png`);

    // Capture the page
    const image = await mainWindow.webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());

    const currentHash = computeImageHash(image);
    let diffPercent = 100;
    let screenshotBefore = previousScreenshotPath;

    if (previousScreenshotHash && previousScreenshotPath) {
      diffPercent = compareHashes(previousScreenshotHash, currentHash);
    }

    // Update state for next comparison
    previousScreenshotPath = screenshotPath;
    previousScreenshotHash = currentHash;

    const entry = {
      timestamp: new Date().toISOString(),
      shiftValue,
      diffPercent: parseFloat(diffPercent.toFixed(2)),
      screenshotBefore: diffPercent > 5 ? screenshotBefore : null,
      screenshotAfter: diffPercent > 5 ? screenshotPath : null,
      isSignificant: diffPercent > 5,
    };

    layoutShifts.push(entry);

    if (diffPercent > 5) {
      console.warn(`[Inspector:LayoutShift] ⚠ SIGNIFICANT_LAYOUT_SHIFT: ${diffPercent.toFixed(1)}% change (CLS: ${shiftValue})`);
      uxLog.push({
        category: 'layout_shift',
        score: diffPercent,
        element: null,
        note: `SIGNIFICANT_LAYOUT_SHIFT: ${diffPercent.toFixed(1)}% change, CLS=${shiftValue}, screenshot=${screenshotPath}`,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log(`[Inspector:LayoutShift] Layout shift captured: ${diffPercent.toFixed(1)}% change (CLS: ${shiftValue})`);
    }
  } catch (err) {
    console.error('[Inspector:LayoutShift] Failed to capture screenshot:', err.message);
  }
}

// ──────────────────────────────────────────────
// Inject PerformanceObserver script (Pillar 1)
// ──────────────────────────────────────────────

function injectPerformanceObservers() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      if (window.__inspectorPerfInjected) return;
      window.__inspectorPerfInjected = true;

      var lastClickedElement = null;

      document.addEventListener('click', function(e) {
        var el = e.target;
        lastClickedElement = {
          tag: el.tagName || '',
          id: el.id || '',
          className: (el.className && typeof el.className === 'string') ? el.className : '',
          text: (el.textContent || '').substring(0, 50)
        };
      }, true);

      try {
        var paintObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.name === 'first-paint') {
              window.inspector.reportMetric('FP', entry.startTime, { type: 'CoreWebVital', metric: 'FP', currentURL: window.location.href });
            }
            if (entry.name === 'first-contentful-paint') {
              window.inspector.reportMetric('FCP', entry.startTime, { type: 'CoreWebVital', metric: 'FCP', currentURL: window.location.href });
            }
          }
        });
        paintObserver.observe({ type: 'paint', buffered: true });
      } catch(e) { console.warn('[Inspector] Paint observer not supported', e); }

      try {
        var lcpObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          if (entries.length > 0) {
            var entry = entries[entries.length - 1];
            window.inspector.reportMetric('LCP', entry.startTime, { type: 'CoreWebVital', metric: 'LCP', size: entry.size || 0, element: entry.element ? (entry.element.tagName || '') : '', currentURL: window.location.href });
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch(e) { console.warn('[Inspector] LCP observer not supported', e); }

      try {
        var clsValue = 0;
        var clsObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (!entries[i].hadRecentInput) {
              clsValue += entries[i].value;
            }
          }
          window.inspector.reportMetric('CLS_ongoing', clsValue, { type: 'CoreWebVital', metric: 'CLS', currentURL: window.location.href });
          // Trigger screenshot capture for layout shift visualization
          window.inspector.reportLayoutShift(clsValue);
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
        window.addEventListener('beforeunload', function() {
          window.inspector.reportMetric('CLS', clsValue, { type: 'CoreWebVital', metric: 'CLS', currentURL: window.location.href });
        });
      } catch(e) { console.warn('[Inspector] CLS observer not supported', e); }

      try {
        var longTaskObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var task = entries[i];
            var trigger = lastClickedElement || { tag: '', id: '', className: '', text: '' };
            window.inspector.reportMetric('LongTask', task.duration, { type: 'perf:longTask', triggerElement: trigger, currentURL: window.location.href });
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch(e) { console.warn('[Inspector] Long task observer not supported', e); }
    })();
  `).catch(function(err) {
    console.warn('[Inspector] Could not inject perf observers (page not ready):', err.message);
  });
}

// ──────────────────────────────────────────────
// Inject Compliance Scanners (Pillar 2)
// ──────────────────────────────────────────────

function injectComplianceScanners() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      if (window.__inspectorComplianceInjected) return;
      window.__inspectorComplianceInjected = true;

      var currentURL = window.location.href;

      // ── Storage PHI Scanner ──
      function scanStorageForPHI() {
        var patterns = [
          { name: 'MRN', regex: /\\bMRN[-:]?\\s*\\d{4,12}\\b/i },
          { name: 'DOB', regex: /\\b\\d{2}[\\/\\-]\\d{2}[\\/\\-]\\d{4}\\b/ },
          { name: 'NHS/ID', regex: /\\b[A-Z]{2}\\d{6}[A-Z]\\b/ },
        ];
        var stores = [
          { name: 'localStorage', store: window.localStorage },
          { name: 'sessionStorage', store: window.sessionStorage },
        ];
        var results = [];
        for (var si = 0; si < stores.length; si++) {
          var storeInfo = stores[si], store = storeInfo.store;
          if (!store) continue;
          try {
            for (var ki = 0; ki < store.length; ki++) {
              var key = store.key(ki), value = '';
              try { value = store.getItem(key) || ''; } catch(e) { value = ''; }
              for (var pi = 0; pi < patterns.length; pi++) {
                var pattern = patterns[pi];
                if (pattern.regex.test(value) || pattern.regex.test(key)) {
                  results.push({ store: storeInfo.name, key: key, pattern: pattern.name, timestamp: new Date().toISOString() });
                }
              }
            }
          } catch(e) { console.warn('[Inspector] Storage scan error:', e.message); }
        }
        for (var ri = 0; ri < results.length; ri++) {
          window.inspector.reportCompliance('HIPAA', 'PHI_IN_STORAGE: ' + results[ri].pattern + ' found in ' + results[ri].store + '[' + results[ri].key + ']', false, JSON.stringify(results[ri]));
        }
        return results;
      }

      // ── JCI IPSG-1 Check ──
      var lastJCIReportKey = null;
      function checkPatientIdentifiers() {
        var body = document.body;
        if (!body) return;
        var text = (body.innerText || body.textContent || '').substring(0, 10000);
        var url = window.location.href, title = document.title;
        var isPatientPage = /patient|emr|ehr|chart|record|medical|clinical|encounter/i.test(url) || /patient|emr|ehr|chart|record|medical|clinical|encounter/i.test(title);
        if (!isPatientPage) return;
        var identifiersFound = 0, identifierTypes = [];
        if (/[A-Z][a-z]+\\s+[A-Z][a-z]+/.test(text)) { identifiersFound++; identifierTypes.push('Full Name'); }
        if (/\\bMRN[-:]?\\s*\\d{4,12}\\b/i.test(text)) { identifiersFound++; identifierTypes.push('MRN'); }
        if (/\\b\\d{2}[\\/\\-]\\d{2}[\\/\\-]\\d{4}\\b/.test(text)) { identifiersFound++; identifierTypes.push('Date of Birth'); }
        if (/\\bPatient\\s*ID\\b|\\bPID[-:]\\s*\\w+\\b/i.test(text) || /\\b\\d{6,10}\\b/.test(text)) { identifiersFound++; identifierTypes.push('Patient ID'); }
        if (identifiersFound > 0 && identifiersFound < 2) {
          var checkKey = url + '|' + identifiersFound;
          if (checkKey !== lastJCIReportKey) {
            lastJCIReportKey = checkKey;
            window.inspector.reportCompliance('JCI', 'JCI_IPSG1_VIOLATION: Only ' + identifiersFound + ' patient identifier(s) visible (' + identifierTypes.join(', ') + ')', false, JSON.stringify({ url: url, identifiersFound: identifiersFound, identifierTypes: identifierTypes }));
          }
        }
      }

      // ── Interaction Timestamps ──
      var interactionThrottleTimer = null;
      function sendInteractionTimestamp() { window.inspector.reportInteraction(Date.now()); }
      document.addEventListener('mousemove', function() {
        if (!interactionThrottleTimer) {
          interactionThrottleTimer = setTimeout(function() { interactionThrottleTimer = null; sendInteractionTimestamp(); }, 5000);
        }
      }, { passive: true });
      document.addEventListener('keydown', function() {
        if (!interactionThrottleTimer) {
          interactionThrottleTimer = setTimeout(function() { interactionThrottleTimer = null; sendInteractionTimestamp(); }, 5000);
        }
      }, { passive: true });

      // ── Run initial scans ──
      setTimeout(function() { scanStorageForPHI(); }, 1500);
      window.addEventListener('storage', function() { setTimeout(scanStorageForPHI, 500); });

      var jciCheckTimer = null;
      function debouncedJCICheck() { if (jciCheckTimer) clearTimeout(jciCheckTimer); jciCheckTimer = setTimeout(checkPatientIdentifiers, 2000); }
      setTimeout(checkPatientIdentifiers, 2000);
      try {
        var bodyObserver = new MutationObserver(function() { debouncedJCICheck(); });
        if (document.body) {
          bodyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        } else {
          var bodyReadyCheck = setInterval(function() {
            if (document.body) { bodyObserver.observe(document.body, { childList: true, subtree: true, characterData: true }); clearInterval(bodyReadyCheck); }
          }, 200);
        }
      } catch(e) { console.warn('[Inspector] JCI MutationObserver error:', e.message); }

      var pushState = history.pushState;
      history.pushState = function() { pushState.apply(this, arguments); window.__inspectorComplianceInjected = false; };
      var replaceState = history.replaceState;
      history.replaceState = function() { replaceState.apply(this, arguments); window.__inspectorComplianceInjected = false; };
    })();
  `).catch(function(err) {
    console.warn('[Inspector] Could not inject compliance scanners:', err.message);
  });
}

// ──────────────────────────────────────────────
// Inject UX Scanners — Rage-Click & Dead-Click (Pillar 3)
// ──────────────────────────────────────────────

function injectUXScanners() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      if (window.__inspectorUXInjected) return;
      window.__inspectorUXInjected = true;

      // ════════════════════════════════════════
      // Shared state
      // ════════════════════════════════════════

      var clickHistory = [];
      var pendingDeadClickChecks = [];
      var lastMutationTime = Date.now();

      // Track DOM mutations for dead-click detection
      try {
        var uxMutationObserver = new MutationObserver(function() {
          lastMutationTime = Date.now();
        });
        if (document.body) {
          uxMutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
        }
      } catch(e) { /* body not ready */ }

      // Track network requests for dead-click detection
      var originalFetch = window.fetch;
      window.fetch = function() {
        lastMutationTime = Date.now();
        return originalFetch.apply(this, arguments);
      };
      var originalXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function() {
        lastMutationTime = Date.now();
        return originalXHROpen.apply(this, arguments);
      };

      // ════════════════════════════════════════
      // Rage-Click Detection
      // ════════════════════════════════════════

      function checkRageClick(x, y, element, timestamp) {
        // Filter clicks within the last 500ms
        var recentClicks = clickHistory.filter(function(c) { return (timestamp - c.timestamp) <= 500; });
        recentClicks.push({ x: x, y: y, timestamp: timestamp });

        if (recentClicks.length >= 3) {
          // Check if all clicks are within 40px radius
          var allClose = true;
          for (var i = 0; i < recentClicks.length && allClose; i++) {
            for (var j = i + 1; j < recentClicks.length && allClose; j++) {
              var dx = recentClicks[i].x - recentClicks[j].x;
              var dy = recentClicks[i].y - recentClicks[j].y;
              var dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 40) allClose = false;
            }
          }

          if (allClose) {
            // Wait 800ms to see if anything happens
            var checkTime = Date.now();
            var beforeMutation = lastMutationTime;
            setTimeout(function() {
              var nowMutation = lastMutationTime;
              if (nowMutation <= beforeMutation) {
                // No mutation or network happened — flag RAGE_CLICK
                window.inspector.reportUX('rage_click', recentClicks.length, JSON.stringify({
                  x: x, y: y,
                  element: element,
                  clickCount: recentClicks.length,
                  timestamp: timestamp
                }), 'RAGE_CLICK: ' + recentClicks.length + ' rapid clicks on ' + (element.tag || 'unknown'));
              }
            }, 800);
          }
        }
      }

      // ════════════════════════════════════════
      // Dead-Click Detection
      // ════════════════════════════════════════

      function checkDeadClick(element, timestamp) {
        var beforeMutation = lastMutationTime;
        var deadCheckId = Date.now() + '_' + Math.random();
        pendingDeadClickChecks.push(deadCheckId);

        setTimeout(function() {
          var idx = pendingDeadClickChecks.indexOf(deadCheckId);
          if (idx !== -1) pendingDeadClickChecks.splice(idx, 1);

          var afterMutation = lastMutationTime;
          if (afterMutation <= beforeMutation) {
            // No mutation or network followed the click
            window.inspector.reportUX('dead_click', 0, JSON.stringify({
              element: element,
              timestamp: timestamp
            }), 'DEAD_CLICK on ' + (element.tag || 'unknown'));
          }
        }, 800);
      }

      // ════════════════════════════════════════
      // Click Handler
      // ════════════════════════════════════════

      document.addEventListener('click', function(e) {
        var el = e.target;
        var element = {
          tag: el.tagName || '',
          id: el.id || '',
          className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 100) : '',
          text: (el.textContent || '').substring(0, 50)
        };

        var x = e.clientX, y = e.clientY, now = Date.now();

        // Record click for rage-click detection
        clickHistory.push({ x: x, y: y, timestamp: now });
        // Prune clicks older than 1s
        clickHistory = clickHistory.filter(function(c) { return (now - c.timestamp) <= 1000; });

        // Run detectors
        checkRageClick(x, y, element, now);
        checkDeadClick(element, now);
      }, true);

      // ════════════════════════════════════════
      // Cleanup on SPA navigation
      // ════════════════════════════════════════

      var uxPushState = history.pushState;
      history.pushState = function() { uxPushState.apply(this, arguments); window.__inspectorUXInjected = false; };
      var uxReplaceState = history.replaceState;
      history.replaceState = function() { uxReplaceState.apply(this, arguments); window.__inspectorUXInjected = false; };
    })();
  `).catch(function(err) {
    console.warn('[Inspector] Could not inject UX scanners:', err.message);
  });
}

// ──────────────────────────────────────────────
// Inject Workflow Intelligence (Pillar 5)
// ──────────────────────────────────────────────

function injectWorkflowIntelligence() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      if (window.__inspectorWorkflowInjected) return;
      window.__inspectorWorkflowInjected = true;

      // ════════════════════════════════════════
      // Workflow Patterns & State
      // ════════════════════════════════════════

      var WORKFLOW_PATTERNS = {
        medication_order: { steps: ['/medications', '/order', '/sign', '/submit'], maxTime: 180 },
        discharge_summary: { steps: ['/patient', '/summary', '/sign'], maxTime: 600 },
        lab_order: { steps: ['/labs', '/order', '/submit'], maxTime: 120 },
      };

      var navHistory = [];
      var currentWorkflows = {};
      var last10Nav = [];
      var workflowCompletedThisSession = [];

      // ════════════════════════════════════════
      // URL Helpers
      // ════════════════════════════════════════

      function getPatientContext() {
        var url = window.location.href;
        var title = document.title;
        // Try to extract patient ID from URL
        var match = url.match(/[?&]patient[=_]?([^&]+)/i) || url.match(/\/patient\/([^\/?#]+)/i);
        var patientId = match ? match[1] : '';
        if (!patientId) {
          match = title.match(/[Pp]atient\s*[#:]?\s*(\w+)/);
          patientId = match ? match[1] : '';
        }
        return patientId || '';
      }

      function getUrlPath(url) {
        try { return new URL(url).pathname.toLowerCase(); }
        catch(e) { return ''; }
      }

      // ════════════════════════════════════════
      // 1. Workflow Session Tracker
      // ════════════════════════════════════════

      function matchWorkflow(path) {
        var matched = [];
        for (var wf in WORKFLOW_PATTERNS) {
          var steps = WORKFLOW_PATTERNS[wf].steps;
          for (var si = 0; si < steps.length; si++) {
            if (path.includes(steps[si])) {
              matched.push({ workflow: wf, stepIndex: si, step: steps[si] });
              break;
            }
          }
        }
        if (matched.length === 0) return null;
        // Return the one with the most advanced step index
        matched.sort(function(a, b) { return b.stepIndex - a.stepIndex; });
        return matched[0];
      }

      function onNavigation(url) {
        var path = getUrlPath(url);
        if (!path) return;

        var now = Date.now();
        var patientId = getPatientContext();

        // Record navigation
        var navEntry = { url: url, path: path, timestamp: now, patientContext: patientId };
        navHistory.push(navEntry);
        last10Nav.push(path);
        if (last10Nav.length > 10) last10Nav.shift();

        // Match against workflow patterns
        var match = matchWorkflow(path);
        if (!match) {
          // User navigated away from a workflow — check for abandonment
          for (var wf in currentWorkflows) {
            var activeWf = currentWorkflows[wf];
            if (activeWf && !activeWf.completed) {
              var checkTime = now;
              var checkPath = path;
              var isCompletionStep = false;
              var steps = WORKFLOW_PATTERNS[wf].steps;
              var lastStep = steps[steps.length - 1];
              if (checkPath.includes(lastStep)) {
                isCompletionStep = true;
              }
              if (!isCompletionStep) {
                // Abandoned
                var duration = Math.round((checkTime - activeWf.startTime) / 1000);
                window.inspector.reportWorkflowEvent('workflow_abandoned', {
                  workflowType: wf,
                  lastCompletedStep: activeWf.currentStep || 'none',
                  abandonedAt: checkPath,
                  duration: duration,
                  patientContext: patientId,
                });
                window.inspector.reportWorkflowEvent('workflow_slow', {
                  workflowType: wf,
                  duration: duration,
                  threshold: WORKFLOW_PATTERNS[wf].maxTime,
                  patientContext: patientId,
                });
                delete currentWorkflows[wf];
              }
            }
          }
          return;
        }

        var wfType = match.workflow;
        if (!currentWorkflows[wfType]) {
          // Start new workflow
          currentWorkflows[wfType] = {
            workflowType: wfType,
            startTime: now,
            currentStep: match.step,
            stepIndex: match.stepIndex,
            stepsVisited: [match.step],
            completed: false,
            patientContext: patientId,
          };
        } else {
          var wf = currentWorkflows[wfType];
          // Update progress
          if (match.stepIndex > wf.stepIndex) {
            wf.currentStep = match.step;
            wf.stepIndex = match.stepIndex;
            wf.stepsVisited.push(match.step);
          }
          // Check if workflow is completed (reached final step)
          var stepCount = WORKFLOW_PATTERNS[wfType].steps.length;
          if (match.stepIndex >= stepCount - 1) {
            wf.completed = true;
            var duration = Math.round((now - wf.startTime) / 1000);
            var maxTime = WORKFLOW_PATTERNS[wfType].maxTime;
            window.inspector.reportWorkflowEvent('workflow_completed', {
              workflowType: wfType,
              duration: duration,
              stepsVisited: wf.stepsVisited.length,
              patientContext: patientId,
            });
            if (duration > maxTime) {
              window.inspector.reportWorkflowEvent('workflow_slow', {
                workflowType: wfType,
                duration: duration,
                threshold: maxTime,
                patientContext: patientId,
              });
            }
            delete currentWorkflows[wfType];
          }
        }
      }

      // ════════════════════════════════════════
      // 3. Non-linear Navigation Detection
      // ════════════════════════════════════════

      function detectNavigationConfusion(wfType, path) {
        if (!wfType || !path) return;
        var count = 0;
        for (var i = 0; i < last10Nav.length - 1; i++) {
          for (var j = i + 1; j < last10Nav.length; j++) {
            if (last10Nav[i] === last10Nav[j]) count++;
          }
        }
        if (count >= 3) {
          window.inspector.reportWorkflowEvent('navigation_confusion', {
            workflowType: wfType || 'unknown',
            backtrackCount: count,
            sequence: last10Nav.slice(),
          });
        }
      }

      // ════════════════════════════════════════
      // 2. Time-on-task + 3. Detection hooks
      // ════════════════════════════════════════

      // Wrap history.pushState
      var origPushState = history.pushState;
      history.pushState = function() {
        origPushState.apply(this, arguments);
        onNavigation(window.location.href);
        var match = matchWorkflow(getUrlPath(window.location.href));
        detectNavigationConfusion(match ? match.workflow : null, getUrlPath(window.location.href));
      };

      var origReplaceState = history.replaceState;
      history.replaceState = function() {
        origReplaceState.apply(this, arguments);
        onNavigation(window.location.href);
        var match = matchWorkflow(getUrlPath(window.location.href));
        detectNavigationConfusion(match ? match.workflow : null, getUrlPath(window.location.href));
      };

      window.addEventListener('popstate', function() {
        onNavigation(window.location.href);
        var match = matchWorkflow(getUrlPath(window.location.href));
        detectNavigationConfusion(match ? match.workflow : null, getUrlPath(window.location.href));
      });

      window.addEventListener('hashchange', function() {
        onNavigation(window.location.href);
        var match = matchWorkflow(getUrlPath(window.location.href));
        detectNavigationConfusion(match ? match.workflow : null, getUrlPath(window.location.href));
      });

      // Initial navigation recording
      onNavigation(window.location.href);

      // ════════════════════════════════════════
      // 4. Multi-tab Patient Detection
      // ════════════════════════════════════════

      try {
        var patientId = getPatientContext();
        if (patientId) {
          // Write patient ID to sessionStorage for cross-tab detection
          var existingPatients = {};
          try {
            var stored = sessionStorage.getItem('__inspector_patients') || '{}';
            existingPatients = JSON.parse(stored);
          } catch(e) { existingPatients = {}; }

          existingPatients[patientId] = (existingPatients[patientId] || 0) + 1;
          sessionStorage.setItem('__inspector_patients', JSON.stringify(existingPatients));

          // Use BroadcastChannel for real-time cross-tab communication
          var channel = new BroadcastChannel('inspector_patient_channel');
          channel.postMessage({ type: 'patient_open', patientId: patientId, tabId: Date.now() });

          channel.onmessage = function(e) {
            if (e.data && e.data.type === 'patient_open' && e.data.patientId === patientId) {
              // Count how many tabs have this patient open
              var tabCount = 0;
              try {
                var stored = sessionStorage.getItem('__inspector_patients') || '{}';
                var patients = JSON.parse(stored);
                tabCount = patients[patientId] || 0;
              } catch(e) { tabCount = 1; }

              if (tabCount > 1) {
                window.inspector.reportWorkflowEvent('concurrent_patient', {
                  patientID: patientId,
                  tabCount: tabCount,
                });
              }
            }
          };

          // Clean up on page unload
          window.addEventListener('beforeunload', function() {
            try {
              var stored = sessionStorage.getItem('__inspector_patients') || '{}';
              var patients = JSON.parse(stored);
              if (patients[patientId]) {
                patients[patientId]--;
                if (patients[patientId] <= 0) delete patients[patientId];
              }
              sessionStorage.setItem('__inspector_patients', JSON.stringify(patients));
            } catch(e) {}
          });
        }
      } catch(e) {
        console.warn('[Inspector] BroadcastChannel not available:', e.message);
      }

      // Reset flag on SPA navigation
      var wfPushState = history.pushState;
      history.pushState = function() { wfPushState.apply(this, arguments); window.__inspectorWorkflowInjected = false; };
      var wfReplaceState = history.replaceState;
      history.replaceState = function() { wfReplaceState.apply(this, arguments); window.__inspectorWorkflowInjected = false; };
    })();
  `).catch(function(err) {
    console.warn('[Inspector] Could not inject workflow intelligence:', err.message);
  });
}

// ──────────────────────────────────────────────
// Inject axe-core Accessibility Scanner (Pillar 3)
// ──────────────────────────────────────────────

function injectAxeScanner(force) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!axeCoreSource) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      if (window.__inspectorAxeInjected) return;
      if (${!!force}) { window.__inspectorAxeInjected = false; }
      if (window.__inspectorAxeInjected) return;
      window.__inspectorAxeInjected = true;

      // Inject axe-core source
      ${axeCoreSource}

      // Run axe-core with focused rules
      axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
        },
        resultTypes: ['violations'],
        rules: {
          'color-contrast': { enabled: true },
          'label': { enabled: true },
          'keyboard': { enabled: true },
          'aria-required-attr': { enabled: true }
        }
      }).then(function(results) {
        var violations = results.violations || [];

        var critical = violations.filter(function(v) { return v.impact === 'critical'; });
        var serious = violations.filter(function(v) { return v.impact === 'serious'; });
        var moderate = violations.filter(function(v) { return v.impact === 'moderate' || v.impact === 'minor'; });

        window.inspector.reportAxeResults({
          score: violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 5),
          totalViolations: violations.length,
          criticalViolations: critical.map(function(v) { return { id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length }; }),
          seriousViolations: serious.map(function(v) { return { id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length }; }),
          moderateViolations: moderate.map(function(v) { return { id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length }; }),
          url: window.location.href,
          timestamp: new Date().toISOString()
        });
      }).catch(function(err) {
        console.warn('[Inspector:Axe] Error:', err.message);
      });

      // Reset flag on SPA navigation
      var axePushState = history.pushState;
      history.pushState = function() { axePushState.apply(this, arguments); window.__inspectorAxeInjected = false; };
      var axeReplaceState = history.replaceState;
      history.replaceState = function() { axeReplaceState.apply(this, arguments); window.__inspectorAxeInjected = false; };
    })();
  `).catch(function(err) {
    console.warn('[Inspector:Axe] Could not inject axe-core:', err.message);
  });
}

// ──────────────────────────────────────────────
// IPC Handlers
// ──────────────────────────────────────────────

function setupIPC() {
  // ── Core audit events ──

  ipcMain.on('inspector:reportMetric', (_event, { tag, value, metadata }) => {
    const entry = { tag, value, metadata: metadata || {}, timestamp: new Date().toISOString() };
    metricsLog.push(entry);
    console.log(`[Inspector:Metric] ${tag} = ${value}`);

    const meta = metadata || {};
    if (meta.type === 'CoreWebVital') {
      performanceCoreWebVitals[meta.metric || tag] = { value, timestamp: entry.timestamp, url: meta.currentURL || '' };
    }
    if (meta.type === 'perf:longTask') {
      performanceLongTasks.push({ duration: value, triggerElement: meta.triggerElement || { tag: '', id: '', className: '' }, timestamp: entry.timestamp, currentURL: meta.currentURL || '' });
    }
  });

  ipcMain.on('inspector:reportCompliance', (_event, { standard, check, passed, details }) => {
    const entry = { standard, check, passed, details: details || '', timestamp: new Date().toISOString() };
    complianceLog.push(entry);

    const detailsObj = (() => { try { return JSON.parse(details || '{}'); } catch(e) { return {}; } })();
    if (check.startsWith('PHI_IN_STORAGE')) {
      phiStorageFlags.push({ key: detailsObj.key || 'unknown', pattern: detailsObj.pattern || 'unknown', store: detailsObj.store || 'unknown', timestamp: entry.timestamp });
    }
    if (check.startsWith('JCI_IPSG1_VIOLATION')) {
      jciIpsg1Violations.push({ url: detailsObj.url || '', timestamp: entry.timestamp, identifiersFound: detailsObj.identifiersFound || 0, identifierTypes: detailsObj.identifierTypes || [] });
    }

    console.log(`[Inspector:Compliance] ${passed ? '\u2713' : '\u2717'} ${standard} \u2014 ${check}`);
  });

  ipcMain.on('inspector:reportUX', (_event, { category, score, element, note }) => {
    const entry = { category, score, element: element || null, note: note || '', timestamp: new Date().toISOString() };
    uxLog.push(entry);

    // Route UX events to specialized stores
    if (category === 'rage_click') {
      const el = (() => { try { return JSON.parse(element || '{}'); } catch(e) { return {}; } })();
      rageClicks.push({ x: el.x, y: el.y, element: el.element, timestamp: entry.timestamp, clickCount: el.clickCount || score });
    }
    if (category === 'dead_click') {
      const el = (() => { try { return JSON.parse(element || '{}'); } catch(e) { return {}; } })();
      deadClicks.push({ element: el.element, timestamp: entry.timestamp });
    }

    console.log(`[Inspector:UX] ${category} score=${score}`);
  });

  ipcMain.on('inspector:reportError', (_event, { source, message, stack }) => {
    errorLog.push({ source, message, stack: stack || null, timestamp: new Date().toISOString() });
    console.error(`[Inspector:Error] ${source}: ${message}`);
  });

  // ── Interaction Timestamp (Pillar 2) ──

  ipcMain.on('inspector:reportInteraction', (_event, { timestamp }) => {
    lastInteractionTimestamp = timestamp;
  });

  // ── Layout Shift (Pillar 3) ──

  ipcMain.on('inspector:layoutShift', (_event, { shiftValue }) => {
    captureLayoutShift(shiftValue);
  });

  // ── Axe-core Results (Pillar 3) ──

  // ── Workflow Intelligence (Pillar 5) ──

  ipcMain.on('inspector:reportWorkflow', (_event, { type, data }) => {
    const entry = { ...data, timestamp: new Date().toISOString() };

    if (type === 'workflow_completed') {
      completedWorkflows.push(entry);
      console.log(`[Inspector:Workflow] ✓ ${data.workflowType} completed in ${data.duration}s`);
    }
    if (type === 'workflow_abandoned') {
      abandonedWorkflows.push(entry);
      uxLog.push({
        category: 'workflow_abandonment',
        score: 0,
        element: null,
        note: `WORKFLOW_ABANDONMENT: ${data.workflowType} abandoned at step ${data.lastCompletedStep}`,
        timestamp: entry.timestamp,
      });
      console.warn(`[Inspector:Workflow] ⚠ WORKFLOW_ABANDONMENT: ${data.workflowType} abandoned at ${data.lastCompletedStep}`);
    }
    if (type === 'workflow_slow') {
      slowWorkflows.push(entry);
      uxLog.push({
        category: 'slow_workflow',
        score: Math.round(data.duration / 60),
        element: null,
        note: `SLOW_WORKFLOW: ${data.workflowType} took ${data.duration}s (threshold ${data.threshold}s)`,
        timestamp: entry.timestamp,
      });
      console.warn(`[Inspector:Workflow] ⚠ SLOW_WORKFLOW: ${data.workflowType} took ${data.duration}s (max ${data.threshold}s)`);
    }
    if (type === 'navigation_confusion') {
      navigationConfusion.push(entry);
      uxLog.push({
        category: 'navigation_confusion',
        score: data.backtrackCount,
        element: null,
        note: `NAVIGATION_CONFUSION: ${data.workflowType} backtracks=${data.backtrackCount}`,
        timestamp: entry.timestamp,
      });
      console.warn(`[Inspector:Workflow] ⚠ NAVIGATION_CONFUSION: ${data.workflowType} backtracks=${data.backtrackCount}`);
    }
    if (type === 'concurrent_patient') {
      concurrentPatientSessions.push(entry);
      complianceLog.push({
        standard: 'HIPAA',
        check: 'CONCURRENT_PATIENT_SESSION',
        passed: false,
        details: JSON.stringify(entry),
        timestamp: entry.timestamp,
      });
      console.warn(`[Inspector:Workflow] ⚠ CONCURRENT_PATIENT_SESSION: Patient ${data.patientID} open in ${data.tabCount} tabs`);
    }
  });

  ipcMain.on('inspector:reportAxeResults', (_event, results) => {
    if (results) {
      accessibilityAudit.score = results.score;
      accessibilityAudit.totalViolations = results.totalViolations;
      accessibilityAudit.criticalViolations = results.criticalViolations || [];
      accessibilityAudit.seriousViolations = results.seriousViolations || [];
      accessibilityAudit.moderateViolations = results.moderateViolations || [];
      accessibilityAudit.url = results.url;
      accessibilityAudit.timestamp = results.timestamp;
      console.log(`[Inspector:Axe] Scan complete: ${results.totalViolations} violations (${(results.criticalViolations || []).length} critical, ${(results.seriousViolations || []).length} serious)`);
    }
  });

  // ── On-demand axe-core trigger (Pillar 3) ──

  ipcMain.handle('inspector:runAxe', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      injectAxeScanner(true);
      return { success: true };
    }
    return { success: false, error: 'No active window' };
  });

  // ── Tracing IPC ──

  ipcMain.handle('inspector:startTrace', async () => { await startTrace(); return { success: true }; });
  ipcMain.handle('inspector:stopTrace', async () => { const tracePath = await stopTrace(); return { success: !!tracePath, tracePath }; });
  ipcMain.handle('inspector:getTraceStatus', async () => { return { traceActive }; });

  // ── Report generation ──

  ipcMain.handle('inspector:generateReport', async () => {
    try {
      const { ReportAggregator } = require('./reporting');
      const aggregator = new ReportAggregator(
        metricsLog, complianceLog, uxLog, errorLog,
        performanceCoreWebVitals, performanceLongTasks, performanceMemorySnapshots,
        performanceTraceFilePath, REPORTS_DIR,
        // Pillar 2
        fhirViolations, phiStorageFlags, phiUnencryptedTransmissions,
        jciIpsg1Violations, autoLogoffViolations, longestInactivity, AUTOLOGOFF_TIMEOUT_MS,
        // Pillar 3
        rageClicks, deadClicks, layoutShifts, accessibilityAudit,
        // Pillar 4
        consoleErrors, consoleWarnings, rendererCrashes,
        sessionStartTime, process.versions.electron, TARGET_URL,
        // Pillar 5
        completedWorkflows, abandonedWorkflows, slowWorkflows,
        navigationConfusion, concurrentPatientSessions
      );
      const filePath = aggregator.generateReport();
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Live status ──

  ipcMain.handle('inspector:getLogCounts', async () => {
    return { metrics: metricsLog.length, compliance: complianceLog.length, ux: uxLog.length, errors: errorLog.length };
  });

  ipcMain.handle('inspector:getComplianceCounts', async () => {
    return {
      fhirViolations: fhirViolations.length, phiUnencryptedTransmissions: phiUnencryptedTransmissions.length,
      phiStorageFlags: phiStorageFlags.length, jciViolations: jciIpsg1Violations.length,
      autoLogoffViolations: autoLogoffViolations.length,
    };
  });

  ipcMain.handle('inspector:getUXCounts', async () => {
    return {
      rageClicks: rageClicks.length, deadClicks: deadClicks.length,
      layoutShifts: layoutShifts.length, accessibilityViolations: accessibilityAudit.totalViolations,
    };
  });

  ipcMain.handle('inspector:getTelemetryCounts', async () => {
    return {
      consoleErrors: consoleErrors.length,
      consoleWarnings: consoleWarnings.length,
      rendererCrashes: rendererCrashes.length,
    };
  });

  ipcMain.handle('inspector:getWorkflowCounts', async () => {
    return {
      completedWorkflows: completedWorkflows.length,
      abandonedWorkflows: abandonedWorkflows.length,
      slowWorkflows: slowWorkflows.length,
      navigationConfusion: navigationConfusion.length,
      concurrentPatientSessions: concurrentPatientSessions.length,
    };
  });

  ipcMain.handle('inspector:getSummaryScores', async () => {
    const complianceScore = _computeComplianceScore();
    const uxScore = _computeUXScore();
    const perfScore = _computePerformanceScore();
    return { complianceScore, uxScore, performanceScore: perfScore };
  });

  // ── Window controls ──

  ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window:maximize', () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); } });
  ipcMain.on('window:close', () => { if (mainWindow) mainWindow.close(); });
}

// ──────────────────────────────────────────────
// Scoring helpers
// ──────────────────────────────────────────────

function _computeComplianceScore() {
  let score = 100;
  score -= fhirViolations.length * 20;
  score -= phiStorageFlags.length * 30;
  score -= jciIpsg1Violations.length * 25;
  score -= phiUnencryptedTransmissions.length * 30;
  score -= autoLogoffViolations.length * 20;
  score -= concurrentPatientSessions.length * 20;
  return Math.max(0, Math.min(100, score));
}

function _computeUXScore() {
  let score = 100;
  score -= rageClicks.length * 10;
  score -= deadClicks.length * 5;
  score -= layoutShifts.filter(s => s.isSignificant).length * 15;
  score -= (accessibilityAudit.criticalViolations || []).length * 10;
  score -= (accessibilityAudit.seriousViolations || []).length * 5;
  score -= abandonedWorkflows.length * 15;
  score -= navigationConfusion.length * 10;
  return Math.max(0, Math.min(100, score));
}

function _computePerformanceScore() {
  let score = 100;
  // LCP > 2500ms
  if (performanceCoreWebVitals.LCP && performanceCoreWebVitals.LCP.value > 2500) {
    score -= 10;
  }
  // Long tasks > 100ms
  const longSlowTasks = performanceLongTasks.filter(t => t.duration > 100);
  score -= longSlowTasks.length * 5;
  // Memory leak warnings
  let memoryLeakCount = 0;
  for (const snap of performanceMemorySnapshots) {
    for (const proc of snap.processes) {
      if (proc.flag === 'MEMORY_LEAK_WARNING') memoryLeakCount++;
    }
  }
  score -= memoryLeakCount * 15;
  return Math.max(0, Math.min(100, score));
}

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  ensureReportsDir();
  loadFHIRSchema();
  setupIPC();
  createMainWindow();
  sessionStartTime = new Date().toISOString();

  startMemoryMonitoring();
  startTrace();
  setupNetworkInterception();
  startAutoLogoffAudit();

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send('inspector:ready', { reportsDir: REPORTS_DIR, targetUrl: TARGET_URL });

    // Pillar 1
    injectPerformanceObservers();
    // Pillar 2
    injectComplianceScanners();
    // Pillar 3
    injectUXScanners();
    injectAxeScanner();
    // Pillar 5
    injectWorkflowIntelligence();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createMainWindow(); }
  });
});

app.on('window-all-closed', () => {
  stopMemoryMonitoring();
  stopAutoLogoffAudit();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.webContents.debugger.isAttached()) {
        mainWindow.webContents.debugger.detach();
      }
    } catch (_) {}
  }
});
