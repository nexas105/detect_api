┌────────────────────────────────────────────┬──────────────────────────┬────────────────┐
  │                    URL                     │          Status          │    Service     │
  ├────────────────────────────────────────────┼──────────────────────────┼────────────────┤
  │ https://detect-api.home.mpa-coaching.de    │        200 (37ms)        │ FastAPI API    │
  ├────────────────────────────────────────────┼──────────────────────────┼────────────────┤
  │ https://detect-auth.home.mpa-coaching.de   │ 200 (login ✓ role=admin) │ FastAPI Auth   │
  ├────────────────────────────────────────────┼──────────────────────────┼────────────────┤
  │ https://detect-studio.home.mpa-coaching.de │           200            │ Next.js Studio │
  └────────────────────────────────────────────┴──────────────────────────┴────────────────┘
 
  Was sich geändert hat
  - docker-compose.deploy.yml — auth + studio jetzt auch im traefik-net
  - .dockerignore (neu) — hält db/data, storage/, .env*, node_modules etc. aus dem Build-Context (war der Grund für den ersten Build-Fail)
  - .env auf nexas: NEXT_PUBLIC_AUTH_URL=…detect-auth, NEXT_PUBLIC_API_URL=…detect-api, CORS_ORIGINS=…detect-studio
  - dynamic.yml auf nexas: detect-auth + detect-studio Router/Service ergänzt (Backup angelegt)

  Admin-Zugang: ueber die geschuetzten Environment-Variablen konfigurieren.
  Hinweis: Das zuvor hier dokumentierte Passwort muss rotiert werden.
