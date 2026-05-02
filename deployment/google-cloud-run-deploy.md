# Guía de Despliegue Manual en Google Cloud Run

Esta guía detalla los pasos para llevar el backend desde tu entorno local a producción en Google Cloud Run, utilizando servicios administrados y Secret Manager.

## 1. Requisitos Previos

- Tener cuenta de Google Cloud y un Proyecto creado.
- Tener facturación habilitada (requerido para Cloud Run y Artifact Registry).
- Tener instalado Google Cloud CLI (`gcloud`).
- Docker Desktop funcionando localmente.
- Backend validado localmente con Docker.
- Acceso a las credenciales de producción (Supabase, DNI API, etc).
- Variables reales a la mano.

## 2. Autenticación y Proyecto

Abre tu terminal (PowerShell o bash) y ejecuta:

```bash
# Iniciar sesión en tu cuenta
gcloud auth login

# Configurar el proyecto
gcloud config set project TU_PROJECT_ID

# Verificar configuración
gcloud config list
```

## 3. Habilitar APIs Necesarias

Activa todos los servicios requeridos por la infraestructura:

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

## 4. Crear Repositorio Docker (Artifact Registry)

Almacenaremos las imágenes construidas en Artifact Registry en `us-central1`.

```bash
gcloud artifacts repositories create hr-backend-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker repository for HR backend"
```

## 5. Administrador de Secretos (Secret Manager)

**IMPORTANTE:** Nunca coloques passwords ni secrets en texto plano en repositorios ni variables expuestas de Cloud Run.

Crea los secretos enviando el texto puro:

```bash
echo -n "valor_real" | gcloud secrets create DATABASE_URL --data-file=-
echo -n "valor_real" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "valor_real" | gcloud secrets create JWT_REFRESH_SECRET --data-file=-
echo -n "valor_real" | gcloud secrets create SWAGGER_PASSWORD --data-file=-
echo -n "valor_real" | gcloud secrets create CRON_SECRET --data-file=-
```

*(Si usas `DNI_API_TOKEN` como secreto, repite el comando correspondiente).*

**Para actualizar el valor de un secreto existente:**
```bash
echo -n "nuevo_valor" | gcloud secrets versions add DATABASE_URL --data-file=-
```

## 6. Construir la Imagen (Cloud Build)

Sube tu código y construye la imagen nativamente en la nube:

```bash
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/TU_PROJECT_ID/hr-backend-repo/hr-backend:latest
```

## 7. Desplegar en Cloud Run

Despliega el contenedor inyectando variables públicas (`--set-env-vars`) y montando variables sensibles desde el Secret Manager (`--set-secrets`).

```bash
gcloud run deploy hr-backend \
  --image us-central1-docker.pkg.dev/TU_PROJECT_ID/hr-backend-repo/hr-backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars NODE_ENV=production,PORT=8080,SUPABASE_URL=https://pwukbujyinlgqsafreqe.supabase.co,SUPABASE_PUBLISHABLE_KEY=sb_publishable_cBi6xeLZEVmGH-0vbjGYXw_FS8sIULo,ENABLE_SWAGGER=true,SWAGGER_BASIC_AUTH=true,SWAGGER_USER=admin,REPORT_STORAGE_MODE=download,REPORT_BUCKET=reports,LOG_LEVEL=info,DNI_API_PROVIDER=apis_net_pe,DNI_API_URL=https://api.apis.net.pe/v2/reniec/dni,CORS_ORIGIN=https://tu-frontend.com \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,SWAGGER_PASSWORD=SWAGGER_PASSWORD:latest,CRON_SECRET=CRON_SECRET:latest
```
*(Nota: Si `DNI_API_TOKEN` está vacío o no se usa, ignóralo del set-secrets. Si lo usas, añade `,DNI_API_TOKEN=DNI_API_TOKEN:latest`)*

## 8. Permisos de Secret Manager para Cloud Run

Si la instancia no arranca porque Cloud Run no puede leer los secretos, dale permisos explícitos al Service Account por defecto de Compute Engine (`NUMERO_PROYECTO-compute@developer.gserviceaccount.com`):

```bash
gcloud projects add-iam-policy-binding TU_PROJECT_ID \
  --member="serviceAccount:TU_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

## 9. Validar Despliegue

Copia la URL de Cloud Run (`https://hr-backend-....a.run.app`) y guárdala localmente:
```bash
$env:CLOUD_RUN_URL="https://TU_CLOUD_RUN_URL"
```

Prueba los endpoints con `curl`:
```bash
curl https://TU_CLOUD_RUN_URL/health
curl https://TU_CLOUD_RUN_URL/health/db
curl https://TU_CLOUD_RUN_URL/health/supabase
curl https://TU_CLOUD_RUN_URL/api-docs.json
```
*(El test de `/api-docs.json` debe devolver código 401 si no se envían credenciales de Basic Auth).*

## 10. Probar Login

Valida que la red funcione haciendo un POST real:
```bash
curl -X POST https://TU_CLOUD_RUN_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"Demo123!"}'
```

## 11. Tareas Programadas (Cloud Scheduler)

Crea el cronjob que se conectará diariamente a procesar la asistencia:

```bash
gcloud scheduler jobs create http attendance-run-all \
  --location=us-central1 \
  --schedule="59 23 * * *" \
  --time-zone="America/Lima" \
  --uri="https://TU_CLOUD_RUN_URL/jobs/attendance/run-all" \
  --http-method=POST \
  --headers="Content-Type=application/json,X-CRON-SECRET=TU_CRON_SECRET_REAL" \
  --message-body='{"date":"auto"}'
```
> **Aclaración:** Reemplaza `TU_CRON_SECRET_REAL` por el mismo valor de `CRON_SECRET`. Este comando es para la terminal (no lo dejes guardado en tu código de Git).

Prueba el Job forzosamente:
```bash
gcloud scheduler jobs run attendance-run-all --location=us-central1
```

## 12. Script de Validación Final

Usa el script creado en Node para probar masivamente la salud del Cloud Run.

En Linux/Mac/Git Bash:
```bash
CLOUD_RUN_URL=https://TU_CLOUD_RUN_URL npm run check:cloudrun
```

En PowerShell:
```powershell
$env:CLOUD_RUN_URL="https://TU_CLOUD_RUN_URL"
npm run check:cloudrun
```

Este comando valida automáticamente:
- `/health`
- `/health/db`
- `/health/supabase`
- Swagger protegido
- Login demo habilitado

---

## ⚠️ 13. Errores Comunes Cloud Run

- **Error: container failed to start.**
  *Causas:* `PORT` incorrecto (usar 8080 en Cloud Run), aplicación no escucha en `0.0.0.0`, o crasheó porque falta una variable de entorno crucial en el arranque de DB.
- **Error: secret not found.**
  *Causas:* El secreto no existe en el proyecto GCP o el nombre en la instrucción `--set-secrets` tiene un error tipográfico.
- **Error: permission denied secret accessor.**
  *Causas:* El service account de Cloud Run no tiene el rol de `Secret Manager Secret Accessor`. (Ver paso 8).
- **Error: connection refused Supabase.**
  *Causas:* `DATABASE_URL` tiene un formato inválido o password erróneo. Revisa caracteres extraños.
- **Error: CORS.**
  *Causas:* Frontend y Backend están desvinculados porque `CORS_ORIGIN` no incluye exactamente el protocolo HTTP/HTTPS de tu frontend real.
- **Error: 401 en Swagger.**
  *Causa:* Comportamiento **esperado**. Significa que Basic Auth ha blindado la información.
- **Error: Cloud Scheduler 403.**
  *Causas:* Se está mandando un `X-CRON-SECRET` en los headers de Cloud Scheduler que no hace *match* exacto con el secreto inyectado en Cloud Run.
