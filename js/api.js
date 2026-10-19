// Mail.tm API Client (Optimized with Local Proxy & Direct Fallback, Zero Lag)
class MailTmAPI {
  constructor() {
    // If running over HTTP/HTTPS (like localhost:3000), use our built-in high-speed proxy /api
    // This completely bypasses browser CORS blocks!
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
      this.baseUrl = '/api';
    } else {
      this.baseUrl = 'https://api.mail.tm';
    }

    this.token = null;
    this.account = null; // { id, address, password, createdAt }
    this.domains = [];
    this.eventSource = null;
    this.onNewMessage = null;

    // Load persisted state if exists
    this.loadState();
  }

  loadState() {
    try {
      const savedAcc = localStorage.getItem('velox_account');
      const savedToken = localStorage.getItem('velox_token');
      if (savedAcc && savedToken) {
        this.account = JSON.parse(savedAcc);
        this.token = savedToken;
      }
    } catch (e) {
      console.warn('Failed to load local storage state:', e);
    }
  }

  saveState() {
    try {
      if (this.account && this.token) {
        localStorage.setItem('velox_account', JSON.stringify(this.account));
        localStorage.setItem('velox_token', this.token);
        this.addToHistory(this.account);
      }
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  clearState() {
    this.token = null;
    this.account = null;
    try {
      localStorage.removeItem('velox_account');
      localStorage.removeItem('velox_token');
      // Also clean up old key if existed
      localStorage.removeItem('tempmail_account');
      localStorage.removeItem('tempmail_token');
    } catch (e) {}
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  getHistory() {
    try {
      const hist = localStorage.getItem('velox_history');
      return hist ? JSON.parse(hist) : [];
    } catch (e) {
      return [];
    }
  }

  addToHistory(acc) {
    try {
      let history = this.getHistory();
      history = history.filter(item => item.address !== acc.address);
      history.unshift({
        address: acc.address,
        password: acc.password,
        createdAt: acc.createdAt || new Date().toISOString()
      });
      if (history.length > 8) history = history.slice(0, 8);
      localStorage.setItem('velox_history', JSON.stringify(history));
    } catch (e) {}
  }

  removeFromHistory(address) {
    try {
      let history = this.getHistory();
      history = history.filter(item => item.address !== address);
      localStorage.setItem('velox_history', JSON.stringify(history));
    } catch (e) {}
  }

  async fetchDomains() {
    try {
      const res = await fetch(`${this.baseUrl}/domains?page=1`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`Fehler beim Laden der Domains (${res.status})`);
      const data = await res.json();
      const members = data['hydra:member'] || [];
      this.domains = members.filter(d => d.isActive).map(d => d.domain);
    } catch (err) {
      // If /api failed, try direct mail.tm
      if (this.baseUrl === '/api') {
        try {
          const directRes = await fetch('https://api.mail.tm/domains?page=1');
          const dData = await directRes.json();
          this.domains = (dData['hydra:member'] || []).filter(d => d.isActive).map(d => d.domain);
        } catch (e) {}
      }
    }

    if (!this.domains || this.domains.length === 0) {
      this.domains = ['maxxspace.com'];
    }
    return this.domains;
  }

  generateRandomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%_';
    let pwd = '';
    for (let i = 0; i < 16; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  }

  generateRandomUsername() {
    // Note: mail.tm removes dots and special characters from addresses, so we generate clean alphanumerics
    const prefixes = ['swift', 'hyper', 'cyber', 'nova', 'pulse', 'shadow', 'pixel', 'vivid', 'lunar', 'apex', 'vortex', 'spark', 'echo', 'frost', 'blaze', 'atlas'];
    const nouns = ['mail', 'box', 'flow', 'wave', 'post', 'fox', 'drop', 'cloud', 'core', 'byte', 'nest', 'link'];
    const randNum = Math.floor(100 + Math.random() * 899);
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const n = nouns[Math.floor(Math.random() * nouns.length)];
    return `${p}${n}${randNum}`;
  }

  async createRandomAccount(maxRetries = 3) {
    if (this.domains.length === 0) {
      await this.fetchDomains();
    }
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const domain = this.domains[Math.floor(Math.random() * this.domains.length)];
        const username = this.generateRandomUsername();
        return await this.createAccount(username, domain);
      } catch (err) {
        lastError = err;
        // Wait 300ms before retrying in case of micro rate-limit
        await new Promise(r => setTimeout(r, 300));
      }
    }
    throw lastError || new Error('Account konnte nach mehreren Versuchen nicht erstellt werden');
  }

  async createAccount(username, domain, customPassword = null) {
    // Sanitize username: lowercase alphanumeric ONLY (dots get stripped by mail.tm which causes 401s on token)
    const cleanUser = username.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanUser) {
      throw new Error('Benutzername darf nur Buchstaben und Zahlen enthalten');
    }
    const initialAddress = `${cleanUser}@${domain}`;
    const password = customPassword || this.generateRandomPassword();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    const mode = localStorage.getItem('velox_proxy_mode') || 'proxy';
    if (mode === 'turbo') {
      headers['X-Mode'] = 'turbo';
      headers['X-Skip-Proxy'] = '1';
    }

    const createRes = await fetch(`${this.baseUrl}/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: initialAddress, password })
    });
    this.lastProxyUsed = createRes.headers.get('x-proxy-used') || (mode === 'turbo' ? 'direct (Turbo)' : 'direct');

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      let msg = '';
      if (err.violations && Array.isArray(err.violations) && err.violations.length > 0) {
        msg = err.violations.map(v => v.message).join(', ');
      } else if (err.detail) {
        msg = err.detail;
      } else if (err['hydra:description']) {
        msg = err['hydra:description'];
      } else if (err.message) {
        msg = err.message;
      } else if (createRes.status === 429) {
        msg = 'Zu viele Anfragen. Bitte warte einen kurzen Moment.';
      } else {
        msg = `Account-Erstellung fehlgeschlagen (${createRes.status})`;
      }
      throw new Error(msg);
    }

    const accData = await createRes.json();
    // CRITICAL: Always use the canonical address returned by mail.tm in accData.address
    const canonicalAddress = accData.address || initialAddress;

    // Authenticate and obtain JWT
    const token = await this.authenticate(canonicalAddress, password);

    this.account = {
      id: accData.id,
      address: canonicalAddress,
      password: password,
      createdAt: accData.createdAt || new Date().toISOString()
    };
    this.token = token;
    this.saveState();
    this.setupMercureListener();

    return this.account;
  }

  async authenticate(address, password) {
    const res = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ address, password })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      let msg = '';
      if (err.detail) {
        msg = err.detail;
      } else if (err['hydra:description']) {
        msg = err['hydra:description'];
      } else if (err.message) {
        msg = err.message;
      } else if (res.status === 429) {
        msg = 'Zu viele Anfragen. Bitte warte kurz.';
      } else {
        msg = `Anmeldung fehlgeschlagen (${res.status})`;
      }
      throw new Error(msg);
    }

    const data = await res.json();
    return data.token;
  }

  async switchAccount(historyItem) {
    try {
      const token = await this.authenticate(historyItem.address, historyItem.password);
      this.account = {
        id: historyItem.id || 'acc_' + Date.now(),
        address: historyItem.address,
        password: historyItem.password,
        createdAt: historyItem.createdAt
      };
      this.token = token;
      this.saveState();
      this.setupMercureListener();
      return this.account;
    } catch (e) {
      throw new Error(`Konto konnte nicht wiederhergestellt werden: ${e.message}`);
    }
  }

  async getMessages(page = 1) {
    if (!this.token) return [];

    const res = await fetch(`${this.baseUrl}/messages?page=${page}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json'
      }
    });

    if (res.status === 401) {
      // Re-authenticate if password exists
      if (this.account && this.account.password) {
        try {
          this.token = await this.authenticate(this.account.address, this.account.password);
          this.saveState();
          return this.getMessages(page);
        } catch (e) {
          this.clearState();
          throw new Error('Sitzung abgelaufen');
        }
      }
      this.clearState();
      throw new Error('Sitzung abgelaufen');
    }

    if (!res.ok) {
      throw new Error(`Fehler beim Abrufen der Nachrichten (${res.status})`);
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      return data;
    }
    if (data && Array.isArray(data['hydra:member'])) {
      return data['hydra:member'];
    }
    if (data && Array.isArray(data.member)) {
      return data.member;
    }
    return [];
  }

  async getMessage(id) {
    if (!this.token) throw new Error('Nicht authentifiziert');

    const res = await fetch(`${this.baseUrl}/messages/${id}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Nachricht konnte nicht geladen werden (${res.status})`);
    }

    return await res.json();
  }

  async deleteMessage(id) {
    if (!this.token) return false;

    const res = await fetch(`${this.baseUrl}/messages/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    return res.status === 204 || res.ok;
  }

  async markAsSeen(id) {
    if (!this.token) return false;

    const res = await fetch(`${this.baseUrl}/messages/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/merge-patch+json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ seen: true })
    });

    return res.ok;
  }

  async getMessageSource(id) {
    if (!this.token) throw new Error('Nicht authentifiziert');
    const res = await fetch(`${this.baseUrl}/messages/${id}/download`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    if (!res.ok) throw new Error('Quelltext nicht verfügbar');
    return await res.text();
  }

  getAttachmentUrl(attachment) {
    if (attachment.downloadUrl) {
      if (attachment.downloadUrl.startsWith('http')) return attachment.downloadUrl;
      return `${this.baseUrl}${attachment.downloadUrl}`;
    }
    return null;
  }

  async downloadAttachment(attachment, filename) {
    if (!this.token) return;
    const url = this.getAttachmentUrl(attachment);
    if (!url) return;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename || attachment.filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch (e) {
      console.error('Download failed:', e);
      alert('Herunterladen des Anhangs fehlgeschlagen.');
    }
  }

  // Mercure SSE Real-Time Stream (Optional live push)
  setupMercureListener() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (!this.account || !this.account.id) return;

    try {
      const hubUrl = new URL('https://mercure.mail.tm/.well-known/mercure');
      hubUrl.searchParams.append('topic', `/accounts/${this.account.id}`);

      const es = new EventSource(hubUrl.toString());
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.onNewMessage) {
            this.onNewMessage(data);
          }
        } catch (e) {}
      };
      es.onerror = () => {
        // Polling seamlessly handles it
      };
      this.eventSource = es;
    } catch (e) {}
  }
}

if (typeof window !== 'undefined') {
  window.mailApi = new MailTmAPI();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MailTmAPI;
}
