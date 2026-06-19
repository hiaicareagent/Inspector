# Changelog

All notable changes to the Inspector project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-06-19 — Longitudinal Trend Reporting

### Added

- **Report history index** (`/reports/index.json`) — Every `generateReport()` appends a summary entry with scores, total issues, and critical flag types
- **Regression detection** — Compares current vs previous session scores; flags `SCORE_REGRESSION` if any metric drops >10 points
- **New critical issue detection** — Compares critical flag types between sessions; flags `NEW_CRITICAL_ISSUE` for previously unseen types
- **Cross-session trend analysis** — Analyzes last 5 sessions; flags `PERSISTENT_DEGRADATION` if last 3 consecutive comparisons show degrading trend
- **Heatmap data aggregation** — Clusters rage/dead clicks within 40px radius across all sessions; outputs `/reports/heatmap-{timestamp}.json`
- **Trend data output** — Extracts score history from index.json; outputs `/reports/trends-{timestamp}.json` for governance dashboards
- **Trend summary panel** in diagnostics.html — Shows trend arrows (↑ improving, ↓ degrading, → stable), session count, last regression date
- `inspector:getTrendCounts` IPC handler and preload bridge for trend data access

## [0.9.0] - 2026-06-19 — Offline Mode & Resilience Testing

### Added

- **Network degradation simulation** via Chrome DevTools Protocol — Presets: offline, 2G (300ms/6.4Kbps), 3G (100ms/37.5Kbps), normal
- `applyNetworkCondition()` uses `Network.emulateNetworkConditions` for real-time network simulation
- `inspector:setNetworkCondition` IPC handler for on-demand preset switching
- **Offline state monitoring** — Detects offline transitions, checks DOM for offline warning after 5s; flags `OFFLINE_WARNING_MISSING`
- **Reconnection sync audit** — Monitors data re-fetch within 10s of online restoration; flags `RECONNECTION_SYNC_FAILURE`
- **Service worker audit** — Inspects `navigator.serviceWorker.getRegistrations()` and Cache Storage; checks for critical cache keys (`patient-demographics`, `active-medications`, `allergies`)
- **Auto-initialized online/offline detection** in preload.js via IIFE — tracks actual outage duration
- **Degraded mode freeze detection** — Wraps `fetch` and `XMLHttpRequest` with 10s timeout; checks for loading indicators; flags `DEGRADED_MODE_SILENT_FREEZE`
- Network simulation controls panel in diagnostics.html with [Offline] [2G] [3G] [Normal] buttons
- `offlineResilience` report section with 6 sub-sections
- Updated scoring: complianceScore deducts 20/25, performanceScore deducts 15

## [0.8.0] - 2026-06-19 — Data Integrity & Rendering Accuracy

### Added

- **API response cache** — Caches Patient, Observation, MedicationRequest, AllergyIntolerance responses in `apiResponseCache` Map; exposed via `inspector:getAPICache` IPC
- **Stale data detection** — Checks cache age against thresholds: vitals 5min, medications 10min, alerts 2min; flags `STALE_DATA`
- **Critical value rendering verification** — Injected scanner parses Observation resources, checks numeric values in DOM (±0.1 tolerance); flags `VALUE_NOT_RENDERED` or `VALUE_TRUNCATED`
- **Allergy/alert visibility audit** — On prescription pages, checks allergy elements' viewport position via `getBoundingClientRect()`; flags `ALLERGY_ALERT_NOT_VISIBLE`
- **Form pre-population accuracy** — Fetches Patient from cache, verifies name/MRN/DOB in DOM; flags `FORM_PREPOPULATION_MISMATCH`
- `dataIntegrity` report section with 5 sub-sections
- Updated scoring: complianceScore deducts 40/30/35 per violation, performanceScore deducts 10 per stale flag

## [0.7.0] - 2026-06-19 — API Health & Dependency Resilience

### Added

- **Clinical endpoint SLA monitoring** — 2s threshold for clinical endpoints, 5s for non-clinical; flags `CLINICAL_SLA_BREACH` and `NON_CLINICAL_SLA_BREACH`
- **Rolling error rate calculation** — Per-endpoint rolling window of 20 requests; flags `HIGH_ERROR_RATE` if >10% with minimum 5 samples
- **Silent failure detection** — After clinical API returns 4xx/5xx, checks DOM for error UI via `executeJavaScript()`; flags `SILENT_FAILURE`
- **Third-party dependency tracking** — Automatically classifies off-domain requests as dependencies; tracks response times, error counts; flags `SLOW_DEPENDENCY` (avg >500ms) and `FAILING_DEPENDENCY` (>2 errors)
- `apiHealth` report section with comprehensive endpoint summaries
- `inspector:getApiHealthCounts` IPC handler
- Updated scoring: complianceScore deducts 25/20, performanceScore deducts 15/5

## [0.6.0] - 2026-06-19 — Session Integrity & Auth Audit

### Added

- **JWT token monitoring** — Intercepts `Authorization: Bearer` headers via `webRequest.onBeforeSendHeaders`; decodes JWT payload (no signature verification)
- **Expired token detection** — Checks `payload.exp` against current time; flags `EXPIRED_TOKEN_REQUEST` for expired tokens, `TOKEN_EXPIRY_WARNING` for tokens expiring within 5 minutes
- **Concurrent session anomaly detection** — Token fingerprinting + User-Agent comparison; flags `CONCURRENT_SESSION_ANOMALY` when same token from different user agents
- **Privilege scope compliance** — `ROLE_SCOPE_MAP` for nurse/doctor/admin; flags `PRIVILEGE_SCOPE_EXCEEDED` on unauthorized resource type access
- **Re-authentication audit** — Tracks auto-logoff → subsequent request patterns; flags `REAUTHENTICATION_BYPASSED` if resource request >60s after logoff without auth URL
- **Login/logout DOM detector** — Injected scanner detects login forms (password + submit) and logout pages (URL or text patterns)
- `sessionIntegrity` report section with 7 sub-sections
- Updated scoring: complianceScore deducts 30-50 per violation
- `inspector:getSessionCounts` IPC handler

## [0.5.0] - 2026-06-19 — Clinical Workflow Intelligence

### Added

- **Workflow session tracker** — Detects navigation through predefined workflow patterns: medication ordering (4 steps), discharge summary (3 steps), lab ordering (3 steps)
- **Workflow completion detection** — Records completed workflows with duration, steps visited, and patient context
- **Workflow abandonment detection** — Flags workflows where user navigated away before reaching final step
- **Time-on-task monitoring** — Flags `workflow_slow` when workflow duration exceeds threshold (medications: 3min, discharge: 10min, labs: 2min)
- **Navigation confusion detection** — Identifies backtracking patterns (same page visited ≥3 times in 10-navigation window)
- **Multi-tab patient session detection** — Uses `BroadcastChannel` and `sessionStorage` to detect same patient open in multiple tabs
- `workflowIntelligence` report section with 5 sub-sections
- `inspector:getWorkflowCounts` IPC handler with completed, abandoned, slow, confusion, and concurrent counts

## [0.4.0] - 2026-06-19 — Telemetry Pipeline & Unified Report

### Added

- **Console message interception** — Captures all console-message events from renderer; classifies ERROR (level 3+) and WARNING (level 2); stores in `consoleErrors[]` and `consoleWarnings[]`
- **Renderer crash monitoring** — Listens to `render-process-gone` and `unresponsive` events; records crash reason, exit code, and URL
- **Unified Report Aggregator** (`reporting.js`) — New `ReportAggregator` class that receives all data stores and generates structured JSON reports
- **Scoring engine** — Compliance, UX, and Performance scores (0-100 each), overall average, and critical flag extraction
- **Comprehensive report sections** — meta, summary, performance, compliance, ux, telemetry
- Session start tracking, session duration calculation
- Telemetry section in report with console errors, warnings, and renderer crashes
- Updated scoring: complianceScore includes FR violations, PHI flags, JCI, auto-logoff; performanceScore includes LCP, long tasks, memory warnings

## [0.3.0] - 2026-06-19 — UX & Accessibility Engine

### Added

- **Rage-click detection** — 3+ rapid clicks within 40px radius and 500ms window; confirms no DOM mutation within 800ms before flagging
- **Dead-click detection** — Clicks with no DOM mutation or network activity within 800ms
- **Layout shift screenshot capture** — Automated PNG capture on CLS events; pixel-diff comparison using 16x16 block-averaged RGBA hash; flags >5% visual changes as `SIGNIFICANT_LAYOUT_SHIFT`
- **axe-core accessibility auditing** — Injects axe-core library via CDP; runs WCAG 2.1 AA rules (color-contrast, label, keyboard, aria-required-attr); categorizes violations by impact level
- `injectUXScanners()` — Injects click handlers, wraps fetch/XHR, sets up MutationObserver for UX detection
- `inspector:reportAxeResults` — IPC for axe-core audit results
- Layout shift screenshot persistence in `/reports/screenshots/`

## [0.2.0] - 2026-06-19 — Clinical Compliance Engine

### Added

- **FHIR R4 schema validation** — Loads FHIR schema from `fhir-r4-schema.json`; compiles AJV validator; validates all intercepted FHIR responses against schema
- **FHIR resource type validation** — Checks `resourceType` against 100+ FHIR R4 resource types; validates ID pattern and `meta.lastUpdated` format
- **PHI browser storage scanner** — Injected script scans `localStorage` and `sessionStorage` for MRN, DOB, and NHS ID patterns via regex
- **Unencrypted PHI transmission detection** — Intercepts HTTP requests (non-HTTPS) containing PHI-related keywords in URL path
- **JCI IPSG-1 two-identifier check** — Scans patient-context pages for at least 2 of: full name, MRN, DOB, patient ID; re-scans on DOM mutations
- **Auto-logoff audit** — Monitors system idle time via `powerMonitor.getSystemIdleTime()`; flags idle times exceeding configurable threshold (default 15 min)
- User interaction timestamp tracking (throttled mousemove/keydown at 5s intervals)
- `injectComplianceScanners()` — Injects PHI scanner, JCI checker, and interaction tracker
- `setupNetworkInterception()` — Establishes webRequest hooks for FHIR interception and PHI detection

## [0.1.0] - 2026-06-19 — Technical Performance Engine

### Added

- **Core Web Vitals monitoring** — PerformanceObservers for FP, FCP, LCP, and CLS; metrics reported via IPC to main process
- **Long task tracking** — PerformanceObserver for `longtask` type; captures duration and trigger element; dedup by parsed metadata
- **Memory monitoring** — 10-second interval polling of `app.getAppMetrics()`; captures per-process private memory, working set, CPU usage; flags memory leaks when any process exceeds 500MB private memory
- **Chromium content tracing** — Start/stop lifecycle via `contentTracing.startRecording()`/`stopRecording()`; auto-stops after 30 seconds; categories: v8, blink, cc, gpu, v8.gc
- `injectPerformanceObservers()` — Injects FP, FCP, LCP, CLS, and long task observers into the renderer
- `startMemoryMonitoring()`/`stopMemoryMonitoring()` — Lifecycle-controlled memory sampling
- `startTrace()`/`stopTrace()` — contentTracing management with auto-stop
- Performance data stores: `performanceCoreWebVitals`, `performanceLongTasks`, `performanceMemorySnapshots`
- Trace file output to `/reports/trace-{timestamp}.json`

## [0.0.1] - 2024-06-18 — Initial Scaffold

### Added

- Electron project scaffold with `package.json`, `main.js`, `preload.js`
- Frameless browser window with custom title bar (traffic light buttons: minimize, maximize, close)
- Tab bar with create/switch/close tab functionality
- Navigation bar with back, forward, refresh buttons and address bar
- Status bar with URL and security indicators
- Webview-based tab system using `<webview>` tag
- Performance monitoring panel (navigation timing, paint metrics, memory, resource summary)
- Network request inspector (method/status/duration/size, security header analysis, expandable details)
- Console log capture (info, warning, error levels with source/line tracking)
- Security scanner (HTTPS check, mixed content detection, missing CSP/HSTS/XFO headers, eval detection, third-party scripts, localStorage scan)
- Style audit (viewport meta, deprecated HTML, alt text, heading hierarchy, inline styles)
- Resizable monitor panel (drag-to-resize splitter, toggle button)
- Bookmarks manager (persistent bar with emoji icons, star toggle in URL bar, modal with edit/delete, Ctrl+D shortcut, localStorage persistence)
- JSON export feature (Electron save dialog, comprehensive report with all panels, fresh audit on export)
- Custom dark theme CSS (~800 lines covering all UI components with CSS variables, animations, conic gradients)
- GitHub repository initialized and pushed to `https://github.com/hiaicareagent/Inspector.git`
