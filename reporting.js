const fs = require('fs');
const path = require('path');

class ReportAggregator {
  /**
   * @param {Array}  metricsLog
   * @param {Array}  complianceLog
   * @param {Array}  uxLog
   * @param {Array}  errorLog
   * @param {Object} coreWebVitals
   * @param {Array}  longTasks
   * @param {Array}  memorySnapshots
   * @param {string|null} traceFilePath
   * @param {string} reportsDir
   * @param {Array}  fhirViolations         — [ { url, timestamp, errorType, errorDetails }, ... ]
   * @param {Array}  phiStorageFlags        — [ { key, pattern, store, timestamp }, ... ]
   * @param {Array}  phiUnencryptedTransmissions  — [ { url, timestamp }, ... ]
   * @param {Array}  jciViolations          — [ { url, timestamp, identifiersFound, identifierTypes }, ... ]
   * @param {Array}  autoLogoffViolations   — [ { systemIdleSeconds, effectiveInactiveMs, timestamp }, ... ]
   * @param {number} longestInactivity      — ms
   * @param {number} autoLogoffTimeoutMs    — configured timeout in ms
   */
  constructor(
    metricsLog,
    complianceLog,
    uxLog,
    errorLog,
    coreWebVitals,
    longTasks,
    memorySnapshots,
    traceFilePath,
    reportsDir,
    fhirViolations,
    phiStorageFlags,
    phiUnencryptedTransmissions,
    jciViolations,
    autoLogoffViolations,
    longestInactivity,
    autoLogoffTimeoutMs
  ) {
    this.metrics = metricsLog;
    this.compliance = complianceLog;
    this.ux = uxLog;
    this.errors = errorLog;
    this.coreWebVitals = coreWebVitals || {};
    this.longTasks = longTasks || [];
    this.memorySnapshots = memorySnapshots || [];
    this.traceFilePath = traceFilePath || null;
    this.reportsDir = reportsDir;

    // Pillar 2 — Clinical Compliance
    this.fhirViolations = fhirViolations || [];
    this.phiStorageFlags = phiStorageFlags || [];
    this.phiUnencryptedTransmissions = phiUnencryptedTransmissions || [];
    this.jciViolations = jciViolations || [];
    this.autoLogoffViolations = autoLogoffViolations || [];
    this.longestInactivity = longestInactivity || 0;
    this.autoLogoffTimeoutMs = autoLogoffTimeoutMs || 900000;
  }

  /**
   * Generate a structured JSON report file in /reports
   * @returns {string} The absolute path to the generated report file
   */
  generateReport() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `inspector-report-${timestamp}.json`;
    const filePath = path.join(this.reportsDir, filename);

    const report = {
      meta: {
        title: 'Inspector — HIS/EMR Observability Report',
        version: '2.0.0',
        generatedAt: now.toISOString(),
        generatedAtFormatted: now.toLocaleString(),
        engine: 'Inspector Healthcare Browser (Electron/Chromium)',
        totalMetrics: this.metrics.length,
        totalComplianceChecks: this.compliance.length,
        totalUXChecks: this.ux.length,
        totalErrors: this.errors.length,
      },

      metrics: {
        summary: this._summarizeMetrics(),
        log: this.metrics.slice(-500),
      },

      compliance: {
        summary: this._summarizeCompliance(),
        byStandard: this._groupByStandard(),
        log: this.compliance.slice(-500),
      },

      ux: {
        summary: this._summarizeUX(),
        byCategory: this._groupByUXCategory(),
        log: this.ux.slice(-500),
      },

      errors: {
        summary: this._summarizeErrors(),
        bySource: this._groupByErrorSource(),
        log: this.errors.slice(-200),
      },

      // ════════════════════════════════════════
      //  Performance Section (Pillar 1)
      // ════════════════════════════════════════
      performance: {
        coreWebVitals: {
          FCP: this.coreWebVitals.FCP || null,
          LCP: this.coreWebVitals.LCP || null,
          CLS: this.coreWebVitals.CLS || null,
        },

        longTasks: {
          total: this.longTasks.length,
          tasks: this.longTasks.slice(-100).map(t => ({
            duration: t.duration,
            triggerElement: t.triggerElement || null,
            timestamp: t.timestamp,
            url: t.currentURL || '',
          })),
        },

        memorySnapshots: {
          totalSnapshots: this.memorySnapshots.length,
          leakWarnings: this._countLeakWarnings(),
          latestSnapshot: this.memorySnapshots.length > 0
            ? this.memorySnapshots[this.memorySnapshots.length - 1]
            : null,
          snapshots: this.memorySnapshots.slice(-50).map(s => ({
            timestamp: s.timestamp,
            processes: s.processes.map(p => ({
              type: p.processType,
              pid: p.pid,
              privateMemoryMB: p.privateMemory,
              workingSetMB: p.workingSet,
              cpuPercent: p.cpuPercent,
              flag: p.flag,
            })),
          })),
        },

        traceFilePath: this.traceFilePath,
      },

      // ════════════════════════════════════════
      //  Clinical Compliance Section (Pillar 2)
      // ════════════════════════════════════════
      clinicalCompliance: {
        fhirValidation: {
          totalViolations: this.fhirViolations.length,
          violations: this.fhirViolations.slice(-100).map(v => ({
            url: v.url,
            timestamp: v.timestamp,
            errorType: v.errorType,
            errorDetails: v.errorDetails,
          })),
          summary: this._summarizeFHIRViolations(),
        },

        phiStorageScan: {
          totalFlags: this.phiStorageFlags.length,
          flags: this.phiStorageFlags.slice(-100).map(f => ({
            key: f.key,
            pattern: f.pattern,
            store: f.store,
            timestamp: f.timestamp,
          })),
          byPattern: this._groupByPHIPattern(),
          byStore: this._groupByPHIStore(),
        },

        unencryptedTransmissions: {
          total: this.phiUnencryptedTransmissions.length,
          transmissions: this.phiUnencryptedTransmissions.slice(-100).map(t => ({
            url: t.url,
            timestamp: t.timestamp,
            statusCode: t.statusCode,
            resourceType: t.resourceType,
          })),
        },

        jciIpsg1: {
          totalViolations: this.jciViolations.length,
          violations: this.jciViolations.slice(-100).map(v => ({
            url: v.url,
            timestamp: v.timestamp,
            identifiersFound: v.identifiersFound,
            identifierTypes: v.identifierTypes,
          })),
        },

        autoLogoffAudit: {
          limitMinutes: this.autoLogoffTimeoutMs / 60000,
          totalViolations: this.autoLogoffViolations.length,
          longestInactivityMinutes: Math.round(this.longestInactivity / 60000),
          violations: this.autoLogoffViolations.slice(-50).map(v => ({
            systemIdleSeconds: v.systemIdleSeconds,
            effectiveInactiveMinutes: Math.round(v.effectiveInactiveMs / 60000),
            timestamp: v.timestamp,
          })),
        },
      },
    };

    const dir = this.reportsDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[ReportAggregator] Report saved: ${filePath}`);
    return filePath;
  }

  // ── Private helpers ──

  _countLeakWarnings() {
    let count = 0;
    for (const snap of this.memorySnapshots) {
      for (const proc of snap.processes) {
        if (proc.flag === 'MEMORY_LEAK_WARNING') count++;
      }
    }
    return count;
  }

  _summarizeMetrics() {
    if (this.metrics.length === 0) return { status: 'no_data' };

    const byTag = {};
    for (const m of this.metrics) {
      if (!byTag[m.tag]) byTag[m.tag] = [];
      byTag[m.tag].push(m.value);
    }

    const summary = {};
    for (const [tag, values] of Object.entries(byTag)) {
      const numeric = values.filter(v => typeof v === 'number');
      summary[tag] = {
        count: values.length,
        avg: numeric.length > 0
          ? (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2)
          : null,
        min: numeric.length > 0 ? Math.min(...numeric) : null,
        max: numeric.length > 0 ? Math.max(...numeric) : null,
      };
    }
    return summary;
  }

  _summarizeCompliance() {
    const passed = this.compliance.filter(c => c.passed).length;
    const failed = this.compliance.filter(c => !c.passed).length;
    const total = this.compliance.length;
    return {
      total,
      passed,
      failed,
      passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A',
    };
  }

  _groupByStandard() {
    const groups = {};
    for (const c of this.compliance) {
      if (!groups[c.standard]) groups[c.standard] = { passed: 0, failed: 0, total: 0 };
      groups[c.standard].total++;
      if (c.passed) groups[c.standard].passed++;
      else groups[c.standard].failed++;
    }
    for (const [key, val] of Object.entries(groups)) {
      val.passRate = ((val.passed / val.total) * 100).toFixed(1) + '%';
    }
    return groups;
  }

  _summarizeUX() {
    if (this.ux.length === 0) return { status: 'no_data' };
    const scores = this.ux.filter(u => typeof u.score === 'number').map(u => u.score);
    return {
      totalChecks: this.ux.length,
      avgScore: scores.length > 0
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        : null,
      minScore: scores.length > 0 ? Math.min(...scores) : null,
      maxScore: scores.length > 0 ? Math.max(...scores) : null,
    };
  }

  _groupByUXCategory() {
    const groups = {};
    for (const u of this.ux) {
      if (!groups[u.category]) groups[u.category] = { checks: 0, scores: [] };
      groups[u.category].checks++;
      if (typeof u.score === 'number') groups[u.category].scores.push(u.score);
    }
    for (const [key, val] of Object.entries(groups)) {
      val.avgScore = val.scores.length > 0
        ? (val.scores.reduce((a, b) => a + b, 0) / val.scores.length).toFixed(1)
        : null;
      delete val.scores;
    }
    return groups;
  }

  _summarizeErrors() {
    return {
      total: this.errors.length,
      bySeverity: {
        error: this.errors.filter(e => e.message.toLowerCase().includes('error')).length,
        warning: this.errors.filter(e => e.message.toLowerCase().includes('warn')).length,
        other: this.errors.length,
      },
    };
  }

  _groupByErrorSource() {
    const groups = {};
    for (const e of this.errors) {
      groups[e.source] = (groups[e.source] || 0) + 1;
    }
    return groups;
  }

  // ── FHIR-specific helpers ──

  _summarizeFHIRViolations() {
    if (this.fhirViolations.length === 0) return { status: 'no_violations' };

    const byType = {};
    for (const v of this.fhirViolations) {
      const t = v.errorType || 'UNKNOWN';
      if (!byType[t]) byType[t] = 0;
      byType[t]++;
    }
    return { byErrorType: byType };
  }

  _groupByPHIPattern() {
    const groups = {};
    for (const f of this.phiStorageFlags) {
      const p = f.pattern || 'UNKNOWN';
      if (!groups[p]) groups[p] = 0;
      groups[p]++;
    }
    return groups;
  }

  _groupByPHIStore() {
    const groups = {};
    for (const f of this.phiStorageFlags) {
      const s = f.store || 'UNKNOWN';
      if (!groups[s]) groups[s] = 0;
      groups[s]++;
    }
    return groups;
  }
}

module.exports = { ReportAggregator };
