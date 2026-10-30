// Check of firefox.js against a mock of addons.mozilla.org's Edit Product Page (Developer
// Hub), modelled on the real page's markup and scripts, with the descriptions and the
// manifest's _locales read from a local folder. The script is run the way pasting it into
// the console does. Pass --firefox to run it in Playwright's Firefox instead of Chromium.
// Run: NODE_PATH=$(npm root -g) node tests/autofill_on_mock_amo_devhub.test.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const playwright = require('@playwright/test');

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '..', 'firefox.js'), 'utf8');
const ADDON = '/en-US/developers/addon/test-addon';
const PAGE_URL = `https://addons.mozilla.org${ADDON}/edit`;
const EDIT = `${ADDON}/edit_describe/edit`;
const READ = `${ADDON}/edit_describe`;

// The extension's folder on disk: ext/manifest-firefox.json, ext/_locales
// and ext/store-assets/store-descriptions/<locale>/firefox.txt.
// - es_MX has its own text, so es_419's text goes only to es-ar and es-cl;
// - fr's summary has a URL (skipped); es_MX, no and xx have no _locales entry;
// - "no" contains "forbidden", which the mock AMO refuses while refuseForbidden is on;
// - xx is no language AMO offers.
const FOLDERS = ['de', 'en', 'es', 'es_419', 'es_MX', 'fr', 'he', 'no', 'pt_BR', 'xx', 'zh_CN'];
const DESCRIPTION = (l) => `${l} description line one.\n\n${l} second paragraph${l === 'no' ? ' with a forbidden word' : ''}.`;
const SUMMARY = (l) => (l === 'fr' ? 'fr summary, see https://example.com' : `${l} summary`);
const MESSAGES = ['de', 'en', 'es', 'es_419', 'fr', 'he', 'pt_BR', 'zh_CN'];
const FILES = {
  'ext/manifest-firefox.json': JSON.stringify({ manifest_version: 3, name: 'Test Add-on', default_locale: 'en', description: '__MSG_extensionDescription__' }),
  'ext/manifest.json': JSON.stringify({ manifest_version: 3, name: 'Test Add-on', default_locale: 'en', description: '__MSG_extensionDescription__' }),
  ...Object.fromEntries(MESSAGES.map((l) => [`ext/_locales/${l}/messages.json`,
    JSON.stringify({ extensionDescription: { message: SUMMARY(l) }, other: { message: 'x' } })])),
  ...Object.fromEntries(FOLDERS.map((l) => [`ext/store-assets/store-descriptions/${l}/firefox.txt`, `﻿${DESCRIPTION(l)}\r\n`])),
  'ext/store-assets/store-descriptions/de/edge.txt': 'not this one',
};
function makeLocalFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localization-helper-amo-'));
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return path.join(root, 'ext');
}

// ---------------------------------------------------------------------------
// Mock AMO: the server keeps the add-on's translations; pages are rendered like AMO's
// devhub/addons/edit/describe.html, with the read-only section and the edit form.

const OFFERED = ['en-us', 'de', 'es-ar', 'es-cl', 'es-es', 'es-mx', 'fr', 'he', 'nb-no', 'pt-br', 'zh-cn'];
const SERVER = {
  name: { 'en-us': 'Test Add-on' },
  summary: { 'en-us': 'Old English summary' },
  description: { 'en-us': 'Old English description', de: 'Alte Beschreibung' },
};
let refuseForbidden = true;
let dropHebrewOnce = true;
const posts = [];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function readOnlySection() {
  const row = (field) => `<tr><th><label data-for="${field}">${field}</label></th><td><div class="trans" data-name="${field}">`
    + Object.entries(SERVER[field]).map(([l, v]) => `<span lang="${l}">${esc(v)}</span>`).join('') + '</div></td></tr>';
  return `<form method="post" action="${EDIT}" id="addon-edit-describe" data-baseurl="${ADDON}/edit"><h3>Describe Add-on
    <a href="#" data-editurl="${EDIT}" class="button">Edit</a></h3><div class="item"><div class="item_wrapper"><table><tbody>
    ${row('name')}${row('summary')}${row('description')}</tbody></table></div></div></form>`;
}

function editForm(values, errors = []) {
  const trans = (field, tag, maxlength) => {
    const own = errors.filter((e) => e.field === field);
    const list = own.length ? `<ul class="errorlist">${own.map((e) => `<li data-lang="${e.locale}">${esc(e.text)}</li>`).join('')}</ul>` : '';
    const one = (name, lang, id, value, cls = '') => (tag === 'input'
      ? `<input type="text" name="${name}" value="${esc(value)}" maxlength="${maxlength}" id="${id}" lang="${lang}"${cls}>`
      : `<textarea name="${name}" cols="40" rows="4" maxlength="${maxlength}" id="${id}" lang="${lang}"${cls}>\n${esc(value)}</textarea>`);
    return `<tr><th><label data-for="${field}">${field}</label></th><td><div id="trans-${field}" class="trans" data-name="${field}">`
      + Object.entries(values[field]).map(([l, v], i) => one(`${field}_${l}`, l, `id_${field}_${i}`, v)).join('')
      + one(`${field}_init`, 'init', `id_${field}`, '', ' class="trans-init hidden"') + `</div>${list}</td></tr>`;
  };
  return `<form method="post" action="${EDIT}" id="addon-edit-describe" data-baseurl="${ADDON}/edit"><h3>Describe Add-on</h3>
    <div class="item"><div class="item_wrapper"><table><tbody>
    ${trans('name', 'input', 50)}
    <tr><th>Add-on URL</th><td id="slug_edit"><input type="text" name="slug" value="test-addon" maxlength="30" id="id_slug"></td></tr>
    ${trans('summary', 'textarea', 250)}${trans('description', 'textarea', 15000)}
    <tr><th>Categories</th><td><input type="checkbox" name="categories" value="93" checked> Tabs</td></tr>
    <tr><th>Email</th><td><div id="trans-support_email" class="trans" data-name="support_email"><input type="text" name="support_email_en-us" value="support@example.com" lang="en-us"></div></td></tr>
    </tbody></table></div>
    <div class="listing-footer"><button type="submit">Save Changes</button> or <a href="${READ}" class="addon-edit-cancel">Cancel</a></div>
    </div></form>`;
}

// AMO's page script, cut down to what matters here. The "Localize for" language is es-mx
// (filled by the run, but with no summary), so l10n.js's refreshL10n() adds a placeholder
// for it to every field of a newly loaded edit form, as on the real page: a copy of the
// field's .trans-init with the default language's text set as the value *attribute*
// (which fills an input but leaves a textarea empty), class "cloned", then
// checkTranslation() keeps "cloned" only when the value equals the default language's.
// devhub.js loads the edit form, posts it with AJAX, and puts AMO's answer in place of
// the section.
const PAGE_SCRIPT = `
const section = document.getElementById('edit-addon-describe');
const CURRENT = 'es-mx';
function refreshL10n() {
  for (const trans of section.querySelectorAll('form .trans')) {
    if (!trans.querySelector('.trans-init')) continue;
    if (!trans.querySelector('[lang="' + CURRENT + '"]')) {
      const clone = trans.querySelector('.trans-init').cloneNode(false);
      const dflt = trans.querySelector('[lang="en-us"]').value;
      clone.className = 'cloned';
      clone.setAttribute('lang', CURRENT);
      clone.name = trans.dataset.name + '_' + CURRENT;
      clone.setAttribute('value', dflt);
      if (!(clone.value === dflt && clone.value.trim())) clone.classList.remove('cloned');
      trans.append(clone);
    }
    for (const el of trans.children) el.style.display = el.getAttribute('lang') === CURRENT ? '' : 'none';
  }
}
async function load(url) {
  section.querySelector('.item')?.classList.add('loading');
  section.innerHTML = await (await fetch(url)).text();
  addonFormSubmit();
}
function addonFormSubmit() {
  const form = section.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // jQuery's serialize() sends textarea line ends as CRLF.
    const body = new URLSearchParams([...new FormData(form)].map(([k, v]) => [k, String(v).replace(/\\r?\\n/g, '\\r\\n')]));
    const html = await (await fetch(form.getAttribute('action'), { method: 'POST', body })).text();
    section.innerHTML = html;
    addonFormSubmit();
    if (!section.querySelector('.errorlist')) section.querySelector('h3').insertAdjacentHTML('beforeend', '<b class="save-badge">Changes Saved</b>');
  });
  refreshL10n();
}
document.getElementById('edit-addon').addEventListener('click', (e) => {
  const a = e.target.closest('h3 a');
  if (!a) return;
  e.preventDefault();
  load(a.dataset.editurl);
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('.addon-edit-cancel');
  if (!a) return;
  e.preventDefault();
  load(a.getAttribute('href'));
});`;

function editPage() {
  const offered = OFFERED.slice(1).map((l) => `<li><a href="#${l}">${l} <em>· ${l}</em></a></li>`).join('');
  return `<!doctype html><html><head><style>.hidden{display:none}</style></head>
    <body data-default-locale="en-us" class="html-ltr developer-hub">
    <header><div class="transbox-new" data-rm-locale="${ADDON}/rmlocale" data-default="en-us" id="l10n-menu">
      <p>Localize for: <a id="change-locale" href="#">Español (de México)</a></p>
      <div id="locale-popup" class="popup hidden"><section><b>Default Locale</b><div><a class="default-locale" href="#en-us">English (US) <em>· en-us</em></a></div>
      <b>Existing Locales</b><ul id="existing_locales"></ul><b>New Locales</b><ul id="all_locales">${offered}</ul></section></div>
    </div><h2>Test Add-on</h2></header>
    <section class="primary" role="main"><div id="edit-addon" class="devhub-form">
      <div class="edit-addon-section" id="edit-addon-describe">${readOnlySection()}</div>
    </div></section><script>${PAGE_SCRIPT}</script></body></html>`;
}

async function amo(route) {
  const request = route.request();
  const url = new globalThis.URL(request.url());
  const html = (body) => route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  await new Promise((r) => setTimeout(r, 300));
  if (url.pathname === `${ADDON}/edit`) return html(editPage());
  if (url.pathname === READ) return html(readOnlySection());
  if (url.pathname !== EDIT) return route.fulfill({ status: 404, body: 'not found' });
  if (request.method() === 'GET') return html(editForm(SERVER));

  // Save: like AMO's TransField, values are trimmed, the posted languages replace the
  // stored ones, and languages not posted are kept.
  const form = new URLSearchParams(request.postData());
  posts.push([...form.keys()]);
  const posted = { name: { ...SERVER.name }, summary: { ...SERVER.summary }, description: { ...SERVER.description } };
  for (const [key, value] of form) {
    const m = /^(name|summary|description)_(.+)$/.exec(key);
    if (m && m[2] !== 'init') posted[m[1]][m[2]] = value.trim();
  }
  const errors = [];
  for (const [locale, text] of Object.entries(posted.description)) {
    if (refuseForbidden && /forbidden/.test(text)) errors.push({ field: 'description', locale, text: 'Ensure this value contains no forbidden words.' });
  }
  for (const [locale, text] of Object.entries(posted.summary)) {
    if ([...text].length > 250) errors.push({ field: 'summary', locale, text: 'Ensure this value has at most 250 characters.' });
  }
  if (errors.length) return html(editForm(posted, errors));
  if (dropHebrewOnce && posted.description.he) {
    dropHebrewOnce = false;
    delete posted.description.he; // a save that silently loses one language
  }
  Object.assign(SERVER, posted);
  return html(readOnlySection());
}

(async () => {
  const useFirefox = process.argv.includes('--firefox');
  const browser = useFirefox ? await playwright.firefox.launch() : await playwright.chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext();
  await context.route('https://addons.mozilla.org/**', amo);
  const page = await context.newPage();
  const errors = [];
  const otherHosts = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('https://addons.mozilla.org/')) otherHosts.push(r.url()); });
  page.on('dialog', (d) => d.accept());
  const paste = () => page.evaluate(SCRIPT);
  await page.goto(PAGE_URL);
  await paste();

  const panel = page.locator('#localization-helper-firefox');
  const shadowText = (sel) => `document.querySelector('#localization-helper-firefox')?.shadowRoot?.querySelector('${sel}')?.textContent ?? ''`;
  const waitForText = (sel, re, timeout = 30000) => page.waitForFunction(([js, src]) => new RegExp(src).test(eval(js)),
    [shadowText(sel), re.source], { timeout });
  const dataText = () => panel.locator('.data').textContent();
  const message = () => panel.locator('.message').textContent();
  const storedRun = () => page.evaluate(() => JSON.parse(localStorage.getItem('localizationHelper.firefox.run')));

  // 0. Nothing loaded: Start disabled, the warning that AMO has no draft is shown.
  assert.equal(await panel.isVisible(), true);
  assert.equal(await panel.locator('input.file').inputValue(), 'firefox.txt');
  assert.match(await dataText(), /No Firefox descriptions loaded/);
  assert.equal(await panel.locator('button.start').isDisabled(), true);
  assert.match(await panel.locator('.fills').textContent(), /AMO has no draft/);
  console.log('panel on AMO ok');

  // 1. The descriptions folder alone gives no summaries; the extension folder above it
  // gives both.
  const localRoot = makeLocalFolder();
  await panel.locator('input.folder').setInputFiles(path.join(localRoot, 'store-assets', 'store-descriptions'));
  await waitForText('.data', /Loaded 11 Firefox descriptions/);
  assert.match(await dataText(), /Loaded 11 Firefox descriptions \(firefox\.txt\) from local folder "store-descriptions" at .*\nNo summaries: no manifest\.json found in the folders above the descriptions folder\. Choose the extension folder to fill them too\./);
  assert.match(await panel.locator('.fills').textContent(), /^Will fill: description, not summary\./);
  await panel.locator('input.folder').setInputFiles(localRoot);
  await waitForText('.data', /from local folder "ext\/store-assets\/store-descriptions"/);
  const status = await dataText();
  assert.match(status, /Summaries for 7 languages from ext\/manifest-firefox\.json\. No summary for es_MX: no _locales\/es_MX\/messages\.json; fr: summary contains a URL/);
  assert.match(status, /no: no _locales\/no\/messages\.json; xx: no _locales\/xx\/messages\.json\./);
  assert.match(await panel.locator('.fills').textContent(), /^Will fill: description, summary \(7 languages\)\. Save Changes updates the public listing at once \(AMO has no draft\)\. AMO may send the add-on to content review/);
  assert.equal(await panel.locator('.progress').textContent(), 'Done 0/11');
  assert.equal(await panel.locator('button.start').isDisabled(), false);
  console.log('local folder with summaries ok');

  // After a reload, pasting again brings back the loaded descriptions and summaries.
  await page.reload();
  await paste();
  await waitForText('.data', /Summaries for 7 languages/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('localizationHelper.firefox.descriptions')));
  assert.equal(stored.locales.es_419.summary, 'es_419 summary');
  assert.equal(stored.locales.es_419.description, DESCRIPTION('es_419'));
  assert.equal(stored.locales.fr.summary, undefined, 'summary with a URL skipped');
  console.log('reload keeps data ok');

  // 2. "Next language only" does de: replaces the old German description, adds its summary.
  await panel.locator('button.one').click();
  await waitForText('.message', /^de /, 60000);
  assert.equal(await message(), 'de (de): saved description and summary, checked.');
  assert.equal(SERVER.description.de.replace(/\r\n/g, '\n'), DESCRIPTION('de'));
  assert.equal(SERVER.summary.de, 'de summary');
  assert.equal(SERVER.description.fr, undefined, 'only de saved');
  assert.equal(posts.length, 1);
  console.log('next-language-only ok');

  // 3. All languages: AMO refuses "no" (nothing is saved, then the rest is saved without
  // it), the first save loses Hebrew (caught by reading back, saved again), and xx has
  // no AMO language.
  await panel.locator('button.incomplete').click();
  await waitForText('.message', /^Finished/, 120000);
  assert.equal(await message(), 'Finished: 9 done, 2 failed.');
  const failedText = await panel.locator('.failed').textContent();
  assert.match(failedText, /no: AMO refused it: Ensure this value contains no forbidden words\./);
  assert.match(failedText, /xx: AMO offers no matching language for this add-on/);
  const crlf = (s) => s?.replace(/\r\n/g, '\n');
  const expectDescription = { 'en-us': 'en', 'es-es': 'es', 'es-mx': 'es_MX', 'es-ar': 'es_419', 'es-cl': 'es_419',
    fr: 'fr', he: 'he', 'pt-br': 'pt_BR', 'zh-cn': 'zh_CN', de: 'de' };
  for (const [amoLocale, folder] of Object.entries(expectDescription)) {
    assert.equal(crlf(SERVER.description[amoLocale]), DESCRIPTION(folder), `${amoLocale} description`);
  }
  assert.deepEqual(SERVER.summary, { 'en-us': 'en summary', de: 'de summary', 'es-es': 'es summary',
    'es-ar': 'es_419 summary', 'es-cl': 'es_419 summary', he: 'he summary', 'pt-br': 'pt_BR summary', 'zh-cn': 'zh_CN summary' },
  'es-mx and fr keep falling back to English');
  assert.deepEqual(SERVER.name, { 'en-us': 'Test Add-on' }, "the page's es-mx placeholders were not saved");
  assert.equal(SERVER.description['nb-no'], undefined);
  assert.equal(posts.length, 4, 'de, then: refused save, save that lost Hebrew, Hebrew again');
  assert.ok(posts[1].includes('description_nb-no'), 'first save of the run had nb-no');
  assert.ok(posts[2].includes('description_es-ar') && !posts[2].includes('description_nb-no'), 'saved again without nb-no');
  assert.ok(posts.every((keys) => !keys.includes('name_es-mx') && !keys.includes('summary_es-mx')), 'placeholders never posted');
  assert.ok(posts[0].every((k) => !k.startsWith('description_es-mx')), 'empty es-mx description placeholder not posted with de');
  assert.equal(await page.locator('#edit-addon-describe h3 a[data-editurl]').count(), 1, 'section back to read-only');
  assert.deepEqual((await storedRun()).done.es_419.amo, ['es-ar', 'es-cl']);
  console.log('full run ok');

  // 4. Incomplete languages once AMO accepts "no": only no (and xx again) are tried.
  refuseForbidden = false;
  assert.equal(await panel.locator('button.incomplete').textContent(), 'Start: all incomplete languages (2)');
  await panel.locator('button.incomplete').click();
  await waitForText('.message', /^Finished/, 60000);
  assert.equal(await message(), 'Finished: 10 done, 1 failed.');
  assert.equal(crlf(SERVER.description['nb-no']), DESCRIPTION('no'));
  assert.equal(posts.length, 5);
  assert.equal(SERVER.description.de.includes('Alte'), false);
  console.log('incomplete-languages run ok');

  // 5. Everything up to date: a full run saves nothing and closes the form again.
  await panel.locator('button.start').click();
  await waitForText('.message', /^Finished/, 60000);
  assert.equal(await message(), 'Finished: 10 done, 1 failed.');
  assert.equal(posts.length, 5, 'nothing saved');
  assert.equal(await page.locator('#edit-addon-describe h3 a[data-editurl]').count(), 1, 'form closed with Cancel');
  console.log('up-to-date run ok');

  assert.deepEqual(otherHosts, [], 'only AMO was contacted');
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(`ALL PASSED (${useFirefox ? 'Firefox' : 'Chromium'})`);
})().catch((e) => { console.error(e); process.exit(1); });
