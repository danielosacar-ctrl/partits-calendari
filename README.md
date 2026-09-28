# Partits al Calendari

Una família tria l'equip (o equips) dels seus fills, prem **un botó** i té tots els partits de la
temporada al seu calendari: Google, iPhone/Mac o Outlook. Cada partit porta:

- convocatòria (per defecte 45 min abans; personalitzable: sense, 30', 45', 1 h, 1 h 30' o el que vulguin)
- temps de després per a estiraments i dutxa (per defecte 30 min)
- ubicació de la pista, que obre Google Maps des del calendari
- a casa o a fora, rival i categoria

El calendari queda **subscrit**: si la Federació canvia un horari, una pista o ajorna un partit, es corregeix sol.

## Com funciona (sense Cloudflare)

```
 Famílies ──► Web (GitHub Pages) ──► Funció "api" (Supabase) ──► Base de dades (Supabase)
 Calendaris (Google/Apple/Outlook) ─────────┘                          ▲
                                                                        │ cada hora
                                        Lector programat (GitHub Actions) ──► basquetcatala.cat
```

- **GitHub Actions** llegeix la web de la FCBQ cada hora (només els equips que alguna família fa servir)
  i cada nit la llista de clubs i equips.
- **Supabase** guarda els partits i serveix els calendaris.
- Quan una família afegeix un equip nou, el calendari s'omple a l'instant si la FCBQ respon; si no,
  surt un avís "⏳ Carregant els partits…" i Supabase demana a GitHub que el llegeixi ara mateix
  (1–2 minuts). Després s'omple sol.
- Si mai falla la lectura, el calendari de les famílies no s'esborra: conserva els partits que ja tenia.

Cost: 0 €. Tot cap dins dels plans gratuïts de GitHub i Supabase.

## Posada en marxa (una vegada, ~20 minuts, tot des del navegador)

### 1. Supabase
1. https://supabase.com → **New project** (nom: `partits-calendari`, regió: Europe West).
2. **SQL Editor** → enganxa el contingut de `supabase/migrations/001_init.sql` → **Run**.
3. Apunta't (Project Settings → API / General):
   - **Project URL** (`https://xxxx.supabase.co`) i **Project ref** (el `xxxx`)
   - **service_role key** (secreta: no la comparteixis)
4. Compte (a dalt a la dreta) → **Access Tokens** → genera un token (per publicar la funció des de GitHub).

### 2. GitHub
1. Crea el repositori **públic** `partits-calendari` i puja-hi tots aquests fitxers
   (inclosa la carpeta oculta `.github`).
2. Settings → Secrets and variables → Actions:
   - **Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`
   - **Variables**: `SUPABASE_PROJECT_REF` (el `xxxx`)
3. Settings → **Pages** → Source: **GitHub Actions**.
4. Crea un token perquè Supabase pugui demanar lectures: github.com/settings/personal-access-tokens →
   Fine-grained → només aquest repositori → permís **Actions: Read and write**.

### 3. Connectar Supabase amb GitHub
Supabase → Edge Functions → **Secrets**:
- `GH_TOKEN` = el token del pas 2.4
- `GH_REPO` = `el-teu-usuari/partits-calendari`

### 4. Engegar
1. GitHub → Actions → **Publicar** → Run workflow (publica la web i la funció).
2. GitHub → Actions → **Llegir FCBQ** → Run workflow amb `mode = clubs` (carrega els ~420 clubs i
   els seus equips; tarda uns 10 minuts).
3. **Prova clau:** si aquest pas surt en verd, la FCBQ deixa llegir des de GitHub i ja està tot.
4. Obre `https://el-teu-usuari.github.io/partits-calendari/`, busca el club, marca l'equip i prem el botó.

A partir d'aquí tot és automàtic. Si un dia la lectura falla, GitHub t'envia un correu.

## Si la FCBQ bloqueja algun servidor
- Si bloqueja **Supabase** però no GitHub: no cal fer res. Per estalviar intents, afegeix el secret
  `LIVE_FETCH=false` a Supabase.
- Si bloqueja **GitHub**: el lector es pot executar des de qualsevol ordinador sempre encès
  (`node scraper/scrape.mjs` amb les dues variables de Supabase) o demanar a la FCBQ
  (activitats@basquetcatala.cat) que ens permeti l'accés. Seria també la via per fer-ho "oficial".

## Lovable
La web és un sol fitxer (`web/index.html`). Si prefereixes redissenyar-la a Lovable, connecta
Lovable a aquest repositori i demana-li que faci servir l'API:
`https://xxxx.supabase.co/functions/v1/api` → `/clubs`, `/club/{id}`, `/teams?t=club-equip`, `/cal.ics?t=…&c=45&p=30&d=90`.

## Fase 2 — funcions per a clubs (pendent)
L'entrenador/a omple la convocatòria de cada partit: equipació (1a / 2a), material (foam roller,
gomes…), nota lliure i convocats. Es guarda a Supabase i apareix a la descripció de l'esdeveniment
al calendari de cada família.

## Estructura
| Fitxer | Què és |
|---|---|
| `web/` | La web/PWA de les famílies |
| `supabase/functions/api/` | Funció que serveix l'API i els calendaris |
| `supabase/functions/_shared/fcbq.js` | Lector de la FCBQ i generador del calendari |
| `supabase/migrations/001_init.sql` | Taules de la base de dades |
| `scraper/scrape.mjs` | Lector programat |
| `.github/workflows/` | Lectura cada hora/nit i publicació automàtica |
| `test/` | Proves (`npm test`) |
