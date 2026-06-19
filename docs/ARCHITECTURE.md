# Technical Architecture

## System Architecture

Inspector is built on Electron's three-process security model, leveraging `contextIsolation: true` and `nodeIntegration: false` to create a secure, auditable bridge between the Node.js main process and the clinical web application being tested.

### Process Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS (Node.js)                          │
│                                                                         │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐   │
│  │   Window Manager    │    │         IPC Handler Layer            │   │
│  │  - BrowserWindow    │    │  40+ ipcMain.handle/on handlers      │   │
│  │  - Session management│    │  - inspector:reportMetric           │   │
│  │  - Lifecycle hooks  │    │  - inspector:reportCompliance        │   │
│  └─────────────────────┘    │  - inspector:reportUX                │   │
│                              │  - inspector:generateReport          │   │
│  ┌─────────────────────┐    │  - inspector:setNetworkCondition     │   │
│  │   Network Layer     │    │  - inspector:getAPICache             │   │
│  │  - webRequest hooks │    │  - inspector:getTrendCounts          │   │
│  │  - CDP debugger     │    │  - ...and 30+ more                  │   │
│  │  - FHIR interception│    └──────────────────────────────────────┘   │
│  │  - JWT monitoring   │                                              │
│  └─────────────────────┘    ┌──────────────────────────────────────┐   │
│                              │         Data Stores                  │   │
│  ┌─────────────────────┐    │  metricsLog[]   complianceLog[]       │   │
│  │   Audit Engines     │    │  uxLog[]        errorLog[]            │   │
│  │  - Memory monitor   │    │  rageClicks[]   fhirViolations[]      │   │
│  │  - Content tracing  │    │  expiredTokenRequests[]  ...          │   │
│  │  - Auto-logoff      │    │  staleDataFlags[]  ...                │   │
│  │  - Stale data check │    └──────────────────────────────────────┘   │
│  │  - Offline monitor  │                                              │
│  └─────────────────────┘    ┌──────────────────────────────────────┐   │
│                              │     Report Aggregator (reporting.js)  │   │
│                              │  - Score computation                 │   │
│                              │  - JSON report generation            │   │
│                              │  - Heatmap & trend data              │   │
│                              │  - Index management                  │   │
│                              └──────────────────────────────────────┘   │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ contextBridge (contextIsolation: true)
                                    │ nodeIntegration: false
┌───────────────────────────────────┼───────────────────────────────────┐
│                     PRELOAD SCRIPT (preload.js)                        │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                 contextBridge API Contract                        │  │
│  │                                                                   │  │
│  │  // Pillar 1: Performance                                        │  │
│  │  inspector.reportMetric(tag, value, metadata)                    │  │
│  │  inspector.startTrace() → Promise, stopTrace() → Promise         │  │
│  │                                                                   │  │
│  │  // Pillar 2: Compliance                                         │  │
│  │  inspector.reportCompliance(standard, check, passed, details)    │  │
│  │  inspector.reportInteraction(timestamp)                          │  │
│  │                                                                   │  │
│  │  // Pillar 3: UX / Accessibility                                 │  │
│  │  inspector.reportUX(category, score, element, note)               │  │
│  │  inspector.reportLayoutShift(shiftValue)                          │  │
│  │  inspector.reportAxeResults(results)                              │  │
│  │                                                                   │  │
│  │  // Pillar 5: Workflow Intelligence                              │  │
│  │  inspector.reportWorkflowEvent(type, data)                        │  │
│  │  inspector.getWorkflowCounts() → Promise                         │  │
│  │                                                                   │  │
│  │  // Pillar 6: Session Integrity                                  │  │
│  │  inspector.reportSessionEvent(type, data)                         │  │
│  │  inspector.getSessionCounts() → Promise                          │  │
│  │                                                                   │  │
│  │  // Pillar 8: Data Integrity                                     │  │
│  │  inspector.reportDataIntegrity(flag, data)                        │  │
│  │  inspector.getAPICache() → Promise                               │  │
│  │  inspector.getDataIntegrityCounts() → Promise                    │  │
│  │                                                                   │  │
│  │  // Pillar 9: Offline / Resilience                               │  │
│  │  inspector.setNetworkCondition(preset) → Promise                 │  │
│  │  inspector.getCurrentNetworkCondition() → Promise                │  │
│  │  inspector.reportOfflineEvent(type, data)                         │  │
│  │  inspector.getOfflineCounts() → Promise                          │  │
│  │                                                                   │  │
│  │  // Pillar 10: Trends                                            │  │
│  │  inspector.getTrendCounts() → Promise                             │  │
│  │                                                                   │  │
│  │  // Cross-cutting                                               │  │
│  │  inspector.generateReport() → Promise                            │  │
│  │  inspector.getSummaryScores() → Promise                          │  │
│  │  inspector.getLogCounts() → Promise                              │  │
│  │  inspector.onReady(callback)                                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │
┌───────────────────────────────────┼───────────────────────────────────┐
│                      RENDERER PROCESS (Web Page)                       │
│                                                                        │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  PerformanceObserver         │  │  DOM Scanners                │  │
│  │  - Paint (FP, FCP)          │  │  - PHI storage scan          │  │
│  │  - Largest Contentful Paint │  │  - JCI IPSG-1 check          │  │
│  │  - Layout Shift (CLS)       │  │  - Login/Logout detector     │  │
│  │  - Long Tasks               │  │  - Allergy alert visibility  │  │
│  └──────────────────────────────┘  │  - Form prepopulation check │  │
│                                    └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  Event Wrappers              │  │  Network Observers           │  │
│  │  - Click → rage/dead detect │  │  - Online/offline events     │  │
│  │  - fetch/XHR wrapping       │  │  - ServiceWorker audit       │  │
│  │  - History.pushState        │  │  - Cache storage inspection  │  │
│  │  - MutationObserver         │  │  - Degraded mode detection   │  │
│  └──────────────────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Why `contextIsolation: true` and `nodeIntegration: false`

In a clinical security context, these are non-negotiable:

1. **`contextIsolation: true`** — The renderer process runs in an isolated context separate from the preload script. This means even if the HIS/EMR web application is compromised via XSS, the attacker cannot access the preload script's `require('electron')` or any Node.js APIs.

2. **`nodeIntegration: false`** — Disables `require()` in the renderer entirely. Without this, any JavaScript vulnerability in the EMR could lead to full system compromise.

3. **`contextBridge`** — Creates a safe, typed IPC contract. The renderer only sees exactly what is exposed via `exposeInMainWorld`. Every method is an explicit, auditable, one-way-or-request-response bridge.

---

## Main Process (main.js)

### Responsibilities

- **Window lifecycle management** — Creating, tracking, and destroying BrowserWindow instances
- **Network interception** — Using both `session.defaultSession.webRequest` and Chrome DevTools Protocol debugger to intercept all HTTP/HTTPS traffic
- **Data storage** — Maintaining all audit data in memory (arrays and Maps) throughout the session
- **IPC handler registration** — Exposing 40+ IPC handlers for renderer communication
- **Timer-based monitoring** — Memory sampling (10s), auto-logoff check (5s), stale data detection (60s), offline state check (5s)
- **Content tracing** — Chromium tracing lifecycle (start/stop)
- **Report generation** — Coordinating the ReportAggregator to produce the final JSON report
- **File system I/O** — Writing reports, screenshots, trace files, heatmaps, trend data, and the session index

### IPC Handlers — Complete List

| Channel Name | Direction | Sender | Receiver | Purpose |
|---|---|---|---|---|
| `inspector:reportMetric` | 🡑 send | Renderer | Main | Performance metric from observers |
| `inspector:reportCompliance` | 🡑 send | Renderer | Main | Compliance check result |
| `inspector:reportUX` | 🡑 send | Renderer | Main | UX event (rage-click, dead-click) |
| `inspector:reportError` | 🡑 send | Renderer | Main | Custom error event |
| `inspector:reportInteraction` | 🡑 send | Renderer | Main | User interaction timestamp |
| `inspector:layoutShift` | 🡑 send | Renderer | Main | CLS value for screenshot capture |
| `inspector:reportWorkflow` | 🡑 send | Renderer | Main | Workflow event |
| `inspector:getWorkflowCounts` | 🡓 invoke | Renderer | Main | Workflow counter snapshot |
| `inspector:reportAxeResults` | 🡑 send | Renderer | Main | axe-core audit results |
| `inspector:reportSessionEvent` | 🡑 send | Renderer | Main | Session integrity event |
| `inspector:getSessionCounts` | 🡓 invoke | Renderer | Main | Session integrity counter snapshot |
| `inspector:reportDataIntegrity` | 🡑 send | Renderer | Main | Data integrity flag |
| `inspector:getAPICache` | 🡓 invoke | Renderer | Main | API response cache for rendering verification |
| `inspector:getDataIntegrityCounts` | 🡓 invoke | Renderer | Main | Data integrity counter snapshot |
| `inspector:setNetworkCondition` | 🡓 invoke | Renderer | Main | Apply network preset via CDP |
| `inspector:getCurrentNetworkCondition` | 🡓 invoke | Renderer | Main | Current network preset name |
| `inspector:reportOfflineEvent` | 🡑 send | Renderer | Main | Offline/resilience event |
| `inspector:getOfflineCounts` | 🡓 invoke | Renderer | Main | Offline counter snapshot |
| `inspector:offlineDetected` | 🡑 send | Renderer | Main | Browser went offline |
| `inspector:onlineRestored` | 🡑 send | Renderer | Main | Browser came back online |
| `inspector:getApiHealthCounts` | 🡓 invoke | Renderer | Main | API health counter snapshot |
| `inspector:generateReport` | 🡓 invoke | Renderer | Main | Trigger report generation |
| `inspector:getLogCounts` | 🡓 invoke | Renderer | Main | Performance log counter |
| `inspector:getComplianceCounts` | 🡓 invoke | Renderer | Main | Compliance log counter |
| `inspector:getUXCounts` | 🡓 invoke | Renderer | Main | UX log counter |
| `inspector:getTelemetryCounts` | 🡓 invoke | Renderer | Main | Telemetry counter snapshot |
| `inspector:getSummaryScores` | 🡓 invoke | Renderer | Main | Current compliance/UX/performance scores |
| `inspector:startTrace` | 🡓 invoke | Renderer | Main | Start Chromium content tracing |
| `inspector:stopTrace` | 🡓 invoke | Renderer | Main | Stop content tracing |
| `inspector:getTraceStatus` | 🡓 invoke | Renderer | Main | Whether tracing is active |
| `inspector:getTrendCounts` | 🡓 invoke | Renderer | Main | Longitudinal trend counter |
| `inspector:ready` | 🡑 send | Main | Renderer | Session initialized |
| `metrics:getProcessInfo` | 🡓 invoke | Renderer | Main | Process memory/CPU/IO metrics |
| `window:minimize` | 🡑 send | Renderer | Main | Minimize BrowserWindow |
| `window:maximize` | 🡑 send | Renderer | Main | Maximize BrowserWindow |
| `window:close` | 🡑 send | Renderer | Main | Close BrowserWindow |

### WebRequest Hooks

Inspector uses three `session.defaultSession.webRequest` hooks:

1. **`onBeforeRequest`** — Intercepts all HTTP/HTTPS traffic. Detects unencrypted HTTP requests containing PHI-related keywords. Tracks request start times for API performance monitoring. Maps third-party dependencies.

2. **`onBeforeSendHeaders`** — Intercepts outgoing request headers. Parses JWT Bearer tokens from `Authorization` headers. Checks token expiry, concurrent session anomalies, privilege scope, and re-authentication audit.

3. **`onCompleted`** — Processes completed requests. Calculates response times, detects SLA breaches (clinical >2s, non-clinical >5s), monitors error rates (rolling window of 20 requests), detects silent failures (API error with no visible DOM error UI), and tracks third-party dependency health.

### Memory Monitoring Loop

- **Interval:** 10 seconds (`MEMORY_POLL_MS`)
- **Threshold:** 500MB per-process private memory (`MEMORY_LEAK_THRESHOLD_MB`)
- **Data:** Captures `processType`, `pid`, `privateMemory`, `workingSet`, `cpuPercent` for every Electron process
- **Max snapshots:** 200 (capped to prevent unbounded memory growth)
- **Flagging:** If any process exceeds 500MB private memory, flags `MEMORY_LEAK_WARNING`

### Content Tracing

- **Categories:** `v8`, `blink`, `cc`, `gpu`, `disabled-by-default-v8.gc`
- **Auto-stop:** 30 seconds (`TRACE_AUTO_STOP_MS`)
- **Output:** Chrome DevTools trace format JSON in `/reports/trace-[timestamp].json`

### Session Management

- Uses `session.defaultSession` for all network interception
- Supports `webviewTag: false` — no embedded webviews
- `sandbox: false` — required for preload script Node.js access (with contextIsolation)

---

## Preload Script (preload.js)

### Purpose

The preload script is the only bridge between the Node.js main process and the untrusted renderer (the HIS/EMR web application). It:

1. **Exposes a typed API** via `contextBridge.exposeInMainWorld('inspector', { ... })`
2. **Translates IPC calls** between renderer send/receive and main process handlers
3. **Auto-initializes network detectors** using IIFEs (Immediately Invoked Function Expressions) for online/offline events and degraded mode detection
4. **Isolates Node.js access** — the renderer cannot require any modules

### What It Cannot Do

- Cannot access `require()` in the renderer context
- Cannot read/write the file system directly
- Cannot access Node.js `process` or `Buffer` APIs
- Cannot access Electron `shell`, `dialog`, or `BrowserWindow` APIs

### contextBridge API Contract — Every Exposed Method

| Method | Signature | Returns | Direction |
|---|---|---|---|
| `reportMetric` | `(tag: string, value: number, metadata: object)` | `void` | 🡑 send |
| `reportCompliance` | `(standard: string, check: string, passed: boolean, details: string)` | `void` | 🡑 send |
| `reportUX` | `(category: string, score: number, element: string, note: string)` | `void` | 🡑 send |
| `reportError` | `(source: string, message: string, stack: string)` | `void` | 🡑 send |
| `reportInteraction` | `(timestamp: number)` | `void` | 🡑 send |
| `reportLayoutShift` | `(shiftValue: number)` | `void` | 🡑 send |
| `reportWorkflowEvent` | `(type: string, data: object)` | `void` | 🡑 send |
| `getWorkflowCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `reportAxeResults` | `(results: object)` | `void` | 🡑 send |
| `reportSessionEvent` | `(type: string, data: object)` | `void` | 🡑 send |
| `getSessionCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `reportDataIntegrity` | `(flag: string, data: object)` | `void` | 🡑 send |
| `getAPICache` | `()` | `Promise<Array>` | 🡓 invoke |
| `getDataIntegrityCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `setNetworkCondition` | `(preset: string)` | `Promise<object>` | 🡓 invoke |
| `getCurrentNetworkCondition` | `()` | `Promise<string>` | 🡓 invoke |
| `reportOfflineEvent` | `(type: string, data: object)` | `void` | 🡑 send |
| `getOfflineCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `getApiHealthCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `generateReport` | `()` | `Promise<string>` | 🡓 invoke |
| `getLogCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `getComplianceCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `getUXCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `getTelemetryCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `getSummaryScores` | `()` | `Promise<object>` | 🡓 invoke |
| `startTrace` | `()` | `Promise<void>` | 🡓 invoke |
| `stopTrace` | `()` | `Promise<string|null>` | 🡓 invoke |
| `getTraceStatus` | `()` | `Promise<boolean>` | 🡓 invoke |
| `getTrendCounts` | `()` | `Promise<object>` | 🡓 invoke |
| `onReady` | `(callback: Function)` | `void` | Listen |
| `minimizeWindow` | `()` | `void` | 🡑 send |
| `maximizeWindow` | `()` | `void` | 🡑 send |
| `closeWindow` | `()` | `void` | 🡑 send |

### PerformanceObserver Instances

| Observer | Observes | Reports to | Purpose |
|---|---|---|---|
| `Paint` | `'paint'` type | `reportMetric('FP', ...)`, `reportMetric('FCP', ...)` | First Paint and First Contentful Paint |
| `LCP` | `'largest-contentful-paint'` | `reportMetric('LCP', ...)` | Largest Contentful Paint |
| `CLS` | `'layout-shift'` | `reportMetric('CLS_ongoing', ...)`, `reportLayoutShift(...)` | Cumulative Layout Shift (ongoing and final) |
| `Long Tasks` | `'longtask'` | `reportMetric('LongTask', ...)` | Long tasks >50ms |

### MutationObserver Usage

| Observer | Target | Callback | Purpose |
|---|---|---|---|
| JCI IPSG-1 | `document.body` | Debounced `checkPatientIdentifiers()` | Re-check patient identifiers on DOM changes |
| UX (shared) | `document.body` | Updates `lastMutationTime` | Dead-click detection (no mutation after click = dead click) |
| Login/Logout | `document.body` | `scanForLoginUI()`, `scanForLogoutUI()` | Detect login form/logout page appearance |

### Event Listeners

| Event | Handler | Throttle | Purpose |
|---|---|---|---|
| `mousemove` | `sendInteractionTimestamp()` | 5s | Update last interaction time for auto-logoff |
| `keydown` | `sendInteractionTimestamp()` | 5s | Update last interaction time for auto-logoff |
| `click` (capture) | Rage-click + dead-click detectors | None | UX event detection |
| `offline` | Send `inspector:offlineDetected` | None | Track offline transitions |
| `online` | Send `inspector:onlineRestored` with duration | None | Track online restoration |
| `popstate` | Re-run all scanners | 2s delay | SPA navigation detection |
| `hashchange` | Workflow navigation tracker | None | SPA hash routing |
| `beforeunload` | Final CLS report, BroadcastChannel cleanup | None | Session cleanup |
| `storage` | Re-scan storage for PHI | 500ms | Cross-tab PHI detection |

### IPC Send Events — Complete Payload Schemas

| Event | Payload Schema |
|---|---|
| `inspector:reportMetric` | `{ tag: string, value: number, metadata: object }` |
| `inspector:reportCompliance` | `{ standard: string, check: string, passed: boolean, details: string }` |
| `inspector:reportUX` | `{ category: string, score: number, element: string, note: string }` |
| `inspector:reportError` | `{ source: string, message: string, stack: string }` |
| `inspector:reportInteraction` | `{ timestamp: number }` |
| `inspector:layoutShift` | `{ shiftValue: number }` |
| `inspector:reportWorkflow` | `{ type: string, data: object }` |
| `inspector:reportAxeResults` | `{ score, totalViolations, criticalViolations, seriousViolations, moderateViolations, url, timestamp }` |
| `inspector:reportSessionEvent` | `{ type: string, data: object }` |
| `inspector:reportDataIntegrity` | `{ flag: string, data: object }` |
| `inspector:reportOfflineEvent` | `{ type: string, data: object }` |
| `inspector:offlineDetected` | `{ timestamp: number }` |
| `inspector:onlineRestored` | `{ timestamp: number, outageDuration: number }` |

---

## Report Aggregator (reporting.js)

The `ReportAggregator` class is instantiated in `main.js` when `generateReport` is called. It receives all audit data stores as constructor arguments.

### Class Methods

| Method | Purpose | Returns |
|---|---|---|
| `generateReport()` | Produce the complete unified JSON report | File path (string) |
| `generateHeatmapData()` | Cluster rage/dead clicks within 40px and write heatmap file | File path or null |
| `generateTrendData()` | Produce trend chart data from session index | File path or null |
| `_calcComplianceScore()` | Compute 0-100 compliance score with deductions | Number |
| `_calcUXScore()` | Compute 0-100 UX score with deductions | Number |
| `_calcPerformanceScore()` | Compute 0-100 performance score with deductions | Number |
| `_extractCriticalFlags()` | Build deduplicated critical flags array from all stores | Array |
| `_clusterPoints(points)` | Cluster coordinate points within 40px radius | Array |
| `_countLeakWarnings()` | Count memory leak warnings across all snapshots | Number |
| `_summarizeMetrics()` | Aggregate metrics by tag with avg/min/max | Object |
| `_summarizeCompliance()` | Compute pass/fail rates | Object |
| `_groupByStandard()` | Group compliance checks by standard (HIPAA, JCI, FHIR) | Object |
| `_summarizeUX()` | Aggregate UX scores | Object |
| `_groupByUXCategory()` | Group UX by category | Object |
| `_summarizeErrors()` | Aggregate errors by source | Object |
| `_groupByErrorSource()` | Group errors by source | Object |
| `_summarizeFHIRViolations()` | Group FHIR violations by error type | Object |
| `_groupByPHIPattern()` | Group PHI flags by pattern type | Object |
| `_groupByPHIStore()` | Group PHI flags by storage type | Object |

### Scoring Algorithm

**Compliance Score** (base: 100):

| Deduction | Amount | Trigger |
|---|---|---|
| FHIR schema violations | -20 each | Resource fails AJV validation |
| PHI in browser storage | -30 each | Pattern match in localStorage/sessionStorage |
| JCI IPSG-1 violations | -25 each | <2 patient identifiers visible |
| PHI unencrypted transmission | -30 each | HTTP transmission containing PHI keywords |
| Auto-logoff violations | -20 each | Idle time exceeds 15-minute threshold |
| Concurrent patient sessions | -20 each | Same patient open in multiple tabs |
| Expired token requests | -30 each | JWT token already expired |
| Concurrent session anomalies | -40 each | Same token from multiple user agents |
| Privilege scope exceeded | -35 each | Role accesses unauthorized resource types |
| Re-authentication bypassed | -50 each | Session resumes after logoff without re-auth |
| Silent failures | -25 each | API error with no error UI shown |
| High error rate endpoints | -20 each | >10% error rate on clinical endpoints |
| Allergy alert not visible | -40 each | Allergy element outside viewport |
| Value truncated | -30 each | Lab value ends with truncated decimal |
| Form prepopulation mismatch | -35 each | Patient data doesn't match DOM |
| Offline warning missing | -20 each | No offline warning shown after 5s |
| Reconnection sync failure | -25 each | No data refresh after reconnect |

**UX Score** (base: 100):

| Deduction | Amount | Trigger |
|---|---|---|
| Rage clicks | -10 each | 3+ rapid clicks within 40px/500ms |
| Dead clicks | -5 each | No response within 800ms of click |
| Significant layout shifts | -15 each | >5% pixel diff in screenshot |
| Critical a11y violations | -10 each | axe-core critical impact |
| Serious a11y violations | -5 each | axe-core serious impact |
| Abandoned workflows | -15 each | Workflow not completed |
| Navigation confusion | -10 each | Repeated page revisits |

**Performance Score** (base: 100):

| Deduction | Amount | Trigger |
|---|---|---|
| LCP > 2500ms | -10 | Largest Contentful Paint exceeds threshold |
| Long tasks > 100ms | -5 each | Tasks blocking main thread |
| Memory leak warnings | -15 each | Process exceeds 500MB private memory |
| Clinical SLA breaches | -15 each | Clinical endpoint > 2000ms |
| Non-clinical SLA breaches | -5 each | Non-clinical endpoint > 5000ms |
| Stale data flags | -10 each | Data not refreshed within threshold |
| Degraded mode freezes | -15 each | Request >10s without loading indicator |

### File Naming Convention

| File Pattern | Example | Content |
|---|---|---|
| `inspector-report-{ts}.json` | `inspector-report-2026-06-19T10-30-00-000Z.json` | Complete unified audit report |
| `trace-{ts}.json` | `trace-2026-06-19T10-30-00-000Z.json` | Chromium content tracing |
| `shift-{ts}.png` | `shift-2026-06-19T10-30-00-000Z.png` | Layout shift screenshot |
| `heatmap-{ts}.json` | `heatmap-2026-06-19T10-30-00-000Z.json` | Clustered click coordinates |
| `trends-{ts}.json` | `trends-2026-06-19T10-30-00-000Z.json` | Cross-session trend data |
| `index.json` | `index.json` | Session history index |

---

## Data Flow Diagrams

### Performance Data Flow

```
Renderer (PerformanceObserver)
  │
  │  observer.observe({ type: 'paint' })  →  entry.startTime
  │  observer.observe({ type: 'largest-contentful-paint' })  →  entry.startTime
  │  observer.observe({ type: 'layout-shift' })  →  entry.value
  │  observer.observe({ type: 'longtask' })  →  entry.duration
  │
  ▼
window.inspector.reportMetric(tag, value, metadata)
  │
  ▼
preload.js → ipcRenderer.send('inspector:reportMetric', ...)
  │
  ▼
main.js → ipcMain.on('inspector:reportMetric')
  │  stores in: metricsLog[], performanceCoreWebVitals{}, performanceLongTasks[]
  │
  ▼
ReportAggregator.generateReport()
  │  reads: coreWebVitals, longTasks, memorySnapshots, traceFilePath
  │
  ▼
/reports/inspector-report-{ts}.json
```

### Compliance Data Flow

```
Renderer (DOM Scanner via injectComplianceScanners)
  │
  │  scanStorageForPHI() → detects patterns in localStorage/sessionStorage
  │  checkPatientIdentifiers() → counts identifiers in DOM
  │  injectLoginLogoutDetector() → detects login/logout forms
  │
  ▼
window.inspector.reportCompliance(standard, check, passed, details)
  │
  ▼
preload.js → ipcRenderer.send('inspector:reportCompliance', ...)
  │
  ▼
Main Process (multiple sources):
  ├── Network Interception (webRequest.onBeforeRequest) → PHI unencrypted
  ├── Network Interception (webRequest.onBeforeSendHeaders) → JWT monitoring
  ├── CDP Debugger (Network.responseReceived) → FHIR validation
  ├── Auto-logoff timer (powerMonitor) → idle violations
  │
  ▼
complianceLog[] → ReportAggregator → report
```

### UX Data Flow

```
Renderer (DOM Event Listeners)
  │
  │  Click event (capture phase)
  │    → checkRageClick(): 3+ clicks within 40px/500ms → reportUX('rage_click')
  │    → checkDeadClick(): no DOM mutation within 800ms → reportUX('dead_click')
  │
  │  CLS Observer
  │    → reportLayoutShift(shiftValue) → main.js captures screenshot
  │
  │  axe-core injected
  │    → axe.run(document, ...) → reportAxeResults(results)
  │
  ▼
preload.js → ipcRenderer IPC
  │
  ▼
main.js → stores in: rageClicks[], deadClicks[], layoutShifts[], accessibilityAudit{}
  │
  ▼
ReportAggregator → report
```

### Longitudinal Data Flow

```
Report Generation (main.js)
  │
  ├── Generate unified report JSON ✓
  │
  ├── Load reports/index.json
  │     ├── Compare with previous report → detect regressions (>10 point drops)
  │     ├── Compare critical flags with previous → detect NEW_CRITICAL_ISSUE
  │     ├── Analyze last 5 sessions → PERSISTENT_DEGRADATION (3+ consecutive degrading)
  │
  ├── Save to index.json
  │
  ├── ReportAggregator.generateHeatmapData()
  │     ├── Cluster rage/dead clicks within 40px radius
  │     └── Write /reports/heatmap-{ts}.json
  │
  └── ReportAggregator.generateTrendData()
        ├── Load all sessions from index
        ├── Add current session scores
        ├── Include regressions, degradations, new issues
        └── Write /reports/trends-{ts}.json
```

---

## Security Architecture

### Threat Model

| Threat | Mitigation |
|---|---|
| **XSS in EMR** → Node.js access | `contextIsolation: true` prevents renderer from accessing preload scope. `nodeIntegration: false` prevents require(). |
| **Malicious preload** → System access | Preload is a fixed file, not user-configurable. All IPC handlers validate payloads. |
| **Report data exfiltration** | No network calls made from the main process except loading the target URL. All data stays local. |
| **PHI leakage in logs** | Console logs truncate PHI. Report files are in local `/reports/` directory only. |
| **Third-party script injection** | Only known scripts injected: axe-core (from npm), custom scanner JS. No dynamic eval(). |

### Key Security Properties

1. **`contextIsolation: true`** — Preload script runs in its own JavaScript context. The renderer cannot access:
   - `window.require()` or `window.process`
   - The preload's `require('electron')` or `require('fs')`
   - Any IPC channels not explicitly exposed via `contextBridge`

2. **`nodeIntegration: false`** — HTML pages loaded in the renderer cannot use `require()` or access Node.js APIs. This is the baseline security requirement for Electron applications.

3. **`sandbox: false`** — The preload script requires access to Node.js modules (`electron`, `fs`, `path`). `sandbox: false` is required for this, but the combination of `contextIsolation: true` + `nodeIntegration: false` + `contextBridge` ensures security.

4. **No external data transmission** — The application makes no outbound network calls beyond loading the target HIS/EMR URL. Audit data is written only to local disk.

5. **PHI handling** — Protected health information is detected by regex pattern matching but never logged in full. Only truncated or anonymized references are stored in the report.

---

## Technology Decisions

### Why Electron over a Standalone Browser Extension

| Factor | Electron | Browser Extension |
|---|---|---|
| **Network interception** | Full CDP + webRequest API | Limited webRequest API |
| **File system access** | Native via `fs` module | No direct FS access |
| **Content tracing** | Native Chromium `contentTracing` | Not available |
| **Process monitoring** | `app.getAppMetrics()`, `powerMonitor` | Not available |
| **Deployment** | Portable executable | Chrome Web Store required |
| **Cross-platform** | Windows, macOS, Linux | Chrome only |

### Why axe-core Over a Custom Accessibility Scanner

axe-core is the industry standard for automated accessibility testing, used by Microsoft, Google, and government agencies worldwide. It covers **570+ WCAG 2.1 AA rules** across all impact levels (critical, serious, moderate, minor). A custom scanner would only cover a fraction of these rules and would need to be maintained against evolving WCAG standards.

### Why AJV for FHIR Validation

AJV (Another JSON Validator) is the fastest JSON Schema validator for JavaScript, capable of compiling schemas for high-throughput validation. The FHIR R4 schema is complex (~50MB expanded), and AJV's `strict: false` mode allows validation against a pre-compiled schema with `addFormat()` for FHIR-specific formats like `uri` and `date-time`.

### Why Local JSON Reports Over a Database

1. **Simplicity** — JSON files are human-readable, easily shared, and require no database setup
2. **Portability** — Reports can be emailed, attached to tickets, or loaded into any analysis tool
3. **No infrastructure** — No database server, no schema migrations, no connection management
4. **File-system indexing** — `index.json` enables longitudinal analysis without a database
5. **Git exclusion** — Reports stay local and are never committed to version control

### Why contentTracing Over a Custom Profiler

Chromium's `contentTracing` API (equivalent to the `chrome://tracing` tool) provides system-level trace data including V8 garbage collection, Blink rendering, GPU compositing, and CC (compositor thread) activity. A custom `PerformanceObserver`-only profiler cannot capture this level of detail. The trace output is compatible with Chrome DevTools and Perfetto for deep performance analysis.
