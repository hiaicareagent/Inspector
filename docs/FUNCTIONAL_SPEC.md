# Functional Specification — Inspector

## Purpose & Scope

### What the System Does

Inspector is an Electron-based browser purpose-built for automated auditing of enterprise healthcare web applications. It navigates a Health Information System (HIS) or Electronic Medical Record (EMR) as a clinician would, while silently running 10 specialized audit engines in the background. At the end of a session, it produces a comprehensive JSON report covering technical performance, clinical compliance, usability, workflow integrity, session security, API health, data integrity, offline resilience, and longitudinal trends.

### What It Does NOT Do

- **Does not modify the HIS/EMR** — Inspector is read-only. It observes, measures, and reports. It does not create, update, or delete clinical data.
- **Does not perform penetration testing** — Inspector audits compliance and usability, not security vulnerabilities. It does not attempt SQL injection, CSRF, or other attack techniques.
- **Does not replace manual testing** — Inspector automates objective measurements but cannot replace clinical SME review of workflow appropriateness or UI correctness.
- **Does not transmit data externally** — All audit data remains on the local machine. No telemetry, analytics, or reports are sent to external servers.
- **Does not verify JWT signatures** — JWT parsing extracts the payload for audit purposes but does not verify cryptographic signatures or validate the token against an authorization server.

### Target Users

| User Role | Primary Use Case |
|---|---|
| **QA Engineer** | Regression testing before/after EMR software updates |
| **Clinical Informaticist** | Objective UX measurement and workflow validation |
| **Hospital IT Operations** | Infrastructure readiness assessment and SLA monitoring |
| **Compliance Officer** | HIPAA, JCI, and accessibility audit evidence collection |
| **EMR Vendor** | Pre-deployment quality assurance automation |
| **Hospital Leadership** | Longitudinal trend data for governance reporting |

---

## Pillar 1: Technical Performance Engine

### Functional Description

Continuously monitors browser rendering performance metrics throughout the audit session. Uses Chromium's `PerformanceObserver` API in the renderer and `contentTracing` in the main process.

### Metrics Collected

| Metric | Source | Trigger Condition | Threshold |
|---|---|---|---|
| **First Paint (FP)** | `PerformanceObserver('paint')` | First `PaintTiming` entry | N/A (recorded) |
| **First Contentful Paint (FCP)** | `PerformanceObserver('paint')` | First contentful paint | N/A (recorded) |
| **Largest Contentful Paint (LCP)** | `PerformanceObserver('largest-contentful-paint')` | Every LCP update up to page unload | >2500ms flags -10 performance |
| **Cumulative Layout Shift (CLS)** | `PerformanceObserver('layout-shift')` | Every shift entry, aggregated | N/A (recorded) |
| **Long Tasks** | `PerformanceObserver('longtask')` | Tasks >50ms on main thread | >100ms flagged per task |
| **Memory Snapshots** | `app.getAppMetrics()` | Every 10s | >500MB private memory = `MEMORY_LEAK_WARNING` |
| **Content Tracing** | `contentTracing.startRecording()` | On demand or auto-start | Auto-stops after 30s |

### Trigger Conditions

- **PerformanceObservers** are injected on every page load via `injectPerformanceObservers()`. They fire continuously while the page is loaded.
- **Memory snapshots** run on a 10-second interval (`MEMORY_POLL_MS`) across the entire session.
- **Content tracing** is triggered manually via `inspector.startTrace()` or auto-stops after 30 seconds (`TRACE_AUTO_STOP_MS`).

### Output

- `report.performance.coreWebVitals` — FCP, LCP, CLS values with timestamps
- `report.performance.longTasks` — Up to 100 most recent tasks with duration, trigger element, and URL
- `report.performance.memorySnapshots` — Up to 50 most recent snapshots with per-process memory details
- `report.performance.traceFilePath` — Path to Chromium trace file (if tracing was used)

### Clinical Rationale

A slow EMR interface is not just a productivity issue — it is a patient safety issue. An LCP >2.5 seconds during medication ordering in an ER environment delays critical care decisions. Long tasks block the main thread, preventing user input during time-sensitive workflows.

---

## Pillar 2: Clinical Compliance & Risk Engine

### Functional Description

Audits the HIS/EMR against HIPAA, JCI IPSG-1, and FHIR R4 compliance standards. Spans both main process network interception and renderer-side DOM scanning.

### HIPAA Compliance Checks

| Check | Detection Logic | Location |
|---|---|---|
| **PHI in Browser Storage** | Scans `localStorage` and `sessionStorage` keys/values for patterns: `MRN pattern` (`\bMRN[-:]?\s*\d{4,12}\b`), `DOB pattern` (`\b\d{2}[/\-]\d{2}[/\-]\d{4}\b`), `NHS ID pattern` (`\b[A-Z]{2}\d{6}[A-Z]\b`) | Renderer via `injectComplianceScanners()` |
| **PHI Unencrypted Transmission** | Intercepts HTTP (non-HTTPS) requests containing PHI-related keywords in the URL (`patient`, `mrn`, `ssn`, `phi`, `hipaa`, etc.) | Main process via `webRequest.onBeforeRequest` + CDP `Network.responseReceived` |
| **Auto-logoff Enforcement** | Checks system idle time via `powerMonitor.getSystemIdleTime()`. If idle time exceeds 15 minutes (`AUTOLOGOFF_TIMEOUT_MS`), flags as `AUTOLOGOFF_FAILURE` | Main process via `startAutoLogoffAudit()` |

### JCI IPSG-1 Checks

| Check | Detection Logic | Threshold |
|---|---|---|
| **Two-Patient Identifier Rule** | On patient-context pages (URL or title contains patient/EMR/chart keywords), scans DOM text for identifiers: Full name (capitalized names), MRN (`\bMRN[-:]?\s*\d{4,12}\b`), DOB (`\b\d{2}[/\-]\d{2}[/\-]\d{4}\b`), Patient ID (`\bPatient\s*ID\b`, numeric IDs) | <2 identifiers visible = `JCI_IPSG1_VIOLATION` |

Detection re-runs on DOM mutations via a `MutationObserver` (debounced 2s) and on SPA navigation via `popstate`.

### FHIR Validation

| Check | Detection Logic | Trigger |
|---|---|---|
| **Invalid JSON** | Response body is not valid JSON | Intercepted FHIR response |
| **Missing Resource Type** | JSON parsed but no `resourceType` field | Intercepted FHIR response |
| **Invalid Resource Type** | `resourceType` not in FHIR R4 resource type set (100+ types) | Intercepted FHIR response |
| **Schema Violation** | AJV validation fails against FHIR R4 schema | Intercepted FHIR response |
| **Invalid ID Pattern** | Resource ID doesn't match `^[A-Za-z0-9\-\.]{1,64}$` | Intercepted FHIR response |
| **Invalid LastUpdated** | `meta.lastUpdated` not valid ISO 8601 | Intercepted FHIR response |

### Auto-Logoff Audit

- **Interval:** Checked every 5 seconds (`IDLE_POLL_MS`)
- **Timeout:** 15 minutes (`AUTOLOGOFF_TIMEOUT_MS`)
- **Input:** `powerMonitor.getSystemIdleTime()` + `lastInteractionTimestamp` (from renderer mousemove/keydown)
- **Output:** `AUTOLOGOFF_FAILURE` flag with system idle seconds, interaction time, and effective inactive time

---

## Pillar 3: Clinical Usability & UX Layer

### Rage-Click Detection

| Parameter | Value |
|---|---|
| **Time window** | 500ms (clicks within this window are evaluated together) |
| **Proximity radius** | 40px (Euclidean distance between click coordinates) |
| **Minimum clicks** | 3 (fewer clicks are not considered rage) |
| **Confirmation wait** | 800ms (waits after detection to check if UI responded) |
| **Output** | `RAGE_CLICK` with coordinates, element info, click count, and timestamp |

When 3+ clicks occur within 40px and 500ms, Inspector waits 800ms. If no DOM mutation or network request occurred in that window, the clicks are flagged as rage clicks.

### Dead-Click Detection

| Parameter | Value |
|---|---|
| **Wait period** | 800ms (after click, checks for DOM mutation or network activity) |
| **Detection triggers** | `MutationObserver` callback, `fetch()`, `XMLHttpRequest.open()` |
| **Output** | `DEAD_CLICK` with element info and timestamp |

Every click records the current `lastMutationTime`. After 800ms, if `lastMutationTime` has not advanced (no DOM change, no network request), the click is flagged as dead.

### Layout Shift Capture

| Parameter | Value |
|---|---|
| **Trigger** | CLS `PerformanceObserver` value update |
| **Throttle** | 1 capture every 2 seconds max |
| **Capture method** | `webContents.capturePage()` → PNG file |
| **Pixel hash** | 16x16 block-averaged RGBA hash |
| **Diff threshold** | >5% diff = `SIGNIFICANT_LAYOUT_SHIFT` |
| **File naming** | `screenshots/shift-{timestamp}.png` |

### Accessibility Audit

| Parameter | Value |
|---|---|
| **Engine** | axe-core v4.10+ |
| **Rules** | WCAG 2.1 AA tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` |
| **Enforced rules** | `color-contrast`, `label`, `keyboard`, `aria-required-attr` |
| **Result types** | Violations only (not passes, incomplete, or inapplicable) |
| **Scoring** | `max(0, 100 - violations.length * 5)` |
| **Categories** | Critical, Serious, Moderate/Minor |

---

## Pillar 4: Telemetry Pipeline

### Console Message Categories

| Console Level | Electron Level | Classification |
|---|---|---|
| `verbose` | 0 | Ignored |
| `info` | 1 | Ignored |
| `warning` | 2 | `CONSOLE_WARNING` → stored in `consoleWarnings[]` |
| `error` | 3+ | `CONSOLE_ERROR` → stored in `consoleErrors[]` and `errorLog[]` |

### Renderer Crash Handling

| Event | Electron Hook | Recording |
|---|---|---|
| **Renderer crash** | `render-process-gone` → `details.reason` | `RENDERER_CRASH` with reason, exit code, URL |
| **Renderer unresponsive** | `unresponsive` | `RENDERER_UNRESPONSIVE` with URL |

### Report Generation Trigger

- **Manual:** Via `inspector.generateReport()` in the diagnostics panel
- **Automatic:** Via IPC from the main process lifecycle

---

## Pillar 5: Workflow Intelligence

### Supported Workflow Patterns

| Workflow | Steps | Max Time (seconds) |
|---|---|---|
| **Medication Order** | `/medications` → `/order` → `/sign` → `/submit` | 180 (3 min) |
| **Discharge Summary** | `/patient` → `/summary` → `/sign` | 600 (10 min) |
| **Lab Order** | `/labs` → `/order` → `/submit` | 120 (2 min) |

Workflow patterns are defined as URL-path sequences. A workflow is considered "in progress" when the current URL path matches any step in its sequence. Progress is tracked by the highest matching step index.

### Abandonment Detection

A workflow is flagged as **abandoned** when a user navigates to a URL that does not match any step of an active workflow and the active workflow has not reached its completion step. The `lastCompletedStep` is recorded along with the duration spent in the workflow.

Output: `workflow_abandoned` event with `workflowType`, `lastCompletedStep`, `abandonedAt`, `duration`.

### Time-on-Task Thresholds

| Workflow | Threshold | Unit | Action |
|---|---|---|---|
| Medication Order | 180 | seconds | Flagged as `workflow_slow` if exceeded |
| Discharge Summary | 600 | seconds | Flagged as `workflow_slow` if exceeded |
| Lab Order | 120 | seconds | Flagged as `workflow_slow` if exceeded |

### Multi-Tab Detection

Uses `BroadcastChannel` ('inspector_patient_channel') to communicate between tabs. Each tab reports the patient ID it has open. If the same patient ID is detected across multiple tabs, the event is flagged as `concurrent_patient` with the patient ID and tab count.

Patient context is extracted from URL patterns (`[?&]patient[=_]?([^&]+)` or `\/patient\/([^\/?#]+)`) or document title.

---

## Pillar 6: Session Integrity & Auth Audit

### JWT Parsing

Extracted fields from decoded JWT payload:
- `exp` — Token expiry timestamp
- `role` or `groups[0]` — User role for privilege scope check

JWT tokens are decoded (base64url) but **not cryptographically verified**. The audit is based on the payload structure, not token authenticity.

### Token Expiry Logic

| State | Timing | Action |
|---|---|---|
| **Token already expired** | `payload.exp < now` | `EXPIRED_TOKEN_REQUEST` flag |
| **Token expiring soon** | `payload.exp - now < 300s (5 min)` | `TOKEN_EXPIRY_WARNING` flag (deduped within 60s per URL) |
| **Token valid** | `payload.exp - now >= 300s` | No flag |

### Privilege Scope Map

| Role | Allowed Resource Types |
|---|---|
| `nurse` | Patient, Observation, MedicationAdministration |
| `doctor` | Patient, Observation, MedicationRequest, DiagnosticReport |
| `admin` | * (all resources allowed) |

Scope is checked on FHIR response interception. If a role accesses a resource type not in its allowed set, `PRIVILEGE_SCOPE_EXCEEDED` is flagged.

### Re-Authentication Audit

After an auto-logoff event (idle > 15min):
- If a resource request (not auth/login/token) occurs within 60s of logoff → **normal re-authentication** (flag cleared)
- If a resource request occurs after 60s without re-auth → `REAUTHENTICATION_BYPASSED` flag

---

## Pillar 7: API Health & Dependency Resilience

### SLA Thresholds

| Endpoint Type | Threshold | Example |
|---|---|---|
| **Clinical** | 2000ms | `/patient/*`, `/medication/*`, `/lab/*`, `/order/*`, `/allergy/*`, `/alert/*` |
| **Non-clinical** | 5000ms | All other endpoints |

### Error Rate Calculation

- **Window:** Rolling window of last 20 requests per endpoint
- **Threshold:** >10% error rate with minimum 5 samples
- **Flagging:** `HIGH_ERROR_RATE` if threshold exceeded
- **Dedup:** 60 seconds per endpoint

### Silent Failure Detection

After a clinical API endpoint returns 4xx/5xx, Inspector waits 1 second then executes JavaScript in the renderer to check:

```javascript
// Checks if DOM shows any error indication
hasAlert = !!document.querySelector('[role="alert"], .error, .warning, .alert, ...')
hasErrorText = /failed|error|unavailable|something went wrong/i.test(bodyText)
```

If neither alert element nor error text is found, the failure is flagged as `SILENT_FAILURE`.

### Third-Party Dependency Classification

Any request hostname that differs from the target URL's hostname is classified as a third-party dependency. Tracked metrics per hostname:
- `requestCount` — Total requests
- `responseTimes` — Sliding window of last 20 times
- `errorCount` — Count of 4xx/5xx responses

**Flags:**
- `SLOW_DEPENDENCY` — Average response time >500ms (minimum 3 requests)
- `FAILING_DEPENDENCY` — >2 errors (one-time flag per hostname)

---

## Pillar 8: Data Integrity & Rendering Accuracy

### API Response Cache

| Resource Type | Endpoint Pattern | Max Entries |
|---|---|---|
| Patient | `/patient*` | 20 per endpoint |
| Observation | `/observation*`, `/vitals*` | 20 per endpoint |
| MedicationRequest | `/medication*` | 20 per endpoint |
| AllergyIntolerance | `/allergy*`, `/alert*` | 20 per endpoint |

Cached in `apiResponseCache` Map keyed by normalized endpoint (hostname + clinical path prefix).

### Value Verification

- **Tolerance:** ±0.1 for numeric values
- **Resource types checked:** Observation (valueQuantity, component values)
- **Method:** API value extracted from cached FHIR response → checked against DOM text content
- **Flags:** `VALUE_NOT_RENDERED` (value absent from DOM) or `VALUE_TRUNCATED` (value ends with ".")

### Allergy Alert Audit

- **Trigger:** URL contains prescription/medication-related keywords
- **Elements scanned:** `[class*="allergy"]`, `[class*="alert"]`, `[class*="warning"]`, aria-label with allergy/alert
- **Visibility check:** `getBoundingClientRect()` — element must be within viewport (top >= 0, bottom <= innerHeight)
- **Flag:** `ALLERGY_ALERT_NOT_VISIBLE` with element details and bounding rect

### Form Pre-Population Check

- **Trigger:** URL contains patient ID pattern
- **Fields checked:** Patient name (given + family), MRN (first identifier or MR type), DOB (birthDate)
- **Method:** Fetches Patient resource from API cache, extracts expected values, checks DOM text for each
- **Flag:** `FORM_PREPOPULATION_MISMATCH` with field name, expected value, and rendered value

### Stale Data Thresholds

| Endpoint Type | Threshold |
|---|---|
| `/vitals` (Observation) | 5 minutes |
| `/medications` (MedicationRequest) | 10 minutes |
| `/alerts` (AllergyIntolerance) | 2 minutes |

Checked every 60 seconds via `checkStaleData()`.

---

## Pillar 9: Offline Mode & Resilience

### Network Condition Presets

| Preset | Offline | Latency | Download Throughput | Upload Throughput |
|---|---|---|---|---|
| **offline** | true | 0ms | 0 bps | 0 bps |
| **2G** | false | 300ms | 6.4 Kbps | 2.56 Kbps |
| **3G** | false | 100ms | 37.5 Kbps | 10.24 Kbps |
| **normal** | false | 0ms | unlimited (-1) | unlimited (-1) |

Applied via Chrome DevTools Protocol `Network.emulateNetworkConditions`.

### Offline Warning Detection

When `inspector:offlineDetected` is received:
1. Record timestamp
2. After 5 seconds, check DOM via `executeJavaScript()` for:
   - Elements with class containing "offline" or "disconnected"
   - Text matching "offline", "no connection", "disconnected", "check your network", "you are offline", "connection lost"
3. If neither element nor text found → `OFFLINE_WARNING_MISSING`

### Service Worker Audit

- Fires on page load via `injectServiceWorkerAudit()`
- Checks `navigator.serviceWorker.getRegistrations()` for active workers
- For each registration records: `scope`, `scriptURL`, `state` (active/installing/waiting)
- Checks Cache Storage for critical keys: `patient-demographics`, `active-medications`, `allergies`
- If no critical keys found → `NO_OFFLINE_CACHE_FOR_CRITICAL_DATA`

### Reconnection Sync

When `inspector:onlineRestored` is received:
1. Record the current API cache state
2. After 10 seconds, compare with new API cache state
3. If no new data fetched → `RECONNECTION_SYNC_FAILURE`

---

## Pillar 10: Longitudinal Trends

### Report Indexing

Each `generateReport()` invocation appends an entry to `/reports/index.json`:

```json
{
  "reportId": "2026-06-19T10-30-00-000Z",
  "generatedAt": "2026-06-19T10:30:00.000Z",
  "targetURL": "https://emr.example.com",
  "scores": { "compliance": 92, "ux": 85, "performance": 78 },
  "totalIssues": 12,
  "criticalFlags": ["PHI_IN_STORAGE", "JCI_IPSG1"]
}
```

### Regression Detection

- **Threshold:** Any score drops by more than 10 points vs previous session
- **Flag:** `SCORE_REGRESSION` with `metric`, `previousScore`, `newScore`, `delta`, `timestamp`
- **New critical issues:** If a critical flag type appears that was not in the previous report → `NEW_CRITICAL_ISSUE`

### Trend Calculation

- **Window:** Last 5 sessions from `index.json`
- **Method:** Compare consecutive scores; if last 3 consecutive comparisons all show degrading trend → `PERSISTENT_DEGRADATION`
- **Trend labels:** `improving`, `degrading`, `stable`

### Heatmap Clustering

- **Input:** All rage-click and dead-click coordinates from current session
- **Algorithm:** Euclidean distance clustering with 40px radius
- **Output:** `/reports/heatmap-{timestamp}.json` with `rageClickClusters[]` and `deadClickClusters[]`
- **Cluster fields:** `x`, `y`, `count`, `topElement`, `sessions`

---

## Report Output Specification

### Complete JSON Schema

See [REPORT_SCHEMA.md](REPORT_SCHEMA.md) for the complete annotated schema.

### Scoring Methodology

| Score | Base | Deductions From | Range |
|---|---|---|---|
| **Compliance** | 100 | FHIR violations, PHI flags, JCI violations, unencrypted PHI, auto-logoff, concurrent sessions, expired tokens, privilege scope, re-auth bypass, silent failures, high error rate, allergy alert, truncated values, form mismatch, offline warnings, reconnection failures | 0-100 |
| **UX** | 100 | Rage clicks, dead clicks, layout shifts, critical/serious a11y violations, abandoned workflows, navigation confusion | 0-100 |
| **Performance** | 100 | Slow LCP, long tasks, memory leak warnings, clinical/non-clinical SLA breaches, stale data, degraded mode freezes | 0-100 |
| **Overall** | Average | Average of compliance + UX + performance | 0-100 |

### File Naming Convention

See [ARCHITECTURE.md > File Naming Convention](ARCHITECTURE.md#file-naming-convention).

---

## Diagnostics Panel UI Specification

### UI Elements

| Element | Purpose | Data Source |
|---|---|---|
| **Compliance Score** | Live score counter with color coding | `getComplianceCounts()` IPC |
| **UX Score** | Live score counter with color coding | `getUXCounts()` IPC |
| **Performance Score** | Live score counter with color coding | `getSummaryScores()` IPC |
| **Network Simulation** | [Offline] [2G] [3G] [Normal] buttons | `setNetworkCondition()` IPC |
| **Current Network Mode** | Shows active network preset name | `getCurrentNetworkCondition()` IPC |
| **Live Failure Count** | Running count of failures during degradation | Network condition test tracking |
| **Trend Indicators** | ↑ improving / ↓ degrading / → stable per metric | `getTrendCounts()` IPC |
| **Sessions Count** | Total audited sessions from index.json | `getTrendCounts()` IPC |
| **Last Regression** | Date of last >10 point score regression | `getTrendCounts()` IPC |
| **Generate Report Button** | Trigger unified report generation | `generateReport()` IPC |
| **View Trend Report** | Open trend data file path | Alert with trend file location |

### Real-Time Counters

- Compliance violations count (by type badge)
- UX issues count (rage clicks, dead clicks, a11y violations)
- Performance issues count (long tasks, SLA breaches, memory warnings)

### Generate Report Button Behavior

1. Calls `inspector.generateReport()` → `ipcRenderer.invoke('inspector:generateReport')`
2. Main process creates `ReportAggregator` with all data stores
3. `generateReport()` writes JSON report file
4. `generateHeatmapData()` writes heatmap file
5. `generateTrendData()` writes trend data file
6. Updates `index.json`
7. Returns path to generated report file
