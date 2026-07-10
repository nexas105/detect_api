# Feature-Ideen — detect_api

> Ideen die auf **bestehender** Infra aufsetzen (Synergien statt Greenfield). Jede nennt was
> schon da ist und wiederverwendet wird, Wert + Aufwand. Sortiert nach Wert/Aufwand.
> Stand: 2026-07-10

---

## Hoher Hebel — nutzt vorhandene Bausteine fast direkt

### 1. Similarity-Search / Duplikat-Erkennung auf CLIP-Embeddings
**Da:** `/embed` liefert 768-dim Vektoren, `/compare` macht Cosine. Detection-Results in DB.
**Neu:** Embeddings persistieren (pgvector-Spalte in `detection_results`), Endpoint `/search` (Bild → Top-N ähnliche aus Historie) + `/duplicates` (Near-Dupe-Cluster pro Tenant).
**Wert:** Content-Dedup, "schon mal gesehen?"-Moderation, wiedererkennende Sperren. Killer-Feature für Plattformen.
**Aufwand:** M — pgvector-Extension + eine Migration + 2 Endpoints. Embedding wird eh berechnet.

### 2. Perceptual-Hash-Blocklist (bekannte Bilder sperren)
**Da:** `sha256(image)`-Cache-Key existiert, Moderate liefert allow/flag/block.
**Neu:** pHash statt exakt-sha (übersteht Rescale/Recompress), Tenant-Blocklist-Tabelle, Moderate prüft gegen Liste → sofort `block` ohne ML-Pass.
**Wert:** Wiederhochgeladenes verbotenes Material sofort geblockt, spart teure Inference. DSGVO/Compliance-Story.
**Aufwand:** S–M — `imagehash`-lib, eine Tabelle, ein Check vor dem ML-Pass.

### 3. Webhook → Batch-Callback für Async-Jobs ✅ Implementiert
**Da:** Webhooks (HMAC, Retry-Backoff) + Batch/Video vorhanden, aber synchron (Client wartet).
**Neu:** `/batch?async=true` und `/video/*?async=true` → sofort `job_id`, Ergebnis per Webhook. Job-Status-Endpoint `/jobs/{id}`.
**Wert:** Große Archive/lange Videos blockieren keine HTTP-Connection mehr. Webhooks werden endlich für ihren Kernzweck genutzt.
**Aufwand:** M — Job-Tabelle + BackgroundTask + Status-Endpoint. Webhook-Dispatch existiert.

**Umgesetzt:** `?async=true` fuer `/batch`, `/video/classify`, `/video/censor`
und `/video/scenes`; tenant-isolierte `/jobs/{id}`- und `/jobs/{id}/output`-Endpoints;
Events `job.completed`/`job.failed` ueber den bestehenden HMAC-Retry-Dispatcher.

### 4. Moderation-Policies pro Tenant (konfigurierbare Schwellen)
**Da:** Moderate-Block-Regeln sind hartkodiert (`extreme`, `sexual_act >0.7`, minor).
**Neu:** `moderation_policy`-JSON pro Tenant (Schwellen, welche Labels blocken/flaggen, erlaubte Kategorien). Studio-Seite dafür.
**Wert:** Ein Kunde will `swimwear` erlauben, anderer nicht. Ohne Redeploy. Verkaufsargument Enterprise-Plan.
**Aufwand:** M — Policy-Spalte + Merge in `_determine_action` + Studio-Form.

---

## Mittlerer Hebel

### 5. Usage-Analytics-Dashboard mit Zeitreihen
**Da:** `usage_logs` mit `created_at`, Dashboard zeigt nur aktuelle Zahlen.
**Neu:** Zeitreihen-Charts (Requests/Tag, pro Endpoint, pro Key), Cache-Hit-Rate, Top-Kategorien.
**Wert:** Kunden sehen ihr Nutzungsverhalten, Admin sieht Load-Muster. Braucht Composite-Index aus REVIEW (DB-Fund).
**Aufwand:** M — Aggregat-Queries + Recharts (Mantine hat's). Daten sind schon da.

### 6. NSFW-Score als Stream/Realtime für Video
**Da:** Video-Frame-Analyse + Scenes-Extraktion vorhanden.
**Neu:** WebSocket/SSE-Endpoint der Frame-Scores live pusht während der Verarbeitung (statt am Ende alles).
**Wert:** Progress + Live-Preview im Studio (ProcessingQueue-Komponente existiert schon für Timer/Cancel).
**Aufwand:** M — SSE-Endpoint, Frontend-Consumer. Frame-Loop existiert.

### 7. API-Playground / OpenAPI-SDK-Gen
**Da:** FastAPI liefert OpenAPI-Schema gratis unter `/openapi.json`.
**Neu:** `openapi-generator` in CI → Python/TS-Client-SDKs als Artefakt. Optional Studio-„Try it"-Seite.
**Wert:** Kunden-Onboarding, weniger Support. Fast Nulldaufwand da Schema existiert.
**Aufwand:** S — CI-Step. SDK-Gen liest bestehendes Schema.

### 8. Alter-/Minor-Safety als eigener dedizierter Endpoint
**Da:** CLIP macht Altersschätzung + Minor-Safety schon (in rateme/moderate eingebettet).
**Neu:** `/age-check` isoliert — nur Minor-Risk-Bool + Confidence, ohne Sexiness-Overhead.
**Wert:** Compliance-Kunden brauchen oft *nur* das (CSAM-Prevention-Pflicht), wollen nicht den ganzen Rateme-Report.
**Aufwand:** S — dünner Endpoint um bestehende `estimate_age`. (Vorher CLIP-1-Pass-Fix aus REVIEW.)

---

## Niedriger Hebel / Nice-to-have

### 9. Prometheus-Metriken + `/metrics`
**Da:** Worker-Pool-Status in `/health`, Usage in DB.
**Neu:** `prometheus_client`-Middleware: Latenz-Histogramme pro Endpoint, Inference-Zeit, Cache-Hit-Rate, Queue-Tiefe.
**Wert:** Ops-Monitoring/Alerting in Prod (Coolify/Grafana).
**Aufwand:** S — eine Middleware + Counter.

### 10. Multi-Model-Ensemble-Voting konfigurierbar
**Da:** NudeNet + EraX werden schon gemerged (`_merge_detections`).
**Neu:** Ensemble-Strategie wählbar (union/intersection/weighted) pro Request oder Tenant-Policy.
**Wert:** Präzision vs. Recall tunbar je Use-Case (Werbung vs. strikte Moderation).
**Aufwand:** S — Merge-Fn parametrisieren.

### 11. Bild-Anonymisierung als Moderate-Nebenprodukt
**Da:** `/anonymize` (Face-Blur) + `/moderate` getrennt.
**Neu:** `/moderate?anonymize=true` → Report **+** anonymisiertes Bild in einem Call.
**Wert:** DSGVO-konforme Speicherung (Gesichter geblurrt) direkt beim Moderieren, ein Roundtrip.
**Aufwand:** S — Face-Detection läuft eh oft, Blur-Helper existiert (nach REVIEW-Dedup).

### 12. Tag-Presets / gespeicherte Prompt-Sets
**Da:** `/tag` Zero-Shot mit freien Prompts.
**Neu:** Tenant kann Prompt-Sets speichern („mein-Branding-Check", „Gewalt-Detektor"), per Name aufrufen.
**Wert:** Wiederkehrende Klassifikation ohne Prompt-Copy-Paste, konsistent im Team.
**Aufwand:** S — kleine Tabelle + Lookup in `/tag`.

---

## Abhängigkeiten zu REVIEW.md

- **#1, #5, #9** brauchen den Usage-Composite-Index (DB-Fund).
- **#8, #11** profitieren vom CLIP-1-Pass-Fix (P1-C) und Blur-Dedup (P2).
- **#3** braucht den Async-Redis/Job-Umbau nicht zwingend, aber sauberer danach.

**Vorschlag Roadmap:** Erst REVIEW-P0/P1 (Fundament stabil), dann **#2 pHash-Blocklist** + **#1 Similarity-Search**
als Differenzierungs-Features — beide hebeln bestehende Embeddings/Hashes und sind Verkaufsargumente.
