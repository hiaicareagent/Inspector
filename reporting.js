const fs = require('fs');
const path = require('path');

class ReportAggregator {
  /**
   * @param {Array} metricsLog   - Array of { tag, value, metadata, timestamp }
   * @param {Array} complianceLog - Array of { standard, check, passed, details, timestamp }
   * @param {Array} uxLog         - Array of { category, score, element, note, timestamp }
   * @param {Array} errorLog      - Array of { source, message, stack, timestamp }
   * @param {string} reportsDir   - Path to the /reports output directory
   */
  constructor(metricsLog, complianceLog, uxLog, errorLog, reportsDir) {
    this.metrics = metricsLog;
    this.compliance = complianceLog;
    this.ux = uxLog;
    this.errors = errorLog;
    this.reportsDir = reportsDir;
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
        log: this.metrics.slice(-500), // last 500 entries
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
}

module.exports = { ReportAggregator };
