const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'HR Management Enterprise API',
      version: '1.0.0',
      description: 'API corporativa para gestión de Recursos Humanos, Multi-Tenant, Control de Asistencia GPS, Solicitudes y Planillas.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local Development Server' },
      { url: process.env.API_BASE_URL || 'https://api.empresa.com', description: 'Production Server' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Introduce el token JWT obtenido del endpoint /auth/login. Formato: Bearer <token>'
        }
      },
      parameters: {
        Page: {
          name: 'page',
          in: 'query',
          description: 'Número de página para la paginación.',
          required: false,
          schema: {
            type: 'integer',
            default: 1,
            minimum: 1
          }
        },
        Limit: {
          name: 'limit',
          in: 'query',
          description: 'Número de resultados por página.',
          required: false,
          schema: {
            type: 'integer',
            default: 10,
            minimum: 1,
            maximum: 100
          }
        }
      },
      responses: {
        Unauthorized: {
          description: 'Error: No autorizado. Token no proporcionado o inválido.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'No token provided or token is invalid.' }
                }
              }
            }
          }
        },
        Forbidden: {
          description: 'Error: Prohibido. El usuario no tiene los permisos necesarios.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'You do not have permission to perform this action.' }
                }
              }
            }
          }
        },
        NotFound: {
          description: 'Error: Recurso no encontrado.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'Resource not found.' }
                }
              }
            }
          }
        },
        InternalServerError: {
          description: 'Error: Error interno del servidor.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'An internal server error occurred.' }
                }
              }
            }
          }
        }
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { type: 'object' }
          }
        },
        PaginatedSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: { type: 'object' } },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                totalPages: { type: 'integer' }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            code: { type: 'string' }
          }
        }
      }
    },
    security: [
      { bearerAuth: [] }
    ],
    tags: [
      { name: 'Auth', description: 'Autenticación y Sesiones' },
      { name: 'Attendance', description: 'Control de Asistencia Georreferenciada' },
      { name: 'Requests', description: 'Solicitudes y Vacaciones' },
      { name: 'Reports', description: 'Reportes Operativos Exportables' },
      { name: 'Payroll', description: 'Planillas y Sueldos Estimados' },
      { name: 'Jobs', description: 'Cronjobs Manuales' }
    ],
    paths: {
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Inicia sesión',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
          },
          responses: {
            200: { description: 'Login exitoso', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
            401: { description: 'Credenciales inválidas', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/attendance/check-in': {
        post: {
          tags: ['Attendance'],
          summary: 'Registra hora de entrada',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CheckInRequest' } } }
          },
          responses: {
            200: { description: 'Check-in exitoso', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
            403: { description: 'Dispositivo bloqueado o usuario inactivo', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/requests': {
        post: {
          tags: ['Requests'],
          summary: 'Crea una solicitud nueva',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateRequest' } } }
          },
          responses: {
            200: { description: 'Solicitud creada', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
          }
        }
      },
      '/payroll/periods': {
        post: {
          tags: ['Payroll'],
          summary: 'Crea un periodo de planilla',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PayrollPeriod' } } }
          },
          responses: {
            200: { description: 'Periodo creado', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
          }
        }
      }
    }
  },
  apis: [
    './src/services/auth-service/routes.js',
    './src/services/user-service/routes.js',
    './src/services/worker-service/routes.js',
    './src/services/dni-service/routes.js',
    './src/services/contract-service/routes.js',
    './src/services/onboarding-service/swagger.js',
    './src/services/device-service/routes.js',
    './src/services/attendance-service/routes/attendance.routes.js',
    './src/services/jobs-service/jobs.routes.js',
    './src/services/request-service/routes/request.routes.js',
    './src/docs/schemas/*.js'
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
