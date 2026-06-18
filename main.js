const { app, BrowserWindow, ipcMain, session, webContents } = require('electron');
const path = require('path');

// Security policies for enterprise monitoring
const SECURITY_POLICIES = {
  upgradeInsecureRequests: false,  // Set true to force HTTPS on all resources
  blockThirdPartyCookies: false,
  enableHSTSPreload: false,
};

// Store all tab windows with their monitoring data
const tabs = new Map();
let tabIdCounter = 0;
let mainWindow = null;

// Performance metrics collection
function setupPerformanceMonitoring(webContents, tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Monitor page load performance
  const performanceObserver = () => {
    webContents.executeJavaScript(`
      (function() {
        const perf = window.performance;
        const entries = perf.getEntriesByType('navigation');
        const resources = perf.getEntriesByType('resource');
        const paintEntries = perf.getEntriesByType('paint') || [];
        
        return {
          navigation: entries.length > 0 ? {
            domContentLoaded: entries[0].domContentLoadedEventEnd,
            loadComplete: entries[0].loadEventEnd,
            domInteractive: entries[0].domInteractive,
            firstByte: entries[0].responseStart - entries[0].requestStart,
            redirectCount: entries[0].redirectCount,
            transferSize: entries[0].transferSize,
            decodedBodySize: entries[0].decodedBodySize,
            protocol: entries[0].nextHopProtocol
          } : null,
          paint: {
            firstPaint: paintEntries.find(e => e.name === 'first-paint')?.startTime || 0,
            firstContentfulPaint: paintEntries.find(e => e.name === 'first-contentful-paint')?.startTime || 0
          },
          resources: resources.slice(0, 50).map(r => ({
            name: r.name,
            type: r.initiatorType,
            duration: r.duration,
            transferSize: r.transferSize,
            decodedBodySize: r.decodedBodySize,
            protocol: r.nextHopProtocol,
            startTime: r.startTime
          })),
          memory: performance.memory ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
          } : null
        };
      })()
    `).then(data => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor:performance', { tabId, data });
      }
    }).catch(() => {});
  };

  // Listen for did-finish-load event
  webContents.on('did-finish-load', () => {
    setTimeout(performanceObserver, 1000);
  });

  // Also capture on DOM-ready for faster metrics
  webContents.on('dom-ready', () => {
    setTimeout(performanceObserver, 500);
  });
}

// Network request monitoring
function setupNetworkMonitoring(webContents, tabId) {
  const filter = {
    urls: ['http://*/*', 'https://*/*', 'data:*', 'blob:*']
  };

  const requests = new Map();

  webContents.session.webRequest.onBeforeRequest(filter, (details, callback) => {
    requests.set(details.id, {
      url: details.url,
      method: details.method,
      type: details.resourceType,
      startTime: Date.now(),
      requestHeaders: details.requestHeaders || {},
      uploadData: details.uploadData ? details.uploadData.length : 0
    });
    callback({ cancel: false });
  });

  webContents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const req = requests.get(details.id);
    if (req) {
      req.statusCode = details.statusCode;
      req.statusLine = details.statusLine;
      req.responseHeaders = details.responseHeaders;
      req.duration = Date.now() - req.startTime;
      req.responseSize = parseInt(
        (details.responseHeaders && 
          (details.responseHeaders['content-length'] || 
           details.responseHeaders['Content-Length'])) || '0'
      );

      // Security checks
      req.securityIssues = [];
      
      // Check for missing security headers
      const headers = details.responseHeaders || {};
      const headerKeys = Object.keys(headers).map(h => h.toLowerCase());
      
      if (!headerKeys.includes('content-security-policy')) {
        req.securityIssues.push('Missing CSP header');
      }
      if (!headerKeys.includes('x-content-type-options')) {
        req.securityIssues.push('Missing X-Content-Type-Options');
      }
      if (!headerKeys.includes('x-frame-options')) {
        req.securityIssues.push('Missing X-Frame-Options');
      }
      if (!headerKeys.includes('strict-transport-security')) {
        req.securityIssues.push('Missing HSTS header');
      }
      
      // Check if using HTTP
      if (req.url.startsWith('http://')) {
        req.securityIssues.push('Not using HTTPS');
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor:network', { tabId, data: { ...req } });
      }
    }
    callback({ cancel: false });
  });

  webContents.session.webRequest.onCompleted(filter, (details) => {
    // Final update with timing
    const req = requests.get(details.id);
    if (req) {
      req.duration = Date.now() - req.startTime;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor:networkComplete', { tabId, data: { ...req } });
      }
      requests.delete(details.id);
    }
  });

  webContents.session.webRequest.onErrorOccurred(filter, (details) => {
    const req = requests.get(details.id);
    if (req) {
      req.error = details.error;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor:networkError', { tabId, data: { ...req } });
      }
      requests.delete(details.id);
    }
  });
}

// Console message monitoring
function setupConsoleMonitoring(webContents, tabId) {
  webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('monitor:console', {
        tabId,
        data: {
          level: levels[level] || 'info',
          message,
          line,
          source: sourceId,
          timestamp: Date.now()
        }
      });
    }
  });
}

// Create a new tab
function createTab(url = 'about:blank', isFirst = false) {
  tabIdCounter++;
  const tabId = tabIdCounter;

  const tab = {
    id: tabId,
    url: url,
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    webContents: null,
    browserWindow: null,
    performance: {},
    networkRequests: [],
    consoleMessages: [],
    securityIssues: [],
    styleIssues: []
  };

  tabs.set(tabId, tab);
  return tab;
}

// Navigate a tab to a URL
function navigateTab(tabId, url) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.webContents) return;

  // Ensure URL has protocol
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
    url = 'https://' + url;
  }

  tab.url = url;
  tab.isLoading = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab:loading', { tabId, isLoading: true, url });
  }

  tab.webContents.loadURL(url);
}

// Create the main browser window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Inspector Browser',
    icon: null,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: false
    },
    frame: false,
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // Note: CSP header manipulation is disabled by default to avoid breaking enterprise apps.
  // To enable mixed-content upgrade, set upgradeInsecureRequests: true in SECURITY_POLICIES.

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });

  return mainWindow;
}

// IPC Handlers
function setupIPC() {
  // Create a new tab with a webview
  ipcMain.on('tab:create', (event, url) => {
    const tab = createTab(url);
    event.reply('tab:created', { tabId: tab.id, url: tab.url });
  });

  // Navigate tab
  ipcMain.on('tab:navigate', (event, { tabId, url }) => {
    navigateTab(tabId, url);
  });

  // Go back
  ipcMain.on('tab:goBack', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab && tab.webContents && tab.webContents.canGoBack()) {
      tab.webContents.goBack();
    }
  });

  // Go forward
  ipcMain.on('tab:goForward', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab && tab.webContents && tab.webContents.canGoForward()) {
      tab.webContents.goForward();
    }
  });

  // Refresh
  ipcMain.on('tab:reload', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab && tab.webContents) {
      tab.webContents.reload();
    }
  });

  // Stop loading
  ipcMain.on('tab:stop', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab && tab.webContents) {
      tab.webContents.stop();
    }
  });

  // Close tab
  ipcMain.on('tab:close', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab && tab.webContents) {
      tab.webContents.destroy();
    }
    tabs.delete(tabId);
    event.reply('tab:closed', tabId);
  });

  // Register a webview's webContents for monitoring
  ipcMain.on('tab:registerWebview', (event, { tabId, webContentsId }) => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    // Get the actual webview's webContents using its ID
    const wc = webContents.fromId(webContentsId);
    if (!wc) {
      console.error('Could not find webContents for tab', tabId, 'id:', webContentsId);
      return;
    }

    tab.webContents = wc;

    // Set up monitoring only (navigation events are handled by renderer via webview element events)
    setupPerformanceMonitoring(wc, tabId);
    setupNetworkMonitoring(wc, tabId);
    setupConsoleMonitoring(wc, tabId);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab:updated', { tabId, title: tab.title, url: tab.url });
    }
  });

  // Window controls
  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  // Get monitoring data for a tab
  ipcMain.on('monitor:getData', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab) {
      event.reply('monitor:data', {
        tabId,
        performance: tab.performance,
        networkRequests: tab.networkRequests,
        consoleMessages: tab.consoleMessages,
        securityIssues: tab.securityIssues,
        styleIssues: tab.styleIssues
      });
    }
  });

  // Open DevTools for a tab
  ipcMain.on('devtools:open', (event, tabId) => {
    const tab = tabs.get(tabId);
    if (tab && tab.webContents) {
      tab.webContents.openDevTools();
    }
  });

  // Run style audit on a tab
  ipcMain.handle('monitor:styleAudit', async (event, tabId) => {
    const tab = tabs.get(tabId);
    // Return null to signal that the audit couldn't run (webview not registered)
    if (!tab || !tab.webContents) return null;

    try {
      const issues = await tab.webContents.executeJavaScript(`
        (function() {
          const issues = [];
          
          // Check color contrast issues
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.color && style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
              // Simple contrast check
              const color = style.color;
              const bg = style.backgroundColor;
              issues.push({
                type: 'style',
                severity: 'info',
                element: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : ''),
                message: 'Style analysis available for: ' + el.tagName.toLowerCase(),
                recommendation: 'Check color contrast ratio meets WCAG AA standards (4.5:1)'
              });
            }
          });

          // Check for deprecated HTML
          const deprecatedTags = ['center', 'font', 'marquee', 'blink', 'big', 'strike', 'tt', 'frame', 'frameset'];
          deprecatedTags.forEach(tag => {
            if (document.querySelectorAll(tag).length > 0) {
              issues.push({
                type: 'html',
                severity: 'warning',
                element: '<' + tag + '>',
                message: 'Deprecated HTML tag <' + tag + '> used',
                recommendation: 'Replace with modern CSS equivalents'
              });
            }
          });

          // Check for inline styles
          const inlineStyles = document.querySelectorAll('[style]');
          if (inlineStyles.length > 5) {
            issues.push({
              type: 'style',
              severity: 'warning',
              element: 'Inline styles',
              message: inlineStyles.length + ' elements use inline styles',
              recommendation: 'Move inline styles to CSS classes for maintainability'
            });
          }

          // Check viewport meta
          const viewport = document.querySelector('meta[name="viewport"]');
          if (!viewport) {
            issues.push({
              type: 'responsive',
              severity: 'error',
              element: 'meta viewport',
              message: 'Missing viewport meta tag',
              recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">'
            });
          }

          // Check for alt text on images
          const images = document.querySelectorAll('img:not([alt])');
          if (images.length > 0) {
            issues.push({
              type: 'accessibility',
              severity: 'warning',
              element: 'img',
              message: images.length + ' image(s) missing alt text',
              recommendation: 'Add descriptive alt attributes to all images'
            });
          }

          // Check heading hierarchy
          const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
          const h1Count = document.querySelectorAll('h1').length;
          if (h1Count > 1) {
            issues.push({
              type: 'accessibility',
              severity: 'warning',
              element: 'h1',
              message: 'Multiple h1 elements found (' + h1Count + ')',
              recommendation: 'Use only one h1 per page for proper document outline'
            });
          }

          // Check for console errors logged (if any)
          // Note: actual console errors are captured separately

          return issues;
        })()
      `);
      return issues;
    } catch (e) {
      return [];
    }
  });

  // Run security scan on a tab
  ipcMain.handle('monitor:securityScan', async (event, tabId) => {
    const tab = tabs.get(tabId);
    // Return null to signal that the scan couldn't run (webview not registered)
    if (!tab || !tab.webContents) return null;

    try {
      const issues = await tab.webContents.executeJavaScript(`
        (function() {
          const issues = [];
          const url = window.location.href;

          // Check if using HTTPS
          if (!url.startsWith('https://')) {
            issues.push({
              type: 'security',
              severity: 'error',
              message: 'Page is not served over HTTPS',
              recommendation: 'Enable HTTPS with a valid SSL certificate'
            });
          }

          // Check for mixed content
          const mixedContent = [];
          document.querySelectorAll('script[src^="http://"], link[href^="http://"], img[src^="http://"], iframe[src^="http://"], object[data^="http://"]').forEach(el => {
            mixedContent.push(el.src || el.href || el.data);
          });
          if (mixedContent.length > 0) {
            issues.push({
              type: 'security',
              severity: 'error',
              element: 'Mixed Content',
              message: mixedContent.length + ' mixed content resource(s) found',
              recommendation: 'Use HTTPS URLs for all external resources',
              details: mixedContent.slice(0, 5)
            });
          }

          // Check for insecure cookies (via document.cookie passive check)
          // We can't fully check HttpOnly/Secure flags from JS, but we can flag cookies

          // Check for eval usage
          const evalUsage = document.querySelectorAll('script');
          let evalFound = false;
          evalUsage.forEach(script => {
            if (script.textContent && script.textContent.includes('eval(')) {
              evalFound = true;
            }
          });
          if (evalFound) {
            issues.push({
              type: 'security',
              severity: 'warning',
              message: 'Use of eval() detected',
              recommendation: 'Avoid eval() as it can lead to XSS vulnerabilities'
            });
          }

          // Check for localStorage/sessionStorage usage (potential data exposure)
          try {
            if (localStorage.length > 0) {
              issues.push({
                type: 'security',
                severity: 'info',
                message: 'localStorage is in use (' + localStorage.length + ' items)',
                recommendation: 'Ensure sensitive data is not stored in localStorage'
              });
            }
          } catch(e) {}

          // Check for external scripts
          const externalScripts = document.querySelectorAll('script[src]');
          const thirdPartyScripts = [];
          externalScripts.forEach(script => {
            try {
              const scriptUrl = new URL(script.src);
              const pageUrl = new URL(url);
              if (scriptUrl.hostname !== pageUrl.hostname) {
                thirdPartyScripts.push(script.src);
              }
            } catch(e) {}
          });
          if (thirdPartyScripts.length > 0) {
            issues.push({
              type: 'security',
              severity: 'warning',
              element: 'Third-party scripts',
              message: thirdPartyScripts.length + ' third-party script(s) loaded',
              recommendation: 'Audit third-party scripts for supply chain risks',
              details: thirdPartyScripts.slice(0, 5)
            });
          }

          return issues;
        })()
      `);
      return issues;
    } catch (e) {
      return [];
    }
  });
}

// Export monitoring report as JSON
ipcMain.handle('export:saveReport', async (event, reportData) => {
  const { dialog } = require('electron');
  
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const defaultName = `inspector-report-${timestamp}.json`;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Monitoring Report',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [
      { name: 'JSON Report', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, reason: 'canceled' };
  }

  try {
    const fs = require('fs');
    const json = JSON.stringify(reportData, null, 2);
    fs.writeFileSync(result.filePath, json, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, reason: err.message };
  }
});

// App lifecycle
app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  // Initial tab is created by the renderer on DOMContentLoaded - no IPC needed here
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
