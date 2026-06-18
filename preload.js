const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Tab management
  createTab: (url) => ipcRenderer.send('tab:create', url),
  onTabCreated: (callback) => {
    ipcRenderer.on('tab:created', (event, data) => callback(data));
  },
  navigateTab: (tabId, url) => ipcRenderer.send('tab:navigate', { tabId, url }),
  goBack: (tabId) => ipcRenderer.send('tab:goBack', tabId),
  goForward: (tabId) => ipcRenderer.send('tab:goForward', tabId),
  reload: (tabId) => ipcRenderer.send('tab:reload', tabId),
  stop: (tabId) => ipcRenderer.send('tab:stop', tabId),
  closeTab: (tabId) => ipcRenderer.send('tab:close', tabId),
  registerWebview: (tabId, webContentsId) => ipcRenderer.send('tab:registerWebview', { tabId, webContentsId }),

  // Tab events
  onTabUpdated: (callback) => {
    ipcRenderer.on('tab:updated', (event, data) => callback(data));
  },
  onTabClosed: (callback) => {
    ipcRenderer.on('tab:closed', (event, tabId) => callback(tabId));
  },

  // Monitoring data
  onPerformanceData: (callback) => {
    ipcRenderer.on('monitor:performance', (event, data) => callback(data));
  },
  onNetworkData: (callback) => {
    ipcRenderer.on('monitor:network', (event, data) => callback(data));
  },
  onNetworkComplete: (callback) => {
    ipcRenderer.on('monitor:networkComplete', (event, data) => callback(data));
  },
  onNetworkError: (callback) => {
    ipcRenderer.on('monitor:networkError', (event, data) => callback(data));
  },
  onConsoleMessage: (callback) => {
    ipcRenderer.on('monitor:console', (event, data) => callback(data));
  },

  // Monitoring actions
  getMonitoringData: (tabId) => ipcRenderer.send('monitor:getData', tabId),
  onMonitoringData: (callback) => {
    ipcRenderer.on('monitor:data', (event, data) => callback(data));
  },
  runStyleAudit: (tabId) => ipcRenderer.invoke('monitor:styleAudit', tabId),
  runSecurityScan: (tabId) => ipcRenderer.invoke('monitor:securityScan', tabId),

  // Report export
  saveReport: (reportData) => ipcRenderer.invoke('export:saveReport', reportData),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close')
});
