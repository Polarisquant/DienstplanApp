# Dienstplan öffentlich erreichbar machen (wie Streamlit `*.streamlit.app`)

Streamlit-Links funktionieren, weil die App **in der Cloud** liegt und eine **stabile Datenbank** hat.  
Dasselbe Prinzip hier: **Next.js hosten** + **PostgreSQL** (nicht SQLite – die Datei `dev.db` geht auf den meisten Cloud-Anbietern verloren oder ist nicht teilbar).

---

## Kurzüberblick

| Was du willst | Typische Lösung |
|---------------|-----------------|
| Link für Kollegen (einfach, kostenlos starten) | **Vercel** + **Neon** (PostgreSQL) |
| Alles in einem Dienst | **Railway** oder **Render** (Web + Postgres) |
| Eigener Server / NAS | **Docker** + `docker-compose` mit Postgres |

Die App bleibt **mit Passwort geschützt** (ein Planer-Login). So wie bei vielen internen Streamlit-Apps: **URL teilen + Passwort separat** – nicht öffentlich ohne Schutz, wenn echte Personaldaten drin sind (DSGVO).

---

## Variante A: Vercel + Neon (empfohlen, ähnlich „einfach wie Streamlit“)

### 0. Noch kein GitHub? — Repo anlegen und Code hochladen

Du willst die App **nur über eine URL** nutzen, nicht nur lokal. Dafür brauchst du: **GitHub** (Code) + **Neon** (Datenbank) + **Vercel** (Hosting).

**Zwei mögliche Repo-Strukturen:**

| Variante | Beschreibung | Vercel |
|----------|----------------|--------|
| **A (einfach)** | Neues Repo enthält **nur den Inhalt** des Ordners `web` (also `package.json` liegt im **Root** des Repos). | Kein Extra: Root = App. |
| **B** | Repo = ganzer Ordner **„Dienstplan Tool“** inkl. Unterordner `web`. | Unter **Settings → General → Root Directory** den Ordner **`web`** eintragen. |

**Empfehlung:** Variante **A**, wenn du ohnehin nur die Web-App hostest.

**Terminal (Variante A, auf dem Mac):**

```bash
cd "/Users/timi_1/Desktop/Dienstplan Tool/web"
git init
git add .
git commit -m "Initial: Dienstplan Next.js app"
```

Auf [github.com](https://github.com) → **New repository** (z. B. `dienstplan-app`), **ohne** README/License von GitHub erzeugen (leeres Repo).

```bash
git branch -M main
git remote add origin https://github.com/DEIN_USER/dienstplan-app.git
git push -u origin main
```

**Wichtig:** `.env` / `.env.local` stehen in `.gitignore` — **niemals** Passwörter oder `DATABASE_URL` ins Repo committen. Geheimnisse nur bei **Vercel** und **lokal** setzen (siehe unten).

---

### 1. Datenbank (Neon)

1. Account auf [neon.tech](https://neon.tech) anlegen.  
2. Neues Projekt → **Connection string** kopieren (`postgresql://…`).

### 2. Schema in die Cloud-DB schreiben

Auf **deinem Rechner** im Ordner `web`:

```bash
export DATABASE_URL="postgresql://…dein-neon-string…"
npx prisma db push
npx prisma db seed
```

Setze in derselben Shell (oder in `.env`):

```bash
export SESSION_SECRET="$(openssl rand -base64 32)"
export PLANNER_PASSWORD="ein-sicheres-passwort"
```

`seed` legt den Planer-User an (Passwort = `PLANNER_PASSWORD`).

### 3. Vercel

1. Repo auf **GitHub** pushen (oder Vercel CLI).  
2. [vercel.com](https://vercel.com) → **New Project** → Repo `web` als Root **oder** Monorepo mit Root `web`.  
3. **Environment Variables** in Vercel:

   | Name | Wert |
   |------|------|
   | `DATABASE_URL` | Neon-Connection-String |
   | `SESSION_SECRET` | mind. 16 Zeichen, zufällig |
   | `PLANNER_PASSWORD` | Login-Passwort |

4. **Build Command:** `npm run build`  
   **Install:** Standard (`npm install` – `postinstall` führt `prisma generate` aus).

5. Deploy → du erhältst eine URL wie `https://dienstplan-xxx.vercel.app`.

**Checkliste (Reihenfolge):**

1. **Neon:** Projekt anlegen → Connection String `postgresql://…` kopieren (meist mit **SSL**; bei Neon den String aus dem Dashboard übernehmen).
2. **Lokal (einmalig):** Im Ordner `web` mit **diesem** String:
   - `export DATABASE_URL="postgresql://…"`
   - `export SESSION_SECRET="$(openssl rand -base64 32)"`
   - `export PLANNER_PASSWORD="…"` (dein Login-Passwort für `planer@local`)
   - `npx prisma db push` (Schema in Neon anlegen)
   - `npx prisma db seed` (Planer-User + Feiertage + ggf. Demo-Daten)
3. **GitHub:** Repo wie in Abschnitt **0** pushen.
4. **Vercel:** Mit GitHub anmelden → **Add New… → Project** → Repo wählen.
5. **Vercel → Environment Variables** (Production): `DATABASE_URL`, `SESSION_SECRET`, `PLANNER_PASSWORD` **genau wie lokal** (Session-Secret kann derselbe Zufallswert sein).
6. **Vercel Build:** Standard reicht (`npm run build`); bei Monorepo **Root Directory** = `web`.
7. **Deploy** abwarten → **Production URL** öffnen → Login **planer@local** + dein `PLANNER_PASSWORD`.

**Hinweis:** Jeder neue Deploy führt **kein** `db seed` automatisch aus. Seed nur bei Bedarf erneut lokal gegen Neon ausführen.

### Performance (Vercel + Postgres) — weniger „klobig“

Lokal ist alles im selben Rechner; **in der Cloud** kommen dazu: Netzwerklatenz, **Serverless-Cold-Starts** und die **Entfernung** zwischen Vercel-Region und Datenbank.

| Maßnahme | Warum |
|----------|--------|
| **Neon: Connection Pooling** | Jede Vercel-Funktion soll kurzlebige Verbindungen über den **Pooler** nutzen. Im Neon-Dashboard gibt es oft zwei URLs: **„direct“** und **„pooled“** (Host enthält z. B. `pooler` oder `-pooler`). Für `DATABASE_URL` in **Vercel (Production)** die **gepoolte** Variante verwenden und ggf. `?sslmode=require` beibehalten. Ohne Pool: viele TLS-Handshakes + langsame Requests. |
| **Gleiche Region** | Vercel-Projekt z. B. **`fra1`** (Frankfurt) wählen, wenn die Neon-DB in **EU** liegt — sonst jede API-Runde **+80–150 ms** und mehr. |
| **Cold Start** | Die erste Anfrage nach längerer Ruhe kann **1–3 Sekunden** brauchen (Funktion startet neu). Danach sind warme Requests deutlich schneller — das ist normal bei Serverless. |
| **App-Code** | `GET /api/week` bündelt Kontostände aller Mitarbeitenden in **wenigen DB-Abfragen** (statt einer Kette pro Person) und lädt Feiertage/Ferien/Vorwoche **parallel**. `PUT /api/week` lädt Ist-Zellen vor/nach dem Speichern **je einmal** für die ganze Woche (statt N Queries pro Mitarbeiter), führt **Upserts parallel** aus und bündelt Urlaubs-Saldo-Updates. |

### 4. Nach Schema-Änderungen

Lokal gegen Neon:

```bash
DATABASE_URL="…" npx prisma db push
```

Dann erneut deployen (oder nur redeploy, wenn nur Code geändert wurde).

---

## Variante B: Railway / Render

- Neues Projekt mit **Node** + **PostgreSQL**-Plugin.  
- `DATABASE_URL` wird meist automatisch gesetzt.  
- Build: `npm install && npm run build`  
- Start: `npx prisma db push && npm start` (oder Start-Command in der UI so setzen).  
- `SESSION_SECRET` und `PLANNER_PASSWORD` manuell als Umgebungsvariablen setzen.  
- Einmalig lokal oder über SSH: `DATABASE_URL=… npx prisma db seed`.

---

## Variante C: Docker (eigener Server)

**Nur Postgres:**

```bash
docker compose up -d
cp .env.example .env
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dienstplan
npx prisma db push && npx prisma db seed
npm run dev
```

**App im Container** (Postgres separat oder gleiches Compose erweitern):

```bash
docker build -t dienstplan-web .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://…" \
  -e SESSION_SECRET="…" \
  -e PLANNER_PASSWORD="…" \
  dienstplan-web
```

---

## Hinweis: Früher SQLite?

Das Projekt nutzt jetzt **PostgreSQL** (`prisma/schema.prisma`).  
Alte `dev.db`-Daten werden **nicht** automatisch übernommen.  
Optionen: Stammdaten neu anlegen oder einmalig exportieren/importieren (manuell).

---

## Sicherheit (kurz)

- **HTTPS** nutzt der Hoster (Vercel/Railway) automatisch.  
- **Passwort** nicht im Repo; nur in Umgebungsvariablen.  
- Für echte Produktion: starke Passwörter, ggf. IP-Sperre/VPN, DSGVO mit Betrieb klären.

---

## Link „für jeden“ ohne Login?

Das ist **nicht** empfehlenswert für Personaldaten.  
Wenn du nur eine **Demo** willst: separates Projekt mit Testdaten + schwachem Demo-Passwort auf der Login-Seite vermerken – technisch bleibt der Login bestehen.
