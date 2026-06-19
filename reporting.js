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
   * @param {Array}  fhirViolations
   * @param {Array}  phiStorageFlags
   * @param {Array}  phiUnencryptedTransmissions
   * @param {Array}  jciViolations
   * @param {Array}  autoLogoffViolations
   * @param {number} longestInactivity
   * @param {number} autoLogoffTimeoutMs
   * @param {Array}  rageClicks
   * @param {Array}  deadClicks
   * @param {Array}  layoutShifts
   * @param {Object} accessibilityAudit
   * @param {Array}  consoleErrors       — [ { level, message, sourceURL, lineNumber, currentURL, timestamp, category }, ... ]
   * @param {Array}  consoleWarnings     — same shape as consoleErrors
   * @param {Array}  rendererCrashes     — [ { reason, exitCode, type, currentURL, timestamp }, ... ]
   * @param {string} sessionStartTime
   * @param {string} electronVersion
   * @param {string} targetUrl
   */
  constructor(
    metricsLog, complianceLog, uxLog, errorLog,
    coreWebVitals, longTasks, memorySnapshots, traceFilePath, reportsDir,
    fhirViolations, phiStorageFlags, phiUnencryptedTransmissions,
    jciViolations, autoLogoffViolations, longestInactivity, autoLogoffTimeoutMs,
    rageClicks, deadClicks, layoutShifts, accessibilityAudit,
    consoleErrors, consoleWarnings, rendererCrashes,
    sessionStartTime, electronVersion, targetUrl,
    completedWorkflows, abandonedWorkflows, slowWorkflows,
    navigationConfusion, concurrentPatientSessions,
    expiredTokenRequests, tokenExpiryWarnings, concurrentSessionAnomalies,
    privilegeScopeExceeded, reauthenticationBypassed, loginEvents, logoutEvents
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

    this.fhirViolations = fhirViolations || [];
    this.phiStorageFlags = phiStorageFlags || [];
    this.phiUnencryptedTransmissions = phiUnencryptedTransmissions || [];
    this.jciViolations = jciViolations || [];
    this.autoLogoffViolations = autoLogoffViolations || [];
    this.longestInactivity = longestInactivity || 0;
    this.autoLogoffTimeoutMs = autoLogoffTimeoutMs || 900000;

    this.rageClicks = rageClicks || [];
    this.deadClicks = deadClicks || [];
    this.layoutShifts = layoutShifts || [];
    this.accessibilityAudit = accessibilityAudit || { score: null, totalViolations: 0, criticalViolations: [], seriousViolations: [], moderateViolations: [] };

    // Pillar 4 — Telemetry
    this.consoleErrors = consoleErrors || [];
    this.consoleWarnings = consoleWarnings || [];
    this.rendererCrashes = rendererCrashes || [];
    this.sessionStartTime = sessionStartTime || new Date().toISOString();
    this.electronVersion = electronVersion || process.versions.electron;
    this.targetUrl = targetUrl || '';

    // Pillar 5 — Workflow Intelligence
    this.completedWorkflows = completedWorkflows || [];
    this.abandonedWorkflows = abandonedWorkflows || [];
    this.slowWorkflows = slowWorkflows || [];
    this.navigationConfusion = navigationConfusion || [];
    this.concurrentPatientSessions = concurrentPatientSessions || [];

    // Pillar 6 — Session Integrity
    this.expiredTokenRequests = expiredTokenRequests || [];
    this.tokenExpiryWarnings = tokenExpiryWarnings || [];
    this.concurrentSessionAnomalies = concurrentSessionAnomalies || [];
    this.privilegeScopeExceeded = privilegeScopeExceeded || [];
    this.reauthenticationBypassed = reauthenticationBypassed || [];
    this.loginEvents = loginEvents || [];
    this.logoutEvents = logoutEvents || [];
  }

  /** ─── Compute Scores ─── */

  _calcComplianceScore() {
    let s = 100;
    s -= this.fhirViolations.length * 20;
    s -= this.phiStorageFlags.length * 30;
    s -= this.jciViolations.length * 25;
    s -= this.phiUnencryptedTransmissions.length * 30;
    s -= this.autoLogoffViolations.length * 20;
    s -= (this.concurrentPatientSessions || []).length * 20;
    // Pillar 6 deductions
    s -= (this.expiredTokenRequests || []).length * 30;
    s -= (this.concurrentSessionAnomalies || []).length * 40;
    s -= (this.privilegeScopeExceeded || []).length * 35;
    s -= (this.reauthenticationBypassed || []).length * 50;
    return Math.max(0, Math.min(100, s));
  }

  _calcUXScore() {
    let s = 100;
    s -= this.rageClicks.length * 10;
    s -= this.deadClicks.length * 5;
    s -= this.layoutShifts.filter(x => x.isSignificant).length * 15;
    s -= (this.accessibilityAudit.criticalViolations || []).length * 10;
    s -= (this.accessibilityAudit.seriousViolations || []).length * 5;
    s -= (this.abandonedWorkflows || []).length * 15;
    s -= (this.navigationConfusion || []).length * 10;
    return Math.max(0, Math.min(100, s));
  }

  _calcPerformanceScore() {
    let s = 100;
    if (this.coreWebVitals.LCP && this.coreWebVitals.LCP.value > 2500) s -= 10;
    const slowTasks = this.longTasks.filter(t => t.duration > 100);
    s -= slowTasks.length * 5;
    let memWarnings = 0;
    for (const snap of this.memorySnapshots) {
      for (const proc of snap.processes) {
        if (proc.flag === 'MEMORY_LEAK_WARNING') memWarnings++;
      }
    }
    s -= memWarnings * 15;
    return Math.max(0, Math.min(100, s));
  }

  _extractCriticalFlags() {
    const flags = [];
    for (const v of this.fhirViolations) {
      if (v.errorType === 'INVALID_JSON' || v.errorType === 'MISSING_RESOURCE_TYPE') {
        flags.push({ severity: 'critical', type: v.errorType, message: v.errorDetails, timestamp: v.timestamp });
      }
    }
    for (const p of this.phiStorageFlags) {
      flags.push({ severity: 'critical', type: 'PHI_IN_STORAGE', message: `${p.pattern} found in ${p.store}`, timestamp: p.timestamp });
    }
    for (const t of this.phiUnencryptedTransmissions) {
      flags.push({ severity: 'critical', type: 'PHI_UNENCRYPTED', message: `Unencrypted PHI: ${t.url}`, timestamp: t.timestamp });
    }
    for (const j of this.jciViolations) {
      flags.push({ severity: 'critical', type: 'JCI_IPSG1', message: `Only ${j.identifiersFound} patient identifiers visible`, timestamp: j.timestamp });
    }
    for (const a of this.autoLogoffViolations) {
      flags.push({ severity: 'warning', type: 'AUTOLOGOFF_FAILURE', message: `Inactive ${Math.round(a.effectiveInactiveMs/60000)}min`, timestamp: a.timestamp });
    }
    for (const s of this.layoutShifts) {
      if (s.isSignificant) {
        flags.push({ severity: 'warning', type: 'SIGNIFICANT_LAYOUT_SHIFT', message: `${s.diffPercent}% visual change`, timestamp: s.timestamp });
      }
    }
    for (const conErr of this.consoleErrors) {
      flags.push({ severity: 'warning', type: 'CONSOLE_ERROR', message: conErr.message.substring(0, 200), timestamp: conErr.timestamp });
    }
    for (const c of this.rendererCrashes) {
      flags.push({ severity: 'critical', type: c.type, message: c.reason || 'Unresponsive', timestamp: c.timestamp });
    }
    // Pillar 6 — Session Integrity flags
    for (const e of (this.expiredTokenRequests || [])) {
      flags.push({ severity: 'critical', type: 'EXPIRED_TOKEN_REQUEST', message: `Expired token used: ${e.url}`, timestamp: e.requestTimestamp || e.timestamp });
    }
    for (const c of (this.concurrentSessionAnomalies || [])) {
      flags.push({ severity: 'critical', type: 'CONCURRENT_SESSION_ANOMALY', message: `Same token from ${c.userAgents?.length || 0} different user-agents`, timestamp: c.timestamp });
    }
    for (const p of (this.privilegeScopeExceeded || [])) {
      flags.push({ severity: 'critical', type: 'PRIVILEGE_SCOPE_EXCEEDED', message: `Role "${p.role}" accessed ${p.unexpectedResourceType}`, timestamp: p.timestamp });
    }
    for (const r of (this.reauthenticationBypassed || [])) {
      flags.push({ severity: 'critical', type: 'REAUTHENTICATION_BYPASSED', message: `Session resumed ${Math.round(r.timeSinceLogoffMs/1000)}s after logoff without re-auth`, timestamp: r.timestamp });
    }
    // Deduplicate by type+message
    const seen = new Set();
    return flags.filter(f => {
      const key = f.type + '|' + f.message;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
  }

  /** ─── Generate Unified Report ─── */

  generateReport() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `inspector-report-${timestamp}.json`;
    const filePath = path.join(this.reportsDir, filename);

    const sessionDurationMs = new Date() - new Date(this.sessionStartTime);
    const sessionMinutes = Math.floor(sessionDurationMs / 60000);
    const sessionSeconds = Math.floor((sessionDurationMs % 60000) / 1000);

    const complianceScore = this._calcComplianceScore();
    const uxScore = this._calcUXScore();
    const performanceScore = this._calcPerformanceScore();
    const criticalFlags = this._extractCriticalFlags();

    const report = {
      meta: {
        title: 'Inspector — HIS/EMR Observability Report',
        version: '4.0.0',
        generatedAt: now.toISOString(),
        generatedAtFormatted: now.toLocaleString(),
        sessionStartTime: this.sessionStartTime,
        sessionDuration: `${sessionMinutes}m ${sessionSeconds}s`,
        sessionDurationMs,
        electronVersion: this.electronVersion,
        targetURL: this.targetUrl,
        engine: 'Inspector Healthcare Browser (Electron/Chromium)',
        totalMetrics: this.metrics.length,
        totalComplianceChecks: this.compliance.length,
        totalUXChecks: this.ux.length,
        totalErrors: this.errors.length,
      },

      // ════════════════════════════════════════
      // Summary (Unified Scoring)
      // ════════════════════════════════════════
      summary: {
        scores: {
          compliance: { value: complianceScore, label: 'Compliance Score', color: complianceScore >= 80 ? 'green' : complianceScore >= 50 ? 'amber' : 'red' },
          ux: { value: uxScore, label: 'UX Score', color: uxScore >= 80 ? 'green' : uxScore >= 50 ? 'amber' : 'red' },
          performance: { value: performanceScore, label: 'Performance Score', color: performanceScore >= 80 ? 'green' : performanceScore >= 50 ? 'amber' : 'red' },
        },
        overall: Math.round((complianceScore + uxScore + performanceScore) / 3),
        totalIssues: criticalFlags.length,
        criticalFlags,
      },

      // ════════════════════════════════════════
      // Performance Section (Pillar 1)
      // ════════════════════════════════════════
      performance: {
        score: performanceScore,
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
            ? this.memorySnapshots[this.memorySnapshots.length - 1] : null,
          snapshots: this.memorySnapshots.slice(-50).map(s => ({
            timestamp: s.timestamp,
            processes: s.processes.map(p => ({
              type: p.processType, pid: p.pid,
              privateMemoryMB: p.privateMemory, workingSetMB: p.workingSet,
              cpuPercent: p.cpuPercent, flag: p.flag,
            })),
          })),
        },
        traceFilePath: this.traceFilePath,
      },

      // ════════════════════════════════════════
      // Session Integrity Section (Pillar 6)
      // ════════════════════════════════════════
      sessionIntegrity: {
        expiredTokenRequests: {
          total: this.expiredTokenRequests.length,
          entries: this.expiredTokenRequests.slice(-50).map(e => ({
            url: e.url, tokenExpiredAt: e.tokenExpiredAt,
            requestTimestamp: e.requestTimestamp || e.timestamp,
          })),
        },
        tokenExpiryWarnings: {
          total: this.tokenExpiryWarnings.length,
          entries: this.tokenExpiryWarnings.slice(-50).map(e => ({
            url: e.url, tokenExpiresAt: e.tokenExpiresAt,
            expiresInMinutes: e.expiresInMinutes,
          })),
        },
        concurrentSessionAnomalies: {
          total: this.concurrentSessionAnomalies.length,
          anomalies: this.concurrentSessionAnomalies.slice(-50).map(a => ({
            tokenHash: (a.tokenHash || '').substring(0, 12) + '...',
            userAgents: a.userAgents,
            timestamp: a.timestamp,
          })),
        },
        privilegeScopeExceeded: {
          total: this.privilegeScopeExceeded.length,
          entries: this.privilegeScopeExceeded.slice(-50).map(p => ({
            role: p.role, unexpectedResourceType: p.unexpectedResourceType,
            url: p.url, timestamp: p.timestamp,
          })),
        },
        reauthenticationBypassed: {
          total: this.reauthenticationBypassed.length,
          entries: this.reauthenticationBypassed.slice(-50).map(r => ({
            lastLogoffTime: r.lastLogoffTime,
            timeSinceLogoffMs: r.timeSinceLogoffMs,
            subsequentRequestUrl: r.subsequentRequestUrl,
            timestamp: r.timestamp,
          })),
        },
        loginEvents: {
          total: this.loginEvents.length,
          events: this.loginEvents.slice(-50).map(l => ({ url: l.url, timestamp: l.timestamp })),
        },
        logoutEvents: {
          total: this.logoutEvents.length,
          events: this.logoutEvents.slice(-50).map(l => ({ url: l.url, timestamp: l.timestamp })),
        },
      },

      // ════════════════════════════════════════
      // Clinical Compliance Section (Pillar 2)
      // ════════════════════════════════════════
      compliance: {
        score: complianceScore,
        summary: this._summarizeCompliance(),
        byStandard: this._groupByStandard(),
        log: this.compliance.slice(-500),
        fhirValidation: {
          totalViolations: this.fhirViolations.length,
          violations: this.fhirViolations.slice(-100).map(v => ({
            url: v.url, timestamp: v.timestamp, errorType: v.errorType, errorDetails: v.errorDetails,
          })),
          summary: this._summarizeFHIRViolations(),
        },
        phiStorageScan: {
          totalFlags: this.phiStorageFlags.length,
          flags: this.phiStorageFlags.slice(-100).map(f => ({
            key: f.key, pattern: f.pattern, store: f.store, timestamp: f.timestamp,
          })),
          byPattern: this._groupByPHIPattern(),
          byStore: this._groupByPHIStore(),
        },
        unencryptedTransmissions: {
          total: this.phiUnencryptedTransmissions.length,
          transmissions: this.phiUnencryptedTransmissions.slice(-100).map(t => ({
            url: t.url, timestamp: t.timestamp, statusCode: t.statusCode, resourceType: t.resourceType,
          })),
        },
        jciIpsg1: {
          totalViolations: this.jciViolations.length,
          violations: this.jciViolations.slice(-100).map(v => ({
            url: v.url, timestamp: v.timestamp, identifiersFound: v.identifiersFound, identifierTypes: v.identifierTypes,
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

      // ════════════════════════════════════════
      // UX & Accessibility Section (Pillar 3)
      // ════════════════════════════════════════
      ux: {
        score: uxScore,
        summary: this._summarizeUX(),
        byCategory: this._groupByUXCategory(),
        log: this.ux.slice(-500),
        rageClicks: {
          total: this.rageClicks.length,
          clicks: this.rageClicks.slice(-100).map(c => ({
            x: c.x, y: c.y, element: c.element || null,
            timestamp: c.timestamp, clickCount: c.clickCount,
          })),
        },
        deadClicks: {
          total: this.deadClicks.length,
          clicks: this.deadClicks.slice(-100).map(c => ({
            element: c.element || null, timestamp: c.timestamp,
          })),
        },
        layoutShifts: {
          total: this.layoutShifts.length,
          significantCount: this.layoutShifts.filter(s => s.isSignificant).length,
          shifts: this.layoutShifts.slice(-50).map(s => ({
            timestamp: s.timestamp, shiftValue: s.shiftValue,
            diffPercent: s.diffPercent, isSignificant: s.isSignificant,
            screenshotBefore: s.screenshotBefore || null,
            screenshotAfter: s.screenshotAfter || null,
          })),
        },
        accessibilityAudit: {
          score: this.accessibilityAudit.score,
          totalViolations: this.accessibilityAudit.totalViolations,
          critical: {
            count: (this.accessibilityAudit.criticalViolations || []).length,
            violations: (this.accessibilityAudit.criticalViolations || []).slice(-20).map(v => ({
              id: v.id, impact: v.impact, description: v.description,
              help: v.help, helpUrl: v.helpUrl, nodes: v.nodes,
            })),
          },
          serious: {
            count: (this.accessibilityAudit.seriousViolations || []).length,
            violations: (this.accessibilityAudit.seriousViolations || []).slice(-20).map(v => ({
              id: v.id, impact: v.impact, description: v.description,
              help: v.help, helpUrl: v.helpUrl, nodes: v.nodes,
            })),
          },
          moderate: {
            count: (this.accessibilityAudit.moderateViolations || []).length,
            violations: (this.accessibilityAudit.moderateViolations || []).slice(-20).map(v => ({
              id: v.id, impact: v.impact, description: v.description,
              help: v.help, helpUrl: v.helpUrl, nodes: v.nodes,
            })),
          },
          url: this.accessibilityAudit.url || null,
          timestamp: this.accessibilityAudit.timestamp || null,
        },
      },

      // ════════════════════════════════════════
      // Workflow Intelligence Section (Pillar 5)
      // ════════════════════════════════════════
      workflowIntelligence: {
        completedWorkflows: {
          total: this.completedWorkflows.length,
          workflows: this.completedWorkflows.slice(-50).map(w => ({
            workflowType: w.workflowType,
            duration: w.duration,
            stepsVisited: w.stepsVisited,
            patientContext: w.patientContext || '',
            timestamp: w.timestamp,
          })),
        },
        abandonedWorkflows: {
          total: this.abandonedWorkflows.length,
          workflows: this.abandonedWorkflows.slice(-50).map(w => ({
            workflowType: w.workflowType,
            lastCompletedStep: w.lastCompletedStep,
            abandonedAt: w.abandonedAt,
            duration: w.duration,
            patientContext: w.patientContext || '',
            timestamp: w.timestamp,
          })),
        },
        slowWorkflows: {
          total: this.slowWorkflows.length,
          workflows: this.slowWorkflows.slice(-50).map(w => ({
            workflowType: w.workflowType,
            duration: w.duration,
            threshold: w.threshold,
            exceededBy: Math.round((w.duration - w.threshold) / 60) + 'm',
            patientContext: w.patientContext || '',
            timestamp: w.timestamp,
          })),
        },
        navigationConfusion: {
          total: this.navigationConfusion.length,
          incidents: this.navigationConfusion.slice(-50).map(n => ({
            workflowType: n.workflowType,
            backtrackCount: n.backtrackCount,
            sequence: (n.sequence || []).slice(-10),
            timestamp: n.timestamp,
          })),
        },
        concurrentPatientSessions: {
          total: this.concurrentPatientSessions.length,
          sessions: this.concurrentPatientSessions.slice(-50).map(s => ({
            patientID: s.patientID,
            tabCount: s.tabCount,
            timestamp: s.timestamp,
          })),
        },
      },

      // ════════════════════════════════════════
      // Telemetry Section (Pillar 4)
      // ════════════════════════════════════════
      telemetry: {
        consoleErrors: {
          total: this.consoleErrors.length,
          entries: this.consoleErrors.slice(-200).map(e => ({
            level: e.level, message: e.message.substring(0, 500),
            sourceURL: e.sourceURL, lineNumber: e.lineNumber,
            currentURL: e.currentURL, timestamp: e.timestamp,
          })),
        },
        consoleWarnings: {
          total: this.consoleWarnings.length,
          entries: this.consoleWarnings.slice(-200).map(e => ({
            level: e.level, message: e.message.substring(0, 500),
            sourceURL: e.sourceURL, lineNumber: e.lineNumber,
            currentURL: e.currentURL, timestamp: e.timestamp,
          })),
        },
        rendererCrashes: {
          total: this.rendererCrashes.length,
          entries: this.rendererCrashes.map(e => ({
            type: e.type, reason: e.reason || null,
            exitCode: e.exitCode || null,
            currentURL: e.currentURL, timestamp: e.timestamp,
          })),
        },
      },
    };

    const dir = this.reportsDir;
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[ReportAggregator] Unified report saved: ${filePath}`);
    return filePath;
  }

  // ── Private helpers ──

  _countLeakWarnings() {
    let count = 0;
    for (const snap of this.memorySnapshots) {
      for (const proc of snap.processes) { if (proc.flag === 'MEMORY_LEAK_WARNING') count++; }
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
        avg: numeric.length > 0 ? (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2) : null,
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
    return { total, passed, failed, passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A' };
  }

  _groupByStandard() {
    const groups = {};
    for (const c of this.compliance) {
      if (!groups[c.standard]) groups[c.standard] = { passed: 0, failed: 0, total: 0 };
      groups[c.standard].total++;
      if (c.passed) groups[c.standard].passed++;
      else groups[c.standard].failed++;
    }
    // Add session integrity by type (JWT, HIPAA for concurrent sessions/reauth)
    const authGroups = {
      'JWT': { expired: this.expiredTokenRequests.length, warnings: this.tokenExpiryWarnings.length, scope: this.privilegeScopeExceeded.length },
      'HIPAA_SESSION': { concurrent: this.concurrentSessionAnomalies.length, reauthBypass: this.reauthenticationBypassed.length },
    };
    for (const [key, val] of Object.entries(groups)) {
      val.passRate = ((val.passed / val.total) * 100).toFixed(1) + '%';
    }
    return { ...groups, _authSummary: authGroups };
  }

  _summarizeUX() {
    if (this.ux.length === 0) return { status: 'no_data' };
    const scores = this.ux.filter(u => typeof u.score === 'number').map(u => u.score);
    return {
      totalChecks: this.ux.length,
      avgScore: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null,
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
        ? (val.scores.reduce((a, b) => a + b, 0) / val.scores.length).toFixed(1) : null;
      delete val.scores;
    }
    return groups;
  }

  _summarizeErrors() {
    return {
      total: this.errors.length,
      bySource: this._groupByErrorSource(),
    };
  }

  _groupByErrorSource() {
    const groups = {};
    for (const e of this.errors) { groups[e.source] = (groups[e.source] || 0) + 1; }
    return groups;
  }

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
    for (const f of this.phiStorageFlags) { const p = f.pattern || 'UNKNOWN'; groups[p] = (groups[p] || 0) + 1; }
    return groups;
  }

  _groupByPHIStore() {
    const groups = {};
    for (const f of this.phiStorageFlags) { const s = f.store || 'UNKNOWN'; groups[s] = (groups[s] || 0) + 1; }
    return groups;
  }
}

module.exports = { ReportAggregator };
