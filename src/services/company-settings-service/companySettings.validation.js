const validateCompanySettings = (data) => {
  const errors = [];
  const value = { ...data };

  if (!value.razon_social || typeof value.razon_social !== 'string' || value.razon_social.trim() === '') {
    errors.push({ path: ['razon_social'], message: 'La razón social es obligatoria' });
  }

  if (!value.ruc || typeof value.ruc !== 'string' || !/^[0-9]{11}$/.test(value.ruc.trim())) {
    errors.push({ path: ['ruc'], message: 'El RUC es obligatorio y debe tener exactamente 11 dígitos' });
  }

  if (value.correo_corporativo && typeof value.correo_corporativo === 'string' && value.correo_corporativo.trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.correo_corporativo)) {
      errors.push({ path: ['correo_corporativo'], message: 'El correo corporativo debe ser un email válido' });
    }
  }

  if (value.pagina_web && typeof value.pagina_web === 'string' && value.pagina_web.trim() !== '') {
    if (!/^https?:\/\/.+/.test(value.pagina_web)) {
      errors.push({ path: ['pagina_web'], message: 'La página web debe ser una URL válida' });
    }
  }

  if (value.color_primario && typeof value.color_primario === 'string' && value.color_primario.trim() !== '') {
    if (!/^#([0-9A-F]{3}){1,2}$/i.test(value.color_primario)) {
      errors.push({ path: ['color_primario'], message: 'El color primario debe ser un código HEX válido (ej. #FFFFFF)' });
    }
  }

  if (value.color_secundario && typeof value.color_secundario === 'string' && value.color_secundario.trim() !== '') {
    if (!/^#([0-9A-F]{3}){1,2}$/i.test(value.color_secundario)) {
      errors.push({ path: ['color_secundario'], message: 'El color secundario debe ser un código HEX válido (ej. #FFFFFF)' });
    }
  }

  // Sanitización y auto-corrección para color_texto
  if (!value.color_texto || typeof value.color_texto !== 'string' || value.color_texto.trim() === '') {
    value.color_texto = '#0F172A'; // Valor por defecto seguro
  } else {
    value.color_texto = value.color_texto.trim();
    if (!value.color_texto.startsWith('#')) {
      value.color_texto = '#' + value.color_texto;
    }
    // Si aún después de intentar arreglarlo no es un HEX válido, forzamos el default en vez de fallar
    if (!/^#([0-9A-F]{3}){1,2}$/i.test(value.color_texto)) {
      value.color_texto = '#0F172A';
    }
  }

  if (errors.length > 0) {
    return { error: { details: errors }, value: null };
  }

  return { error: null, value };
};

module.exports = {
  validateCompanySettings
};
