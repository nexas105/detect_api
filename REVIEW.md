# Projekt-Review — detect_api

> Aktueller Review des Arbeitsbaums, nicht nur Fortschreibung der früheren Fundliste.  
> Umfang: API, Auth-Service, Datenbank/Alembic, Studio und Docker-Deployment.  
> Stand: 2026-07-10

## Kurzfazit

Das Projekt hat ein breites, sinnvoll gegliedertes Produktfundament: getrennte Services, Multi-Tenancy,
gehashte API-Keys, zentralisiertes Redis, geteilte Analysepfade, tenant-isolierte Async-Jobs und ein
umfangreiches Studio. Die früheren P0-Probleme bei API-Key-Speicherung, CORS, Proxy-IP-Auswertung und
internen Service-Endpunkten sind im aktuellen Code weitgehend sauber behoben.

Produktionsreif ist der aktuelle Arbeitsbaum dennoch noch nicht. Zwei Punkte sind Release-Blocker:
Ein frisches PostgreSQL-Deployment führt keine Alembic-Migrationen aus, obwohl `create_all` dort nun
deaktiviert ist; außerdem können konfigurierbare Webhooks Requests in interne Netze auslösen (SSRF).
Die neuen persistenten Jobs sind nur in der Datenbank persistent, nicht in ihrer Ausführung. Nach einem
Prozessabbruch bleiben Jobs dauerhaft `queued` oder `running`.

**Gesamturteil:** gute Architektur und deutlich verbesserter Sicherheitsstand, aber vor dem nächsten
Release sind Migration-Orchestrierung, Webhook-Zielvalidierung und robuste Job-Ausführung erforderlich.

## Verifizierter Stand

| Prüfung | Ergebnis |
|---|---|
| Python-Syntax (`compileall`, API/Auth/DB) | ✅ erfolgreich |
| Studio TypeScript (`tsc --noEmit`) | ✅ erfolgreich |
| Studio Jest | ✅ 1 Suite / 1 Test erfolgreich |
| Studio Oxlint | ❌ zahlreiche Fehler, u. a. ungenutzte Variablen, doppelte Imports und Regelverstöße |
| Python Unit-/Integrationstests | ⚠️ keine Tests bzw. keine Testkonfiguration im Repository gefunden |
| Alembic-Lauf gegen Testdatenbank | ⚠️ nicht ausführbar; lokale Python-DB-Abhängigkeiten fehlen |
| Runtime-/Endpoint-Smoke-Test | ⚠️ nicht Teil dieses lokalen Reviews |

Die in `data.md` dokumentierten drei produktiven URLs waren zum dortigen Prüfzeitpunkt erreichbar. Das
ersetzt keinen reproduzierbaren Test und beweist insbesondere nicht, dass ein frisches Deployment gelingt.

## Release-Blocker

### P0.1 — Frische PostgreSQL-Installation startet ohne Schema

**Beleg:** `db/src/database.py` deaktiviert `create_all` standardmäßig für PostgreSQL. Gleichzeitig starten
`auth/Dockerfile` und `docker-compose.yml` direkt Uvicorn; weder ein Init-Container noch ein Entrypoint führt
`alembic upgrade head` aus. Der Auth-Lifespan greift unmittelbar auf Tenant-, User- und API-Key-Tabellen zu.

**Auswirkung:** Ein neues Environment mit leerem DB-Volume kann beim Start des Auth-Service scheitern. Die
neuen Migrationen helfen nur, wenn sie tatsächlich vor dem Anwendungsstart ausgeführt werden.

**Empfehlung:** Migration als einmaligen, fehlschlagenden Deploy-Schritt ausführen und `auth` erst nach
erfolgreichem `alembic upgrade head` starten. Migration nicht gleichzeitig aus mehreren App-Replikaten
starten. Anschließend einen CI-Test „leere PostgreSQL-DB → upgrade head → Services starten“ ergänzen.

### P0.2 — Webhook-URLs ermöglichen SSRF

**Beleg:** `WebhookCreate.url` und `WebhookUpdate.url` sind freie Strings. Die Prüfung akzeptiert jedes
`http://`- oder `https://`-Ziel. Sowohl `/webhooks/{id}/test` im Auth-Service als auch die reguläre Zustellung
im API-Service rufen diese URL serverseitig auf.

**Auswirkung:** Ein authentifizierter Tenant kann localhost, Docker-Service-Namen, private Netze oder
Cloud-Metadata-Endpunkte ansprechen. Antwortstatus und bis zu 2.000 Zeichen Response-Body werden gespeichert
und über die Delivery-Ansicht zurückgegeben. Das macht den Pfad nicht nur blind, sondern teilweise lesbar.

**Empfehlung:** Host auflösen und Loopback, Link-local, private, reservierte sowie interne Adressbereiche für
IPv4 und IPv6 sperren; Redirects deaktivieren oder jedes Redirect-Ziel erneut prüfen; DNS-Rebinding beachten.
Für hohe Sicherheit ausgehende Webhooks über einen isolierten Egress-Proxy mit Allow-/Deny-Regeln senden.

## Hohe Priorität

### P1.1 — Async-Jobs überleben keinen Neustart

`create_job` persistiert Metadaten und Input, die Ausführung wird danach aber nur über FastAPIs
`BackgroundTasks` gestartet. Es existiert beim Startup kein Claim-/Recovery-Mechanismus für `queued` oder
verwaiste `running` Jobs. Ein Neustart, Crash oder Deployment zwischen HTTP-Response und Abschluss hinterlässt
einen dauerhaft unfertigen Job. Auch Webhook-Retries leben nur in `asyncio.create_task` und gehen verloren.

**Empfehlung:** Job-Queue mit eigenem Worker einsetzen (z. B. Redis-basierte Queue) oder DB-basiertes Claiming
mit Lease/Heartbeat, `SELECT ... FOR UPDATE SKIP LOCKED`, Retry-Zähler und Startup-Recovery implementieren.
Webhook-Outbox in derselben Transaktion wie den terminalen Jobstatus persistieren.

### P1.2 — API-Key-Klartext bleibt während langer Jobs im Prozess

Für Async-Jobs wird `key_info.raw_key` an den Background-Task übergeben und bis zur abschließenden
Webhook-Auflösung benötigt. Das Secret landet zwar nicht mehr in der Datenbank, bleibt aber für die gesamte
Jobdauer in einer Closure im API-Prozess. Eine robuste externe Queue dürfte diesen Wert keinesfalls
serialisieren.

**Empfehlung:** Webhooks anhand `tenant_id` und `api_key_id` über einen internen, authentifizierten Endpoint
auflösen. Im Job nur stabile IDs speichern; den Roh-Key nach Request-Ende nicht mehr benötigen.

### P1.3 — Qualitäts-Gate ist aktuell rot und kaum aussagekräftig

TypeScript kompiliert, Oxlint schlägt jedoch mit vielen Fehlern fehl. Jest findet lediglich einen bestehenden
Komponententest. Für Auth, Tenant-Isolation, Rate-Limits, Cache, Migrationen, Webhooks und Jobs fehlen
automatisierte Regressionstests vollständig.

**Empfehlung:** Zuerst den bestehenden Lint-Bestand bereinigen oder bewusst konfigurieren und CI verbindlich
machen. Danach fokussierte Tests für folgende kritische Pfade ergänzen:

1. frische DB und Upgrade aller Migrationen,
2. API-Key create/list/validate/revoke ohne Klartextpersistenz,
3. tenant-fremder Zugriff auf Jobs, Ergebnisse und Webhooks,
4. Job-Crash, Worker-Neustart und idempotente Wiederaufnahme,
5. SSRF-Sperren inklusive IPv6, Redirect und DNS-Wechsel,
6. Demo-Rate-Limit hinter vertrauenswürdigen und nicht vertrauenswürdigen Proxies.

### P1.4 — Migrationen sind nur eingeschränkt reversibel

`d1e2f3a4b5c6` ist aus gutem Grund irreversibel, weil API-Key-Klartexte gelöscht werden. Die Migration
`f3a4b5c6d7e8` erstellt auf frischen Datenbanken jedoch drei Tabellen, löscht sie beim Downgrade absichtlich
nicht. Damit stellt `downgrade` den vorherigen Schema-Stand nicht wieder her und kann Umgebungen auseinanderlaufen
lassen.

**Empfehlung:** Den Rollback-Vertrag ausdrücklich dokumentieren und in Produktion Forward-only-Migrationen
festlegen. Für Tests entweder vollständige Downgrades ermöglichen oder Datenbanken stets neu erzeugen.

## Mittlere Priorität

### P2.1 — Token-Speicherung im Studio bleibt XSS-sensitiv

Access- und Refresh-Token liegen in `localStorage`. Der neue 401-Refresh-Retry verbessert die Session-Stabilität,
nicht aber die Vertraulichkeit bei XSS. Besonders der langlebige Refresh-Token vergrößert den Schaden.

**Empfehlung:** Refresh-Token in `Secure; HttpOnly; SameSite`-Cookie verschieben, Access-Token kurzlebig und
möglichst nur im Speicher halten; dazu CSP und CSRF-Modell bewusst definieren.

### P2.2 — Keine belastbare Betriebsbeobachtung

`/health` und DB-Usage-Daten sind vorhanden, aber es fehlen standardisierte Metriken und Alerts für
Inference-Latenz, Queue-Alter, Fehlerquote, Cache-Hits, Redis/Auth-Ausfälle und fehlgeschlagene Webhooks.
Gerade festhängende Jobs bleiben so leicht unbemerkt.

**Empfehlung:** Prometheus/OpenTelemetry ergänzen und mindestens Queue-Alter, Jobs pro Status, Webhook-Retries,
HTTP-Latenz und ML-Worker-Auslastung alarmierbar machen.

### P2.3 — Dokumentation und ausführbarer Stand driften

README beschreibt Async-Jobs und ein produktionsnahes Setup, erwähnt aber weder den notwendigen Alembic-Schritt
noch die In-Process-Grenzen von Jobs/Webhook-Retries. `make migrate` bezeichnet eine SQLite-zu-PostgreSQL-
Datenmigration und ist kein Schema-Upgrade; der Name kann deshalb in Deployments irreführen.

**Empfehlung:** getrennte Befehle `db-upgrade` und `data-migrate` anbieten, den Deploy-Ablauf dokumentieren und
die Garantien von Async-Jobs präzise benennen.

## Positiv bestätigte Änderungen

- API-Keys werden über SHA-256-Hashes validiert; Listen geben keinen Vollkey mehr zurück.
- Interne Auth-Endpunkte sind durch `X-Internal-Token` geschützt.
- Der interne Token wird dank separatem HTTP-Client nicht an externe Webhook-Ziele weitergereicht.
- CORS erlaubt Credentials nur bei explizit konfigurierten Origins bzw. Regex.
- Demo-IP-Auswertung berücksichtigt konfigurierte vertrauenswürdige Proxies.
- Redis-Zugriffe sind zentralisiert und async; rohe API-Keys werden nicht als Redis-Key verwendet.
- MediaPipe-Zugriffe und Modell-Lazy-Loading wurden gegen parallele Nutzung abgesichert.
- Gemeinsame Analyse-, Cache- und Zeichenpfade reduzieren Doppelarbeit.
- Job-Abfragen und Outputs werden nach `tenant_id` isoliert.
- Das Studio kompiliert mit dem aktuellen TypeScript-Stand ohne Typfehler.

## Empfohlene Reihenfolge

1. Alembic als verpflichtenden Deploy-Schritt integrieren und Fresh-DB-Test hinzufügen.
2. Webhook-SSRF schließen, einschließlich Redirects und DNS-Rebinding.
3. Async-Jobs und Webhook-Zustellung auf eine recoverbare Queue/Outbox umstellen.
4. Lint-Gate bereinigen und kritische Backend-/Migrations-Tests aufbauen.
5. Roh-Key aus Job-Ausführung entfernen und Token-Speicherung im Studio härten.
6. Betriebsmetriken, Alerts und Runbooks ergänzen.

## Release-Entscheidung

**Aktuell: No-Go für ein frisches oder horizontal skaliertes Produktions-Deployment.**

Ein Update der bereits laufenden Einzelinstanz ist nur vertretbar, wenn die Migrationen kontrolliert vorab
ausgeführt werden und Webhooks bis zur SSRF-Härtung deaktiviert oder auf vertrauenswürdige Ziele begrenzt sind.
Nach Behebung der beiden P0-Punkte sollte ein erneuter Review mit echter PostgreSQL-/Redis-Umgebung,
Endpoint-Smoke-Tests und einem erzwungenen Job-Worker-Neustart erfolgen.
