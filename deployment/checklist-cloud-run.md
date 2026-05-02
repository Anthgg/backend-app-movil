# Checklist antes de Deploy a Cloud Run

- [x] QA General en GO.
- [x] Dockerfile creado.
- [x] .dockerignore creado.
- [x] server.js usa `process.env.PORT`.
- [x] .env.production.example creado.
- [x] .env real no está en Git.
- [x] Swagger protegido.
- [x] CRON_SECRET configurado.
- [x] CORS_ORIGIN configurado.
- [x] Logger compatible con Cloud Run.
- [ ] Docker Desktop activo.
- [ ] docker build exitoso.
- [ ] docker run exitoso.
- [ ] /health OK.
- [ ] /health/db OK.
- [ ] /health/supabase OK.
- [ ] Swagger protegido OK.
- [ ] Login OK.
- [ ] Logs en consola OK.
- [x] No hay secretos en logs.
- [x] No hay node_modules en imagen.

## Seguridad y Secretos

- [ ] JWT_SECRET fuerte generado.
- [ ] JWT_REFRESH_SECRET fuerte generado.
- [ ] CRON_SECRET fuerte generado.
- [ ] SWAGGER_PASSWORD fuerte generado.
- [ ] DATABASE_URL rotado si fue expuesto.
- [ ] DNI_API_TOKEN rotado si fue expuesto.
- [ ] Secretos subidos a Secret Manager.
- [ ] .env.production.local no está en Git.
- [ ] `npm run check:prod-secrets` aprobado.
- [ ] `npm run test:connections` aprobado después de rotar secretos.
- [ ] docker run con `.env.production.local` aprobado.

## Despliegue en Google Cloud Run

- [ ] `gcloud auth login` ejecutado.
- [ ] Proyecto configurado.
- [ ] APIs habilitadas.
- [ ] Artifact Registry creado.
- [ ] Secretos creados.
- [ ] Imagen construida.
- [ ] Servicio desplegado.
- [ ] Secretos enlazados.
- [ ] `/health` OK.
- [ ] `/health/db` OK.
- [ ] `/health/supabase` OK.
- [ ] Swagger protegido.
- [ ] Login OK.
- [ ] Cloud Scheduler creado.
- [ ] Cloud Scheduler probado.
- [ ] `job_runs` registra ejecución.
- [ ] `audit_logs` registra ejecución.
- [ ] Cloud Logging visible.
- [ ] Sin secretos en logs.
- [ ] Sin errores críticos.
