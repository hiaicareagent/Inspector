const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inspector', {
  // ── Metrics (Pillar 1) ──
  reportMetric: (tag, value, metadata) => {
    ipcRenderer.send('inspector:reportMetric', { tag, value, metadata });
  },

  // ── Compliance (Pillar 2 — HIPAA, JCI, FHIR) ──
  reportCompliance: (standard, check, passed, details) => {
    ipcRenderer.send('inspector:reportCompliance', { standard, check, passed, details });
  },

  // ── UX / Usability (Pillar 3 — Rage-clicks, dead-clicks, accessibility) ──
  reportUX: (category, score, element, note) => {
    ipcRenderer.send('inspector:reportUX', { category, score, element, note });
  },

  // ── Error Logging ──
  reportError: (source, message, stack) => {
    ipcRenderer.send('inspector:reportError', { source, message, stack });
  },

  // ── Interaction Timestamp (Pillar 2 — Auto-Logoff) ──
  reportInteraction: (timestamp) => {
    ipcRenderer.send('inspector:reportInteraction', { timestamp });
  },

  // ── Layout Shift (Pillar 3 — Screenshot capture) ──
  reportLayoutShift: (shiftValue) => {
    ipcRenderer.send('inspector:layoutShift', { shiftValue });
  },

  // ── Workflow Intelligence (Pillar 5) ──
  reportWorkflowEvent: (type, data) => {
    ipcRenderer.send('inspector:reportWorkflow', { type, data });
  },

  getWorkflowCounts: () => {
    return ipcRenderer.invoke('inspector:getWorkflowCounts');
  },

  // ── Axe-core Results (Pillar 3 — Accessibility) ──
  reportAxeResults: (results) => {
    ipcRenderer.send('inspector:reportAxeResults', results);
  },

  // ── Session Integrity (Pillar 6) ──
  reportSessionEvent: (type, data) => {
    ipcRenderer.send('inspector:reportSessionEvent', { type, data });
  },

  getSessionCounts: () => {
    return ipcRenderer.invoke('inspector:getSessionCounts');
  },

  // ── Data Integrity (Pillar 8) ──
  reportDataIntegrity: (flag, data) => {
    ipcRenderer.send('inspector:reportDataIntegrity', { flag, data });
  },
  getAPICache: () => {
    return ipcRenderer.invoke('inspector:getAPICache');
  },
  getDataIntegrityCounts: () => {
    return ipcRenderer.invoke('inspector:getDataIntegrityCounts');
  },

  // ── Offline / Resilience (Pillar 9) ──
  setNetworkCondition: (preset) => {
    return ipcRenderer.invoke('inspector:setNetworkCondition', preset);
  },
  getCurrentNetworkCondition: () => {
    return ipcRenderer.invoke('inspector:getCurrentNetworkCondition');
  },
  reportOfflineEvent: (type, data) => {
    ipcRenderer.send('inspector:reportOfflineEvent', { type, data });
  },
  getOfflineCounts: () => {
    return ipcRenderer.invoke('inspector:getOfflineCounts');
  },

  // ── Network condition event listeners (auto-detection) ──
  _initNetworkDetection: (() => {
    var _offlineStarted = null;
    window.addEventListener('offline', () => {
      _offlineStarted = Date.now();
      ipcRenderer.send('inspector:offlineDetected', { timestamp: Date.now() });
    });
    window.addEventListener('online', () => {
      var duration = _offlineStarted ? Date.now() - _offlineStarted : 0;
      ipcRenderer.send('inspector:onlineRestored', { timestamp: Date.now(), outageDuration: duration });
      _offlineStarted = null;
    });
    return true;
  })(),

  // ── API Health (Pillar 7) ──
  getApiHealthCounts: () => {
    return ipcRenderer.invoke('inspector:getApiHealthCounts');
  },

  // ── Report Generation ──
  generateReport: () => {
    return ipcRenderer.invoke('inspector:generateReport');
  },

  // ── Live Status ──
  getLogCounts: () => {
    return ipcRenderer.invoke('inspector:getLogCounts');
  },

  getComplianceCounts: () => {
    return ipcRenderer.invoke('inspector:getComplianceCounts');
  },

  getUXCounts: () => {
    return ipcRenderer.invoke('inspector:getUXCounts');
  },

  getTelemetryCounts: () => {
    return ipcRenderer.invoke('inspector:getTelemetryCounts');
  },

  getSummaryScores: () => {
    return ipcRenderer.invoke('inspector:getSummaryScores');
  },

  // ── Tracing Control (Pillar 1) ──
  startTrace: () => ipcRenderer.invoke('inspector:startTrace'),
  stopTrace: () => ipcRenderer.invoke('inspector:stopTrace'),
  getTraceStatus: () => ipcRenderer.invoke('inspector:getTraceStatus'),

  // ── Event listeners ──
  onReady: (callback) => {
    ipcRenderer.on('inspector:ready', (_event, data) => callback(data));
  },

  // ── Degraded mode freeze detection (Pillar 9, auto-initialized) ──
  _initDegradedModeDetection: (() => {
    // Track long-running requests during degraded network
    var requestTimers = {};
    var originalFetch = window.fetch;
    window.fetch = function() {
      var url = arguments[0];
      var startTime = Date.now();
      var requestId = Math.random().toString(36).substring(2, 10);
      requestTimers[requestId] = { url: url, startTime: startTime };

      // Check for loading indicator
      setTimeout(function() {
        if (requestTimers[requestId]) {
          var body = document.body;
          if (body) {
            var hasLoading = !!document.querySelector('[class*="loading"], [class*="spinner"], [class*="skeleton"], [role="progressbar"]');
            if (!hasLoading) {
              ipcRenderer.send('inspector:reportOfflineEvent', {
                type: 'degradedModeFreeze',
                data: {
                  endpoint: typeof url === 'string' ? url : (url.url || 'unknown'),
                  duration: Date.now() - startTime,
                  noLoadingIndicator: true,
                }
              });
            }
          }
          delete requestTimers[requestId];
        }
      }, 10000);

      return originalFetch.apply(this, arguments).then(function(resp) {
        delete requestTimers[requestId];
        return resp;
      }).catch(function(err) {
        delete requestTimers[requestId];
        throw err;
      });
    };

    // Also track XMLHttpRequest
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._inspectorUrl = url;
      this._inspectorStartTime = Date.now();
      return origOpen.apply(this, arguments);
    };

    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      var self = this;
      var requestId = Math.random().toString(36).substring(2, 10);
      var timer = setTimeout(function() {
        var body = document.body;
        if (body) {
          var hasLoading = !!document.querySelector('[class*="loading"], [class*="spinner"], [class*="skeleton"], [role="progressbar"]');
          if (!hasLoading) {
            ipcRenderer.send('inspector:reportOfflineEvent', {
              type: 'degradedModeFreeze',
              data: {
                endpoint: self._inspectorUrl || 'unknown',
                duration: Date.now() - (self._inspectorStartTime || Date.now()),
                noLoadingIndicator: true,
              }
            });
          }
        }
      }, 10000);

      self.addEventListener('loadend', function() { clearTimeout(timer); });
      return origSend.apply(this, arguments);
    };
    return true;
  })(),

  // ── Trend Data (Pillar 10) ──
  getTrendCounts: () => {
    return ipcRenderer.invoke('inspector:getTrendCounts');
  },

  // ── Window controls ──
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
