const { app, BrowserWindow, ipcMain, contentTracing, powerMonitor, session } = require('electron');
const path = require('path');
const fs = require('fs');

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const REPORTS_DIR = path.join(__dirname, 'reports');
const FHIR_SCHEMA_PATH = path.join(__dirname, 'fhir-r4-schema.json');
const TARGET_URL = process.env.INSPECTOR_TARGET_URL || 'https://example.com';
const MEMORY_POLL_MS = 10000;
const MEMORY_LEAK_THRESHOLD_MB = 500;
const TRACE_AUTO_STOP_MS = 30000;
const AUTOLOGOFF_TIMEOUT_MS = 15 * 60 * 1000;   // 15 minutes
const IDLE_POLL_MS = 5000;                        // Check idle every 5s
const STORAGE_SCAN_DELAY_MS = 1500;               // Delay after load for storage scan

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

// ── Tracing state ──
let traceActive = false;
let traceAutoStopTimer = null;

// ── Memory monitoring timer ──
let memoryTimer = null;

// ── Auto-logoff timer ──
let idleTimer = null;

// ── FHIR Schema (lazy-loaded) ──
let fhirSchema = null;
let ajvValidator = null;

// ── FHIR resource type lowercase set for Content-Type fallback matching ──
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ──────────────────────────────────────────────
// FHIR R4 Schema Loading
// ──────────────────────────────────────────────

function loadFHIRSchema() {
  try {
    if (!fs.existsSync(FHIR_SCHEMA_PATH)) {
      console.warn('[Inspector:FHIR] Schema file not found at', FHIR_SCHEMA_PATH);
      return false;
    }
    const schemaData = fs.readFileSync(FHIR_SCHEMA_PATH, 'utf-8');
    fhirSchema = JSON.parse(schemaData);

    // Dynamic import of ajv
    try {
      const Ajv = require('ajv');
      const ajv = new Ajv({
        allErrors: true,
        verbose: false,
        strict: false,
        validateSchema: false,
      });
      // Register custom formats used in FHIR schema
      ajv.addFormat('uri', true);           // Accept any string as uri
      ajv.addFormat('date-time', true);     // Accept any string as date-time
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

/**
 * Validate a JSON response body against FHIR R4 schema
 * @param {string} url
 * @param {string} bodyText - raw response body text
 * @returns {Array} violations found
 */
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

  // 1. Check resourceType exists
  if (!parsed.resourceType) {
    violations.push({
      url,
      timestamp: new Date().toISOString(),
      errorType: 'MISSING_RESOURCE_TYPE',
      errorDetails: 'FHIR resource is missing required "resourceType" field',
    });
    return violations;
  }

  // 2. Check resourceType is valid FHIR R4
  if (!FHIR_RESOURCE_TYPES.has(parsed.resourceType.toLowerCase())) {
    violations.push({
      url,
      timestamp: new Date().toISOString(),
      errorType: 'INVALID_RESOURCE_TYPE',
      errorDetails: `"${parsed.resourceType}" is not a recognized FHIR R4 resource type`,
    });
  }

  // 3. AJV schema validation (if available)
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

  // 4. Check id pattern
  if (parsed.id !== undefined && typeof parsed.id === 'string') {
    if (!/^[A-Za-z0-9\-\.]{1,64}$/.test(parsed.id)) {
      violations.push({
        url,
        timestamp: new Date().toISOString(),
        errorType: 'FHIR_SCHEMA_VIOLATION',
        errorDetails: `Resource id "${parsed.id}" does not match FHIR id pattern (1-64 alphanumeric, hyphens, dots)`,
      });
    }
  }

  // 5. Check meta.lastUpdated format
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
    if (performanceMemorySnapshots.length > 200) {
      performanceMemorySnapshots.splice(0, performanceMemorySnapshots.length - 200);
    }
  } catch (err) {
    console.error('[Inspector:Memory] Failed to sample memory:', err);
  }
}

// ──────────────────────────────────────────────
// Network Interception — FHIR Validation & PHI Detection (Pillar 2)
// ──────────────────────────────────────────────

function setupNetworkInterception() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // ── session.defaultSession.webRequest: Early PHI detection onBeforeRequest ──
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    const urlLower = details.url.toLowerCase();
    const phiKeywords = ['patient', 'mrn', 'medical', 'emr', 'ehr', 'clinical',
                         'diagnosis', 'sensitive', 'phi', 'hipaa', 'provider',
                         'identifier', 'ssn', 'treatment', 'record'];

    // Flag http:// requests containing PHI keywords (unencrypted transmission)
    if (details.url.startsWith('http://') && phiKeywords.some(kw => urlLower.includes(kw))) {
      const existing = phiUnencryptedTransmissions.find(t => t.url === details.url);
      if (!existing) {
        const entry = {
          url: details.url,
          timestamp: new Date().toISOString(),
          statusCode: null,  // Request not yet completed
          resourceType: details.type || 'unknown',
        };
        phiUnencryptedTransmissions.push(entry);
        complianceLog.push({
          standard: 'HIPAA',
          check: 'PHI_UNENCRYPTED_TRANSMISSION',
          passed: false,
          details: JSON.stringify(entry),
          timestamp: entry.timestamp,
        });
        console.warn(`[Inspector:PHI] ⚠ PHI_UNENCRYPTED_TRANSMISSION (onBeforeRequest) — ${details.url}`);
      }
    }
    callback({ cancel: false });
  });

  // ── CDP Debugger: Response body inspection for FHIR validation ──
  try {
    const dbg = mainWindow.webContents.debugger;

    if (!dbg.isAttached()) {
      dbg.attach('1.3');
    }
    // debugger attached successfully

    dbg.on('message', (_event, method, params) => {
      // ── Detect FHIR responses ──
      if (method === 'Network.responseReceived') {
        const { requestId, response, type } = params;

        // Get Content-Type from multiple possible header keys
        const headers = response.headers || {};
        const contentType =
          headers['content-type'] ||
          headers['Content-Type'] ||
          headers['CONTENT-TYPE'] ||
          '';

        const contentTypeLower = contentType.toLowerCase();

        // ── FHIR Detection ──
        const isFHIR =
          contentTypeLower.includes('application/fhir+json') ||
          (type === 'XHR' && contentTypeLower.includes('json') &&
           (response.url.toLowerCase().includes('/fhir/') ||
            response.url.toLowerCase().includes('/r4/') ||
            response.url.toLowerCase().includes('/patient/') ||
            response.url.toLowerCase().includes('/observation/')));

        if (isFHIR) {
          // Get the response body to validate
          setTimeout(async () => {
            try {
              const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId });
              const bodyText = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

              const violations = validateFHIRResource(response.url, bodyText);
              for (const v of violations) {
                fhirViolations.push(v);
                complianceLog.push({
                  standard: 'FHIR_R4',
                  check: `FHIR_VIOLATION: ${v.errorType} at ${response.url}`,
                  passed: false,
                  details: JSON.stringify(v),
                  timestamp: v.timestamp,
                });
                console.warn(`[Inspector:FHIR] ⚠ ${v.errorType} — ${response.url}: ${v.errorDetails}`);
              }
            } catch (bodyErr) {
              // Body may not be available (redirect, cancelled, etc.)
              if (!bodyErr.message.includes('No resource')) {
                console.warn('[Inspector:Network] Could not get response body:', bodyErr.message);
              }
            }
          }, 100);
        }

        // ── PHI Unencrypted Transmission Detection ──
        if (response.url.startsWith('http://')) {
          const urlLower = response.url.toLowerCase();
          const phiKeywords = ['patient', 'mrn', 'medical', 'emr', 'ehr', 'clinical',
                               'diagnosis', 'sensitive', 'phi', 'hipaa', 'provider',
                               'identifier', 'ssn', 'treatment', 'record'];
          const hasPHIContent = phiKeywords.some(kw => urlLower.includes(kw));

          if (hasPHIContent) {
            const existing = phiUnencryptedTransmissions.find(t => t.url === response.url);
            if (!existing) {
              const entry = {
                url: response.url,
                timestamp: new Date().toISOString(),
                statusCode: response.status,
                resourceType: type,
              };
              phiUnencryptedTransmissions.push(entry);
              complianceLog.push({
                standard: 'HIPAA',
                check: 'PHI_UNENCRYPTED_TRANSMISSION',
                passed: false,
                details: JSON.stringify(entry),
                timestamp: entry.timestamp,
              });
              console.warn(`[Inspector:PHI] ⚠ PHI_UNENCRYPTED_TRANSMISSION — ${response.url}`);
            }
          }
        }

        // ── Detect FHIR response even without explicit Content-Type ──
        // If the URL looks like a FHIR endpoint and the response is JSON
        if (!contentTypeLower.includes('application/fhir+json') && type === 'XHR') {
          const urlLower = response.url.toLowerCase();
          const fhirPattern = /\/(fhir|r4|metadata|patient|observation|condition|encounter|medication|procedure|diagnosticreport|bundle)\b/i;
          if (fhirPattern.test(urlLower)) {
            setTimeout(async () => {
              try {
                const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId });
                const bodyText = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
                // Quick check: does it look like a FHIR resource?
                try {
                  const parsed = JSON.parse(bodyText);
                  if (parsed.resourceType) {
                    const violations = validateFHIRResource(response.url, bodyText);
                    for (const v of violations) {
                      fhirViolations.push(v);
                      complianceLog.push({
                        standard: 'FHIR_R4',
                        check: `FHIR_VIOLATION: ${v.errorType} at ${response.url}`,
                        passed: false,
                        details: JSON.stringify(v),
                        timestamp: v.timestamp,
                      });
                      console.warn(`[Inspector:FHIR] ⚠ ${v.errorType} — ${response.url}: ${v.errorDetails}`);
                    }
                  }
                } catch (_) { /* not JSON, skip */ }
              } catch (_) { /* body unavailable */ }
            }, 100);
          }
        }
      }
    });

    dbg.sendCommand('Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000,
      maxPostDataSize: 5000000,
    });

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

  // Initial check
  checkIdleTime();

  idleTimer = setInterval(checkIdleTime, IDLE_POLL_MS);
}

function stopAutoLogoffAudit() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

function checkIdleTime() {
  try {
    const systemIdleSeconds = powerMonitor.getSystemIdleTime();

    // Time since last clinician interaction (from preload timestamps)
    const interactionMs = lastInteractionTimestamp
      ? Date.now() - lastInteractionTimestamp
      : systemIdleSeconds * 1000;

    // Effective inactivity = max of system idle and time since interaction
    const effectiveInactiveMs = Math.max(
      systemIdleSeconds * 1000,
      interactionMs
    );

    longestInactivity = Math.max(longestInactivity, effectiveInactiveMs);

    if (effectiveInactiveMs > AUTOLOGOFF_TIMEOUT_MS) {
      const excessiveMin = Math.round(effectiveInactiveMs / 60000);

      // Check if we already flagged this duration to avoid duplicates
      const lastViolation = autoLogoffViolations[autoLogoffViolations.length - 1];
      const alreadyFlagged = lastViolation &&
        Math.abs(new Date(lastViolation.timestamp) - Date.now()) < 60000;

      if (!alreadyFlagged) {
        const entry = {
          systemIdleSeconds,
          timeSinceLastInteractionMs: interactionMs,
          effectiveInactiveMs,
          timeoutLimitMs: AUTOLOGOFF_TIMEOUT_MS,
          timestamp: new Date().toISOString(),
        };
        autoLogoffViolations.push(entry);

        complianceLog.push({
          standard: 'HIPAA',
          check: 'AUTOLOGOFF_FAILURE',
          passed: false,
          details: JSON.stringify(entry),
          timestamp: entry.timestamp,
        });
        console.warn(
          `[Inspector:AutoLogoff] ⚠ AUTOLOGOFF_FAILURE: System idle ${excessiveMin}min ` +
          `exceeds ${AUTOLOGOFF_TIMEOUT_MS / 60000}min limit. ` +
          `(systemIdle=${systemIdleSeconds}s, interactionAgo=${Math.round(interactionMs / 1000)}s)`
        );
      }
    }
  } catch (err) {
    if (!err.message.includes('powerMonitor')) {
      console.error('[Inspector:AutoLogoff] Failed to check idle time:', err.message);
    }
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
          className: (el.className && typeof el.className === 'string') ? el.className : ''
        };
      }, true);

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

        window.addEventListener('beforeunload', function() {
          window.inspector.reportMetric('CLS', clsValue, {
            type: 'CoreWebVital', metric: 'CLS', currentURL: window.location.href
          });
        });
      } catch(e) { console.warn('[Inspector] CLS observer not supported', e); }

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
    console.warn('[Inspector] Could not inject perf observers (page not ready):', err.message);
  });
}

// ──────────────────────────────────────────────
// Inject Compliance Scanners into page (Pillar 2)
// ──────────────────────────────────────────────

function injectComplianceScanners() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.executeJavaScript(`
    (function() {
      // Skip if already injected for this page
      if (window.__inspectorComplianceInjected) return;
      window.__inspectorComplianceInjected = true;

      var currentURL = window.location.href;

      // ════════════════════════════════════════
      // 1. Storage PHI Scanner
      // ════════════════════════════════════════

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
          var storeInfo = stores[si];
          var store = storeInfo.store;
          if (!store) continue;

          try {
            for (var ki = 0; ki < store.length; ki++) {
              var key = store.key(ki);
              var value = '';
              try { value = store.getItem(key) || ''; } catch(e) { value = ''; }

              for (var pi = 0; pi < patterns.length; pi++) {
                var pattern = patterns[pi];
                if (pattern.regex.test(value) || pattern.regex.test(key)) {
                  results.push({
                    store: storeInfo.name,
                    key: key,
                    pattern: pattern.name,
                    timestamp: new Date().toISOString()
                  });
                }
              }
            }
          } catch(e) {
            console.warn('[Inspector] Storage scan error:', e.message);
          }
        }

        for (var ri = 0; ri < results.length; ri++) {
          window.inspector.reportCompliance('HIPAA',
            'PHI_IN_STORAGE: ' + results[ri].pattern + ' found in ' + results[ri].store + '[' + results[ri].key + ']',
            false,
            JSON.stringify(results[ri]));
        }

        return results;
      }

      // ════════════════════════════════════════
      // 2. JCI IPSG-1 Patient Identifier Check
      // ════════════════════════════════════════

      var lastJCIReportKey = null;

      function checkPatientIdentifiers() {
        var body = document.body;
        if (!body) return;

        var text = (body.innerText || body.textContent || '').substring(0, 10000);
        var url = window.location.href;
        var title = document.title;

        // Check if we're on a patient-related page
        var isPatientPage = /patient|emr|ehr|chart|record|medical|clinical|encounter/i.test(url) ||
                            /patient|emr|ehr|chart|record|medical|clinical|encounter/i.test(title);

        if (!isPatientPage) return;

        var identifiersFound = 0;
        var identifierTypes = [];

        // Full Name pattern (two or more capitalized words)
        if (/[A-Z][a-z]+\\s+[A-Z][a-z]+/.test(text)) {
          identifiersFound++;
          identifierTypes.push('Full Name');
        }

        // MRN pattern
        if (/\\bMRN[-:]?\\s*\\d{4,12}\\b/i.test(text)) {
          identifiersFound++;
          identifierTypes.push('MRN');
        }

        // DOB pattern
        if (/\\b\\d{2}[\\/\\-]\\d{2}[\\/\\-]\\d{4}\\b/.test(text)) {
          identifiersFound++;
          identifierTypes.push('Date of Birth');
        }

        // Patient ID pattern
        if (/\\bPatient\\s*ID\\b|\\bPID[-:]\\s*\\w+\\b/i.test(text) || /\\b\\d{6,10}\\b/.test(text)) {
          identifiersFound++;
          identifierTypes.push('Patient ID');
        }

        if (identifiersFound > 0 && identifiersFound < 2) {
          var checkKey = url + '|' + identifiersFound;
          if (checkKey !== lastJCIReportKey) {
            lastJCIReportKey = checkKey;
            window.inspector.reportCompliance('JCI',
              'JCI_IPSG1_VIOLATION: Only ' + identifiersFound + ' patient identifier(s) visible (' + identifierTypes.join(', ') + ')',
              false,
              JSON.stringify({ url: url, identifiersFound: identifiersFound, identifierTypes: identifierTypes }));
          }
        }
      }

      // ════════════════════════════════════════
      // 3. Clinician Interaction Timestamps
      // ════════════════════════════════════════

      var interactionThrottleTimer = null;

      function sendInteractionTimestamp() {
        window.inspector.reportInteraction(Date.now());
      }

      document.addEventListener('mousemove', function() {
        if (!interactionThrottleTimer) {
          interactionThrottleTimer = setTimeout(function() {
            interactionThrottleTimer = null;
            sendInteractionTimestamp();
          }, 5000);
        }
      }, { passive: true });

      document.addEventListener('keydown', function() {
        if (!interactionThrottleTimer) {
          interactionThrottleTimer = setTimeout(function() {
            interactionThrottleTimer = null;
            sendInteractionTimestamp();
          }, 5000);
        }
      }, { passive: true });

      // ════════════════════════════════════════
      // 4. Run initial scans
      // ════════════════════════════════════════

      // Run PHI storage scan after a short delay to let page data load
      setTimeout(function() {
        scanStorageForPHI();
      }, 1500);

      // Re-scan storage when other tabs modify it
      window.addEventListener('storage', function(e) {
        // Debounce: re-scan storage after a write from another tab/window
        setTimeout(scanStorageForPHI, 500);
      });

      // Setup JCI IPSG-1 MutationObserver on the body
      var jciCheckTimer = null;
      function debouncedJCICheck() {
        if (jciCheckTimer) clearTimeout(jciCheckTimer);
        jciCheckTimer = setTimeout(checkPatientIdentifiers, 2000);
      }

      // Check on initial load
      setTimeout(checkPatientIdentifiers, 2000);

      // Observe DOM mutations for dynamic content
      try {
        var bodyObserver = new MutationObserver(function() {
          debouncedJCICheck();
        });
        if (document.body) {
          bodyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        } else {
          // Wait for body to exist
          var bodyReadyCheck = setInterval(function() {
            if (document.body) {
              bodyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
              clearInterval(bodyReadyCheck);
            }
          }, 200);
        }
      } catch(e) {
        console.warn('[Inspector] JCI MutationObserver setup error:', e.message);
      }

      // Handle SPA navigation via history API
      var pushState = history.pushState;
      history.pushState = function() {
        pushState.apply(this, arguments);
        window.__inspectorComplianceInjected = false;
      };
      var replaceState = history.replaceState;
      history.replaceState = function() {
        replaceState.apply(this, arguments);
        window.__inspectorComplianceInjected = false;
      };
    })();
  `).catch(function(err) {
    console.warn('[Inspector] Could not inject compliance scanners:', err.message);
  });
}

// ──────────────────────────────────────────────
// IPC Handlers
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

    const meta = metadata || {};
    if (meta.type === 'CoreWebVital') {
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
    const entry = {
      standard,
      check,
      passed,
      details: details || '',
      timestamp: new Date().toISOString(),
    };
    complianceLog.push(entry);

    // Route to specialized compliance stores
    const detailsObj = (() => { try { return JSON.parse(details || '{}'); } catch(e) { return {}; } })();

    if (check.startsWith('PHI_IN_STORAGE')) {
      phiStorageFlags.push({
        key: detailsObj.key || 'unknown',
        pattern: detailsObj.pattern || 'unknown',
        store: detailsObj.store || 'unknown',
        timestamp: entry.timestamp,
      });
    }

    if (check.startsWith('JCI_IPSG1_VIOLATION')) {
      jciIpsg1Violations.push({
        url: detailsObj.url || '',
        timestamp: entry.timestamp,
        identifiersFound: detailsObj.identifiersFound || 0,
        identifierTypes: detailsObj.identifierTypes || [],
      });
    }

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

  // ── Clinician Interaction Timestamp (from preload) ──

  ipcMain.on('inspector:reportInteraction', (_event, { timestamp }) => {
    lastInteractionTimestamp = timestamp;
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
        REPORTS_DIR,
        // Pillar 2 compliance data
        fhirViolations,
        phiStorageFlags,
        phiUnencryptedTransmissions,
        jciIpsg1Violations,
        autoLogoffViolations,
        longestInactivity,
        AUTOLOGOFF_TIMEOUT_MS
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

  // ── Compliance counts ──

  ipcMain.handle('inspector:getComplianceCounts', async () => {
    return {
      fhirViolations: fhirViolations.length,
      phiUnencryptedTransmissions: phiUnencryptedTransmissions.length,
      phiStorageFlags: phiStorageFlags.length,
      jciViolations: jciIpsg1Violations.length,
      autoLogoffViolations: autoLogoffViolations.length,
    };
  });

  // ── Window controls ──

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

  // Load FHIR R4 schema for validation
  loadFHIRSchema();

  setupIPC();
  createMainWindow();

  // Start Pillar 1 features
  startMemoryMonitoring();
  startTrace();

  // Start Pillar 2 features
  setupNetworkInterception();
  startAutoLogoffAudit();

  // On page load
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send('inspector:ready', {
      reportsDir: REPORTS_DIR,
      targetUrl: TARGET_URL,
    });

    // Inject Pillar 1: PerformanceObservers
    injectPerformanceObservers();

    // Inject Pillar 2: Compliance scanners
    injectComplianceScanners();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopMemoryMonitoring();
  stopAutoLogoffAudit();
  if (process.platform !== 'darwin') app.quit();
});

// Cleanup debugger on quit
app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.webContents.debugger.isAttached()) {
        mainWindow.webContents.debugger.detach();
      }
    } catch (_) {}
  }
});
