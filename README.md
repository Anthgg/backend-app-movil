# Backend HR App - Cloud Run

Backend de plataforma de Recursos Humanos en Node.js/Express + Supabase/PostgreSQL.  
Desplegado en **Google Cloud Run** (europe-west1).

**BASE_URL:**  
`https://backend-app-movil-177686674468.europe-west1.run.app`

---

## Instalacion y ejecucion local

```bash
npm install
npm run dev   # desarrollo (nodemon)
npm start     # produccion local
```

---

## Variables de entorno requeridas

Ver `.env.example`. Las minimas requeridas:

| Variable | Descripcion |
|----------|-------------|
| `DATABASE_URL` | Connection string PostgreSQL (Supabase) |
| `JWT_SECRET` | Clave firma accessToken (15 min) |
| `JWT_REFRESH_SECRET` | Clave firma refreshToken (7 dias) |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave server-side obligatoria para uploads a Supabase Storage |

Variables opcionales recomendadas para Storage:

| Variable | Valor por defecto |
|----------|-------------------|
| `SUPABASE_PUBLISHABLE_KEY` | Solo necesaria si otra herramienta del entorno la usa |
| `SUPABASE_COMPANY_ASSETS_BUCKET` | `company-assets` |
| `SUPABASE_REQUEST_DOCUMENTS_BUCKET` | `request-documents` |
| `SUPABASE_ATTENDANCE_PHOTOS_BUCKET` | `attendance-photos` |

---

## Rutas Publicas

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Root - info de API |
| GET | `/health` | Estado general del backend |
| GET | `/health/db` | Estado de conexion a PostgreSQL |
| GET | `/health/supabase` | Estado de Supabase Storage y buckets requeridos |
| GET | `/routes` | Listado completo de rutas |
| POST | `/api/login` | Login principal (alias movil) |
| POST | `/api/auth/login` | Login alias auth |
| POST | `/auth/login` | Login ruta original |
| POST | `/auth/refresh-token` | Renovar accessToken |

---

## Autenticacion

**Login:**
```http
POST /api/login
Content-Type: application/json

{ "email": "usuario@empresa.com", "password": "contrasena" }
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { "id": "uuid", "email": "...", "role": "RRHH" }
  }
}
```

**Rutas protegidas:** `Authorization: Bearer <accessToken>`

---

## Rutas Protegidas (requieren Bearer token)

| Metodo | Ruta | Rol minimo |
|--------|------|-----------|
| GET | `/auth/me` | Cualquiera |
| POST | `/auth/logout` | Cualquiera |
| GET | `/users` | RRHH / ADMIN |
| GET | `/workers` | RRHH / ADMIN |
| GET | `/attendance/today` | RRHH / ADMIN |
| GET | `/attendance/my-records` | TRABAJADOR |
| GET | `/devices/my` | Cualquiera |
| GET | `/dashboard/summary` | RRHH / ADMIN |
| GET | `/reports/attendance` | RRHH / ADMIN |
| GET | `/payroll/periods` | RRHH / ADMIN |
| GET | `/payroll` | Alias -> `/payroll/periods` |

---

## Notas de Schema (Supabase/PostgreSQL)

- `users.first_name` + `users.last_name` son los campos oficiales.  
  `full_name` se construye como `CONCAT_WS(' ', first_name, last_name)` y no es columna fisica.
- `attendance_records.user_id` es columna oficial (backfill + trigger en migracion 21).
- `payroll_periods` tiene columnas `company_id`, `year`, `month` como campos oficiales (migracion 18 + 21).

---

## Storage

Provisiona buckets antes del primer despliegue o al crear un proyecto nuevo:

```bash
npm run storage:ensure
```

Este script verifica o crea:

- `company-assets`
- `request-documents`
- `attendance-photos`

---

## Despliegue (Google Cloud Run)

```bash
git add .
git commit -m "mensaje"
git push origin main
# Cloud Build detecta el push y despliega automaticamente
```

Infraestructura: `Dockerfile` con Node 20-alpine, `.dockerignore` seguro y secretos via Secret Manager.
