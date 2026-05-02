# Backend HR App (Microservices Architecture)

Este es el backend de la plataforma de Recursos Humanos, preparado para correr bajo Docker y Google Cloud Run.

## 1. Instalación local:
```bash
npm install
```

## 2. Ejecución local:
```bash
npm run dev
# o
npm start
```

## 3. Variables de entorno requeridas:
El proyecto necesita un archivo `.env` en la raíz (ver `.env.example`):
- `NODE_ENV`
- `PORT`
- `DATABASE_URL` (Debe ser un connection string de PostgreSQL)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `CRON_SECRET`
- `SWAGGER_PASSWORD`

## 4. Despliegue:
Este proyecto está preparado para **Google Cloud Run** usando Cloud Build desde GitHub. Cuenta con:
- `Dockerfile` productivo con Node 20-alpine.
- `.dockerignore` seguro.
- Servidor escuchando en `0.0.0.0`.
- Control de variables sensibles mediante Secret Manager.
