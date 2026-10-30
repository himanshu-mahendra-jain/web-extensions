// Check of edge.js against a mock of Partner Center's Store listings, modelled on the real
// page's markup, with descriptions from a mock GitHub and a local folder. The script is run
// the way pasting it into the console does.
// Run: NODE_PATH=$(npm root -g) node tests/autofill_on_mock_partner_center.test.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '..', 'edge.js'), 'utf8');
const URL = `https://partner.microsoft.com/en-us/dashboard/microsoftedge/11111111-2222-3333-4444-555555555555/listings`;

const YOUTUBE = 'https://www.youtube.com/watch?v=3L0DFOIFGVM';
const TERMS = ['sms to desktop', 'otp code', 'desktop sync'];
const DATA = {
  locales: Object.fromEntries(['am', 'ar', 'bn', 'es', 'es_419', 'ml', 'sw', 'zh_CN'].map((l) => [l, {
    description: `${l} description `.repeat(30).trim() + '\nSecond paragraph.',
  }])),
};
// The local folder's descriptions differ from GitHub's, to show which ones a run used.
const LOCAL = (locale) => `${DATA.locales[locale].description}\nLocal edition.`;

// A local descriptions folder: DATA's locales, plus "tooshort" (a too-short edge.txt) and
// "nofile" (no edge.txt).
function makeLocalFolder() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localization-helper-')), 'store-descriptions');
  for (const locale of Object.keys(DATA.locales)) {
    fs.mkdirSync(path.join(root, locale), { recursive: true });
    fs.writeFileSync(path.join(root, locale, 'edge.txt'), `\uFEFF${LOCAL(locale)}\r\n`);
    fs.writeFileSync(path.join(root, locale, 'chrome.txt'), `chrome ${locale}`);
  }
  fs.mkdirSync(path.join(root, 'tooshort'));
  fs.writeFileSync(path.join(root, 'tooshort', 'edge.txt'), 'short');
  fs.mkdirSync(path.join(root, 'nofile'));
  fs.writeFileSync(path.join(root, 'nofile', 'notes.md'), 'not a description');
  return root;
}

// Mock GitHub: owner/repo, branch "feature/x" (has a slash), folder "store/descriptions".
// Besides DATA's locales: "xx" has no edge.txt, "short" has a too-short one.
const SOURCE = 'https://github.com/owner/repo/tree/feature/x/store/descriptions';
const RAW = 'https://raw.githubusercontent.com/owner/repo/feature/x/store/descriptions/';
async function mockGithub(context) {
  await context.route('https://api.github.com/**', (route) => {
    const u = new globalThis.URL(route.request().url());
    const ok = u.pathname === '/repos/owner/repo/contents/store/descriptions' && u.searchParams.get('ref') === 'feature/x';
    if (!ok) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    const dirs = [...Object.keys(DATA.locales), 'xx', 'short'].map((name) => ({ name, type: 'dir' }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([...dirs, { name: 'README.md', type: 'file' }]) });
  });
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const rel = route.request().url().slice(RAW.length);
    const [locale, file] = rel.split('/');
    if (file === 'chrome.txt' && locale !== 'xx') return route.fulfill({ body: `chrome ${locale}` }); // short is fine for Chrome
    if (file !== 'edge.txt' || locale === 'xx') return route.fulfill({ status: 404, body: '404: Not Found' });
    if (locale === 'short') return route.fulfill({ body: 'too short' });
    return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: `${DATA.locales[locale].description}\r\n` });
  });
}

// Mock single-page app, modelled on Partner Center: the table and each language's data
// come from the API (served by the test from SERVER below); a details view renders its
// form first and fills it when the data arrives, resetting anything typed before (as
// the real page does); Save draft PUTs the form and shows "Draft saved successfully."
const PRODUCT = '11111111-2222-3333-4444-555555555555';
const API = `/en-us/dashboard/microsoftedge/api/${PRODUCT}/listings/storeListings`;
const MOCK_PAGE = `<!doctype html><html><body><div id="app"></div><script>
customElements.define('v6_he-button', class extends HTMLElement {});
const API = '${API}';
window.__publishClicked = 0; window.__listingCloseClicked = 0;
const app = document.getElementById('app');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function listing() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  const rows = await (await fetch(API)).json();
  app.innerHTML = '<h1>Store Listings</h1>' +
    '<v6_he-button id="listing-close">Close</v6_he-button><v6_he-button id="publish">Publish</v6_he-button>' +
    '<table><tr><th>Language</th><th>Status</th><th>Extension name</th><th>Description</th><th>Logo</th><th>Action</th></tr>' +
    rows.map((r, i) => '<tr><td><span> ' + r.lang + ' </span></td><td>' + (r.description ? 'Complete' : 'Incomplete') +
      '</td><td>HMJ SMS Desktop Sync</td><td>' + (r.description ? esc(r.description.slice(0, 40)) : 'Empty') +
      '</td><td>logo</td><td><button data-i="' + i + '"> Edit details </button><button>Remove</button></td></tr>').join('') +
    '</table>';
  app.querySelector('#publish').onclick = () => window.__publishClicked++;
  app.querySelector('#listing-close').onclick = () => window.__listingCloseClicked++;
  app.querySelectorAll('button[data-i]').forEach((b) => b.onclick = () => details(rows[b.dataset.i]));
}

function details(row) {
  let model = { description: '', keywords: [], urls: { VideoUrl: [] } };
  app.innerHTML = '<h2>Details for ' + row.lang + '</h2>' +
    '<div class="button-group"><v6_he-button class="save" disabled aria-disabled="true"><span>Save draft</span><v6_he-icon name="save"></v6_he-icon></v6_he-button>' +
    '<v6_he-button class="close"><span>Close</span></v6_he-button></div><div class="alerts"></div>' +
    '<input aria-label="Extension name" disabled value="HMJ SMS Desktop Sync">' +
    '<span id="formly_2_textarea_description_1">Description</span>' +
    '<textarea class="desc" maxlength="10000" aria-label="Description, Ensure your extension description is clear." title="Description " aria-labelledby="formly_2_textarea_description_1"></textarea>' +
    '<input class="yt" type="text" aria-label="YouTube video URL" placeholder="Provide a valid URL">' +
    '<app-search-terms><form><div class="entry"></div><ul class="search-terms"></ul></form></app-search-terms>';
  const save = app.querySelector('.save');
  const desc = app.querySelector('.desc');
  const yt = app.querySelector('.yt');
  const setSave = (enabled) => {
    if (enabled) { save.removeAttribute('disabled'); save.setAttribute('aria-disabled', 'false'); }
    else { save.setAttribute('disabled', ''); save.setAttribute('aria-disabled', 'true'); }
  };
  desc.addEventListener('input', () => { model.description = desc.value; setSave(true); });
  yt.addEventListener('input', () => { model.urls = { VideoUrl: yt.value ? [{ url: yt.value }] : [] }; setSave(true); });

  function renderTerms() {
    const entry = app.querySelector('.entry');
    entry.innerHTML = '<input type="text" id="last-search-item" maxlength="30"><button role="button" class="add" disabled> Add Term </button>';
    const input = entry.querySelector('input'); const add = entry.querySelector('.add');
    input.addEventListener('keyup', () => { add.disabled = !input.value.trim(); }); // not on input
    add.onclick = () => { model.keywords = [...model.keywords, input.value.trim()]; setSave(true); renderTerms(); };
    app.querySelector('.search-terms').innerHTML = model.keywords.map((t, i) => '<li><a role="button" class="keyword-value"> ' + esc(t) +
      '</a><a role="button" data-del="' + i + '" aria-label="Delete Search term - ' + esc(t) + '"></a></li>').join('');
    app.querySelectorAll('[data-del]').forEach((a) => a.onclick = () => {
      model.keywords = model.keywords.filter((_, k) => k !== +a.dataset.del); setSave(true); renderTerms();
    });
  }
  renderTerms();

  // The data arrives late (the test server delays it) and replaces the whole form.
  const load = async () => {
    const data = await (await fetch(API + '/' + row.id)).json();
    model = { description: data.description || '', keywords: [...data.keywords], urls: data.urls };
    desc.value = model.description;
    yt.value = (model.urls.VideoUrl[0] || {}).url || '';
    renderTerms();
    setSave(false);
  };
  load();
  setTimeout(load, 300);

  save.onclick = async () => {
    if (save.hasAttribute('disabled')) return;
    setSave(false);
    const res = await fetch(API + '/' + row.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(model) });
    if (res.ok) {
      const alerts = app.querySelector('.alerts');
      alerts.innerHTML = '<div role="alert">Draft saved successfully.</div>';
      setTimeout(() => { alerts.innerHTML = ''; }, 3000);
    }
  };
  app.querySelector('.close').onclick = () => setTimeout(listing, 300);
}
listing();
</script></body></html>`;

// The mock Partner Center API. Malayalam's PUT answers 200 but stores nothing (until the
// test turns loseMalayalamSaves off); Bangla's
// stores an extra empty search term, as the real API can.
const LANGS = { Amharic: 'am', Arabic: 'ar', Bangla: 'bn', 'Chinese (China)': 'zh_CN', Kiswahili: 'sw', Klingon: 'tlh',
  Malayalam: 'ml', Spanish: 'es', 'Spanish (Latin America and the Caribbean)': 'es_419' };
const SERVER = Object.fromEntries(Object.keys(LANGS).map((lang, i) => [
  `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  { lang, description: null, keywords: [], urls: { VideoUrl: [] } },
]));
SERVER['00000000-0000-0000-0000-000000000000'] = { lang: 'Amharic', description: 'old amharic text', keywords: ['old term'], urls: { VideoUrl: [] } };
let loseMalayalamSaves = true;
let putCount = 0;
const serverByLang = (lang) => Object.values(SERVER).find((l) => l.lang === lang);

async function partnerCenter(route) {
  const request = route.request();
  const url = new globalThis.URL(request.url());
  if (!url.pathname.startsWith(API)) return route.fulfill({ contentType: 'text/html', body: MOCK_PAGE });
  const id = url.pathname.slice(API.length + 1);
  const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  if (!id) return json(Object.entries(SERVER).map(([lid, l]) => ({ id: lid, ...l })));
  if (request.method() === 'GET') {
    await new Promise((r) => setTimeout(r, 700)); // late data, as on the real page
    return json({ id, ...SERVER[id] });
  }
  putCount++;
  const body = JSON.parse(request.postData());
  await new Promise((r) => setTimeout(r, 400));
  if (SERVER[id].lang === 'Bangla') body.keywords = [...body.keywords, ''];
  if (SERVER[id].lang !== 'Malayalam' || !loseMalayalamSaves) Object.assign(SERVER[id], body);
  return json({ id, ...SERVER[id] });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext();
  await mockGithub(context);
  await context.route('https://partner.microsoft.com/**', partnerCenter);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const paste = () => page.evaluate(SCRIPT);
  await page.goto(URL);
  await page.waitForSelector('table');
  await paste();

  const panel = page.locator('#localization-helper-edge');
  const shadowText = (sel) => `document.querySelector('#localization-helper-edge')?.shadowRoot?.querySelector('${sel}')?.textContent ?? ''`;
  const waitForText = (sel, re, timeout = 30000) => page.waitForFunction(([js, src]) => new RegExp(src).test(eval(js)),
    [shadowText(sel), re.source], { timeout });
  const waitForData = (re) => waitForText('.data', re);
  const dataText = () => panel.locator('.data').textContent();
  const message = () => panel.locator('.message').textContent();
  const storedRun = () => page.evaluate(() => JSON.parse(localStorage.getItem('localizationHelper.edge.run')));

  // 0. Nothing loaded: Start disabled. A bad URL or a missing folder shows an error.
  assert.match(await dataText(), /No Edge descriptions loaded\. Enter the GitHub folder/);
  assert.equal(await panel.locator('input[name="source-kind"][value="github"]').isChecked(), true);
  assert.equal(await panel.locator('button.start').isDisabled(), true);
  assert.equal(await panel.locator('input.file').inputValue(), 'edge.txt');
  await panel.locator('input.source').fill('https://gitlab.com/owner/repo');
  await panel.locator('button.load').click();
  await waitForData(/Enter a GitHub folder URL/);
  await panel.locator('input.source').fill('https://github.com/owner/repo/tree/main/nope');
  await panel.locator('button.load').click();
  await waitForData(/Folder not found in owner\/repo/);
  assert.equal(await panel.locator('button.start').isDisabled(), true);

  // Loads from a branch with a slash; skips the folder without edge.txt and the short text.
  await panel.locator('input.source').fill(SOURCE);
  await panel.locator('input.source').press('Enter');
  await waitForData(/Loaded 8 Edge descriptions/);
  assert.match(await dataText(), /Loaded 8 Edge descriptions \(edge\.txt\) from owner\/repo@feature\/x\/store\/descriptions/);
  assert.match(await dataText(), /Skipped: short: 9 characters \(must be 250-10000\); xx: no edge\.txt/);
  assert.match(await panel.locator('.fills').textContent(), /not YouTube URL, not search terms/);
  console.log('GitHub load ok');

  // After a reload, pasting again brings back the loaded descriptions and the URL.
  await page.reload();
  await page.waitForSelector('table');
  await paste();
  await waitForData(/Loaded 8 Edge descriptions/);
  assert.equal(await panel.locator('input.source').inputValue(), SOURCE);
  assert.equal(await panel.locator('button.start').isDisabled(), false);
  console.log('reload keeps data ok');

  // 1. Search terms: comma separated, limits enforced while typing and pasting.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://partner.microsoft.com' });
  const terms = panel.locator('input.terms');
  const hint = () => panel.locator('.terms-hint').textContent();
  const counter = () => panel.locator('.terms-counter').textContent();
  const pasteTerms = async (text) => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await terms.focus();
    await page.keyboard.press('ControlOrMeta+v');
  };
  assert.equal(await counter(), '0/7 terms · longest 0/30 characters · 0/21 words');

  await terms.pressSequentially('a, b, c, d, e, f, g');
  await terms.press(',');
  assert.equal(await terms.inputValue(), 'a, b, c, d, e, f, g', '8th term refused');
  assert.match(await hint(), /Maximum 7 search terms/);
  assert.equal(await counter(), '7/7 terms · longest 1/30 characters · 7/21 words');

  await terms.fill('');
  await terms.pressSequentially('x'.repeat(31));
  assert.equal(await terms.inputValue(), 'x'.repeat(30), '31st character refused');
  assert.match(await hint(), /Maximum 30 characters per search term/);

  await terms.fill('😀'.repeat(15)); // 30 UTF-16 units, as Partner Center counts
  assert.match(await counter(), /longest 30\/30 characters/);
  await terms.pressSequentially('😀');
  assert.equal(await terms.inputValue(), '😀'.repeat(15), 'emoji counted as 2 characters');

  const sevenByThree = Array.from({ length: 7 }, (_, i) => `t${i} u${i} v${i}`).join(', ');
  await terms.fill(sevenByThree);
  await terms.press('End');
  await terms.pressSequentially(' w');
  assert.equal(await terms.inputValue(), `${sevenByThree} `, '22nd word refused');
  assert.match(await hint(), /Maximum 21 words/);

  await terms.fill('');
  await pasteTerms('one\ntwo\r\nthree');
  assert.equal(await terms.inputValue(), 'one, two, three', 'pasted lines become terms');
  await terms.fill('');
  await pasteTerms('1,2,3,4,5,6,7,8');
  assert.equal(await terms.inputValue(), '', 'over-limit paste refused');
  assert.match(await hint(), /Paste refused\. Maximum 7 search terms/);

  await terms.fill('dup, Dup');
  assert.match(await panel.locator('.errors').textContent(), /duplicate/);
  assert.equal(await panel.locator('button.start').isDisabled(), true);
  console.log('search terms limits ok');

  // Invalid YouTube URL disables Start.
  await panel.locator('input.youtube').fill('https://example.com/video');
  assert.match(await panel.locator('.errors').textContent(), /YouTube URL must look like/);
  assert.equal(await panel.locator('button.start').isDisabled(), true);
  await panel.locator('input.youtube').fill(YOUTUBE);
  await terms.fill(TERMS.join(', '));
  assert.equal(await panel.locator('.errors').textContent(), '');
  assert.match(await panel.locator('.fills').textContent(), /YouTube URL, 3 search terms/);
  console.log('panel validation ok');

  // Local folder: its descriptions replace GitHub's and start the run over.
  await panel.locator('input[name="source-kind"][value="local"]').check();
  assert.equal(await panel.locator('input.source').isVisible(), false);
  assert.equal(await panel.locator('button.load').textContent(), 'Choose folder');
  assert.match(await dataText(), /press Choose folder to use them/);
  await panel.locator('input.folder').setInputFiles(makeLocalFolder());
  await waitForData(/from local folder "store-descriptions"/);
  assert.match(await dataText(), /Loaded 8 Edge descriptions \(edge\.txt\) from local folder "store-descriptions" at .*\nSkipped: nofile: no edge\.txt; tooshort: 5 characters \(must be 250-10000\)\nAfter editing the files, choose the folder again\./);
  assert.equal(await panel.locator('.progress').textContent(), 'Done 0/8', 'new descriptions start the run over');
  assert.equal(await message(), 'Descriptions loaded. Press Start.');
  console.log('local folder ok');

  // 2. "Next language only" does Amharic (overwriting old values) and stops.
  await panel.locator('button.one').click();
  await waitForText('.message', /Amharic: /, 60000);
  assert.equal(await message(), 'Amharic: saved description, YouTube URL, search terms, checked.');
  const saved = (lang) => { const { description, keywords, urls } = serverByLang(lang); return { description, keywords, urls }; };
  assert.deepEqual(saved('Amharic'), { description: LOCAL('am'), keywords: TERMS, urls: { VideoUrl: [{ url: YOUTUBE }] } });
  assert.equal(saved('Arabic').description, null, 'only one language done');
  console.log('next-language-only ok (form data arriving late did not wipe the fill)');

  // 3. Full run with the YouTube field empty (left as is) and the terms reversed: Amharic
  // has the same terms in another order, so it counts as up to date and keeps its order.
  // Malayalam's save is silently lost: caught by reading it back, retried, then failed.
  // The page reloads part way: pasting again and "Start: all incomplete languages" goes on.
  const REVERSED = [...TERMS].reverse();
  await panel.locator('input.youtube').fill('');
  await terms.fill(REVERSED.join(', '));
  await panel.locator('button.start').click();
  await waitForText('.progress', /^Done 3\/8/, 120000);
  await page.reload();
  await page.waitForSelector('table');
  await paste();
  assert.match(await message(), /The last run was interrupted/);
  assert.equal(await panel.locator('.progress').textContent(), 'Done 3/8');
  assert.equal(await terms.inputValue(), REVERSED.join(', '));
  await panel.locator('button.incomplete').click();
  await waitForText('.message', /Finished/, 300000);
  const expect = { Arabic: 'ar', Bangla: 'bn', 'Chinese (China)': 'zh_CN', Kiswahili: 'sw',
    Spanish: 'es', 'Spanish (Latin America and the Caribbean)': 'es_419' };
  for (const [lang, locale] of Object.entries(expect)) {
    const keywords = lang === 'Bangla' ? [...REVERSED, ''] : REVERSED;
    assert.deepEqual(saved(lang), { description: LOCAL(locale), keywords, urls: { VideoUrl: [] } }, lang);
  }
  assert.deepEqual(saved('Amharic'), { description: LOCAL('am'), keywords: TERMS, urls: { VideoUrl: [{ url: YOUTUBE }] } },
    'Amharic keeps its YouTube URL and its term order');
  assert.deepEqual((await storedRun()).done.am.changed, [], 'Amharic not saved again');
  assert.equal(saved('Malayalam').description, null);
  const finalMessage = await message();
  assert.match(finalMessage, /Finished: 7 done, 1 failed; rows with no data: Klingon/);
  assert.match(await panel.locator('.failed').textContent(), /ml: Partner Center did not store: description \(empty\)/);
  assert.equal(await page.evaluate(() => window.__publishClicked), 0, 'never clicks Publish');
  assert.equal(await page.evaluate(() => window.__listingCloseClicked), 0, "never clicks the listing page's Close");
  console.log('full run with a reload ok:', finalMessage);

  // 4. "Start: all incomplete languages" skips the 7 done languages and retries Malayalam.
  const incomplete = panel.locator('button.incomplete');
  assert.equal(await incomplete.textContent(), 'Start: all incomplete languages (1)');
  assert.equal(await incomplete.isDisabled(), false);
  loseMalayalamSaves = false;
  const putsBefore = putCount;
  await incomplete.click();
  await waitForText('.message', /Finished/, 120000);
  assert.match(await message(), /Finished: 8 done, 0 failed; rows with no data: Klingon/);
  assert.deepEqual(saved('Malayalam'), { description: LOCAL('ml'), keywords: REVERSED, urls: { VideoUrl: [] } });
  assert.equal(putCount - putsBefore, 1, 'only Malayalam saved');
  assert.equal(await panel.locator('.failed').textContent(), '');
  assert.equal(await incomplete.isDisabled(), true, 'nothing left to do');
  assert.equal(await incomplete.textContent(), 'Start: all incomplete languages (0)');
  console.log('incomplete-languages run ok');

  // 5. Pasting again during a run replaces the panel; the old run stops and the new one
  // finishes the languages.
  await panel.locator('button.start').click();
  await waitForText('.progress', /^Done 2\/8/, 120000);
  await paste();
  assert.equal(await page.locator('#localization-helper-edge').count(), 1);
  assert.match(await message(), /The last run was interrupted/);
  await page.waitForTimeout(8000); // the old run finishes its current step and stops
  await panel.locator('button.incomplete').click();
  await waitForText('.message', /Finished/, 300000);
  assert.match(await message(), /Finished: 8 done, 0 failed/);
  assert.equal(putCount - putsBefore, 1, 'everything was up to date');
  console.log('second paste ok');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
