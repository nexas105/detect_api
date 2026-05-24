# NudeNet API

NSFW image detection and censoring API, powered by [NudeNet](https://github.com/notAI-tech/NudeNet) and [EraX Anti-NSFW](https://huggingface.co/erax-ai/EraX-Anti-NSFW-V1.1).

## Local Development (ohne Docker)

```bash
pip install -r requirements.txt

# .env anlegen (oder Env-Vars direkt setzen)
cp .env.example .env
# API_TOKEN in .env setzen

# Server starten
API_TOKEN=dein-token uvicorn main:app --reload
```

NudeNet lädt beim ersten Start automatisch das 320n-Modell. Für das bessere 640m-Modell muss die Datei manuell nach `~/.NudeNet/640m.onnx` gelegt werden (wird im Docker-Build automatisch heruntergeladen).

EraX wird beim ersten Request lazy von Hugging Face heruntergeladen.

## Docker

```bash
docker build -t nudenet-api .
docker run -p 8000:8000 -e API_TOKEN=dein-token -v nudenet-storage:/app/storage nudenet-api
```

Der Docker-Build lädt beide Modelle (NudeNet 640m + EraX) automatisch herunter.

## Authentication

Alle Endpoints erfordern einen Bearer Token im `Authorization`-Header:

```
Authorization: Bearer <API_TOKEN>
```

## Endpoints

### `POST /classify`

Klassifiziert ein Bild und gibt erkannte NSFW-Regionen zurück. Speichert das Original.

**Query-Parameter:**
- `model` (optional): `nudenet` (default) oder `erax`

**Request:** `multipart/form-data` mit Feld `file`

**Response:**
```json
{
  "image_id": "20250101_120000_a1b2c3d4",
  "model": "nudenet",
  "detections": [
    {
      "label": "FEMALE_BREAST_EXPOSED",
      "score": 0.87,
      "box": [120, 80, 250, 200],
      "box_format": "xywh"
    }
  ]
}
```

### `POST /censor`

Erkennt NSFW-Regionen und gibt das Bild mit Gaussian Blur zurück. Speichert Original + zensierte Version.

**Query-Parameter:**
- `model` (optional): `nudenet` (default) oder `erax`

**Form-Felder:**
- `file` (required): Bilddatei
- `labels` (optional): Komma-getrennte Labels zum Zensieren. Default: alle exponierten Körperteile.

**Response:** `image/png` Bytes. Die `image_id` kommt im `X-Image-Id` Response-Header.

### `GET /images`

Listet gespeicherte Bilder.

**Query-Parameter:**
- `category` (optional): `originals` oder `censored` (default)
- `limit` (optional): Max. Anzahl (default: 50, max: 200)

### `GET /images/{category}/{image_id}`

Ruft ein gespeichertes Bild ab. `category` ist `originals` oder `censored`.

### `GET /models`

Listet verfügbare Modelle mit ihren Labels und Default-Censor-Labels.

## Models

### NudeNet (default)

YOLOv8m mit 18 Labels, unterscheidet zwischen covered/exposed:

`FEMALE_BREAST_EXPOSED`, `FEMALE_BREAST_COVERED`, `FEMALE_GENITALIA_EXPOSED`, `FEMALE_GENITALIA_COVERED`, `MALE_GENITALIA_EXPOSED`, `MALE_GENITALIA_COVERED`, `BUTTOCKS_EXPOSED`, `BUTTOCKS_COVERED`, `ANUS_EXPOSED`, `ANUS_COVERED`, `BELLY_EXPOSED`, `BELLY_COVERED`, `ARMPITS_EXPOSED`, `ARMPITS_COVERED`, `FEET_EXPOSED`, `FEET_COVERED`, `FACE_FEMALE`, `FACE_MALE`

**Default Censor:** `FEMALE_BREAST_EXPOSED`, `FEMALE_GENITALIA_EXPOSED`, `MALE_GENITALIA_EXPOSED`, `BUTTOCKS_EXPOSED`, `ANUS_EXPOSED`

### EraX

YOLO11s mit 5 Labels (nur exposed):

`NIPPLE`, `PENIS`, `VAGINA`, `ANUS`, `MAKE_LOVE`

**Default Censor:** `NIPPLE`, `PENIS`, `VAGINA`, `ANUS`

## Beispiele

```bash
TOKEN="dein-token"

# Classify mit NudeNet
curl -X POST http://localhost:8000/classify \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"

# Classify mit EraX
curl -X POST "http://localhost:8000/classify?model=erax" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"

# Censor (alle Default-Labels)
curl -X POST http://localhost:8000/censor \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg" \
  -o censored.png

# Censor (bestimmte Labels)
curl -X POST http://localhost:8000/censor \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg" \
  -F "labels=FEMALE_BREAST_EXPOSED,BUTTOCKS_EXPOSED" \
  -o censored.png

# Gespeicherte Bilder auflisten
curl http://localhost:8000/images?category=censored \
  -H "Authorization: Bearer $TOKEN"

# Bild abrufen
curl http://localhost:8000/images/censored/20250101_120000_a1b2c3d4 \
  -H "Authorization: Bearer $TOKEN" \
  -o image.png
```

## Environment Variables

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `API_TOKEN` | Bearer Token fuer Auth (required) | — |
| `STORAGE_DIR` | Pfad fuer Bildspeicherung | `/app/storage` |

API-Dokumentation (Swagger UI) unter http://localhost:8000/docs.
