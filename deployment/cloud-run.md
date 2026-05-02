# Preparación y Despliegue en Google Cloud Run

Este documento explica cómo probar el contenedor localmente y cómo realizar el despliegue a producción en GCP de manera manual (Sprint 8).

## 1. Pruebas Locales (Docker)

Construye la imagen del contenedor:
```bash
docker build -t hr-backend .
```

Ejecuta el contenedor localmente, mapeando las variables de producción:
```bash
docker run --env-file .env.production.local -p 8080:8080 hr-backend
```

Valida que responda:
- `http://localhost:8080/health`
- `http://localhost:8080/health/db`
- `http://localhost:8080/health/supabase`
- `http://localhost:8080/api-docs` (Debe pedir contraseña)

---

## 2. Despliegue Manual en Google Cloud Run

1. **Autenticación e inicialización de servicios GCP**
   ```bash
   gcloud auth login
   gcloud config set project TU_PROJECT_ID

   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable artifactregistry.googleapis.com
   gcloud services enable cloudscheduler.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   ```

2. **Crear repositorio en Artifact Registry**
   ```bash
   gcloud artifacts repositories create hr-backend-repo \
     --repository-format=docker \
     --location=us-central1 \
     --description="Docker repository for HR backend"
   ```

3. **Construir (Build) la imagen en la nube**
   ```bash
   gcloud builds submit \
     --tag us-central1-docker.pkg.dev/TU_PROJECT_ID/hr-backend-repo/hr-backend:latest
   ```

4. **Desplegar (Deploy) a Cloud Run**
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
     --max-instances 3
   ```
   > **Nota:** Las variables de entorno de la base de datos, los tokens JWT, y `CRON_SECRET` deben guardarse preferentemente en el Secret Manager de Google Cloud.

---

## 3. Secret Manager (Recomendado)
Variables sensibles que no deben colocarse en las opciones nativas de UI sin encriptación:
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `SWAGGER_PASSWORD`
- `CRON_SECRET`
- `DNI_API_TOKEN`

---

## 4. Tareas Cronjobs en Cloud Scheduler
No dependeremos de node-cron. Crearemos un job oficial en Cloud Scheduler:

- **Nombre del Job:** `attendance-run-all`
- **Frecuencia (Schedule):** `59 23 * * *`
- **Zona horaria:** `America/Lima`
- **Objetivo HTTP:** `POST https://TU_CLOUD_RUN_URL/jobs/attendance/run-all`
- **Headers:**
  - `X-CRON-SECRET`: `TU_CRON_SECRET`
  - `Content-Type`: `application/json`
- **Body:**
  ```json
  {
    "date": "auto"
  }
  ```
