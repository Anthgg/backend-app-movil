require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const checkRLS = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Conectado a la base de datos para verificar RLS...");

    const query = `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        c.relkind AS object_type,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS force_rls_enabled,
        COUNT(p.policyname) AS policy_count,
        ARRAY_AGG(p.policyname) FILTER (WHERE p.policyname IS NOT NULL) AS policy_names,
        EXISTS (
          SELECT 1 FROM information_schema.columns col 
          WHERE col.table_schema = n.nspname AND col.table_name = c.relname AND col.column_name = 'company_id'
        ) as has_company_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policies p
        ON p.schemaname = n.nspname
       AND p.tablename = c.relname
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'v', 'm')
      GROUP BY n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname;
    `;

    const res = await client.query(query);
    const tables = res.rows;

    let mdContent = `# Reporte de RLS Supabase\n\n`;
    let totalTables = 0;
    let withRls = 0;
    let withoutRls = [];
    let withPolicies = 0;
    let withoutPolicies = [];
    let viewsDetected = [];
    let sensitiveMissingRls = 0;

    const sensitiveTablesList = [
        "companies", "users", "roles", "permissions", "role_permissions", "user_roles", 
        "workers", "job_positions", "departments", "projects", "project_assignments", 
        "work_schedules", "shifts", "worker_shifts", "attendance_records", "attendance_evidence", 
        "attendance_corrections", "employee_requests", "request_types", "request_documents", 
        "vacations", "leave_balances", "medical_leaves", "documents", "document_types", 
        "payroll_periods", "payroll_records", "payroll_concepts", "payroll_record_items", 
        "payroll_adjustments", "generated_reports", "job_runs", "audit_logs", "user_devices", "notifications"
    ];

    tables.forEach(row => {
      if (row.object_type === 'v' || row.object_type === 'm') {
        viewsDetected.push(row);
      } else if (row.object_type === 'r') {
        totalTables++;
        if (row.rls_enabled) {
          withRls++;
          if (row.policy_count > 0) {
            withPolicies++;
          } else {
            withoutPolicies.push(row);
          }
        } else {
          withoutRls.push(row);
          if (sensitiveTablesList.includes(row.table_name)) {
             sensitiveMissingRls++;
          }
        }
      }
    });

    const risk = sensitiveMissingRls > 0 ? 'NO-GO' : (withoutRls.length > 0 ? 'PARTIAL GO' : 'GO');

    mdContent += `## Resumen\n`;
    mdContent += `- Total tablas public: ${totalTables}\n`;
    mdContent += `- Tablas con RLS: ${withRls}\n`;
    mdContent += `- Tablas sin RLS: ${withoutRls.length}\n`;
    mdContent += `- Tablas con policies: ${withPolicies}\n`;
    mdContent += `- Tablas sin policies: ${withoutPolicies.length}\n`;
    mdContent += `- Vistas detectadas: ${viewsDetected.length}\n`;
    mdContent += `- Riesgo general: ${risk}\n\n`;

    mdContent += `## Tablas sin RLS\n\n`;
    if (withoutRls.length > 0) {
      mdContent += `| Tabla | Tiene company_id | Policies | Riesgo | Recomendación |\n`;
      mdContent += `|---|---|---|---|---|\n`;
      withoutRls.forEach(row => {
        const isSensitive = sensitiveTablesList.includes(row.table_name);
        const tRisk = isSensitive ? 'ALTO' : 'BAJO';
        const rec = isSensitive ? 'Habilitar RLS URGENTE' : 'Revisar si requiere RLS';
        mdContent += `| ${row.table_name} | ${row.has_company_id} | ${row.policy_count} | ${tRisk} | ${rec} |\n`;
      });
    } else {
      mdContent += `*Todas las tablas tienen RLS habilitado.*\n`;
    }

    mdContent += `\n## Tablas con RLS pero sin policies\n\n`;
    if (withoutPolicies.length > 0) {
      mdContent += `| Tabla | Riesgo | Recomendación |\n`;
      mdContent += `|---|---|---|\n`;
      withoutPolicies.forEach(row => {
        mdContent += `| ${row.table_name} | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |\n`;
      });
    } else {
      mdContent += `*Todas las tablas con RLS tienen policies.*\n`;
    }

    mdContent += `\n## Vistas\n\n`;
    if (viewsDetected.length > 0) {
      viewsDetected.forEach(v => {
        mdContent += `- **${v.table_name}** (Tipo: ${v.object_type === 'v' ? 'View' : 'Materialized View'}). Revisar si necesita \`security_invoker = true\`.\n`;
      });
    } else {
      mdContent += `*No se detectaron vistas en el schema public.*\n`;
    }

    mdContent += `\n## Decisión\n`;
    mdContent += `${risk}\n`;

    const reportDir = path.join(__dirname, '..', 'tests', 'qa-reports');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'rls-status-report.md'), mdContent, 'utf8');

    console.log("✅ Reporte generado en tests/qa-reports/rls-status-report.md");
    if (risk === 'NO-GO') {
        console.error("❌ Faltan RLS en tablas sensibles. La decisión es NO-GO.");
        process.exit(1);
    } else {
        console.log(`✅ Riesgo es ${risk}.`);
        process.exit(0);
    }

  } catch (error) {
    console.error("Error al consultar la BD:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

checkRLS();
