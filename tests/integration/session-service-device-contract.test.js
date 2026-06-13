const jwt = require('jsonwebtoken');
const { parseDevice, getClientIp, cleanIp } = require('../../src/shared/utils/device-parser');
const {
  resolveIpLocation,
  normalizeGeoPayload,
  clearIpLocationCache
} = require('../../src/shared/utils/ip-geolocation');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn()
}));

jest.mock('../../src/shared/utils/audit', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../src/config/database');
const env = require('../../src/config/env');
const sessionService = require('../../src/services/profile-service/session.service');

const trustedDeviceSchemaRows = [
  'id',
  'user_id',
  'device_id',
  'device_fingerprint',
  'company_id',
  'is_trusted',
  'trusted_at',
  'trust_expires_at',
  'last_seen_at'
].map((column_name) => ({ column_name }));

describe('session service device contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearIpLocationCache();
    env.ipGeolocationEnabled = true;
    env.ipGeolocationProviderUrl = 'http://geo.test/{ip}';
    env.ipGeolocationTimeoutMs = 50;
    env.ipGeolocationCacheTtlMs = 60000;
    global.fetch = jest.fn();
    db.query.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });
    sessionService.__resetSessionMetadataCachesForTests();
  });

  test('parseDevice devuelve navegador, sistema y tipo legibles', () => {
    const parsed = parseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0');

    expect(parsed).toMatchObject({
      browser: 'Edge',
      os: 'Windows',
      deviceType: 'desktop',
      deviceName: 'Windows PC'
    });
    expect(parsed.userAgent).toContain('Mozilla/5.0');
  });

  test('parseDevice maneja user-agent ausente sin romper', () => {
    expect(parseDevice('')).toEqual({
      userAgent: null,
      browser: 'Desconocido',
      os: 'Desconocido',
      deviceType: 'unknown',
      deviceName: 'Dispositivo desconocido'
    });
  });

  test('parseDevice usa Client Hints cuando el navegador los envia', () => {
    expect(parseDevice('', {
      'sec-ch-ua': '"Chromium";v="125", "Microsoft Edge";v="125"',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-model': '"ThinkPad X1"'
    })).toMatchObject({
      userAgent: null,
      browser: 'Edge',
      os: 'Windows',
      deviceType: 'desktop',
      deviceName: 'Windows ThinkPad X1'
    });
  });

  test('parseDevice identifica Android e iPhone con nombres descriptivos', () => {
    expect(parseDevice('Mozilla/5.0 (Linux; Android 14; SM-G991B Build/UP1A.231005.007) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36')).toMatchObject({
      browser: 'Chrome',
      os: 'Android',
      deviceType: 'mobile',
      deviceName: 'Samsung SM-G991B'
    });

    expect(parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toMatchObject({
      browser: 'Safari',
      os: 'iOS',
      deviceType: 'mobile',
      deviceName: 'Apple iPhone'
    });
  });

  test('cleanIp normaliza IPv6 local y direcciones IPv4 mapeadas', () => {
    expect(cleanIp('::1')).toBe('127.0.0.1');
    expect(cleanIp('::ffff:190.235.10.45')).toBe('190.235.10.45');
    expect(cleanIp('127.0.0.1:51234')).toBe('127.0.0.1');
  });

  test('getClientIp usa la primera IP publica valida de x-forwarded-for', () => {
    const ip = getClientIp({
      headers: {
        'x-forwarded-for': '10.0.0.1, 190.233.10.15, 172.16.0.2',
        'x-real-ip': '198.51.100.20'
      },
      ip: '127.0.0.1'
    });

    expect(ip).toBe('190.233.10.15');
  });

  test('getClientIp prioriza CF-Connecting-IP sobre otras cabeceras', () => {
    const ip = getClientIp({
      headers: {
        'cf-connecting-ip': '181.65.10.20',
        'x-forwarded-for': '190.233.10.15'
      }
    });

    expect(ip).toBe('181.65.10.20');
  });

  test('normalizeGeoPayload devuelve ubicacion aproximada en camelCase', () => {
    expect(normalizeGeoPayload({
      status: 'success',
      country: 'Peru',
      city: 'Lima',
      lat: -12.0464,
      lon: -77.0428
    })).toEqual({
      country: 'Peru',
      city: 'Lima',
      location: 'Lima, Peru',
      latitude: -12.0464,
      longitude: -77.0428
    });
  });

  test('resolveIpLocation usa proveedor con cache y no bloquea si falla', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          country: 'Peru',
          city: 'Lima',
          lat: -12.0464,
          lon: -77.0428
        })
      })
      .mockRejectedValueOnce(new Error('provider down'));

    const first = await resolveIpLocation('190.233.10.15');
    const cached = await resolveIpLocation('190.233.10.15');
    clearIpLocationCache();
    const failed = await resolveIpLocation('190.233.10.16');

    expect(first.location).toBe('Lima, Peru');
    expect(cached.location).toBe('Lima, Peru');
    expect(failed).toEqual({
      country: null,
      city: null,
      location: null,
      latitude: null,
      longitude: null
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('mapSession normaliza camelCase y no expone hashes ni refresh token', () => {
    const session = sessionService.mapSession({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      user_agent: 'Mozilla/5.0',
      ip_address: '190.233.10.15',
      location: 'Lima, Peru',
      country: 'Peru',
      city: 'Lima',
      latitude: '-12.0464000',
      longitude: '-77.0428000',
      browser: 'Chrome',
      os: 'Windows',
      device_type: 'desktop',
      device_name: 'Windows PC',
      is_trusted: false,
      trust_available_at: '2026-06-19T12:18:00.000Z',
      last_activity_at: '2026-06-12T12:18:00.000Z',
      expires_at: '2026-06-19T12:18:00.000Z',
      refresh_token_hash: 'secret'
    }, '11111111-1111-4111-8111-111111111111');

    expect(session).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      userAgent: 'Mozilla/5.0',
      ipAddress: '190.233.10.15',
      location: 'Lima, Peru',
      country: 'Peru',
      city: 'Lima',
      latitude: -12.0464,
      longitude: -77.0428,
      browser: 'Chrome',
      os: 'Windows',
      deviceType: 'desktop',
      deviceName: 'Windows PC',
      isCurrent: true
    });
    expect(session).not.toHaveProperty('refreshToken');
    expect(session).not.toHaveProperty('refresh_token_hash');
    expect(session).not.toHaveProperty('refreshTokenHash');
  });

  test('mapSession limpia browser UUID y deviceName legacy en sesiones antiguas', () => {
    const session = sessionService.mapSession({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      user_agent: null,
      browser: '11111111-1111-4111-8111-111111111111',
      os: null,
      device_type: 'unknown',
      device_name: 'Sesion activa',
      is_trusted: false,
      created_at: '2026-06-12T12:18:00.000Z',
      last_activity_at: '2026-06-12T12:18:00.000Z',
      expires_at: '2026-06-19T12:18:00.000Z'
    });

    expect(session).toMatchObject({
      browser: null,
      os: null,
      deviceType: 'unknown',
      deviceName: null
    });
  });

  test('mapSession hereda confianza activa desde trusted_devices', () => {
    const trustedAt = '2026-06-12T12:18:00.000Z';
    const trustExpiresAt = new Date(Date.now() + 10 * 86400000).toISOString();
    const session = sessionService.mapSession({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0',
      ip_address: '190.233.10.15',
      browser: 'Edge',
      os: 'Windows',
      device_type: 'desktop',
      device_name: 'Windows PC',
      trusted_device_id: '77777777-7777-4777-8777-777777777777',
      is_trusted: false,
      device_is_trusted: true,
      device_trusted_at: trustedAt,
      device_trust_expires_at: trustExpiresAt,
      created_at: '2026-06-12T12:18:00.000Z',
      trust_available_at: '2026-06-19T12:18:00.000Z',
      last_activity_at: '2026-06-12T12:18:00.000Z',
      expires_at: '2026-06-19T12:18:00.000Z'
    });

    expect(session).toMatchObject({
      deviceId: '77777777-7777-4777-8777-777777777777',
      isTrusted: true,
      trustedAt,
      trustExpiresAt,
      canTrust: false
    });
  });

  test('mapSession usa device_fingerprint como deviceId si aun no hay trusted_device_id', () => {
    const session = sessionService.mapSession({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0',
      browser: 'Edge',
      os: 'Windows',
      device_type: 'desktop',
      device_name: 'Windows PC',
      device_fingerprint: 'fingerprint-value',
      is_trusted: false,
      created_at: '2026-06-12T12:18:00.000Z',
      trust_available_at: '2026-06-19T12:18:00.000Z',
      last_activity_at: '2026-06-12T12:18:00.000Z',
      expires_at: '2026-06-19T12:18:00.000Z'
    });

    expect(session.deviceId).toBe('fingerprint-value');
  });

  test('createSession guarda IP, ubicacion y metadatos de dispositivo', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        country: 'Peru',
        city: 'Lima',
        lat: -12.0464,
        lon: -77.0428
      })
    });
    db.query.mockResolvedValue({ rowCount: 1, rows: [] });

    await sessionService.createSession({
      userId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      refreshToken: 'refresh-token-value',
      refreshTokenId: '44444444-4444-4444-8444-444444444444',
      sessionId: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date(Date.now() + 86400000),
      req: {
        headers: {
          'cf-connecting-ip': '190.233.10.15',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0'
        }
      }
    });

    const insertCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_sessions'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      '190.233.10.15',
      'Lima, Peru',
      'Peru',
      'Lima',
      -12.0464,
      -77.0428,
      'Edge',
      'Windows',
      'desktop',
      'Windows PC'
    ]));
    expect(insertCall[1]).not.toContain('refresh-token-value');
  });

  test('createSession marca sesion confiable si el dispositivo persistente ya lo era', async () => {
    const trustedAt = new Date(Date.now() - 86400000);
    const trustExpiresAt = new Date(Date.now() + 10 * 86400000);
    const deviceId = '77777777-7777-4777-8777-777777777777';
    const fingerprint = 'fingerprint-value';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        country: 'Peru',
        city: 'Lima',
        lat: -12.0464,
        lon: -77.0428
      })
    });
    db.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: trustedDeviceSchemaRows.length, rows: trustedDeviceSchemaRows })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: deviceId,
          is_trusted: true,
          trusted_at: trustedAt,
          trust_expires_at: trustExpiresAt,
          revoked_at: null
        }]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await sessionService.createSession({
      userId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      refreshToken: 'refresh-token-value',
      refreshTokenId: '44444444-4444-4444-8444-444444444444',
      sessionId: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date(Date.now() + 86400000),
      fingerprint,
      req: {
        headers: {
          'cf-connecting-ip': '190.233.10.15',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0'
        }
      }
    });

    const insertCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_sessions'));
    const deviceUpsertCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO trusted_devices'));
    expect(String(deviceUpsertCall[0])).toContain('device_id');
    expect(deviceUpsertCall[1][2]).toBe(fingerprint);
    expect(String(insertCall[0])).toContain('trusted_device_id');
    expect(String(insertCall[0])).toContain('device_fingerprint');
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      true,
      trustedAt,
      deviceId,
      fingerprint
    ]));
  });

  test('createSession guarda metadata aunque falte columna device_fingerprint', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        country: 'Peru',
        city: 'Lima',
        lat: -12.0464,
        lon: -77.0428
      })
    });
    const missingFingerprintColumn = Object.assign(
      new Error('column "device_fingerprint" does not exist'),
      { code: '42703' }
    );
    db.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockRejectedValueOnce(missingFingerprintColumn)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await sessionService.createSession({
      userId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      refreshToken: 'refresh-token-value',
      refreshTokenId: '44444444-4444-4444-8444-444444444444',
      sessionId: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date(Date.now() + 86400000),
      fingerprint: 'fingerprint-value',
      req: {
        headers: {
          'cf-connecting-ip': '190.233.10.15',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0'
        }
      }
    });

    const insertCalls = db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO user_sessions'));
    expect(insertCalls).toHaveLength(2);
    expect(String(insertCalls[0][0])).toContain('device_fingerprint');
    expect(String(insertCalls[1][0])).not.toContain('device_fingerprint');
    expect(insertCalls[1][1]).toEqual(expect.arrayContaining([
      '190.233.10.15',
      'Edge',
      'Windows',
      'desktop',
      'Windows PC'
    ]));
  });

  test('listSessions fallback usa sessionId del refresh token y marca current', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const sessionId = '11111111-1111-4111-8111-111111111111';
    db.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          refresh_token_id: '44444444-4444-4444-8444-444444444444',
          user_id: userId,
          token: jwt.sign({ id: userId, sessionId }, 'test-secret'),
          created_at: '2026-06-13T07:51:24.404Z',
          expires_at: '2026-06-20T07:51:24.404Z'
        }]
      });

    const sessions = await sessionService.listSessions(userId, sessionId);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: sessionId,
      isCurrent: true,
      isLegacy: true,
      browser: null,
      deviceName: null
    });
    expect(sessions[0]).not.toHaveProperty('token');
  });

  test('listSessions enlaza trusted_devices por fingerprint si falta trusted_device_id', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const trustedDeviceId = '77777777-7777-4777-8777-777777777777';
    const trustedAt = '2026-06-12T12:18:00.000Z';
    const trustExpiresAt = new Date(Date.now() + 10 * 86400000).toISOString();
    db.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: trustedDeviceSchemaRows.length, rows: trustedDeviceSchemaRows })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: sessionId,
          user_id: userId,
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0',
          browser: 'Edge',
          os: 'Windows',
          device_type: 'desktop',
          device_name: 'Windows PC',
          device_fingerprint: 'fingerprint-value',
          resolved_trusted_device_id: trustedDeviceId,
          resolved_device_fingerprint: 'fingerprint-value',
          is_trusted: false,
          device_is_trusted: true,
          device_trusted_at: trustedAt,
          device_trust_expires_at: trustExpiresAt,
          device_revoked_at: null,
          created_at: '2026-06-12T12:18:00.000Z',
          trust_available_at: '2026-06-19T12:18:00.000Z',
          last_activity_at: '2026-06-12T12:18:00.000Z',
          expires_at: '2026-06-19T12:18:00.000Z'
        }]
      });

    const sessions = await sessionService.listSessions(userId, sessionId);
    const listQuery = db.query.mock.calls[4][0];

    expect(String(listQuery)).toContain('td.device_fingerprint = us.device_fingerprint');
    expect(sessions[0]).toMatchObject({
      deviceId: trustedDeviceId,
      isTrusted: true,
      trustedAt
    });
  });

  test('revokeOtherSessions cierra refresh tokens legacy de otros sessionId', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    const currentSessionId = '11111111-1111-4111-8111-111111111111';
    const otherSessionId = '55555555-5555-4555-8555-555555555555';
    const otherRefreshTokenId = '66666666-6666-4666-8666-666666666666';
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              token: jwt.sign({ id: userId, sessionId: currentSessionId }, 'test-secret')
            },
            {
              id: otherRefreshTokenId,
              token: jwt.sign({ id: userId, sessionId: otherSessionId }, 'test-secret')
            }
          ]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: otherRefreshTokenId }]
        })
    };

    db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    db.withTransaction.mockImplementation(async (callback) => callback(client));

    const result = await sessionService.revokeOtherSessions(
      userId,
      currentSessionId,
      { tenantId: '33333333-3333-4333-8333-333333333333' }
    );

    expect(result).toMatchObject({
      success: true,
      revokedCount: 1,
      data: {
        revokedCount: 1,
        revokedTokens: 1
      }
    });
    expect(client.query.mock.calls[1][1][0]).toEqual([otherRefreshTokenId]);
  });

  test('trustSession falla con 422 si no se cumplio trust_available_at', async () => {
    const futureDate = new Date(Date.now() + 86400000);
    db.withTransaction.mockImplementation(async (callback) => callback({
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          user_id: '22222222-2222-4222-8222-222222222222',
          is_trusted: false,
          revoked_at: null,
          created_at: new Date(),
          trust_available_at: futureDate,
          expires_at: futureDate
        }]
      })
    }));

    try {
      await sessionService.trustSession(
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        { tenantId: '33333333-3333-4333-8333-333333333333' }
      );
      throw new Error('Should have thrown 422');
    } catch (error) {
      expect(error.statusCode).toBe(422);
      expect(error.errorCode).toBe('TRUST_WAITING_PERIOD_NOT_MET');
      expect(error.details).toHaveProperty('trustAvailableAt');
      expect(error.details.trustAvailableAt).toBe(futureDate.toISOString());
    }
  });

  test('trustSession marca confiable cuando ya paso el periodo de gracia', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            user_id: '22222222-2222-4222-8222-222222222222',
            is_trusted: false,
            revoked_at: null,
            created_at: new Date(Date.now() - 8 * 86400000),
            trust_available_at: new Date(Date.now() - 86400000),
            expires_at: new Date(Date.now() + 86400000),
            refresh_token_id: '44444444-4444-4444-8444-444444444444'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            user_id: '22222222-2222-4222-8222-222222222222',
            is_trusted: true,
            trusted_at: new Date(),
            trust_available_at: new Date(Date.now() - 86400000),
            expires_at: new Date(Date.now() + 30 * 86400000),
            refresh_token_id: '44444444-4444-4444-8444-444444444444'
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 })
    };
    db.withTransaction.mockImplementation(async (callback) => callback(client));

    const result = await sessionService.trustSession(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { tenantId: '33333333-3333-4333-8333-333333333333' }
    );

    expect(result.success).toBe(true);
    expect(result.data.isTrusted).toBe(true);
  });

  test('trustSession persiste la confianza en trusted_devices', async () => {
    const deviceId = '77777777-7777-4777-8777-777777777777';
    const trustedAt = new Date();
    const trustExpiresAt = new Date(Date.now() + 30 * 86400000);
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            user_id: '22222222-2222-4222-8222-222222222222',
            trusted_device_id: deviceId,
            is_trusted: false,
            revoked_at: null,
            created_at: new Date(Date.now() - 8 * 86400000),
            trust_available_at: new Date(Date.now() - 86400000),
            expires_at: new Date(Date.now() + 86400000),
            refresh_token_id: '44444444-4444-4444-8444-444444444444'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            user_id: '22222222-2222-4222-8222-222222222222',
            trusted_device_id: deviceId,
            is_trusted: true,
            trusted_at: trustedAt,
            trust_available_at: new Date(Date.now() - 86400000),
            expires_at: new Date(Date.now() + 30 * 86400000),
            refresh_token_id: '44444444-4444-4444-8444-444444444444'
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: deviceId,
            is_trusted: true,
            trusted_at: trustedAt,
            trust_expires_at: trustExpiresAt,
            revoked_at: null
          }]
        })
    };
    db.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: trustedDeviceSchemaRows.length, rows: trustedDeviceSchemaRows });
    db.withTransaction.mockImplementation(async (callback) => callback(client));

    const result = await sessionService.trustSession(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { tenantId: '33333333-3333-4333-8333-333333333333' }
    );

    expect(result.data).toMatchObject({
      isTrusted: true,
      deviceId
    });
    expect(client.query.mock.calls[3][0]).toContain('UPDATE trusted_devices');
  });

  test('revokeSession marca revoked_at sin eliminar fisicamente', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            refresh_token_id: '44444444-4444-4444-8444-444444444444',
            revoked_at: null
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
    };
    db.withTransaction.mockImplementation(async (callback) => callback(client));

    const result = await sessionService.revokeSession(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { tenantId: '33333333-3333-4333-8333-333333333333' }
    );

    expect(result.success).toBe(true);
    expect(client.query.mock.calls[1][0]).toContain('revoked_at = NOW()');
  });

  test('revokeByRefreshToken revoca refresh token y sesion actual', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '44444444-4444-4444-8444-444444444444' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '44444444-4444-4444-8444-444444444444' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await sessionService.revokeByRefreshToken(
      '22222222-2222-4222-8222-222222222222',
      'refresh-token-value',
      { user: { sessionId: '11111111-1111-4111-8111-111111111111' } }
    );

    expect(result).toMatchObject({
      tokenCount: 1,
      sessionCount: 1
    });
    expect(String(db.query.mock.calls[1][0])).toContain('UPDATE refresh_tokens');
    expect(String(db.query.mock.calls[3][0])).toContain('OR id = $3::uuid');
  });
});
