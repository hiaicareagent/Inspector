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
    privilegeScopeExceeded, reauthenticationBypassed, loginEvents, logoutEvents,
    clinicalSLABreaches, nonClinicalSLABreaches, highErrorRateEndpoints,
    clinicalAPIErrors, silentFailures, thirdPartyDependencies,
    staleDataFlags, valueNotRendered, valueTruncated,
    allergyAlertNotVisible, formPrepopulationMismatches,
    networkConditionTests, offlineWarningMissing, reconnectionSyncFailures,
    serviceWorkerAudit, criticalCacheMissing, degradedModeFreezes,
    scoreRegressions, newCriticalIssues, persistentDegradations
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

    // Pillar 7 — API Health
    this.clinicalSLABreaches = clinicalSLABreaches || [];
    this.nonClinicalSLABreaches = nonClinicalSLABreaches || [];
    this.highErrorRateEndpoints = highErrorRateEndpoints || [];
    this.clinicalAPIErrors = clinicalAPIErrors || [];
    this.silentFailures = silentFailures || [];
    this.thirdPartyDependencies = thirdPartyDependencies || new Map();

    // Pillar 8 — Data Integrity
    this.staleDataFlags = staleDataFlags || [];
    this.valueNotRendered = valueNotRendered || [];
    this.valueTruncated = valueTruncated || [];
    this.allergyAlertNotVisible = allergyAlertNotVisible || [];
    this.formPrepopulationMismatches = formPrepopulationMismatches || [];

    // Pillar 9 — Offline / Resilience
    this.networkConditionTests = networkConditionTests || [];
    this.offlineWarningMissing = offlineWarningMissing || [];
    this.reconnectionSyncFailures = reconnectionSyncFailures || [];
    this.serviceWorkerAudit = serviceWorkerAudit || [];
    this.criticalCacheMissing = criticalCacheMissing || [];
    this.degradedModeFreezes = degradedModeFreezes || [];

    // Pillar 10 — Longitudinal Trends
    this.scoreRegressions = scoreRegressions || [];
    this.newCriticalIssues = newCriticalIssues || [];
    this.persistentDegradations = persistentDegradations || [];
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
    // Pillar 7 deductions
    s -= (this.silentFailures || []).length * 25;
    s -= (this.highErrorRateEndpoints || []).length * 20;
    // Pillar 8 deductions
    s -= (this.allergyAlertNotVisible || []).length * 40;
    s -= (this.valueTruncated || []).length * 30;
    s -= (this.formPrepopulationMismatches || []).length * 35;
    // Pillar 9 deductions
    s -= (this.offlineWarningMissing || []).length * 20;
    s -= (this.reconnectionSyncFailures || []).length * 25;
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
    // Pillar 7 deductions
    s -= (this.clinicalSLABreaches || []).length * 15;
    s -= (this.nonClinicalSLABreaches || []).length * 5;
    // Pillar 8 deductions
    s -= (this.staleDataFlags || []).length * 10;
    // Pillar 9 deductions
    s -= (this.degradedModeFreezes || []).length * 15;
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
    // Pillar 7 — API Health flags
    for (const s of (this.silentFailures || [])) {
      flags.push({ severity: 'critical', type: 'SILENT_FAILURE', message: `${s.endpoint} returned ${s.statusCode} with no error UI`, timestamp: s.timestamp });
    }
    for (const h of (this.highErrorRateEndpoints || [])) {
      flags.push({ severity: 'warning', type: 'HIGH_ERROR_RATE', message: `${h.endpoint} ${h.errorRate}% error rate`, timestamp: h.timestamp });
    }
    for (const c of (this.clinicalAPIErrors || [])) {
      flags.push({ severity: 'warning', type: 'CLINICAL_API_ERROR', message: `${c.endpoint} returned ${c.statusCode}`, timestamp: c.timestamp });
    }
    for (const b of (this.clinicalSLABreaches || [])) {
      flags.push({ severity: 'warning', type: 'CLINICAL_SLA_BREACH', message: `${b.endpoint} took ${b.duration}ms (threshold ${b.threshold}ms)`, timestamp: b.timestamp });
    }
    // Pillar 9 — Offline flags
    for (const o of (this.offlineWarningMissing || [])) {
      flags.push({ severity: 'critical', type: 'OFFLINE_WARNING_MISSING', message: 'No offline warning shown for ' + Math.round((o.offlineDurationMs||0)/1000) + 's', timestamp: o.timestamp });
    }
    for (const r of (this.reconnectionSyncFailures || [])) {
      flags.push({ severity: 'critical', type: 'RECONNECTION_SYNC_FAILURE', message: 'No data refresh after reconnection (' + Math.round((r.outageDuration||0)/1000) + 's outage)', timestamp: r.timestamp });
    }
    for (const d of (this.degradedModeFreezes || [])) {
      flags.push({ severity: 'warning', type: 'DEGRADED_MODE_SILENT_FREEZE', message: 'Request to ' + (d.endpoint||'') + ' timed out >10s without loading indicator', timestamp: d.timestamp });
    }
    for (const c of (this.criticalCacheMissing || [])) {
      flags.push({ severity: 'warning', type: 'NO_OFFLINE_CACHE_FOR_CRITICAL_DATA', message: 'Missing cache keys: ' + (c.missingKeys||[]).join(', '), timestamp: c.timestamp });
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

  /** ─── Cluster points within 40px radius (for heatmap) ─── */
  _clusterPoints(points) {
    const clusters = [];
    for (const p of points) {
      let added = false;
      for (const c of clusters) {
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 40) {
          c.count++;
          if (p.element) c.topElement = p.element;
          if (p.session) c.sessions.push(p.session);
          added = true;
          break;
        }
      }
      if (!added) {
        clusters.push({ x: p.x, y: p.y, count: 1, topElement: p.element || null, sessions: p.session ? [p.session] : [] });
      }
    }
    return clusters.sort((a, b) => b.count - a.count);
  }

  /** ─── Generate heatmap data file ─── */
  generateHeatmapData() {
    const rageClickPoints = (this.rageClicks || []).map(c => ({ x: c.x || 0, y: c.y || 0, element: c.element ? (c.element.tag || c.element.id || '') : '', session: this.sessionStartTime }));
    const deadClickPoints = (this.deadClicks || []).map(c => ({ x: (c.element && c.element.x) || 0, y: (c.element && c.element.y) || 0, element: c.element ? (c.element.tag || c.element.id || '') : '', session: this.sessionStartTime }));

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-');
    const heatmapPath = path.join(this.reportsDir, `heatmap-${ts}.json`);

    const heatmapData = {
      rageClickClusters: this._clusterPoints(rageClickPoints),
      deadClickClusters: this._clusterPoints(deadClickPoints),
      generatedAt: now.toISOString(),
    };

    try {
      fs.writeFileSync(heatmapPath, JSON.stringify(heatmapData, null, 2), 'utf-8');
      console.log(`[ReportAggregator] Heatmap data saved: ${heatmapPath}`);
      return heatmapPath;
    } catch (e) {
      console.warn('[ReportAggregator] Could not save heatmap:', e.message);
      return null;
    }
  }

  /** ─── Generate trend data file (score history chart data) ─── */
  generateTrendData() {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-');
    const trendPath = path.join(this.reportsDir, `trends-${ts}.json`);

    // Load previous sessions from index.json
    let sessions = [];
    try {
      const indexPath = path.join(this.reportsDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        sessions = index.reports.map(r => ({
          date: r.generatedAt,
          complianceScore: r.scores.compliance,
          uxScore: r.scores.ux,
          performanceScore: r.scores.performance,
        }));
      }
    } catch (e) {}
    // Add current session
    sessions.push({ date: now.toISOString(), complianceScore: this._calcComplianceScore(), uxScore: this._calcUXScore(), performanceScore: this._calcPerformanceScore() });

    const regressions = (this.scoreRegressions || []).map(r => ({
      metric: r.metric, previousScore: r.previousScore, newScore: r.newScore, delta: r.delta, timestamp: r.timestamp,
    }));

    const degs = (this.persistentDegradations || []).map(d => ({
      metric: d.metric, trend: d.trend, deltaFromBaseline: d.deltaFromBaseline, sessionsAnalysed: d.sessionsAnalysed, timestamp: d.timestamp,
    }));

    const newIssues = (this.newCriticalIssues || []).map(n => ({
      type: n.type, message: n.message, timestamp: n.timestamp,
    }));

    const trendData = {
      sessions: sessions,
      regressions: regressions,
      persistentDegradations: degs,
      newCriticalIssues: newIssues,
      generatedAt: now.toISOString(),
    };

    try {
      fs.writeFileSync(trendPath, JSON.stringify(trendData, null, 2), 'utf-8');
      console.log(`[ReportAggregator] Trend data saved: ${trendPath}`);
      return trendPath;
    } catch (e) {
      console.warn('[ReportAggregator] Could not save trend data:', e.message);
      return null;
    }
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
      // API Health Section (Pillar 7)
      // ════════════════════════════════════════
      apiHealth: {
        clinicalSLABreaches: {
          total: this.clinicalSLABreaches.length,
          breaches: this.clinicalSLABreaches.slice(-100).map(b => ({
            url: b.url, duration: b.duration, endpoint: b.endpoint,
            threshold: b.threshold, timestamp: b.timestamp,
          })),
        },
        nonClinicalSLABreaches: {
          total: this.nonClinicalSLABreaches.length,
          breaches: this.nonClinicalSLABreaches.slice(-100).map(b => ({
            url: b.url, duration: b.duration, endpoint: b.endpoint,
            threshold: b.threshold, timestamp: b.timestamp,
          })),
        },
        highErrorRateEndpoints: {
          total: this.highErrorRateEndpoints.length,
          endpoints: this.highErrorRateEndpoints.slice(-50).map(h => ({
            endpoint: h.endpoint, errorRate: h.errorRate,
            sampleSize: h.sampleSize, recentErrors: (h.recentErrors || []).slice(-5),
            timestamp: h.timestamp,
          })),
        },
        clinicalAPIErrors: {
          total: this.clinicalAPIErrors.length,
          errors: this.clinicalAPIErrors.slice(-100).map(e => ({
            endpoint: e.endpoint, statusCode: e.statusCode,
            url: e.url, timestamp: e.timestamp,
          })),
        },
        silentFailures: {
          total: this.silentFailures.length,
          failures: this.silentFailures.slice(-50).map(f => ({
            endpoint: f.endpoint, statusCode: f.statusCode,
            url: f.url, noUIErrorDetected: f.noUIErrorDetected,
            timestamp: f.timestamp,
          })),
        },
        thirdPartyDependencies: (() => {
          const deps = [];
          if (this.thirdPartyDependencies && this.thirdPartyDependencies.forEach) {
            this.thirdPartyDependencies.forEach((dep, hostname) => {
              const avgTime = dep.responseTimes.length > 0
                ? Math.round(dep.responseTimes.reduce((a, b) => a + b, 0) / dep.responseTimes.length)
                : 0;
              deps.push({
                hostname, requestCount: dep.requestCount,
                avgResponseTime: avgTime, errorCount: dep.errorCount,
                isSlow: avgTime > 500,
                isFailing: dep.errorCount > 2,
              });
            });
          }
          return { total: deps.length, dependencies: deps.sort((a, b) => b.avgResponseTime - a.avgResponseTime) };
        })(),
        slowDependencies: (() => {
          const slow = [];
          if (this.thirdPartyDependencies && this.thirdPartyDependencies.forEach) {
            this.thirdPartyDependencies.forEach((dep, hostname) => {
              const avgTime = dep.responseTimes.length > 0
                ? Math.round(dep.responseTimes.reduce((a, b) => a + b, 0) / dep.responseTimes.length)
                : 0;
              if (avgTime > 500) {
                slow.push({ hostname, avgResponseTime: avgTime, requestCount: dep.requestCount, errorCount: dep.errorCount });
              }
            });
          }
          return { total: slow.length, dependencies: slow };
        })(),
        failingDependencies: (() => {
          const failing = [];
          if (this.thirdPartyDependencies && this.thirdPartyDependencies.forEach) {
            this.thirdPartyDependencies.forEach((dep, hostname) => {
              if (dep.errorCount > 2) {
                failing.push({ hostname, errorCount: dep.errorCount, requestCount: dep.requestCount });
              }
            });
          }
          return { total: failing.length, dependencies: failing };
        })(),
        endpointSummary: (() => {
          // Provide summary from endpointStats — passed as clinicalSLABreaches-derived
          const endpoints = {};
          for (const b of this.clinicalSLABreaches) {
            if (!endpoints[b.endpoint]) endpoints[b.endpoint] = { slaBreaches: 0, avgDuration: 0 };
            endpoints[b.endpoint].slaBreaches++;
          }
          for (const b of this.nonClinicalSLABreaches) {
            if (!endpoints[b.endpoint]) endpoints[b.endpoint] = { slaBreaches: 0, avgDuration: 0 };
            endpoints[b.endpoint].slaBreaches++;
          }
          return Object.entries(endpoints).map(([name, data]) => ({ endpoint: name, ...data }));
        })(),
      },

      // ════════════════════════════════════════
      // Data Integrity Section (Pillar 8)
      // ════════════════════════════════════════
      dataIntegrity: {
        staleDataFlags: {
          total: this.staleDataFlags.length,
          flags: this.staleDataFlags.slice(-50).map(f => ({
            endpoint: f.endpoint,
            lastFetchedAt: f.lastFetchedAt,
            staleSince: f.staleSince,
            threshold: f.threshold,
            ageMinutes: f.ageMinutes,
            timestamp: f.timestamp,
          })),
        },
        valueNotRendered: {
          total: this.valueNotRendered.length,
          entries: this.valueNotRendered.slice(-50).map(e => ({
            resourceType: e.resourceType,
            field: e.field,
            apiValue: e.apiValue,
            url: e.url,
            timestamp: e.timestamp,
          })),
        },
        valueTruncated: {
          total: this.valueTruncated.length,
          entries: this.valueTruncated.slice(-50).map(e => ({
            resourceType: e.resourceType,
            field: e.field,
            apiValue: e.apiValue,
            url: e.url,
            timestamp: e.timestamp,
          })),
        },
        allergyAlertNotVisible: {
          total: this.allergyAlertNotVisible.length,
          entries: this.allergyAlertNotVisible.slice(-50).map(a => ({
            element: a.element,
            boundingRect: a.boundingRect,
            viewportHeight: a.viewportHeight,
            timestamp: a.timestamp,
          })),
        },
        formPrepopulationMismatches: {
          total: this.formPrepopulationMismatches.length,
          entries: this.formPrepopulationMismatches.slice(-50).map(f => ({
            field: f.field,
            expectedValue: f.expectedValue,
            renderedValue: f.renderedValue,
            timestamp: f.timestamp,
          })),
        },
      },

      // ════════════════════════════════════════
      // Offline / Resilience Section (Pillar 9)
      // ════════════════════════════════════════
      offlineResilience: {
        networkConditionTests: {
          total: this.networkConditionTests.length,
          tests: this.networkConditionTests.slice(-50).map(t => ({
            preset: t.preset, offline: t.offline, latency: t.latency,
            downloadThroughput: t.downloadThroughput, uploadThroughput: t.uploadThroughput,
            timestamp: t.timestamp,
          })),
        },
        offlineWarningMissing: {
          total: this.offlineWarningMissing.length,
          incidents: this.offlineWarningMissing.slice(-50).map(o => ({
            offlineDurationMs: o.offlineDurationMs,
            timestamp: o.timestamp,
          })),
        },
        reconnectionSyncFailures: {
          total: this.reconnectionSyncFailures.length,
          failures: this.reconnectionSyncFailures.slice(-50).map(r => ({
            outageDuration: r.outageDuration,
            restoredAt: r.restoredAt,
            timestamp: r.timestamp,
          })),
        },
        serviceWorkerAudit: {
          total: this.serviceWorkerAudit.length,
          audits: this.serviceWorkerAudit.slice(-50).map(s => ({
            registrations: s.registrations || [],
            criticalCacheKeysFound: s.criticalCacheKeysFound || [],
            criticalCacheKeysMissing: s.criticalCacheKeysMissing || [],
            hasAllCriticalKeys: s.hasAllCriticalKeys,
            cacheApiUnavailable: s.cacheApiUnavailable,
            timestamp: s.timestamp,
          })),
        },
        criticalCacheMissing: {
          total: this.criticalCacheMissing.length,
          entries: this.criticalCacheMissing.slice(-50).map(c => ({
            missingKeys: c.missingKeys,
            timestamp: c.timestamp,
          })),
        },
        degradedModeFreezes: {
          total: this.degradedModeFreezes.length,
          freezes: this.degradedModeFreezes.slice(-50).map(d => ({
            endpoint: d.endpoint,
            duration: d.duration,
            noLoadingIndicator: d.noLoadingIndicator,
            timestamp: d.timestamp,
          })),
        },
      },

      // ════════════════════════════════════════
      // Longitudinal Trends Section (Pillar 10)
      // ════════════════════════════════════════
      longitudinalTrends: {
        sessionsAudited: (() => {
          try {
            const idxPath = path.join(this.reportsDir, 'index.json');
            if (fs.existsSync(idxPath)) {
              const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
              return (idx.reports || []).length;
            }
          } catch (e) {}
          return 0;
        })(),
        scoreRegressions: {
          total: this.scoreRegressions.length,
          entries: this.scoreRegressions.slice(-50).map(r => ({
            metric: r.metric, previousScore: r.previousScore, newScore: r.newScore,
            delta: r.delta, timestamp: r.timestamp,
          })),
        },
        newCriticalIssues: {
          total: this.newCriticalIssues.length,
          entries: this.newCriticalIssues.slice(-50).map(n => ({
            type: n.type, message: n.message, timestamp: n.timestamp,
          })),
        },
        persistentDegradations: {
          total: this.persistentDegradations.length,
          entries: this.persistentDegradations.slice(-50).map(d => ({
            metric: d.metric, trend: d.trend,
            deltaFromBaseline: d.deltaFromBaseline,
            sessionsAnalysed: d.sessionsAnalysed, timestamp: d.timestamp,
          })),
        },
        heatmapDataFile: (() => {
          try {
            const files = fs.readdirSync(this.reportsDir).filter(f => f.startsWith('heatmap-') && f.endsWith('.json'));
            return files.length > 0 ? path.join(this.reportsDir, files[files.length - 1]) : null;
          } catch (e) { return null; }
        })(),
        trendDataFile: (() => {
          try {
            const files = fs.readdirSync(this.reportsDir).filter(f => f.startsWith('trends-') && f.endsWith('.json'));
            return files.length > 0 ? path.join(this.reportsDir, files[files.length - 1]) : null;
          } catch (e) { return null; }
        })(),
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

    // ── Pillar 10: Generate derivative data files ──
    const heatmapFile = this.generateHeatmapData();
    const trendFile = this.generateTrendData();

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
