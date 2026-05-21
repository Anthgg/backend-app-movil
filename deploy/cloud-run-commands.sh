#!/usr/bin/env bash
set -euo pipefail

# Cloud Run deployment helper (safe, non-destructive). Fill placeholders before running.
# DO NOT store secrets in this script. Create secrets in Secret Manager instead.

########## VARIABLES (REPLACE BEFORE USE) ##########
PROJECT_ID="TU_PROJECT_ID"
REGION="us-central1"
REPO_NAME="hr-backend-repo"
SERVICE_NAME="hr-backend"
IMAGE_NAME="hr-backend"
IMAGE_TAG="latest"

SUPABASE_URL="https://pwukbujyinlgqsafreqe.supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_cBi6xeLZEVmGH-0vbjGYXw_FS8sIULo"
CORS_ORIGIN="https://tu-frontend.com"

############# BASIC VALIDATIONS #############
echo "== Basic environment checks =="

command -v gcloud >/dev/null 2>&1 || { echo "ERROR: gcloud not found in PATH. Install Cloud SDK." >&2; exit 1; }

if [[ "$PROJECT_ID" == "TU_PROJECT_ID" ]]; then
  echo "ERROR: Replace PROJECT_ID at top of script (PROJECT_ID=\"TU_PROJECT_ID\")." >&2
  exit 1
fi

ACTIVE_ACCOUNT=$(gcloud auth list --filter="status:ACTIVE" --format="value(account)") || ACTIVE_ACCOUNT=""
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "ERROR: No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [[ "$CURRENT_PROJECT" != "$PROJECT_ID" ]]; then
  echo "WARNING: gcloud project is '$CURRENT_PROJECT' but PROJECT_ID is '$PROJECT_ID'."
  echo "Run: gcloud config set project $PROJECT_ID" 
fi

# Ensure the script does not read .env.production.local (we prefer secrets manager)
if [[ -f ".env.production.local" ]]; then
  echo "WARNING: .env.production.local exists locally. This script will NOT read it. Use Secret Manager to provide secrets to Cloud Run." >&2
fi

echo "Environment checks OK. Using project: ${PROJECT_ID}, region: ${REGION}" 

############# ENABLE APIS #############
echo "== Enabling required Google Cloud APIs =="
gcloud services enable run.googleapis.com --project="$PROJECT_ID"
gcloud services enable cloudbuild.googleapis.com --project="$PROJECT_ID"
gcloud services enable artifactregistry.googleapis.com --project="$PROJECT_ID"
gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT_ID"
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

############# ARTIFACT REGISTRY #############
REPO_FULL_NAME="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME"
echo "== Ensure Artifact Registry repository exists: $REPO_NAME ($REGION) =="
if gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Artifact Registry $REPO_NAME already exists in $REGION"
else
  echo "Creating Artifact Registry repository $REPO_NAME in $REGION"
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker --location="$REGION" --description="Docker repo for hr-backend" --project="$PROJECT_ID"
fi

############# SECRETS (INSTRUCTIONS) #############
echo "== Secrets: create them in Secret Manager (NOT stored here) =="
cat <<'EOF'
# Example (interactive, DO NOT run with real secrets hardcoded in script):
# echo -n "VALOR_REAL" | gcloud secrets create DATABASE_URL --data-file=- --project="$PROJECT_ID"
# echo -n "VALOR_REAL" | gcloud secrets create JWT_SECRET --data-file=- --project="$PROJECT_ID"
# echo -n "VALOR_REAL" | gcloud secrets create JWT_REFRESH_SECRET --data-file=- --project="$PROJECT_ID"
# echo -n "VALOR_REAL" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=- --project="$PROJECT_ID"
# echo -n "VALOR_REAL" | gcloud secrets create SWAGGER_PASSWORD --data-file=- --project="$PROJECT_ID"
# echo -n "VALOR_REAL" | gcloud secrets create CRON_SECRET --data-file=- --project="$PROJECT_ID"
# If DNI token applies:
# echo -n "VALOR_REAL" | gcloud secrets create DNI_API_TOKEN --data-file=- --project="$PROJECT_ID"
EOF

############# CLOUD BUILD (build & push) #############
echo "== Submitting build to Cloud Build =="
gcloud builds submit --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$IMAGE_NAME:$IMAGE_TAG" --project="$PROJECT_ID"

############# DEPLOY CLOUD RUN #############
echo "== Deploying to Cloud Run =="

# Note: --set-secrets requires secret resource names on newer gcloud versions.
gcloud run deploy "$SERVICE_NAME" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$IMAGE_NAME:$IMAGE_TAG" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars NODE_ENV=production,PORT=8080,SUPABASE_URL="$SUPABASE_URL",SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY",SUPABASE_COMPANY_ASSETS_BUCKET=company-assets,SUPABASE_REQUEST_DOCUMENTS_BUCKET=request-documents,SUPABASE_ATTENDANCE_PHOTOS_BUCKET=attendance-photos,ENABLE_SWAGGER=true,SWAGGER_BASIC_AUTH=true,SWAGGER_USER=admin,REPORT_STORAGE_MODE=download,REPORT_BUCKET=reports,LOG_LEVEL=info,DNI_API_PROVIDER=decolecta,DNI_API_URL=https://api.decolecta.com/v1/reniec/dni,CORS_ORIGIN="$CORS_ORIGIN" \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,SWAGGER_PASSWORD=SWAGGER_PASSWORD:latest,CRON_SECRET=CRON_SECRET:latest \
  --project="$PROJECT_ID"

# If DNI_API_TOKEN secret was created, append to --set-secrets mapping like:
# ,DNI_API_TOKEN=DNI_API_TOKEN:latest

############# SERVICE URL #############
echo "== Obtaining service URL =="
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project="$PROJECT_ID" --format="value(status.url)")
echo "Cloud Run URL: $SERVICE_URL"

############# POST-DEPLOY VALIDATIONS #############
echo "== Post-deploy health checks (these are simple HTTP checks) =="
echo "Checking /health"
curl -fsS --retry 3 "$SERVICE_URL/health" || echo "WARNING: /health check failed"
echo "Checking /health/db"
curl -fsS --retry 3 "$SERVICE_URL/health/db" || echo "WARNING: /health/db check failed"
echo "Checking /health/supabase"
curl -fsS --retry 3 "$SERVICE_URL/health/supabase" || echo "WARNING: /health/supabase check failed"

echo "Checking Swagger JSON (should be protected if Basic Auth enabled)"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/api-docs.json" || echo "000")
echo "api-docs.json HTTP status: $HTTP_STATUS (expected 401 if Basic Auth active)"

############# OPTIONAL: LOGIN DEMO (COMMENTED) #############
cat <<'EOF'
# Example login test (commented):
# curl -X POST "$SERVICE_URL/auth/login" \
#  -H "Content-Type: application/json" \
#  -d '{"email":"admin@demo.com","password":"Demo123!"}'
EOF

############# CLOUD SCHEDULER JOB (ATTENDANCE RUN) #############
echo "== Cloud Scheduler: creating job 'attendance-run-all' (requires CRON_SECRET_VALUE env var) =="
if [[ -z "${CRON_SECRET_VALUE-}" ]]; then
  echo "CRON_SECRET_VALUE not exported — skipping Scheduler creation. To create, export CRON_SECRET_VALUE before running this script. e.g.: export CRON_SECRET_VALUE=valor_real" 
else
  gcloud scheduler jobs create http attendance-run-all \
    --location="$REGION" \
    --schedule="59 23 * * *" \
    --time-zone="America/Lima" \
    --uri="$SERVICE_URL/jobs/attendance/run-all" \
    --http-method=POST \
    --headers="Content-Type=application/json,X-CRON-SECRET=$CRON_SECRET_VALUE" \
    --message-body='{"date":"auto"}' \
    --project="$PROJECT_ID"
  echo "Cloud Scheduler job created: attendance-run-all"
fi

echo "To manually run scheduler job for test:"
echo "gcloud scheduler jobs run attendance-run-all --location=\"$REGION\" --project=\"$PROJECT_ID\""

############# LOGS #############
echo "== Cloud Run logs (last 50 lines) =="
gcloud run services logs read "$SERVICE_NAME" --region="$REGION" --limit=50 --project="$PROJECT_ID"

echo "Done. Review output above for any warnings."
