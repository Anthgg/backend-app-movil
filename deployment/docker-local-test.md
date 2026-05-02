# Prueba Local con Docker

Antes de desplegar en Google Cloud Run, es fundamental validar que la imagen de Docker se construya correctamente y que el contenedor funcione con variables reales (pero seguras) en tu máquina local.

## 1. Validar Docker Desktop
Asegúrate de que Docker Desktop esté abierto y ejecutándose en tu PC.
```bash
docker version
```

## 2. Construir la Imagen
Este comando usará tu `Dockerfile` para empaquetar el backend.
```bash
docker build -t hr-backend .
```

## 3. Ejecutar el Contenedor Local
Usaremos el archivo `.env.production.local` que no está versionado en Git para probar el entorno sin exponer secretos reales en el código fuente.
```bash
docker run --env-file .env.production.local -p 8080:8080 hr-backend
```

## 4. Probar Endpoints de Salud (Health Checks)
Verifica la conexión a Supabase y el estado de los servicios (desde tu navegador o PowerShell):
```powershell
curl http://localhost:8080/health
curl http://localhost:8080/health/db
curl http://localhost:8080/health/supabase
```

## 5. Probar Swagger y Autenticación
Ingresa desde tu navegador a:
- [http://localhost:8080/api-docs](http://localhost:8080/api-docs) (Debe pedir el usuario y contraseña configurados en SWAGGER_USER y SWAGGER_PASSWORD)

## 6. Probar Login
Si tienes un usuario demo, intenta iniciar sesión usando PowerShell:
```powershell
curl -X POST http://localhost:8080/auth/login `
     -H "Content-Type: application/json" `
     -d '{"email":"admin@demo.com","password":"Demo123!"}'
```

---

## ⚠️ Errores Comunes Docker

Dado que la validación local podría fallar, aquí tienes una lista de los problemas más frecuentes:

- **Docker daemon no está iniciado:** El error `error during connect: Head "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/_ping"` indica que debes abrir Docker Desktop primero.
- **.env.production.local no existe:** Asegúrate de haber guardado el archivo con tus secretos locales.
- **DATABASE_URL incorrecto:** Verifica que el string de conexión contenga el password correcto de Supabase y no tenga caracteres especiales sin escape.
- **Password de Supabase incorrecta:** No debes usar comillas en el URL a menos que estén encodeadas en el URL.
- **Puerto 8080 ocupado:** Asegúrate de que no haya otra aplicación local consumiendo el puerto 8080.
- **Error SSL con Supabase:** Tu entorno local podría estar bloqueando el certificado de Postgres SSL nativo de Supabase.
- **Falta dependencia en producción:** Algunas librerías requeridas en runtime fueron puestas en `devDependencies` por error.
- **App no escucha en 0.0.0.0:** Cloud Run requiere que el backend no esté limitado a escuchar en `localhost` (`127.0.0.1`), sino en cualquier interfaz (`0.0.0.0`).
- **process.env.PORT no usado correctamente:** El backend debe tomar dinámicamente el puerto que Docker le inyecta por defecto (8080).
- **Swagger Basic Auth mal configurado:** Valida que `SWAGGER_BASIC_AUTH` sea `true` y haya cargado correctamente las credenciales del `.env`.
