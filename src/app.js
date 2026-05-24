const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./shared/middlewares/error.middleware');
const { testDatabaseConnection } = require('./config/database');
const { testSupabaseConnection } = require('./config/supabase');
const { authenticateToken } = require('./shared/middlewares/auth.middleware');

const app = express();
app.set('trust proxy', 1);

// Middlewares de seguridad y utilidad
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting base
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 peticiones por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas peticiones, intenta de nuevo más tarde' }
});
app.use(limiter);

// Rutas Health Check
app.get('/', (req, res) => {
  res.json({ success: true, message: 'API de Recursos Humanos funcionando. Usa /health para ver el estado.' });
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Estado general del backend
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Estado ok
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend-app-movil'
  });
});

/**
 * @swagger
 * /health/db:
 *   get:
 *     summary: Estado de PostgreSQL
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Conexión ok
 *       500:
 *         description: DB_CONNECTION_ERROR
 */
app.get('/health/db', async (req, res, next) => {
  try {
    const dbRes = await testDatabaseConnection();
    res.json({
      status: 'ok',
      database: 'connected',
      server_time: dbRes.server_time
    });
  } catch (error) {
    next({ statusCode: 500, errorCode: 'DB_CONNECTION_ERROR', message: 'Fallo conexión a BD' });
  }
});

/**
 * @swagger
 * /health/supabase:
 *   get:
 *     summary: Estado de Supabase
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Conexión ok
 *       500:
 *         description: SUPABASE_CONNECTION_ERROR
 */
app.get('/health/supabase', async (req, res, next) => {
  try {
    const storageStatus = await testSupabaseConnection();
    res.json({
      status: 'ok',
      supabase: 'connected',
      storage: storageStatus
    });
  } catch (error) {
    next({
      statusCode: error.statusCode || 500,
      errorCode: error.errorCode || 'SUPABASE_CONNECTION_ERROR',
      message: error.message || 'Fallo conexion a Supabase'
    });
  }
});

// Endpoint para listar rutas principales (requerido por app móvil)
app.get('/routes', (req, res) => {
  res.json({
    success: true,
    routes: [
      { method: 'GET',  path: '/' },
      { method: 'GET',  path: '/health' },
      { method: 'GET',  path: '/health/db' },
      { method: 'GET',  path: '/routes' },
      // Auth
      { method: 'POST', path: '/api/login' },
      { method: 'POST', path: '/api/auth/login' },
      { method: 'POST', path: '/auth/login' },
      { method: 'POST', path: '/auth/logout' },
      { method: 'POST', path: '/auth/change-password' },
      { method: 'POST', path: '/auth/refresh' },
      { method: 'POST', path: '/auth/refresh-token' },
      { method: 'GET',  path: '/auth/me' },
      { method: 'GET',  path: '/api/auth/me' },
      { method: 'POST', path: '/api/auth/refresh' },
      // Attendance
      { method: 'POST', path: '/attendance/check-in' },
      { method: 'POST', path: '/attendance/check-out' },
      { method: 'GET',  path: '/attendance/today' },
      { method: 'GET',  path: '/attendance/history' },
      { method: 'GET',  path: '/attendance/summary' },
      { method: 'GET',  path: '/attendance/my-records' },
      // Attendance (alias /api)
      { method: 'POST', path: '/api/attendance/check-in' },
      { method: 'POST', path: '/api/attendance/check-out' },
      { method: 'GET',  path: '/api/attendance/today' },
      { method: 'GET',  path: '/api/attendance/history' },
      { method: 'GET',  path: '/api/attendance/month-summary' },
      { method: 'GET',  path: '/api/attendance/stats' },
      { method: 'GET',  path: '/api/attendance/summary' },
      { method: 'POST', path: '/api/mobile/attendance/check-in' },
      { method: 'POST', path: '/api/mobile/attendance/check-out' },
      { method: 'GET',  path: '/api/mobile/attendance/today' },
      // Protegidas
      { method: 'GET',  path: '/users/me' },
      { method: 'GET',  path: '/users' },
      { method: 'GET',  path: '/users/roles' },
      { method: 'GET',  path: '/api/users/me' },
      { method: 'GET',  path: '/api/users' },
      { method: 'POST', path: '/api/users/suggest-credentials' },
      { method: 'GET',  path: '/roles' },
      { method: 'GET',  path: '/api/roles' },
      { method: 'GET',  path: '/api/dni/:dni' },
      { method: 'GET',  path: '/workers' },
      { method: 'POST', path: '/api/workers/onboarding' },
      { method: 'GET',  path: '/api/workers/:workerId/onboarding-status' },
      { method: 'POST', path: '/api/workers/:workerId/contracts/signed' },
      { method: 'POST', path: '/api/contracts/generate' },
      { method: 'GET',  path: '/api/workers/me' },
      { method: 'GET',  path: '/devices/my' },
      { method: 'POST', path: '/devices/current/logout' },
      { method: 'POST', path: '/devices/current/revoke' },
      { method: 'POST', path: '/devices/me/logout' },
      { method: 'POST', path: '/api/devices/current/logout' },
      { method: 'POST', path: '/api/devices/current/revoke' },
      { method: 'POST', path: '/api/devices/me/logout' },
      { method: 'GET',  path: '/api/mobile/device/my' },
      { method: 'GET',  path: '/dashboard/summary' },
      { method: 'GET',  path: '/dashboard' },
      { method: 'GET',  path: '/dashboard/attendance-today' },
      { method: 'GET',  path: '/dashboard/pending-requests' },
      { method: 'GET',  path: '/dashboard/worker-status' },
      { method: 'GET',  path: '/dashboard/contracts-expiring' },
      { method: 'GET',  path: '/dashboard/documents-pending' },
      { method: 'GET',  path: '/dashboard/late-workers' },
      { method: 'GET',  path: '/dashboard/project-summary' },
      { method: 'GET',  path: '/dashboard/birthdays' },
      { method: 'GET',  path: '/dashboard/alerts' },
      { method: 'GET',  path: '/dashboard/weekly-chart' },
      { method: 'GET',  path: '/dashboard/daily-status-list' },
      { method: 'GET',  path: '/reports/attendance' },
      { method: 'GET',  path: '/api/reports/attendance' },
      { method: 'GET',  path: '/payroll/periods' },
      // Profile
      { method: 'GET',  path: '/profile' },
      { method: 'PATCH', path: '/profile' },
      { method: 'POST', path: '/profile/change-password' },
      { method: 'GET',  path: '/api/profile/me' },
      { method: 'PUT',  path: '/api/profile/me' },
      { method: 'POST', path: '/api/profile/change-password' },
      { method: 'POST', path: '/api/profile/photo' },
      { method: 'DELETE', path: '/api/profile/photo' },
      // Birthday
      { method: 'GET',  path: '/api/birthdays/today' },
      { method: 'GET',  path: '/api/birthdays/upcoming' },
      { method: 'GET',  path: '/api/birthdays/month' },
      // Home Summary
      { method: 'GET',  path: '/api/home/summary' },
      { method: 'GET',  path: '/api/mobile/home/summary' },
      // Shifts
      { method: 'GET',  path: '/schedule/shifts' },
      { method: 'POST', path: '/schedule/shifts' },
      { method: 'PUT',  path: '/schedule/workers/:id/shift' },
      // Requests
      { method: 'POST', path: '/requests/:id/cancel' },
      { method: 'POST', path: '/requests/:id/review' }
    ]
  });
});

// Endpoint temporal para leer logs
app.get('/api/system/logs', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) return res.send('No logs dir');
    const files = fs.readdirSync(logDir).sort().reverse();
    if (files.length === 0) return res.send('No logs');
    const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.send(err.message);
  }
});

// Debug endpoint temporal
app.get('/api/system/debug-env', (req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@') : null
  });
});

// Importar rutas de microservicios
const authRoutes = require('./services/auth-service/routes');
const authController = require('./services/auth-service/controllers');
const documentsRoutes = require('./services/documents-service/routes');
const documentsAdminRoutes = require('./services/documents-service/admin.routes');
const notificationsRoutes = require('./services/notifications-service/routes');
const requestRoutes = require('./services/request-service/routes/request.routes');
const requestTypeRoutes = require('./services/request-service/routes/request-type.routes');
const profileRoutes = require('./services/profile-service/routes');
const birthdayRoutes = require('./services/birthday-service/routes');
const homeRoutes = require('./services/home-service/routes');
const attendanceRoutes = require('./services/attendance-service/routes/attendance.routes');
const userRoutes = require('./services/user-service/routes');
const legacyRoleRoutes = require('./services/user-service/roles.routes');
const workerRoutes = require('./services/worker-service/routes');
const dniRoutes = require('./services/dni-service/routes');
const contractRoutes = require('./services/contract-service/routes');
const deviceRoutes = require('./services/device-service/routes');
const dashboardRoutes = require('./services/dashboard-service/dashboard.routes');
const scheduleRoutes = require('./services/schedule-service/routes');
const jobsRoutes = require('./services/jobs-service/jobs.routes');
const reportRoutes = require('./services/report-service/routes/report.routes');
const reportTemplateRoutes = require('./services/report-service/routes/reportTemplate.routes');
const payrollRoutes = require('./services/payroll-service/routes/payroll.routes');
const companySettingsRoutes = require('./services/company-settings-service/companySettings.routes');
const areasRoutes = require('./modules/areas/areas.routes');
const jobPositionsRoutes = require('./modules/jobPositions/jobPositions.routes');
const rolesCatalogRoutes = require('./modules/roles/roles.routes');
const ubigeoRoutes = require('./modules/ubigeo/ubigeo.routes');
const departmentsRoutes = require('./modules/departments/departments.routes');
const usersNewRoutes = require('./modules/users/users.routes');
const path = require('path');

app.use('/auth', authRoutes); // Ruta original
app.use('/api/auth', authRoutes); // Alias para la app móvil

// Alias directo para POST /api/login
app.post('/api/login', authController.login);
app.post('/auth/refresh', authController.refreshToken);
app.post('/api/auth/refresh', authController.refreshToken);
app.get('/users/me', authenticateToken, authController.getMe);
app.get('/api/users/me', authenticateToken, authController.getMe);

// Manejo de método incorrecto para /api/login
app.all('/api/login', (req, res) => {
  res.status(405).json({
    success: false,
    message: 'Usa POST para iniciar sesión'
  });
});

app.use('/attendance', attendanceRoutes);
app.use('/api/attendance', attendanceRoutes); // Alias para la app móvil
app.use('/api/mobile/attendance', attendanceRoutes);
app.use('/users', userRoutes);
app.use('/api/users', userRoutes);
app.use('/roles', legacyRoleRoutes);
app.use('/dni', dniRoutes);
app.use('/api/dni', dniRoutes);
app.use('/workers', workerRoutes);
app.use('/api/workers', workerRoutes);
app.use('/contracts', contractRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/devices', deviceRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/mobile/device', deviceRoutes);
app.use('/documents', documentsAdminRoutes);
app.use('/api/documents', documentsAdminRoutes);
app.use('/worker-documents', documentsRoutes);
app.use('/api/worker-documents', documentsRoutes);
app.use('/api/mobile/documents', documentsRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/mobile/notifications', notificationsRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/mobile/dashboard', dashboardRoutes);
app.use('/schedule', scheduleRoutes);
app.use('/jobs', jobsRoutes);
app.use('/requests', requestRoutes);
app.use('/api/requests', requestRoutes);
app.use('/request-types', requestTypeRoutes);
app.use('/api/request-types', requestTypeRoutes);
app.use('/reports', reportRoutes);
app.use('/api/reports', reportRoutes);
app.use('/report-templates', reportTemplateRoutes);
app.use('/api/report-templates', reportTemplateRoutes);
app.use('/payroll', payrollRoutes);
app.use('/api/company-settings', companySettingsRoutes);

// Nuevos módulos HR
const { tenantMiddleware } = require('./shared/middlewares/tenant.middleware');
app.use('/api/areas', authenticateToken, tenantMiddleware, areasRoutes);
app.use('/api/job-positions', authenticateToken, tenantMiddleware, jobPositionsRoutes);
app.use('/api/roles', authenticateToken, tenantMiddleware, rolesCatalogRoutes);
app.use('/api/ubigeo', authenticateToken, tenantMiddleware, ubigeoRoutes);
app.use('/api/departments', authenticateToken, tenantMiddleware, departmentsRoutes);
app.use('/api/users', authenticateToken, tenantMiddleware, usersNewRoutes);

// Nuevas rutas de Perfil, Cumpleaños y Resumen
app.use('/profile', profileRoutes);
app.use('/api/profile', profileRoutes);
app.post('/profile/change-password', authenticateToken, authController.changePassword);
app.post('/api/profile/change-password', authenticateToken, authController.changePassword);
app.use('/birthdays', birthdayRoutes);
app.use('/api/birthdays', birthdayRoutes);
app.use('/home', homeRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/mobile/home', homeRoutes);

// Servir archivos estáticos (fotos de perfil)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Alias GET /payroll → GET /payroll/periods (compatibilidad app móvil)
const payrollController = require('./services/payroll-service/controllers/payroll.controller');
const { requirePermission } = require('./shared/middlewares/permissions.middleware');
app.get('/payroll', authenticateToken, tenantMiddleware, requirePermission('payroll.periods.read'), payrollController.getPeriods);

// Inicializar Swagger API Docs
if (process.env.ENABLE_SWAGGER === 'true') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./docs/swagger.js');

  let swaggerMiddlewares = [swaggerUi.serve];

  if (process.env.SWAGGER_BASIC_AUTH === 'true') {
    const basicAuth = require('express-basic-auth');
    const users = {};
    const swaggerUser = process.env.SWAGGER_USER || 'admin';
    const swaggerPassword = process.env.SWAGGER_PASSWORD || 'admin123';
    users[swaggerUser] = swaggerPassword;

    swaggerMiddlewares.unshift(basicAuth({
      users,
      challenge: true,
      unauthorizedResponse: 'Unauthorized access to API documentation.',
    }));
  }

  app.use('/api-docs', ...swaggerMiddlewares, swaggerUi.setup(swaggerSpec));
  
  if (process.env.SWAGGER_BASIC_AUTH === 'true') {
    app.get('/api-docs.json', swaggerMiddlewares[0], (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  } else {
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  }
}

// Middleware de manejo de errores
app.use(errorHandler);

module.exports = app;

// Inicializar Cronjobs en background
require('./jobs/index');

// Middleware para rutas no encontradas
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada' });
});

// Manejador de errores global
app.use(errorHandler);

