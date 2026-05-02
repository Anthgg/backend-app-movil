module.exports = {
  testEnvironment: 'node',
  verbose: true,
  setupFiles: ['./tests/test-setup.js'],
  testMatch: ['**/tests/integration/**/*.test.js', '**/tests/docs/**/*.test.js'],
};
