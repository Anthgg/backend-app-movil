const { query } = require('../src/config/database');

const up = async () => {
  try {
    console.log('Agregando color_texto a company_settings...');
    await query(`
      ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS color_texto VARCHAR(20) DEFAULT '#0F172A';
    `);

    // Actualizar registros antiguos que ya existían sin color
    await query(`
      UPDATE company_settings
      SET color_texto = '#0F172A'
      WHERE color_texto IS NULL;
    `);

    console.log('Migración de color_texto completada correctamente.');
  } catch (err) {
    console.error('Error en migración:', err);
  } finally {
    process.exit(0);
  }
};

up();
