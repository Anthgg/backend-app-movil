const ACTIVITY_TRANSLATIONS = {
  OTHER_SESSIONS_REVOKED: { scope: 'SECURITY', label: 'Otras sesiones cerradas', description: 'Se cerraron otras sesiones activas desde el perfil.' },
  SESSION_REVOKED: { scope: 'SECURITY', label: 'Sesión cerrada', description: 'Se cerró una sesión activa del usuario.' },
  DEVICE_TRUSTED: { scope: 'SECURITY', label: 'Dispositivo marcado como confiable', description: 'Se marcó este dispositivo como confiable para futuros accesos.' },
  PASSWORD_CHANGED: { scope: 'SECURITY', label: 'Contraseña actualizada', description: 'Se actualizó la contraseña de la cuenta.' },
  LOGIN_SUCCESS: { scope: 'SESSION', label: 'Inicio de sesión', description: 'Se inició sesión correctamente en la cuenta.' },
  LOGIN_FAILED: { scope: 'SECURITY', label: 'Intento de inicio de sesión fallido', description: 'Se registró un intento fallido de acceso a la cuenta.' },
  LOGOUT: { scope: 'SESSION', label: 'Cierre de sesión', description: 'Se cerró la sesión del usuario.' },
  SESSION_CREATED: { scope: 'SESSION', label: 'Sesión iniciada', description: 'Se creó una nueva sesión de acceso.' },
  SESSION_EXPIRED: { scope: 'SESSION', label: 'Sesión expirada', description: 'La sesión del usuario expiró automáticamente.' },
  PROFILE_UPDATED: { scope: 'PROFILE', label: 'Perfil actualizado', description: 'Se actualizaron los datos del perfil.' },
  PHOTO_UPLOADED: { scope: 'PROFILE', label: 'Foto de perfil actualizada', description: 'Se subió o actualizó la foto de perfil.' },
  PHOTO_UPDATED: { scope: 'PROFILE', label: 'Foto de perfil actualizada', description: 'Se actualizó la foto de perfil.' },
  PHOTO_DELETED: { scope: 'PROFILE', label: 'Foto de perfil eliminada', description: 'Se eliminó la foto de perfil.' },
  PREFERENCES_UPDATED: { scope: 'PROFILE', label: 'Preferencias actualizadas', description: 'Se actualizaron las preferencias visuales del usuario.' },
  REPORT_DOWNLOADED: { scope: 'REPORTS', label: 'Reporte descargado', description: 'Se descargó un reporte desde el sistema.' },
  REPORT_GENERATED: { scope: 'REPORTS', label: 'Reporte generado', description: 'Se generó un reporte desde el sistema.' },
  PDF_EXPORTED: { scope: 'REPORTS', label: 'Exportación PDF', description: 'Se generó o exportó un archivo PDF.' },
  EXPORT_PDF: { scope: 'REPORTS', label: 'Exportación PDF', description: 'Se generó o exportó un archivo PDF.' },
  EXCEL_EXPORTED: { scope: 'REPORTS', label: 'Exportación Excel', description: 'Se generó o exportó un archivo Excel.' },
  USER_CREATED: { scope: 'PROFILE', label: 'Usuario creado', description: 'Se creó un nuevo usuario en el sistema.' },
  USER_UPDATED: { scope: 'PROFILE', label: 'Usuario actualizado', description: 'Se actualizaron los datos de un usuario.' },
  USER_DISABLED: { scope: 'SECURITY', label: 'Usuario deshabilitado', description: 'Se deshabilitó el acceso de un usuario.' },
  USER_ENABLED: { scope: 'SECURITY', label: 'Usuario habilitado', description: 'Se habilitó el acceso de un usuario.' },
};

function formatActionFallback(action = '') {
  if (!action || typeof action !== 'string') { return 'Actividad registrada'; }
  return action.toLowerCase().split('_').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getActivityTranslation(action) {
  const translation = ACTIVITY_TRANSLATIONS[action];
  if (translation) { return translation; }
  return { scope: 'GENERAL', label: formatActionFallback(action), description: 'Se registró una actividad en el sistema.' };
}

module.exports = { ACTIVITY_TRANSLATIONS, getActivityTranslation };
