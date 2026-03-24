# Dienstplan Web (MVP)

Next.js-App: **ein Planer-Login**, Wochenraster **Plan | Ist** inkl. **Notizen pro Tag**, zentrale **Feiertags-Rubrik** (`/feiertage`), **Mitarbeiter** (`/mitarbeiter`), **Abrechnungsübersicht** (`/abrechnung`), **AT-Arbeitszeit-Hinweise** (heuristisch), **Speichern**, **Woche abschließen** (Zeitkonto), Urlaub **o. U.** bei **U** in der Ist-Zeile.

**Öffentlich per Link** (wie Streamlit Cloud): App auf **Vercel / Railway / Render** deployen, **PostgreSQL** (z. B. Neon) und Umgebungsvariablen setzen — Schritt-für-Schritt: **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

## Voraussetzungen

- Node.js **20+** und npm
- **PostgreSQL** (lokal: Docker, siehe unten; Produktion: Neon, Railway Postgres, …)

## Einrichtung (lokal)

### 1) Datenbank starten

Im Ordner `web/`:

```bash
docker compose up -d
```

(Postgres auf Port **5432**, User/Pass `postgres`/`postgres`, DB `dienstplan` — siehe [`docker-compose.yml`](./docker-compose.yml).)

### 2) Umgebung und Prisma

```bash
cd web
cp .env.example .env
# .env: DATABASE_URL anpassen falls nötig; SESSION_SECRET (mind. 16 Zeichen), PLANNER_PASSWORD setzen
npm install
npx prisma db push
npx prisma db seed
npm run dev
```

Browser: [http://localhost:3000](http://localhost:3000) — Login mit `PLANNER_PASSWORD`.

**Hinweis:** Alte SQLite-Datei `dev.db` wird vom aktuellen Schema **nicht** mehr verwendet. Daten ggf. manuell neu anlegen oder migrieren.

Nach Schema-Updates: `npx prisma db push` und ggf. `npx prisma db seed`.

## Änderungen lokal ansehen (Step-by-Step)

So siehst du Code-Änderungen **auf deinem Mac**, bevor du nach GitHub / Vercel pushst:

| Schritt | Was du tust |
|--------|----------------|
| **1** | **Terminal** öffnen. |
| **2** | In den App-Ordner wechseln: `cd "/Pfad/zu/deinem/Projekt/web"` (Ordner mit `package.json`). |
| **3** | *(Optional, wenn du aus GitHub arbeitest)* Neuesten Stand holen: `git pull`. |
| **4** | *(Nur nach frischem Clone oder wenn sich Abhängigkeiten geändert haben)* `npm install`. |
| **5** | Sicherstellen, dass **`web/.env`** existiert und **`DATABASE_URL`**, **`SESSION_SECRET`** (≥16 Zeichen), **`PLANNER_PASSWORD`** gesetzt sind (wie bei der ersten Einrichtung — oder dieselbe **Neon**-URL wie in Produktion, wenn du gegen die Cloud-DB testen willst). |
| **6** | *(Nur wenn sich `prisma/schema.prisma` geändert hat)* `npx prisma db push` (und ggf. `npx prisma db seed`). |
| **7** | Entwicklungsserver starten: **`npm run dev`**. |
| **8** | Im Browser öffnen: **http://localhost:3000** — mit dem Passwort aus `PLANNER_PASSWORD` anmelden. |
| **9** | **Code ändern** (z. B. in Cursor): Dateien unter `web/src/…` speichern. Next.js **lädt die Seite meist automatisch neu** (Hot Reload). |
| **10** | Wenn etwas „hängt“ oder alt aussieht: im Browser **hart neu laden** (`Cmd+Shift+R`) oder Dev-Server mit `Ctrl+C` beenden und **`npm run dev`** erneut starten. Bei seltsamen Build-Fehlern: Ordner **`web/.next`** löschen, dann wieder `npm run dev`. |

**Kurz:** Einmal `.env` + DB + `npm install`/`db push` wie oben — danach für den Alltag meist nur: **`cd web` → `npm run dev` → http://localhost:3000**.

## Feiertage (zentrale Auswahl)

- Menü **Feiertage** oder `/feiertage`
- Katalog **AT-Salzburg** und **DE-Bayern** (gesetzlich, **2024–2033**) via Seed: [`prisma/holidaysSeed.ts`](./prisma/holidaysSeed.ts) (`date-holidays`, nur `public`)
- Nur **„Im Dienstplan“** angehakte Einträge erscheinen im Raster (Kopfzeile + Badge)

## Abrechnungsübersicht

- `/abrechnung` — Monat oder Datumsbereich; **kein** offizieller Lohnzettel (siehe [`../references.md`](../references.md))

## Zugriff im LAN (ohne Cloud)

Auf dem Rechner, auf dem die App läuft:

```bash
npm run dev -- -H 0.0.0.0 -p 3000
```

Andere Geräte: `http://<IP>:3000`. **PostgreSQL** muss von diesem Rechner erreichbar sein (lokal: `localhost`; Docker: wie in `DATABASE_URL`).

## Produktion / öffentlicher Link

Siehe **[DEPLOYMENT.md](./DEPLOYMENT.md)** (Vercel + Neon, Railway, Render, Docker-Image).

Kurz: `DATABASE_URL`, `SESSION_SECRET`, `PLANNER_PASSWORD` im Hoster setzen, deployen, `prisma db push` bzw. Migration + Seed einmalig ausführen.

## Skripte

| Befehl | Zweck |
|--------|--------|
| `npm run dev` | Entwicklungsserver |
| `npm run build` / `npm start` | Produktion |
| `npx prisma db push` | Schema auf PostgreSQL anwenden |
| `npx prisma db seed` | Planer-User, Demo-MA, Feiertags-Katalog |

## Architektur (Kurz)

- **Next.js 14** (App Router), **Tailwind**, **Prisma** + **PostgreSQL**
- **Session:** JWT in HttpOnly-Cookie (`jose`)
- **API:** u. a. `GET/PUT /api/week`, `GET/PATCH /api/holidays`, `GET/POST /api/employees`

## Hinweise

- **ZAG:** Vorschau = Saldo vor Woche + Ist-WS.
- **Build-Fehler** `Cannot find module './xxx.js'`: Ordner `.next` löschen, neu bauen/starten.
- Excel-Referenz: [`../erzeuge_dienstplan_excel.py`](../erzeuge_dienstplan_excel.py)
