// ============================================
// Inspector Browser - Renderer Process
// Enterprise Monitoring Browser UI Logic
// ============================================

class InspectorBrowser {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this.tabIdCounter = 0;
    this.monitorData = new Map();

    // UI Elements
    this.elements = {
      tabContainer: document.getElementById('tab-container'),
      newTabBtn: document.getElementById('new-tab-btn'),
      webviewContainer: document.getElementById('webview-container'),
      urlInput: document.getElementById('url-input'),
      urlBarSecurity: document.getElementById('url-bar-security'),
      btnBack: document.getElementById('btn-back'),
      btnForward: document.getElementById('btn-forward'),
      btnReload: document.getElementById('btn-reload'),
      reloadIcon: document.getElementById('reload-icon'),
      urlLoading: document.getElementById('url-bar-loading'),
      statusLeft: document.getElementById('status-left'),
      statusRight: document.getElementById('status-right'),
      monitorPanel: document.getElementById('monitor-panel'),
      monitorContent: document.getElementById('monitor-content'),
      panelSplitter: document.getElementById('panel-splitter'),
      bookmarksPage: document.getElementById('bookmarks-page'),
    };

    this.init();
  }

  init() {
    this.setupWindowControls();
    this.setupTabManagement();
    this.setupBookmarks();
    this.setupNavigation();
    this.setupMonitorPanel();
    this.setupResizer();
    this.setupIPCEvents();
    this._startedAt = performance.now();
  }

  // ==========================================
  // Bookmarks Manager
  // ==========================================

  setupBookmarks() {
    this.bookmarks = new BookmarksManager(this);
  }

  // Get the folder emoji for a URL
  getBookmarkIcon(url) {
    if (!url) return '📄';
    if (url.includes('google')) return '🔍';
    if (url.includes('github')) return '🐙';
    if (url.includes('mail') || url.includes('outlook')) return '📧';
    if (url.includes('calendar')) return '📅';
    if (url.includes('drive') || url.includes('docs')) return '📝';
    if (url.includes('maps')) return '🗺️';
    if (url.includes('youtube') || url.includes('video')) return '▶️';
    if (url.includes('slack') || url.includes('chat')) return '💬';
    if (url.includes('jira') || url.includes('trello') || url.includes('asana')) return '📋';
    if (url.includes('confluence') || url.includes('wiki')) return '📖';
    if (url.includes('login') || url.includes('auth') || url.includes('sso')) return '🔐';
    if (url.includes('dashboard') || url.includes('admin')) return '⚙️';
    if (url.includes('analytics') || url.includes('monitor')) return '📊';
    return '🌐';
  }

  // ==========================================
  // Window Controls
  // ==========================================

  setupWindowControls() {
    document.getElementById('btn-minimize').onclick = () => window.electronAPI.minimizeWindow();
    document.getElementById('btn-maximize').onclick = () => window.electronAPI.maximizeWindow();
    document.getElementById('btn-close').onclick = () => window.electronAPI.closeWindow();
  }

  // ==========================================
  // Tab Management
  // ==========================================

  setupTabManagement() {
    this.elements.newTabBtn.addEventListener('click', () => this.createNewTab());
  }

  createNewTab(url = 'about:blank') {
    // Hide empty state if any
    this.elements.webviewContainer.innerHTML = '';

    this.tabIdCounter++;
    const tabId = this.tabIdCounter;

    // Create webview — needs explicit width/height for Electron's webview renderer
    const webview = document.createElement('webview');
    webview.setAttribute('webpreferences', 'contextIsolation=yes');
    webview.setAttribute('allowpopups', '');
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.display = 'none';

    this.elements.webviewContainer.appendChild(webview);

    // Create tab
    const tabData = {
      id: tabId,
      url: url,
      title: 'New Tab',
      isLoading: false,
      webview: webview,
      favicon: '',
      canGoBack: false,
      canGoForward: false,
    };

    this.tabs.set(tabId, tabData);

    // Create tab UI element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = tabId;
    tabEl.innerHTML = `
      <span class="tab-favicon"></span>
      <span class="tab-title">New Tab</span>
      <button class="tab-close-btn" title="Close tab">
        <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
      </button>
    `;

    tabEl.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close-btn')) {
        this.switchToTab(tabId);
      }
    });

    tabEl.querySelector('.tab-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    this.elements.tabContainer.appendChild(tabEl);

    // Register webview with main process and set up events
    this.setupWebviewEvents(tabId, webview);

    // Wait for webview to be ready, then register with main process for monitoring
    webview.addEventListener('dom-ready', () => {
      try {
        const wcId = webview.getWebContentsId();
        if (wcId && wcId > 0) {
          window.electronAPI.registerWebview(tabId, wcId);
        }
      } catch (e) {
        console.warn('Could not get webContentsId for tab', tabId, e);
      }
    });

    // Switch to new tab
    this.switchToTab(tabId);

    // If URL provided, navigate
    if (url && url !== 'about:blank') {
      webview.src = url;
    }

    return tabId;
  }

  setupWebviewEvents(tabId, webview) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    webview.addEventListener('did-start-loading', () => {
      tab.isLoading = true;
      this.updateTabUI(tabId);
      this.updateNavigationUI(tabId);
      this.elements.statusLeft.textContent = 'Loading...';
    });

    webview.addEventListener('did-stop-loading', () => {
      tab.isLoading = false;
      this.updateTabUI(tabId);
      this.updateNavigationUI(tabId);
      this.elements.statusLeft.textContent = 'Ready';
    });

    webview.addEventListener('page-title-updated', (e) => {
      tab.title = e.title;
      this.updateTabUI(tabId);
    });

    webview.addEventListener('did-navigate', (e) => {
      tab.url = e.url;
      tab.canGoBack = webview.canGoBack();
      tab.canGoForward = webview.canGoForward();
      this.updateTabUI(tabId);
      this.updateNavigationUI(tabId);
      this.updateAddressBar(tabId);
      this.updateSecurityIcon(tabId);
      if (this.bookmarks) {
        this.bookmarks.updateBookmarkButton(tabId);
      }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      tab.url = e.url;
      tab.canGoBack = webview.canGoBack();
      tab.canGoForward = webview.canGoForward();
      this.updateTabUI(tabId);
      this.updateNavigationUI(tabId);
      this.updateAddressBar(tabId);
      if (this.bookmarks) {
        this.bookmarks.updateBookmarkButton(tabId);
      }
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      tab.favicon = e.favicons[0];
      this.updateTabUI(tabId);
    });

    webview.addEventListener('new-window', (e) => {
      // Open new windows in a new tab
      this.createNewTab(e.url);
    });
  }

  switchToTab(tabId) {
    if (this.activeTabId === tabId) return;

    // Deactivate current tab
    if (this.activeTabId) {
      const currentTab = this.tabs.get(this.activeTabId);
      if (currentTab) {
        if (currentTab.webview) {
          currentTab.webview.style.display = 'none';
        } else if (currentTab.type === 'internal') {
          // Hide the internal page container
          this.elements.bookmarksPage.classList.remove('active');
        }
      }
      const currentTabEl = this.elements.tabContainer.querySelector(`.tab[data-tab-id="${this.activeTabId}"]`);
      if (currentTabEl) currentTabEl.classList.remove('active');
    }

    // Activate new tab
    this.activeTabId = tabId;
    const tab = this.tabs.get(tabId);

    if (tab) {
      if (tab.webview) {
        // Hide any internal pages
        if (this.elements.bookmarksPage) {
          this.elements.bookmarksPage.classList.remove('active');
        }
        tab.webview.style.display = 'block';
        tab.webview.style.flex = '1';
      } else if (tab.type === 'internal') {
        // Show the internal page container
        const pageEl = document.getElementById(tab.internalPage + '-page');
        if (pageEl) {
          pageEl.classList.add('active');
        }
      }
    }

    const tabEl = this.elements.tabContainer.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (tabEl) tabEl.classList.add('active');

    // Scroll tab into view
    if (tabEl) {
      tabEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }

    // Update UI
    this.updateTabUI(tabId);
    this.updateNavigationUI(tabId);
    this.updateAddressBar(tabId);
    this.updateSecurityIcon(tabId);
    this.updateStatusBar(tabId);

    // Update bookmark star for this tab
    if (this.bookmarks) {
      this.bookmarks.updateBookmarkButton(tabId);
    }

    // Switch monitor data to this tab (skip for internal tabs)
    if (tab && tab.type !== 'internal') {
      this.refreshMonitorPanelForTab(tabId);
    }
  }

  // ==========================================
  // Internal Pages (Bookmark Manager Tab, etc.)
  // ==========================================

  createInternalTab(title, pageId, icon = '📑') {
    this.tabIdCounter++;
    const tabId = this.tabIdCounter;

    const tabData = {
      id: tabId,
      type: 'internal',
      internalPage: pageId,
      title: title,
      url: pageId,
      favicon: '', // emoji is in the tab template HTML directly
    };

    this.tabs.set(tabId, tabData);

    // Create tab UI element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = tabId;
    tabEl.innerHTML = `
      <span class="tab-favicon">${icon}</span>
      <span class="tab-title">${title}</span>
      <button class="tab-close-btn" title="Close tab">
        <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
      </button>
    `;

    tabEl.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close-btn')) {
        this.switchToTab(tabId);
      }
    });

    tabEl.querySelector('.tab-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    this.elements.tabContainer.appendChild(tabEl);
    this.switchToTab(tabId);

    return tabId;
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Remove tab element
    const tabEl = this.elements.tabContainer.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (tabEl) tabEl.remove();

    if (tab.type === 'internal') {
      // Clean up internal page content
      const pageEl = document.getElementById(tab.internalPage + '-page');
      if (pageEl) {
        pageEl.innerHTML = '';
        pageEl.classList.remove('active');
      }
      this.tabs.delete(tabId);

      // Notify the bookmarks manager if this was the bookmarks tab
      if (this.bookmarks && this.bookmarks._bookmarksTabId === tabId) {
        this.bookmarks._bookmarksTabId = null;
      }
    } else {
      // Destroy webview
      if (tab.webview && tab.webview.parentNode) {
        tab.webview.remove();
      }
      this.tabs.delete(tabId);
      this.monitorData.delete(tabId);
      window.electronAPI.closeTab(tabId);
    }

    // Switch to another tab if needed
    if (this.activeTabId === tabId) {
      const remainingTabs = [...this.tabs.keys()];
      if (remainingTabs.length > 0) {
        this.switchToTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        this.activeTabId = null;
        // Hide internal pages, show empty webview state
        if (this.elements.bookmarksPage) {
          this.elements.bookmarksPage.classList.remove('active');
        }
        this.elements.webviewContainer.innerHTML = '';
        this.elements.urlInput.value = '';
        this.elements.statusLeft.textContent = 'No open tabs';
      }
    }
  }

  updateTabUI(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const tabEl = this.elements.tabContainer.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (!tabEl) return;

    const titleEl = tabEl.querySelector('.tab-title');
    const faviconEl = tabEl.querySelector('.tab-favicon');

    if (titleEl) {
      titleEl.textContent = tab.title.length > 30 ? tab.title.substring(0, 30) + '…' : tab.title;
    }

    if (faviconEl) {
      if (tab.favicon) {
        faviconEl.innerHTML = `<img src="${tab.favicon}" width="16" height="16" style="border-radius:2px">`;
      } else if (tab.isLoading) {
        faviconEl.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></div>';
      } else {
        faviconEl.innerHTML = '';
      }
    }

    // Update document title
    if (tabId === this.activeTabId) {
      document.title = tab.title !== 'New Tab' ? `${tab.title} - Inspector Browser` : 'Inspector Browser';
    }
  }

  updateNavigationUI(tabId) {
    if (tabId !== this.activeTabId) return;
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (tab.type === 'internal') {
      // Disable nav buttons for internal pages
      this.elements.btnBack.disabled = true;
      this.elements.btnForward.disabled = true;
      this.elements.reloadIcon.innerHTML = '<path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>';
      this.elements.urlLoading.style.display = 'none';
      return;
    }

    this.elements.btnBack.disabled = !tab.canGoBack;
    this.elements.btnForward.disabled = !tab.canGoForward;

    if (tab.isLoading) {
      this.elements.reloadIcon.innerHTML = '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>';
      this.elements.reloadIcon.setAttribute('d', 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
      this.elements.urlLoading.style.display = 'flex';
    } else {
      this.elements.reloadIcon.innerHTML = '<path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>';
      this.elements.urlLoading.style.display = 'none';
    }
  }

  updateAddressBar(tabId) {
    if (tabId !== this.activeTabId) return;
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (tab.type === 'internal') {
      // Show page title in address bar
      this.elements.urlInput.value = tab.title;
      this.elements.urlBarSecurity.style.display = 'none';
      return;
    }

    if (document.activeElement !== this.elements.urlInput) {
      this.elements.urlInput.value = tab.url || '';
    }
  }

  updateSecurityIcon(tabId) {
    if (tabId !== this.activeTabId) return;
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.url) return;

    if (tab.type === 'internal') {
      this.elements.urlBarSecurity.style.display = 'none';
      return;
    }

    const isSecure = tab.url.startsWith('https://');
    this.elements.urlBarSecurity.style.display = tab.url !== 'about:blank' ? 'flex' : 'none';
    this.elements.urlBarSecurity.className = 'url-bar-security' + (isSecure ? '' : ' insecure');
    this.elements.urlBarSecurity.title = isSecure ? 'Connection is secure (HTTPS)' : 'Connection is not secure (HTTP)';
  }

  updateStatusBar(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.elements.statusLeft.textContent = tab.url || 'Ready';
  }

  // ==========================================
  // Navigation
  // ==========================================

  setupNavigation() {
    // URL bar - navigate on Enter
    this.elements.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = this.elements.urlInput.value.trim();
        if (url && this.activeTabId) {
          this.navigateTo(this.activeTabId, url);
        }
      }
    });

    // Navigation buttons
    this.elements.btnBack.addEventListener('click', () => {
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        if (tab && tab.webview && tab.webview.canGoBack()) {
          tab.webview.goBack();
        }
      }
    });

    this.elements.btnForward.addEventListener('click', () => {
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        if (tab && tab.webview && tab.webview.canGoForward()) {
          tab.webview.goForward();
        }
      }
    });

    this.elements.btnReload.addEventListener('click', () => {
      if (this.activeTabId) {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) {
          if (tab.isLoading) {
            tab.webview.stop();
          } else {
            tab.webview.reload();
          }
        }
      }
    });

    // URL bar focus behavior
    this.elements.urlInput.addEventListener('focus', () => {
      this.elements.urlInput.select();
    });
  }

  navigateTo(tabId, url) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.webview) return;

    // Format URL if needed
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('file://') && !url.startsWith('data:')) {
      // Check if it looks like a URL with dots
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        // Search Google
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }

    tab.webview.loadURL(url);
    this.elements.statusLeft.textContent = `Navigating to ${url}...`;
  }

  // ==========================================
  // Monitor Panel
  // ==========================================

  setupMonitorPanel() {
    this.MONITOR_TAB_KEY = 'inspector-monitor-tab';

    // Tab switching in monitor panel — save preference
    const monitorTabs = document.querySelectorAll('.monitor-tab');
    monitorTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Update tab active state
        document.querySelectorAll('.monitor-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show corresponding panel
        const panelName = tab.dataset.panel;
        document.querySelectorAll('.monitor-panel-content').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById(`panel-${panelName}`);
        if (panel) panel.classList.add('active');

        // Save preference
        try {
          localStorage.setItem(this.MONITOR_TAB_KEY, panelName);
        } catch (e) { /* ignore */ }
      });
    });

    // Restore saved monitor tab
    try {
      const savedTab = localStorage.getItem(this.MONITOR_TAB_KEY);
      if (savedTab) {
        const targetTab = document.querySelector(`.monitor-tab[data-panel="${savedTab}"]`);
        const targetPanel = document.getElementById(`panel-${savedTab}`);
        if (targetTab && targetPanel) {
          document.querySelectorAll('.monitor-tab').forEach(t => t.classList.remove('active'));
          targetTab.classList.add('active');
          document.querySelectorAll('.monitor-panel-content').forEach(p => p.classList.remove('active'));
          targetPanel.classList.add('active');
        }
      }
    } catch (e) { /* ignore */ }

    // Clear button
    document.getElementById('monitor-clear').addEventListener('click', () => {
      const activePanel = document.querySelector('.monitor-panel-content.active');
      if (activePanel) {
        activePanel.innerHTML = this.getEmptyStateHTML(activePanel.id.replace('panel-', ''));
      }
    });

    // Run Audit button
    document.getElementById('monitor-run-audit').addEventListener('click', () => {
      this.runAudits();
    });

    // Export JSON button
    document.getElementById('monitor-export-json').addEventListener('click', () => {
      this.exportReport();
    });

    // Close button inside monitor panel toolbar
    const closeBtn = document.getElementById('monitor-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideMonitorPanel());
    }

    // Toggle monitor panel
    document.getElementById('btn-monitor').addEventListener('click', () => {
      this.toggleMonitorPanel();
    });

    // Open Chrome DevTools for the active tab (via IPC to main process for reliability)
    document.getElementById('btn-devtools').addEventListener('click', () => {
      if (this.activeTabId) {
        window.electronAPI.openDevTools(this.activeTabId);
      }
    });

    // Keyboard shortcut: Ctrl+B to toggle panel
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        this.toggleMonitorPanel();
      }
    });

    // Show monitor panel by default
    this.elements.monitorPanel.classList.remove('hidden');
    document.getElementById('btn-monitor').classList.add('nav-btn-active');
  }

  toggleMonitorPanel() {
    const isHidden = this.elements.monitorPanel.classList.toggle('hidden');
    document.getElementById('btn-monitor').classList.toggle('nav-btn-active', !isHidden);
  }

  hideMonitorPanel() {
    this.elements.monitorPanel.classList.add('hidden');
    document.getElementById('btn-monitor').classList.remove('nav-btn-active');
  }

  getEmptyStateHTML(panelType) {
    const icons = {
      performance: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>',
      network: '<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>',
      console: '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>',
      security: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
      style: '<path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 10c0 4.17-2.47 7.56-6 9.07V19c0-.55-.45-1-1-1h-1v-1c0-.55-.45-1-1-1h-2v-2c0-.55-.45-1-1-1H9v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>'
    };

    const texts = {
      performance: 'Loading performance data...',
      network: 'Waiting for network requests...',
      console: 'No console messages yet...',
      security: 'Run a security scan to check for vulnerabilities...',
      style: 'Run a style audit to check for issues...'
    };

    return `
      <div class="monitor-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">${icons[panelType] || icons.performance}</svg>
        <p>${texts[panelType] || 'No data...'}</p>
      </div>
    `;
  }

  // ==========================================
  // IPC Event Listeners
  // ==========================================

  setupIPCEvents() {
    // Tab updated (title, etc) - from main process monitoring
    window.electronAPI.onTabUpdated((data) => {
      // Only update if we don't have the info from webview events already
      // This is a backup for any data the main process needs to send
    });

    // Tab closed (cleanup notification from main process)
    window.electronAPI.onTabClosed((tabId) => {
      // Main process confirms cleanup
    });

    // ==========================================
    // Monitoring Data Handlers
    // ==========================================

    // Performance data
    window.electronAPI.onPerformanceData((data) => {
      this.storeMonitorData(data.tabId, 'performance', data.data);
      if (data.tabId === this.activeTabId) {
        this.renderPerformancePanel(data.data);
      }
    });

    // Network request data
    window.electronAPI.onNetworkData((data) => {
      this.addMonitorDataItem(data.tabId, 'network', data.data);
      if (data.tabId === this.activeTabId) {
        this.renderNetworkItem(data.data);
      }
    });

    // Network complete
    window.electronAPI.onNetworkComplete((data) => {
      if (data.tabId === this.activeTabId) {
        this.updateNetworkItem(data.data);
      }
    });

    // Network error
    window.electronAPI.onNetworkError((data) => {
      this.addMonitorDataItem(data.tabId, 'network', data.data);
      if (data.tabId === this.activeTabId) {
        this.renderNetworkItem(data.data);
      }
    });

    // Console messages
    window.electronAPI.onConsoleMessage((data) => {
      this.addMonitorDataItem(data.tabId, 'console', data.data);
      if (data.tabId === this.activeTabId) {
        this.renderConsoleItem(data.data);
      }
    });
  }

  storeMonitorData(tabId, type, data) {
    if (!this.monitorData.has(tabId)) {
      this.monitorData.set(tabId, { performance: {}, network: [], console: [], security: [], style: [] });
    }
    const tabData = this.monitorData.get(tabId);
    if (type === 'performance') {
      tabData.performance = data;
    }
  }

  addMonitorDataItem(tabId, type, data) {
    if (!this.monitorData.has(tabId)) {
      this.monitorData.set(tabId, { performance: {}, network: [], console: [], security: [], style: [] });
    }
    const tabData = this.monitorData.get(tabId);
    if (tabData[type]) {
      tabData[type].push(data);
      // Keep last 200 items
      if (tabData[type].length > 200) {
        tabData[type] = tabData[type].slice(-200);
      }
    }
  }

  refreshMonitorPanelForTab(tabId) {
    const tabData = this.monitorData.get(tabId);
    if (!tabData) return;

    // Render performance
    if (tabData.performance && Object.keys(tabData.performance).length > 0) {
      this.renderPerformancePanel(tabData.performance);
    }

    // Render network
    const panelNetwork = document.getElementById('panel-network');
    if (tabData.network.length > 0) {
      panelNetwork.innerHTML = '';
      tabData.network.forEach(req => this.renderNetworkItem(req));
    }

    // Render console
    const panelConsole = document.getElementById('panel-console');
    if (tabData.console.length > 0) {
      panelConsole.innerHTML = '';
      tabData.console.forEach(msg => this.renderConsoleItem(msg));
    }
  }

  // ==========================================
  // Performance Panel
  // ==========================================

  renderPerformancePanel(data) {
    const panel = document.getElementById('panel-performance');
    if (!data) return;

    const nav = data.navigation;
    const paint = data.paint;
    const memory = data.memory;

    if (!nav) {
      panel.innerHTML = `<div class="monitor-empty-state"><p>No navigation timing data available yet. Reload the page to capture metrics.</p></div>`;
      return;
    }

    const loadTime = nav.loadComplete ? (nav.loadComplete / 1000).toFixed(2) : 'N/A';
    const domTime = nav.domContentLoaded ? (nav.domContentLoaded / 1000).toFixed(2) : 'N/A';
    const fcp = paint.firstContentfulPaint ? (paint.firstContentfulPaint).toFixed(0) : 'N/A';
    const fp = paint.firstPaint ? (paint.firstPaint).toFixed(0) : 'N/A';
    const transferSize = nav.transferSize ? this.formatBytes(nav.transferSize) : 'N/A';
    const decodedSize = nav.decodedBodySize ? this.formatBytes(nav.decodedBodySize) : 'N/A';
    const resources = data.resources ? data.resources.length : 0;

    // Calculate score (simplified)
    const loadScore = nav.loadComplete < 2000 ? 100 : nav.loadComplete < 4000 ? 70 : nav.loadComplete < 8000 ? 40 : 20;
    const scoreClass = loadScore >= 80 ? 'good' : loadScore >= 50 ? 'warn' : 'bad';

    panel.innerHTML = `
      <div class="score-container">
        <div>
          <div class="score-circle ${scoreClass}" style="--score: ${loadScore}%">
            <div class="score-circle-inner">${loadScore}</div>
          </div>
          <div class="score-label">Performance Score</div>
        </div>
      </div>

      <div class="monitor-card">
        <div class="monitor-card-title">Navigation Timing</div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">Load Time</span>
          <span class="monitor-metric-value ${loadScore >= 80 ? 'good' : loadScore >= 50 ? 'warn' : 'bad'}">${loadTime}s</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">DOM Content Loaded</span>
          <span class="monitor-metric-value">${domTime}s</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">DOM Interactive</span>
          <span class="monitor-metric-value">${nav.domInteractive ? (nav.domInteractive / 1000).toFixed(2) + 's' : 'N/A'}</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">First Byte</span>
          <span class="monitor-metric-value">${nav.firstByte ? (nav.firstByte).toFixed(0) + 'ms' : 'N/A'}</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">Protocol</span>
          <span class="monitor-metric-value">${nav.protocol || 'N/A'}</span>
        </div>
      </div>

      <div class="monitor-card">
        <div class="monitor-card-title">Paint Timing</div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">First Paint (FP)</span>
          <span class="monitor-metric-value">${fp}ms</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">First Contentful Paint (FCP)</span>
          <span class="monitor-metric-value">${fcp}ms</span>
        </div>
      </div>

      <div class="monitor-card">
        <div class="monitor-card-title">Resource Summary</div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">Total Resources</span>
          <span class="monitor-metric-value">${resources}</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">Transfer Size</span>
          <span class="monitor-metric-value">${transferSize}</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">Decoded Size</span>
          <span class="monitor-metric-value">${decodedSize}</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">Redirects</span>
          <span class="monitor-metric-value">${nav.redirectCount || 0}</span>
        </div>
      </div>

      ${memory ? `
      <div class="monitor-card">
        <div class="monitor-card-title">Memory Usage</div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">JS Heap Used</span>
          <span class="monitor-metric-value">${this.formatBytes(memory.usedJSHeapSize)}</span>
        </div>
        <div class="monitor-metric">
          <span class="monitor-metric-label">JS Heap Total</span>
          <span class="monitor-metric-value">${this.formatBytes(memory.totalJSHeapSize)}</span>
        </div>
      </div>
      ` : ''}
    `;
  }

  // ==========================================
  // Network Panel
  // ==========================================

  renderNetworkItem(data) {
    const panel = document.getElementById('panel-network');
    // Remove empty state
    const emptyState = panel.querySelector('.monitor-empty-state');
    if (emptyState) panel.innerHTML = '';

    // Deduplicate by request ID (avoids duplicate entries when multiple tabs share the same session)
    if (data.id && panel.querySelector(`[data-request-id="${data.id}"]`)) {
      return;
    }

    const method = data.method || 'GET';
    const status = data.statusCode || (data.error ? 'ERR' : '...');
    const url = data.url || '';
    const duration = data.duration ? data.duration + 'ms' : '';
    const size = data.responseSize ? this.formatBytes(data.responseSize) : data.uploadData ? '↑' : '';

    const item = document.createElement('div');
    item.className = 'network-item';
    item.dataset.requestId = data.id || Date.now();
    item.innerHTML = `
      <span class="network-method ${method}">${method}</span>
      <span class="network-status">${status}</span>
      <span class="network-url" title="${url.replace(/"/g, '&quot;')}">${url.length > 60 ? url.substring(0, 60) + '…' : url}</span>
      <span class="network-time">${duration}</span>
      <span class="network-size">${size}</span>
    `;

    item.addEventListener('click', () => {
      // Expand/collapse details
      const existingDetails = item.querySelector('.network-details');
      if (existingDetails) {
        existingDetails.remove();
        return;
      }

      const details = document.createElement('div');
      details.className = 'network-details';
      details.style.cssText = 'padding: 8px 12px; font-size: 11px; background: var(--bg-primary); border-bottom: 1px solid var(--border-color); font-family: var(--font-mono); word-break: break-all;';
      details.innerHTML = `
        <div style="margin-bottom:4px;color:var(--text-secondary)">Full URL:</div>
        <div style="margin-bottom:8px">${url}</div>
        ${data.securityIssues && data.securityIssues.length > 0 ? `
          <div style="margin-bottom:4px;color:var(--accent-red)">Security Issues:</div>
          <div style="margin-bottom:8px">${data.securityIssues.map(s => '⚠ ' + s).join('<br>')}</div>
        ` : ''}
        <div style="color:var(--text-muted);font-size:10px">ID: ${data.id || 'N/A'} | Duration: ${duration || 'N/A'} | Size: ${size || 'N/A'}</div>
      `;
      item.after(details);
    });

    panel.appendChild(item);
    // Auto-scroll to bottom
    panel.scrollTop = panel.scrollHeight;
  }

  updateNetworkItem(data) {
    // Update existing network item with final status and timing
    const panel = document.getElementById('panel-network');
    const items = panel.querySelectorAll('.network-item');
    for (const item of items) {
      if (item.dataset.requestId == data.id) {
        const statusEl = item.querySelector('.network-status');
        const timeEl = item.querySelector('.network-time');
        if (statusEl && data.statusCode) statusEl.textContent = data.statusCode;
        if (timeEl && data.duration) timeEl.textContent = data.duration + 'ms';
        break;
      }
    }
  }

  // ==========================================
  // Console Panel
  // ==========================================

  renderConsoleItem(data) {
    const panel = document.getElementById('panel-console');
    // Remove empty state
    const emptyState = panel.querySelector('.monitor-empty-state');
    if (emptyState) panel.innerHTML = '';

    const level = data.level || 'info';
    const message = data.message || '';
    const source = data.source ? data.source.split('/').pop() : '';

    const item = document.createElement('div');
    item.className = 'console-item';
    item.innerHTML = `
      <span class="console-level ${level}">${level}</span>
      <span class="console-message">${this.escapeHtml(message)}</span>
      <span class="console-source">${source ? 'line ' + data.line : ''}</span>
    `;

    panel.appendChild(item);
    panel.scrollTop = panel.scrollHeight;
  }

  // ==========================================
  // Export Report (JSON)
  // ==========================================

  async collectReport(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    const tabData = this.monitorData.get(tabId) || { performance: {}, network: [], console: [] };

    // Run fresh audits to include latest data
    let styleIssues = [];
    let securityIssues = [];
    try {
      if (tab.webview) {
        [styleIssues, securityIssues] = await Promise.all([
          window.electronAPI.runStyleAudit(tabId),
          window.electronAPI.runSecurityScan(tabId)
        ]);
      }
    } catch (e) {
      // Audits may fail, that's ok
    }

    const now = new Date();

    return {
      report: {
        title: 'Inspector Browser - Monitoring Report',
        version: '1.0.0',
        generatedAt: now.toISOString(),
        generatedAtFormatted: now.toLocaleString(),
        browser: 'Inspector Browser (Electron/Chromium)'
      },
      page: {
        url: tab.url || 'N/A',
        title: tab.title || 'N/A'
      },
      performance: tabData.performance && tabData.performance.navigation ? {
        score: this.calculatePerfScore(tabData.performance),
        navigation: {
          loadTime: tabData.performance.navigation.loadComplete,
          loadTimeFormatted: tabData.performance.navigation.loadComplete
            ? (tabData.performance.navigation.loadComplete / 1000).toFixed(2) + 's'
            : 'N/A',
          domContentLoaded: tabData.performance.navigation.domContentLoaded,
          domInteractive: tabData.performance.navigation.domInteractive,
          firstByte: tabData.performance.navigation.firstByte,
          redirectCount: tabData.performance.navigation.redirectCount,
          transferSize: tabData.performance.navigation.transferSize,
          decodedBodySize: tabData.performance.navigation.decodedBodySize,
          protocol: tabData.performance.navigation.protocol
        },
        paint: {
          firstPaint: tabData.performance.paint?.firstPaint || 0,
          firstContentfulPaint: tabData.performance.paint?.firstContentfulPaint || 0
        },
        resources: (tabData.performance.resources || []).map(r => ({
          url: r.name,
          type: r.type,
          duration: r.duration,
          size: r.transferSize
        })),
        memory: tabData.performance.memory || null
      } : null,
      network: {
        totalRequests: tabData.network.length,
        byMethod: this.countBy(tabData.network, 'method'),
        byStatus: this.countByStatus(tabData.network),
        errors: tabData.network.filter(r => r.error),
        securityIssues: [
          ...new Set(tabData.network.flatMap(r => r.securityIssues || []))
        ],
        requests: tabData.network.slice(-100).map(r => ({
          url: r.url,
          method: r.method,
          status: r.statusCode,
          duration: r.duration,
          size: r.responseSize,
          type: r.type,
          error: r.error || null,
          securityIssues: r.securityIssues || []
        }))
      },
      console: {
        totalMessages: tabData.console.length,
        byLevel: this.countBy(tabData.console, 'level'),
        messages: tabData.console.slice(-100).map(m => ({
          level: m.level,
          message: m.message,
          line: m.line,
          source: m.source,
          timestamp: m.timestamp
        }))
      },
      styleAudit: {
        totalIssues: styleIssues.length,
        score: this.calculateIssueScore(styleIssues, { error: 15, warning: 5, info: 2 }),
        issues: styleIssues.slice(0, 200).map(i => ({
          type: i.type,
          severity: i.severity,
          element: i.element,
          message: i.message,
          recommendation: i.recommendation
        }))
      },
      securityScan: {
        totalIssues: securityIssues.length,
        score: this.calculateIssueScore(securityIssues, { error: 20, warning: 8 }),
        issues: securityIssues.slice(0, 200).map(i => ({
          type: i.type,
          severity: i.severity,
          element: i.element,
          message: i.message,
          recommendation: i.recommendation,
          details: i.details || []
        }))
      }
    };
  }

  calculatePerfScore(perfData) {
    if (!perfData.navigation || !perfData.navigation.loadComplete) return 'N/A';
    const load = perfData.navigation.loadComplete;
    if (load < 2000) return 100;
    if (load < 4000) return 70;
    if (load < 8000) return 40;
    return 20;
  }

  calculateIssueScore(issues, weights) {
    if (!issues || issues.length === 0) return 100;
    let deductions = 0;
    for (const issue of issues) {
      deductions += weights[issue.severity] || 0;
    }
    return Math.max(0, 100 - deductions);
  }

  countBy(arr, key) {
    const counts = {};
    for (const item of arr) {
      const val = item[key] || 'unknown';
      counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
  }

  countByStatus(arr) {
    const counts = {};
    for (const item of arr) {
      let cat = 'unknown';
      if (item.statusCode) {
        if (item.statusCode < 200) cat = '1xx';
        else if (item.statusCode < 300) cat = '2xx';
        else if (item.statusCode < 400) cat = '3xx';
        else if (item.statusCode < 500) cat = '4xx';
        else cat = '5xx';
      } else if (item.error) {
        cat = 'error';
      }
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }

  async exportReport() {
    if (!this.activeTabId) {
      this.elements.statusLeft.textContent = 'No active tab to export';
      return;
    }

    this.elements.statusLeft.textContent = 'Collecting monitoring data...';

    try {
      const report = await this.collectReport(this.activeTabId);
      if (!report) {
        this.elements.statusLeft.textContent = 'No data to export';
        return;
      }

      this.elements.statusLeft.textContent = 'Saving report...';
      const result = await window.electronAPI.saveReport(report);

      if (result.success) {
        this.elements.statusLeft.textContent = `Report saved to: ${result.filePath}`;
      } else if (result.reason === 'canceled') {
        this.elements.statusLeft.textContent = 'Export canceled';
      } else {
        this.elements.statusLeft.textContent = `Export failed: ${result.reason}`;
      }
    } catch (err) {
      this.elements.statusLeft.textContent = 'Export error: ' + err.message;
    }
  }

  // ==========================================
  // Audits (Security + Style)
  // ==========================================

  async runAudits() {
    if (!this.activeTabId) return;

    const tab = this.tabs.get(this.activeTabId);
    if (!tab || !tab.webview) return;

    this.elements.statusLeft.textContent = 'Running audits...';

    try {
      // Run style audit
      const styleIssues = await window.electronAPI.runStyleAudit(this.activeTabId);
      this.renderStyleAudit(styleIssues);

      // Run security scan
      const securityIssues = await window.electronAPI.runSecurityScan(this.activeTabId);
      this.renderSecurityScan(securityIssues);

      this.elements.statusLeft.textContent = 'Audit complete';
    } catch (err) {
      this.elements.statusLeft.textContent = 'Audit error: ' + err.message;
    }
  }

  renderStyleAudit(issues) {
    const panel = document.getElementById('panel-style');
    if (!issues || issues.length === 0) {
      panel.innerHTML = `
        <div class="monitor-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          <p>No style issues found. Great job!</p>
        </div>
      `;
      return;
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos = issues.filter(i => i.severity === 'info').length;

    const score = Math.max(0, 100 - (errors * 15 + warnings * 5 + infos * 2));
    const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';

    panel.innerHTML = `
      <div class="score-container">
        <div>
          <div class="score-circle ${scoreClass}" style="--score: ${score}%">
            <div class="score-circle-inner">${score}</div>
          </div>
          <div class="score-label">Style Score</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:14px;font-weight:600;color:var(--accent-red)">${errors} Errors</div>
          <div style="font-size:12px;color:var(--accent-yellow)">${warnings} Warnings</div>
          <div style="font-size:12px;color:var(--text-muted)">${infos} Info</div>
        </div>
      </div>
      ${issues.map(issue => `
        <div class="issue-item">
          <div class="issue-severity ${issue.severity}"></div>
          <div class="issue-content">
            <div class="issue-type">${issue.type || 'Issue'} · ${issue.severity}</div>
            <div class="issue-message">${issue.message}</div>
            ${issue.element ? `<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:2px">${issue.element}</div>` : ''}
            <div class="issue-recommendation">${issue.recommendation || ''}</div>
          </div>
        </div>
      `).join('')}
    `;

    // Switch to style panel
    document.querySelectorAll('.monitor-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-panel="style"]').classList.add('active');
    document.querySelectorAll('.monitor-panel-content').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-style').classList.add('active');
  }

  renderSecurityScan(issues) {
    const panel = document.getElementById('panel-security');
    if (!issues || issues.length === 0) {
      panel.innerHTML = `
        <div class="monitor-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
          <p>No security issues found. Your page is secure!</p>
        </div>
      `;
      return;
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;

    const score = Math.max(0, 100 - (errors * 20 + warnings * 8));
    const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';

    panel.innerHTML = `
      <div class="score-container">
        <div>
          <div class="score-circle ${scoreClass}" style="--score: ${score}%">
            <div class="score-circle-inner">${score}</div>
          </div>
          <div class="score-label">Security Score</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:14px;font-weight:600;color:var(--accent-red)">${errors} Critical</div>
          <div style="font-size:12px;color:var(--accent-yellow)">${warnings} Warnings</div>
        </div>
      </div>
      ${issues.map(issue => `
        <div class="issue-item">
          <div class="issue-severity ${issue.severity}"></div>
          <div class="issue-content">
            <div class="issue-type">${issue.type || 'Security'} · ${issue.severity}</div>
            <div class="issue-message">${issue.message}</div>
            ${issue.element ? `<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:2px">${issue.element}</div>` : ''}
            <div class="issue-recommendation">${issue.recommendation || ''}</div>
            ${issue.details && issue.details.length > 0 ? `
              <div class="issue-details">${issue.details.map(d => '• ' + d).join('<br>')}</div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    `;

    // Also switch to security panel if style isn't already shown
    const activePanel = document.querySelector('.monitor-panel-content.active');
    if (activePanel && activePanel.id === 'panel-style') {
      // Already showing style results, that's fine
    } else {
      document.querySelectorAll('.monitor-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-panel="security"]').classList.add('active');
      document.querySelectorAll('.monitor-panel-content').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-security').classList.add('active');
    }
  }

  // ==========================================
  // Panel Resizer
  // ==========================================

  setupResizer() {
    let isResizing = false;
    const splitter = this.elements.panelSplitter;

    splitter.addEventListener('mousedown', (e) => {
      isResizing = true;
      splitter.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const contentArea = document.querySelector('.content-area');
      const rect = contentArea.getBoundingClientRect();
      let panelWidth = rect.right - e.clientX - 2;
      panelWidth = Math.max(300, Math.min(600, panelWidth));
      this.elements.monitorPanel.style.width = panelWidth + 'px';
      splitter.style.right = panelWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        splitter.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // ==========================================
  // Utilities
  // ==========================================

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ==========================================
// Bookmarks Manager
// ==========================================

class BookmarksManager {
  // Simple XOR + base64 obfuscation for password storage
  // This prevents casual snooping but is NOT cryptographically secure
  static encrypt(text) {
    if (!text) return '';
    const key = 'Inspector-Browser-v1';
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    try {
      return btoa(unescape(encodeURIComponent(result)));
    } catch {
      return '';
    }
  }

  static decrypt(encoded) {
    if (!encoded) return '';
    try {
      const key = 'Inspector-Browser-v1';
      const decoded = decodeURIComponent(escape(atob(encoded)));
      let result = '';
      for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      return result;
    } catch {
      return '';
    }
  }
  constructor(browser) {
    this.browser = browser;
    this.STORAGE_KEY = 'inspector-bookmarks';
    this.bookmarks = this.load();

    this.elements = {
      container: document.getElementById('bookmarks-container'),
      moreBtn: document.getElementById('bookmarks-more-btn'),
      bookmarkBtn: document.getElementById('url-bar-bookmark'),
      bookmarkIcon: document.getElementById('bookmark-icon'),
      modal: document.getElementById('bookmarks-modal'),
      modalOverlay: document.getElementById('bookmarks-modal-overlay'),
      modalContent: document.getElementById('bookmarks-modal-content'),
      modalClose: document.getElementById('bookmarks-modal-close'),
      modalCount: document.getElementById('bookmarks-modal-count'),
    };

    this._bookmarksTabId = null;
    this.pageContent = document.getElementById('bookmarks-page');

    this.initDragReorder();
    this.init();
  }

  get defaults() {
    return [
      {
        id: 'bm-default-1',
        title: 'Google',
        url: 'https://www.google.com',
        username: '',
        password: '',
        comments: '',
        addedAt: Date.now() - 86400000
      },
      {
        id: 'bm-default-2',
        title: 'GitHub',
        url: 'https://github.com',
        username: '',
        password: '',
        comments: '',
        addedAt: Date.now() - 86400000
      },
      {
        id: 'bm-default-3',
        title: 'Inspector Docs',
        url: 'https://codebuff.com/docs',
        username: '',
        password: '',
        comments: '',
        addedAt: Date.now() - 86400000
      }
    ];
  }

  init() {
    // Ensure defaults exist on first run
    if (this.bookmarks.length === 0) {
      this.bookmarks = [...this.defaults];
      this.save();
    }

    // Defer DOM rendering to after the first tab — makes startup faster
    this.bindEvents();
    this.renderDelayed();
  }

  renderDelayed() {
    // Use requestAnimationFrame + setTimeout to render after the first paint
    requestAnimationFrame(() => {
      setTimeout(() => {
        this.render();
        this.renderModal();
        this.updateBookmarkButton(this.browser.activeTabId);

        // Log startup time for performance tracking
        if (this.browser._startedAt) {
          const elapsed = Math.round(performance.now() - this.browser._startedAt);
          console.log(`Inspector Browser started in ${elapsed}ms`);
        }
      }, 0);
    });
  }

  load() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.bookmarks));
    } catch (e) {
      console.warn('Failed to save bookmarks:', e);
    }
  }

  generateId() {
    return 'bm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  }

  add(title, url, username = '', password = '', comments = '') {
    // Don't add duplicates
    const exists = this.bookmarks.some(b => b.url === url);
    if (exists) return false;

    this.bookmarks.push({
      id: this.generateId(),
      title: title || url,
      url: url,
      username: username || '',
      password: password ? this.constructor.encrypt(password) : '',
      comments: comments || '',
      addedAt: Date.now()
    });
    this.save();
    this.render();
    this.renderModal();
    this.refreshPage();
    this.updateBookmarkButton(this.browser.activeTabId);
    return true;
  }

  remove(id) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    this.save();
    this.render();
    this.renderModal();
    this.refreshPage();
    this.updateBookmarkButton(this.browser.activeTabId);
  }

  edit(id, newTitle, newUrl, newUsername, newPassword, newComments) {
    const bm = this.bookmarks.find(b => b.id === id);
    if (!bm) return;
    if (newTitle !== undefined) bm.title = newTitle;
    if (newUrl !== undefined) bm.url = newUrl;
    if (newUsername !== undefined) bm.username = newUsername;
    if (newPassword !== undefined) bm.password = newPassword ? this.constructor.encrypt(newPassword) : '';
    if (newComments !== undefined) bm.comments = newComments;
    this.save();
    this.render();
    this.renderModal();
    this.refreshPage();
  }

  hasCredentials(bm) {
    return bm && (bm.username || bm.password);
  }

  isBookmarked(url) {
    if (!url) return false;
    return this.bookmarks.some(b => b.url === url);
  }

  toggle(url, title) {
    if (this.isBookmarked(url)) {
      const bm = this.bookmarks.find(b => b.url === url);
      if (bm) this.remove(bm.id);
      return false;
    } else {
      this.add(title || url, url);
      return true;
    }
  }

  navigateTo(url) {
    if (this.browser.activeTabId) {
      this.browser.navigateTo(this.browser.activeTabId, url);
    }
  }

  // ==========================================
  // Render
  // ==========================================

  render() {
    this.elements.container.innerHTML = '';

    if (this.bookmarks.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color: var(--text-muted); font-size: 11px; padding: 2px 8px;';
      empty.textContent = 'No bookmarks — click the ★ in the address bar to add one';
      this.elements.container.appendChild(empty);
      return;
    }

    this.bookmarks.forEach(bm => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.dataset.id = bm.id;
      item.title = bm.url;

      const icon = this.browser.getBookmarkIcon(bm.url);
      const hasCreds = this.hasCredentials(bm);

      item.innerHTML = `
        <span class="bookmark-item-icon">${icon}</span>
        <span class="bookmark-item-title">${this.browser.escapeHtml(bm.title)}</span>
        ${hasCreds ? '<span class="bookmark-item-creds-indicator" title="Has saved credentials">🔐</span>' : ''}
        <button class="bookmark-item-remove" title="Remove bookmark">&times;</button>
      `;

      // Click to navigate
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.bookmark-item-remove')) {
          this.navigateTo(bm.url);
        }
      });

      // Remove button
      item.querySelector('.bookmark-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.remove(bm.id);
      });

      this.elements.container.appendChild(item);
    });
  }

  // ==========================================
  // Drag and Drop Reordering
  // ==========================================

  initDragReorder() {
    this.dragState = {
      draggedId: null,
      draggedEl: null
    };
  }

  reorderBookmark(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const [moved] = this.bookmarks.splice(fromIndex, 1);
    this.bookmarks.splice(toIndex, 0, moved);
    this.save();
    this.render();
    this.renderModal();
    this.refreshPage();
    this.updateBookmarkButton(this.browser.activeTabId);
  }

  onDragStart(e, bm) {
    // Don't allow drag if editing inputs/buttons
    if (e.target.closest('.bookmarks-edit-input') || e.target.closest('.bookmarks-modal-item-btn')) {
      e.preventDefault();
      return;
    }

    this.dragState.draggedId = bm.id;
    this.dragState.draggedEl = e.currentTarget;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', bm.id);

    // Add dragging class after a tick so the browser captures the ghost image properly
    requestAnimationFrame(() => {
      e.currentTarget.classList.add('dragging');
    });
  }

  onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetItem = e.currentTarget;
    if (!targetItem || targetItem === this.dragState.draggedEl) return;

    const rect = targetItem.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const isBelow = e.clientY > midY;

    // Remove previous drag-over classes from all items
    // Get active container for removing drag-over classes
    const container = this.pageContent?.classList.contains('active') ? this.pageContent : this.elements.modalContent;
    container.querySelectorAll('.bookmarks-modal-item').forEach(el => {
      el.classList.remove('drag-over', 'drag-over-bottom');
    });

    if (isBelow) {
      targetItem.classList.add('drag-over-bottom');
    } else {
      targetItem.classList.add('drag-over');
    }
  }

  onDragLeave(e) {
    const targetItem = e.currentTarget;
    // Only remove if we actually left the element (not a child)
    if (!targetItem.contains(e.relatedTarget)) {
      targetItem.classList.remove('drag-over', 'drag-over-bottom');
    }
  }

  onDrop(e) {
    e.preventDefault();
    const targetItem = e.currentTarget;
    const draggedId = this.dragState.draggedId;
    if (!draggedId || !targetItem) return;

    const targetId = targetItem.dataset.id;
    if (targetId === draggedId) return;

    const fromIndex = this.bookmarks.findIndex(b => b.id === draggedId);
    const toIndex = this.bookmarks.findIndex(b => b.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    // Determine whether to insert before or after
    const rect = targetItem.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertAfter = e.clientY > midY;

    const adjustedToIndex = insertAfter ? toIndex + 1 : toIndex;
    this.reorderBookmark(fromIndex, adjustedToIndex > fromIndex ? adjustedToIndex - 1 : adjustedToIndex);
  }

  onDragEnd(e) {
    // Clean up all drag state
    this.dragState.draggedId = null;
    this.dragState.draggedEl = null;

    // Clean up drag classes from both modal and page container
    this.elements.modalContent.querySelectorAll('.bookmarks-modal-item').forEach(el => {
      el.classList.remove('dragging', 'drag-over', 'drag-over-bottom');
    });
    if (this.pageContent) {
      this.pageContent.querySelectorAll('.bookmarks-modal-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over', 'drag-over-bottom');
      });
    }
  }

  renderModal() {
    this.elements.modalContent.innerHTML = '';

    if (this.bookmarks.length === 0) {
      this.elements.modalContent.innerHTML = '<div class="bookmarks-modal-empty">No bookmarks yet. Click the ★ star in the address bar to bookmark a page.</div>';
      this.elements.modalCount.textContent = '0 bookmarks';
      return;
    }

    this.bookmarks.forEach(bm => {
      const item = document.createElement('div');
      item.className = 'bookmarks-modal-item';
      item.dataset.id = bm.id;
      item.draggable = true;

      const icon = this.browser.getBookmarkIcon(bm.url);
      const hasCreds = this.hasCredentials(bm);

      item.innerHTML = `
        <span class="bookmarks-modal-grip" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </span>
        <span class="bookmarks-modal-item-icon">${hasCreds ? '🔐' : icon}</span>
        <div class="bookmarks-modal-item-info">
          <div class="bookmarks-modal-item-title">${this.browser.escapeHtml(bm.title)}</div>
          <div class="bookmarks-modal-item-url">${this.browser.escapeHtml(bm.url)}</div>
          ${hasCreds ? `
            <div class="bookmarks-modal-creds-row">
              <span class="bookmarks-modal-creds-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                Saved credentials
              </span>
              <button class="bookmarks-modal-creds-reveal" data-bm-id="${bm.id}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                Reveal
              </button>
            </div>
          ` : ''}
        </div>
        <div class="bookmarks-modal-item-actions">
          <button class="bookmarks-modal-item-btn edit" title="Edit bookmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="bookmarks-modal-item-btn" title="Remove bookmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      `;

      // Click to navigate
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.bookmarks-modal-item-btn') && !e.target.closest('.bookmarks-modal-grip') && !e.target.closest('.bookmarks-modal-creds-reveal') && !e.target.closest('.bookmarks-modal-creds-popup')) {
          this.navigateTo(bm.url);
          this.closeModal();
        }
      });

      // Remove
      const removeBtn = item.querySelectorAll('.bookmarks-modal-item-btn')[1];
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.remove(bm.id);
      });

      // Edit
      item.querySelector('.edit').addEventListener('click', (e) => {
        e.stopPropagation();
        this.startEdit(bm, item);
      });

      // Reveal credentials
      const revealBtn = item.querySelector('.bookmarks-modal-creds-reveal');
      if (revealBtn) {
        revealBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.revealCredentials(bm, item);
        });
      }

      // Drag events
      item.addEventListener('dragstart', (e) => this.onDragStart(e, bm));
      item.addEventListener('dragover', (e) => this.onDragOver(e));
      item.addEventListener('dragenter', (e) => e.preventDefault());
      item.addEventListener('dragleave', (e) => this.onDragLeave(e));
      item.addEventListener('drop', (e) => this.onDrop(e));
      item.addEventListener('dragend', (e) => this.onDragEnd(e));

      this.elements.modalContent.appendChild(item);
    });

    this.elements.modalCount.textContent = `${this.bookmarks.length} bookmark${this.bookmarks.length !== 1 ? 's' : ''}`;
  }

  revealCredentials(bm, itemEl) {
    // Remove any existing popup first
    const existing = itemEl.querySelector('.bookmarks-modal-creds-popup');
    if (existing) {
      existing.remove();
      return;
    }

    const decryptedPassword = bm.password ? this.constructor.decrypt(bm.password) : '';

    const popup = document.createElement('div');
    popup.className = 'bookmarks-modal-creds-popup';
    popup.innerHTML = `
      <div class="bookmarks-creds-field">
        <span class="bookmarks-creds-label">Username / Email</span>
        <div class="bookmarks-creds-value-row">
          <span class="bookmarks-creds-value">${this.browser.escapeHtml(bm.username || '(not set)')}</span>
          <button class="bookmarks-creds-copy-btn" data-copy="${this.browser.escapeHtml(bm.username || '')}" title="Copy username">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      </div>
      <div class="bookmarks-creds-field">
        <span class="bookmarks-creds-label">Password</span>
        <div class="bookmarks-creds-value-row">
          <input type="password" class="bookmarks-creds-password" value="${this.browser.escapeHtml(decryptedPassword)}" readonly>
          <button class="bookmarks-creds-toggle-btn" title="Show/hide password">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
          <button class="bookmarks-creds-copy-btn" data-copy="${this.browser.escapeHtml(decryptedPassword)}" title="Copy password">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      </div>
      ${bm.comments ? `
      <div class="bookmarks-creds-field">
        <span class="bookmarks-creds-label">Comments</span>
        <div class="bookmarks-creds-value" style="color:var(--text-secondary);margin-top:2px">${this.browser.escapeHtml(bm.comments)}</div>
      </div>
      ` : ''}
    `;

    // Insert popup after the icon but before the info in the item
    const infoEl = itemEl.querySelector('.bookmarks-modal-item-info');
    infoEl.appendChild(popup);

    // Copy button handlers
    popup.querySelectorAll('.bookmarks-creds-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = btn.dataset.copy;
        if (text) {
          navigator.clipboard.writeText(text).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
            setTimeout(() => { btn.innerHTML = orig; }, 1500);
          }).catch(() => {
            // Fallback: select and copy manually
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          });
        }
      });
    });

    // Password show/hide toggle
    const toggleBtn = popup.querySelector('.bookmarks-creds-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pwdInput = popup.querySelector('.bookmarks-creds-password');
        pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
      });
    }
  }

  startEdit(bm, itemEl) {
    const infoEl = itemEl.querySelector('.bookmarks-modal-item-info');
    const actionsEl = itemEl.querySelector('.bookmarks-modal-item-actions');

    // Detect if we're in page mode (tab) vs modal mode
    const isPageMode = this._bookmarksTabId && this.browser.tabs.get(this._bookmarksTabId);

    const decryptedPassword = bm.password ? this.constructor.decrypt(bm.password) : '';

    infoEl.innerHTML = `
      <input type="text" class="bookmarks-edit-input" id="edit-title" value="${this.browser.escapeHtml(bm.title)}" placeholder="Title">
      <input type="text" class="bookmarks-edit-input" id="edit-url" value="${this.browser.escapeHtml(bm.url)}" placeholder="URL">
      <div class="bookmarks-edit-section-label">Credentials</div>
      <input type="text" class="bookmarks-edit-input" id="edit-username" value="${this.browser.escapeHtml(bm.username || '')}" placeholder="Username / Email" autocomplete="off">
      <div class="bookmarks-edit-pwd-row">
        <input type="password" class="bookmarks-edit-input" id="edit-password" value="${this.browser.escapeHtml(decryptedPassword)}" placeholder="Password" autocomplete="off">
        <button class="bookmarks-edit-pwd-toggle" id="edit-pwd-toggle" title="Show/hide password">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        </button>
      </div>
      <input type="text" class="bookmarks-edit-input" id="edit-comments" value="${this.browser.escapeHtml(bm.comments || '')}" placeholder="Comments (optional)">
      <div class="bookmarks-edit-actions" style="margin-top:8px">
        <button class="bookmarks-edit-save" id="edit-save">Save</button>
        <button class="bookmarks-edit-cancel" id="edit-cancel">Cancel</button>
      </div>
    `;
    actionsEl.style.display = 'none';

    // Password show/hide toggle
    document.getElementById('edit-pwd-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      const pwdInput = document.getElementById('edit-password');
      pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('edit-save').addEventListener('click', () => {
      const newTitle = document.getElementById('edit-title').value.trim() || bm.title;
      let newUrl = document.getElementById('edit-url').value.trim() || bm.url;
      if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        newUrl = 'https://' + newUrl;
      }
      const newUsername = document.getElementById('edit-username').value.trim();
      const newPassword = document.getElementById('edit-password').value;
      const newComments = document.getElementById('edit-comments').value.trim();
      this.edit(bm.id, newTitle, newUrl, newUsername, newPassword, newComments);
    });

    document.getElementById('edit-cancel').addEventListener('click', () => {
      if (isPageMode) {
        this.refreshPage();
      } else {
        this.renderModal();
      }
    });

    // Focus the title input
    setTimeout(() => document.getElementById('edit-title')?.focus(), 50);

    // Handle Enter key on title and url inputs to save
    const handleEnter = (e) => {
      if (e.key === 'Enter') {
        document.getElementById('edit-save')?.click();
      }
    };
    document.getElementById('edit-title').addEventListener('keydown', handleEnter);
    document.getElementById('edit-url').addEventListener('keydown', handleEnter);
    document.getElementById('edit-username').addEventListener('keydown', handleEnter);
    document.getElementById('edit-password').addEventListener('keydown', handleEnter);
    document.getElementById('edit-comments').addEventListener('keydown', handleEnter);
  }

  // ==========================================
  // Bookmark Button (Star in URL bar)
  // ==========================================

  updateBookmarkButton(tabId) {
    if (!tabId || tabId !== this.browser.activeTabId) return;
    const tab = this.browser.tabs.get(tabId);
    if (!tab || !tab.url || tab.url === 'about:blank') {
      this.elements.bookmarkBtn.classList.remove('bookmarked');
      this.elements.bookmarkBtn.title = 'Bookmark this page';
      this.elements.bookmarkIcon.style.fill = 'none';
      return;
    }

    const bookmarked = this.isBookmarked(tab.url);
    this.elements.bookmarkBtn.classList.toggle('bookmarked', bookmarked);
    this.elements.bookmarkBtn.title = bookmarked ? 'Remove bookmark' : 'Bookmark this page';
    this.elements.bookmarkIcon.style.fill = bookmarked ? 'currentColor' : 'none';
  }

  // ==========================================
  // Events
  // ==========================================

  bindEvents() {
    // Bookmark star button in URL bar
    this.elements.bookmarkBtn.addEventListener('click', () => {
      const tab = this.browser.tabs.get(this.browser.activeTabId);
      if (!tab || !tab.url || tab.url === 'about:blank') return;
      this.toggle(tab.url, tab.title);
    });

    // More / Manage button — opens as a tab, not a modal
    this.elements.moreBtn.addEventListener('click', () => {
      this.openAsTab();
    });

    // Modal close
    this.elements.modalClose.addEventListener('click', () => this.closeModal());
    this.elements.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.elements.modalOverlay) this.closeModal();
    });

    // Keyboard: Escape to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.elements.modalOverlay.style.display !== 'none') {
        this.closeModal();
      }
    });

    // Keyboard: Ctrl+D to bookmark current page
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this.elements.bookmarkBtn.click();
      }
    });
  }

  // ==========================================
  // Tab-based Bookmark Manager
  // ==========================================

  openAsTab() {
    // If the tab is already open, just switch to it
    if (this._bookmarksTabId) {
      const tab = this.browser.tabs.get(this._bookmarksTabId);
      if (tab) {
        this.browser.switchToTab(this._bookmarksTabId);
        return;
      }
    }

    // Create a new internal tab for the bookmarks manager
    this._bookmarksTabId = this.browser.createInternalTab('Bookmarks Manager', 'bookmarks', '⭐');

    // Render the bookmark manager content into the page container
    this.renderPage();
  }

  renderPage() {
    if (!this.pageContent) return;

    this.pageContent.innerHTML = `
      <div class="bookmarks-manager-header">
        <h2>Bookmarks Manager</h2>
        <span class="bookmarks-manager-count">${this.bookmarks.length} bookmark${this.bookmarks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="bookmarks-manager-list"></div>
    `;

    const listContainer = this.pageContent.querySelector('.bookmarks-manager-list');
    if (!listContainer) return;

    if (this.bookmarks.length === 0) {
      listContainer.innerHTML = '<div class="bookmarks-modal-empty">No bookmarks yet. Click the ★ star in the address bar to bookmark a page.</div>';
      return;
    }

    this.bookmarks.forEach(bm => {
      const item = document.createElement('div');
      item.className = 'bookmarks-modal-item';
      item.dataset.id = bm.id;
      item.draggable = true;

      const icon = this.browser.getBookmarkIcon(bm.url);
      const hasCreds = this.hasCredentials(bm);

      item.innerHTML = `
        <span class="bookmarks-modal-grip" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </span>
        <span class="bookmarks-modal-item-icon">${hasCreds ? '🔐' : icon}</span>
        <div class="bookmarks-modal-item-info">
          <div class="bookmarks-modal-item-title">${this.browser.escapeHtml(bm.title)}</div>
          <div class="bookmarks-modal-item-url">${this.browser.escapeHtml(bm.url)}</div>
          ${hasCreds ? `
            <div class="bookmarks-modal-creds-row">
              <span class="bookmarks-modal-creds-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                Saved credentials
              </span>
              <button class="bookmarks-modal-creds-reveal" data-bm-id="${bm.id}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                Reveal
              </button>
            </div>
          ` : ''}
        </div>
        <div class="bookmarks-modal-item-actions">
          <button class="bookmarks-modal-item-btn edit" title="Edit bookmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="bookmarks-modal-item-btn" title="Remove bookmark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      `;

      // Click to navigate
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.bookmarks-modal-item-btn') && !e.target.closest('.bookmarks-modal-grip') && !e.target.closest('.bookmarks-modal-creds-reveal') && !e.target.closest('.bookmarks-modal-creds-popup')) {
          this.navigateTo(bm.url);
        }
      });

      // Remove
      const removeBtn = item.querySelectorAll('.bookmarks-modal-item-btn')[1];
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.remove(bm.id);
      });

      // Edit
      item.querySelector('.edit').addEventListener('click', (e) => {
        e.stopPropagation();
        this.startEdit(bm, item);
      });

      // Reveal credentials
      const revealBtn = item.querySelector('.bookmarks-modal-creds-reveal');
      if (revealBtn) {
        revealBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.revealCredentials(bm, item);
        });
      }

      // Drag events
      item.addEventListener('dragstart', (e) => this.onDragStart(e, bm));
      item.addEventListener('dragover', (e) => this.onDragOver(e));
      item.addEventListener('dragenter', (e) => e.preventDefault());
      item.addEventListener('dragleave', (e) => this.onDragLeave(e));
      item.addEventListener('drop', (e) => this.onDrop(e));
      item.addEventListener('dragend', (e) => this.onDragEnd(e));

      listContainer.appendChild(item);
    });
  }

  refreshPage() {
    // Refresh both the page and the modal when data changes
    if (this._bookmarksTabId && this.browser.tabs.get(this._bookmarksTabId)) {
      this.renderPage();
    }
  }

  openModal() {
    this.renderModal();
    this.elements.modalOverlay.style.display = 'flex';
  }

  closeModal() {
    this.elements.modalOverlay.style.display = 'none';
  }
}

// ==========================================
// Initialize — optimized for fast startup
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  const browser = new InspectorBrowser();
  window.inspectorBrowser = browser;

  // Create initial tab with about:blank for near-instant webview init,
  // then navigate to the default page after the webview is ready.
  // This splits startup load: window appears immediately, page loads after.
  const tabId = browser.createNewTab('about:blank');
  const tab = browser.tabs.get(tabId);
  // Navigate to the default page once the webview's renderer is ready
  if (tab?.webview) {
    tab.webview.addEventListener('dom-ready', () => {
      browser.navigateTo(tabId, 'https://www.google.com');
    }, { once: true });
  }
});
