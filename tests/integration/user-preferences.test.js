const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { getQaAuthToken } = require('../helpers/auth.helper');

const uploadsDir = path.join(__dirname, '../../uploads/profiles');
const defaultPreferences = {
  theme: 'light',
  language: 'es',
  sidebarCollapsed: false,
  density: 'comfortable',
  accentColor: 'green'
};

function createProfileFixture(filename) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), 'test-image');
}

describe('User UI Preferences & Profile Improvements', () => {
  let adminToken = '';
  let adminUserId = '';

  beforeAll(async () => {
    // Login to obtain a valid admin token
    adminToken = await getQaAuthToken(app, 'admin@demo.com', 'Demo123!');
    
    // Retrieve the admin user's id to perform verification checks
    const userRes = await query("SELECT id FROM users WHERE email = 'admin@demo.com'");
    if (userRes.rows.length > 0) {
      adminUserId = userRes.rows[0].id;
    }
  });

  beforeEach(async () => {
    // Reset preferences to default or null before each test to guarantee isolated states
    if (adminUserId) {
      await query("UPDATE users SET ui_preferences = $1::jsonb, profile_photo_url = null WHERE id = $2", [
        JSON.stringify(defaultPreferences),
        adminUserId
      ]);
    }
  });

  afterEach(() => {
    ['test-admin.jpg', 'test-login.jpg'].forEach((filename) => {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });

  test('GET /api/users/me/preferences - returns default visual preferences', async () => {
    const res = await request(app)
      .get('/api/users/me/preferences')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual(defaultPreferences);
  });

  test('PUT /api/users/me/preferences - performs partial update', async () => {
    const res = await request(app)
      .put('/api/users/me/preferences')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        theme: 'dark'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      ...defaultPreferences,
      theme: 'dark'
    });

    // Verify database persistence
    const dbRes = await query("SELECT ui_preferences FROM users WHERE id = $1", [adminUserId]);
    expect(dbRes.rows[0].ui_preferences).toEqual({
      ...defaultPreferences,
      theme: 'dark'
    });
  });

  test('PUT /api/users/me/preferences - performs complete update', async () => {
    const res = await request(app)
      .put('/api/users/me/preferences')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        theme: 'light',
        density: 'compact',
        accentColor: 'purple'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({
      ...defaultPreferences,
      theme: 'light',
      density: 'compact',
      accentColor: 'purple'
    });
  });

  test('PUT /api/users/me/preferences - rejects invalid values with HTTP 400', async () => {
    const res = await request(app)
      .put('/api/users/me/preferences')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        theme: 'neon-hacker'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error_code).toEqual('INVALID_THEME');
  });

  test('PUT /api/users/me/preferences - rejects unknown properties with HTTP 400', async () => {
    const res = await request(app)
      .put('/api/users/me/preferences')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        theme: 'dark',
        notAllowedKey: 'malicious-injected-data'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error_code).toEqual('INVALID_PREFERENCE_KEY');
  });

  test('GET /api/users/me - returns unified profile details including preferences', async () => {
    // Update preferences to check if they are returned correctly
    await query("UPDATE users SET ui_preferences = '{\"theme\": \"dark\", \"density\": \"compact\", \"accentColor\": \"blue\"}'::jsonb WHERE id = $1", [adminUserId]);

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id', adminUserId);
    expect(res.body.data).toHaveProperty('name');
    expect(res.body.data).toHaveProperty('fullName');
    expect(res.body.data).toHaveProperty('email', 'admin@demo.com');
    expect(res.body.data).toHaveProperty('role');
    expect(res.body.data).toHaveProperty('preferences', {
      ...defaultPreferences,
      theme: 'dark',
      density: 'compact',
      accentColor: 'blue'
    });
    expect(res.body.data).toHaveProperty('forcePasswordChange');
    expect(res.body.data.avatarUrl).toBeNull();
    expect(res.body.data.profilePhotoUrl).toBeNull();
  });

  test('GET /api/users/me - returns absolute photo URLs when profile photo exists', async () => {
    // Mock relative photo path
    createProfileFixture('test-admin.jpg');
    await query("UPDATE users SET profile_photo_url = '/uploads/profiles/test-admin.jpg' WHERE id = $1", [adminUserId]);

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    
    // Check absolute URL normalization
    expect(res.body.data.avatarUrl).toMatch(/^http:\/\/127.0.0.1:\d+\/uploads\/profiles\/test-admin.jpg$/);
    expect(res.body.data.profilePhotoUrl).toMatch(/^http:\/\/127.0.0.1:\d+\/uploads\/profiles\/test-admin.jpg$/);
  });

  test('POST /auth/login - returns preferences and absolute photo URLs in response', async () => {
    createProfileFixture('test-login.jpg');
    await query("UPDATE users SET profile_photo_url = '/uploads/profiles/test-login.jpg' WHERE id = $1", [adminUserId]);

    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'admin@demo.com',
        password: 'Demo123!'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toHaveProperty('preferences', {
      ...defaultPreferences
    });
    expect(res.body.data.user.avatarUrl).toMatch(/^http:\/\/127.0.0.1:\d+\/uploads\/profiles\/test-login.jpg$/);
    expect(res.body.data.user.profilePhotoUrl).toMatch(/^http:\/\/127.0.0.1:\d+\/uploads\/profiles\/test-login.jpg$/);
  });
});
