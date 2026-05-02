const { query } = require('../../../config/database');

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if ((lat1 === lat2) && (lon1 === lon2)) {
        return 0;
    }
    const R = 6371e3; // Metros
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

async function validateDevice(userId, deviceIdentifier, tenantId) {
    const deviceRes = await query(
        'SELECT is_blocked, is_trusted FROM user_devices WHERE user_id = $1 AND device_identifier = $2 AND company_id = $3',
        [userId, deviceIdentifier, tenantId]
    );

    if (deviceRes.rows.length === 0) {
        const err = new Error('Dispositivo no registrado para este usuario.');
        err.statusCode = 403;
        err.code = 'DEVICE_NOT_REGISTERED';
        throw err;
    }

    const device = deviceRes.rows[0];
    if (device.is_blocked) {
        const err = new Error('Dispositivo bloqueado.');
        err.statusCode = 403;
        err.code = 'DEVICE_BLOCKED';
        throw err;
    }
    if (!device.is_trusted) {
        const err = new Error('El dispositivo no es de confianza.');
        err.statusCode = 403;
        err.code = 'DEVICE_NOT_TRUSTED';
        throw err;
    }
}

async function validateGps(latitude, longitude, workerId, tenantId, isMockLocation) {
    if (isMockLocation) {
        // Registrar intento de fraude
        await query(
            `INSERT INTO suspicious_activities (worker_id, company_id, activity_type, details)
             VALUES ($1, $2, 'fake_gps', $3)`,
            [workerId, tenantId, JSON.stringify({ latitude, longitude })]
        );
        const err = new Error('Se ha detectado una ubicación simulada. La marcación ha sido rechazada y registrada para revisión.');
        err.statusCode = 403;
        err.code = 'FAKE_GPS_DETECTED';
        throw err;
    }

    // Obtener la ubicación de trabajo asignada al trabajador
    const locationRes = await query(
        `SELECT l.latitude, l.longitude, l.allowed_radius_meters 
         FROM work_locations l
         JOIN worker_locations wl ON l.id = wl.location_id
         WHERE wl.worker_id = $1 AND l.company_id = $2 AND l.is_active = true`,
        [workerId, tenantId]
    );

    if (locationRes.rows.length === 0) {
        // Si no hay ubicación asignada, se permite marcar desde cualquier lugar
        return;
    }

    const location = locationRes.rows[0];
    const distance = calculateDistance(latitude, longitude, location.latitude, location.longitude);

    if (distance > location.allowed_radius_meters) {
        const err = new Error(`Estás a ${Math.round(distance)} metros del lugar de trabajo, fuera del radio de ${location.allowed_radius_meters} metros permitidos.`);
        err.statusCode = 403;
        err.code = 'GPS_OUT_OF_RANGE';
        throw err;
    }
}

module.exports = { validateDevice, validateGps };
