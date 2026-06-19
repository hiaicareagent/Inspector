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

    // Get process metrics for the status bar
  ipcMain.handle('metrics:getProcessInfo', async () => {
    try {
      const memInfo = await process.getProcessMemoryInfo();
      const cpuInfo = process.cpuUsage();
      const heapInfo = process.getHeapStatistics();
      const ioCounters = process.getIOCounters ? process.getIOCounters() : null;

      return {
        memory: {
          residentSet: memInfo.residentSet,       // RSS in bytes
          private: memInfo.private,                // Private memory in bytes
          shared: memInfo.shared || 0
        },
        cpu: {
          percentCPUUsage: cpuInfo.percentCPUUsage,          // Percentage
          idleWakeupsPerSecond: cpuInfo.idleWakeupsPerSecond
        },
        heap: {
          totalHeapSize: heapInfo.totalHeapSize,
          usedHeapSize: heapInfo.usedHeapSize,
          heapSizeLimit: heapInfo.heapSizeLimit
        },
        io: ioCounters ? {
          readOperationCount: ioCounters.readOperationCount,
          writeOperationCount: ioCounters.writeOperationCount,
          otherOperationCount: ioCounters.otherOperationCount
        } : null
      };
    } catch (e) {
      return null;
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

  // Run HTML Advisor - comprehensive DOM/CSS/JS/A11y/SEO/Perf audit
  ipcMain.handle('monitor:htmlAdvisor', async (event, { tabId, categories }) => {
    const tab = tabs.get(tabId);
    if (!tab || !tab.webContents) return null;

    try {
      const results = await tab.webContents.executeJavaScript(`
        (function() {
          const results = [];
          const activeCategories = ${JSON.stringify(categories || [])};
          const allCategories = activeCategories.length === 0;
          function addIssue(category, type, severity, element, message, recommendation, details) {
            results.push({ category, type, severity, element, message, recommendation, details: details || [] });
          }

          // ============================================
          // 1. DOM STRUCTURE CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('dom')) {
            // Check document type
            if (!document.doctype) {
              addIssue('dom', 'structure', 'error', 'document', 'Missing DOCTYPE declaration', 'Add <!DOCTYPE html> at the very top of the document');
            } else if (document.doctype.name !== 'html') {
              addIssue('dom', 'structure', 'warning', 'document', 'Non-standard DOCTYPE: ' + document.doctype.name, 'Use <!DOCTYPE html> for modern standards mode');
            }

            // Check html lang attribute
            const htmlEl = document.documentElement;
            const lang = htmlEl.getAttribute('lang');
            if (!lang) {
              addIssue('dom', 'a11y', 'error', 'html', 'Missing lang attribute on <html>', 'Add lang="en" (or appropriate language code) to <html>');
            } else if (lang.length < 2) {
              addIssue('dom', 'a11y', 'warning', 'html', 'lang attribute value "' + lang + '" may be invalid', 'Use a valid language code like "en", "es", "fr"');
            }

            // Count total DOM nodes
            const allElements = document.querySelectorAll('*');
            const domDepth = (el) => { let d = 0; while (el) { d++; el = el.parentElement; } return d; };
            let maxDepth = 0;
            let maxDepthEl = '';
            allElements.forEach(function(el) {
              const d = domDepth(el);
              if (d > maxDepth) { maxDepth = d; maxDepthEl = el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''); }
            });
            if (allElements.length > 1500) {
              addIssue('dom', 'performance', 'warning', 'DOM', allElements.length + ' DOM nodes found (max depth: ' + maxDepth + ')', 'Consider reducing DOM size below 1500 nodes for better performance. Use virtualization for large lists.');
            }
            if (maxDepth > 20) {
              addIssue('dom', 'performance', 'warning', maxDepthEl, 'DOM nesting depth of ' + maxDepth + ' is excessive', 'Flatten the DOM structure. Deeply nested DOM is slow to render and hard to maintain.');
            }

            // Check for duplicate IDs
            const idMap = {};
            allElements.forEach(function(el) {
              if (el.id) {
                if (idMap[el.id]) { idMap[el.id].count++; idMap[el.id].els.push(el.tagName.toLowerCase()); }
                else { idMap[el.id] = { count: 1, els: [el.tagName.toLowerCase()] }; }
              }
            });
            for (var id in idMap) {
              if (idMap[id].count > 1) {
                addIssue('dom', 'validation', 'error', '#' + id, 'Duplicate ID "' + id + '" used ' + idMap[id].count + ' times on elements: ' + idMap[id].els.join(', '), 'IDs must be unique. Use classes for reusable styles, or rename duplicates.');
              }
            }

            // Check for empty or whitespace-only text nodes in body
            const bodyChildren = document.body ? document.body.children.length : 0;
            if (bodyChildren === 0 && document.body) {
              addIssue('dom', 'structure', 'error', 'body', 'Body element is empty', 'Add content to the page body');
            }

            // Check for non-semantic div/span soup
            const divs = document.querySelectorAll('div').length;
            const spans = document.querySelectorAll('span').length;
            const totalTags = allElements.length;
            if (totalTags > 0 && (divs + spans) / totalTags > 0.6) {
              addIssue('dom', 'structure', 'warning', 'div/span', 'High ratio of non-semantic elements: ' + divs + ' divs + ' + spans + ' spans = ' + Math.round((divs + spans) / totalTags * 100) + '% of all tags', 'Use semantic HTML5 elements (header, nav, main, section, article, aside, footer) instead of generic divs');
            }

            // Check for inline scripts in body (should be in head or end of body)
            const inlineScriptsBody = document.querySelectorAll('body script:not([src])');
            if (inlineScriptsBody.length > 3) {
              addIssue('dom', 'best-practice', 'info', 'script', inlineScriptsBody.length + ' inline scripts found in body', 'Consider moving inline scripts to external files or consolidating them');
            }
          }

          // ============================================
          // 2. ACCESSIBILITY CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('a11y')) {
            // Images missing alt text
            const imgsNoAlt = document.querySelectorAll('img:not([alt])');
            if (imgsNoAlt.length > 0) {
              addIssue('a11y', 'accessibility', 'error', 'img', imgsNoAlt.length + ' image(s) missing alt attribute', 'Add descriptive alt text to all images. Use alt="" for decorative images.');
            }

            // Images with empty alt that could be meaningful
            const imgsEmptyAlt = document.querySelectorAll('img[alt=""]');
            if (imgsEmptyAlt.length > 5) {
              addIssue('a11y', 'accessibility', 'info', 'img', imgsEmptyAlt.length + ' images have empty alt (decorative)', 'If these images are decorative, consider using CSS background-image instead');
            }

            // Check landmark elements
            const hasMain = document.querySelectorAll('main').length > 0;
            const hasNav = document.querySelectorAll('nav').length > 0;
            const hasHeader = document.querySelectorAll('header').length > 0;
            const hasFooter = document.querySelectorAll('footer').length > 0;
            const missingLandmarks = [];
            if (!hasMain) missingLandmarks.push('main');
            if (!hasNav && document.querySelectorAll('a').length > 5) missingLandmarks.push('nav');
            if (!hasHeader) missingLandmarks.push('header');
            if (!hasFooter) missingLandmarks.push('footer');
            if (missingLandmarks.length > 0) {
              addIssue('a11y', 'accessibility', 'warning', 'landmarks', 'Missing landmark element(s): ' + missingLandmarks.join(', '), 'Add semantic landmark elements to improve screen reader navigation');
            }

            // Check form labels
            const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])');
            let unlabeledInputs = [];
            inputs.forEach(function(inp) {
              var id = inp.id;
              var hasLabel = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
              var hasAriaLabel = inp.getAttribute('aria-label');
              var hasAriaLabelledby = inp.getAttribute('aria-labelledby');
              var isInLabel = inp.closest('label');
              if (!hasLabel && !hasAriaLabel && !hasAriaLabelledby && !isInLabel) {
                unlabeledInputs.push(inp.name || inp.type || inp.className || '(unnamed)');
              }
            });
            if (unlabeledInputs.length > 0) {
              addIssue('a11y', 'accessibility', 'error', 'input', unlabeledInputs.length + ' input(s) missing labels', 'Each input needs an associated <label>, aria-label, or aria-labelledby');
            }

            // Check for aria attributes on non-landmark elements
            const ariaHidden = document.querySelectorAll('[aria-hidden="true"]');
            if (ariaHidden.length > 3) {
              addIssue('a11y', 'accessibility', 'info', 'aria-hidden', ariaHidden.length + ' elements with aria-hidden="true"', 'Ensure hidden content truly should not be accessible to screen readers');
            }

            // Check tabindex > 0 (anti-pattern)
            const positiveTabindex = document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])');
            let hasPositiveTabindex = false;
            positiveTabindex.forEach(function(el) {
              var ti = parseInt(el.getAttribute('tabindex') || '0');
              if (ti > 0) hasPositiveTabindex = true;
            });
            if (hasPositiveTabindex) {
              addIssue('a11y', 'accessibility', 'warning', 'tabindex', 'Positive tabindex values detected', 'Use tabindex="0" or rely on DOM order instead of positive tabindex values');
            }

            // Check link text - empty or non-descriptive
            const emptyLinks = document.querySelectorAll('a:not([aria-label]):not([title])');
            let emptyLinkCount = 0;
            emptyLinks.forEach(function(a) {
              var text = (a.textContent || '').trim();
              if (!text && !a.querySelector('img')) emptyLinkCount++;
            });
            if (emptyLinkCount > 0) {
              addIssue('a11y', 'accessibility', 'warning', 'a', emptyLinkCount + ' link(s) have no text content', 'Links should have descriptive text, aria-label, or contain an image with alt text');
            }

            // Check for sufficient color contrast (basic)
            // We can only flag elements with explicit colors
            var lowContrastCount = 0;
            try {
              var bodyStyle = window.getComputedStyle(document.body);
              if (bodyStyle.color && bodyStyle.backgroundColor) {
                // Simple luminance check
              }
            } catch(e) {}
          }

          // ============================================
          // 3. CSS / STYLE CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('css')) {
            // Inline styles
            const inlineStyleElements = document.querySelectorAll('[style]');
            if (inlineStyleElements.length > 5) {
              addIssue('css', 'maintainability', 'warning', 'style', inlineStyleElements.length + ' elements with inline styles', 'Move inline styles to CSS classes for better maintainability and performance');
            }

            // Check for !important usage
            var importantCount = 0;
            var styleSheets = document.styleSheets;
            try {
              for (var si = 0; si < styleSheets.length; si++) {
                var ss = styleSheets[si];
                try {
                  var rules = ss.cssRules || ss.rules;
                  if (rules) {
                    for (var ri = 0; ri < rules.length; ri++) {
                      var rule = rules[ri];
                      if (rule.style) {
                        for (var pi = 0; pi < rule.style.length; pi++) {
                          var val = rule.style.getPropertyValue(rule.style[pi]);
                          if (val && val.includes('!important')) importantCount++;
                        }
                      }
                    }
                  }
                } catch(e) { /* cross-origin stylesheet */ }
              }
            } catch(e) {}
            if (importantCount > 5) {
              addIssue('css', 'maintainability', 'warning', '!important', importantCount + ' !important declarations found', 'Overuse of !important breaks the cascade. Use specificity instead.');
            }

            // Check for very high specificity (many nested selectors)
            var highSpecificityCount = 0;
            try {
              for (var si2 = 0; si2 < styleSheets.length; si2++) {
                var ss2 = styleSheets[si2];
                try {
                  var rules2 = ss2.cssRules || ss2.rules;
                  if (rules2) {
                    for (var ri2 = 0; ri2 < rules2.length; ri2++) {
                      var r2 = rules2[ri2];
                      if (r2.selectorText && (r2.selectorText.split(/[#\\.\s>+~]/).length > 6)) {
                        highSpecificityCount++;
                      }
                    }
                  }
                } catch(e) {}
              }
            } catch(e) {}
            if (highSpecificityCount > 3) {
              addIssue('css', 'maintainability', 'info', 'selectors', highSpecificityCount + ' overly specific CSS selectors found', 'Deeply nested selectors are fragile. Use BEM or utility-class approaches.');
            }

            // Check viewport meta
            const viewportMeta = document.querySelector('meta[name="viewport"]');
            if (!viewportMeta) {
              addIssue('css', 'responsive', 'error', 'meta', 'Missing viewport meta tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for responsive design');
            } else {
              var vpContent = viewportMeta.getAttribute('content') || '';
              if (!vpContent.includes('width=device-width')) {
                addIssue('css', 'responsive', 'warning', 'meta', 'Viewport meta does not include width=device-width', 'Add width=device-width to the viewport meta tag for proper responsive scaling');
              }
              if (!vpContent.includes('initial-scale')) {
                addIssue('css', 'responsive', 'warning', 'meta', 'Viewport meta does not include initial-scale', 'Add initial-scale=1 to the viewport meta tag');
              }
            }

            // Check for very large stylesheets
            try {
              var totalCSSSize = 0;
              for (var si3 = 0; si3 < styleSheets.length; si3++) {
                try {
                  var rules3 = styleSheets[si3].cssRules || styleSheets[si3].rules;
                  if (rules3) totalCSSSize += rules3.length;
                } catch(e) {}
              }
              if (totalCSSSize > 500) {
                addIssue('css', 'performance', 'warning', 'stylesheet', 'Large stylesheet with ' + totalCSSSize + ' CSS rules', 'Split large stylesheets into smaller files or use CSS code splitting');
              }
            } catch(e) {}
          }

          // ============================================
          // 4. JAVASCRIPT CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('js')) {
            // Check for eval
            var evalFound = false;
            var scripts = document.querySelectorAll('script');
            scripts.forEach(function(s) {
              if (s.textContent && s.textContent.includes('eval(')) evalFound = true;
            });
            if (evalFound) {
              addIssue('js', 'security', 'error', 'script', 'Use of eval() detected', 'Avoid eval() as it can lead to XSS vulnerabilities. Use JSON.parse() or Function constructor alternatives.');
            }

            // Check for document.write
            var docWriteFound = false;
            scripts.forEach(function(s) {
              if (s.textContent && (s.textContent.includes('document.write(') || s.textContent.includes('document.writeln('))) docWriteFound = true;
            });
            if (docWriteFound) {
              addIssue('js', 'best-practice', 'error', 'script', 'Use of document.write() detected', 'document.write() is blocking and can cause performance issues. Use DOM manipulation instead.');
            }

            // Check for console.log in scripts
            var consoleLogCount = 0;
            scripts.forEach(function(s) {
              if (s.textContent) {
                var matches = s.textContent.match(/console\.(log|debug|info|warn|error)\(/g);
                if (matches) consoleLogCount += matches.length;
              }
            });
            if (consoleLogCount > 3) {
              addIssue('js', 'best-practice', 'info', 'script', consoleLogCount + ' console.* calls found', 'Remove console logging from production code for performance and privacy');
            }

            // Check for setTimeout with string argument (eval-like)
            scripts.forEach(function(s) {
              if (s.textContent && (s.textContent.match(/setTimeout\s*\(\s*['"/]/) || s.textContent.match(/setInterval\s*\(\s*['"/]/))) {
                addIssue('js', 'security', 'warning', 'script', 'setTimeout/setInterval with string argument', 'Pass a function reference instead of a string to setTimeout/setInterval');
              }
            });

            // Check for global variable pollution
            var globalVarCount = 0;
            try {
              for (var key in window) {
                if (window.hasOwnProperty(key) && key !== key.toUpperCase()) {
                  // Count non-standard globals (heuristic: not starting with standard prefixes)
                  if (!key.startsWith('on') && key !== 'performance' && key !== 'document' && key !== 'location' && key !== 'navigator' && key !== 'screen' && key !== 'history' && key !== 'localStorage' && key !== 'sessionStorage' && key !== 'console' && key !== 'fetch' && key !== 'Promise' && key !== 'JSON' && key !== 'Math' && key !== 'Date' && key !== 'Array' && key !== 'Object' && key !== 'String' && key !== 'Number' && key !== 'Boolean' && key !== 'RegExp' && key !== 'Map' && key !== 'Set' && key !== 'Symbol' && key !== 'Error' && key !== 'Function' && key !== 'XMLHttpRequest' && key !== 'WebSocket' && key !== 'Blob' && key !== 'File' && key !== 'FileReader' && key !== 'FormData' && key !== 'URL' && key !== 'URLSearchParams' && key !== 'atob' && key !== 'btoa' && key !== 'crypto' && key !== 'customElements' && key !== 'IntersectionObserver' && key !== 'MutationObserver' && key !== 'ResizeObserver' && !key.startsWith('webkit') && !key.startsWith('moz') && !key.startsWith('ms')) {
                    globalVarCount++;
                  }
                }
              }
            } catch(e) {}
            if (globalVarCount > 10) {
              addIssue('js', 'best-practice', 'warning', 'window', 'High global variable count (' + globalVarCount + ')', 'Encapsulate code in modules, IIFEs, or classes to reduce global scope pollution');
            }

            // Check for missing semicolons (basic heuristic)
            var missingSemiCount = 0;
            scripts.forEach(function(s) {
              if (s.textContent) {
                var lines = s.textContent.split('\\n');
                for (var li = 0; li < lines.length; li++) {
                  var line = lines[li].trim();
                  if (line && /^[a-z_\$]/i.test(line) && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}') && !line.endsWith('(') && !line.startsWith('//') && !line.startsWith('/*') && !line.includes('function') && !line.includes('if') && !line.includes('else') && !line.includes('for') && !line.includes('while') && !line.includes('switch') && !line.includes('try') && !line.includes('catch') && !line.includes('=>') && !line.includes('/*')) {
                    missingSemiCount++;
                  }
                }
              }
            });
            if (missingSemiCount > 10) {
              addIssue('js', 'best-practice', 'info', 'script', 'Possible missing semicolons (' + missingSemiCount + ' lines)', 'Use semicolons consistently or a linter to enforce style');
            }
          }

          // ============================================
          // 5. SEO CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('seo')) {
            // Title
            var title = document.title;
            if (!title) {
              addIssue('seo', 'meta', 'error', 'title', 'Missing page title', 'Add a descriptive <title> tag (50-60 characters recommended)');
            } else if (title.length < 10) {
              addIssue('seo', 'meta', 'warning', 'title', 'Page title too short (' + title.length + ' chars)', 'Use a descriptive title of 50-60 characters');
            } else if (title.length > 70) {
              addIssue('seo', 'meta', 'warning', 'title', 'Page title too long (' + title.length + ' chars)', 'Keep titles under 60 characters for optimal SERP display');
            }

            // Meta description
            var metaDesc = document.querySelector('meta[name="description"]');
            if (!metaDesc) {
              addIssue('seo', 'meta', 'error', 'meta', 'Missing meta description', 'Add a meta description tag summarizing the page content (150-160 characters)');
            } else {
              var descContent = (metaDesc.getAttribute('content') || '').trim();
              if (descContent.length < 50) {
                addIssue('seo', 'meta', 'warning', 'meta', 'Meta description too short (' + descContent.length + ' chars)', 'Write a compelling meta description of 150-160 characters');
              } else if (descContent.length > 320) {
                addIssue('seo', 'meta', 'warning', 'meta', 'Meta description too long (' + descContent.length + ' chars)', 'Keep meta descriptions under 160 characters');
              }
            }

            // Meta keywords
            var metaKeywords = document.querySelector('meta[name="keywords"]');
            if (metaKeywords) {
              addIssue('seo', 'meta', 'info', 'meta', 'meta keywords tag found', 'Meta keywords are not used by major search engines. Consider removing.');
            }

            // Charset
            var charset = document.querySelector('meta[charset]');
            if (!charset) {
              addIssue('seo', 'meta', 'error', 'meta', 'Missing charset declaration', 'Add <meta charset="UTF-8"> in the <head> section');
            } else if ((charset.getAttribute('charset') || '').toUpperCase() !== 'UTF-8') {
              addIssue('seo', 'meta', 'warning', 'meta', 'Non-UTF-8 charset: ' + charset.getAttribute('charset'), 'Use UTF-8 for best compatibility');
            }

            // Heading structure
            var h1Count = document.querySelectorAll('h1').length;
            if (h1Count === 0) {
              addIssue('seo', 'structure', 'error', 'h1', 'No h1 heading found', 'Each page should have exactly one h1 describing the main content');
            } else if (h1Count > 1) {
              addIssue('seo', 'structure', 'warning', 'h1', h1Count + ' h1 elements found', 'Use only one h1 per page for proper document outline and SEO');
            }

            // Check heading hierarchy (no skipping)
            var headingLevels = [];
            document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function(h) {
              headingLevels.push(parseInt(h.tagName[1]));
            });
            if (headingLevels.length > 0) {
              var maxLevel = Math.max.apply(null, headingLevels);
              for (var hl = 2; hl <= maxLevel; hl++) {
                if (headingLevels.includes(hl) && !headingLevels.includes(hl - 1)) {
                  addIssue('seo', 'structure', 'warning', 'h' + hl, 'Heading level skipped: h' + hl + ' without preceding h' + (hl-1), 'Maintain a logical heading hierarchy without skipping levels');
                  break;
                }
              }
            }

            // Canonical URL
            var canonical = document.querySelector('link[rel="canonical"]');
            if (!canonical) {
              addIssue('seo', 'meta', 'info', 'link', 'No canonical URL specified', 'Add a <link rel="canonical"> to prevent duplicate content issues');
            }

            // Open Graph tags
            var ogTitle = document.querySelector('meta[property="og:title"]');
            var ogDesc = document.querySelector('meta[property="og:description"]');
            var ogImage = document.querySelector('meta[property="og:image"]');
            if (!ogTitle || !ogDesc || !ogImage) {
              var missingOG = [];
              if (!ogTitle) missingOG.push('og:title');
              if (!ogDesc) missingOG.push('og:description');
              if (!ogImage) missingOG.push('og:image');
              addIssue('seo', 'meta', 'warning', 'meta', 'Missing Open Graph tag(s): ' + missingOG.join(', '), 'Add Open Graph tags for better social media sharing' + (missingOG.length >= 2 ? ' (https://ogp.me/)' : ''));
            }

            // Robots meta
            var robots = document.querySelector('meta[name="robots"]');
            if (!robots) {
              addIssue('seo', 'meta', 'info', 'meta', 'No robots meta tag', 'Add a robots meta tag to control search engine crawling behavior');
            } else {
              var robotContent = (robots.getAttribute('content') || '').toLowerCase();
              if (robotContent.includes('noindex')) {
                addIssue('seo', 'meta', 'info', 'meta', 'Page is set to noindex', 'This page will not appear in search results. Verify this is intentional.');
              }
            }

            // Favicon
            var favicon = document.querySelector('link[rel*="icon"]');
            if (!favicon) {
              addIssue('seo', 'meta', 'info', 'link', 'No favicon specified', 'Add a favicon for better browser tab and bookmark appearance');
            }
          }

          // ============================================
          // 6. PERFORMANCE CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('performance')) {
            // Count images without explicit dimensions
            var imgsNoDim = 0;
            document.querySelectorAll('img').forEach(function(img) {
              if (!img.hasAttribute('width') && !img.hasAttribute('height') && !img.complete) {
                imgsNoDim++;
              }
            });
            if (imgsNoDim > 0) {
              addIssue('performance', 'performance', 'warning', 'img', imgsNoDim + ' image(s) missing width/height attributes', 'Add width and height attributes to images to prevent layout shifts (CLS)');
            }

            // Check for render-blocking external scripts in head
            var headScripts = document.querySelectorAll('head script[src]');
            if (headScripts.length > 0) {
              addIssue('performance', 'performance', 'warning', 'script', headScripts.length + ' render-blocking script(s) in <head>', 'Add defer or async attributes to scripts, or move them to the end of <body>');
            }

            // Check for large inline scripts
            var largeInlineCount = 0;
            scripts.forEach(function(s) {
              if (!s.hasAttribute('src') && s.textContent && s.textContent.length > 5000) {
                largeInlineCount++;
              }
            });
            if (largeInlineCount > 0) {
              addIssue('performance', 'performance', 'info', 'script', largeInlineCount + ' large inline script(s) (>5KB each)', 'Move large inline scripts to external files for caching');
            }

            // Check for many CSS links
            var cssLinks = document.querySelectorAll('link[rel="stylesheet"]');
            if (cssLinks.length > 4) {
              addIssue('performance', 'performance', 'warning', 'link', cssLinks.length + ' external stylesheets', 'Consolidate stylesheets to reduce HTTP requests');
            }

            // Check for synchronous XMLHttpRequest usage
            scripts.forEach(function(s) {
              if (s.textContent && /\\.open\\([^)]+,[^)]+,\\s*false\\)/.test(s.textContent)) {
                addIssue('performance', 'performance', 'warning', 'script', 'Synchronous XMLHttpRequest detected', 'Use async/await with fetch() instead of synchronous XHR');
              }
            });

            // Check for large DOM (already counted above)
            if (allElements.length > 800 && allElements.length <= 1500) {
              addIssue('performance', 'performance', 'info', 'DOM', allElements.length + ' DOM nodes', 'DOM size is approaching the recommended limit of 1500 nodes');
            }
          }

          // ============================================
          // 7. SECURITY CHECKS
          // ============================================
          if (allCategories || activeCategories.includes('security')) {
            var pageUrl = window.location.href;

            // HTTPS check
            if (!pageUrl.startsWith('https://') && !pageUrl.startsWith('about:') && !pageUrl.startsWith('file://') && !pageUrl.startsWith('data:')) {
              addIssue('security', 'security', 'error', 'page', 'Page not served over HTTPS', 'Enable HTTPS with a valid SSL/TLS certificate');
            }

            // Mixed content
            var mixedContent = [];
            document.querySelectorAll('script[src^="http://"], link[href^="http://"], iframe[src^="http://"], img[src^="http://"], object[data^="http://"], source[src^="http://"], video[src^="http://"], audio[src^="http://"]').forEach(function(el) {
              var src = el.src || el.href || el.data || '';
              if (src.startsWith('http://')) mixedContent.push(src);
            });
            if (mixedContent.length > 0) {
              addIssue('security', 'security', 'error', 'mixed-content', mixedContent.length + ' mixed content resource(s) found', 'Load all resources over HTTPS. Use protocol-relative URLs (//) or upgrade to HTTPS.', mixedContent.slice(0, 5));
            }

            // Third-party scripts
            var thirdPartyScripts = [];
            var pageHost = '';
            try { pageHost = new URL(pageUrl).hostname; } catch(e) {}
            document.querySelectorAll('script[src]').forEach(function(s) {
              try {
                var scriptUrl = new URL(s.src);
                if (scriptUrl.hostname !== pageHost) {
                  thirdPartyScripts.push(scriptUrl.hostname);
                }
              } catch(e) {}
            });
            var uniqueThirdParties = [];
            thirdPartyScripts.forEach(function(h) {
              if (uniqueThirdParties.indexOf(h) === -1) uniqueThirdParties.push(h);
            });
            if (uniqueThirdParties.length > 2) {
              addIssue('security', 'security', 'warning', 'third-party', uniqueThirdParties.length + ' third-party hosts loading scripts (' + uniqueThirdParties.join(', ') + ')', 'Review third-party scripts for security and performance impact. Use SRI (integrity attribute) when possible.');
            }

            // Cross-origin iframes
            var crossOriginIframes = [];
            document.querySelectorAll('iframe[src]').forEach(function(ifr) {
              try {
                var iframeUrl = new URL(ifr.src);
                if (iframeUrl.hostname !== pageHost) {
                  crossOriginIframes.push(ifr.src);
                }
              } catch(e) {}
            });
            if (crossOriginIframes.length > 0) {
              addIssue('security', 'security', 'info', 'iframe', crossOriginIframes.length + ' cross-origin iframe(s)', 'Ensure cross-origin iframes are from trusted sources and use the sandbox attribute');
            }

            // localStorage usage
            try {
              if (localStorage.length > 0) {
                addIssue('security', 'security', 'info', 'localStorage', 'localStorage in use (' + localStorage.length + ' items)', 'Ensure sensitive data is not stored in localStorage. Consider using sessionStorage for session data.');
              }
            } catch(e) {}
          }

          // ============================================
          // 8. BEST PRACTICES / MISC
          // ============================================
          if (allCategories || activeCategories.includes('best-practices')) {
            // HTTP links that should be HTTPS
            var httpLinks = document.querySelectorAll('a[href^="http://"]');
            if (httpLinks.length > 0) {
              addIssue('best-practices', 'security', 'info', 'a', httpLinks.length + ' HTTP link(s) on page', 'Update links to use HTTPS where available');
            }

            // Broken image detection
            var brokenImgs = 0;
            document.querySelectorAll('img').forEach(function(img) {
              if (img.complete && (img.naturalWidth === 0 || img.naturalHeight === 0) && img.src && !img.src.startsWith('data:')) {
                brokenImgs++;
              }
            });
            if (brokenImgs > 0) {
              addIssue('best-practices', 'validation', 'warning', 'img', brokenImgs + ' broken image(s)', 'Fix or remove broken image references, or add onerror fallbacks');
            }

            // Check for target="_blank" without rel="noopener"
            var unsafeBlankLinks = document.querySelectorAll('a[target="_blank"]:not([rel*="noopener"])');
            if (unsafeBlankLinks.length > 0) {
              addIssue('best-practices', 'security', 'warning', 'a', unsafeBlankLinks.length + ' target="_blank" link(s) without rel="noopener"', 'Add rel="noopener noreferrer" to all target="_blank" links to prevent tab-napping');
            }

            // Deprecated HTML tags
            var deprecatedTags = ['center', 'font', 'marquee', 'blink', 'big', 'strike', 'tt', 'frame', 'frameset', 'noframes', 'acronym', 'applet', 'basefont', 'dir', 'isindex', 'listing', 'xmp', 'nextid', 'noembed', 'plaintext'];
            deprecatedTags.forEach(function(tag) {
              try {
                if (document.querySelectorAll(tag).length > 0) {
                  addIssue('best-practices', 'validation', 'warning', tag, 'Deprecated HTML element <' + tag + '> used', 'Replace with modern HTML/CSS equivalents');
                }
              } catch(e) {}
            });

            // Check for very long URLs
            var longUrls = 0;
            document.querySelectorAll('a[href]').forEach(function(a) {
              if ((a.getAttribute('href') || '').length > 200) longUrls++;
            });
            if (longUrls > 3) {
              addIssue('best-practices', 'seo', 'info', 'a', longUrls + ' very long URL(s) (>200 chars)', 'Shorten long URLs for better usability and SEO');
            }

            // Check for autofocus (accessibility concern)
            var autoFocus = document.querySelectorAll('[autofocus]');
            if (autoFocus.length > 0) {
              addIssue('best-practices', 'a11y', 'warning', 'autofocus', 'autofocus attribute used', 'autofocus can cause issues for screen reader users. Consider using sparingly.');
            }

            // Check for multiple h1 (already counted in SEO, flag here too)
            // Already handled above

            // Check for orphaned labels (label with for but no matching input)
            var orphanedLabels = 0;
            document.querySelectorAll('label[for]').forEach(function(label) {
              var forId = label.getAttribute('for');
              if (forId && !document.getElementById(forId)) {
                orphanedLabels++;
              }
            });
            if (orphanedLabels > 0) {
              addIssue('best-practices', 'validation', 'error', 'label', orphanedLabels + ' orphaned label(s) (for attribute without matching element ID)', 'Ensure each label[for] matches an existing element ID');
            }

            // Check for empty buttons
            var emptyButtons = document.querySelectorAll('button:not([aria-label])');
            var emptyBtnCount = 0;
            emptyButtons.forEach(function(btn) {
              if (!btn.textContent.trim() && !btn.querySelector('img') && !btn.querySelector('svg')) emptyBtnCount++;
            });
            if (emptyBtnCount > 0) {
              addIssue('best-practices', 'a11y', 'warning', 'button', emptyBtnCount + ' empty button(s) with no content', 'Buttons should have text content, aria-label, or contain a descriptive image');
            }
          }

          return results;
        })()
      `);
      return { issues: results, total: results.length };
    } catch (e) {
      return { issues: [], total: 0, error: e.message };
    }
  });

  // Clinical Advisor - HIPAA Compliance Audit
  ipcMain.handle('monitor:clinicalAdvisor', async (event, { tabId, categories }) => {
    const tab = tabs.get(tabId);
    if (!tab || !tab.webContents) return null;

    try {
      const results = await tab.webContents.executeJavaScript(`
        (function() {
          const results = [];
          const activeCats = ${JSON.stringify(categories || [])};
          const allCats = activeCats.length === 0;
          function addIssue(category, type, severity, element, message, recommendation, details) {
            results.push({ category, type, severity, element, message, recommendation, details: details || [] });
          }

          var pageUrl = window.location.href;
          var pageHost = '';
          try { pageHost = new URL(pageUrl).hostname; } catch(e) {}

          // ========== 1. ACCESS CONTROLS (45 CFR § 164.312) ==========
          if (allCats || activeCats.includes('access')) {
            // Check for login/authentication forms
            var loginForms = document.querySelectorAll('form');
            var hasLoginForm = false;
            var hasPasswordField = false;
            loginForms.forEach(function(f) {
              var text = (f.textContent || '').toLowerCase();
              if (text.includes('login') || text.includes('sign in') || text.includes('password') || text.includes('username')) hasLoginForm = true;
              if (f.querySelector('input[type="password"]')) hasPasswordField = true;
            });
            if (!hasLoginForm && !hasPasswordField) {
              addIssue('access', 'authentication', 'error', 'form', 'No authentication form detected — PHI must be protected by unique user identification (45 CFR § 164.312(a)(1))', 'Implement user login with unique User IDs to identify and track access to PHI');
            } else if (!hasPasswordField) {
              addIssue('access', 'authentication', 'warning', 'form', 'Login form found but no password field — weak authentication for accessing PHI', 'Use password-based or multi-factor authentication to secure access');
            }

            // Check session timeout / auto-logoff
            var metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
            if (!metaRefresh) {
              addIssue('access', 'session', 'warning', 'meta', 'No auto-logoff mechanism detected (automatic session timeout recommended for PHI access)', 'Implement session timeout (e.g., 15 min inactivity) to terminate sessions automatically (45 CFR § 164.312(a)(3))');
            }

            // Check for emergency access procedure documentation
            var hasEAP = document.body.innerHTML.toLowerCase().indexOf('emergency access') > -1 ||
                         document.body.innerHTML.toLowerCase().indexOf('break the glass') > -1 ||
                         document.body.innerHTML.toLowerCase().indexOf('emergency procedure') > -1;
            if (hasEAP) {
              addIssue('access', 'emergency', 'info', 'page', 'Emergency access procedure documented on page', 'Ensure emergency access procedures are documented and audited as required by 45 CFR § 164.312(a)(1)');
            }

            // Check for encryption/decryption mechanisms (HTTPS is the minimum)
            if (!pageUrl.startsWith('https://') && !pageUrl.startsWith('about:') && !pageUrl.startsWith('file://')) {
              addIssue('access', 'encryption', 'error', 'page', 'Page not served over HTTPS — encryption and decryption (45 CFR § 164.312(a)(2)(iv)) requires encrypted transmission for PHI', 'Enable HTTPS with TLS 1.2+ to encrypt data in transit');
            }
          }

          // ========== 2. AUDIT CONTROLS (45 CFR § 164.312(b)) ==========
          if (allCats || activeCats.includes('audit')) {
            // Check for audit logging indicators
            var scripts = document.querySelectorAll('script');
            var hasAuditLogging = false;
            var auditKeywords = ['audit', 'log', 'activity log', 'access log', 'tracking', 'monitor'];
            scripts.forEach(function(s) {
              var text = (s.textContent || '').toLowerCase();
              auditKeywords.forEach(function(k) {
                if (text.indexOf(k) > -1) hasAuditLogging = true;
              });
            });
            if (!hasAuditLogging) {
              addIssue('audit', 'logging', 'error', 'page', 'No audit logging mechanism detected — required for recording PHI access (45 CFR § 164.312(b))', 'Implement activity logging to record who accessed PHI, when, and what actions were taken');
            }

            // Check for timestamp presence
            var hasTimestamps = document.body.innerHTML.toLowerCase().indexOf('timestamp') > -1 ||
                                document.body.innerHTML.toLowerCase().indexOf('date/time') > -1 ||
                                document.body.innerHTML.toLowerCase().indexOf('recorded on') > -1;
            if (!hasTimestamps) {
              addIssue('audit', 'timestamps', 'info', 'page', 'No timestamp indicators found — audit logs should record dates and times of PHI access events', 'Record timestamps with each audit log entry to meet compliance requirements');
            }

            // Check for session recording/logging mechanisms
            var hasAnalytics = document.querySelectorAll('script[src*="analytics"], script[src*="tracking"], script[src*="monitor"]').length > 0;
            if (!hasAnalytics && !hasAuditLogging) {
              addIssue('audit', 'monitoring', 'warning', 'page', 'No monitoring or analytics scripts found — consider adding audit trail capabilities for PHI access monitoring', 'Implement audit trail to track and monitor all PHI access');
            }
          }

          // ========== 3. INTEGRITY CONTROLS (45 CFR § 164.312(c)) ==========
          if (allCats || activeCats.includes('integrity')) {
            // Check for data modification tracking
            var hasVersioning = document.querySelectorAll('meta[name*="version"], meta[name*="revision"], meta[property*="modified"]').length > 0 ||
                                document.body.innerHTML.toLowerCase().indexOf('last modified') > -1 ||
                                document.body.innerHTML.toLowerCase().indexOf('version') > -1;
            if (!hasVersioning) {
              addIssue('integrity', 'modification', 'warning', 'meta', 'No data versioning or modification tracking detected — controls needed to protect PHI integrity (45 CFR § 164.312(c)(1))', 'Implement version tracking and data modification logs to detect unauthorized alterations');
            }

            // Check for authentication mechanisms for data modification
            var hasEditControls = document.querySelectorAll('[contenteditable]').length === 0;
            if (!hasEditControls) {
              addIssue('integrity', 'authentication', 'warning', 'page', 'Editable content detected — ensure PHI modifications are authenticated and authorized', 'Authenticate all data modification requests and log changes to PHI');
            }

            // Check for form validation (integrity check on input)
            var forms = document.querySelectorAll('form');
            var formsWithValidation = 0;
            forms.forEach(function(f) {
              var inputs = f.querySelectorAll('input[type]:not([type="hidden"]):not([type="submit"]):not([type="button"])');
              var hasValidation = false;
              inputs.forEach(function(inp) {
                if (inp.hasAttribute('required') || inp.hasAttribute('pattern') || inp.hasAttribute('minlength') || inp.hasAttribute('maxlength')) hasValidation = true;
              });
              if (hasValidation) formsWithValidation++;
            });
            if (forms.length > 0 && formsWithValidation < forms.length) {
              addIssue('integrity', 'validation', 'warning', 'form', formsWithValidation + '/' + forms.length + ' form(s) have input validation — integrity controls prevent unauthorized PHI modification', 'Add client-side and server-side validation to all PHI input fields');
            }
          }

          // ========== 4. PERSON OR ENTITY AUTHENTICATION (45 CFR § 164.312(d)) ==========
          if (allCats || activeCats.includes('auth')) {
            // Check password field security
            var passwordFields = document.querySelectorAll('input[type="password"]');
            if (passwordFields.length > 0) {
              addIssue('auth', 'password', 'info', 'password', passwordFields.length + ' password field(s) detected — verify strong password policies are enforced', 'Implement minimum password strength: 8+ chars, complexity, and rotation policies per HIPAA');
              passwordFields.forEach(function(pf) {
                var form = pf.closest('form');
                if (form && form.getAttribute('method') && form.getAttribute('method').toUpperCase() === 'GET') {
                  addIssue('auth', 'transmission', 'error', 'form', 'Password field submitted via GET — credentials exposed in URL!', 'Use POST method for all forms containing passwords or PHI');
                }
              });
            } else {
              addIssue('auth', 'authentication', 'info', 'page', 'No password fields on this page — may not require authentication for the current view', 'Ensure all PHI access requires person/entity authentication per 45 CFR § 164.312(d)');
            }

            // Check for multi-factor authentication indicators
            var hasMFA = document.body.innerHTML.toLowerCase().indexOf('two-factor') > -1 ||
                         document.body.innerHTML.toLowerCase().indexOf('2fa') > -1 ||
                         document.body.innerHTML.toLowerCase().indexOf('multi-factor') > -1 ||
                         document.body.innerHTML.toLowerCase().indexOf('mfa') > -1 ||
                         document.body.innerHTML.toLowerCase().indexOf('verification code') > -1;
            if (!hasMFA && passwordFields.length > 0) {
              addIssue('auth', 'mfa', 'warning', 'page', 'No multi-factor authentication (MFA) indicators detected — strongly recommended for PHI access', 'Implement MFA (2FA) for all users accessing PHI to meet HIPAA security requirements');
            }

            // Check for biometric/pin/alternative auth indicators
            var hasAlternativeAuth = document.body.innerHTML.toLowerCase().indexOf('fingerprint') > -1 ||
                                      document.body.innerHTML.toLowerCase().indexOf('face id') > -1 ||
                                      document.body.innerHTML.toLowerCase().indexOf('pin') > -1;
            if (!hasMFA && !hasAlternativeAuth && passwordFields.length > 0) {
              addIssue('auth', 'alternatives', 'info', 'page', 'Only password-based authentication detected — consider biometric or token-based alternatives', 'Offer multiple authentication factors (something you know, have, are) per HIPAA flexibility of approach');
            }
          }

          // ========== 5. TRANSMISSION SECURITY (45 CFR § 164.312(e)) ==========
          if (allCats || activeCats.includes('transmission')) {
            // HTTPS check
            if (!pageUrl.startsWith('https://') && !pageUrl.startsWith('about:') && !pageUrl.startsWith('file://') && !pageUrl.startsWith('data:')) {
              addIssue('transmission', 'encryption', 'error', 'page', 'Data NOT encrypted in transit — requires TLS/HTTPS for PHI transmission (45 CFR § 164.312(e)(1))', 'Implement TLS 1.2+ encryption for all data transmitted over electronic networks');
            } else if (pageUrl.startsWith('https://')) {
              addIssue('transmission', 'encryption', 'info', 'page', 'HTTPS detected — data is encrypted in transit', 'Verify TLS 1.2+ is enforced and weak ciphers are disabled');
            }

            // Check for external resource loading (potential data leakage)
            var externalScripts = document.querySelectorAll('script[src]');
            var externalCount = 0;
            var externalList = [];
            externalScripts.forEach(function(s) {
              try {
                var sh = new URL(s.src).hostname;
                if (sh !== pageHost) { externalCount++; if (externalList.indexOf(sh) === -1) externalList.push(sh); }
              } catch(e) {}
            });
            var externalLinks = document.querySelectorAll('link[href]');
            externalLinks.forEach(function(l) {
              try {
                var lh = new URL(l.href).hostname;
                if (lh !== pageHost && externalList.indexOf(lh) === -1) externalList.push(lh);
              } catch(e) {}
            });
            if (externalList.length > 2) {
              addIssue('transmission', 'data-leakage', 'warning', 'external', externalList.length + ' external host(s) loaded — potential PHI data leakage via third-party services', 'Audit all third-party services for HIPAA compliance and BAAs. Use Subresource Integrity (SRI).', externalList);
            }

            // Check for mixed content (HTTPS page loading HTTP resources)
            if (pageUrl.startsWith('https://')) {
              var httpResources = document.querySelectorAll('script[src^="http://"], link[href^="http://"], iframe[src^="http://"], img[src^="http://"]');
              if (httpResources.length > 0) {
                addIssue('transmission', 'mixed-content', 'error', 'page', httpResources.length + ' HTTP resource(s) on HTTPS page — breaks encryption integrity!', 'Upgrade all resources to HTTPS to maintain end-to-end encryption');
              }
            }

            // Check iframes (potential for clickjacking or data exposure)
            var iframes = document.querySelectorAll('iframe');
            if (iframes.length > 0) {
              addIssue('transmission', 'iframes', 'info', 'iframe', iframes.length + ' iframe(s) on page — ensure PHI cannot be exposed through framing', 'Use X-Frame-Options: DENY or frame-src CSP directive to control framing');
            }
          }

          // ========== 6. DATA BACKUP & DISASTER RECOVERY ==========
          if (allCats || activeCats.includes('backup')) {
            // Check for backup indicators
            var hasBackupMention = document.body.innerHTML.toLowerCase().indexOf('backup') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('data recovery') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('disaster recovery') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('failover') > -1;
            if (!hasBackupMention) {
              addIssue('backup', 'recovery', 'warning', 'page', 'No backup or disaster recovery indicators found — required for PHI availability (45 CFR § 164.308(a)(7))', 'Implement regular PHI data backups and a disaster recovery plan. Test recovery procedures periodically.');
            }

            // Check for cache/manifest/service worker (offline support)
            var hasServiceWorker = document.querySelectorAll('script[src*="service-worker"], script[src*="sw.js"]').length > 0;
            var hasManifest = document.querySelector('link[rel="manifest"]');
            if (hasServiceWorker || hasManifest) {
              addIssue('backup', 'offline', 'info', 'page', 'Offline/caching capability detected — ensure cached PHI is encrypted and access-controlled', 'If caching PHI offline, encrypt the cache and enforce access controls');
            }

            // Check localStorage (shouldn't store PHI)
            try {
              if (localStorage.length > 0) {
                addIssue('backup', 'storage', 'warning', 'localStorage', 'localStorage contains ' + localStorage.length + ' item(s) — PHI must NOT be stored in client-side storage', 'PHI should not be stored in localStorage. Use secure server-side session storage if needed.');
              }
            } catch(e) {}
          }

          // ========== 7. PRIVACY PRACTICES & PATIENT RIGHTS (45 CFR § 164.520-528) ==========
          if (allCats || activeCats.includes('privacy')) {
            // Check for Notice of Privacy Practices (NPP)
            var hasNPP = document.body.innerHTML.toLowerCase().indexOf('notice of privacy practices') > -1 ||
                          document.body.innerHTML.toLowerCase().indexOf('privacy practices') > -1 ||
                          document.body.innerHTML.toLowerCase().indexOf('privacy policy') > -1 ||
                          document.body.innerHTML.toLowerCase().indexOf('hipaa notice') > -1;
            if (!hasNPP) {
              addIssue('privacy', 'npp', 'error', 'page', 'No Notice of Privacy Practices found — required by 45 CFR § 164.520', 'Provide a Notice of Privacy Practices describing how PHI is used, disclosed, and patient rights');
            }

            // Check for patient rights information
            var hasPatientRights = document.body.innerHTML.toLowerCase().indexOf('access your health') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('request amendment') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('accounting of disclosure') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('request restriction') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('request copies') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('right to access') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('right to amend') > -1;
            if (!hasPatientRights) {
              addIssue('privacy', 'rights', 'warning', 'page', 'No patient rights information found — patients have rights to access, amend, and request accounting of PHI disclosures (45 CFR § 164.524-528)', 'Document patient rights: right to access PHI, request amendments, receive accounting of disclosures, and request restrictions');
            }

            // Check for contact information for privacy officer
            var hasPrivacyContact = document.body.innerHTML.toLowerCase().indexOf('privacy officer') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('privacy official') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('compliance officer') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('privacy@') > -1 ||
                                    document.body.innerHTML.toLowerCase().indexOf('hipaa@') > -1;
            if (!hasPrivacyContact) {
              addIssue('privacy', 'contact', 'info', 'page', 'No privacy officer contact information found', 'Provide contact information for the designated privacy officer for questions about PHI practices');
            }

            // Check for complaint procedure (to HHS OCR)
            var hasComplaintInfo = document.body.innerHTML.toLowerCase().indexOf('complaint') > -1 &&
                                    (document.body.innerHTML.toLowerCase().indexOf('ocr') > -1 ||
                                     document.body.innerHTML.toLowerCase().indexOf('civil rights') > -1 ||
                                     document.body.innerHTML.toLowerCase().indexOf('hhs') > -1);
            if (!hasComplaintInfo) {
              addIssue('privacy', 'complaints', 'info', 'page', 'No information about filing complaints with HHS OCR', 'Include information on how patients can file a complaint with HHS Office for Civil Rights');
            }
          }

          // ========== 8. PHI SAFEGUARDS & MINIMUM NECESSARY ==========
          if (allCats || activeCats.includes('phi')) {
            // Check for PHI display (basic heuristic — flags forms with health-related fields)
            var healthKeywords = ['ssn', 'social security', 'date of birth', 'dob', 'diagnosis', 'medical record', 'patient id', 'health insurance', 'treatment', 'condition', 'symptom', 'prescription', 'medication', 'disease', 'allergy', 'blood type', 'test result', 'lab result', 'insurance id', 'medicare', 'medicaid', 'provider', 'physician', 'doctor'];
            var phiFields = [];
            document.querySelectorAll('input, textarea, select, label').forEach(function(el) {
              var text = ((el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.textContent || '')).toLowerCase();
              healthKeywords.forEach(function(k) {
                if (text.indexOf(k) > -1 && phiFields.indexOf(k) === -1) phiFields.push(k);
              });
            });
            if (phiFields.length > 0) {
              addIssue('phi', 'data-collection', 'warning', 'input', 'PHI-related field(s) detected: ' + phiFields.join(', '), 'Ensure minimum necessary standard is applied (45 CFR § 164.502(b)) — only collect PHI essential to the purpose', phiFields);
            }

            // Check for data masking/de-identification
            var hasMasking = document.body.innerHTML.toLowerCase().indexOf('masked') > -1 ||
                              document.body.innerHTML.toLowerCase().indexOf('redacted') > -1 ||
                              document.body.innerHTML.toLowerCase().indexOf('de-identif') > -1 ||
                              document.body.innerHTML.toLowerCase().indexOf('anonymized') > -1 ||
                              document.body.innerHTML.toLowerCase().indexOf('partial') > -1;
            if (phiFields.length > 0 && !hasMasking) {
              addIssue('phi', 'de-identification', 'warning', 'page', 'No data masking or de-identification detected — display PHI with care', 'Mask or truncate PHI in display (e.g., show last 4 digits of SSN). Use de-identification for analytics.');
            }

            // Check for autocomplete on sensitive fields
            var sensitiveInputs = document.querySelectorAll('input[type="text"], input[type="email"]');
            var autocompleteOff = 0;
            var autocompleteOn = 0;
            sensitiveInputs.forEach(function(inp) {
              var auto = inp.getAttribute('autocomplete');
              if (auto === 'off') autocompleteOff++;
              else if (auto && auto !== 'off') autocompleteOn++;
            });
            if (sensitiveInputs.length > 0 && autocompleteOff === 0) {
              addIssue('phi', 'autocomplete', 'info', 'input', 'Autocomplete not disabled on form fields — browser may cache PHI', 'Set autocomplete="off" on fields collecting PHI to prevent browser caching of sensitive data');
            }

            // Check for data minimization (many input fields = more PHI exposure)
            var allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select').length;
            if (allInputs > 10) {
              addIssue('phi', 'minimization', 'info', 'form', allInputs + ' input field(s) on page — review for minimum necessary compliance', 'Apply the minimum necessary standard: only collect the minimum PHI needed for the intended purpose');
            }

            // Check for visible sensitive data on page
            // (Simple check for structured data patterns)
            var pageText = document.body.innerText || '';
            var ssnPattern = /\\b\\d{3}-\\d{2}-\\d{4}\\b/g;
            var ssnMatches = pageText.match(ssnPattern);
            if (ssnMatches && ssnMatches.length > 0) {
              addIssue('phi', 'exposure', 'error', 'page', ssnMatches.length + ' potential SSN(s) visible in page content — PHI exposure risk!', 'Mask SSNs (show only last 4 digits). SSNs should never be displayed in full on screens or printouts.');
            }

            // Check for email links (unencrypted communication of PHI)
            var emailLinks = document.querySelectorAll('a[href^="mailto:"]');
            if (emailLinks.length > 0) {
              addIssue('phi', 'communication', 'warning', 'email', emailLinks.length + ' email link(s) — standard email is not secure for PHI communication', 'Use secure messaging portals instead of email for PHI, or use encrypted email services with BAAs');
            }

            // Check for form action pointing to non-HTTPS
            var formsInsecure = document.querySelectorAll('form[action^="http://"]');
            if (formsInsecure.length > 0) {
              addIssue('phi', 'transmission', 'error', 'form', formsInsecure.length + ' form(s) submit data over HTTP — PHI would be transmitted unencrypted!', 'All form actions must use HTTPS for PHI submission');
            }
          }

          return results;
        })()
      `);
      return { issues: results, total: results.length };
    } catch (e) {
      return { issues: [], total: 0, error: e.message };
    }
  });

  // UX Advisor - Usability & UX Audit
  ipcMain.handle('monitor:uxAdvisor', async (event, { tabId, categories }) => {
    const tab = tabs.get(tabId);
    if (!tab || !tab.webContents) return null;

    try {
      const results = await tab.webContents.executeJavaScript(`
        (function() {
          const results = [];
          const activeCats = ${JSON.stringify(categories || [])};
          const allCats = activeCats.length === 0;
          function addIssue(category, type, severity, element, message, recommendation, details) {
            results.push({ category, type, severity, element, message, recommendation, details: details || [] });
          }

          var pageText = (document.body.innerText || '').toLowerCase();
          var pageHtml = (document.body.innerHTML || '').toLowerCase();

          // ========== 1. NAVIGATION & FLOW ==========
          if (allCats || activeCats.includes('navigation')) {
            var breadcrumbs = document.querySelectorAll('nav[aria-label*="breadcrumb"], .breadcrumb, [class*="breadcrumb"], [id*="breadcrumb"]');
            if (breadcrumbs.length === 0) {
              addIssue('navigation', 'breadcrumbs', 'info', 'nav', 'No breadcrumb navigation detected on multi-level pages', 'Add breadcrumb navigation to help users understand their location in the site hierarchy');
            }
            var skipLinks = document.querySelectorAll('a[href*="#main"], a[href*="#content"], a[class*="skip"], a[id*="skip"]');
            var hasSkipLink = false;
            skipLinks.forEach(function(l) {
              if ((l.textContent || '').toLowerCase().indexOf('skip') > -1) hasSkipLink = true;
            });
            if (!hasSkipLink) {
              addIssue('navigation', 'skip-link', 'warning', 'a', 'No skip-to-content link found — users must tab through all navigation', 'Add a "Skip to main content" link as the first focusable element');
            }
            var h1 = document.querySelector('h1');
            if (!h1) {
              addIssue('navigation', 'page-title', 'error', 'h1', 'No h1 heading found — users need clear page titles for orientation', 'Add a descriptive h1 that clearly states the page purpose');
            } else if ((h1.textContent || '').trim().length < 3) {
              addIssue('navigation', 'page-title', 'warning', 'h1', 'h1 heading is too short to be descriptive', 'Make the h1 clearly describe the page content');
            }
            var navElements = document.querySelectorAll('nav, [role="navigation"]');
            if (navElements.length === 0 && document.querySelectorAll('a').length > 5) {
              addIssue('navigation', 'landmark', 'warning', 'nav', 'No navigation landmark found with many links on page', 'Wrap navigation links in a <nav> element or role="navigation"');
            }
            if (document.querySelectorAll('main').length === 0) {
              addIssue('navigation', 'layout', 'info', 'main', 'No <main> element — important for screen reader navigation', 'Wrap primary page content in a <main> element');
            }
          }

          // ========== 2. FORMS & INPUT ==========
          if (allCats || activeCats.includes('forms')) {
            var forms = document.querySelectorAll('form');
            if (forms.length > 0) {
              addIssue('forms', 'detected', 'info', 'form', forms.length + ' form(s) on page', 'Review form usability: clear labels, error messages, and keyboard support');
              var inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])');
              var unlabeled = 0;
              inputs.forEach(function(inp) {
                var id = inp.id;
                var hasLabel = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
                var hasAriaLabel = inp.getAttribute('aria-label');
                var isInLabel = inp.closest('label');
                if (!hasLabel && !hasAriaLabel && !isInLabel) unlabeled++;
              });
              if (unlabeled > 0) {
                addIssue('forms', 'labels', 'error', 'input', unlabeled + ' input(s) missing proper labels — critical for usability and accessibility', 'Each input needs a visible <label> element for clickable focus and screen reader support');
              }
              var hasErrorDisplay = pageHtml.indexOf('error') > -1 || document.querySelectorAll('[aria-live], [role="alert"]').length > 0;
              if (!hasErrorDisplay) {
                addIssue('forms', 'error-feedback', 'warning', 'form', 'No error message display mechanism detected', 'Add inline validation error messages near the relevant fields, not just at the top of the form');
              }
              var submitBtns = document.querySelectorAll('input[type="submit"], button[type="submit"]');
              var vagueSubmit = 0;
              submitBtns.forEach(function(btn) {
                var text = (btn.textContent || btn.value || '').trim().toLowerCase();
                if (text === 'submit' || text === 'go' || text === 'ok' || text === 'enter') vagueSubmit++;
              });
              if (vagueSubmit > 0) {
                addIssue('forms', 'submit-button', 'warning', 'button', vagueSubmit + ' submit button(s) use vague text like "Submit"', 'Use action-oriented button text like "Send Message", "Create Account", or "Save Changes"');
              }
            }
          }

          // ========== 3. VISUAL CONSISTENCY ==========
          if (allCats || activeCats.includes('visual')) {
            var allEls = document.querySelectorAll('*');
            var fonts = {};
            allEls.forEach(function(el) {
              try {
                var font = window.getComputedStyle(el).fontFamily;
                if (font) {
                  var cleanFont = font.split(',')[0].trim().replace(/[\'\"]/g, '');
                  if (cleanFont && cleanFont !== 'inherit') fonts[cleanFont] = (fonts[cleanFont] || 0) + 1;
                }
              } catch(e) {}
            });
            var fontCount = Object.keys(fonts).length;
            if (fontCount > 4) {
              addIssue('visual', 'fonts', 'warning', 'page', fontCount + ' different font families detected — visual inconsistency', 'Limit to 2-3 font families (headings, body, monospace) for visual consistency');
            }
            var buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
            var btnStyles = {};
            buttons.forEach(function(btn) {
              try {
                var bg = window.getComputedStyle(btn).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)') btnStyles[bg] = (btnStyles[bg] || 0) + 1;
              } catch(e) {}
            });
            if (Object.keys(btnStyles).length > 3 && buttons.length > 3) {
              addIssue('visual', 'button-styles', 'info', 'button', Object.keys(btnStyles).length + ' different button styles detected', 'Standardize button styles for primary, secondary, and tertiary actions');
            }
            var texts = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, div');
            var alignments = {};
            texts.forEach(function(t) {
              try {
                var align = window.getComputedStyle(t).textAlign;
                if (align && align !== 'inherit') alignments[align] = (alignments[align] || 0) + 1;
              } catch(e) {}
            });
            if (alignments['justify'] && alignments['justify'] > 0) {
              addIssue('visual', 'alignment', 'warning', 'text', 'Justified text detected — reduces readability', 'Use left-aligned text for body content. Justified text creates uneven spacing that hinders reading.');
            }
          }

          // ========== 4. CONTENT & READABILITY ==========
          if (allCats || activeCats.includes('content')) {
            try {
              var bodyFontSize = window.getComputedStyle(document.body).fontSize;
              var bodySizePx = parseFloat(bodyFontSize);
              if (bodySizePx < 14) {
                addIssue('content', 'font-size', 'error', 'body', 'Body font size (' + bodyFontSize + ') below 14px — too small for comfortable reading', 'Set body font size to at least 16px for optimal readability');
              } else if (bodySizePx < 16) {
                addIssue('content', 'font-size', 'warning', 'body', 'Body font size (' + bodyFontSize + ') below 16px — consider increasing', '16px body text is the recommended minimum for comfortable reading');
              }
            } catch(e) {}
            var paras = document.querySelectorAll('p');
            var veryLongParas = 0;
            paras.forEach(function(p) {
              var words = (p.textContent || '').trim().split(/\\s+/).length;
              if (words > 150) veryLongParas++;
            });
            if (veryLongParas > 0) {
              addIssue('content', 'paragraph-length', 'info', 'p', veryLongParas + ' paragraph(s) with 150+ words — long paragraphs reduce readability', 'Break long paragraphs into smaller chunks of 3-5 sentences each');
            }
            var links = document.querySelectorAll('a[href]');
            var vagueLinks = 0;
            var vagueTexts = ['click here', 'read more', 'learn more', 'more', 'here', 'this', 'link', 'go'];
            links.forEach(function(l) {
              var text = (l.textContent || '').trim().toLowerCase();
              if (vagueTexts.indexOf(text) > -1) vagueLinks++;
            });
            if (vagueLinks > 0) {
              addIssue('content', 'link-text', 'warning', 'a', vagueLinks + ' link(s) use vague text like "click here" or "read more"', 'Use descriptive link text that tells users where the link goes (e.g., "View pricing" instead of "Click here")');
            }
            var allCapsCount = 0;
            document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, button, a').forEach(function(el) {
              try {
                var txt = (el.textContent || '').trim();
                if (txt.length > 4 && txt === txt.toUpperCase() && txt.length < 100) {
                  var style = window.getComputedStyle(el);
                  if (style.textTransform !== 'uppercase') allCapsCount++;
                }
              } catch(e) {}
            });
            if (allCapsCount > 3) {
              addIssue('content', 'all-caps', 'info', 'text', allCapsCount + ' instances of ALL CAPS text — reduces readability', 'Use CSS text-transform: uppercase for decorative caps instead of typing in all caps');
            }
          }

          // ========== 5. FEEDBACK & RESPONSIVENESS ==========
          if (allCats || activeCats.includes('feedback')) {
            var hasLoadingIndicator = document.querySelectorAll('[class*="loading"], [id*="loading"], [class*="spinner"], [class*="skeleton"]').length > 0;
            if (!hasLoadingIndicator) {
              addIssue('feedback', 'loading', 'info', 'page', 'No loading indicators detected for async operations', 'Show loading spinners or skeleton screens during data fetching to indicate the page is working');
            }
            var interactiveEls = document.querySelectorAll('a, button, [role="button"], input[type="submit"]');
            var hasHoverEffects = false;
            interactiveEls.forEach(function(el) {
              try {
                var cursor = window.getComputedStyle(el).cursor;
                if (cursor === 'pointer') hasHoverEffects = true;
              } catch(e) {}
            });
            if (!hasHoverEffects && interactiveEls.length > 0) {
              addIssue('feedback', 'hover', 'warning', 'button/a', 'Interactive elements may lack hover/focus visual feedback', 'Add cursor:pointer and hover:background-color transitions to all clickable elements');
            }
            var hasFocusStyles = false;
            try {
              for (var si = 0; si < document.styleSheets.length; si++) {
                try {
                  var rules = document.styleSheets[si].cssRules || document.styleSheets[si].rules;
                  if (rules) {
                    for (var ri = 0; ri < rules.length; ri++) {
                      var sel = (rules[ri].selectorText || '');
                      if (sel.indexOf(':focus') > -1 && sel.indexOf(':focus-visible') === -1) hasFocusStyles = true;
                    }
                  }
                } catch(e) {}
              }
            } catch(e) {}
            if (!hasFocusStyles) {
              addIssue('feedback', 'focus', 'warning', 'page', 'No custom focus styles detected — keyboard users need visible focus indicators', 'Add :focus-visible styles for keyboard navigation. Never use outline:none without a visible alternative.');
            }
          }

          // ========== 6. MOBILE & TOUCH ==========
          if (allCats || activeCats.includes('mobile')) {
            var viewport = document.querySelector('meta[name="viewport"]');
            if (!viewport) {
              addIssue('mobile', 'viewport', 'error', 'meta', 'Missing viewport meta tag — page will not render properly on mobile', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">');
            }
            var smallTargets = 0;
            interactiveEls.forEach(function(el) {
              try {
                var rect = el.getBoundingClientRect();
                if (rect.width < 44 || rect.height < 44) smallTargets++;
              } catch(e) {}
            });
            if (smallTargets > 0) {
              addIssue('mobile', 'touch-targets', 'warning', 'button/a', smallTargets + ' interactive element(s) smaller than 44x44px — hard to tap on mobile', 'Ensure all touch targets are at least 44x44px (WCAG 2.5.5)');
            }
            try {
              var docWidth = document.documentElement.scrollWidth;
              var windowWidth = window.innerWidth;
              if (docWidth > windowWidth + 5) {
                addIssue('mobile', 'overflow', 'warning', 'page', 'Page width (' + Math.round(docWidth) + 'px) exceeds viewport (' + windowWidth + 'px) — horizontal scrolling', 'Use max-width: 100% and overflow: hidden on containers to prevent horizontal scroll on mobile');
              }
            } catch(e) {}
          }

          // ========== 7. SEARCH & FINDABILITY ==========
          if (allCats || activeCats.includes('search')) {
            var hasSearch = document.querySelectorAll('input[type="search"], [role="search"], form[action*="search"], input[name*="search"]').length > 0;
            if (!hasSearch && document.querySelectorAll('a').length > 20) {
              addIssue('search', 'site-search', 'warning', 'page', 'No site search detected on a page with many links', 'Add a search feature for large sites to help users find content quickly');
            }
            var headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
            if (headings.length < 2 && document.body && document.body.children.length > 5) {
              addIssue('search', 'headings', 'warning', 'page', 'Very few headings (' + headings.length + ') — users scan pages via headings', 'Add descriptive headings to break up content and help users find information');
            }
          }

          // ========== 8. ACCESSIBILITY BASICS ==========
          if (allCats || activeCats.includes('a11y-ux')) {
            var focusable = document.querySelectorAll('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
            if (focusable.length === 0 && document.body && document.body.children.length > 0) {
              addIssue('a11y-ux', 'keyboard', 'error', 'page', 'No focusable elements found — page may be inaccessible via keyboard', 'Ensure all interactive elements are focusable and operable via keyboard');
            }
            var landmarks = document.querySelectorAll('[role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], header, nav, main, footer');
            if (landmarks.length < 2) {
              addIssue('a11y-ux', 'landmarks', 'warning', 'page', 'Very few ARIA landmarks (' + landmarks.length + ') — screen readers use landmarks for navigation', 'Add landmark roles (banner, navigation, main, contentinfo) to help screen reader users navigate');
            }
            var images = document.querySelectorAll('img');
            var missingAlt = 0;
            images.forEach(function(img) {
              if (!img.hasAttribute('alt')) missingAlt++;
            });
            if (missingAlt > 0) {
              addIssue('a11y-ux', 'alt-text', 'error', 'img', missingAlt + ' image(s) missing alt attribute — screen readers will read the file URL', 'Add descriptive alt text for informative images, alt="" for decorative');
            }
          }

          return results;
        })()
      `);
      return { issues: results, total: results.length };
    } catch (e) {
      return { issues: [], total: 0, error: e.message };
    }
  });

  // Performance Advisor - In-Depth Performance Audit
  ipcMain.handle('monitor:perfAdvisor', async (event, { tabId, categories }) => {
    const tab = tabs.get(tabId);
    if (!tab || !tab.webContents) return null;

    try {
      const results = await tab.webContents.executeJavaScript(`
        (function() {
          const results = [];
          const activeCats = ${JSON.stringify(categories || [])};
          const allCats = activeCats.length === 0;
          function addIssue(category, type, severity, element, message, recommendation, details) {
            results.push({ category, type, severity, element, message, recommendation, details: details || [] });
          }

          var scripts = document.querySelectorAll('script');
          var allElements = document.querySelectorAll('*');
          var perfData = window.performance;

          // ========== 1. PAGE LOAD ==========
          if (allCats || activeCats.includes('load')) {
            var navEntries = perfData.getEntriesByType('navigation');
            if (navEntries.length > 0) {
              var nav = navEntries[0];
              var loadTime = nav.loadEventEnd;
              if (loadTime > 3000) {
                addIssue('load', 'load-time', 'error', 'page', 'Page load time: ' + (loadTime/1000).toFixed(1) + 's — exceeds 3 second target', 'Optimize: reduce server response time, lazy-load non-critical resources, enable compression');
              } else if (loadTime > 2000) {
                addIssue('load', 'load-time', 'warning', 'page', 'Page load time: ' + (loadTime/1000).toFixed(1) + 's — exceeds 2 second target', 'Consider optimizing images, reducing JS bundle size, or using a CDN');
              } else if (loadTime > 0) {
                addIssue('load', 'load-time', 'info', 'page', 'Page load time: ' + (loadTime/1000).toFixed(1) + 's — good', 'Continue monitoring load times. Target <2s for optimal user experience.');
              }
              var firstByte = nav.responseStart - nav.requestStart;
              if (firstByte > 600) {
                addIssue('load', 'ttfb', 'warning', 'page', 'Time to First Byte: ' + firstByte.toFixed(0) + 'ms — server may be slow', 'Optimize server response: use caching, CDN, or upgrade hosting infrastructure');
              }
              var transferSize = nav.transferSize;
              if (transferSize > 500000) {
                addIssue('load', 'transfer-size', 'warning', 'page', 'Large page transfer: ' + (transferSize/1000).toFixed(0) + 'KB', 'Reduce page weight: enable gzip/Brotli compression, minify resources, optimize images');
              }
              var redirectCount = nav.redirectCount;
              if (redirectCount > 2) {
                addIssue('load', 'redirects', 'warning', 'page', redirectCount + ' redirects — each adds latency', 'Minimize redirects. Use direct links instead of redirect chains.');
              }
            }
            var resources = perfData.getEntriesByType('resource');
            if (resources.length > 100) {
              addIssue('load', 'resource-count', 'warning', 'page', resources.length + ' resource requests — high request count', 'Consolidate resources, use CSS sprites, and combine JS/CSS files to reduce HTTP requests');
            }
          }

          // ========== 2. IMAGES & MEDIA ==========
          if (allCats || activeCats.includes('images')) {
            var images = document.querySelectorAll('img');
            var noDimensions = 0;
            var noLazy = 0;
            images.forEach(function(img) {
              if (!img.hasAttribute('width') && !img.hasAttribute('height')) noDimensions++;
              if (!img.hasAttribute('loading') || img.getAttribute('loading') !== 'lazy') noLazy++;
            });
            if (images.length > 0) {
              if (noDimensions > 0) {
                addIssue('images', 'dimensions', 'warning', 'img', noDimensions + '/' + images.length + ' image(s) missing width/height — causes layout shift (CLS)', 'Always specify width and height on images to prevent Cumulative Layout Shift');
              }
              if (noLazy === images.length && images.length > 3) {
                addIssue('images', 'lazy-loading', 'warning', 'img', 'None of ' + images.length + ' images use lazy loading — delays initial page render', 'Add loading="lazy" to below-the-fold images to defer loading');
              }
            }
          }

          // ========== 3. JAVASCRIPT ==========
          if (allCats || activeCats.includes('javascript')) {
            var renderBlocking = 0;
            var externalSrc = 0;
            scripts.forEach(function(s) {
              if (s.hasAttribute('src')) {
                externalSrc++;
                if (!s.hasAttribute('defer') && !s.hasAttribute('async')) renderBlocking++;
              }
            });
            if (renderBlocking > 0) {
              addIssue('javascript', 'render-blocking', 'warning', 'script', renderBlocking + ' external script(s) load synchronously — blocks rendering', 'Add defer or async to external scripts. Defer is preferred for compatibility.');
            }
            if (externalSrc > 10) {
              addIssue('javascript', 'script-count', 'info', 'script', externalSrc + ' external scripts — each adds HTTP overhead', 'Bundle scripts together and use code splitting to reduce request count');
            }
          }

          // ========== 4. CSS ==========
          if (allCats || activeCats.includes('css')) {
            var cssLinks = document.querySelectorAll('link[rel="stylesheet"]');
            var totalCSSRules = 0;
            try {
              for (var si = 0; si < document.styleSheets.length; si++) {
                try {
                  var rules = document.styleSheets[si].cssRules || document.styleSheets[si].rules;
                  if (rules) totalCSSRules += rules.length;
                } catch(e) {}
              }
            } catch(e) {}
            if (cssLinks.length > 4) {
              addIssue('css', 'stylesheet-count', 'warning', 'link', cssLinks.length + ' external stylesheets — increases HTTP requests', 'Consolidate CSS files. Use build tools to combine into fewer files.');
            }
            if (totalCSSRules > 1000) {
              addIssue('css', 'css-rules', 'warning', 'stylesheet', totalCSSRules + ' CSS rules — large stylesheet slows parsing', 'Remove unused CSS, use CSS purging tools in production builds');
            }
            var inlineStyleCount = document.querySelectorAll('[style]').length;
            if (inlineStyleCount > 10) {
              addIssue('css', 'inline-styles', 'warning', 'style', inlineStyleCount + ' elements with inline styles — not cacheable', 'Move inline styles to CSS classes to leverage browser caching and reduce HTML size');
            }
          }

          // ========== 5. NETWORK ==========
          if (allCats || activeCats.includes('network')) {
            var resources = perfData.getEntriesByType('resource');
            var protocolInfo = {};
            var hostCounts = {};
            resources.forEach(function(r) {
              var proto = r.nextHopProtocol || 'unknown';
              protocolInfo[proto] = (protocolInfo[proto] || 0) + 1;
              try {
                var host = new URL(r.name).hostname;
                hostCounts[host] = (hostCounts[host] || 0) + 1;
              } catch(e) {}
            });
            var hasHTTP2 = Object.keys(protocolInfo).some(function(p) { return p.indexOf('h2') > -1 || p.indexOf('h3') > -1; });
            if (!hasHTTP2 && Object.keys(protocolInfo).length > 0) {
              addIssue('network', 'protocol', 'warning', 'page', 'Resources use HTTP/1.x — no multiplexing or header compression', 'Enable HTTP/2 on your server for multiplexed requests, header compression, and better performance');
            }
            if (Object.keys(hostCounts).length > 6) {
              addIssue('network', 'hosts', 'warning', 'page', Object.keys(hostCounts).length + ' different hosts contacted — DNS + connection overhead', 'Reduce third-party services. Use preconnect hint: <link rel="preconnect" href="...">');
            }
          }

          // ========== 6. CACHING ==========
          if (allCats || activeCats.includes('caching')) {
            try {
              if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
                addIssue('caching', 'service-worker', 'info', 'page', 'No service worker controlling this page', 'Implement a service worker for offline support, cache-first strategies, and faster repeat visits');
              }
            } catch(e) {}
            var resources = perfData.getEntriesByType('resource');
            var cachedResources = 0;
            resources.forEach(function(r) {
              if (r.transferSize === 0 && r.duration < 5) cachedResources++;
            });
            if (resources.length > 0) {
              var cacheHitRate = (cachedResources / resources.length * 100).toFixed(0);
              if (cacheHitRate < 20 && resources.length > 5) {
                addIssue('caching', 'cache-hit-rate', 'warning', 'page', 'Low cache hit rate (~' + cacheHitRate + '%) — resources may not be cached', 'Set far-future Cache-Control max-age and use fingerprinting in URLs');
              }
            }
          }

          // ========== 7. WEB VITALS ==========
          if (allCats || activeCats.includes('vitals')) {
            var paintEntries = perfData.getEntriesByType('paint');
            var fcp = null;
            paintEntries.forEach(function(p) {
              if (p.name === 'first-contentful-paint') fcp = p.startTime;
            });
            if (fcp !== null) {
              if (fcp > 2000) {
                addIssue('vitals', 'fcp', 'error', 'page', 'FCP: ' + (fcp/1000).toFixed(1) + 's — poor (target: <1.8s)', 'Optimize FCP: inline critical CSS, defer non-critical JS, optimize server response');
              } else if (fcp > 1000) {
                addIssue('vitals', 'fcp', 'warning', 'page', 'FCP: ' + (fcp/1000).toFixed(1) + 's — needs improvement (target: <1.8s)', 'Monitor FCP. Consider optimizing above-the-fold rendering.');
              } else if (fcp > 0) {
                addIssue('vitals', 'fcp', 'info', 'page', 'FCP: ' + (fcp/1000).toFixed(1) + 's — good', 'FCP target met.');
              }
            }
            try {
              var clsEntries = performance.getEntriesByType('layout-shift');
              if (clsEntries && clsEntries.length > 0) {
                var totalCLS = 0;
                clsEntries.forEach(function(entry) {
                  if (!entry.hadRecentInput) totalCLS += entry.value;
                });
                if (totalCLS > 0.25) {
                  addIssue('vitals', 'cls', 'error', 'page', 'CLS: ' + totalCLS.toFixed(2) + ' — poor (target: <0.1)', 'Fix layout shifts: always set dimensions on images/ads, avoid inserting content above existing content');
                } else if (totalCLS > 0.1) {
                  addIssue('vitals', 'cls', 'warning', 'page', 'CLS: ' + totalCLS.toFixed(2) + ' — needs improvement (target: <0.1)', 'Monitor CLS. Check for late-loading images without dimensions or dynamic content shifts.');
                } else if (totalCLS > 0) {
                  addIssue('vitals', 'cls', 'info', 'page', 'CLS: ' + totalCLS.toFixed(2) + ' — good', 'CLS target met.');
                }
              }
            } catch(e) {}
          }

          // ========== 8. OPTIMIZATION ==========
          if (allCats || activeCats.includes('optimization')) {
            var fontLinks = document.querySelectorAll('link[href*=".woff"], link[href*=".woff2"]');
            var fontFaces = 0;
            try {
              for (var si = 0; si < document.styleSheets.length; si++) {
                try {
                  var rules = document.styleSheets[si].cssRules || document.styleSheets[si].rules;
                  if (rules) {
                    for (var ri = 0; ri < rules.length; ri++) {
                      if (rules[ri].cssText && rules[ri].cssText.indexOf('@font-face') > -1) fontFaces++;
                    }
                  }
                } catch(e) {}
              }
            } catch(e) {}
            if (fontFaces > 4) {
              addIssue('optimization', 'fonts', 'warning', 'font', fontFaces + ' @font-face declarations — each adds download overhead', 'Limit custom fonts to 2-3 families. Use font-display: swap to prevent invisible text.');
            }
            if (allElements.length > 1500) {
              addIssue('optimization', 'dom-size', 'warning', 'DOM', allElements.length + ' DOM nodes — large DOM impacts performance', 'Reduce DOM size: use virtual scrolling for long lists, avoid deeply nested tables');
            }
            var embedCount = document.querySelectorAll('iframe, embed, object').length;
            if (embedCount > 3) {
              addIssue('optimization', 'embeds', 'warning', 'iframe', embedCount + ' embedded resources — each adds weight and slows page', 'Lazy-load third-party embeds and only load visible ones');
            }
          }

          return results;
        })()
      `);
      return { issues: results, total: results.length };
    } catch (e) {
      return { issues: [], total: 0, error: e.message };
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

  // Security Advisor - comprehensive security audit with category selection
  ipcMain.handle('monitor:securityAdvisor', async (event, { tabId, categories }) => {
    const tab = tabs.get(tabId);
    if (!tab || !tab.webContents) return null;

    try {
      const results = await tab.webContents.executeJavaScript(`
        (function() {
          const results = [];
          const activeCats = ${JSON.stringify(categories || [])};
          const allCats = activeCats.length === 0;
          function addIssue(category, type, severity, element, message, recommendation, details) {
            results.push({ category, type, severity, element, message, recommendation, details: details || [] });
          }

          // ========== 1. HTTPS / SSL ==========
          if (allCats || activeCats.includes('https')) {
            var pageUrl = window.location.href;
            if (!pageUrl.startsWith('https://') && !pageUrl.startsWith('about:') && !pageUrl.startsWith('file://') && !pageUrl.startsWith('data:')) {
              addIssue('https', 'security', 'error', 'page', 'Page is not served over HTTPS', 'Enable HTTPS with a valid SSL/TLS certificate. All traffic should be encrypted.');
            }
            var mixedContent = [];
            document.querySelectorAll('script[src^="http://"], link[href^="http://"], iframe[src^="http://"], img[src^="http://"], object[data^="http://"], source[src^="http://"], video[src^="http://"], audio[src^="http://"]').forEach(function(el) {
              var src = el.src || el.href || el.data || '';
              if (src.startsWith('http://')) mixedContent.push(src);
            });
            if (mixedContent.length > 0) {
              addIssue('https', 'mixed-content', 'error', 'mixed-content', mixedContent.length + ' mixed content resource(s) loaded over HTTP', 'Upgrade all resources to HTTPS.', mixedContent.slice(0, 5));
            }
          }

          // ========== 2. SECURITY HEADERS ==========
          if (allCats || activeCats.includes('headers')) {
            var cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
            if (cspMeta) {
              var cspContent = (cspMeta.getAttribute('content') || '').toLowerCase();
              if (cspContent.includes('unsafe-inline')) {
                addIssue('headers', 'csp', 'warning', 'meta', 'CSP allows unsafe-inline, weakening XSS protection', 'Use nonces or hashes instead of unsafe-inline');
              }
              if (cspContent.includes('unsafe-eval')) {
                addIssue('headers', 'csp', 'warning', 'meta', 'CSP allows unsafe-eval', 'Remove unsafe-eval from CSP to prevent arbitrary code execution');
              }
              if (cspContent.includes('*')) {
                addIssue('headers', 'csp', 'warning', 'meta', 'CSP uses wildcard (*), too permissive', 'Restrict CSP to specific trusted origins');
              }
            } else {
              addIssue('headers', 'csp', 'error', 'meta', 'No Content Security Policy (CSP) found', 'Add CSP via HTTP header or meta tag to prevent XSS and data injection attacks');
            }
            var xfoMeta = document.querySelector('meta[http-equiv="X-Frame-Options"]');
            if (!xfoMeta) {
              addIssue('headers', 'clickjack', 'warning', 'meta', 'X-Frame-Options not detected', 'Add X-Frame-Options: DENY or SAMEORIGIN to prevent clickjacking attacks');
            }
            var xctoMeta = document.querySelector('meta[http-equiv="X-Content-Type-Options"]');
            if (!xctoMeta) {
              addIssue('headers', 'mime-sniff', 'warning', 'meta', 'X-Content-Type-Options not detected', 'Add X-Content-Type-Options: nosniff to prevent MIME type sniffing');
            }
            var rpMeta = document.querySelector('meta[name="referrer"]');
            if (!rpMeta) {
              addIssue('headers', 'privacy', 'info', 'meta', 'No Referrer-Policy specified', 'Set Referrer-Policy to control what info is sent with requests');
            }
          }

          // ========== 3. COOKIES ==========
          if (allCats || activeCats.includes('cookies')) {
            try {
              if (document.cookie && document.cookie.length > 0) {
                var cookies = document.cookie.split(';').map(function(c) { return c.trim(); });
                addIssue('cookies', 'storage', 'warning', 'cookie', cookies.length + ' cookie(s) accessible via JavaScript', 'Set Secure + HttpOnly flags and SameSite=Lax/Strict to prevent XSS access');
                if (cookies.length > 5) {
                  addIssue('cookies', 'privacy', 'info', 'cookie', 'High number of cookies (' + cookies.length + ')', 'Excessive cookies impact performance and privacy. Consolidate where possible.');
                }
              }
            } catch(e) {}
          }

          // ========== 4. SCRIPTS & CONTENT ==========
          if (allCats || activeCats.includes('scripts')) {
            var scripts = document.querySelectorAll('script');
            scripts.forEach(function(s) {
              if (s.textContent && s.textContent.includes('eval(')) {
                addIssue('scripts', 'xss', 'error', 'script', 'Use of eval() detected - potential XSS vector', 'Avoid eval(). Use JSON.parse() or Function constructor only with trusted input.');
              }
            });
            var innerHTMLFound = false;
            scripts.forEach(function(s) {
              if (s.textContent && /innerHTML\s*=/.test(s.textContent)) innerHTMLFound = true;
            });
            if (innerHTMLFound) {
              addIssue('scripts', 'xss', 'warning', 'script', 'innerHTML assignments detected', 'Use textContent or sanitized insertAdjacentHTML to prevent XSS');
            }
            var pageHost = '';
            try { pageHost = new URL(window.location.href).hostname; } catch(e) {}
            var thirdParties = [];
            document.querySelectorAll('script[src]').forEach(function(s) {
              try { var sh = new URL(s.src).hostname; if (sh !== pageHost && thirdParties.indexOf(sh) === -1) thirdParties.push(sh); } catch(e) {}
            });
            if (thirdParties.length > 0) {
              addIssue('scripts', 'third-party', 'warning', 'script', thirdParties.length + ' third-party host(s): ' + thirdParties.join(', '), 'Review third-party scripts. Use SRI (integrity attribute).', thirdParties);
            }
            var scriptsWithSrc = document.querySelectorAll('script[src]');
            var sriCount = 0;
            scriptsWithSrc.forEach(function(s) { if (s.getAttribute('integrity')) sriCount++; });
            if (scriptsWithSrc.length > 0 && sriCount === 0) {
              addIssue('scripts', 'sri', 'info', 'script', 'No Subresource Integrity (SRI) on external scripts', 'Add integrity attributes to ensure scripts have not been tampered with');
            }
          }

          // ========== 5. AUTHENTICATION ==========
          if (allCats || activeCats.includes('auth')) {
            var formsHttp = document.querySelectorAll('form[action^="http://"]');
            if (formsHttp.length > 0) {
              addIssue('auth', 'form', 'error', 'form', formsHttp.length + ' form(s) submit data over HTTP', 'All form actions must use HTTPS to protect submitted data');
            }
            var passwordFields = document.querySelectorAll('input[type="password"]');
            if (passwordFields.length > 0) {
              addIssue('auth', 'password', 'info', 'password', passwordFields.length + ' password field(s) on page', 'Verify password fields use HTTPS and have proper autocomplete attributes');
              var pwdNoAuto = document.querySelectorAll('input[type="password"]:not([autocomplete])');
              if (pwdNoAuto.length > 0) {
                addIssue('auth', 'password', 'warning', 'password', pwdNoAuto.length + ' password field(s) missing autocomplete attribute', 'Add autocomplete="current-password" or "new-password"');
              }
            }
            var getPwdForms = document.querySelectorAll('form[method="GET"] input[type="password"]');
            if (getPwdForms.length > 0) {
              addIssue('auth', 'form', 'error', 'form', 'Password field(s) in GET form - passwords exposed in URL', 'Use POST method for forms containing sensitive data');
            }
          }

          // ========== 6. DATA STORAGE ==========
          if (allCats || activeCats.includes('storage')) {
            try {
              if (localStorage.length > 0) {
                addIssue('storage', 'localStorage', 'warning', 'localStorage', 'localStorage contains ' + localStorage.length + ' item(s)', 'Sensitive data in localStorage is accessible via XSS. Use httpOnly cookies instead.');
                var sensitiveKeys = [];
                for (var i = 0; i < localStorage.length; i++) {
                  var key = (localStorage.key(i) || '').toLowerCase();
                  if (key.includes('token') || key.includes('secret') || key.includes('jwt') || key.includes('password') || key.includes('credential') || key.includes('auth') || key.includes('api')) {
                    sensitiveKeys.push(localStorage.key(i));
                  }
                }
                if (sensitiveKeys.length > 0) {
                  addIssue('storage', 'localStorage', 'error', 'localStorage', 'Potential secrets in localStorage: ' + sensitiveKeys.join(', '), 'Storing auth tokens/secrets in localStorage is a security risk! Use httpOnly cookies.', sensitiveKeys);
                }
              }
            } catch(e) {}
            try {
              if (sessionStorage.length > 0) {
                addIssue('storage', 'sessionStorage', 'info', 'sessionStorage', 'sessionStorage contains ' + sessionStorage.length + ' item(s)', 'Avoid storing sensitive data in sessionStorage');
              }
            } catch(e) {}
          }

          // ========== 7. NETWORK & IFRAMES ==========
          if (allCats || activeCats.includes('network')) {
            var pageHost = '';
            try { pageHost = new URL(window.location.href).hostname; } catch(e) {}
            var xIframes = [];
            document.querySelectorAll('iframe[src]').forEach(function(ifr) {
              try { var iu = new URL(ifr.src); if (iu.hostname !== pageHost) xIframes.push(ifr.src); } catch(e) {}
            });
            if (xIframes.length > 0) {
              addIssue('network', 'iframe', 'warning', 'iframe', xIframes.length + ' cross-origin iframe(s)', 'Use sandbox attribute and ensure iframes are from trusted sources', xIframes);
            }
            var noSandbox = document.querySelectorAll('iframe[src]:not([sandbox])');
            if (noSandbox.length > 0) {
              addIssue('network', 'iframe', 'warning', 'iframe', noSandbox.length + ' iframe(s) without sandbox attribute', 'Add sandbox attribute to restrict iframe capabilities');
            }
            var httpLinks = document.querySelectorAll('a[href^="http://"]');
            if (httpLinks.length > 0) {
              addIssue('network', 'external', 'info', 'a', httpLinks.length + ' external HTTP link(s)', 'Update external links to use HTTPS where available');
            }
          }

          // ========== 8. XSS & INJECTION ==========
          if (allCats || activeCats.includes('injection')) {
            var scripts = document.querySelectorAll('script');
            var xssPatterns = [
              { pattern: /location\s*\=/, desc: 'Direct location assignment (open redirect risk)' },
              { pattern: /location\.href\s*=/, desc: 'location.href assignment (check for URL injection)' },
              { pattern: /innerHTML\s*=/, desc: 'innerHTML assignment (XSS vector)' },
              { pattern: /outerHTML\s*=/, desc: 'outerHTML assignment (XSS vector)' },
              { pattern: /insertAdjacentHTML/, desc: 'insertAdjacentHTML() (sanitize input)' },
              { pattern: /setAttribute\s*\([^)]*src/i, desc: 'Dynamic src attribute assignment' },
              { pattern: /createContextualFragment/, desc: 'Range.createContextualFragment()' }
            ];
            var foundPatterns = [];
            scripts.forEach(function(s) {
              if (s.textContent) {
                xssPatterns.forEach(function(p) {
                  if (p.pattern.test(s.textContent) && foundPatterns.indexOf(p.desc) === -1) foundPatterns.push(p.desc);
                });
              }
            });
            foundPatterns.forEach(function(p) {
              addIssue('injection', 'xss', 'warning', 'script', 'Potential XSS vector: ' + p, 'Sanitize all user input before using in DOM manipulation. Use textContent instead of innerHTML.');
            });
            var autoFocus = document.querySelectorAll('[autofocus]');
            if (autoFocus.length > 0) {
              addIssue('injection', 'ux', 'info', 'autofocus', 'autofocus on ' + autoFocus.length + ' element(s)', 'autofocus can be abused for phishing. Use sparingly.');
            }
          }

          return results;
        })()
      `);
      return { issues: results, total: results.length };
    } catch (e) {
      return { issues: [], total: 0, error: e.message };
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
