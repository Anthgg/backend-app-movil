/**
 * @swagger
 * components:
 *   schemas:
 *     SuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Operation completed successfully
 *         data:
 *           type: object
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         errorCode:
 *           type: string
 *           example: "VALIDATION_ERROR"
 *         message:
 *           type: string
 *           example: "Input validation failed"
 *         errors:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               field:
 *                 type: string
 *               message:
 *                 type: string
 *
 *     PaginationMeta:
 *       type: object
 *       properties:
 *         totalItems:
 *           type: integer
 *           example: 100
 *         totalPages:
 *           type: integer
 *           example: 10
 *         currentPage:
 *           type: integer
 *           example: 1
 *         pageSize:
 *           type: integer
 *           example: 10
 *
 *     AuditLog:
 *       type: object
 *       properties:
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         created_by:
 *           type: string
 *           format: uuid
 *         updated_by:
 *           type: string
 *           format: uuid
 *
 *     ValidationErrorSchema:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         errorCode:
 *           type: string
 *           example: "VALIDATION_ERROR"
 *         message:
 *           type: string
 *           example: "The provided data is not valid."
 *         errors:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               field:
 *                 type: string
 *                 example: "email"
 *               message:
 *                 type: string
 *                 example: "The email format is invalid."
 *
 *   responses:
 *     ValidationError:
 *       description: "Error de validación. La solicitud contiene datos inválidos."
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             success: false
 *             errorCode: "VALIDATION_ERROR"
 *             message: "Input validation failed"
 *             errors: [{ "field": "email", "message": "El email es inválido" }]
 *     Unauthorized:
 *       description: "No autorizado. El token JWT es inválido, ha expirado o no fue provisto."
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           examples:
 *             TOKEN_EXPIRED:
 *               value:
 *                 success: false
 *                 errorCode: "TOKEN_EXPIRED"
 *                 message: "El token ha expirado."
 *             INVALID_TOKEN:
 *               value:
 *                 success: false
 *                 errorCode: "INVALID_TOKEN"
 *                 message: "El token es inválido o no fue provisto."
 *     Forbidden:
 *       description: "Acceso denegado. El usuario no tiene los permisos necesarios para realizar esta acción."
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           examples:
 *             INSUFFICIENT_PERMISSIONS:
 *               value:
 *                 success: false
 *                 errorCode: "FORBIDDEN"
 *                 message: "No tienes permisos para realizar esta acción."
 *             USER_DISABLED:
 *                value:
 *                  success: false
 *                  errorCode: "USER_DISABLED"
 *                  message: "Tu cuenta de usuario ha sido deshabilitada."
 *     NotFound:
 *        description: "Recurso no encontrado. El ID solicitado no existe."
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/ErrorResponse'
 *            example:
 *              success: false
 *              errorCode: "NOT_FOUND"
 *              message: "El recurso solicitado no fue encontrado."
 *     Conflict:
 *       description: "Conflicto. La solicitud no puede ser procesada debido a un conflicto con el estado actual del recurso."
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             success: false
 *             errorCode: "DUPLICATE_RECORD"
 *             message: "Ya existe un registro con estos datos."
 *     InternalServerError:
 *       description: "Error interno del servidor. Ocurrió un error inesperado."
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             success: false
 *             errorCode: "INTERNAL_SERVER_ERROR"
 *             message: "Ocurrió un error inesperado en el servidor."
 */
