const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: 'https://elements-order-form.vercel.app/',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
