const { test, expect, chromium } = require('@playwright/test');

const BASE_URL = 'https://elements-order-form.vercel.app/';
const PASSWORD = '4892';
const CLIENT_COUNT = 15;

async function findByCandidates(page, candidates) {
  for (const locator of candidates) {
    if (await locator.count()) return locator.first();
  }
  return null;
}

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const passwordInput = await findByCandidates(page, [
    page.getByLabel(/パスワード/i),
    page.getByPlaceholder(/パスワード/i),
    page.locator('input[type="password"]'),
  ]);

  if (passwordInput) {
    await passwordInput.fill(PASSWORD);
    const loginButton = await findByCandidates(page, [
      page.getByRole('button', { name: /ログイン|login|認証|入室/i }),
      page.locator('button:has-text("ログイン")'),
    ]);
    if (loginButton) {
      await loginButton.click();
    } else {
      await passwordInput.press('Enter');
    }
  }

  await page.waitForLoadState('networkidle');
}

async function assertSyncStatus(page) {
  await expect(
    page.getByText(/✓\s*(旧GAS同期|接続済み)/)
  ).toBeVisible();
}

async function clickLoad(page) {
  const loadButton = await findByCandidates(page, [
    page.getByRole('button', { name: /^読込$/ }),
    page.getByRole('button', { name: /読込|再読込|同期/i }),
  ]);
  expect(loadButton, '読込ボタンが見つかりません').toBeTruthy();
  await loadButton.click();
  await page.waitForTimeout(1500);
}

async function addCartItem(page, projectName, suffix) {
  const projectInput = await findByCandidates(page, [
    page.getByLabel(/案件名/i),
    page.getByPlaceholder(/案件名/i),
    page.locator('input').filter({ hasText: '' }).nth(0),
  ]);
  expect(projectInput, '案件名入力が見つかりません').toBeTruthy();
  await projectInput.fill(projectName);

  const inputs = page.locator('input[type="text"], input:not([type])');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const ph = (await input.getAttribute('placeholder')) || '';
    if (/品番/.test(ph)) await input.fill(`SKU-${suffix}`);
    if (/カラー/.test(ph)) await input.fill('BLACK');
    if (/サイズ/.test(ph)) await input.fill('M');
  }

  const qtyInput = await findByCandidates(page, [
    page.getByLabel(/使用枚数|数量/i),
    page.getByPlaceholder(/使用枚数|数量/i),
    page.locator('input[type="number"]').first(),
  ]);
  if (qtyInput) await qtyInput.fill('3');

  const addButton = await findByCandidates(page, [
    page.getByRole('button', { name: /発注カートに入れる|カートに入れる|追加/i }),
  ]);
  expect(addButton, 'カート追加ボタンが見つかりません').toBeTruthy();
  await addButton.click();
  await page.waitForTimeout(1500);
}

test.describe('同期機能E2E (15端末並列)', () => {
  test('検証1-6を15端末で実施', async () => {
    test.setTimeout(10 * 60 * 1000);
    const browser = await chromium.launch({ headless: true });
    const contexts = [];
    const pages = [];

    try {
      for (let i = 0; i < CLIENT_COUNT; i += 1) {
        const context = await browser.newContext();
        const page = await context.newPage();
        contexts.push(context);
        pages.push(page);
      }

      await Promise.all(pages.map((page) => login(page)));
      await Promise.all(pages.map((page) => assertSyncStatus(page)));

      const pageA = pages[0];
      const pageB = pages[1];
      const projectA = `同期テストA-${Date.now()}`;
      const projectB = `同期テストB-${Date.now()}`;

      // 検証1
      await addCartItem(pageA, projectA, 'A1');
      await clickLoad(pageB);
      await expect(pageB.getByText(projectA)).toBeVisible();

      // 検証2
      await addCartItem(pageB, projectB, 'B1');
      await clickLoad(pageA);
      await expect(pageA.getByText(projectA)).toBeVisible();
      await expect(pageA.getByText(projectB)).toBeVisible();

      // 検証3
      const clearButton = await findByCandidates(pageA, [
        pageA.getByRole('button', { name: /クリア/i }).first(),
      ]);
      expect(clearButton, 'クリアボタンが見つかりません').toBeTruthy();
      pageA.once('dialog', (d) => d.accept());
      await clearButton.click();

      await expect(pageA.getByText(/✓\s*カートをクリアしました/)).toBeVisible();
      await pageA.waitForTimeout(10_000);
      await expect(pageA.getByText(projectA)).not.toBeVisible();

      await clickLoad(pageB);
      await expect(pageB.getByText(projectA)).not.toBeVisible();

      // 検証4
      await pageA.evaluate(() => window.open(window.location.href, '_blank'));
      const popup = await pageA.context().waitForEvent('page');
      await popup.waitForLoadState('domcontentloaded');
      await popup.close();
      await pageA.bringToFront();

      await expect(pageA.getByText(projectA)).not.toBeVisible();

      const makerTab = pageA.getByRole('tab').first();
      if (await makerTab.count()) {
        await makerTab.click();
        await pageA.waitForTimeout(300);
      }
      await expect(pageA.getByText(projectA)).not.toBeVisible();

      // 検証5
      await addCartItem(pageA, `履歴テスト-${Date.now()}`, 'H1');
      const exportButton = await findByCandidates(pageA, [
        pageA.getByRole('button', { name: /Excel発注書|CSV出力|発注書/i }),
      ]);
      expect(exportButton, '履歴作成用の出力ボタンが見つかりません').toBeTruthy();
      await exportButton.click();
      await pageA.waitForTimeout(1500);

      const historyTab = await findByCandidates(pageA, [
        pageA.getByRole('tab', { name: /発注履歴/i }),
        pageA.getByRole('button', { name: /発注履歴/i }),
      ]);
      expect(historyTab, '発注履歴タブが見つかりません').toBeTruthy();
      await historyTab.click();
      const historyList = pageA.getByText(/履歴|発注|CSV|Excel/);
      await expect(historyList.first()).toBeVisible();

      await pageA.reload({ waitUntil: 'domcontentloaded' });
      await login(pageA);
      const historyTabAfterReload = await findByCandidates(pageA, [
        pageA.getByRole('tab', { name: /発注履歴/i }),
        pageA.getByRole('button', { name: /発注履歴/i }),
      ]);
      await historyTabAfterReload.click();
      await expect(historyList.first()).toBeVisible();

      // 検証6
      await clickLoad(pageB);
      const historyTabB = await findByCandidates(pageB, [
        pageB.getByRole('tab', { name: /発注履歴/i }),
        pageB.getByRole('button', { name: /発注履歴/i }),
      ]);
      await historyTabB.click();
      await expect(pageB.getByText(/履歴|発注|CSV|Excel/).first()).toBeVisible();

      // 15端末全体の同期状態を最終確認
      await Promise.all(pages.map((page) => clickLoad(page)));
      await Promise.all(pages.map((page) => assertSyncStatus(page)));
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
      await browser.close();
    }
  });
});
