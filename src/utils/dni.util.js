async function fetchDniData(dni) {
  // Simula un retardo de red
  await new Promise(resolve => setTimeout(resolve, 500));

  // Simulamos algunos DNIs comunes o devolvemos datos genéricos
  if (!/^[0-9]{8}$/.test(dni)) {
    throw new Error('El DNI debe tener 8 dígitos');
  }

  // Base mock
  return {
    dni,
    nombres: 'Juan Carlos',
    apellido_paterno: 'Pérez',
    apellido_materno: 'Gómez',
    cod_verifica: '1'
  };
}

module.exports = {
  fetchDniData
};
