# Schritt für Schritt: Dienstplan online (URL statt nur Mac)

Ziel: Die App läuft unter einer **https://…**-Adresse. Daten liegen in der **Cloud-Datenbank**. Login bleibt **passwortgeschützt**.

Du brauchst: E-Mail-Adresse für drei kostenlose Dienste (**Neon**, **GitHub**, **Vercel**), etwa **30–45 Minuten** beim ersten Mal.

---

## Teil A — Datenbank in der Cloud (Neon)

1. Öffne **https://neon.tech** und registriere dich.
2. **Create project** (Projektname beliebig).
3. Warte, bis das Projekt fertig ist. Kopiere den **Connection string** für Postgres (beginnt mit `postgresql://` oder `postgres://`).
4. **Nichts** davon in GitHub oder Screenshots posten — das ist ein Geheimnis.

### Postgres-Version

- **Einfach:** die **Standard-/empfohlene Version**, die Neon vorschlägt (z. B. **16** oder **17**), auswählen.
- Die App nutzt **Prisma** mit normalem SQL — **alle von Neon angebotenen aktuellen Postgres-Versionen** sind dafür geeignet. Kein Sonderfall nötig.

### Region: AWS oder Azure?

- Neon zeigt dir bei der Region oft **AWS** oder **Azure** als zugrundliegenden Anbieter.
- **Entscheidend:** die **Region geografisch nah** zu euch (z. B. **Frankfurt** / EU), damit die Verbindung von Vercel zur DB **schnell und stabil** ist.
- **AWS vs. Azure** ist für dieses Projekt **egal** — nimm die Region, die **verfügbar** und **nah** ist; technisch kein Unterschied für den Dienstplan.

### „Neon Auth“ aktivieren?

- **Nein** — für dieses Projekt **nicht nötig**.
- Der Login (**`planer@local`** + Passwort) läuft **in der Next.js-App** (JWT-Cookie, `PLANNER_PASSWORD`). Das ist **getrennt** von „Neon Auth“.
- **Neon Auth** wäre ein extra Nutzer-/Login-System von Neon — würde die Architektur verkomplizieren, ohne den aktuellen Plan zu verbessern.

**Weiter mit Teil B auf deinem Mac.**

---

## Teil B — Einmalig: Datenbank füllen (auf deinem Mac, Terminal)

Alles im Ordner **`web`** (da liegt `package.json`).

### Richtiges Programm & Prompt

- Öffne die App **Terminal** (Spotlight: `Cmd + Leertaste`, „Terminal“ tippen, Enter).
- **`(base) timi@Mac ~`** ist nur da, wenn **Anaconda/Miniconda** aktiv ist — **fehlt das, ist das normal.** Stattdessen siehst du z. B. `timi@MacBook-Pro ~ %` oder `timi@Mac ~ %`. Wichtig ist: du kannst **Zeilen eintippen oder einfügen** und mit **Enter** ausführen.

### Wenn bei `export` „nichts passiert“

- **`export` …** meldet bei Erfolg **absichtlich nichts** — keine Zeile, kein „OK“. Die Variable wird nur **im Hintergrund** gesetzt.
- **Prüfen** (nach Schritt 2):
  ```bash
  echo $DATABASE_URL
  ```
  Es sollte **dein** Connection-String (beginnend mit `postgresql://`) erscheinen. Steht die Zeile **leer**, wurde nichts gesetzt (Tippfehler, falsches Terminal-Fenster, Anführungszeichen kaputt).

### Ablauf Schritt für Schritt

1. Terminal öffnen, dann:
   ```bash
   cd "/Users/timi_1/Desktop/Dienstplan Tool/web"
   ```
   Prüfen:
   ```bash
   pwd
   ```
   Soll enden mit `.../Dienstplan Tool/web`. Prüfen, ob `package.json` da ist:
   ```bash
   ls package.json
   ```
   Soll `package.json` ausgeben.

2. Neon-String einsetzen (Zeile in **eine** Zeile, Anführungszeichen behalten):
   ```bash
   export DATABASE_URL="HIER_DEN_NEON_CONNECTION_STRING_EINFÜGEN"
   ```
   (Statt `HIER_…` den echten String von Neon einfügen.)

3. Zufallswert für die Session (einfach ausführen — wieder **ohne** Ausgabe bei Erfolg):
   ```bash
   export SESSION_SECRET="$(openssl rand -base64 32)"
   ```
   Optional prüfen: `echo $SESSION_SECRET` (langer Text = gut).

4. **Dein** Login-Passwort für den Planer (selbst wählen, merken):
   ```bash
   export PLANNER_PASSWORD="DeinSicheresPasswort"
   ```

5. Schema anlegen und befüllen — **hier** kommt **sichtbar** Text (Warnungen, „Done“, „Seed OK“):
   ```bash
   npx prisma db push
   npx prisma db seed
   ```
   Wenn **`npx` nicht gefunden** wird: zuerst im Ordner `web` **`npm install`** einmal ausführen, dann Schritt 5 wiederholen.

6. Wenn am Ende **„Seed OK“** o. Ä. steht: **Teil B ist fertig.**

**Login später auf der Website:** E-Mail **`planer@local`**, Passwort = das, was du bei `PLANNER_PASSWORD` gesetzt hast.

---

## Teil C — Code auf GitHub

1. Auf **https://github.com** einloggen → **Repositories** → **New** (neues Repository).
2. Name z. B. `dienstplan-app`, **ohne** README / .gitignore von GitHub anhaken (Repository **leer** lassen).
3. Auf dem Mac, noch im Ordner **`web`**:

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Dienstplan app"
   git branch -M main
   ```

4. Bei GitHub die beiden Zeilen **„push an existing repository“** anzeigen lassen (HTTPS-URL kopieren), dann **deinen** GitHub-Benutzernamen und **Repo-Namen** einsetzen:

   ```bash
   git remote add origin https://github.com/DEIN_USER/dienstplan-app.git
   git push -u origin main
   ```

5. Wenn der Push durch ist: **Teil C ist fertig.**

---

## Teil D — App bei Vercel veröffentlichen

1. Öffne **https://vercel.com** und melde dich an (am einfachsten **„Continue with GitHub“**).
2. **Add New…** → **Project** → dein Repo **`dienstplan-app`** auswählen → **Import**.
3. **Wichtig — Umgebungsvariablen** (vor dem ersten Deploy oder unter **Settings → Environment Variables**):

   | Name | Wert |
   |------|------|
   | `DATABASE_URL` | Derselbe Neon-Connection-String wie in Teil B |
   | `SESSION_SECRET` | Derselbe Wert wie in Teil B (Terminal: `echo $SESSION_SECRET` — vorher nicht Terminal schließen, oder neu mit `openssl rand -base64 32` erzeugen und **überall gleich** bei Vercel eintragen) |
   | `PLANNER_PASSWORD` | Dasselbe Passwort wie in Teil B |

4. **Framework Preset:** Next.js (sollte automatisch erkannt werden). **Root Directory:** leer lassen — nur nötig, wenn dein Repo **nicht** nur `web` enthält, sondern der Ordner tiefer liegt; dann `web` eintragen.
5. **Deploy** klicken und warten.
6. Wenn grün: **Visit** / die angezeigte **Production URL** öffnen → Login **`planer@local`** + Passwort.

**Teil D ist fertig**, sobald die Seite lädt und du dich einloggen kannst.

---

## Was danach?

| Situation | Was tun |
|-----------|---------|
| **Nur Code geändert** | Änderungen committen & pushen → Vercel baut automatisch neu. |
| **Datenbank-Schema geändert** (Prisma) | Lokal: `export DATABASE_URL="…"` (Neon) → `npx prisma db push` → dann pushen & warten auf Deploy. |
| **Neue Feiertage / Seed erneut** | Lokal mit Neon-`DATABASE_URL`: `npx prisma db seed` (vorsicht: kann bestehende Seed-Daten überschreiben — bei euch meist unkritisch). |
| **Passwort ändern** | In Vercel `PLANNER_PASSWORD` anpassen + **Redeploy**; lokal Seed ggf. mit neuem Passwort erneut (User-Update im Seed) oder Passwort in DB-Tool ändern. |

---

## Kurz-Checkliste

- [ ] Neon-Projekt + Connection String  
- [ ] Lokal `DATABASE_URL`, `SESSION_SECRET`, `PLANNER_PASSWORD` → `db push` + `db seed`  
- [ ] GitHub-Repo + Push aus Ordner `web`  
- [ ] Vercel: Projekt importieren + **drei** Umgebungsvariablen + Deploy  
- [ ] URL testen: `planer@local` + Passwort  

Bei Problemen: Fehlermeldung aus Terminal oder Vercel **Build Logs** kopieren und gezielt nachfragen (ohne Connection-Strings zu teilen).

---

*Ausführlichere technische Notizen: siehe `DEPLOYMENT.md` im gleichen Ordner.*
