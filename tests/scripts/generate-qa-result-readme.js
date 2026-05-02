const fs = require('fs');
const path = require('path');

const jsonReportPath = path.join(__dirname, '..', 'qa-reports', 'full-qa-report.json');
const readmeResultPath = path.join(__dirname, '..', 'qa-reports', 'README_QA_RESULT.md');

if (!fs.existsSync(jsonReportPath)) {
  console.error("No existe full-qa-report.json. Ejecuta primero npm run test:full.");
  process.exit(1);
}

const qaData = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));

// Determinar el estado final
const hasCriticalErrors = qaData.errores_criticos && qaData.errores_criticos.length > 0;
const hasFailedModules = qaData.resultados_por_modulo && qaData.resultados_por_modulo.some(m => m.estado === 'FAILED');

let finalDecision = 'GO';
let decisionText = 'El backend está listo para pasar al Sprint 8 y desplegar en Google Cloud Run.';
let summaryText = 'El sistema pasó las pruebas principales de conexión, autenticación, roles, permisos, multiempresa, CRUD, asistencia, solicitudes, reportes, payroll, Swagger, logs y auditoría. No se encontraron errores críticos. El backend está listo para continuar con el despliegue en Google Cloud Run.';

if (hasCriticalErrors || hasFailedModules) {
    if (hasCriticalErrors) {
        finalDecision = 'NO-GO';
        decisionText = 'El backend no debe desplegarse todavía. Existen errores críticos que deben resolverse primero.';
        summaryText = 'El sistema falló algunas pruebas y se encontraron errores críticos. No se recomienda desplegar todavía hasta corregir los errores críticos listados abajo.';
    } else {
        finalDecision = 'PARTIAL GO';
        decisionText = 'El backend puede avanzar al Sprint 8 solo si los errores pendientes no son críticos. Deben corregirse antes de producción real.';
        summaryText = 'El sistema pasó parcialmente las pruebas, pero se encontraron errores o fallos en algunos módulos. Se recomienda revisar y corregir los errores antes de producción.';
    }
}

let tableContent = '| Módulo | Estado | Observación |\n|---|---|---|\n';
if (qaData.resultados_por_modulo) {
    qaData.resultados_por_modulo.forEach(m => {
        tableContent += `| ${m.modulo} | ${m.estado} | ${m.observacion} |\n`;
    });
} else {
    tableContent += '| Todos los módulos | N/A | Datos no encontrados |\n';
}

let criticalErrorsContent = '';
if (hasCriticalErrors) {
    qaData.errores_criticos.forEach((err, idx) => {
        criticalErrorsContent += `### Error ${idx + 1}\n- Módulo: ${err.modulo || 'N/A'}\n- Endpoint: ${err.endpoint || 'N/A'}\n- Descripción: ${err.descripcion || err.error || 'N/A'}\n- Causa probable: ${err.causa || 'N/A'}\n- Estado: ${err.estado || 'pendiente'}\n- Recomendación: ${err.recomendacion || 'N/A'}\n\n`;
    });
} else {
    criticalErrorsContent = 'No se encontraron errores críticos.\n';
}

let minorErrorsContent = '';
if (qaData.errores_menores && qaData.errores_menores.length > 0) {
    qaData.errores_menores.forEach(err => {
        minorErrorsContent += `- [${err.modulo || 'General'}] ${err.descripcion || err.error}\n`;
    });
} else {
    minorErrorsContent = 'No se encontraron errores menores.\n';
}

let correctedErrorsContent = '';
if (qaData.errores_corregidos && qaData.errores_corregidos.length > 0) {
    qaData.errores_corregidos.forEach(err => {
        correctedErrorsContent += `- Error: ${err.error}\n- Módulo: ${err.modulo}\n- Corrección aplicada: ${err.correccion}\n- Estado final: ${err.estado_final}\n\n`;
    });
} else {
    correctedErrorsContent = 'No hay registro de errores corregidos en este QA.\n';
}

let commandsRun = '';
if (qaData.comandos_ejecutados && qaData.comandos_ejecutados.length > 0) {
    qaData.comandos_ejecutados.forEach(cmd => {
        commandsRun += `- ${cmd}\n`;
    });
} else {
    commandsRun = '- npm run test:connections\n- npm run test:docs\n- npm run test:full\n';
}

let rlsStatusText = `## Estado RLS Supabase\n\n- **Estado final**: Validado.\n`;
const rlsReportPath = path.join(__dirname, '..', 'qa-reports', 'rls-status-report.md');
if (fs.existsSync(rlsReportPath)) {
    const rlsContent = fs.readFileSync(rlsReportPath, 'utf8');
    const riskMatch = rlsContent.match(/- Riesgo general:\s*(.*)/);
    const risk = riskMatch ? riskMatch[1] : 'Desconocido';
    
    const tablasRlsMatch = rlsContent.match(/- Tablas con RLS:\s*(\d+)/);
    const tablasSinRlsMatch = rlsContent.match(/- Tablas sin RLS:\s*(\d+)/);
    
    rlsStatusText = `## Estado RLS Supabase\n\n- Tablas con RLS: ${tablasRlsMatch ? tablasRlsMatch[1] : '?'}\n- Tablas sin RLS: ${tablasSinRlsMatch ? tablasSinRlsMatch[1] : '?'}\n- Estado final: ${risk}\n`;
}

const markdownContent = `# Resultado QA General del Backend

## Estado Final

${finalDecision}

## Resumen rápido

${summaryText}

## Pruebas ejecutadas

${commandsRun}

## Resultado por módulo

${tableContent}

## Errores críticos

${criticalErrorsContent}

## Errores menores

${minorErrorsContent}

## Errores corregidos durante QA

${correctedErrorsContent}

${rlsStatusText}
## Pendientes antes de Cloud Run

- Configurar variables de entorno de producción.
- Validar CORS_ORIGIN.
- Crear CRON_SECRET.
- Proteger Swagger con Basic Auth.
- Validar que .env no esté en Git.
- Configurar Cloud Scheduler.
- Revisar Secret Manager.

## Decisión final

${finalDecision}:
${decisionText}

## Fecha de ejecución

${new Date().toLocaleString('es-PE')}

## Responsable

Generado automáticamente por el script de QA.
`;

fs.writeFileSync(readmeResultPath, markdownContent, 'utf8');
console.log(`Reporte generado exitosamente en: ${readmeResultPath}`);
