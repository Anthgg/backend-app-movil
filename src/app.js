const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./shared/middlewares/error.middleware');
const { testDatabaseConnection } = require('./config/database');
const { testSupabaseConnection } = require('./config/supabase');

const app = express();

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
    await testSupabaseConnection();
    res.json({
      status: 'ok',
      supabase: 'connected'
    });
  } catch (error) {
    next({ statusCode: 500, errorCode: 'SUPABASE_CONNECTION_ERROR', message: 'Fallo conexión a Supabase' });
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
      { method: 'POST', path: '/auth/refresh-token' },
      { method: 'GET',  path: '/auth/me' },
      { method: 'GET',  path: '/api/auth/me' },
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
      { method: 'GET',  path: '/api/attendance/summary' },
      // Protegidas
      { method: 'GET',  path: '/users' },
      { method: 'GET',  path: '/workers' },
      { method: 'GET',  path: '/devices/my' },
      { method: 'GET',  path: '/dashboard/summary' },
      { method: 'GET',  path: '/reports/attendance' },
      { method: 'GET',  path: '/payroll/periods' }
    ]
  });
});

// Importar rutas de microservicios
const authRoutes = require('./services/auth-service/routes');
const authController = require('./services/auth-service/controllers');
const requestRoutes = require('./services/request-service/routes/request.routes');
const requestTypeRoutes = require('./services/request-service/routes/request-type.routes');

app.use('/auth', authRoutes); // Ruta original
app.use('/api/auth', authRoutes); // Alias para la app móvil

// Alias directo para POST /api/login
app.post('/api/login', authController.login);

// Manejo de método incorrecto para /api/login
app.all('/api/login', (req, res) => {
  res.status(405).json({
    success: false,
    message: 'Usa POST para iniciar sesión'
  });
});

const attendanceRoutes = require('./services/attendance-service/routes/attendance.routes');
app.use('/attendance', attendanceRoutes);
app.use('/api/attendance', attendanceRoutes); // Alias para la app móvil
app.use('/users', require('./services/user-service/routes'));
app.use('/workers', require('./services/worker-service/routes'));
app.use('/devices', require('./services/device-service/routes'));
app.use('/dashboard', require('./services/dashboard-service/dashboard.routes'));
app.use('/schedule', require('./services/schedule-service/routes'));
app.use('/jobs', require('./services/jobs-service/jobs.routes'));
app.use('/requests', requestRoutes);
app.use('/api/requests', requestRoutes);
app.use('/request-types', requestTypeRoutes);
app.use('/api/request-types', requestTypeRoutes);
app.use('/reports', require('./services/report-service/routes/report.routes'));
app.use('/payroll', require('./services/payroll-service/routes/payroll.routes'));

// Alias GET /payroll → GET /payroll/periods (compatibilidad app móvil)
const payrollController = require('./services/payroll-service/controllers/payroll.controller');
const { authenticateToken } = require('./shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('./shared/middlewares/tenant.middleware');
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
