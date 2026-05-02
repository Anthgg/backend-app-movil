# Entorno de Producción Local (`.env.production.local`)

El archivo `.env.production.local` es vital para realizar la **prueba local con Docker** imitando exactamente las condiciones que tendrá el contenedor dentro de Google Cloud Run.

## Reglas Críticas

1. **Es exclusivo de tu máquina**: Este archivo NUNCA debe subirse a Git. Ya está protegido por las exclusiones `.env.*` del `.gitignore`.
2. **Debe contener SECRETOS REALES y SEGUROS**: No uses secretos de tipo "password123". Genera claves fuertes criptográficas (usa `npm run generate:secrets`).
3. **Validación Automática**: El comando `npm run check:prod-secrets` validará que este archivo contenga longitudes criptográficas robustas y sin colisiones antes de dejarte desplegar.

## Uso con Docker

Este archivo permite inicializar la imagen recién construida pasándole todo el entorno productivo de un solo golpe:

```bash
docker run --env-file .env.production.local -p 8080:8080 hr-backend
```

Si todo inicia correctamente, significa que las credenciales para la DB y configuración de secretos están sanas y el despliegue manual a Cloud Run funcionará de manera equivalente.
