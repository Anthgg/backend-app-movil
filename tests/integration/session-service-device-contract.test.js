const { parseDevice, getClientIp } = require('../../src/shared/utils/device-parser');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn()
}));

jest.mock('../../src/shared/utils/audit', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../src/config/database');
const sessionService = require('../../src/services/profile-service/session.service');

describe('session service device contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });
  });

  test('parseDevice devuelve navegador, sistema y tipo legibles', () => {
    const parsed = parseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 Edg/125.0');

    expect(parsed).toMatchObject({
      browser: 'Microsoft Edge',
      os: 'Windows',
      deviceType: 'desktop'
    });
    expect(parsed.userAgent).toContain('Mozilla/5.0');
  });

  test('parseDevice maneja user-agent ausente sin romper', () => {
    expect(parseDevice('')).toEqual({
      userAgent: null,
      browser: null,
      os: null,
      deviceType: 'unknown',
      deviceName: 'Dispositivo no identificado'
    });
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

  test('mapSession normaliza camelCase y no expone hashes ni refresh token', () => {
    const session = sessionService.mapSession({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: '22222222-2222-4222-8222-222222222222',
      user_agent: 'Mozilla/5.0',
      ip_address: '190.233.10.15',
      browser: 'Google Chrome',
      os: 'Windows',
      device_type: 'desktop',
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
      browser: 'Google Chrome',
      os: 'Windows',
      deviceType: 'desktop',
      isCurrent: true
    });
    expect(session).not.toHaveProperty('refreshToken');
    expect(session).not.toHaveProperty('refresh_token_hash');
    expect(session).not.toHaveProperty('refreshTokenHash');
  });

  test('trustSession falla con 422 si no se cumplio trust_available_at', async () => {
    db.withTransaction.mockImplementation(async (callback) => callback({
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          user_id: '22222222-2222-4222-8222-222222222222',
          is_trusted: false,
          revoked_at: null,
          created_at: new Date(),
          trust_available_at: new Date(Date.now() + 86400000),
          expires_at: new Date(Date.now() + 86400000)
        }]
      })
    }));

    await expect(sessionService.trustSession(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { tenantId: '33333333-3333-4333-8333-333333333333' }
    )).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'TRUST_WAITING_PERIOD_NOT_MET'
    });
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
});
