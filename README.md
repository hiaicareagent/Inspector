# 🏥 Inspector — HIS/EMR Observability & Safety-Gate Browser

[![Electron](https://img.shields.io/badge/Electron-33.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.0.0-green)](package.json)

> **A clinical-grade automated audit browser for Health Information Systems (HIS) and Electronic Medical Records (EMR).**  
> Inspector monitors, measures, and reports on technical performance, clinical compliance, usability, workflow integrity, and data resilience — all from a single Electron application.

---

## 📋 Overview

**Inspector** is an Electron-based browser purpose-built to audit enterprise healthcare web applications. Unlike general-purpose browser testing tools, Inspector is designed specifically around the compliance, safety, and usability requirements of clinical environments.

It operates as a real browser — navigating your HIS/EMR as a clinician would — while silently running 10 specialized audit pillars in the background. At the end of a session, it produces a comprehensive, structured JSON report covering everything from Core Web Vitals to JCI IPSG-1 compliance to offline resilience.

### The Clinical Problem

- **Hidden alerts** — Drug allergy warnings outside the viewport on small clinical workstations
- **Stale data** — Vital signs not refreshed for minutes on critical care dashboards
- **UI freezes** — Long tasks in the browser during medication ordering
- **PHI leaks** — Unencrypted transmission of protected health information
- **Session drift** — Expired tokens reused in shared clinical workstations
- **Workflow abandonment** — Clinicians forced to restart complex multi-step workflows

### Who It Is For

| Role | How They Use Inspector |
|---|---|
| **QA Engineers** | Pre-release regression testing of EMR updates |
| **Clinical Informaticists** | Objective UX measurement and workflow validation |
| **Hospital IT Teams** | Infrastructure readiness assessment and SLAs |
| **Compliance Officers** | HIPAA, JCI, and accessibility audit evidence |
| **EMR Vendors** | Pre-deployment quality gate automation |

---

## 📸 Screenshots

> *Diagnostics panel — real-time counters and network simulation controls*
>
> ```
> ┌─────────────────────────────────────────────────────────────┐
> │  🔬 Diagnostics Dashboard                                   │
> │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
> │  │ Compliance   │ │ UX           │ │ Performance  │        │
> │  │ Score: 92    │ │ Score: 85    │ │ Score: 78    │        │
> │  │ Violations: 3│ │ Issues: 7    │ │ Breaches: 2  │        │
> │  └──────────────┘ └──────────────┘ └──────────────┘        │
> │  Network: [Offline] [2G] [3G] [●Normal]  Duration: 12m     │
> └─────────────────────────────────────────────────────────────┘
> ```

> *Sample report output (JSON) — [See full schema](docs/REPORT_SCHEMA.md)*

---

## ✨ Key Features — The 10 Audit Pillars

### Pillar 1: Technical Performance Engine
Monitors Core Web Vitals (FCP, LCP, CLS), long tasks, memory usage with leak detection, and Chromium content tracing. Captures performance metrics continuously throughout the session. **Clinical value:** UI freezes during medication ordering or lab review directly impact patient safety — measuring them is the first step to eliminating them.

### Pillar 2: Clinical Compliance & Risk Engine
Scans for PHI in browser storage (localStorage/sessionStorage), detects unencrypted HTTP transmissions of sensitive data, validates FHIR R4 resources against the official schema, checks JCI IPSG-1 two-identifier compliance, and monitors auto-logoff enforcement. **Clinical value:** Direct audit evidence for HIPAA and JCI accreditation surveys.

### Pillar 3: Clinical Usability & UX Layer
Detects rage-clicks (3+ rapid clicks within 40px/500ms), dead-clicks (no response within 800ms), captures layout shift screenshots with pixel-diff analysis, and runs axe-core WCAG 2.1 AA accessibility audits. **Clinical value:** Rage-clicks on a non-responsive order button and hidden drug allergy alerts are patient safety events.

### Pillar 4: Telemetry Pipeline
Captures console errors and warnings, monitors renderer process crashes and unresponsive states, and powers the unified report generation engine. **Clinical value:** Early warning of JavaScript errors that could silently disrupt clinical workflows.

### Pillar 5: Workflow Intelligence
Tracks clinician navigation through predefined workflows (medication ordering, discharge summaries, lab orders), detects workflow abandonment, measures time-on-task against thresholds, identifies navigation confusion (repeated page revisits), and flags concurrent multi-tab patient sessions. **Clinical value:** Abandoned medication orders and wrong-patient data from multi-tab navigation are measurable safety risks.

### Pillar 6: Session Integrity & Auth Audit
Parses JWT tokens from `Authorization` headers, detects expired token usage, warns on tokens expiring within 5 minutes, identifies concurrent session anomalies (same token from different user agents), checks privilege scope compliance against a defined role-resource map, and audits re-authentication after auto-logoff events. **Clinical value:** Prevents unauthorized data access in shared clinical workstation environments.

### Pillar 7: API Health & Dependency Resilience
Monitors clinical vs. non-clinical API endpoints against SLA thresholds (2s clinical, 5s non-clinical), calculates rolling error rates, detects silent failures (API errors with no visible error UI), and tracks third-party dependency health with slow/failing dependency flags. **Clinical value:** A failing API that silently fails (no error shown to clinician) means the clinician may make decisions on incomplete data.

### Pillar 8: Data Integrity & Rendering Accuracy
Caches FHIR API responses for Patient, Observation, MedicationRequest, and AllergyIntolerance resources. Detects stale data (vitals >5min, medications >10min, alerts >2min). Verifies critical lab values are rendered correctly in the DOM within ±0.1 tolerance. Audits allergy alert visibility within the viewport. Validates form pre-population accuracy for patient name, MRN, and date of birth. **Clinical value:** Truncated lab values and out-of-viewport allergy alerts are known mechanisms of clinical error.

### Pillar 9: Offline Mode & Resilience Testing
Simulates network conditions (Offline, 2G, 3G, Normal) via Chrome DevTools Protocol. Detects missing offline warning messages. Audits service worker registrations and Cache Storage for critical patient data. Monitors reconnection sync behavior and flags degraded-mode UI freezes. **Clinical value:** When a clinician loses connectivity at the bedside and the app shows no warning, they may proceed with stale or incomplete information.

### Pillar 10: Longitudinal Trend Reporting
Maintains a session history index (`/reports/index.json`), detects score regressions (>10-point drops between sessions), identifies new critical issues, performs cross-session trend analysis over the last 5 sessions, and generates heatmap data (rage/dead-click clustering within 40px) and trend chart data ready for governance dashboards. **Clinical value:** Enables hospital IT leadership to track EMR health trends over time for JCI accreditation preparation.

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18.x or later (tested with 18.20+) |
| npm | 9.x or later |
| Operating System | Windows 10/11, macOS 12+, Ubuntu 20.04+ |
| RAM | 4GB minimum, 8GB recommended |
| Disk | 500MB for application + growing reports directory |

### Installation

```bash
# Clone the repository
git clone https://github.com/hiaicareagent/Inspector.git
cd Inspector

# Install dependencies
npm install

# (Optional) Verify electron installed
./node_modules/.bin/electron --version
```

### Configuration

Create a `config.json` or set environment variables:

```json
{
  "targetURL": "https://your-his-instance.com",
  "fhirVersion": "R4",
  "autoLogoffLimitMinutes": 15,
  "clinicalSLAThresholdMs": 2000,
  "memoryLeakThresholdMB": 500
}
```

Or set the target URL via environment variable:

```bash
export INSPECTOR_TARGET_URL="https://your-his-instance.com"
```

### Run an Audit Session

```bash
# Start Inspector (defaults to https://example.com)
npm start

# Or with environment variable
INSPECTOR_TARGET_URL="https://your-emr.com" npm start
```

### Generate a Report

Reports are generated automatically at the end of the session. To manually trigger:

1. Open the Diagnostics panel (if enabled)
2. Click **"Generate Report"**
3. Find the output in `/reports/inspector-report-[timestamp].json`

---

## ⚙️ Configuration Reference

All configurable values are defined at the top of `main.js`:

| Parameter | Default | Description |
|---|---|---|
| `TARGET_URL` | `https://example.com` | EMR URL to load on startup. Can be set via `INSPECTOR_TARGET_URL` env var. |
| `AUTOLOGOFF_TIMEOUT_MS` | 900000 (15 min) | Idle time before auto-logoff is flagged as a violation |
| `MEMORY_LEAK_THRESHOLD_MB` | 500 | Per-process private memory threshold for leak warnings |
| `MEMORY_POLL_MS` | 10000 | Memory sampling interval in milliseconds |
| `TRACE_AUTO_STOP_MS` | 30000 | Chromium content tracing auto-stop timeout |
| `IDLE_POLL_MS` | 5000 | Auto-logoff idle check interval |
| `STORAGE_SCAN_DELAY_MS` | 1500 | Delay before scanning browser storage for PHI |
| `CLINICAL_ENDPOINTS` | `/patient`, `/medication`, `/lab`, `/order`, `/allergy`, `/alert` | Endpoint prefixes classified as clinical |
| `STALE_THRESHOLDS` | vitals: 5min, medications: 10min, alerts: 2min | Stale data time thresholds per endpoint |
| `CRITICAL_CACHE_KEYS` | `patient-demographics`, `active-medications`, `allergies` | Cache keys for service worker audit |
| `ROLE_SCOPE_MAP` | nurse, doctor, admin with resource sets | JWT role-to-resource-type privilege mapping |

---

## 📁 Output Files

All reports and artifacts are written to the `/reports` directory:

| File | Description |
|---|---|
| `inspector-report-[timestamp].json` | Complete unified audit report with all 10 pillar sections |
| `trace-[timestamp].json` | Chromium content tracing output (Chrome DevTools trace format) |
| `screenshots/shift-[timestamp].png` | Layout shift screenshots captured during the session |
| `heatmap-[timestamp].json` | Rage-click and dead-click clustered coordinates (40px radius) |
| `trends-[timestamp].json` | Cross-session score history for governance dashboarding |
| `index.json` | Session history index — tracks all reports for longitudinal analysis |

### Report Structure (abbreviated)

```json
{
  "meta": { "version": "4.0.0", "sessionDuration": "12m 30s", "targetURL": "..." },
  "summary": {
    "scores": { "compliance": 92, "ux": 85, "performance": 78 },
    "overall": 85,
    "totalIssues": 12,
    "criticalFlags": [ ... ]
  },
  "performance": { "coreWebVitals": {}, "longTasks": {}, "memorySnapshots": {} },
  "compliance": { "fhirValidation": {}, "phiStorageScan": {}, "jciIpsg1": {}, "autoLogoffAudit": {} },
  "ux": { "rageClicks": {}, "deadClicks": {}, "layoutShifts": {}, "accessibilityAudit": {} },
  "telemetry": { "consoleErrors": [], "consoleWarnings": [], "rendererCrashes": [] },
  "workflowIntelligence": { "completedWorkflows": [], "abandonedWorkflows": [], ... },
  "sessionIntegrity": { "expiredTokenRequests": [], "privilegeScopeExceeded": [], ... },
  "apiHealth": { "clinicalSLABreaches": [], "silentFailures": [], "thirdPartyDependencies": [] },
  "dataIntegrity": { "staleDataFlags": [], "valueNotRendered": [], ... },
  "offlineResilience": { "networkConditionTests": [], "offlineWarningMissing": [], ... },
  "longitudinalTrends": { "scoreRegressions": [], "persistentDegradations": [], ... }
}
```

[Full annotated schema →](docs/REPORT_SCHEMA.md)

---

## 🏗 Architecture Overview

Inspector uses Electron's three-layer security model:

```
┌──────────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS (main.js)                      │
│  ┌──────────┐ ┌──────────────┐ ┌───────────────┐ ┌───────────┐  │
│  │ Network  │ │   Content    │ │  Compliance   │ │  Report   │  │
│  │ Intercept│ │   Tracing    │ │  Validation   │ │Aggregator │  │
│  │ (CDP)    │ │  (Chromium)  │ │  (Axe/AJV)   │ │(reporting)│  │
│  └────┬─────┘ └──────┬───────┘ └──────┬────────┘ └─────┬─────┘  │
│       │              │                │                │         │
│  ┌────▼──────────────▼────────────────▼────────────────▼──────┐  │
│  │                    IPC HANDLER LAYER                        │  │
│  │  40+ handlers: reportMetric, reportCompliance, generate,   │  │
│  │  getLogCounts, setNetworkCondition, injectScanners, etc.   │  │
│  └───────────────────────────┬────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────┘
                               │ contextBridge (contextIsolation: true)
┌──────────────────────────────┼──────────────────────────────────┐
│                    PRELOAD SCRIPT (preload.js)                   │
│  ┌───────────────────────────▼────────────────────────────────┐  │
│  │            contextBridge API Contract                       │  │
│  │  inspector.reportMetric()  inspector.reportCompliance()    │  │
│  │  inspector.reportUX()      inspector.reportAxeResults()   │  │
│  │  inspector.reportWorkflow() inspector.generateReport()    │  │
│  │  inspector.setNetworkCondition() inspector.getAPICache()  │  │
│  │  inspector.getTrendCounts()  inspector.getSummaryScores() │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                    RENDERER PROCESS (web page)                   │
│  ┌───────────────────────────▼────────────────────────────────┐  │
│  │               Injected JavaScript Scanners                  │  │
│  │  PerformanceObserver  │  DOM scanners  │  Event listeners  │  │
│  │  MutationObserver     │  axe-core      │  fetch wrapping   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Data flow:** Observers in the renderer → contextBridge IPC → Main process stores → ReportAggregator → JSON report on disk.

[Full architecture documentation →](docs/ARCHITECTURE.md)

---

## ✅ Compliance Standards Covered

| Standard | What Is Audited |
|---|---|
| **HIPAA** | PHI in browser storage, unencrypted HTTP transmissions (contains PHI), auto-logoff enforcement, concurrent session anomalies, re-authentication bypass |
| **JCI IPSG-1** | Two-patient-identifier rule — scans for at least 2 of: full name, MRN, date of birth, patient ID on patient-context pages |
| **WCAG 2.1 AA** | Full axe-core scan covering color contrast, form labels, keyboard navigation, ARIA attributes |
| **FHIR R4** | Schema validation of all FHIR resources via AJV, resource type checking, id pattern validation, meta.lastUpdated format validation |

---

## 📚 Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Deep technical architecture, IPC contract, security model |
| [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md) | Complete functional specification for all 10 pillars |
| [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Installation, configuration, operations, and troubleshooting |
| [CLINICAL_RATIONALE.md](docs/CLINICAL_RATIONALE.md) | Clinical-facing rationale for hospital stakeholders |
| [REPORT_SCHEMA.md](docs/REPORT_SCHEMA.md) | Complete annotated JSON report schema |

---

## 🔒 Security & Privacy

- **No external data transmission** — All audit data stays local to the machine
- **`contextIsolation: true`** — The renderer cannot access Node.js APIs
- **`nodeIntegration: false`** — Remote code cannot execute system commands
- **PHI handling** — Protected health information is detected by pattern matching but never logged in full; truncated values are stored for audit evidence
- **Reports directory** — All output files are in `/reports/`; `.gitignore` excludes them from version control

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

This project is part of the [hiaicareagent](https://github.com/hiaicareagent) ecosystem.  
For feature requests, bug reports, or contributions, please open an issue or pull request.

**Repository:** [https://github.com/hiaicareagent/Inspector.git](https://github.com/hiaicareagent/Inspector.git)
