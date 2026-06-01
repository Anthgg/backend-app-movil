const PDFDocument = require('pdfkit');

/**
 * Generate a PDF document buffer for a user profile
 */
exports.generateUserProfilePdf = async (userData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(20).text('Perfil de Usuario', { align: 'center' });
      doc.moveDown();

      doc.fontSize(14).text(`Nombre: ${userData.fullName || 'No especificado'}`);
      doc.fontSize(12).text(`Email: ${userData.email || 'No especificado'}`);
      doc.fontSize(12).text(`Usuario: ${userData.username || 'No especificado'}`);
      doc.fontSize(12).text(`Teléfono: ${userData.phone || 'No especificado'}`);
      doc.fontSize(12).text(`Documento: ${userData.document_number || 'No especificado'}`);
      doc.fontSize(12).text(`Roles: ${userData.role || 'No especificado'}`);
      doc.moveDown();

      if (userData.worker) {
        doc.fontSize(16).text('Ficha Laboral', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(12).text(`Empresa: ${userData.worker.company_name || 'No especificado'}`);
        doc.fontSize(12).text(`Sede: ${userData.worker.branch_name || 'No especificado'}`);
        doc.fontSize(12).text(`Departamento: ${userData.worker.department_name || 'No especificado'}`);
        doc.fontSize(12).text(`Área: ${userData.worker.area_name || 'No especificado'}`);
        doc.fontSize(12).text(`Cargo: ${userData.worker.position || 'No especificado'}`);
        doc.fontSize(12).text(`Obra: ${userData.worker.work_location_name || 'No especificado'}`);
        if (userData.worker.crew_name) {
          doc.fontSize(12).text(`Cuadrilla: ${userData.worker.crew_name}`);
        }
        if (userData.worker.supervised_crew_name) {
          doc.fontSize(12).text(`Supervisa la cuadrilla: ${userData.worker.supervised_crew_name}`);
        }
        doc.fontSize(12).text(`Estado: ${userData.worker.status || 'No especificado'}`);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Generate a PDF document buffer for a password reset receipt
 */
exports.generatePasswordResetPdf = async (userData, tempPassword, actorName) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(20).text('Constancia de Restablecimiento de Contraseña', { align: 'center' });
      doc.moveDown(2);

      doc.fontSize(12).text(`Fecha: ${new Date().toLocaleString()}`);
      doc.fontSize(12).text(`Usuario Afectado: ${userData.fullName || userData.email}`);
      doc.fontSize(12).text(`Gestionado por: ${actorName || 'Administrador del Sistema'}`);
      
      doc.moveDown(2);
      doc.fontSize(14).text('Nueva Contraseña Temporal:', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(16).text(tempPassword, { align: 'center' });
      
      doc.moveDown(2);
      doc.fontSize(10).text('NOTA: Por razones de seguridad, el usuario deberá cambiar esta contraseña en su próximo inicio de sesión.', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
