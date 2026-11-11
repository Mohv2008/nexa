import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing page offers downloads, browser access, media, and motion', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Find your people/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue in browser/i }).first()).toHaveAttribute(
    'href',
    '/app',
  );
  await expect(page.locator('video')).toHaveAttribute('poster', '/images/nexa-community.png');
  await expect(page.locator('video source')).toHaveAttribute('src', '/media/nexa-preview.webm');
  await expect(page.locator('.float-pill')).toHaveCount(3);
  if (testInfo.project.name === 'chromium') {
    await page.waitForTimeout(1200);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: 'docs/screenshots/landing.png' });
  }
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page
    .getByRole('navigation', { name: 'Landing navigation' })
    .getByRole('button', { name: 'Downloads' })
    .click();
  await expect(page.getByRole('heading', { name: /One account/i })).toBeInViewport();
});

test('register, create a community, chat, post, and log out', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith('mobile'),
    'Desktop workflow has a separate mobile smoke test',
  );
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const postText = `A real post from Playwright ${suffix}`;
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: 'docs/screenshots/auth.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Display name').fill('E2E Person');
  await page.getByLabel('Username').fill(`e2e_${suffix}`);
  await page.getByLabel('Email').fill(`e2e-${suffix}@example.com`);
  await page.getByLabel('Password').fill('Correct Horse Battery 7');
  await page.getByLabel('Date of birth').fill('2000-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Create community' }).click();
  await page.getByLabel('Name').fill('E2E Community');
  await page.getByLabel('Description').fill('Created by Playwright');
  await page.getByLabel('Visibility', { exact: true }).selectOption('public');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'general' })).toBeVisible();
  const composer = page.getByLabel('Message general');
  await composer.fill('A message from the E2E test');
  await composer.press('Enter');
  await expect(page.getByText('A message from the E2E test')).toBeVisible();
  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: 'docs/screenshots/community.png', fullPage: true });
  }

  await page.getByRole('button', { name: 'Home feed' }).click();
  await page.getByLabel('Post text').fill(postText);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText(postText, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
});

test('authentication screen has no automatically detectable WCAG A/AA violations', async ({
  page,
}) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('mobile registration layout remains usable at a narrow viewport', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only assertion');
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByLabel('Date of birth')).toBeInViewport();
});
