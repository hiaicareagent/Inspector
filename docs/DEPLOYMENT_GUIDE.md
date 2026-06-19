# Deployment & Operations Guide

## System Requirements

### Operating System

| OS | Supported Versions |
|---|---|
| Windows | 10 (build 19041+), 11 |
| macOS | 12 (Monterey), 13 (Ventura), 14 (Sonoma) |
| Linux | Ubuntu 20.04+, Fedora 38+, Debian 11+ |

### Hardware Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 4 GB | 8 GB |
| CPU | 2 cores, 2.0 GHz | 4 cores, 2.5 GHz |
| Disk Space | 500 MB (application) | 5 GB (application + reports) |
| Display | 1280x720 | 1920x1080 |
| Network | Internet connection for target EMR access | Same |

### Software Requirements

| Dependency | Version | Installation |
|---|---|---|
| Node.js | 18.x or later | [nodejs.org](https://nodejs.org/) |
| npm | 9.x or later | Bundled with Node.js |
| Git | Any modern version | [git-scm.com](https://git-scm.com/) |
| Chromium | Bundled with Electron | Automatic via npm install |

### Network Requirements

The machine running Inspector needs access to:
- The target HIS/EMR URL (HTTPS recommended)
- Any third-party CDN/API endpoints used by the EMR (CDP, analytics, maps)
- npm registry (during installation only)

No outbound connections from Inspector itself are required beyond loading the target URL.

---

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/hiaicareagent/Inspector.git
cd Inspector
```

### Step 2: Install Dependencies

```bash
npm install
```

Expected output (truncated):

```
added 367 packages in 45s
```

Key packages and versions (from `package.json`):

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^33.4.11 | Browser engine |
| `axe-core` | ^4.10.0 | Accessibility scanning |
| `ajv` | ^8.17.1 | FHIR JSON Schema validation |
| `electron-builder` | ^25.1.8 | Build portable executable |

### Step 3: Verify Installation

```bash
./node_modules/.bin/electron --version
# Expected: v33.x.x or later
```

### Step 4: First-Run Checklist

- [ ] Target EMR URL is accessible from this machine
- [ ] Node.js 18+ is installed (`node --version`)
- [ ] npm is up to date (`npm --version`)
- [ ] Disk space is sufficient for reports directory
- [ ] Screen resolution supports minimum 1280x720

---

## Configuration Reference

### Configuration File

Create a `config.js` file in the project root (optional — all values can be set via environment variables):

```javascript
module.exports = {
  // Target EMR URL (required)
  targetURL: "https://your-his-instance.com",

  // FHIR version for schema validation
  fhirVersion: "R4",

  // Auto-logoff timeout
  autoLogoffLimitMinutes: 15,

  // Clinical SLA thresholds
  clinicalSLAThresholdMs: 2000,
  nonClinicalSLAThresholdMs: 5000,

  // Memory monitoring
  memoryLeakThresholdMB: 500,
  memoryPollIntervalMs: 10000,

  // Content tracing
  traceAutoStopMs: 30000,

  // PHI pattern detection
  phiPatterns: [
    { name: "MRN", regex: "\\bMRN[-:]?\\s*\\d{4,12}\\b" },
    { name: "DOB", regex: "\\b\\d{2}[/\\-]\\d{2}[/\\-]\\d{4}\\b" },
    { name: "NHS/ID", regex: "\\b[A-Z]{2}\\d{6}[A-Z]\\b" },
  ],

  // Workflow patterns (URL path sequences)
  workflowPatterns: {
    medication_order: {
      steps: ["/medications", "/order", "/sign", "/submit"],
      maxTime: 180
    },
    discharge_summary: {
      steps: ["/patient", "/summary", "/sign"],
      maxTime: 600
    },
    lab_order: {
      steps: ["/labs", "/order", "/submit"],
      maxTime: 120
    }
  },

  // Stale data thresholds (endpoint prefix → ms)
  staleDataThresholds: {
    "/vitals": 300000,       // 5 min
    "/medications": 600000,  // 10 min
    "/alerts": 120000         // 2 min
  },

  // Privilege scope map
  roleScopeMap: {
    nurse: ["Patient", "Observation", "MedicationAdministration"],
    doctor: ["Patient", "Observation", "MedicationRequest", "DiagnosticReport"],
    admin: ["*"]
  },

  // Reports directory
  reportsDir: "./reports",

  // Critical cache keys for service worker audit
  criticalCacheKeys: [
    "patient-demographics",
    "active-medications",
    "allergies"
  ],
};
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `INSPECTOR_TARGET_URL` | `https://example.com` | Target EMR URL to load on startup |

### Configuration in main.js

All configurable constants are defined at the top of `main.js`:

```javascript
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
```

### How to Add Custom PHI Patterns

Edit the `patterns` array in `injectComplianceScanners()` within `main.js`:

```javascript
var patterns = [
  { name: 'MRN', regex: /\bMRN[-:]?\s*\d{4,12}\b/i },
  { name: 'DOB', regex: /\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/ },
  { name: 'NHS/ID', regex: /\b[A-Z]{2}\d{6}[A-Z]\b/ },
  // Add your custom patterns here:
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'PHONE', regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/ },
];
```

### How to Add Custom Workflow URL Sequences

Edit the `WORKFLOW_PATTERNS` object in `injectWorkflowIntelligence()`:

```javascript
var WORKFLOW_PATTERNS = {
  medication_order: { steps: ['/medications', '/order', '/sign', '/submit'], maxTime: 180 },
  discharge_summary: { steps: ['/patient', '/summary', '/sign'], maxTime: 600 },
  lab_order: { steps: ['/labs', '/order', '/submit'], maxTime: 120 },
  // Add your custom workflow:
  radiology_order: { steps: ['/radiology', '/order', '/submit'], maxTime: 240 },
};
```

---

## Running an Audit Session

### How to Start the Browser

```bash
# Default target (https://example.com)
npm start

# With environment variable
INSPECTOR_TARGET_URL="https://your-emr.com" npm start

# On Windows PowerShell
$env:INSPECTOR_TARGET_URL="https://your-emr.com"
npm start
```

### How to Point It at the Target HIS

1. Set `INSPECTOR_TARGET_URL` environment variable before starting, OR
2. Navigate to any URL using the address bar once the browser window opens (if address bar is visible), OR
3. Modify the `TARGET_URL` constant in `main.js` directly

### Recommended Audit Session Duration

| Audit Type | Recommended Duration | Notes |
|---|---|---|
| **Quick health check** | 5-10 minutes | Run all 10 pillars, baseline metrics |
| **Standard audit** | 20-30 minutes | Full workflow execution + network tests |
| **Comprehensive audit** | 1-2 hours | Longitudinal data, multiple workflows, all network presets |
| **Regression audit** | 15-20 minutes | Same workflows as baseline for comparison |

### How to Trigger Network Degradation Tests

1. Open the Diagnostics panel (loaded alongside the target URL)
2. Click a network preset button:
   - **[Offline]** — Complete network disconnection
   - **[2G]** — 300ms latency, 6.4 Kbps download
   - **[3G]** — 100ms latency, 37.5 Kbps download
   - **[Normal]** — Restore normal connectivity
3. The current network mode is displayed on the panel
4. Live failure count tracks requests that failed under the degraded condition

### How to Generate the Final Report

1. Click **"Generate Report"** in the Diagnostics panel
2. Wait for confirmation (report generation may take 5-15 seconds)
3. Find the report at:
   - `./reports/inspector-report-{timestamp}.json` (unified report)
   - `./reports/heatmap-{timestamp}.json` (click clustering)
   - `./reports/trends-{timestamp}.json` (trend data)
   - `./reports/index.json` (session history)

### Where to Find Output Files

All output files are in the `./reports/` directory:
- Reports are named `inspector-report-YYYY-MM-DDTHH-MM-SS-000Z.json`
- Screenshots are in `./reports/screenshots/`
- Trace files are named `trace-YYYY-MM-DDTHH-MM-SS-000Z.json`
- The session index is always `./reports/index.json`

---

## Interpreting Reports

### How to Read the Compliance Score

| Score Range | Color | Meaning |
|---|---|---|
| 80-100 | 🟢 Green | Good compliance, minor or no issues |
| 50-79 | 🟡 Amber | Moderate issues requiring attention |
| 0-49 | 🔴 Red | Critical issues requiring immediate remediation |

### What Each Critical Flag Means Clinically

| Flag | Clinical Meaning | Priority |
|---|---|---|
| `PHI_IN_STORAGE` | Patient data stored in browser, at risk on shared workstations | Critical |
| `PHI_UNENCRYPTED` | Patient data transmitted over HTTP, not HTTPS | Critical |
| `JCI_IPSG1_VIOLATION` | <2 patient identifiers visible — wrong-patient risk | Critical |
| `EXPIRED_TOKEN_REQUEST` | Stale session token — potential unauthorized access | Critical |
| `CONCURRENT_SESSION_ANOMALY` | Same token from different browsers — sharing credentials | Critical |
| `PRIVILEGE_SCOPE_EXCEEDED` | User accessed data beyond their role permissions | Critical |
| `REAUTHENTICATION_BYPASSED` | Session resumed after logoff without re-auth | Critical |
| `SILENT_FAILURE` | API error with no visible error UI — clinician unaware | Critical |
| `OFFLINE_WARNING_MISSING` | No offline warning — clinician may act on stale data | Critical |
| `RECONNECTION_SYNC_FAILURE` | No data refresh after reconnect — stale data persists | Critical |
| `ALLERGY_ALERT_NOT_VISIBLE` | Drug allergy alert outside viewport | High |
| `AUTOLOGOFF_FAILURE` | Workstation left unlocked beyond policy | High |
| `SIGNIFICANT_LAYOUT_SHIFT` | UI elements moving unexpectedly | Medium |
| `DEGRADED_MODE_SILENT_FREEZE` | UI frozen without loading indicator | Medium |
| `NO_OFFLINE_CACHE_FOR_CRITICAL_DATA` | Critical data not cached for offline use | Medium |

### Priority Order for Addressing Flags

1. **Critical safety:** `SILENT_FAILURE`, `ALLERGY_ALERT_NOT_VISIBLE`, `JCI_IPSG1_VIOLATION`
2. **Critical compliance:** `PHI_IN_STORAGE`, `PHI_UNENCRYPTED`, `REAUTHENTICATION_BYPASSED`
3. **Critical security:** `EXPIRED_TOKEN_REQUEST`, `CONCURRENT_SESSION_ANOMALY`, `PRIVILEGE_SCOPE_EXCEEDED`
4. **High compliance:** `AUTOLOGOFF_FAILURE`, `OFFLINE_WARNING_MISSING`, `RECONNECTION_SYNC_FAILURE`
5. **Medium UX:** `SIGNIFICANT_LAYOUT_SHIFT`, `DEGRADED_MODE_SILENT_FREEZE`
6. **Data quality:** `VALUE_NOT_RENDERED`, `VALUE_TRUNCATED`, `STALE_DATA`

### How to Use Trend Data for Governance Reporting

The `/reports/trends-{timestamp}.json` file is structured for direct consumption by governance dashboards:

```json
{
  "sessions": [
    { "date": "2026-01-15T10:00:00Z", "complianceScore": 85, "uxScore": 78, "performanceScore": 92 },
    { "date": "2026-02-15T10:00:00Z", "complianceScore": 88, "uxScore": 82, "performanceScore": 90 },
    { "date": "2026-03-15T10:00:00Z", "complianceScore": 92, "uxScore": 85, "performanceScore": 78 }
  ],
  "regressions": [
    { "metric": "performance", "previousScore": 92, "newScore": 78, "delta": -14 }
  ],
  "persistentDegradations": [],
  "newCriticalIssues": []
}
```

This can be loaded into:
- **Line charts** for score trends over time (date vs. score)
- **Bar charts** for regression magnitude (delta per metric)
- **Tables** for detailed flag tracking (new issues per session)

---

## GitHub Integration

### Repository

```
https://github.com/hiaicareagent/Inspector.git
```

### Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Release-quality code. All pillars functional. |
| Feature branches | Development of new pillars or features. Merge to `main` via PR. |

### Reports Exclusion

The `.gitignore` file excludes all report and session data:

```gitignore
# Reports — session data stays local
/reports/*.json
/reports/screenshots/*
/reports/heatmap-*.json
/reports/trends-*.json
reports/index.json
```

**Why reports are excluded:** Reports contain session metadata, potential PHI references, and sensitive audit data. They must stay local and must never be committed to version control.

### How to Update the Tool

```bash
git pull origin main
npm install
```

If breaking changes are introduced, check the CHANGELOG.md for migration notes.

---

## Troubleshooting

### Common Errors and Fixes

#### Electron fails to launch

| Symptom | Likely Cause | Fix |
|---|---|---|
| `Error: The system was unable to find the specified registry key` | Missing VC++ runtime | Install [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe) |
| `Error: EACCES: permission denied` | Permissions on node_modules | `sudo npm install` (Linux/Mac) or run as Administrator (Windows) |
| `Error: GPU process not usable` | GPU/driver issue | Launch with `--disable-gpu`: `npx electron . --disable-gpu` |
| Blank white window | Target URL not loading | Check `INSPECTOR_TARGET_URL` or set it explicitly |

#### webRequest not intercepting HTTPS

The `session.defaultSession.webRequest` API works with HTTPS by default in Electron. No additional certificate configuration is needed.

If HTTPS interception fails:
1. The EMR may be using certificate pinning
2. Check that the target URL uses a valid, trusted certificate
3. Try navigating to the URL manually in the browser window

#### axe-core not running

1. Confirm axe-core is installed: `npm ls axe-core`
2. Reinstall if missing: `npm install axe-core`
3. Check the renderer console for CSP errors — some pages block injected scripts via `Content-Security-Policy`

#### contentTracing empty output

1. The trace file may be empty if no categories matched events during the recording window
2. Increase the auto-stop timeout: change `TRACE_AUTO_STOP_MS` to 60000 (60 seconds)
3. Verify tracing was started: `inspector.getTraceStatus()` should return `true`

#### GitHub push failures

1. Check remote URL: `git remote -v`
2. Ensure SSH key or personal access token is configured
3. Try `git pull --rebase origin main` before pushing
4. Check branch protection rules on `main`

### How to Enable Verbose Debug Logging

Inspector logs to the console by default with `[Inspector:...]` prefixes. To see all log levels:

```bash
# Set Electron's logging level
export ELECTRON_DEBUG_LOG=true
npm start
```

### Where to Find Electron Crash Logs

| OS | Location |
|---|---|
| Windows | `%APPDATA%/Inspector/logs/` |
| macOS | `~/Library/Logs/Inspector/` |
| Linux | `~/.config/Inspector/logs/` |

Crash logs are also written to the renderer's console-message interception and stored in the report's `telemetry.rendererCrashes` section.

---

## Building a Portable Executable

```bash
npm run build
```

Output: `dist/Inspector-Healthcare-2.0.0-portable.exe` (Windows)

This packages the application as a standalone executable with all dependencies bundled, suitable for distribution to QA teams without Node.js installed.
