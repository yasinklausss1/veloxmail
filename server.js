// VeloxMail — High Performance Node.js Server & Mail.tm Proxy
// Optimized with Pre-Warmed Fast Proxy Pool, Sticky 3-Use Rotation & Sub-Second Race Fallback
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PORT         = process.env.PORT || 3000;
const PUBLIC_DIR   = __dirname;
const API_UPSTREAM = 'https://api.mail.tm';

// Multi-Source Proxy APIs: ProxyScrape & PubProxy
const PROXY_API_URL_SCRAPE =
  'https://api.proxyscrape.com/v4/free-proxy-list/get' +
  '?request=display_proxies&proxy_format=protocolipport&format=text&timeout=1000&protocol=http';

const PROXY_API_URL_PUB =
  'http://pubproxy.com/api/proxy?limit=5&format=json&https=1';

// ─── Proxy State ─────────────────────────────────────────────────────────────
const proxyState = {
  rawList:             [],           // all fetched raw proxies from both sources
  alivePool:           [],           // [{ url, latency, lastChecked }] - pre-warmed & verified
  aliveIndex:          0,
  currentProxy:        null,         // Current active sticky proxy
  currentProxyUsage:   0,            // How many accounts created with currentProxy (0, 1, 2, 3)
  MAX_USES_PER_PROXY:  3,            // Exactly 3 creations per proxy before rotation
  lastFetch:           0,
  isFetching:          false,
  lastUsedProxy:       null,
  successfulRotations: 0,
  directCount:         0,
  sourceStats:         { proxyscrape: 0, pubproxy: 0, total: 0 },
  TTL:                 10 * 60_000,  // refresh raw list every 10 minutes
};

function buildAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  try {
    if (proxyUrl.startsWith('socks4://') || proxyUrl.startsWith('socks5://')) {
      return new SocksProxyAgent(proxyUrl);
    }
    return new HttpsProxyAgent(proxyUrl);
  } catch (err) {
    return undefined;
  }
}

// ─── PubProxy API Fetcher ───────────────────────────────────────────────────
async function fetchPubProxy() {
  try {
    const res = await fetch(PROXY_API_URL_PUB, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];
    const proxies = json.data.map(item => {
      const proto = (item.type || 'http').toLowerCase();
      const prefix = proto.includes('socks') ? `${proto}://` : 'http://';
      const hostPort = item.ipPort || `${item.ip}:${item.port}`;
      return `${prefix}${hostPort}`;
    }).filter(p => p.length > 9);
    console.log(`[PubProxy] ✔ ${proxies.length} Proxies von pubproxy.com geladen:`, proxies);
    return proxies;
  } catch (e) {
    console.warn('[PubProxy] Hinweis/Warnung:', e.message);
    return [];
  }
}

// ─── Background Proxy Verification ───────────────────────────────────────────
function checkSingleProxy(proxyUrl, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeoutMs);

    try {
      const agent = buildAgent(proxyUrl);
      if (!agent) {
        clearTimeout(timer);
        return resolve(null);
      }
      const start = Date.now();
      const req = https.request({
        hostname: 'api.mail.tm',
        port: 443,
        path: '/domains?page=1',
        method: 'GET',
        headers: { host: 'api.mail.tm', accept: 'application/json' },
        agent,
        timeout: timeoutMs,
      }, (res) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const latency = Date.now() - start;
          if (res.statusCode === 200) {
            resolve({ url: proxyUrl, latency, lastChecked: Date.now() });
          } else {
            resolve(null);
          }
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
      });
      req.on('error', () => {
        if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
      });
      req.end();
    } catch (e) {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
    }
  });
}

async function fetchProxyList() {
  if (proxyState.isFetching) return;
  proxyState.isFetching = true;
  try {
    console.log('[Proxy] Lade Proxies von ProxyScrape & PubProxy...');
    const [scrapeRes, pubList] = await Promise.allSettled([
      fetch(PROXY_API_URL_SCRAPE, { signal: AbortSignal.timeout(8_000) }).then(r => r.text()),
      fetchPubProxy(),
    ]);

    let scrapeProxies = [];
    if (scrapeRes.status === 'fulfilled' && scrapeRes.value) {
      scrapeProxies = scrapeRes.value
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l.startsWith('http://'));
    }

    const pubProxies = (pubList.status === 'fulfilled' && Array.isArray(pubList.value))
      ? pubList.value
      : [];

    const merged = Array.from(new Set([...pubProxies, ...scrapeProxies]));

    if (merged.length > 0) {
      proxyState.rawList = merged;
      proxyState.sourceStats = {
        proxyscrape: scrapeProxies.length,
        pubproxy: pubProxies.length,
        total: merged.length,
      };
      proxyState.lastFetch = Date.now();
      console.log(`[Proxy] Multi-Source Pool: ${merged.length} Proxies geladen (ProxyScrape: ${scrapeProxies.length}, PubProxy: ${pubProxies.length}). Starte Pre-Warming...`);
      await warmUpAlivePool();
    }
  } catch (e) {
    console.warn('[Proxy] Fehler beim Laden der Proxy-Liste:', e.message);
  } finally {
    proxyState.isFetching = false;
  }
}

async function warmUpAlivePool() {
  if (proxyState.rawList.length === 0) return;

  // Occasionally fetch fresh PubProxies during pre-warming to keep fresh IPs coming
  if (Math.random() < 0.35) {
    fetchPubProxy().then(freshPub => {
      if (freshPub && freshPub.length > 0) {
        freshPub.forEach(p => {
          if (!proxyState.rawList.includes(p)) proxyState.rawList.push(p);
          checkSingleProxy(p, 1200).then(alive => {
            if (alive) {
              const map = new Map(proxyState.alivePool.map(item => [item.url, item]));
              map.set(alive.url, alive);
              proxyState.alivePool = Array.from(map.values()).sort((a, b) => a.latency - b.latency).slice(0, 35);
              console.log(`[PubProxy] ✔ Frischer Proxy ${alive.url} verifiziert (${alive.latency}ms) und in alivePool aufgenommen!`);
            }
          });
        });
      }
    }).catch(() => {});
  }

  const candidates = [];
  const count = Math.min(25, proxyState.rawList.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * proxyState.rawList.length);
    const p = proxyState.rawList[idx];
    if (p && !candidates.includes(p)) candidates.push(p);
  }

  const results = await Promise.all(candidates.map(p => checkSingleProxy(p, 1200)));
  const working = results.filter(Boolean);

  if (working.length > 0) {
    const map = new Map(proxyState.alivePool.map(item => [item.url, item]));
    working.forEach(w => map.set(w.url, w));
    proxyState.alivePool = Array.from(map.values())
      .sort((a, b) => a.latency - b.latency)
      .slice(0, 30);

    // If currentProxy is not set or not in alivePool, pick the fastest available
    if (!proxyState.currentProxy && proxyState.alivePool.length > 0) {
      proxyState.currentProxy = proxyState.alivePool[0].url;
      proxyState.currentProxyUsage = 0;
    }

    console.log(`[Proxy] Pre-Warmed Pool: ${proxyState.alivePool.length} verifizierte High-Speed Proxies bereit (Schnellster: ${proxyState.alivePool[0].latency}ms)`);
  }
}

// ─── Sticky 3-Use Proxy Rotation ─────────────────────────────────────────────
function getActiveProxy() {
  if (proxyState.alivePool.length === 0) return null;

  // Check if currentProxy is still valid and has remaining uses
  const isStillAlive = proxyState.currentProxy &&
    proxyState.alivePool.some(p => p.url === proxyState.currentProxy);

  if (!proxyState.currentProxy || !isStillAlive || proxyState.currentProxyUsage >= proxyState.MAX_USES_PER_PROXY) {
    // Pick the next alive proxy from the pool
    const nextItem = proxyState.alivePool[proxyState.aliveIndex % proxyState.alivePool.length];
    proxyState.aliveIndex = (proxyState.aliveIndex + 1) % proxyState.alivePool.length;
    proxyState.currentProxy = nextItem ? nextItem.url : null;
    proxyState.currentProxyUsage = 0;
    console.log(`\x1b[35m[Proxy Rotation] ➔ Neuer Proxy aktiviert: ${proxyState.currentProxy} (Nutzung 0/${proxyState.MAX_USES_PER_PROXY})\x1b[0m`);
  }

  return {
    url: proxyState.currentProxy,
    usage: proxyState.currentProxyUsage,
    maxUses: proxyState.MAX_USES_PER_PROXY,
  };
}

function recordProxySuccess(proxyUrl) {
  if (proxyState.currentProxy === proxyUrl) {
    proxyState.currentProxyUsage++;
    console.log(`\x1b[36m[Proxy] Proxy ${proxyUrl} erfolgreich genutzt: ${proxyState.currentProxyUsage}/${proxyState.MAX_USES_PER_PROXY}\x1b[0m`);
    if (proxyState.currentProxyUsage >= proxyState.MAX_USES_PER_PROXY) {
      console.log(`\x1b[33m[Proxy] ${proxyState.MAX_USES_PER_PROXY}/${proxyState.MAX_USES_PER_PROXY} Nutzungen erreicht. Nächste Mail-Erstellung wechselt zum nächsten Proxy!\x1b[0m`);
    }
  }
}

function invalidateProxy(proxyUrl) {
  proxyState.alivePool = proxyState.alivePool.filter(p => p.url !== proxyUrl);
  if (proxyState.currentProxy === proxyUrl) {
    proxyState.currentProxy = null;
    proxyState.currentProxyUsage = 0;
  }
}

// ─── Forward Request Engine (with Hard Timeout) ──────────────────────────────
function executeHttpsRequest({ method, urlPath, headers, body, proxyUrl, timeoutMs = 1200 }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const url = new URL(urlPath, API_UPSTREAM);
    const agent = proxyUrl ? buildAgent(proxyUrl) : undefined;

    const reqHeaders = { ...headers };
    reqHeaders['host'] = url.hostname;
    if (body && body.length > 0) {
      reqHeaders['content-length'] = Buffer.byteLength(body);
    }

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        req.destroy();
        reject(new Error(`Timeout (${timeoutMs}ms)`));
      }
    }, timeoutMs);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: reqHeaders,
      agent: agent,
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            usedProxy: proxyUrl || 'direct',
          });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`Socket Timeout (${timeoutMs}ms)`));
      }
    });

    req.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    if (body && body.length > 0) req.write(body);
    req.end();
  });
}

// ─── Initial Pre-Warming & Recurring Updates ─────────────────────────────────
fetchProxyList();
setInterval(() => {
  if (Date.now() - proxyState.lastFetch > proxyState.TTL) fetchProxyList();
  else warmUpAlivePool();
}, 30_000);

// ─── MIME Types ──────────────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'text/javascript; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff2': 'font/woff2',
};

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, X-Mode, X-Skip-Proxy');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Status endpoint ─────────────────────────────────────────────────────────
  if (req.url === '/proxy-status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const current = proxyState.alivePool[0] || null;
    res.end(JSON.stringify({
      poolSize:            proxyState.rawList.length,
      aliveCount:          proxyState.alivePool.length,
      sources:             proxyState.sourceStats,
      fastestLatency:      current ? current.latency : null,
      currentProxy:        proxyState.currentProxy,
      currentUsage:        proxyState.currentProxyUsage,
      maxUses:             proxyState.MAX_USES_PER_PROXY,
      lastUsedProxy:       proxyState.lastUsedProxy,
      successfulRotations: proxyState.successfulRotations,
      directCount:         proxyState.directCount,
    }));
    return;
  }

  // ── Force Warm-up / Refresh ────────────────────────────────────────────────
  if (req.url === '/proxy-refresh' && req.method === 'POST') {
    fetchProxyList();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Proxy-Refresh & Pre-Warming gestartet' }));
    return;
  }

  // ── Mail.tm API Proxy ──────────────────────────────────────────────────────
  if (req.url.startsWith('/api')) {
    const isAccountCreation = req.url === '/api/accounts' && req.method === 'POST';
    const forceDirect = req.headers['x-skip-proxy'] === '1' || req.headers['x-mode'] === 'turbo';

    // Collect request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const reqBody = (['POST', 'PATCH', 'PUT'].includes(req.method) && chunks.length > 0)
      ? Buffer.concat(chunks)
      : undefined;

    const forwardHeaders = {};
    if (req.headers['content-type'])  forwardHeaders['content-type']  = req.headers['content-type'];
    if (req.headers['authorization']) forwardHeaders['authorization'] = req.headers['authorization'];
    if (req.headers['accept'])        forwardHeaders['accept']        = req.headers['accept'];

    const targetPath = req.url.replace(/^\/api/, '');

    // ── High Speed Account Creation with Sticky 3-Use Proxy Rotation ────────
    if (isAccountCreation) {
      const proxyInfo = (!forceDirect && proxyState.alivePool.length > 0)
        ? getActiveProxy()
        : null;
      const candidateProxy = proxyInfo ? proxyInfo.url : null;

      if (!candidateProxy) {
        // Direct Turbo Mode (~200ms)
        try {
          const directRes = await executeHttpsRequest({
            method: req.method,
            urlPath: targetPath,
            headers: forwardHeaders,
            body: reqBody,
            proxyUrl: null,
            timeoutMs: 4000,
          });
          proxyState.directCount++;
          proxyState.lastUsedProxy = 'direct';

          res.writeHead(directRes.statusCode, {
            'Content-Type': directRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Proxy-Used, X-Proxy-Usage',
            'X-Proxy-Used': 'direct (Turbo)',
            'X-Proxy-Usage': 'turbo',
          });
          res.end(directRes.body);
          return;
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mail.tm Fehler: ' + e.message }));
          return;
        }
      }

      // Proxy Mode: Speculative Race (Proxy with 750ms lead, then fast direct fallback)
      let responded = false;
      const sendSuccess = (result) => {
        if (responded) return;

        // If direct returned a rate-limit (429) or server error, don't kill the in-flight proxy
        if (result.usedProxy === 'direct' && (result.statusCode === 429 || result.statusCode >= 500)) {
          console.log(`[Proxy] Direct Verbindung erhielt Status ${result.statusCode}. Warte auf Proxy-Antwort...`);
          return;
        }

        responded = true;
        if (result.usedProxy && result.usedProxy !== 'direct') {
          if (result.statusCode === 201) {
            recordProxySuccess(candidateProxy);
            proxyState.successfulRotations++;
            proxyState.lastUsedProxy = result.usedProxy;
            console.log(`[Proxy] ✔ Account via ${result.usedProxy} in ${result.ms}ms [Nutzung ${proxyState.currentProxyUsage}/${proxyState.MAX_USES_PER_PROXY}]`);
          } else {
            console.warn(`[Proxy] Proxy ${result.usedProxy} lieferte Status ${result.statusCode}, rotiere sofort zur nächsten IP...`);
            invalidateProxy(candidateProxy);
          }
        } else {
          proxyState.directCount++;
          proxyState.lastUsedProxy = 'direct (fallback)';
          console.log(`[Proxy] ⚡ Direct Fallback gewann in ${result.ms}ms (Status ${result.statusCode})`);
        }

        res.writeHead(result.statusCode, {
          'Content-Type': result.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Proxy-Used, X-Proxy-Usage',
          'X-Proxy-Used': result.usedProxy,
          'X-Proxy-Usage': `${proxyState.currentProxyUsage}/${proxyState.MAX_USES_PER_PROXY}`,
        });
        res.end(result.body);
      };

      const startMs = Date.now();

      // Launch Proxy Request (Strict 1600ms max)
      const proxyPromise = executeHttpsRequest({
        method: req.method,
        urlPath: targetPath,
        headers: forwardHeaders,
        body: reqBody,
        proxyUrl: candidateProxy,
        timeoutMs: 1600,
      }).then(r => {
        r.ms = Date.now() - startMs;
        sendSuccess(r);
      }).catch(err => {
        // Invalidate failed proxy and pick fresh one next time
        invalidateProxy(candidateProxy);
      });

      // Launch Speculative Direct Request after 1100ms if proxy hasn't responded yet
      const fallbackTimer = setTimeout(() => {
        if (!responded) {
          executeHttpsRequest({
            method: req.method,
            urlPath: targetPath,
            headers: forwardHeaders,
            body: reqBody,
            proxyUrl: null,
            timeoutMs: 3500,
          }).then(r => {
            r.ms = Date.now() - startMs;
            sendSuccess(r);
          }).catch(err => {
            if (!responded) {
              responded = true;
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Mail.tm Fehler: ' + err.message }));
            }
          });
        }
      }, 1100);

      proxyPromise.finally(() => clearTimeout(fallbackTimer));
      return;
    }

    // ── All other API requests (reading inbox, tokens, domains) ──────────────
    try {
      const upstreamRes = await executeHttpsRequest({
        method: req.method,
        urlPath: targetPath,
        headers: forwardHeaders,
        body: reqBody,
        proxyUrl: null,
        timeoutMs: 8000,
      });

      res.writeHead(upstreamRes.statusCode, {
        'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(upstreamRes.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mail.tm Gateway Fehler: ' + err.message }));
    }
    return;
  }

  // ── Static Files ────────────────────────────────────────────────────────────
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext         = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type':  contentType,
      'Cache-Control': 'no-cache',
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\x1b[32m✔ VeloxMail Web Server & Mail.tm Proxy läuft auf http://localhost:${PORT}\x1b[0m`);
  console.log(`\x1b[36m  → Sticky 3-Use Proxy Rotation Engine: Aktiviert\x1b[0m`);
});
