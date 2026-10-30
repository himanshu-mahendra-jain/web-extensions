// Check of chrome.js against a mock of the Chrome Web Store
// Developer Dashboard's Store listing page, modelled on the real page: a Language menu whose
// options sit next to it, one Description box whose text the page swaps per language, all
// languages saved by one Save draft request, and Trusted Types (no innerHTML). The script is
// run the way pasting it into the console does, with descriptions from a mock GitHub and a
// local folder.
// Run: NODE_PATH=$(npm root -g) node tests/autofill_on_mock_chrome_webstore_dashboard.test.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '..', 'chrome.js'), 'utf8');
// Served from another host: Chromium closes a tab that Playwright navigates to the store's
// own chrome.google.com/webstore, and the script does not depend on the host.
const PAGE_URL = 'https://dashboard.webstore.test/webstore/devconsole/publisher/item/edit';
const SAVE_URL = 'https://dashboard.webstore.test/webstore/devconsole/save';

// The dashboard's languages: [option value, option text]. Hebrew's value is the old "iw".
const LANGUAGES = [['en', 'English – en'], ['de', 'German – de'], ['es-419', 'Spanish (Latin America) – es-419'],
  ['fr', 'French – fr'], ['iw', 'Hebrew – he'], ['ja', 'Japanese – ja'], ['pt-BR', 'Portuguese (Brazil) – pt-BR']];

// Descriptions folder: ja has none; ko has no chrome.txt; it is too long; xx is no language
// the dashboard offers; de has an edge.txt too, which must not be used.
const DESCRIPTION = (l, from = 'GitHub') => `${l} description from ${from}.\n\n${l} second paragraph.`;
const FOLDERS = ['de', 'en', 'es_419', 'fr', 'he', 'it', 'ko', 'pt_BR', 'xx'];
const FILES = (from) => ({
  ...Object.fromEntries(FOLDERS.filter((l) => !['ko', 'it'].includes(l))
    .map((l) => [`ext/store-descriptions/${l}/chrome.txt`, `﻿${DESCRIPTION(l, from)}\r\n`])),
  'ext/store-descriptions/it/chrome.txt': 'x'.repeat(16001),
  'ext/store-descriptions/ko/edge.txt': 'not this one',
  'ext/store-descriptions/de/edge.txt': 'not this one',
});
const SOURCE = 'https://github.com/owner/repo/tree/main/ext/store-descriptions';
const EXPECTED = ['de', 'en', 'es_419', 'fr', 'he', 'pt_BR'];
const VALUE_OF = { es_419: 'es-419', he: 'iw', pt_BR: 'pt-BR' };

async function mockGithub(context) {
  const files = FILES('GitHub');
  await context.route('https://api.github.com/**', (route) => {
    const u = new globalThis.URL(route.request().url());
    if (u.pathname !== '/repos/owner/repo/contents/ext/store-descriptions' || u.searchParams.get('ref') !== 'main') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FOLDERS.map((name) => ({ name, type: 'dir' }))) });
  });
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const rel = decodeURIComponent(new globalThis.URL(route.request().url()).pathname.replace('/owner/repo/main/', ''));
    return rel in files ? route.fulfill({ body: files[rel] }) : route.fulfill({ status: 404, body: '404: Not Found' });
  });
}

// The extension folder on disk; the test picks its parent ext/, above the descriptions folder.
function makeLocalFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localization-helper-cws-'));
  for (const [rel, text] of Object.entries({ ...FILES('disk'), 'ext/manifest.json': '{}' })) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return path.join(root, 'ext');
}

// ---------------------------------------------------------------------------
// Mock dashboard. The server keeps the saved draft; the page keeps unsaved edits for every
// language until Save draft posts all of them at once.

const SERVER = { en: 'Old English description', de: 'Alte Beschreibung' };
const saves = [];
let failSave = false;
let submitted = false;

const PAGE = () => `<!doctype html><html><head><meta charset="utf-8"><title>Developer Dashboard</title></head><body>
<h1>Store listing</h1>
<div class="language-field">
  <div role="combobox" tabindex="0" aria-expanded="false" aria-controls="language-popup"><span>Language</span> <span class="current"></span></div>
  <span id="language-popup"></span>
  <ul role="listbox" hidden>${LANGUAGES.map(([v, t]) => `<li role="option" data-value="${v}">${t}</li>`).join('')}</ul>
</div>
<div><span id="description-label">Description*</span><textarea aria-labelledby="description-label" maxlength="16000" rows="8" cols="80"></textarea></div>
<div aria-live="polite">Read our guides and tips for store listings</div>
<div role="status" class="toast"></div>
<button type="button">Save draft</button> <button type="button">Submit for review</button>
<script>
  const saved = ${JSON.stringify(SERVER)};
  const edits = {};
  const names = Object.fromEntries([...document.querySelectorAll('[role=option]')].map((o) => [o.dataset.value, o.textContent]));
  const combo = document.querySelector('[role=combobox]');
  const listbox = document.querySelector('[role=listbox]');
  const box = document.querySelector('textarea');
  const toast = document.querySelector('.toast');
  let current = 'en';
  // A language without text of its own shows the default language's.
  const textOf = (l) => edits[l] ?? saved[l] ?? edits.en ?? saved.en ?? '';
  function show(l) {
    current = l;
    combo.querySelector('.current').textContent = names[l];
    // The fields are swapped in a moment after the menu changes.
    setTimeout(() => { if (current === l) box.value = textOf(l); }, 150);
  }
  combo.addEventListener('click', () => { listbox.hidden = !listbox.hidden; });
  listbox.addEventListener('click', (e) => {
    const option = e.target.closest('[role=option]');
    if (!option || listbox.hidden) return;
    listbox.hidden = true;
    setTimeout(() => show(option.dataset.value), 80);
  });
  box.addEventListener('input', () => { edits[current] = box.value; });
  const buttons = [...document.querySelectorAll('button')];
  buttons[0].addEventListener('click', async () => {
    toast.textContent = 'Saving item...';
    const response = await fetch('/webstore/devconsole/save', { method: 'POST', body: JSON.stringify({ ...saved, ...edits }) });
    await new Promise((r) => setTimeout(r, 300));
    if (response.ok) {
      Object.assign(saved, edits);
      for (const l of Object.keys(edits)) delete edits[l];
      toast.textContent = 'Item saved.';
      setTimeout(() => { toast.textContent = ''; }, 3000);
    } else {
      toast.textContent = 'Something went wrong. Please try again.';
    }
  });
  buttons[1].addEventListener('click', () => fetch('/webstore/devconsole/submit', { method: 'POST' }));
  show('en');
</script></body></html>`;

async function mockDashboard(context) {
  await context.route('https://dashboard.webstore.test/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url === PAGE_URL) {
      // The real dashboard requires Trusted Types, so innerHTML from the script would fail.
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE(),
        headers: { 'Content-Security-Policy': "require-trusted-types-for 'script'" } });
    }
    if (url === SAVE_URL && request.method() === 'POST') {
      saves.push(JSON.parse(request.postData()));
      if (failSave) return route.fulfill({ status: 500, body: 'error' });
      Object.assign(SERVER, saves.at(-1));
      return route.fulfill({ body: 'ok' });
    }
    if (url.endsWith('/submit')) submitted = true;
    return route.fulfill({ status: 404, body: 'not found' });
  });
}

// ---------------------------------------------------------------------------

(async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext();
  await mockGithub(context);
  await mockDashboard(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());

  const panel = page.locator('#localization-helper-cws');
  const button = (text) => panel.locator('button', { hasText: text });
  const status = () => panel.locator('[role=status]').innerText();
  const details = () => panel.locator('[role=status] + div').innerText();
  const paste = () => page.evaluate(SCRIPT);
  const openPage = async () => { await page.goto(PAGE_URL); await page.waitForTimeout(300); await paste(); };
  async function start() {
    await button('Start').click();
    await page.waitForFunction(() => document.querySelector('#localization-helper-cws input[type=url]')?.disabled === false,
      null, { timeout: 60000 });
  }
  // The page's text for a language, read through its own Language menu like a person would.
  async function pageText(value) {
    return page.evaluate(async (v) => {
      document.querySelector('[role=combobox]').click();
      document.querySelector(`[role=option][data-value="${v}"]`).click();
      await new Promise((r) => setTimeout(r, 400));
      return document.querySelector('textarea').value;
    }, value);
  }
  const step = (name) => console.log(`- ${name}`);

  try {
    step('the panel opens with Start disabled until descriptions load');
    await openPage();
    assert.equal(await button('Start').isDisabled(), true);
    assert.match(await status(), /Load the descriptions/);

    step('a URL that is not a GitHub folder is refused');
    await panel.locator('input[type=url]').fill('https://example.com/folder');
    await button('Load').click();
    await page.waitForFunction(() => /Not loaded/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    assert.match(await status(), /Enter a GitHub folder URL/);

    step('Load from GitHub shows what will be filled before anything is');
    await panel.locator('input[type=url]').fill(SOURCE);
    await panel.locator('input[type=url]').press('Enter');
    await page.waitForFunction(() => /Press Start/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    assert.equal(await button('Start').innerText(), 'Start: fill 6 languages');
    let text = await details();
    assert.match(text, /To fill: de, en, es_419, fr, he, pt_BR/);
    assert.match(text, /it: 16001 characters/);
    assert.match(text, /ko: no chrome\.txt/);
    assert.match(text, /Not offered by the dashboard: xx/);
    assert.match(text, /Dashboard languages with no chrome\.txt: ja/);
    assert.equal(await page.locator('textarea').inputValue(), 'Old English description', 'Load changed the page');

    step('a typed file name is used instead of chrome.txt; changing it needs a new Load');
    const fileField = panel.locator('input[type=text]');
    const loadedNow = () => page.waitForFunction(() => /Press Start/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    assert.equal(await fileField.inputValue(), 'chrome.txt');
    await fileField.fill('edge.txt');
    assert.match(await status(), /File name changed/);
    assert.equal(await button('Start').isDisabled(), true);
    await button('Load').click();
    await loadedNow();
    assert.match(await status(), /Loaded 2 descriptions \(edge\.txt\)/);
    assert.match(await details(), /To fill: de$/m);
    assert.match(await details(), /Not offered by the dashboard: ko/);
    await fileField.fill('chrome.txt');
    await button('Load').click();
    await loadedNow();

    step('Fill only fills every language and sends no save request');
    await panel.locator('input[type=checkbox]').check();
    await start();
    assert.match(await status(), /Filled 6 languages, not saved/);
    assert.equal(saves.length, 0);
    assert.equal(await page.locator('[role=combobox]').innerText().then((t) => t.replace(/\s+/g, ' ')), 'Language English – en',
      'the menu is back on the starting language');
    assert.equal(await page.locator('textarea').inputValue(), DESCRIPTION('en'));
    assert.equal(await pageText('iw'), DESCRIPTION('he'));
    assert.equal(await pageText('ja'), DESCRIPTION('en'), 'ja shows the default language, unfilled');

    step('Start without Fill only saves the languages filled before, in one request');
    await panel.locator('input[type=checkbox]').uncheck();
    await start();
    assert.match(await status(), /Saved 6 languages as a draft/);
    assert.equal(saves.length, 1);
    for (const l of EXPECTED) assert.equal(SERVER[VALUE_OF[l] || l], DESCRIPTION(l), `${l} saved`);
    assert.equal(SERVER.ja, undefined);
    assert.match(await details(), /Saved as draft: de, en, es_419, fr, he, pt_BR/);

    step('Start again: everything up to date, no second save');
    await start();
    assert.match(await status(), /Nothing to change/);
    assert.match(await details(), /Already up to date: de, en, es_419, fr, he, pt_BR/);
    assert.equal(saves.length, 1);

    step('after a reload the URL is remembered and the draft is up to date');
    await openPage();
    assert.equal(await panel.locator('input[type=url]').inputValue(), SOURCE);
    await button('Load').click();
    await page.waitForFunction(() => /Press Start/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    await start();
    assert.match(await status(), /Nothing to change/);
    assert.equal(saves.length, 1);

    step('Stop right after Start ends the run without saving');
    await openPage();
    await panel.locator('input[type=file]').setInputFiles(makeLocalFolder());
    await page.waitForFunction(() => /Press Start/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    assert.match(await status(), /from local folder "ext\/store-descriptions"/);
    await button('Start').click();
    await button('Stop').click();
    await page.waitForFunction(() => document.querySelector('#localization-helper-cws input[type=url]')?.disabled === false);
    assert.match(await status(), /^Stopped\. Filled languages are not saved/);
    assert.match(await details(), /Filled, not saved: de$/m);
    assert.equal(saves.length, 1);

    step('a failed save is reported, and Start again saves once it works');
    failSave = true;
    await start();
    assert.match(await status(), /Saving failed/);
    assert.match(await details(), /Save draft: Something went wrong/);
    assert.equal(saves.length, 2);
    failSave = false;
    await start();
    assert.match(await status(), /Saved 6 languages as a draft/);
    assert.equal(saves.length, 3);
    for (const l of EXPECTED) assert.equal(SERVER[VALUE_OF[l] || l], DESCRIPTION(l, 'disk'), `${l} saved from disk`);

    step('pasting again mid-run replaces the panel; the old run stops and leaves the page alone');
    await openPage();
    await button('Load').click();
    await page.waitForFunction(() => /Press Start/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    await button('Start').click();
    await page.waitForTimeout(1200);
    await paste();
    assert.equal(await page.locator('#localization-helper-cws').count(), 1);
    await button('Load').click();
    await page.waitForFunction(() => /Press Start/.test(document.querySelector('#localization-helper-cws [role=status]').textContent));
    await start();
    assert.match(await status(), /Saved 6 languages as a draft\. Reload/);
    assert.equal(saves.length, 4, 'only the new panel saved');
    for (const l of EXPECTED) assert.equal(SERVER[VALUE_OF[l] || l], DESCRIPTION(l), `${l} saved from GitHub`);
    await page.waitForTimeout(3000);
    assert.equal(saves.length, 4);

    assert.equal(submitted, false, 'Submit for review was clicked');
    assert.deepEqual(errors, []);
    console.log('ALL PASSED');
  } catch (e) {
    console.log(await panel.innerText().catch(() => '(no panel)'));
    console.log('page errors:', errors);
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
