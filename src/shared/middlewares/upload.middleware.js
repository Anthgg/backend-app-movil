const multer = require('multer');
const path = require('path');
const fs = require('fs');

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/x-png',
    'image/webp',
    'application/octet-stream'
]);

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function getNormalizedExtension(file = {}) {
    return path.extname(file.originalname || '').toLowerCase();
}

function getSafeFileExtension(file = {}) {
    const originalExtension = getNormalizedExtension(file);
    if (ALLOWED_EXTENSIONS.has(originalExtension)) {
        return originalExtension;
    }

    const mimeToExtension = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/pjpeg': '.jpg',
        'image/png': '.png',
        'image/x-png': '.png',
        'image/webp': '.webp'
    };

    return mimeToExtension[file.mimetype] || '.jpg';
}

// Asegurar que la carpeta de uploads existe
const uploadDir = path.join(__dirname, '../../../uploads/profiles');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + req.user.id + '-' + uniqueSuffix + getSafeFileExtension(file));
    }
});

const fileFilter = (req, file, cb) => {
    const extension = getNormalizedExtension(file);
    const mimeType = String(file.mimetype || '').toLowerCase();
    const extensionAllowed = ALLOWED_EXTENSIONS.has(extension);
    const mimeAllowed = ALLOWED_MIME_TYPES.has(mimeType);
    const genericImageMime = mimeType.startsWith('image/');

    console.log('[profile/photo] incoming-file', {
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        normalizedExtension: extension || null,
        size: file.size || null
    });

    if ((mimeAllowed || genericImageMime) && extensionAllowed) {
        cb(null, true);
    } else {
        const error = new Error('Tipo de archivo no permitido. Use JPG, JPEG, PNG o WebP.');
        error.statusCode = 415;
        error.details = {
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            normalizedExtension: extension || null
        };
        cb(error, false);
    }
};

const uploadProfilePhoto = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: fileFilter
});

module.exports = { uploadProfilePhoto };
