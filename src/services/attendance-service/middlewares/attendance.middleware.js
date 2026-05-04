exports.validateProjectId = (req, res, next) => {
  const projectId =
    req.body?.project_id ||
    req.body?.projectId ||
    req.headers['x-project-id'] ||
    req.headers['x-project-ID'] ||
    req.query?.project_id ||
    req.query?.projectId;

  console.log('[DEBUG] validateProjectId MiddleWare:', {
    contentType: req.headers['content-type'],
    body: req.body,
    query: req.query,
    headerProjectId: req.headers['x-project-id'] || req.headers['x-project-ID'],
    extractedProjectId: projectId
  });

  if (!projectId) {
    return res.status(400).json({
      success: false,
      message: 'ID de proyecto no recibido en la petición',
      error_code: 'PROJECT_ID_REQUIRED',
    });
  }

  // Adjuntar al request para uso posterior
  req.projectId = projectId;
  next();
};
