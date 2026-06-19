const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inspector', {
  // ── Metrics ──
  reportMetric: (tag, value, metadata) => {
    ipcRenderer.send('inspector:reportMetric', { tag, value, metadata });
  },

  // ── Compliance (HIPAA, SOC2, etc.) ──
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

  // ── Report Generation ──
  generateReport: () => {
    return ipcRenderer.invoke('inspector:generateReport');
  },

  // ── Live Status ──
  getLogCounts: () => {
    return ipcRenderer.invoke('inspector:getLogCounts');
  },

  // ── Event listeners ──
  onReady: (callback) => {
    ipcRenderer.on('inspector:ready', (_event, data) => callback(data));
  },

  onMetricReported: (callback) => {
    ipcRenderer.on('inspector:metricReported', (_event, data) => callback(data));
  },

  // ── Window controls (frameless) ──
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
