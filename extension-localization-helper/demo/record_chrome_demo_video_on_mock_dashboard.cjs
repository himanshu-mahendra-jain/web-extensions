// Records the demo video of chrome.js: a 1920x1080 WebM of the script filling every language
// of a Store listing page and saving the draft. The page is a mock that works like the one in
// tests/autofill_on_mock_chrome_webstore_dashboard.test.cjs and is laid out like the
// dashboard's own page, with captions, a pointer and title cards drawn in the page itself in
// the purple of the extensions' store images. The descriptions are this repository's Change
// Video Playback Speed listings, served as if from GitHub.
//
// Frames come from Chromium's screencast, so the run is filmed as it happens. The fill and
// check phases are sped up afterwards by dropping frames, and Playwright's own ffmpeg
// encodes the result as VP9.
// Run: NODE_PATH=$(npm root -g) node demo/record_chrome_demo_video_on_mock_dashboard.cjs [out.webm]
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');

const HELPER = path.resolve(__dirname, '..');
const REPO = path.resolve(HELPER, '..');
const SCRIPT = fs.readFileSync(path.join(HELPER, 'chrome.js'), 'utf8');
const OUT = path.resolve(process.argv[2] || path.join(HELPER, 'dist', 'chrome-js-demo.webm'));

const EXTENSION = 'change-video-playback-speed';
const EXTENSION_NAME = 'Change Video Playback Speed';
const DESCRIPTIONS_DIR = path.join(REPO, EXTENSION, 'store-assets', 'store-descriptions');
const REPO_PATH = 'himanshu-mahendra-jain/web-extensions';
const FOLDER_PATH = `${EXTENSION}/store-assets/store-descriptions`;
const SOURCE = `https://github.com/${REPO_PATH}/tree/main/${FOLDER_PATH}`;
const PAGE_URL = 'https://dashboard.webstore.test/webstore/devconsole/item/edit';
const SAVE_URL = 'https://dashboard.webstore.test/webstore/devconsole/save';

// The screencast films CSS pixels whatever the device scale, so the page is laid out for
// 1440x810 and zoomed to fill a 1920x1080 viewport.
const VIEWPORT = { width: 1920, height: 1080 };
const ZOOM = VIEWPORT.width / 1440;
const FPS = 30;
const FAST = 8; // speed of the fill and check phases
const ITEM_ID = 'bennolgojnfnlnckehpkjljdlebchjmb';
const PUBLISHER = 'Himanshu Mahendra Jain';

// The dashboard's Language menu: [option value, option text], the default language first,
// then the rest by name. Hebrew's value is the old "iw".
const LANGUAGES = [['en', 'English – en (default)']].concat([
  ['am', 'Amharic'], ['ar', 'Arabic'], ['bn', 'Bangla'], ['bg', 'Bulgarian'], ['ca', 'Catalan'],
  ['zh-CN', 'Chinese (China)'], ['zh-TW', 'Chinese (Taiwan)'], ['hr', 'Croatian'], ['cs', 'Czech'],
  ['da', 'Danish'], ['nl', 'Dutch'], ['et', 'Estonian'], ['fil', 'Filipino'],
  ['fi', 'Finnish'], ['fr', 'French'], ['de', 'German'], ['el', 'Greek'], ['gu', 'Gujarati'],
  ['iw', 'Hebrew', 'he'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'],
  ['ja', 'Japanese'], ['kn', 'Kannada'], ['ko', 'Korean'], ['lv', 'Latvian'], ['lt', 'Lithuanian'],
  ['ms', 'Malay'], ['ml', 'Malayalam'], ['mr', 'Marathi'], ['no', 'Norwegian'], ['fa', 'Persian'],
  ['pl', 'Polish'], ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'],
  ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'], ['sk', 'Slovak'], ['sl', 'Slovenian'],
  ['es', 'Spanish'], ['es-419', 'Spanish (Latin America)'], ['sw', 'Swahili'], ['sv', 'Swedish'],
  ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'], ['uk', 'Ukrainian'],
  ['vi', 'Vietnamese'],
].map(([value, name, code = value]) => [value, `${name} – ${code}`]));

// The descriptions folder as GitHub would serve it: every language folder, with or without
// a chrome.txt (the AMO-only languages have just a firefox.txt).
const FOLDERS = fs.readdirSync(DESCRIPTIONS_DIR).filter((f) => fs.statSync(path.join(DESCRIPTIONS_DIR, f)).isDirectory()).sort();
const descriptionOf = (folder) => {
  const file = path.join(DESCRIPTIONS_DIR, folder, 'chrome.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};
const ENGLISH = descriptionOf('en').trim();
// Before the run the draft has an older, shorter English description and nothing else.
const SAVED = { en: ENGLISH.split('\n\n').slice(0, 2).join('\n\n') };
// "Summary from package": each language's manifest description, from the extension's _locales.
const SUMMARIES = Object.fromEntries(LANGUAGES.map(([value]) => {
  const folder = value === 'iw' ? 'he' : value.replace('-', '_');
  const messages = JSON.parse(fs.readFileSync(path.join(REPO, EXTENSION, '_locales', folder, 'messages.json'), 'utf8'));
  return [value, messages.extensionDescription.message];
}));
const FONTS = ['Roboto:wght@400;500', 'Inter:wght@400;500;600;800', 'Noto+Sans+Arabic', 'Noto+Sans+Hebrew', 'Noto+Sans+Devanagari',
  'Noto+Sans+Bengali', 'Noto+Sans+Gujarati', 'Noto+Sans+Tamil', 'Noto+Sans+Telugu', 'Noto+Sans+Kannada',
  'Noto+Sans+Malayalam', 'Noto+Sans+Ethiopic', 'Noto+Sans+Thai', 'Noto+Sans+JP', 'Noto+Sans+KR', 'Noto+Sans+SC',
  'Noto+Sans+TC', 'Noto+Sans+Mono', 'Noto+Sans:wght@400;500;700'].map((f) => `family=${f}`).join('&');
const TEXT_FONT = "Roboto, 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Hebrew', 'Noto Sans Devanagari', 'Noto Sans Bengali', "
  + "'Noto Sans Gujarati', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Kannada', 'Noto Sans Malayalam', "
  + "'Noto Sans Ethiopic', 'Noto Sans Thai', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC', 'Noto Sans TC', sans-serif";
// A few of the languages, by their own names, for the title and end cards.
const CARD_ROWS = [['de', 'Deutsch'], ['ja', '日本語'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['pt_BR', 'Português (Brasil)']];
const ICON_PATHS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  caret: 'M7 10l5 5 5-5z',
  apps: 'M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24"><path d="${ICON_PATHS[name]}"/></svg>`;

async function mockGithub(context) {
  await context.route('https://api.github.com/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== `/repos/${REPO_PATH}/contents/${FOLDER_PATH}` || u.searchParams.get('ref') !== 'main') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FOLDERS.map((name) => ({ name, type: 'dir' }))) });
  });
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const prefix = `/${REPO_PATH}/main/${FOLDER_PATH}/`;
    const rel = decodeURIComponent(new URL(route.request().url()).pathname);
    const [folder, file] = rel.startsWith(prefix) ? rel.slice(prefix.length).split('/') : [];
    const text = file === 'chrome.txt' && FOLDERS.includes(folder) ? descriptionOf(folder) : null;
    return text === null ? route.fulfill({ status: 404, body: '404: Not Found' }) : route.fulfill({ body: text });
  });
}

// ---------------------------------------------------------------------------
// Mock Store listing page, laid out like the dashboard's own but without Google's logo and
// wordmark. chrome.js relies on: a combobox whose text starts with "Language" with its
// options next to it, a textarea labelled "Description", a "Save draft" button and the
// page's status messages. Everything else is set dressing and video overlays, which have no
// role or aria-live, so the script does not mistake them for page messages.

const NAV = [['Build', ['Status', 'Package', 'Store listing', 'Privacy', 'Distribution']], ['Access', ['Test instructions']],
  ['Analytics', ['Installs and uninstalls', 'Impressions', 'Users', 'Ratings', 'User support']]];

const PAGE = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Store listing</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FONTS}&display=block">
<style>
  * { box-sizing: border-box; }
  html { zoom: ${ZOOM}; }
  body { margin: 0; height: calc(100vh / ${ZOOM}); overflow: hidden; background: #fff; color: #202124; font: 14px/1.4 Roboto, sans-serif; }
  .icon { width: 24px; height: 24px; fill: #5f6368; flex: none; }
  /* Video overlays, in the purple of the extensions' store images. */
  .caption { height: 44px; background: linear-gradient(90deg, #1a0b3d, #2e1065 50%, #1a0b3d); color: #fff;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    font: 500 19px Inter, 'Noto Sans', sans-serif; letter-spacing: .1px; }
  .caption .speed { font-size: 13px; font-weight: 800; color: #fff; border-radius: 7px; padding: 2px 9px;
    background: linear-gradient(180deg, #8b5cf6, #6d28d9); box-shadow: 0 0 0 1px #c4b5fd inset, 0 0 12px rgba(139,92,246,.6); }
  .caption .speed:empty { display: none; }
  .topbar { height: 64px; background: #f8f9fa; display: flex; align-items: center; padding: 0 22px 0 24px; gap: 26px; }
  .topbar .product { font-size: 22px; color: #5f6368; flex: 1; margin-left: 6px; }
  .topbar .publisher { display: flex; align-items: center; gap: 6px; font-size: 16px; color: #5f6368; }
  .topbar .publisher b { font-weight: 500; color: #202124; margin-left: 10px; }
  .topbar .avatar { width: 39px; height: 39px; border-radius: 50%; background: #1e8e3e; color: #fff; display: grid; place-items: center;
    font-size: 18px; font-weight: 500; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #4285f4; }
  .itembar { position: relative; z-index: 2; height: 70px; display: flex; align-items: center; padding: 0 26px; gap: 10px; background: #fff;
    box-shadow: 0 1px 2px rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15); }
  .itembar .name { flex: 1; }
  .itembar .name div:first-child { font-size: 24px; color: #1a73e8; line-height: 1.2; }
  .itembar .name div:last-child { font-size: 15px; color: #5f6368; margin-top: 3px; }
  .itembar .name span + span { margin-left: 20px; }
  .itembar button { font: 500 15.5px Roboto, sans-serif; height: 36px; padding: 0 24px; border: 0; border-radius: 4px; background: #1a73e8;
    color: #fff; cursor: pointer; letter-spacing: .2px; }
  .itembar button.pressed { background: #1765cc; box-shadow: 0 1px 3px rgba(60,64,67,.4); }
  .itembar .icon { margin-left: 32px; }
  /* The Description box runs past the bottom of the screen, as on the dashboard. Clipping it
     here, rather than scrolling, keeps chrome.js's focus() from scrolling the page. */
  .shell { display: flex; height: calc(100vh / ${ZOOM} - 178px); overflow: clip; }
  nav { width: 235px; flex: none; border-right: 1px solid #dadce0; padding-top: 8px; font-size: 15px; line-height: 41px; white-space: nowrap; }
  nav .group { padding-left: 26px; color: #202124; font-weight: 500; }
  nav a { display: block; padding-left: 51px; color: #3c4043; font-weight: 500; }
  nav a.active { color: #1a73e8; }
  main { flex: 1; position: relative; }
  main h1 { font-size: 23px; font-weight: 400; margin: 0; padding: 22px 21px 0; height: 98px; }
  .section { display: flex; padding: 0 21px; }
  .section .side { width: 221px; flex: none; font-size: 16.5px; font-weight: 500; line-height: 1.5; }
  .section .side small { display: block; font-size: 15px; font-weight: 400; color: #5f6368; margin-top: 8px; }
  .section.language { height: 111px; padding-top: 12px; border-bottom: 1px solid #dadce0; }
  .section.details { padding-top: 38px; }
  .section.details .side { margin-top: 12px; }
  .outlined { position: relative; border: 1px solid #9aa0a6; border-radius: 4px; }
  .outlined > .label { position: absolute; left: 11px; top: -9px; padding: 0 5px; background: #fff; font-size: 12.5px; color: #5f6368; line-height: 16px; }
  /* As on the dashboard, the asterisk is not part of the label's text, which chrome.js reads. */
  .outlined > .label.required::after { content: '*'; }
  .language-field { position: relative; width: 343px; }
  [role=combobox] { height: 57px; display: flex; align-items: center; padding: 0 16px; font-size: 17px; cursor: pointer; }
  [role=combobox] .current { flex: 1; }
  [role=combobox] .icon { fill: #5f6368; width: 24px; }
  [role=combobox][aria-expanded=true] { border: 2px solid #1a73e8; padding: 0 15px; }
  [role=combobox][aria-expanded=true] .label { color: #1a73e8; top: -10px; left: 10px; }
  [role=combobox][aria-expanded=true] .icon { transform: rotate(180deg); fill: #1a73e8; }
  [role=listbox] { position: absolute; top: 62px; left: 0; z-index: 5; width: 343px; max-height: 382px; overflow: auto; margin: 0; padding: 0;
    list-style: none; background: #fff; border-radius: 4px; box-shadow: 0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px rgba(0,0,0,.14), 0 1px 10px rgba(0,0,0,.12); }
  [role=option] { height: 49px; line-height: 49px; padding: 0 16px; font-size: 17px; }
  [role=option][aria-selected=true] { background: #d2e3fc; }
  .fields { width: 607px; }
  .fields .small-label { font-size: 12.5px; color: #5f6368; }
  .fields .value { font-size: 17px; margin: 9px 0 26px; line-height: 25px; max-width: 325px; }
  .fields .value.title { max-width: none; margin-bottom: 30px; }
  .description { margin-top: 18px; padding: 15px 16px 0; height: 700px; }
  textarea { display: block; width: 100%; height: 100%; resize: none; border: 0; outline: 0; padding: 0; font: 16.5px/24.5px ${TEXT_FONT}; color: #202124; overflow: hidden; }
  .hint { position: absolute; left: calc(100% + 46px); top: -1px; width: 296px; border-left: 2px solid #1a73e8; padding: 3px 0 3px 17px; font-size: 13.5px; color: #5f6368; }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #323232; color: #fff; border-radius: 4px; padding: 14px 24px;
    font-size: 14px; box-shadow: 0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px rgba(0,0,0,.14); }
  .toast:empty { display: none; }
  .preload { position: absolute; left: -10000px; top: 0; width: 600px; font-family: ${TEXT_FONT}; }
  /* The zoom scales vh too; this keeps the panel's 70vh cap at 70% of the screen. */
  #localization-helper-cws { max-height: calc(70vh / ${ZOOM}) !important; }
  .card-overlay { position: fixed; inset: 0; z-index: 2147483647; color: #fff; display: flex; align-items: center; padding-left: 120px;
    font-family: Inter, sans-serif; transition: opacity .5s;
    background: radial-gradient(900px 420px at 28% -8%, rgba(109,40,217,.55), transparent 70%),
      radial-gradient(700px 380px at 100% 108%, rgba(91,33,182,.45), transparent 70%), #12062b; }
  .card-overlay[hidden] { display: none; }
  .card-overlay.fade { opacity: 0; }
  .card-overlay .tile { width: 72px; height: 72px; border-radius: 16px; background: #6d28d9; display: grid; place-items: center; }
  .card-overlay .tile svg { width: 46px; height: 46px; fill: #fff; }
  .card-overlay .head { display: flex; align-items: center; gap: 22px; }
  .card-overlay .eyebrow { font-size: 17px; font-weight: 600; letter-spacing: 3px; color: #c4b5fd; }
  .card-overlay .title { font-size: 64px; font-weight: 800; letter-spacing: -2px; line-height: 1.08; margin-top: 30px; }
  .card-overlay .title span { display: block; color: #c4b5fd; }
  .card-overlay .chips { display: flex; gap: 14px; margin-top: 30px; }
  .card-overlay .chips:empty { display: none; }
  .card-overlay .chips span { font-size: 20px; font-weight: 600; padding: 10px 18px; border-radius: 10px;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); }
  .card-overlay .chips span.on { background: linear-gradient(180deg, #8b5cf6, #6d28d9); border-color: #c4b5fd; }
  .card-overlay .sub { font-size: 21px; color: #ddd6fe; margin-top: 26px; }
  .card-overlay .small { font-size: 15px; color: #a78bfa; margin-top: 14px; }
  .card-overlay .list { position: absolute; right: 150px; top: 50%; transform: translateY(-50%); width: 430px; padding: 22px 24px 10px;
    background: #fff; color: #1e1b2e; border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,.45); font-family: Inter, ${TEXT_FONT}; }
  .card-overlay .list:empty { display: none; }
  .card-overlay .list .heading { font-size: 13px; font-weight: 700; letter-spacing: 1.5px; color: #6d28d9; padding-bottom: 12px; border-bottom: 1px solid #ece9f3; }
  .card-overlay .list .row { display: flex; align-items: center; gap: 14px; height: 58px; border-bottom: 1px solid #ece9f3; font-size: 17px; font-weight: 600; }
  .card-overlay .list .row:last-child { border-bottom: 0; }
  .card-overlay .list .code { min-width: 40px; padding: 0 8px; height: 32px; border-radius: 7px; background: #27223a; color: #fff; display: grid; place-items: center;
    font-size: 12.5px; font-weight: 700; }
  .card-overlay .list .name { flex: 1; }
  .card-overlay .list .badge { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: #ede9fe; color: #5b21b6; }
  .card-overlay .list .badge.saved { background: #dcfce7; color: #15803d; }
  .devtools { position: fixed; left: 0; right: 0; bottom: 0; height: 270px; z-index: 2147483646; background: #202124; color: #e8eaed;
    font: 13px/1.5 'Noto Sans Mono', monospace; transform: translateY(100%); transition: transform .35s ease; }
  .devtools.open { transform: none; }
  .devtools .tabs { display: flex; gap: 22px; padding: 6px 14px; border-bottom: 1px solid #3c4043; font: 13px Roboto, sans-serif; color: #9aa0a6; }
  .devtools .tabs .on { color: #8ab4f8; border-bottom: 2px solid #8ab4f8; padding-bottom: 4px; }
  .devtools pre { margin: 10px 14px; white-space: pre-wrap; color: #e8eaed; }
  .devtools pre::before { content: '> '; color: #8ab4f8; }
  .pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 26px; height: 26px; pointer-events: none;
    opacity: 0; transition: transform .6s cubic-bezier(.3,.7,.3,1); filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
  .pointer.on { opacity: 1; }
  .ripple { position: fixed; z-index: 2147483647; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
    background: rgba(124,58,237,.4); pointer-events: none; animation: ripple .45s ease-out forwards; }
  @keyframes ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
</style></head><body>
<div class="caption"><span class="text"></span><span class="speed"></span></div>
<div class="topbar">${icon('menu')}<span class="product">Developer Dashboard</span>
  <span class="publisher">Publisher: <b>${PUBLISHER}</b>${icon('caret')}</span>${icon('apps')}<span class="avatar">${PUBLISHER[0]}</span></div>
<div class="itembar">
  <div class="name"><div>${EXTENSION_NAME}</div><div><span>Status: Published - public</span><span>ID: ${ITEM_ID}</span></div></div>
  <button type="button">Save draft</button><button type="button">Submit for review</button>${icon('more')}
</div>
<div class="shell">
  <nav>${NAV.map(([group, items]) => `<div class="group">${group}</div>${items.map((i) => `<a${i === 'Store listing' ? ' class="active"' : ''}>${i}</a>`).join('')}`).join('')}</nav>
  <main>
    <h1>Store listing</h1>
    <div class="section language">
      <div class="side">Current editing<br>language</div>
      <div class="language-field">
        <div class="outlined" role="combobox" tabindex="0" aria-expanded="false" aria-controls="language-popup"><span class="label required">Language</span><span class="current"></span>${icon('caret')}</div>
        <span id="language-popup"></span>
        <ul role="listbox" hidden>${LANGUAGES.map(([v, t]) => `<li role="option" data-value="${v}">${t}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="section details">
      <div class="side">Product details<small class="language-name"></small></div>
      <div class="fields">
        <div class="small-label">Title from package</div>
        <div class="value title">${EXTENSION_NAME}</div>
        <div class="small-label">Summary from package</div>
        <div class="value summary"></div>
        <div class="outlined description"><span class="label required" id="description-label">Description</span>
          <textarea aria-labelledby="description-label" maxlength="16000"></textarea>
          <div class="hint">Focus on explaining what the item does and why users should install it</div></div>
      </div>
    </div>
  </main>
</div>
<div role="status" class="toast"></div>
<div class="preload">${FOLDERS.map(descriptionOf).filter(Boolean).concat(Object.values(SUMMARIES)).join(' ').replace(/[<&]/g, ' ')}</div>
<div class="devtools"><div class="tabs"><span>Elements</span><span class="on">Console</span><span>Sources</span><span>Network</span></div><pre></pre></div>
<div class="card-overlay" hidden><div>
  <div class="head"><div class="tile"><svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg></div><div class="eyebrow"></div></div>
  <div class="title"></div><div class="chips"></div><div class="sub"></div><div class="small"></div>
</div><div class="list"></div></div>
<svg class="pointer" viewBox="0 0 24 24"><path d="M4 2l16 11-7 1.5 4 7.5-3 1.5-4-7.5L4 21z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>
<script>
  const saved = ${JSON.stringify(SAVED)};
  const summaries = ${JSON.stringify(SUMMARIES)};
  const edits = {};
  const names = Object.fromEntries([...document.querySelectorAll('[role=option]')].map((o) => [o.dataset.value, o.textContent]));
  const combo = document.querySelector('[role=combobox]');
  const listbox = document.querySelector('[role=listbox]');
  const box = document.querySelector('textarea');
  const toast = document.querySelector('.toast');
  const [saveButton, submitButton] = document.querySelectorAll('.itembar button');
  let current = 'en';
  // A language without text of its own shows the default language's.
  const textOf = (l) => edits[l] ?? saved[l] ?? edits.en ?? saved.en ?? '';
  // The menu's label and the fields change together, so no frame shows one language's name
  // over another's text.
  function show(l) {
    current = l;
    setTimeout(() => {
      if (current !== l) return;
      combo.querySelector('.current').textContent = names[l];
      document.querySelector('.language-name').textContent = names[l].replace(' (default)', '');
      document.querySelector('.summary').textContent = summaries[l];
      box.value = textOf(l);
      box.scrollTop = 0;
    }, 150);
  }
  function openMenu(open) {
    listbox.hidden = !open;
    combo.setAttribute('aria-expanded', open);
    for (const o of listbox.children) o.setAttribute('aria-selected', o.dataset.value === current);
    if (open) listbox.querySelector('[data-value="' + current + '"]').scrollIntoView({ block: 'nearest' });
  }
  combo.addEventListener('click', () => openMenu(listbox.hidden));
  listbox.addEventListener('click', (e) => {
    const option = e.target.closest('[role=option]');
    if (!option || listbox.hidden) return;
    openMenu(false);
    setTimeout(() => show(option.dataset.value), 80);
  });
  box.addEventListener('input', () => { edits[current] = box.value; });
  box.addEventListener('blur', () => { box.scrollTop = 0; });
  saveButton.addEventListener('click', async () => {
    saveButton.classList.add('pressed');
    setTimeout(() => saveButton.classList.remove('pressed'), 400);
    toast.textContent = 'Saving item...';
    const response = await fetch('/webstore/devconsole/save', { method: 'POST', body: JSON.stringify({ ...saved, ...edits }) });
    await new Promise((r) => setTimeout(r, 300));
    if (response.ok) {
      Object.assign(saved, edits);
      for (const l of Object.keys(edits)) delete edits[l];
      toast.textContent = 'Item saved.';
      setTimeout(() => { toast.textContent = ''; }, 6000);
    } else {
      toast.textContent = 'Something went wrong. Please try again.';
    }
  });
  submitButton.addEventListener('click', () => fetch('/webstore/devconsole/submit', { method: 'POST' }));
  show('en');

  // Video overlays, driven by the recorder. Positions come in viewport pixels, as Playwright
  // measures them, and are divided by the page's zoom.
  const zoom = ${ZOOM};
  const pointer = document.querySelector('.pointer');
  const overlay = document.querySelector('.card-overlay');
  const devtools = document.querySelector('.devtools');
  window.demo = {
    caption(text, speed = '') {
      document.querySelector('.caption .text').textContent = text;
      document.querySelector('.caption .speed').textContent = speed;
    },
    // A title card like the store images: label, two-line title (the second line in lavender),
    // chips (a leading "*" highlights one), a line of text, a footnote, and on the right a list
    // card whose rows are [code, name, badge].
    card({ eyebrow, title, accent, chips = [], sub = '', small = '', list = '', rows = [], saved = false }) {
      const set = (selector, ...children) => overlay.querySelector(selector).replaceChildren(...children);
      const span = (text, className = '') => Object.assign(document.createElement('span'), { textContent: text, className });
      set('.eyebrow', eyebrow.toUpperCase());
      set('.title', title, span(accent));
      set('.chips', ...chips.map((c) => (c[0] === '*' ? span(c.slice(1), 'on') : span(c))));
      set('.sub', sub);
      set('.small', small);
      const row = ([code, name, badge]) => {
        const div = document.createElement('div');
        div.className = 'row';
        div.append(span(code, 'code'), span(name, 'name'), span(badge, saved ? 'badge saved' : 'badge'));
        return div;
      };
      set('.list', ...(rows.length ? [Object.assign(document.createElement('div'), { className: 'heading', textContent: list }), ...rows.map(row)] : []));
      overlay.hidden = false;
      overlay.classList.remove('fade');
      pointer.classList.remove('on');
    },
    hideCard() { overlay.classList.add('fade'); setTimeout(() => { overlay.hidden = true; }, 500); },
    console(open, text = '') { devtools.querySelector('pre').textContent = text; devtools.classList.toggle('open', open); },
    point(x, y) {
      pointer.style.transform = 'translate(' + (x / zoom - 4) + 'px,' + (y / zoom - 2) + 'px)';
      requestAnimationFrame(() => pointer.classList.add('on'));
    },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'ripple';
      r.style.left = x / zoom + 'px';
      r.style.top = y / zoom + 'px';
      document.body.append(r);
      setTimeout(() => r.remove(), 500);
    },
    // Keeps the pointer and cards above the helper's panel, which is added later.
    raise() { document.body.append(devtools, overlay, pointer); },
  };
  pointer.style.transform = 'translate(900px,600px)';
</script></body></html>`;

let submitted = false;
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
      await new Promise((r) => setTimeout(r, 700));
      return route.fulfill({ body: 'ok' });
    }
    if (url.endsWith('/submit')) submitted = true;
    return route.fulfill({ status: 404, body: 'not found' });
  });
}

// ---------------------------------------------------------------------------
// Filming. Each screencast frame is written to disk with its wall-clock time; marks record
// when the playback speed changes. encode() then picks, for every output frame, the latest
// frame filmed at or before the matching moment of the run.

async function film(framesDir) {
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ viewport: VIEWPORT });
  await mockGithub(context);
  await mockDashboard(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(PAGE_URL);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((CARD_ROWS) => demo.card({ eyebrow: 'Every store language, one run', title: 'Extension Localization', accent: 'Helper',
    chips: ['*chrome.js', 'Chrome Web Store'], sub: 'Fills every language of a store listing from one folder of descriptions.',
    small: 'Shown on a mock Store listing page', list: 'STORE-DESCRIPTIONS/', rows: CARD_ROWS.map(([c, n]) => [c, n, 'chrome.txt']) }), CARD_ROWS);
  await page.waitForTimeout(500);

  const frames = [];
  const marks = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ t: metadata.timestamp, file });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  const mark = (speed) => marks.push({ t: Date.now() / 1000, speed });
  const wait = (ms) => page.waitForTimeout(ms);
  mark(1);

  const panel = page.locator('#localization-helper-cws');
  const status = () => panel.locator('[role=status]');
  const caption = (text, speed) => page.evaluate(([t, s]) => demo.caption(t, s), [text, speed]);
  // Moves the drawn pointer to the element, then clicks it.
  async function click(locator) {
    const box = await locator.boundingBox();
    const [x, y] = [box.x + Math.min(box.width / 2, 90), box.y + box.height / 2];
    await page.evaluate(([px, py]) => demo.point(px, py), [x, y]);
    await wait(750);
    await page.evaluate(([px, py]) => demo.ripple(px, py), [x, y]);
    await locator.click();
  }

  try {
    await wait(3200);
    await page.evaluate(() => demo.hideCard());
    await caption('Open the item’s Store listing page and press F12');
    await wait(1800);

    await caption('Paste chrome.js into the Console');
    await page.evaluate(() => demo.console(true, ''));
    await wait(700);
    await page.evaluate((text) => demo.console(true, text), SCRIPT.split('\n').slice(0, 7).join('\n') + '\n  …');
    await wait(1600);
    await page.evaluate(() => demo.console(false));
    await wait(400);
    await page.evaluate(SCRIPT);
    await page.evaluate(() => demo.raise());
    await caption('A panel opens in the corner of the page');
    await wait(1800);

    await caption('Load the descriptions from a GitHub folder or a local folder');
    await click(panel.locator('input[type=url]'));
    await panel.locator('input[type=url]').pressSequentially(SOURCE, { delay: 14 });
    await wait(300);
    await click(panel.locator('button', { hasText: 'Load' }));
    await status().filter({ hasText: 'Press Start' }).waitFor();
    await caption('It lists the languages it will fill and the folders it skips');
    await wait(3600);

    await caption('Start picks each language in the menu and fills its Description', `${FAST}×`);
    await click(panel.locator('button', { hasText: 'Start' }));
    await page.evaluate(([x, y]) => demo.point(x, y), [VIEWPORT.width - 140, VIEWPORT.height - 40]);
    mark(FAST);
    await status().filter({ hasText: /^Checking/ }).waitFor({ timeout: 300000 });
    await caption('Then it checks that every language kept its text', `${FAST}×`);
    await status().filter({ hasText: /^Saving/ }).waitFor({ timeout: 300000 });
    mark(1);
    await caption('One Save draft stores all languages. It never submits for review.');
    await status().filter({ hasText: /^Done/ }).waitFor({ timeout: 60000 });
    await wait(4400);

    await page.evaluate(([n, CARD_ROWS]) => demo.card({ eyebrow: 'Done in one run', title: `${n} languages filled`, accent: 'and saved as a draft',
      chips: ['*chrome.js', 'edge.js', 'firefox.js'], sub: 'Also for Microsoft Edge Add-ons and Firefox Add-ons.',
      small: 'github.com/himanshu-mahendra-jain/web-extensions', list: 'SAVED AS DRAFT', rows: CARD_ROWS.map(([c, n]) => [c, n, '✓ Saved']),
      saved: true }), [LANGUAGES.length, CARD_ROWS]);
    await wait(4500);
    mark(0);
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => {});
    const result = { frames, marks, panelText: await panel.innerText().catch(() => '(no panel)') };
    await browser.close();
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    if (submitted) throw new Error('Submit for review was clicked');
    return result;
  }
}

// Output timeline: each mark starts a stretch played at its speed; the last mark (speed 0)
// ends the video.
function pickFrames(frames, marks) {
  const picks = [];
  let f = 0;
  for (let m = 0; m < marks.length - 1; m++) {
    const { t: start, speed } = marks[m];
    const end = marks[m + 1].t;
    for (let t = start; t < end; t += speed / FPS) {
      while (f + 1 < frames.length && frames[f + 1].t <= t) f++;
      picks.push(frames[f].file);
    }
  }
  return picks;
}

async function encode(picks) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // The ffmpeg that `npx playwright install` puts next to the browsers.
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  const ffmpeg = fs.readdirSync(browsers).filter((d) => d.startsWith('ffmpeg-')).sort().reverse()
    .map((d) => path.join(browsers, d, 'ffmpeg-linux')).find((f) => fs.existsSync(f));
  if (!ffmpeg) throw new Error(`No Playwright ffmpeg in ${browsers}: run npx playwright install ffmpeg`);
  const proc = spawn(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '20', '-b:v', '0', '-deadline', 'good', '-cpu-used', '2',
    '-row-mt', '1', '-threads', String(Math.max(2, os.cpus().length - 2)), OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => proc.on('exit', (code) => (code ? reject(new Error(`ffmpeg exited with ${code}`)) : resolve())));
  for (const file of picks) {
    if (!proc.stdin.write(fs.readFileSync(file))) await new Promise((r) => proc.stdin.once('drain', r));
  }
  proc.stdin.end();
  await done;
}

(async () => {
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-js-demo-frames-'));
  try {
    const { frames, marks, panelText } = await film(framesDir);
    console.log(panelText);
    if (!/Saved \d+ languages as a draft/.test(panelText)) throw new Error('the run did not save the draft');
    const picks = pickFrames(frames, marks);
    console.log(`${frames.length} frames filmed, ${picks.length} in the video (${(picks.length / FPS).toFixed(1)} s)`);
    await encode(picks);
    console.log(`Wrote ${OUT}`);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
