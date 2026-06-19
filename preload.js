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

  // ── Window controls ──
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
