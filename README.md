# NudeNet API

Multi-Service NSFW-Detection-Plattform mit Bild- und Video-Analyse, KI-gestuetztem Scoring, Multi-Tenancy, API-Key-Management und Admin-Dashboard.

---

## Services

| Service | Technologie | Beschreibung | Default-Port |
|---------|------------|--------------|:------------:|
| **api** | FastAPI | NSFW-Detection, Censoring (Bild+Video), Batch, Rate-Me, CLIP (Embed/Compare/Tag), Moderate, Anonymize, Pose, Video-Scenes | 8000 |
| **auth** | FastAPI | Multi-Tenant JWT-Auth, API-Keys (Master/Personal, gehashed), Plans, Usage-Logging, Webhooks, Detection-Ergebnisse | 8001 |
| **studio** | Next.js 16 + Mantine 9 | Admin-Dashboard (22 Seiten), Upload-UI, Demo, i18n (EN/DE), Toast-Notifications, Error Boundaries | 3000 |
| **db** | PostgreSQL / SQLite | PostgreSQL in Docker, SQLite lokal. Gemeinsame SQLAlchemy-Schicht, Alembic-Migrationen | 5432 |
| **redis** | Redis | Optional (`docker-compose.redis.yml`), 3-stufiges Rate-Limiting + Result-Cache | 6379 |

---

## Setup

### Voraussetzungen (System)

| Tool | Zweck | Installation |
|------|-------|-------------|
| ffmpeg | Video-Censoring (H.264-Output) | `brew install ffmpeg` / `apt install ffmpeg` |
| p7zip | .7z-Model-Extraktion | `brew install p7zip` / `apt install p7zip` |

### 1. Environment anlegen

```bash
make env
```

Interaktives Setup -- generiert `.env.local` (lokal, SQLite) und `.env.prod` (Docker, PostgreSQL) mit zufaelligen Secrets.

### 2a. Lokal (ohne Docker)

```bash
make install      # venvs erstellen + Dependencies installieren
make get-models   # ML-Modelle vorab herunterladen (optional, passiert auch automatisch)
make dev-local    # alle Services starten (SQLite)
```

Standardmaessig wird das genauere EraX-YOLO11m-Modell geladen. Fuer Systeme
mit weniger RAM/CPU kann in der Environment `ERAX_MODEL_SIZE=s` oder `n`
gesetzt werden. NudeNet nutzt weiterhin das genauere offizielle 640m-Modell.
Mit `model=ensemble` laufen NudeNet und EraX auf demselben Input. Ueberlappende
Treffer werden ueber ein gemeinsames `concept` fusioniert; `sources` zeigt,
welche Modelle den Treffer stuetzen. Studio und Demo verwenden fuer „Both“
automatisch diesen einzelnen Request.

Einzelne Services:

```bash
make dev-api      # nur API auf :8000
make dev-auth     # nur Auth auf :8001
make dev-studio   # nur Studio auf :3000
```

### 2b. Docker

```bash
make dev-docker   # alle Services (PostgreSQL, nutzt .env.prod)
make logs         # Logs anzeigen
make down         # stoppen
```

Mit Redis (optional, fuer persistentes Rate-Limiting + Cache):

```bash
docker compose -f docker-compose.yml -f docker-compose.redis.yml up --build
```

### Alle Make-Befehle

| Befehl | Beschreibung |
|--------|-------------|
| `make env` | Interaktives Setup -- generiert `.env.local` + `.env.prod` |
| `make install` | venvs erstellen, Python-Dependencies installieren |
| `make get-models` | ML-Modelle herunterladen (auch Auto-Download beim API-Start) |
| `make optimize-models` | Modelle nach ONNX + INT16 konvertieren |
| `make dev-local` | Alle Services lokal starten (SQLite, kein Docker) |
| `make dev-api` | Nur API starten |
| `make dev-auth` | Nur Auth starten |
| `make dev-studio` | Nur Studio starten |
| `make dev-docker` | Alle Services in Docker starten (PostgreSQL, `.env.prod`) |
| `make down` | Docker stoppen |
| `make logs` | Docker-Logs anzeigen |
| `make migrate` | SQLite nach PostgreSQL migrieren |
| `make reset-db` | Lokale SQLite-DB loeschen |
| `make clean` | Docker-Container + Volumes entfernen |

---

## Authentication

### Admin-Login

Beim Start wird automatisch ein Admin-User aus den `.env`-Variablen `ADMIN_EMAIL` und `ADMIN_PASSWORD` erstellt.

```bash
curl -X POST http://localhost:8001/login \
  -d "username=admin@erohub.local&password=admin1234"
```

Response enthaelt `access_token` und `refresh_token`.

### API-Keys

Admins/Premium-User koennen API-Keys erstellen:

```bash
TOKEN="<access_token>"

# Key erstellen
curl -X POST http://localhost:8001/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app"}'

# Keys auflisten
curl http://localhost:8001/api-keys \
  -H "Authorization: Bearer $TOKEN"
```

API-Keys werden gehashed gespeichert (`key_hash` SHA-256). Der Klartext-Key wird nur einmal bei Erstellung zurueckgegeben.

### Rollen

| Rolle | Beschreibung |
|-------|-------------|
| `admin` | Voller Zugriff, User-Management, API-Keys |
| `customer` | API-Keys erstellen, erweiterte Features |
| `premium` | API-Keys erstellen, Premium-Features |
| `user` | Basis-Zugriff |
| `free` | Eingeschraenkter Zugriff (Default bei Registrierung) |

---

## Multi-Tenancy

Bei der Registrierung kann ein `tenant_name` angegeben werden. Der erste User eines neuen Tenants wird automatisch Admin.

```bash
curl -X POST http://localhost:8001/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@firma.de","password":"pw","tenant_name":"firma-ag"}'
```

### Plans

| Plan | Max Users | Max API-Keys | Rate-Limit (req/h) |
|------|:---------:|:------------:|:-------------------:|
| free | 1 | 1 | 100 |
| starter | 5 | 5 | 1.000 |
| business | 25 | 25 | 10.000 |
| enterprise | unbegrenzt | unbegrenzt | unbegrenzt |

Admins koennen Custom-Overrides pro Tenant setzen (`max_users`, `max_keys`, `rate_limit`).

### API-Key-Typen

- **Personal Keys** -- gehoeren einem User
- **Master Keys** -- gelten fuer den gesamten Tenant

---

## API-Endpoints

### Detection API (Port 8000)

Swagger UI: http://localhost:8000/docs

#### Authentifiziert (API-Key als Bearer Token)

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/classify` | POST | Detection + Age + Deepfake + Clothing (CLIP) |
| `/censor` | POST | NSFW-Regionen mit Gaussian Blur zensieren, PNG zurueck |
| `/batch` | POST | ZIP/RAR-Archiv; mit `async=true` als Background-Job |
| `/rateme` | POST | Multi-Faktor Sexiness-Scoring (6 Faktoren) |
| `/moderate` | POST | All-in-One Moderation: allow/flag/block + Confidence + Reasons |
| `/embed` | POST | CLIP-Embedding (768-dim Vektor) fuer Downstream-Anwendungen |
| `/compare` | POST | Cosine-Similarity zweier Bilder via CLIP |
| `/tag` | POST | Zero-Shot Labeling mit frei waehlbaren Prompts |
| `/anonymize` | POST | Gesichtserkennung + Gaussian Blur (MediaPipe) |
| `/faces` | POST | Nur Gesichtserkennung (ohne Blur) |
| `/pose` | POST | Body-Pose-Estimation (33 Keypoints, MediaPipe) |
| `/images` | GET | Gespeicherte Bilder auflisten |
| `/images/{category}/{id}` | GET | Bild abrufen (Auth) |
| `/storage/{category}/{filename}` | GET | Bild abrufen (Public, UUID-basiert) |

#### Video (Auth -- unbegrenzte Dauer/Groesse/Frames)

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/video/classify` | POST | Frame-Analyse; mit `async=true` als Background-Job |
| `/video/censor` | POST | Video-Blur/H.264; mit `async=true` als Background-Job |
| `/video/scenes` | POST | Highlight-Video; mit `async=true` als Background-Job |
| `/jobs/{id}` | GET | Tenant-isolierter Job-Status und JSON-Ergebnis |
| `/jobs/{id}/output` | GET | Binaeren Output eines fertigen Video-Jobs laden |

#### Demo (kein Auth, IP-basiertes Rate-Limiting)

| Endpoint | Methode | Limit |
|----------|:-------:|-------|
| `/demo/classify` | POST | 10 Bilder/h pro IP |
| `/demo/batch` | POST | 1 Archiv/h, max 10 Bilder |
| `/demo/rateme` | POST | 10/h pro IP |
| `/demo/moderate` | POST | 10/h pro IP |
| `/demo/embed` | POST | 10/h pro IP |
| `/demo/compare` | POST | 10/h pro IP (zaehlt 2x) |
| `/demo/tag` | POST | 10/h pro IP |
| `/demo/anonymize` | POST | 10/h pro IP |
| `/demo/faces` | POST | 10/h pro IP |
| `/demo/pose` | POST | 10/h pro IP |
| `/demo/video/classify` | POST | max 30s, 20 Frames |
| `/demo/video/scenes` | POST | max 30s, 20 Frames |
| `/demo/limits` | GET | Verbleibende Limits abfragen |

#### Info (kein Auth)

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/models` | GET | Verfuegbare Modelle |
| `/health` | GET | Service-Health + Worker-Pool-Status |

#### Beispiele

```bash
API_KEY="<api_key>"

# Classify mit NudeNet (default)
curl -X POST http://localhost:8000/classify \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# Classify mit EraX
curl -X POST "http://localhost:8000/classify?model=erax" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# Ensemble: beide Detektoren mit einem Upload
curl -X POST "http://localhost:8000/classify?model=ensemble" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# Censor
curl -X POST http://localhost:8000/censor \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg" \
  -o censored.png

# Censor mit bestimmten Labels
curl -X POST http://localhost:8000/censor \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg" \
  -F "labels=FEMALE_BREAST_EXPOSED,BUTTOCKS_EXPOSED" \
  -o censored.png

# Batch (ZIP-Archiv)
curl -X POST http://localhost:8000/batch \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@images.zip"

# Batch asynchron starten (HTTP 202)
curl -X POST "http://localhost:8000/batch?async=true&model=ensemble" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@images.zip"

# Status/Ergebnis abfragen
curl http://localhost:8000/jobs/<job_id> \
  -H "Authorization: Bearer $API_KEY"

# Rate-Me
curl -X POST http://localhost:8000/rateme \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# Moderate (All-in-One)
curl -X POST http://localhost:8000/moderate \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# CLIP Embedding
curl -X POST http://localhost:8000/embed \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# Zwei Bilder vergleichen
curl -X POST http://localhost:8000/compare \
  -H "Authorization: Bearer $API_KEY" \
  -F "file1=@photo1.jpg" \
  -F "file2=@photo2.jpg"

# Zero-Shot Tagging
curl -X POST http://localhost:8000/tag \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg" \
  -F "labels=sexy pose, casual photo, outdoor scene, portrait"

# Gesichter anonymisieren
curl -X POST "http://localhost:8000/anonymize?blur_radius=40" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg" \
  -o anonymized.png

# Pose-Estimation
curl -X POST http://localhost:8000/pose \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"

# Video classify (1 Frame/Sekunde)
curl -X POST "http://localhost:8000/video/classify?model=nudenet&fps=1&max_frames=100" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@video.mp4"

# Video censor
curl -X POST "http://localhost:8000/video/censor?model=nudenet&fps=2&blur_radius=30" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@video.mp4" \
  -o censored.mp4

# Erotische Szenen extrahieren
curl -X POST "http://localhost:8000/video/scenes?fps=2&min_scene_duration=2&scene_padding=1" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@video.mp4" \
  -o highlights.mp4
```

### Auth API (Port 8001)

Swagger UI: http://localhost:8001/docs

#### Oeffentlich

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/register` | POST | User registrieren |
| `/login` | POST | Login (OAuth2 form) |
| `/refresh` | POST | Token erneuern |
| `/plans` | GET | Plan-Details anzeigen |

#### Authentifiziert (JWT)

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/me` | GET | Aktueller User |
| `/tenant` | GET | Eigener Tenant |
| `/api-keys` | GET/POST | API-Keys verwalten |
| `/api-keys/{id}` | DELETE | Key widerrufen |
| `/usage/stats` | GET | Nutzungsstatistiken |
| `/detections` | GET | Detection-Ergebnisse |
| `/role-limits` | GET | Rollen-Limits |
| `/webhooks` | GET/POST | Webhook-Endpoints verwalten |
| `/webhooks/{id}` | PATCH/DELETE | Webhook bearbeiten/loeschen |
| `/webhooks/{id}/deliveries` | GET | Webhook-Zustellungen einsehen |

#### Admin

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/admin/users` | GET/POST | User auflisten/erstellen |
| `/admin/users/{id}/role` | PATCH | Rolle aendern |
| `/admin/users/{id}/deactivate` | PATCH | User deaktivieren |
| `/admin/users/{id}/activate` | PATCH | User aktivieren |
| `/admin/users/{id}` | DELETE | User loeschen |
| `/admin/users/{id}/details` | GET | Detaillierte User-Informationen |

#### Super Admin (Default-Tenant)

| Endpoint | Methode | Beschreibung |
|----------|:-------:|-------------|
| `/admin/tenants` | GET/POST | Tenants auflisten/erstellen |
| `/admin/tenants/{id}` | PATCH/DELETE | Tenant bearbeiten/loeschen |
| `/admin/tenants/{id}/users` | GET | Users eines Tenants |
| `/admin/tenants/{id}/usage` | GET | Usage eines Tenants |
| `/admin/tenants/{id}/detections` | GET | Detections eines Tenants |
| `/admin/tenants/{id}/keys` | GET | API-Keys eines Tenants |
| `/admin/all-users` | GET | Alle User (ueber Tenants hinweg) |
| `/admin/users/{id}/tenant` | PATCH | User einem Tenant zuweisen |
| `/demo/stats` | GET | Demo-Statistiken (IP-Tracking, Request-Counts) |

---

## ML-Modelle

### NudeNet (default)

- YOLOv8m, ONNX-Format, 98.7 MB
- 18 Labels mit covered/exposed-Unterscheidung:
  `FEMALE_BREAST_EXPOSED`, `FEMALE_BREAST_COVERED`, `FEMALE_GENITALIA_EXPOSED`, `FEMALE_GENITALIA_COVERED`, `MALE_GENITALIA_EXPOSED`, `MALE_GENITALIA_COVERED`, `BUTTOCKS_EXPOSED`, `BUTTOCKS_COVERED`, `ANUS_EXPOSED`, `ANUS_COVERED`, `BELLY_EXPOSED`, `BELLY_COVERED`, `ARMPITS_EXPOSED`, `ARMPITS_COVERED`, `FEET_EXPOSED`, `FEET_COVERED`, `FACE_FEMALE`, `FACE_MALE`

### EraX Anti-NSFW v1.1

- YOLO11s, PyTorch-Format, 18.3 MB
- 5 Labels (nur exposed):
  `NIPPLE`, `PENIS`, `VAGINA`, `ANUS`, `MAKE_LOVE`

### CLIP ViT-B/32

- 350 MB, lazy-loaded beim ersten Aufruf
- Wird fuer multiple Analysen in einem einzigen Pass verwendet:
  - **Sexiness-Scoring** -- prompt-basierte KI-Wahrnehmung
  - **Altersschaetzung** -- Klassen: `minor`, `young_adult`, `adult`, `middle_aged`, `senior`
  - **Deepfake-Erkennung** -- Stufen: `likely_real`, `possibly_fake`, `likely_fake`
  - **Kleidungserkennung** -- `formal`, `casual`, `swimwear`, `lingerie`, `minimal`, `nude` + `exposure_level`
  - **Embedding-Extraktion** -- 768-dim Vektoren fuer Similarity-Search
  - **Zero-Shot Tagging** -- beliebige Labels ohne Training
- Minor-Safety: bei erkannten Minderjaehrigen wird der Rate-Me-Score auf 0 gesetzt, Kategorie "blocked"

### MediaPipe

- Face Detection (Full-Range-Modell) -- Gesichtserkennung + Anonymisierung
- Pose Estimation (33 Keypoints) -- Koerperhaltung, Postur-Analyse

### Model-Management

- Automatischer Download beim ersten API-Start, falls Modelle fehlen
- Smart Resolution: lokal -> komprimiert (.7z) -> Legacy-Pfad -> Online-Download
- NudeNet Tempfile auf `/dev/shm` (Linux) fuer schnellere Inference
- `make get-models` laedt Modelle vorab herunter
- `make optimize-models` konvertiert nach ONNX + INT16
- Gespeichert in `MODEL_DIR` (`./api/models` lokal, `/app/models` in Docker)

---

## Rate-Me-Scoring

Multi-Faktor Sexiness-Bewertung mit 6 gewichteten Faktoren:

| Faktor | Gewicht | Beschreibung |
|--------|:-------:|-------------|
| CLIP Sexiness | 38% | Prompt-basierte KI-Wahrnehmung |
| Eroticism | 27% | NudeNet (18 Labels) + EraX (5 Labels), zusammengefuehrt, 14 Buendel |
| Image Quality | 12% | Schaerfe, Aufloesung, Helligkeit, Kontrast (PIL) |
| Composition | 10% | Gesicht, Framing, Pose-Heuristik, Zentrierung |
| Aesthetics | 8% | Saettigung, Farbvielfalt, Rauschen |
| Age Attractiveness | 5% | Peak 20-28, Minor-Safety: Score = 0 |

### Ergebnis-Kategorien

`safe`, `mild`, `suggestive`, `sensual`, `erotic`, `explicit`, `extreme`, `blocked`

---

## Moderate (All-in-One)

Kombiniert alle Analysen in einem einzigen Report:

- Fuehrt NudeNet + EraX + CLIP parallel aus
- Liefert Aktionsempfehlung: `allow`, `flag`, `block`
- Confidence-Score + Begruendungen (z.B. "explicit nudity detected", "minor risk flagged")
- Vollstaendiger Rate-Me-Score + CLIP-Analyse + Detection-Liste

Block-Regeln: Minor erkannt, extreme Kategorie, oder sexual_act Label >0.7 Confidence.

---

## Video-Verarbeitung

- Frame-Extraktion via OpenCV mit konfigurierbarem FPS
- Video-Censoring mit Gaussian Blur + Frame-Interpolation (bisect-optimiert)
- Szenen-Extraktion: erkennt erotische Szenen und schneidet sie als Highlight-Video zusammen
- H.264-Re-Encoding via ffmpeg fuer Browser-Kompatibilitaet
- Auth-User: unbegrenzte Dauer/Groesse/Frames
- Demo: max 30s, 20 Frames

---

## Worker Pool

Die HTTP-Inferenz laeuft thread-basiert im API-Prozess. `ML_WORKERS=0` ist
deshalb der empfohlene und in Docker verwendete Default. Der experimentelle
Prozess-Pool ist fuer kuenftige Queue-Jobs vorgesehen und sollte fuer den
aktuellen HTTP-Pfad nicht aktiviert werden.

| ML_WORKERS | Modus | RAM-Verbrauch |
|:----------:|-------|:-------------:|
| 0 | Inline (gleicher Prozess) | ~2 GB |
| 1+ | Experimenteller separater Pool (HTTP derzeit nicht angebunden) | zusaetzlich |

### CPU vs. GPU

Das Default-Setup nutzt **CPU-only PyTorch** (~200 MB). Das spart ~2.5 GB Docker-Image-Groesse gegenueber der GPU-Variante.

**Fuer GPU-Beschleunigung (NVIDIA CUDA):**

Es gibt ein fertiges Override `docker-compose.gpu.yml`. Kein manuelles Editieren
von `requirements.txt`, `Dockerfile` oder `docker-compose.yml` mehr noetig.

1. Host vorbereiten (NVIDIA-Treiber + Container-Toolkit):

```bash
# Ubuntu/Debian
apt install nvidia-container-toolkit
systemctl restart docker
```

2. Mit dem GPU-Override starten (baut das CUDA-Image, `--build` noetig):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build

# mit Redis:
docker compose -f docker-compose.yml -f docker-compose.redis.yml -f docker-compose.gpu.yml up --build
```

Das Override setzt fuer den `api`-Service den Build-Arg `TORCH_VARIANT=cuda`
(ersetzt CPU-`torch`/`torchvision` durch den CUDA-Build und tauscht
`onnxruntime` gegen `onnxruntime-gpu`), die GPU-Reservierung
(`deploy.resources.reservations.devices`), die `NVIDIA_*`-Env sowie den
`LD_LIBRARY_PATH`, ueber den `onnxruntime-gpu` die vom CUDA-`torch`-Wheel
gebuendelten CUDA/cuDNN-Libs findet.

**Beschleunigt werden alle drei Modelle:** EraX (YOLO) und CLIP ueber CUDA-`torch`,
NudeNet ueber `onnxruntime-gpu` (nutzt dieselben CUDA/cuDNN-Libs).

Optional einen zum Treiber passenden CUDA-Wheel-Channel pinnen:

```bash
TORCH_CUDA_INDEX=https://download.pytorch.org/whl/cu124 \
  docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

> **Hinweis:** Der GPU-Pfad laesst sich nur auf einem echten NVIDIA-Host bauen und
> testen. `onnxruntime-gpu` und das CUDA-`torch`-Wheel muessen denselben CUDA-/cuDNN-Major
> nutzen (aktuell CUDA 12 / cuDNN 9). Findet `onnxruntime-gpu` die cuDNN-Libs nicht,
> faellt NudeNet still auf CPU zurueck — dann den `LD_LIBRARY_PATH` im Override gegen
> den tatsaechlichen site-packages-Pfad im Image pruefen. Der Standard-Build bleibt
> **CPU-only**; `requirements.txt` ist unveraendert.

**Performance-Vergleich (ungefaehr):**

| Modell | CPU (4 Kerne) | GPU (RTX 3060) |
|--------|:-------------:|:--------------:|
| NudeNet 640m | ~200 ms | ~30 ms |
| EraX YOLO11s | ~150 ms | ~20 ms |
| CLIP ViT-B/32 | ~300 ms | ~50 ms |
| Gesamt /classify | ~500 ms | ~100 ms |

---

## Caching

2-stufiger Result-Cache (gleiche Bilddaten + gleiches Modell = Cache-Hit):

| Stufe | Backend | Beschreibung |
|:-----:|---------|-------------|
| 1 | Redis | Primaer (wenn `REDIS_URL` gesetzt), TTL-basiert |
| 2 | Datenbank | Fallback, `detection_cache`-Tabelle |

- Cache-Key: `sha256(image) + model_version + endpoint`
- Usage wird trotzdem geloggt (Kunden zahlen auch bei Cache-Hit)
- API-Key-Validierung hat eigenen In-Memory LRU-Cache (30s TTL, 1000 Eintraege)

---

## Rate-Limiting

3-stufiges System, absteigend nach Prioritaet:

| Stufe | Backend | Beschreibung |
|:-----:|---------|-------------|
| 1 | Redis | Optional, persistent |
| 2 | Datenbank | Usage-Logs werden immer geschrieben, beim Start wiederhergestellt |
| 3 | Memory | Letzter Fallback |

- Rate-Limits gelten pro API-Key, basierend auf dem Tenant-Plan
- Demo-Endpoints: IP-basiert (10 Bilder/h, 1 Archiv/h), X-Forwarded-For-aware
- Ohne Redis funktioniert alles -- dann greifen DB- und Memory-Fallback

---

## Webhooks

Event-basierte Benachrichtigungen fuer API-Ergebnisse:

- Trigger: `classify`, `censor`, `rateme`, `moderate`, `batch`, `video`
- HMAC-SHA256 signierte Payloads
- Retry mit exponentiellem Backoff (sofort, 1min, 5min, 30min)
- Konfigurierbar pro API-Key ueber Studio oder Auth-API
- Zustellungshistorie einsehbar
- Async-Jobs senden `job.completed` oder `job.failed` an Webhooks mit Trigger `any`

### Async-Job-Antwort

`/batch` und alle authentifizierten `/video/*`-Verarbeitungsendpoints akzeptieren
`async=true` und antworten nach dem sicheren Speichern des Uploads mit HTTP 202:

```json
{
  "job_id": "d6ad4be8-...",
  "status": "queued",
  "status_url": "/jobs/d6ad4be8-..."
}
```

Der Status durchlaeuft `queued`, `running` und `succeeded` oder `failed`.
Video-Jobs stellen nach Erfolg zusaetzlich `output_url` bereit. Job-Status und
Output sind auf den Tenant des verwendeten API-Keys beschraenkt.

---

## Studio (Dashboard)

Next.js 16 + Mantine 9 Admin-Dashboard mit i18n (EN/DE).

### Seiten

| Seite | Beschreibung |
|-------|-------------|
| Login | Anmeldung |
| Register | Registrierung (Free-Tier CTA) |
| Dashboard | Echte Statistiken aus Usage/Tenant |
| Upload | Classify/Censor, Bild+Video+Archiv, API-Key-Dropdown |
| Rate Me | 6-Faktor-Anzeige, RingProgress, CLIP-Details |
| Moderate | All-in-One Moderation mit Allow/Flag/Block Badge |
| Embed | CLIP-Embedding + Bild-Vergleich (Cosine-Similarity) |
| Tag | Zero-Shot Labeling mit Custom-Prompts |
| Anonymize | Gesichtserkennung + Blur mit einstellbarem Radius |
| Pose | Body-Pose-Estimation mit Keypoint-Tabelle |
| Scenes | Video-Szenen-Extraktion mit Highlight-Download |
| Usage | Aufschluesselung pro API-Key |
| API-Keys | CRUD mit ConfirmDialog, Master/Personal |
| Webhooks | CRUD, Trigger-Konfiguration, Zustellungshistorie |
| Detections | Expandierbare Tabelle mit Bild-Previews |
| Users | CRUD, Rollen-Management, ConfirmDialog, Toast-Notifications |
| Tenants | CRUD, Plan-Management, Custom Limits, Toast-Notifications |
| Demo Stats | IP-Tracking, Request-Counts (nur Super Admin) |
| Demo | Oeffentlich, 6 Modi (Classify/RateMe/Censor/Moderate/Tag/Anonymize) |
| Models | Verfuegbare ML-Modelle |

### Features

- Result-Image-Download: Canvas-Overlay mit Detection-Boxen + Labels-Panel
- CLIP-Analyse-Cards (Alter, Deepfake, Kleidung) in allen Ergebnis-Ansichten
- ProcessingQueue-Komponente fuer Langzeit-Requests (Timer, Cancel, Progress)
- Toast-Notifications (Erfolg/Fehler) fuer alle Mutationen
- Error Boundaries (error.tsx, global-error.tsx)
- Shared `useApiKeys()` Hook (8 Seiten, keine Code-Duplizierung)
- Dark/Light Mode + Collapsible Sidebar
- Dynamic Imports fuer Canvas-Utilities (nur bei Download geladen)

---

## Architektur

- **Key-Validierung**: API validiert Keys gegen Auth-Service mit LRU-Cache (30s TTL)
- **Internal Auth**: Shared Secret (`INTERNAL_AUTH_SECRET`) zwischen API <-> Auth fuer interne Endpoints
- **Usage-Logging**: Fire-and-forget Background-Tasks mit Task-Registry (kein GC-Verlust)
- **Detection-Results**: In DB gespeichert mit Tenant/Key-Zuordnung
- **Image Pipeline**: Einmaliges Dekodieren -- `preprocess_full()` liefert detect_img + full_img
- **Shared DB**: Gemeinsames DB-Paket (`db/src/`) mit SQLAlchemy-Modellen
- **Migrationen**: Alembic in `db/migrations/`
- **Error-Handling**: Strukturierte JSON-Fehlerantworten mit Request-ID-Tracking
- **CORS**: Immer aktiv, faellt auf `["*"]` zurueck wenn keine Origins konfiguriert
- **1 Uvicorn-Worker**: Modell-Singletons bleiben in einem Prozess; unabhängige Modelle laufen intern parallel
- **Demo-Account**: Demo-Tenant + System-User werden beim Start automatisch geseeded

---

## Environment Variables

### API Service

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `STORAGE_DIR` | Bildspeicherung | `/app/storage` |
| `MODEL_DIR` | ML-Model-Pfad | `/app/models` |
| `ERAX_MODEL_SIZE` | EraX-Groesse: `n`, `s` oder `m` (genauester Default) | `m` |
| `ERAX_MODEL_REVISION` | Gepinnter Hugging-Face-Commit fuer reproduzierbare Downloads | `90878ab...` |
| `API_PORT` | Detection API Port | `8000` |
| `API_HOST` | Bind-Adresse | `0.0.0.0` |
| `AUTH_SERVICE_URL` | API -> Auth Kommunikation | `http://localhost:8001` |
| `INTERNAL_AUTH_SECRET` | Shared Secret fuer interne Endpoints | -- (required) |
| `ML_WORKERS` | Worker-Pool-Groesse (0=inline) | `0` |
| `MAX_UPLOAD_SIZE` | Upload-Limit (Bytes) | `52428800` (50MB) |
| `MAX_VIDEO_SIZE` | Video-Upload-Limit (Bytes) | `209715200` (200MB) |
| `MAX_VIDEO_DURATION` | Max. Video-Laenge (Sekunden) | `300` |
| `REDIS_URL` | Redis-URL (optional) | -- |
| `CORS_ORIGINS` | Erlaubte Origins (kommagetrennt) | `["*"]` wenn leer |
| `CORS_ORIGIN_REGEX` | Regex fuer erlaubte Origins | -- |
| `CACHE_ENABLED` | Result-Cache aktivieren | `true` |
| `CACHE_TTL_DAYS` | Cache-Lebensdauer | `30` |
| `TRUSTED_PROXIES` | Vertrauenswuerdige Proxy-IPs (fuer X-Forwarded-For) | -- |

### Auth Service

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `AUTH_PORT` | Auth Service Port | `8001` |
| `JWT_SECRET` | JWT Signing Secret | -- (required, Startup-Fehler wenn fehlend) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token-Ablauf | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh-Token-Ablauf | `7` |
| `ADMIN_EMAIL` | Seed-Admin E-Mail | -- |
| `ADMIN_PASSWORD` | Seed-Admin Passwort | -- |
| `INTERNAL_AUTH_SECRET` | Shared Secret (muss mit API uebereinstimmen) | -- (required) |
| `CORS_ORIGINS` | Erlaubte Origins | `["*"]` wenn leer |

### Datenbank

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `DATABASE_URL` | DB Connection String | SQLite lokal, PostgreSQL Docker |
| `DB_USER` | PostgreSQL User | `erohub` |
| `DB_PASSWORD` | PostgreSQL Passwort | -- (required in Docker) |
| `DB_NAME` | PostgreSQL Datenbank | `erohub` |
| `DB_PORT` | PostgreSQL Port | `5432` |
| `DB_DATA_DIR` | PostgreSQL Daten-Pfad | `./db/data` |

### Studio

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `STUDIO_PORT` | Studio Port | `3000` |
| `NEXT_PUBLIC_AUTH_URL` | Studio -> Auth | `http://localhost:8001` |
| `NEXT_PUBLIC_API_URL` | Studio -> API | `http://localhost:8000` |

---

## Datenbank

- **Lokal**: SQLite unter `db/data/auth.db` (automatisch erstellt)
- **Docker**: PostgreSQL, Daten unter `db/data/` (bind-mount, portierbar)

### SQLite nach PostgreSQL migrieren

```bash
make migrate
```

### DB zuruecksetzen

```bash
make reset-db       # loescht SQLite, Admin wird beim Neustart re-seeded
```

Docker:

```bash
make clean          # Container + Volumes entfernen
rm -rf db/data      # Daten zuruecksetzen
make dev-docker     # neu starten
```

---

## Docker

| Datei | Beschreibung |
|-------|-------------|
| `docker-compose.yml` | Standard-Services (API, Auth, DB, Studio) |
| `docker-compose.redis.yml` | Optionaler Redis-Override |
| `docker-compose.gpu.yml` | NVIDIA-CUDA-GPU-Override (torch + onnxruntime-gpu) |
| `docker-compose.coolify.yml` | Coolify/Traefik Routing-Config |
| `api/Dockerfile` | API-Image inkl. ffmpeg + ML-Modelle |
| `auth/Dockerfile` | Auth-Image (Python slim) |
| `studio/Dockerfile` | Studio-Image (Node 22-alpine, yarn build) |

---

## Deployment mit Coolify

Die Plattform laesst sich direkt mit [Coolify](https://coolify.io) deployen. Coolify managed Docker Compose + Traefik Reverse Proxy + SSL automatisch.

### 1. Projekt in Coolify anlegen

- Neues Projekt -> "Docker Compose"
- Git-Repository verbinden
- Docker Compose Files angeben:
  ```
  docker-compose.yml;docker-compose.coolify.yml
  ```
  Optional mit Redis:
  ```
  docker-compose.yml;docker-compose.redis.yml;docker-compose.coolify.yml
  ```

### 2. Environment Variables

Alle Variablen aus `.env.coolify` in Coolify eintragen. Kritische Werte:

| Variable | Coolify-Wert |
|----------|-------------|
| `NEXT_PUBLIC_AUTH_URL` | `https://auth.example.com` |
| `NEXT_PUBLIC_API_URL` | `https://api.example.com` |
| `CORS_ORIGINS` | `https://studio.example.com` |
| `AUTH_SERVICE_URL` | `http://auth:<AUTH_PORT>` (internes Docker-Netzwerk) |
| `INTERNAL_AUTH_SECRET` | `openssl rand -hex 32` |
| `JWT_SECRET` | Langer zufaelliger String |
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@db:5432/erohub` |
| `TRUSTED_PROXIES` | `172.16.0.0/12,10.0.0.0/8` |

### 3. Architektur in Coolify

```
Internet
   |
Traefik (SSL + Routing)
   |-- studio.example.com  -> Studio (:3000)
   |-- api.example.com     -> API (:8000)
   +-- auth.example.com    -> Auth (:8001)
                                 |
                            PostgreSQL (:5432)
                            Redis (:6379, optional)
```

Intern kommunizieren die Services ueber Docker-Netzwerk -- keine externen Ports noetig.

---

## Projektstruktur

```
api/src/
  main.py                # App-Setup, Lifespan, CORS, Error-Handling
  config.py              # Gemeinsame Konfiguration (Env-Vars, Pfade)
  auth.py                # API-Key-Validierung + LRU-Cache + Rate-Limiting
  models.py              # ML-Model-Loading, Detection, Storage, preprocess_full()
  worker_pool.py         # Konfigurierbarer ML-Inference-Worker-Pool
  ratelimit.py           # 3-stufiger Rate-Limiter (Redis/DB/Memory)
  cache.py               # Result-Cache (Redis -> DB Fallback)
  clip_scorer.py         # CLIP-basiertes Scoring (Sexiness/Age/Deepfake/Clothing)
  face.py                # MediaPipe Face Detection + Anonymisierung
  pose.py                # MediaPipe Pose Estimation (33 Keypoints)
  batch.py               # Archiv-Extraktion (ZIP/RAR)
  demo.py                # IP-basierter Rate-Limiter (X-Forwarded-For-aware)
  video.py               # Video-Verarbeitung (Frames, Censoring, Szenen, ffmpeg)
  webhooks.py            # Webhook-Dispatch mit HMAC-Signatur + Retry
  download_model.py      # Smart Model-Downloader
  optimize_models.py     # ONNX + INT16 Model-Optimierung
  endpoints/
    classify.py          # /classify, /censor
    rateme.py            # /rateme
    moderate.py          # /moderate (All-in-One)
    clip.py              # /embed, /compare, /tag
    face_pose.py         # /anonymize, /faces, /pose
    batch.py             # /batch
    images.py            # /images, /storage
    demo.py              # /demo/*
    video.py             # /video/classify, /video/censor, /video/scenes
    health.py            # /health, /models

auth/src/
  main.py                # Auth-Service -- Users, Tenants, API-Keys, Webhooks, Usage
  models.py              # SQLAlchemy-Modelle (Tenant, User, APIKey, Webhook, Plans, Usage)
  auth.py                # JWT + Password-Hashing (bcrypt)

db/
  src/database.py        # Gemeinsame SQLAlchemy-DB-Verbindung (async, SQLite/PostgreSQL)
  migrations/            # Alembic-Migrationen
  data/                  # SQLite/PostgreSQL-Daten (gitignored)

studio/
  app/
    layout.tsx           # Root-Layout, MantineProvider, Notifications, AuthGuard
    page.tsx             # Dashboard (Statistiken)
    error.tsx            # Error Boundary
    global-error.tsx     # Root Error Boundary
    login/               # Login-Seite
    register/            # Registrierung
    demo/                # Oeffentliche Demo (6 Modi)
    upload/              # Classify/Censor Upload-UI
    rateme/              # Rate-Me-Ergebnisse
    moderate/            # All-in-One Moderation
    embed/               # CLIP-Embedding + Vergleich
    tag/                 # Zero-Shot Tagging
    anonymize/           # Gesichts-Anonymisierung
    pose/                # Pose-Estimation
    scenes/              # Video-Szenen-Extraktion
    api-keys/            # API-Key-Verwaltung
    webhooks/            # Webhook-Verwaltung
    usage/               # Nutzungsstatistiken
    detections/          # Detection-Ergebnisse
    users/               # User-Verwaltung
    tenants/             # Tenant-Verwaltung
    demo-stats/          # Demo-Statistiken (Super Admin)
    models/              # ML-Modelle-Anzeige
  components/
    DashboardShell/      # Navigation + Layout (collapsible Sidebar)
    AuthGuard/           # Route-Schutz
    ClipAnalysisCards/   # CLIP-Ergebnis-Karten
    ProcessingQueue/     # Langzeit-Request-Anzeige (Timer, Cancel)
    ConfirmDialog/       # Destruktive Aktionen bestaetigen
    ColorSchemeToggle/   # Dark/Light Mode
    LanguageToggle/      # EN/DE Umschaltung
    PageHeader/          # Einheitliche Seiten-Header
    EmptyState/          # Leerzustand-Anzeige
    SkeletonList/        # Lade-Skeleton
    StatCard/            # Dashboard-Statistik-Karten
  lib/
    auth.tsx             # Auth-Context + Token-Management
    use-api-keys.ts      # Shared API-Key-Hook (8 Seiten)
    result-image.ts      # Canvas-Overlay fuer Detection-Ergebnisse
    censor-preview.ts    # Inline Censor-Preview
  i18n/
    I18nProvider.tsx     # Dynamic Locale Loading (EN default, DE on-demand)
    config.ts            # Locale-Konfiguration
    request.ts           # next-intl Server-Config
  messages/
    en.json              # Englische Uebersetzungen
    de.json              # Deutsche Uebersetzungen

scripts/setup-env.sh     # Interaktives Env-Setup
docker-compose.yml       # Standard-Services
docker-compose.redis.yml # Optionaler Redis-Override
docker-compose.coolify.yml # Coolify/Traefik Routing
Makefile                 # Alle Befehle
.env.example             # Template fuer Environment
.env.coolify             # Coolify-spezifische Konfiguration (gitignored)
```
