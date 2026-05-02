# Guía de Google Secret Manager

Para mantener el backend completamente seguro en Google Cloud Run, debes almacenar los secretos criptográficos directamente en **Google Secret Manager**, evitando exponerlos en el panel de Cloud Run y en el código.

## 1. Crear Nuevos Secretos

Usa los siguientes comandos remplazando los strings generados por `npm run generate:secrets` y la URI real de tu base de datos:

```bash
# Crear secretos principales
echo -n "TU_DATABASE_URL_REAL" | gcloud secrets create DATABASE_URL --data-file=-
echo -n "TU_JWT_SECRET_GENERADO" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "TU_JWT_REFRESH_SECRET_GENERADO" | gcloud secrets create JWT_REFRESH_SECRET --data-file=-
echo -n "TU_SWAGGER_PASSWORD_GENERADO" | gcloud secrets create SWAGGER_PASSWORD --data-file=-
echo -n "TU_CRON_SECRET_GENERADO" | gcloud secrets create CRON_SECRET --data-file=-

# Si aplica la API de DNI
echo -n "TU_DNI_API_TOKEN_REAL" | gcloud secrets create DNI_API_TOKEN --data-file=-
```

## 2. Actualizar Secretos Existentes (Rotación)

Si un secreto ya existe pero quieres rotarlo o fue expuesto, Cloud Manager trabaja mediante "Versiones". Añadir una versión automáticamente la convierte en `latest`.

```bash
echo -n "NUEVO_VALOR_GENERADO" | gcloud secrets versions add JWT_SECRET --data-file=-
echo -n "NUEVO_VALOR_GENERADO" | gcloud secrets versions add JWT_REFRESH_SECRET --data-file=-
echo -n "NUEVO_VALOR_GENERADO" | gcloud secrets versions add CRON_SECRET --data-file=-
echo -n "NUEVO_VALOR_GENERADO" | gcloud secrets versions add SWAGGER_PASSWORD --data-file=-
echo -n "NUEVO_VALOR_REAL_CON_PASSWORD_NUEVA" | gcloud secrets versions add DATABASE_URL --data-file=-
```

## 3. Rotación obligatoria antes del despliegue

**⚠️ IMPORTANTE**: Si compartiste capturas de pantalla, archivos o código con credenciales activas, **DEBES ROTAR TODO** antes de usar Cloud Run:

1. Ve a Supabase -> Project Settings -> Database -> **Reset Database Password**.
2. Actualiza tu `DATABASE_URL` en Secret Manager usando el nuevo password.
3. Genera nuevos `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, y `SWAGGER_PASSWORD` usando `npm run generate:secrets`.
4. Rota el token de `DNI_API_TOKEN` si está comprometido.
5. Sube las nuevas claves mediante `gcloud secrets versions add`.
6. Verifica que el sistema siga vivo ejecutando localmente: `npm run test:connections`.
