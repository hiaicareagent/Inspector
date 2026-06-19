const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inspector', {
  // ── Metrics ──
  reportMetric: (tag, value, metadata) => {
    ipcRenderer.send('inspector:reportMetric', { tag, value, metadata });
  },

  // ── Compliance (HIPAA, JCI, FHIR, SOC2, etc.) ──
  reportCompliance: (standard, check, passed, details) => {
    ipcRenderer.send('inspector:reportCompliance', { standard, check, passed, details });
  },

  // ── UX / Usability ──
  reportUX: (category, score, element, note) => {
    ipcRenderer.send('inspector:reportUX', { category, score, element, note });
  },

  // ── Error Logging ──
  reportError: (source, message, stack) => {
    ipcRenderer.send('inspector:reportError', { source, message, stack });
  },

  // ── Clinician Interaction Timestamp (Pillar 2 — Auto-Logoff) ──
  reportInteraction: (timestamp) => {
    ipcRenderer.send('inspector:reportInteraction', { timestamp });
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

  // ── Tracing Control (Pillar 1) ──
  startTrace: () => {
    return ipcRenderer.invoke('inspector:startTrace');
  },

  stopTrace: () => {
    return ipcRenderer.invoke('inspector:stopTrace');
  },

  getTraceStatus: () => {
    return ipcRenderer.invoke('inspector:getTraceStatus');
  },

  // ── Event listeners ──
  onReady: (callback) => {
    ipcRenderer.on('inspector:ready', (_event, data) => callback(data));
  },

  // ── Window controls (frameless) ──
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
