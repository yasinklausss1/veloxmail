// VeloxMail Main Controller (Zero Lag, Reactive State, 60fps)
document.addEventListener('DOMContentLoaded', () => {
  // State
  const state = {
    messages: [],
    selectedMessageId: null,
    selectedMessageDetail: null,
    filter: 'all', // 'all' | 'unread' | 'attachments'
    searchQuery: '',
    refreshInterval: 5, // seconds
    countdown: 5,
    timerId: null,
    isRefreshing: false,
    viewMode: 'html', // 'html' | 'text'
    soundEnabled: true,
    notificationsEnabled: false,
    theme: localStorage.getItem('velox_theme') || 'dark'
  };

  // DOM Elements
  const els = {
    // Header
    statusBadge: document.getElementById('statusBadge'),
    statusPulse: document.getElementById('statusPulse'),
    statusText: document.getElementById('statusText'),
    historyModalBtn: document.getElementById('historyModalBtn'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),

    // Hero
    emailAddressInput: document.getElementById('emailAddressInput'),
    emailInputWrapper: document.getElementById('emailInputWrapper'),
    copyAddressBtn: document.getElementById('copyAddressBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    refreshBtnIcon: document.getElementById('refreshBtnIcon'),
    randomNewBtn: document.getElementById('randomNewBtn'),
    customAddressBtn: document.getElementById('customAddressBtn'),
    autoRefreshPill: document.getElementById('autoRefreshPill'),
    timerRingProgress: document.getElementById('timerRingProgress'),
    refreshTimerText: document.getElementById('refreshTimerText'),
    currentPasswordInput: document.getElementById('currentPasswordInput'),
    togglePasswordVisibilityBtn: document.getElementById('togglePasswordVisibilityBtn'),
    iconEyeShow: document.getElementById('iconEyeShow'),
    iconEyeHide: document.getElementById('iconEyeHide'),
    copyPasswordBtn: document.getElementById('copyPasswordBtn'),

    // Inbox Panel
    inboxWorkspace: document.getElementById('inboxWorkspace'),
    searchInput: document.getElementById('searchInput'),
    searchClearBtn: document.getElementById('searchClearBtn'),
    filterPills: document.querySelectorAll('.filter-pill'),
    countAll: document.getElementById('countAll'),
    countUnread: document.getElementById('countUnread'),
    countAttachments: document.getElementById('countAttachments'),
    messageListContainer: document.getElementById('messageListContainer'),
    emptyInboxState: document.getElementById('emptyInboxState'),
    messagesStack: document.getElementById('messagesStack'),

    // Reader Panel
    readerPlaceholder: document.getElementById('readerPlaceholder'),
    readerContent: document.getElementById('readerContent'),
    readerBackBtn: document.getElementById('readerBackBtn'),
    readerToggleSeenBtn: document.getElementById('readerToggleSeenBtn'),
    readerSeenText: document.getElementById('readerSeenText'),
    readerRawBtn: document.getElementById('readerRawBtn'),
    readerPrintBtn: document.getElementById('readerPrintBtn'),
    readerDeleteBtn: document.getElementById('readerDeleteBtn'),
    readerSubject: document.getElementById('readerSubject'),
    readerAvatar: document.getElementById('readerAvatar'),
    readerFromName: document.getElementById('readerFromName'),
    readerFromAddress: document.getElementById('readerFromAddress'),
    readerToAddress: document.getElementById('readerToAddress'),
    readerDateRelative: document.getElementById('readerDateRelative'),
    readerDateExact: document.getElementById('readerDateExact'),
    attachmentsDrawer: document.getElementById('attachmentsDrawer'),
    attachmentsCount: document.getElementById('attachmentsCount'),
    attachmentsChips: document.getElementById('attachmentsChips'),
    tabViewHtml: document.getElementById('tabViewHtml'),
    tabViewText: document.getElementById('tabViewText'),
    emailBodyIframe: document.getElementById('emailBodyIframe'),
    emailBodyPlainText: document.getElementById('emailBodyPlainText'),

    // Modals
    customAddressModal: document.getElementById('customAddressModal'),
    customAddressForm: document.getElementById('customAddressForm'),
    customUsername: document.getElementById('customUsername'),
    customDomainSelect: document.getElementById('customDomainSelect'),
    customPassword: document.getElementById('customPassword'),
    closeCustomModalBtn: document.getElementById('closeCustomModalBtn'),
    cancelCustomBtn: document.getElementById('cancelCustomBtn'),

    historyModal: document.getElementById('historyModal'),
    historyList: document.getElementById('historyList'),
    closeHistoryModalBtn: document.getElementById('closeHistoryModalBtn'),
    closeHistoryBtn: document.getElementById('closeHistoryBtn'),

    rawSourceModal: document.getElementById('rawSourceModal'),
    rawSourceCode: document.getElementById('rawSourceCode'),
    closeRawModalBtn: document.getElementById('closeRawModalBtn'),
    copyRawBtn: document.getElementById('copyRawBtn'),
    closeRawBtn: document.getElementById('closeRawBtn'),

    toastHub: document.getElementById('toastHub'),

    proxyStatusBadge: document.getElementById('proxyStatusBadge'),
    proxyStatusDot:   document.getElementById('proxyStatusDot'),
    proxyStatusText:  document.getElementById('proxyStatusText'),
  };

  // Set Theme
  document.documentElement.setAttribute('data-theme', state.theme);

  // Initialize
  initApp();

  async function initApp() {
    setupEventListeners();
    updateThemeUI();

    // Check notification permission
    if ('Notification' in window && Notification.permission === 'granted') {
      state.notificationsEnabled = true;
    }

    try {
      updateStatus('Verbinde...', true);

      // Fetch active domains in background
      mailApi.fetchDomains().then(domains => {
        populateDomainSelect(domains);
      }).catch(err => {
        console.warn('Domains fetch warning:', err);
      });

      // Connect instant real-time push callback
      mailApi.onNewMessage = (eventData) => {
        console.log('Real-time mail event received:', eventData);
        refreshInbox(true);
      };

      // Restore account or create new random
      if (mailApi.account && mailApi.token) {
        updateAddressUI(mailApi.account.address);
        try {
          await refreshInbox(false);
        } catch (e) {
          console.warn('Cached account invalid, generating new:', e);
          mailApi.clearState();
          await createNewAccount();
        }
      } else {
        await createNewAccount();
      }

      // Initialize and poll proxy status from ProxyScrape pool
      updateProxyStatusUI();
      setInterval(updateProxyStatusUI, 12000);

      updateStatus('Verbunden', false);
      startCountdownTimer();
    } catch (e) {
      console.error('Initialisation failed:', e);
      updateStatus('Fehler', false);
      els.emailAddressInput.value = 'Fehler beim Laden (Klicken zum Wiederholen)';
      showToast('Konnte mail.tm nicht erreichen. Klicke zum Wiederholen.', 'warning');
    }
  }

  // Proxy / Turbo Status Indicator
  async function updateProxyStatusUI() {
    if (!els.proxyStatusBadge || !els.proxyStatusText) return;
    const mode = localStorage.getItem('velox_proxy_mode') || 'proxy';

    if (mode === 'turbo') {
      els.proxyStatusBadge.className = 'proxy-status-badge turbo';
      els.proxyStatusText.textContent = '⚡ Turbo (0.2s)';
      els.proxyStatusBadge.title = 'Turbo-Modus aktiv: Maximale Geschwindigkeit (~200ms)\nKlicke zum Umschalten auf Proxy-Rotation';
      return;
    }

    try {
      const res = await fetch('/proxy-status');
      if (!res.ok) return;
      const data = await res.json();
      els.proxyStatusBadge.className = 'proxy-status-badge active';
      let displayProxy = '';
      const usage = data.currentUsage || 0;
      const maxUses = data.maxUses || 3;
      const usageText = `${usage}/${maxUses}`;

      if (data.currentProxy) {
        const clean = data.currentProxy.replace(/^(socks[45]:\/\/|http:\/\/)/, '');
        displayProxy = `🛡️ Proxy: ${clean} [${usageText}]`;
      } else if (data.aliveCount > 0) {
        displayProxy = `🛡️ Fast-Proxy aktiv [${usageText}]`;
      } else {
        displayProxy = `🛡️ Proxy: Bereit [${usageText}]`;
      }
      els.proxyStatusText.textContent = displayProxy;
      const sourcesText = data.sources
        ? `Quellen: ProxyScrape (${data.sources.proxyscrape}) + PubProxy (${data.sources.pubproxy})`
        : 'Quellen: ProxyScrape + PubProxy';
      els.proxyStatusBadge.title = `Aktiver Proxy: ${data.currentProxy || 'Wird bei nächster Mail zugewiesen'}\nNutzung dieser IP: ${usage} von ${maxUses} E-Mails erstellt\n${sourcesText}\nPre-Warmed Pool: ${data.aliveCount || 0} verifizierte High-Speed Proxies\nKlicke für ⚡ Turbo-Modus (0.2s)`;
    } catch (e) {
      els.proxyStatusBadge.className = 'proxy-status-badge inactive';
      els.proxyStatusText.textContent = '⚡ Turbo';
    }
  }

  // Address Management
  async function createNewAccount() {
    try {
      const mode = localStorage.getItem('velox_proxy_mode') || 'proxy';
      const label = mode === 'turbo' ? 'Erstelle Adresse (Turbo 0.2s)...' : 'Erstelle Adresse (Fast-Proxy)...';
      updateStatus(label, true);
      els.emailAddressInput.value = label;
      const acc = await mailApi.createRandomAccount();
      updateAddressUI(acc.address);
      updateProxyStatusUI();
      state.messages = [];
      state.selectedMessageId = null;
      renderMessageList();
      resetReader();
      updateStatus('Verbunden', false);
      showToast(`Neue Adresse aktiv: ${acc.address}`, 'success');
      window.soundEffects.playClick();
      await refreshInbox(false);
    } catch (e) {
      console.error('Account creation error:', e);
      updateStatus('Fehler', false);
      els.emailAddressInput.value = 'Fehler: ' + (e.message || 'Verbindung fehlgeschlagen');
      showToast(`Fehler: ${e.message}`, 'warning');
    }
  }

  function updateAddressUI(address, password = null) {
    els.emailAddressInput.value = address;
    const pwd = password || (mailApi.account ? mailApi.account.password : '');
    if (els.currentPasswordInput) {
      els.currentPasswordInput.value = pwd || '••••••••••••';
    }
  }

  function updateStatus(text, connecting = false) {
    els.statusText.textContent = text;
    if (connecting) {
      els.statusBadge.classList.add('connecting');
    } else {
      els.statusBadge.classList.remove('connecting');
    }
  }

  // Polling & Countdown
  function startCountdownTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.countdown = state.refreshInterval;
    updateTimerRing();

    state.timerId = setInterval(() => {
      state.countdown--;
      if (state.countdown <= 0) {
        state.countdown = state.refreshInterval;
        refreshInbox(true);
      }
      updateTimerRing();
    }, 1000);
  }

  function updateTimerRing() {
    els.refreshTimerText.textContent = `${state.countdown}s`;
    const pct = ((state.refreshInterval - state.countdown) / state.refreshInterval) * 100;
    const offset = 100 - pct;
    els.timerRingProgress.style.strokeDashoffset = offset;
  }

  async function refreshInbox(isAuto = false) {
    if (state.isRefreshing || !mailApi.token) return;
    state.isRefreshing = true;
    els.refreshBtnIcon.classList.add('spin');

    try {
      const newMessages = await mailApi.getMessages();
      handleMessagesUpdate(newMessages, isAuto);
    } catch (e) {
      console.warn('Refresh error:', e);
    } finally {
      state.isRefreshing = false;
      setTimeout(() => els.refreshBtnIcon.classList.remove('spin'), 400);
    }
  }

  function handleMessagesUpdate(newMessages, isAuto) {
    const existingIds = new Set(state.messages.map(m => m.id));
    let hasBrandNew = false;
    let newestItem = null;

    newMessages.forEach(msg => {
      if (!existingIds.has(msg.id)) {
        hasBrandNew = true;
        if (!newestItem) newestItem = msg;
      }
    });

    state.messages = newMessages;
    renderMessageList();

    if (hasBrandNew) {
      window.soundEffects.playChime();
      const sender = newestItem.from ? (newestItem.from.name || newestItem.from.address) : 'Unbekannt';
      showToast(`Neue E-Mail von ${sender}!`, 'info');

      if (state.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`Neue Nachricht erhalten`, {
          body: `Von: ${sender}\nBetreff: ${newestItem.subject || '(Kein Betreff)'}`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%236366f1"><path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z"/></svg>'
        });
      }

      // Automatically select if nothing is open
      if (!state.selectedMessageId && newestItem) {
        openMessage(newestItem.id);
      }
    }
  }

  // Message Rendering
  function renderMessageList() {
    const filtered = filterMessages();

    // Update Counts
    els.countAll.textContent = state.messages.length;
    els.countUnread.textContent = state.messages.filter(m => !m.seen).length;
    els.countAttachments.textContent = state.messages.filter(m => m.hasAttachments).length;

    if (filtered.length === 0) {
      els.emptyInboxState.classList.remove('hidden');
      els.messagesStack.innerHTML = '';
      return;
    }

    els.emptyInboxState.classList.add('hidden');
    els.messagesStack.innerHTML = '';

    const frag = document.createDocumentFragment();

    filtered.forEach(msg => {
      const card = document.createElement('div');
      card.className = `message-card ${!msg.seen ? 'unread' : ''} ${msg.id === state.selectedMessageId ? 'selected' : ''}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset.id = msg.id;

      const senderName = msg.from ? (msg.from.name || msg.from.address.split('@')[0]) : 'Unbekannt';
      const senderInitial = (senderName.charAt(0) || 'M').toUpperCase();
      const relativeTime = getRelativeTimeString(new Date(msg.createdAt));

      // Color gradient hash for avatar
      const colors = [
        'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        'linear-gradient(135deg, #10b981, #06b6d4)',
        'linear-gradient(135deg, #ec4899, #f43f5e)',
        'linear-gradient(135deg, #f59e0b, #ea580c)',
        'linear-gradient(135deg, #6366f1, #a855f7)'
      ];
      const colorIndex = Math.abs(hashCode(senderName)) % colors.length;

      card.innerHTML = `
        ${!msg.seen ? '<span class="unread-indicator" title="Ungelesen"></span>' : ''}
        <div class="card-avatar" style="background: ${colors[colorIndex]}">${escapeHtml(senderInitial)}</div>
        <div class="card-main">
          <div class="card-header-row">
            <span class="card-sender">${escapeHtml(senderName)}</span>
            <time class="card-time">${escapeHtml(relativeTime)}</time>
          </div>
          <div class="card-subject">${escapeHtml(msg.subject || '(Kein Betreff)')}</div>
          <div class="card-snippet">${escapeHtml(msg.intro || 'Keine Vorschau verfügbar')}</div>
          ${msg.hasAttachments ? `
            <div class="card-attachment-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.373L8.553 18.32a1.5 1.5 0 01-2.121-2.121l10.596-10.596"/>
              </svg>
              <span>Anhang</span>
            </div>` : ''}
        </div>
      `;

      card.addEventListener('click', () => openMessage(msg.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMessage(msg.id);
        }
      });

      frag.appendChild(card);
    });

    els.messagesStack.appendChild(frag);
  }

  function filterMessages() {
    let list = state.messages;

    if (state.filter === 'unread') {
      list = list.filter(m => !m.seen);
    } else if (state.filter === 'attachments') {
      list = list.filter(m => m.hasAttachments);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(m => {
        const sub = (m.subject || '').toLowerCase();
        const fromName = (m.from && m.from.name ? m.from.name : '').toLowerCase();
        const fromAddr = (m.from && m.from.address ? m.from.address : '').toLowerCase();
        const intro = (m.intro || '').toLowerCase();
        return sub.includes(q) || fromName.includes(q) || fromAddr.includes(q) || intro.includes(q);
      });
    }

    return list;
  }

  // Open & Read Message
  async function openMessage(id) {
    state.selectedMessageId = id;
    renderMessageList();

    els.readerPlaceholder.classList.add('hidden');
    els.readerContent.classList.remove('hidden');
    els.inboxWorkspace.classList.add('mobile-view-reader');

    // Find in memory or fetch
    let summary = state.messages.find(m => m.id === id);

    // Initial fill from summary while full fetch runs
    if (summary) {
      els.readerSubject.textContent = summary.subject || '(Kein Betreff)';
      els.readerFromName.textContent = summary.from ? (summary.from.name || summary.from.address) : 'Unbekannt';
      els.readerFromAddress.textContent = summary.from ? `<${summary.from.address}>` : '';
      els.readerToAddress.textContent = summary.to && summary.to[0] ? summary.to[0].address : mailApi.account.address;
      els.readerDateRelative.textContent = getRelativeTimeString(new Date(summary.createdAt));
      els.readerDateExact.textContent = new Date(summary.createdAt).toLocaleString('de-DE');
      els.readerAvatar.textContent = (els.readerFromName.textContent.charAt(0) || 'M').toUpperCase();
    }

    try {
      // Mark seen in API
      if (summary && !summary.seen) {
        summary.seen = true;
        mailApi.markAsSeen(id);
        renderMessageList();
      }

      // Fetch full detail
      const fullDetail = await mailApi.getMessage(id);
      state.selectedMessageDetail = fullDetail;
      renderFullMessage(fullDetail);
    } catch (e) {
      console.warn('Failed to load full message:', e);
      showToast('E-Mail-Inhalt konnte nicht geladen werden', 'warning');
    }
  }

  function renderFullMessage(msg) {
    els.readerSubject.textContent = msg.subject || '(Kein Betreff)';
    const senderName = msg.from ? (msg.from.name || msg.from.address.split('@')[0]) : 'Unbekannt';
    const senderAddr = msg.from ? msg.from.address : 'unbekannt@domain.com';
    els.readerFromName.textContent = senderName;
    els.readerFromAddress.textContent = `<${senderAddr}>`;
    els.readerToAddress.textContent = msg.to && msg.to[0] ? msg.to[0].address : (mailApi.account ? mailApi.account.address : '');
    els.readerDateRelative.textContent = getRelativeTimeString(new Date(msg.createdAt));
    els.readerDateExact.textContent = new Date(msg.createdAt).toLocaleString('de-DE');
    els.readerAvatar.textContent = (senderName.charAt(0) || 'M').toUpperCase();

    // Seen status toggle button
    els.readerSeenText.textContent = msg.seen ? 'Ungelesen' : 'Gelesen';
    els.readerToggleSeenBtn.title = msg.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren';

    // Attachments
    if (msg.attachments && msg.attachments.length > 0) {
      els.attachmentsDrawer.classList.remove('hidden');
      els.attachmentsCount.textContent = msg.attachments.length;
      els.attachmentsChips.innerHTML = '';
      msg.attachments.forEach(att => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';
        chip.title = 'Klicken zum Herunterladen: ' + att.filename;
        chip.innerHTML = `
          <div class="attachment-chip-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="att-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
            <span class="attachment-name">${escapeHtml(att.filename)}</span>
          </div>
          <span class="attachment-size">(${formatBytes(att.size)})</span>
        `;
        chip.addEventListener('click', () => mailApi.downloadAttachment(att, att.filename));
        els.attachmentsChips.appendChild(chip);
      });
    } else {
      els.attachmentsDrawer.classList.add('hidden');
    }

    // Body content: Full HTML Email Support
    let htmlContent = '';
    if (msg.html) {
      if (Array.isArray(msg.html)) {
        htmlContent = msg.html.filter(Boolean).join('');
      } else if (typeof msg.html === 'string') {
        htmlContent = msg.html.trim();
      }
    }

    // Fallback: If no HTML was sent by the sender, auto-format text with links
    if (!htmlContent && msg.text) {
      const escapedText = escapeHtml(msg.text);
      // Auto-link URLs
      const linkedText = escapedText.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      htmlContent = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;white-space:pre-wrap;padding:20px;line-height:1.65;font-size:14.5px;color:#1e293b;word-break:break-word;">${linkedText}</div>`;
    } else if (!htmlContent) {
      htmlContent = '<div style="font-family:sans-serif;padding:32px;text-align:center;color:#64748b;font-size:14px;">(Diese E-Mail enthält keinen Text oder HTML-Inhalt)</div>';
    }

    // Set plain text tab
    els.emailBodyPlainText.textContent = msg.text || (htmlContent.replace(/<[^>]*>/g, '').trim() || '(Kein reiner Text verfügbar)');

    // Render formatted HTML email
    renderIframeContent(htmlContent);
    switchViewMode(state.viewMode);
  }

  function renderIframeContent(rawHtml) {
    if (!rawHtml) rawHtml = '';

    const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">\n';
    const baseTag = '<base target="_blank">\n' + viewportMeta;
    const injectedMobileCss = `
<style id="velox-responsive-injected">
  html, body {
    max-width: 100% !important;
    overflow-x: auto !important;
    -webkit-text-size-adjust: 100% !important;
    box-sizing: border-box !important;
    margin: 0;
    padding: 16px;
    word-break: break-word;
  }
  *, *:before, *:after {
    box-sizing: inherit !important;
  }
  img {
    max-width: 100% !important;
    height: auto !important;
  }
  table {
    max-width: 100% !important;
  }
  pre, code {
    white-space: pre-wrap !important;
    word-break: break-all !important;
  }
  @media (max-width: 600px) {
    body {
      padding: 12px 8px !important;
    }
    table[class*="wrapper"], table[class*="container"], table[width="600"], table[width="100%"] {
      width: 100% !important;
      min-width: 0 !important;
    }
    td, th {
      word-break: break-word !important;
    }
  }
</style>
`;

    let finalDoc = '';
    const lower = rawHtml.toLowerCase();
    const injection = baseTag + injectedMobileCss;

    if (lower.includes('<html') || lower.includes('<!doctype')) {
      // Full HTML email document provided by sender:
      // Inject viewport, base target, and responsive reset into <head>
      if (lower.includes('<head>')) {
        finalDoc = rawHtml.replace(/<head>/i, '<head>' + injection);
      } else if (lower.includes('<head ')) {
        finalDoc = rawHtml.replace(/<head\b[^>]*>/i, '$&' + injection);
      } else {
        finalDoc = injection + rawHtml;
      }
    } else {
      // HTML Fragment: wrap in standard responsive canvas (clean white background like Gmail/Outlook)
      finalDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${baseTag}
  ${injectedMobileCss}
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 20px;
      color: #1e293b;
      background-color: #ffffff;
      line-height: 1.6;
      word-break: break-word;
    }
    a { color: #4f46e5; text-decoration: underline; }
  </style>
</head>
<body>
  ${rawHtml}
</body>
</html>`;
    }

    els.emailBodyIframe.srcdoc = finalDoc;
  }

  function resetReader() {
    state.selectedMessageId = null;
    state.selectedMessageDetail = null;
    els.readerPlaceholder.classList.remove('hidden');
    els.readerContent.classList.add('hidden');
    els.inboxWorkspace.classList.remove('mobile-view-reader');
  }

  function switchViewMode(mode) {
    state.viewMode = mode;
    if (mode === 'html') {
      els.tabViewHtml.classList.add('active');
      els.tabViewText.classList.remove('active');
      els.emailBodyIframe.classList.remove('hidden');
      els.emailBodyPlainText.classList.add('hidden');
    } else {
      els.tabViewText.classList.add('active');
      els.tabViewHtml.classList.remove('active');
      els.emailBodyIframe.classList.add('hidden');
      els.emailBodyPlainText.classList.remove('hidden');
    }
  }

  // Event Listeners
  function setupEventListeners() {
    // Copy address click
    const handleCopy = () => {
      const addr = els.emailAddressInput.value;
      if (!addr || addr.includes('...')) return;
      navigator.clipboard.writeText(addr).then(() => {
        showToast('Adresse in die Zwischenablage kopiert!', 'success');
        window.soundEffects.playClick();
      }).catch(() => {
        els.emailAddressInput.select();
        document.execCommand('copy');
        showToast('Adresse kopiert!', 'success');
      });
    };

    els.copyAddressBtn.addEventListener('click', handleCopy);
    els.emailInputWrapper.addEventListener('click', handleCopy);

    // Password visibility toggle
    if (els.togglePasswordVisibilityBtn) {
      els.togglePasswordVisibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isPassword = els.currentPasswordInput.type === 'password';
        els.currentPasswordInput.type = isPassword ? 'text' : 'password';
        if (isPassword) {
          els.iconEyeShow.classList.add('hidden');
          els.iconEyeHide.classList.remove('hidden');
        } else {
          els.iconEyeShow.classList.remove('hidden');
          els.iconEyeHide.classList.add('hidden');
        }
      });
    }

    // Password copy button
    if (els.copyPasswordBtn) {
      els.copyPasswordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pwd = (mailApi.account && mailApi.account.password) ? mailApi.account.password : els.currentPasswordInput.value;
        if (!pwd || pwd.includes('••')) return;
        navigator.clipboard.writeText(pwd).then(() => {
          showToast('Passwort in die Zwischenablage kopiert!', 'success');
          window.soundEffects.playClick();
        }).catch(() => {
          els.currentPasswordInput.select();
          document.execCommand('copy');
          showToast('Passwort kopiert!', 'success');
        });
      });
    }

    // Refresh button
    els.refreshBtn.addEventListener('click', () => {
      startCountdownTimer();
      refreshInbox(false);
      window.soundEffects.playClick();
    });

    els.autoRefreshPill.addEventListener('click', () => {
      startCountdownTimer();
      refreshInbox(false);
    });

    // Random new address
    els.randomNewBtn.addEventListener('click', () => {
      if (confirm('Möchtest du eine neue temporäre Adresse generieren? Die aktuelle Adresse wird im Verlauf gespeichert.')) {
        createNewAccount();
      }
    });

    // Theme Toggle
    els.themeToggleBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      localStorage.setItem('velox_theme', state.theme);
      updateThemeUI();
      // Re-style iframe if message is open
      if (state.selectedMessageDetail) {
        renderFullMessage(state.selectedMessageDetail);
      }
    });

    // Mobile Reader Back Button
    els.readerBackBtn.addEventListener('click', () => {
      els.inboxWorkspace.classList.remove('mobile-view-reader');
    });

    // Reader Actions
    els.readerToggleSeenBtn.addEventListener('click', () => {
      if (!state.selectedMessageDetail) return;
      const msg = state.selectedMessageDetail;
      msg.seen = !msg.seen;
      const summary = state.messages.find(m => m.id === msg.id);
      if (summary) summary.seen = msg.seen;
      els.readerSeenText.textContent = msg.seen ? 'Ungelesen' : 'Gelesen';
      els.readerToggleSeenBtn.title = msg.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren';
      showToast(msg.seen ? 'Als gelesen markiert' : 'Als ungelesen markiert', 'info');
    });

    els.readerDeleteBtn.addEventListener('click', async () => {
      if (!state.selectedMessageId) return;
      if (confirm('Möchtest du diese E-Mail wirklich löschen?')) {
        const id = state.selectedMessageId;
        await mailApi.deleteMessage(id);
        state.messages = state.messages.filter(m => m.id !== id);
        resetReader();
        renderMessageList();
        showToast('E-Mail gelöscht', 'info');
      }
    });

    els.readerPrintBtn.addEventListener('click', () => {
      try {
        els.emailBodyIframe.contentWindow.print();
      } catch (e) {
        window.print();
      }
    });

    els.readerRawBtn.addEventListener('click', async () => {
      if (!state.selectedMessageId) return;
      openModal(els.rawSourceModal);
      els.rawSourceCode.textContent = 'Lade Quelltext von mail.tm...';
      try {
        const raw = await mailApi.getMessageSource(state.selectedMessageId);
        els.rawSourceCode.textContent = raw;
      } catch (e) {
        els.rawSourceCode.textContent = `Fehler beim Laden: ${e.message}`;
      }
    });

    els.copyRawBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(els.rawSourceCode.textContent).then(() => {
        showToast('Quelltext kopiert!', 'success');
      });
    });

    // View mode tabs
    els.tabViewHtml.addEventListener('click', () => switchViewMode('html'));
    els.tabViewText.addEventListener('click', () => switchViewMode('text'));

    // Filter pills
    els.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        els.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.filter = pill.dataset.filter;
        renderMessageList();
      });
    });

    // Search box
    els.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      if (state.searchQuery) {
        els.searchClearBtn.classList.remove('hidden');
      } else {
        els.searchClearBtn.classList.add('hidden');
      }
      renderMessageList();
    });

    els.searchClearBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      state.searchQuery = '';
      els.searchClearBtn.classList.add('hidden');
      renderMessageList();
      els.searchInput.focus();
    });

    // Custom Address Modal
    els.customAddressBtn.addEventListener('click', () => {
      els.customUsername.value = '';
      els.customPassword.value = '';
      openModal(els.customAddressModal);
      setTimeout(() => els.customUsername.focus(), 50);
    });

    els.customAddressForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = els.customUsername.value.trim();
      const domain = els.customDomainSelect.value;
      const pwd = els.customPassword.value.trim() || null;

      if (!username) return;

      try {
        updateStatus('Erstelle Adresse (mit Proxy)...', true);
        const acc = await mailApi.createAccount(username, domain, pwd);
        updateAddressUI(acc.address);
        updateProxyStatusUI();
        closeModal(els.customAddressModal);
        state.messages = [];
        resetReader();
        renderMessageList();
        updateStatus('Verbunden', false);
        showToast(`Wunsch-Adresse aktiv: ${acc.address}`, 'success');
        await refreshInbox(false);
      } catch (err) {
        alert(err.message);
        updateStatus('Bereit', false);
      }
    });

    // Proxy / Turbo Status Click -> Instant Toggle
    if (els.proxyStatusBadge) {
      els.proxyStatusBadge.addEventListener('click', async () => {
        const currentMode = localStorage.getItem('velox_proxy_mode') || 'proxy';
        const newMode = currentMode === 'proxy' ? 'turbo' : 'proxy';
        localStorage.setItem('velox_proxy_mode', newMode);
        updateProxyStatusUI();
        window.soundEffects.playClick();
        if (newMode === 'turbo') {
          showToast('⚡ Turbo-Modus aktiv: Neue Adressen entstehen jetzt in ~0.2s!', 'success');
        } else {
          showToast('🛡️ Proxy-Modus aktiv: Rotierende IPs mit Pre-Warming & Fast-Race.', 'info');
        }
      });
    }

    // History Modal
    els.historyModalBtn.addEventListener('click', () => {
      renderHistoryList();
      openModal(els.historyModal);
    });

    // Modal Close Buttons
    els.closeCustomModalBtn.addEventListener('click', () => closeModal(els.customAddressModal));
    els.cancelCustomBtn.addEventListener('click', () => closeModal(els.customAddressModal));
    els.closeHistoryModalBtn.addEventListener('click', () => closeModal(els.historyModal));
    els.closeHistoryBtn.addEventListener('click', () => closeModal(els.historyModal));
    els.closeRawModalBtn.addEventListener('click', () => closeModal(els.rawSourceModal));
    els.closeRawBtn.addEventListener('click', () => closeModal(els.rawSourceModal));

    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    });

    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input field
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        if (e.key === 'Escape') {
          document.activeElement.blur();
          closeAllModals();
        }
        return;
      }

      switch (e.key) {
        case 'c':
        case 'C':
          e.preventDefault();
          handleCopy();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          startCountdownTimer();
          refreshInbox(false);
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          els.randomNewBtn.click();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          els.searchInput.focus();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          els.soundToggleBtn.click();
          break;
        case '?':
          e.preventDefault();
          openModal(els.shortcutsModal);
          break;
        case 'Delete':
          if (state.selectedMessageId) {
            e.preventDefault();
            els.readerDeleteBtn.click();
          }
          break;
        case 'Escape':
          closeAllModals();
          if (els.inboxWorkspace.classList.contains('mobile-view-reader')) {
            els.inboxWorkspace.classList.remove('mobile-view-reader');
          }
          break;
        case 'ArrowDown':
        case 'j':
        case 'J':
          navigateMessageList(1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          navigateMessageList(-1);
          break;
      }
    });
  }

  function navigateMessageList(direction) {
    const filtered = filterMessages();
    if (filtered.length === 0) return;
    const currentIndex = filtered.findIndex(m => m.id === state.selectedMessageId);
    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= filtered.length) newIndex = filtered.length - 1;
    openMessage(filtered[newIndex].id);
  }

  function populateDomainSelect(domains) {
    els.customDomainSelect.innerHTML = '';
    domains.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `@${d}`;
      els.customDomainSelect.appendChild(opt);
    });
  }

  function renderHistoryList() {
    const list = mailApi.getHistory();
    els.historyList.innerHTML = '';

    if (list.length === 0) {
      els.historyList.innerHTML = '<p class="modal-hint">Noch keine früheren Adressen gespeichert.</p>';
      return;
    }

    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const isCurrent = mailApi.account && mailApi.account.address === item.address;

      row.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div class="history-item-addr">${escapeHtml(item.address)} ${isCurrent ? '<span style="color:#10b981;font-size:0.75rem;">(Aktiv)</span>' : ''}</div>
          <div class="history-item-date">${new Date(item.createdAt).toLocaleString('de-DE')}</div>
          ${item.password ? `
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
              <span style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">PW:</span>
              <code style="font-size:11px;background:var(--black-elevated);padding:2px 6px;border-radius:4px;border:1px solid var(--border-subtle);color:var(--accent-bright);font-family:'JetBrains Mono',monospace;">${escapeHtml(item.password)}</code>
              <button class="btn btn-sm btn-ghost history-copy-pw-btn" style="padding:2px 6px;font-size:10px;" title="Passwort kopieren">Kopieren</button>
            </div>
          ` : ''}
        </div>
        <div class="history-item-actions">
          ${!isCurrent ? `<button class="btn btn-sm btn-secondary history-use-btn">Wechseln</button>` : ''}
          <button class="btn btn-sm btn-ghost history-del-btn" title="Aus Verlauf entfernen">&times;</button>
        </div>
      `;

      const copyPwBtn = row.querySelector('.history-copy-pw-btn');
      if (copyPwBtn && item.password) {
        copyPwBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(item.password).then(() => {
            showToast('Passwort kopiert!', 'success');
          });
        });
      }

      const useBtn = row.querySelector('.history-use-btn');
      if (useBtn) {
        useBtn.addEventListener('click', async () => {
          try {
            updateStatus('Wechsle Adresse...', true);
            await mailApi.switchAccount(item);
            updateAddressUI(item.address);
            closeModal(els.historyModal);
            state.messages = [];
            resetReader();
            renderMessageList();
            updateStatus('Verbunden', false);
            showToast(`Gewechselt zu: ${item.address}`, 'success');
            await refreshInbox(false);
          } catch (e) {
            alert(e.message);
          }
        });
      }

      const delBtn = row.querySelector('.history-del-btn');
      delBtn.addEventListener('click', () => {
        mailApi.removeFromHistory(item.address);
        renderHistoryList();
      });

      els.historyList.appendChild(row);
    });
  }

  function updateSoundUI() {
    if (!els.soundIconOn || !els.soundIconOff) return;
    if (state.soundEnabled) {
      els.soundIconOn.classList.remove('hidden');
      els.soundIconOff.classList.add('hidden');
    } else {
      els.soundIconOn.classList.add('hidden');
      els.soundIconOff.classList.remove('hidden');
    }
  }

  function updateThemeUI() {
    // Theme is updated via CSS data-theme
  }

  function openModal(modal) {
    modal.classList.remove('hidden');
  }

  function closeModal(modal) {
    modal.classList.add('hidden');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  }

  function showToast(text, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:#10b981;"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
    } else if (type === 'warning') {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:#f59e0b;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>';
    } else {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:#6366f1;"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>';
    }

    toast.innerHTML = `${iconSvg}<span>${escapeHtml(text)}</span>`;
    els.toastHub.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }

  // Utilities
  function getRelativeTimeString(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 15) return 'Gerade eben';
    if (diff < 60) return `vor ${Math.floor(diff)} Sek.`;
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
    return date.toLocaleDateString('de-DE');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Mock Email Generator for Instant User Testing
  function generateMockEmail() {
    const id = 'sim_' + Date.now();
    const pin = Math.floor(100000 + Math.random() * 900000);
    const mockHtml = `
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);font-family:Helvetica,Arial,sans-serif;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:28px 24px;text-align:center;">
          <h2 style="color:#ffffff;margin:0;font-size:22px;letter-spacing:-0.02em;">VeloxMail Verifizierung</h2>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0 0;font-size:14px;">Deine Registrierung ist fast abgeschlossen</p>
        </div>
        <div style="padding:32px 28px;color:#334155;line-height:1.6;">
          <p style="font-size:15px;margin-top:0;">Hallo!</p>
          <p style="font-size:14px;color:#64748b;">Vielen Dank für deine Nutzung von VeloxMail. Verwende bitte den folgenden Bestätigungscode, um deinen Account freizuschalten:</p>
          <div style="margin:24px 0;text-align:center;">
            <div style="display:inline-block;padding:12px 28px;background:#f1f5f9;border:2px dashed #6366f1;border-radius:8px;font-size:30px;font-weight:bold;letter-spacing:6px;color:#4f46e5;font-family:monospace;">
              ${pin}
            </div>
          </div>
          <p style="font-size:13px;color:#94a3b8;margin-bottom:24px;">Dieser Code ist für die nächsten 15 Minuten gültig. Falls du diese Anfrage nicht veranlasst hast, kannst du diese E-Mail einfach ignorieren.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <div style="text-align:center;">
            <a href="https://mail.tm" target="_blank" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:6px;font-weight:600;font-size:14px;">Account jetzt bestätigen &rarr;</a>
          </div>
        </div>
        <div style="background:#f8fafc;padding:16px 24px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
          &copy; 2026 VeloxMail Core &bull; Betrieben über mail.tm API &bull; 100% werbefrei
        </div>
      </div>
    `;

    return {
      id: id,
      accountId: 'sim_acc',
      msgid: '<mock@veloxmail.local>',
      from: { name: 'Velox Security Service', address: 'security@veloxmail.local' },
      to: [{ name: 'Temporärer Nutzer', address: mailApi.account ? mailApi.account.address : 'user@mail.tm' }],
      subject: `Dein Verifizierungscode: ${pin}`,
      intro: `Vielen Dank für deine Registrierung. Verwende den Bestätigungscode ${pin}, um deinen Zugang zu aktivieren...`,
      seen: false,
      isDeleted: false,
      hasAttachments: true,
      size: 4200,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      text: `Hallo!\n\nDein Bestätigungscode lautet: ${pin}\n\nDieser Code ist 15 Minuten gültig.\n\nDein VeloxMail Team`,
      html: [mockHtml],
      attachments: [
        {
          id: 'att_1',
          filename: 'security-ticket.pdf',
          contentType: 'application/pdf',
          size: 14200,
          downloadUrl: null
        }
      ]
    };
  }
});
