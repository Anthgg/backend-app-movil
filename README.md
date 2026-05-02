# Backend HR App — Cloud Run

Backend de plataforma de Recursos Humanos en Node.js/Express + Supabase/PostgreSQL.  
Desplegado en **Google Cloud Run** (europe-west1).

**BASE_URL:**  
`https://backend-app-movil-177686674468.europe-west1.run.app`

---

## Instalación y ejecución local

```bash
npm install
npm run dev   # desarrollo (nodemon)
npm start     # producción local
```

---

## Variables de entorno requeridas

Ver `.env.example`. Las mínimas requeridas:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Connection string PostgreSQL (Supabase) |
| `JWT_SECRET` | Clave firma accessToken (15 min) |
| `JWT_REFRESH_SECRET` | Clave firma refreshToken (7 días) |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Clave pública Supabase |

---

## Rutas Públicas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Root — info de API |
| GET | `/health` | Estado general del backend |
| GET | `/health/db` | Estado de conexión a PostgreSQL |
| GET | `/routes` | Listado completo de rutas |
| POST | `/api/login` | Login principal (alias móvil) |
| POST | `/api/auth/login` | Login alias auth |
| POST | `/auth/login` | Login ruta original |
| POST | `/auth/refresh-token` | Renovar accessToken |

---

## Autenticación

**Login:**
```http
POST /api/login
Content-Type: application/json

{ "email": "usuario@empresa.com", "password": "contraseña" }
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

| Método | Ruta | Rol mínimo |
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
| GET | `/payroll` | Alias → `/payroll/periods` |

---

## Notas de Schema (Supabase/PostgreSQL)

- `users.first_name` + `users.last_name` son los campos **oficiales**.  
  `full_name` se construye como `CONCAT_WS(' ', first_name, last_name)` — no es columna física.
- `attendance_records.user_id` es columna oficial (backfill + trigger en migración 21).
- `payroll_periods` tiene columnas `company_id`, `year`, `month` como campos oficiales (migración 18 + 21).

---

## Despliegue (Google Cloud Run)

```bash
git add .
git commit -m "mensaje"
git push origin main
# Cloud Build detecta el push y despliega automáticamente
```

Infraestructura: `Dockerfile` con Node 20-alpine · `.dockerignore` seguro · Secrets vía Secret Manager.

