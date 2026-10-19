# VeloxMail — Minimalist High-Speed Temporary Mail Service

Ein moderner, werbefreier und minimalistischer Wegwerf-E-Mail-Dienst mit integrierter **Sticky-Proxy-Rotation** und **Sub-Second-Turbomodus**.

---

## Features

- **Sofortige E-Mail-Adresse:** Generierung in unter 200ms oder mit rotierenden Proxys.
- **Dual-Source Proxy-Rotation:** Nutzt Proxys von ProxyScrape & PubProxy mit spekulativem 750ms-Race-Fallback.
- **Sticky 3-Use Rotation:** Jeder verifizierte Proxy wird für genau 3 Adressenerstellungen genutzt und anschließend automatisch gewechselt (`[1/3]`, `[2/3]`, `[3/3]`).
- **Turbo-Modus Toggle:** Direkter Moduswechsel mit einem Klick auf das Status-Badge.
- **Vollständig responsiv:** Optimiert für Smartphones, Tablets und Desktops ohne horizontales Scrollen.
- **Minimalistisches Design:** Klares, abgerundungsfreies (0px Radius) High-Tech-Design mit dezentem, verschwommenem geometrischem Ambient-Hintergrund.
- **Vollständiger HTML-Viewer:** Sandboxed Iframe mit automatischem responsivem Viewport-Reset für Verifizierungs- und Newsletter-Mails.
- **Keine Abhängigkeiten im Frontend:** Reines Vanilla HTML, CSS und modernstes JavaScript.

---

## Installation & Lokaler Start

1. Repository klonen oder herunterladen:
   ```bash
   git clone https://github.com/yasinklausss1/veloxmail.git
   cd veloxmail
   ```

2. Abhängigkeiten installieren:
   ```bash
   npm install
   ```

3. Server starten:
   ```bash
   npm start
   ```

4. Öffne im Browser: `http://localhost:3000`

---

## Kostenloses Cloud-Hosting

Dieses Projekt kann direkt kostenlos auf **Render.com** oder **Koyeb.com** gehostet werden:
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Port:** `3000`
