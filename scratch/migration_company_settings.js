const { query } = require('../src/config/database');

const up = async () => {
  try {
    console.log('Creando tabla company_settings...');
    await query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        razon_social VARCHAR(200) NOT NULL,
        nombre_comercial VARCHAR(200),
        ruc VARCHAR(20) NOT NULL,
        direccion_fiscal TEXT,
        telefono VARCHAR(30),
        correo_corporativo VARCHAR(150),
        pagina_web VARCHAR(150),
        representante_legal VARCHAR(200),
        cargo_representante VARCHAR(150),
        logo_url TEXT,
        firma_url TEXT,
        sello_url TEXT,
        color_primario VARCHAR(20),
        color_secundario VARCHAR(20),
        estado BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Agregando constraint UNIQUE para company_id...');
    await query(`
      ALTER TABLE company_settings
      DROP CONSTRAINT IF EXISTS company_settings_company_id_unique;
    `);
    await query(`
      ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_company_id_unique UNIQUE (company_id);
    `);
    
    // Si la tabla companies existe, agregamos el foreign key (manejado con catch por si no existe)
    try {
        console.log('Intentando agregar foreign key...');
        await query(`
            ALTER TABLE company_settings
            DROP CONSTRAINT IF EXISTS company_settings_company_id_fk;
            
            ALTER TABLE company_settings
            ADD CONSTRAINT company_settings_company_id_fk 
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
        `);
        console.log('Foreign key agregado.');
    } catch(e) {
        console.log('Nota: No se pudo agregar la FK (probablemente la tabla companies no existe como tal en este entorno)');
    }

    // Add updated_at trigger if set_updated_at function exists
    try {
        await query(`
            DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
            CREATE TRIGGER trg_company_settings_updated_at
            BEFORE UPDATE ON company_settings
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `);
        console.log('Trigger added');
    } catch (e) {
        console.log('Nota: Trigger de actualizacion no creado (posiblemente falta la funcion)');
    }

    console.log('Migración de company_settings completada correctamente.');
  } catch (err) {
    console.error('Error en migración:', err);
  } finally {
    process.exit(0);
  }
};

up();
