/**
 * @swagger
 * components:
 *   schemas:
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: Correo electrónico del usuario.
 *           example: "admin@demo.com"
 *         password:
 *           type: string
 *           format: password
 *           description: Contraseña del usuario.
 *           example: "Demo123!"
 * 
 *     LoginResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Login exitoso"
 *         data:
 *           type: object
 *           properties:
 *             accessToken:
 *               type: string
 *               example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *             refreshToken:
 *               type: string
 *               example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *             user:
 *               $ref: '#/components/schemas/User'
 *             require2FA:
 *               type: boolean
 *               description: Indica si el usuario debe verificar el 2FA.
 * 
 *     RefreshTokenRequest:
 *        type: object
 *        required:
 *          - refreshToken
 *        properties:
 *          refreshToken:
 *            type: string
 *            description: Token de refresco para obtener un nuevo accessToken.
 *            example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 * 
 *     RefreshTokenResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             accessToken:
 *               type: string
 *               example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 * 
 *     TwoFactorGenerateResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             secret:
 *               type: string
 *               example: "JBSWY3DPEHPK3PXP"
 *             qrCode:
 *               type: string
 *               description: "Data URL en formato Base64 para mostrar el código QR."
 *               example: "data:image/png;base64,iVBORw0KGgo..."
 * 
 *     TwoFactorVerifyRequest:
 *       type: object
 *       required:
 *         - token
 *       properties:
 *         token:
 *           type: string
 *           description: Código de 6 dígitos del autenticador.
 *           example: "123456"
 */
