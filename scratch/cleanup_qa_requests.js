const { query } = require('../src/config/database');
(async () => {
  try {
    const res = await query("DELETE FROM request_documents WHERE request_id IN (SELECT id FROM employee_requests WHERE reason LIKE '%QA Test%')");
    console.log('Docs eliminados:', res.rowCount);
    const res2 = await query("DELETE FROM employee_requests WHERE reason LIKE '%QA Test%'");
    console.log('Solicitudes QA eliminadas:', res2.rowCount);
    process.exit(0);
  } catch(e) { console.error(e.message); process.exit(1); }
})();
