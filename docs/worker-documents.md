# Contrato backend — Documentos del trabajador

Fuente única: `worker_documents`.

No consumir ni escribir la tabla legacy `documents` para documentos del trabajador.

## Móvil / trabajador

```http
GET /api/mobile/documents/my
```

Lista documentos del trabajador autenticado. El backend resuelve el `workerId` desde el token.

```http
POST /api/mobile/documents/my
Content-Type: multipart/form-data
```

Campos aceptados:

- `file`, `document` o `documents`
- `type` / `documentType` / `document_type`
- `title`
- `description`
- `documentId` si se reemplaza un pendiente/observado/rechazado

```http
DELETE /api/mobile/documents/my/:documentId
```

Permite borrar documentos propios solo si no están aprobados, generados o firmados.

## Web / RRHH

```http
GET /api/documents
```

Filtros:

- `workerId` / `worker_id`
- `status`
- `type` / `documentType` / `document_type`
- `search`
- `page`
- `pageSize` / `limit`

```http
GET /api/documents/:documentId
POST /api/documents/workers/:workerId
PATCH /api/documents/:documentId/review
DELETE /api/documents/:documentId
GET /api/documents/types
```

Todas las rutas requieren `Authorization: Bearer <token>`. `ADMIN`, `RRHH` y
`SUPERVISOR` pueden consultar; solo `ADMIN` y `RRHH` pueden subir, revisar y
eliminar.

La lista responde directamente:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 10
}
```

`GET /api/documents/types` responde directamente el arreglo:

```json
[
  "DNI",
  "CV",
  "MEDICAL_CERTIFICATE",
  "BACKGROUND_CHECK",
  "STUDIES_CERTIFICATE"
]
```

La carga web acepta exactamente un archivo en `file`, más `type`, `title`,
`description` opcional y `documentId` opcional para reemplazo. Solo admite PDF,
PNG o JPG de hasta 10 MB. El backend valida firma binaria, calcula SHA-256 antes
de subir y rechaza contenido duplicado con `422 DUPLICATE_DOCUMENT_FILE`.

La revisión acepta exclusivamente `approved`, `rejected` u `observed`.
`reviewComment` es obligatorio para `rejected` y `observed`.

El borrado responde `204` y solo se realiza cuando `canDelete` es `true`.
Los documentos `approved`, `generated` o `signed` no se pueden eliminar ni
reemplazar.

`POST /api/workers/:workerId/documents` sigue disponible y delega al mismo servicio.

## DTO principal

```json
{
  "id": "uuid",
  "workerId": "uuid",
  "worker_id": "uuid",
  "workerName": "Nombre Apellido",
  "worker_name": "Nombre Apellido",
  "type": "DNI",
  "documentType": "DNI",
  "document_type": "DNI",
  "title": "DNI",
  "status": "pending",
  "fileName": "dni.pdf",
  "file_name": "dni.pdf",
  "mimeType": "application/pdf",
  "mime_type": "application/pdf",
  "sizeBytes": 12345,
  "size_bytes": 12345,
  "fileUrl": "https://...",
  "file_url": "https://...",
  "uploadedAt": "2026-06-23T00:00:00.000Z",
  "uploaded_at": "2026-06-23T00:00:00.000Z",
  "reviewedAt": null,
  "reviewed_at": null,
  "reviewComment": null,
  "review_comment": null,
  "canDelete": true,
  "canReplace": true
}
```

Estados expuestos por la API: `missing`, `pending`, `approved`, `rejected`,
`observed`, `generated`, `signed`, `expired` y `available`.

## Onboarding

`POST /api/workers/onboarding` puede recibir documentos requeridos:

```json
{
  "requiredDocuments": [
    { "type": "DNI", "title": "DNI" },
    { "type": "CV", "title": "CV" },
    { "type": "MEDICAL_CERTIFICATE", "title": "Certificado medico" }
  ]
}
```

El backend crea esos registros como `missing` en `worker_documents`. Flutter los muestra como pendientes y RRHH los revisa desde web.
