// Chrome Web Store part of Extension Localization Helper. Chrome does not let extensions
// run on its developer dashboard, so this is pasted into DevTools' console (or saved as a
// DevTools Snippet) on the item's Store listing page instead.
//
// It opens a panel in the page's bottom-right corner. Load the descriptions from a GitHub
// folder or a local folder, then Start: it fills every language's Description through the
// page's Language menu, checks that each kept its text, and clicks Save draft once (the
// dashboard keeps all languages in the page and saves them in one request), unless "Fill
// only" is ticked. It never clicks Submit for review. Start again after a reload to check:
// every language should then be "already up to date".
(() => {
  'use strict';

  const DEFAULT_FILE = 'chrome.txt'; // the file in each language folder, unless typed otherwise
  const MAX_CHARS = 16000; // the Description box's maxlength
  const SOURCE_KEY = 'localizationHelper.chromeSource';
  const FILE_KEY = 'localizationHelper.chromeFile';
  const PANEL_ID = 'localization-helper-cws';
  const INSTANCE_KEY = '__localizationHelperCws'; // the latest paste; older ones stop their run
  const UNSAVED_KEY = '__localizationHelperCwsUnsaved';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanDescription = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const encodePath = (parts) => parts.map(encodeURIComponent).join('/');
  const lengthProblem = (text) => {
    const n = [...text].length;
    return n < 1 || n > MAX_CHARS ? `${n} characters (must be 1-${MAX_CHARS})` : '';
  };

  // ---------------------------------------------------------------------------
  // Page structure.

  const languageCombo = () => [...document.querySelectorAll('[role=combobox]')]
    .find((el) => /^Language/.test(el.textContent.trim()));
  const descriptionBox = () => [...document.querySelectorAll('textarea')]
    .find((el) => /description/i.test(document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || ''));
  const saveDraftButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save draft');
  const onListingPage = () => !!(languageCombo() && descriptionBox() && saveDraftButton());
  // Messages the dashboard shows, such as "Saving item..." and "Item saved.".
  const pageMessages = () => [...document.querySelectorAll('[role=alert],[role=status],[aria-live]:not([role=combobox])')]
    .filter((el) => !el.closest(`#${PANEL_ID}`))
    .map((el) => el.textContent.trim()).filter((m) => m && !/guides and tips/.test(m));

  // The Language menu's options: [{ value: 'iw', code: 'he', name: 'Hebrew – he', el }].
  // They sit next to the menu button (its aria-controls names an empty element).
  function languageOptions() {
    return [...languageCombo().parentElement.querySelectorAll('[role=option][data-value]')].map((el) => {
      const name = el.textContent.replace(/\s+/g, ' ').trim();
      const code = /–\s*(\S+)/.exec(name)?.[1] || el.dataset.value;
      return { value: el.dataset.value, code, name, el };
    });
  }

  // Folder name -> option: pt_BR -> pt-BR, he -> Hebrew (value iw), es_419 -> es-419.
  function optionFor(folder, options) {
    const key = folder.replace(/_/g, '-').toLowerCase();
    return options.find((o) => o.code.toLowerCase() === key) || options.find((o) => o.value.toLowerCase() === key);
  }

  // Which dashboard language each loaded folder goes to, and what does not match.
  function planFor(locales) {
    const options = languageOptions();
    const plan = [];
    const unoffered = [];
    for (const folder of Object.keys(locales).sort()) {
      const option = optionFor(folder, options);
      if (option) plan.push({ folder, option, text: locales[folder] });
      else unoffered.push(folder);
    }
    const missing = options.filter((o) => !plan.some((p) => p.option === o)).map((o) => o.code);
    return { options, plan, unoffered, missing };
  }

  // The language the menu shows, as its option names it ("German – de").
  const currentLanguage = () => languageCombo().textContent.replace(/\s+/g, ' ').trim().replace(/^Language\s*/, '');

  async function selectLanguage(option) {
    if (currentLanguage() === option.name) return;
    languageCombo().click();
    await sleep(300);
    option.el.click();
    for (let i = 0; i < 30 && currentLanguage() !== option.name; i++) await sleep(100);
    if (currentLanguage() !== option.name) throw new Error('the Language menu did not switch');
    await sleep(400); // the page swaps the language's fields in after the menu closes
  }

  // Sets the Description the way typing does, so the page's own model takes the text.
  function setDescription(text) {
    const box = descriptionBox();
    box.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    box.blur();
  }

  // Clicks Save draft and waits for "Item saved.". Returns '' when saved, else the reason.
  // The page shows "Saving item..." then "Item saved."; a short save can show both between
  // two polls, so an observer records every message that appears.
  async function saveDraft() {
    const before = new Set(pageMessages());
    const seen = new Set();
    const observer = new MutationObserver(() => pageMessages().forEach((m) => seen.add(m)));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      saveDraftButton().click();
      let other = '';
      let otherSince = 0;
      for (let t = 0; t < 150; t++) {
        await sleep(200);
        const sawSaving = [...seen].some((m) => /^Saving/i.test(m));
        if (seen.has('Item saved.') && (sawSaving || !before.has('Item saved.'))) return '';
        // Any other message that stays up for 2 s is an error.
        const messages = pageMessages().filter((m) => !/^Saving/i.test(m) && !before.has(m));
        const text = messages.join(' / ');
        if (text !== other) [other, otherSince] = [text, t];
        else if (text && t - otherSince >= 10) return text;
      }
      return 'no "Item saved." within 30 seconds';
    } finally {
      observer.disconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Descriptions. Both loaders return { source, locales: { de: 'text' }, skipped: ['xx: why'] }.

  async function githubApi(path) {
    const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
    if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = new Date(Number(response.headers.get('x-ratelimit-reset')) * 1000);
      throw new Error(`GitHub's API limit is used up for now. Try again after ${reset.toLocaleTimeString()}.`);
    }
    return response;
  }

  // From a GitHub folder URL: https://github.com/OWNER/REPO/tree/REF/PATH.
  async function loadFromGithub(url, fileName) {
    const usage = 'Enter a GitHub folder URL, such as https://github.com/owner/repo/tree/main/store-descriptions';
    let u;
    try { u = new URL(url.trim()); } catch { throw new Error(usage); }
    const segments = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (u.hostname !== 'github.com' || segments.length < 4 || segments[2] !== 'tree') throw new Error(usage);
    const [owner, repo] = [segments[0], segments[1].replace(/\.git$/, '')];
    const rest = segments.slice(3);
    // A branch name can contain "/", so try each split of the rest into branch and folder.
    let found = null;
    for (let i = 1; i <= rest.length && !found; i++) {
      const [ref, path] = [rest.slice(0, i), rest.slice(i)];
      const response = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref.join('/'))}`);
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for that folder.`);
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error('That URL is a file, not a folder.');
      found = { ref, path, entries };
    }
    if (!found) throw new Error(`Folder not found in ${owner}/${repo}, or the repository is private.`);
    const folders = found.entries.filter((e) => e.type === 'dir').map((e) => e.name).sort();
    if (!folders.length) throw new Error('That folder has no language sub-folders (such as en, de, pt_BR).');

    const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`
      + `${encodePath(found.ref)}/${found.path.length ? `${encodePath(found.path)}/` : ''}`;
    const locales = {};
    const skipped = [];
    await Promise.all(folders.map(async (folder) => {
      const response = await fetch(`${rawBase}${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
      if (response.status === 404) { skipped.push(`${folder}: no ${fileName}`); return; }
      if (!response.ok) throw new Error(`Downloading ${folder}/${fileName} failed (${response.status}).`);
      const text = cleanDescription(await response.text());
      const problem = lengthProblem(text);
      if (problem) skipped.push(`${folder}: ${problem}`);
      else locales[folder] = text;
    }));
    return { source: url.trim(), fileName, locales, skipped: skipped.sort() };
  }

  // From the files of a folder picked in a file input with webkitdirectory. The pick can be
  // the descriptions folder or a folder above it: webkitRelativePath is
  // "<pick>/…/<descriptions folder>/<locale>/<file>", and the descriptions folder is the
  // one holding the most language folders with the file.
  async function loadFromFiles(files, fileName) {
    const all = files.map((file) => ({ file, parts: file.webkitRelativePath.split('/') }));
    const candidates = all.filter(({ parts }) => parts.length >= 3 && parts.at(-1) === fileName);
    if (!candidates.length) {
      const folder = files[0]?.webkitRelativePath.split('/')[0] || 'that folder';
      throw new Error(`No ${fileName} found in language folders inside "${folder}". `
        + 'Choose the folder that contains the language folders (en, de, pt_BR, …), or a folder above it.');
    }
    const counts = new Map();
    for (const { parts } of candidates) {
      const root = parts.slice(0, -2).join('/');
      counts.set(root, (counts.get(root) || 0) + 1);
    }
    const folder = [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    const depth = folder.split('/').length;
    const inFolder = ({ parts }) => parts.slice(0, depth).join('/') === folder;
    const matches = candidates.filter((c) => inFolder(c) && c.parts.length === depth + 2);
    const locales = {};
    const skipped = [];
    for (const { file, parts } of matches) {
      const text = cleanDescription(await file.text());
      const problem = lengthProblem(text);
      if (problem) skipped.push(`${parts[depth]}: ${problem}`);
      else locales[parts[depth]] = text;
    }
    const folders = new Set(all.filter((f) => inFolder(f) && f.parts.length >= depth + 2).map(({ parts }) => parts[depth]));
    for (const locale of folders) {
      if (!matches.some(({ parts }) => parts[depth] === locale)) skipped.push(`${locale}: no ${fileName}`);
    }
    return { source: `local folder "${folder}"`, fileName, locales, skipped: skipped.sort() };
  }

  // ---------------------------------------------------------------------------
  // Panel. Built with DOM calls: the dashboard refuses innerHTML (Trusted Types).

  function element(tag, props = {}, style = '') {
    const el = Object.assign(document.createElement(tag), props);
    if (style) el.style.cssText = style;
    return el;
  }

  function makePanel() {
    document.getElementById(PANEL_ID)?.remove();
    const panel = element('div', { id: PANEL_ID }, 'position:fixed;right:16px;bottom:16px;z-index:2147483647;'
      + 'width:400px;max-width:calc(100vw - 32px);max-height:70vh;overflow:auto;box-sizing:border-box;'
      + 'background:#fff;color:#202124;border:1px solid #dadce0;border-radius:8px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.2);padding:12px 14px;font:13px/1.45 system-ui,sans-serif');
    const row = (...children) => {
      const div = element('div', {}, 'display:flex;gap:6px;align-items:center;margin-top:8px');
      div.append(...children);
      return div;
    };
    const button = (text) => element('button', { type: 'button', textContent: text }, 'font:inherit;padding:3px 10px;cursor:pointer');

    const ui = {
      title: element('div', { textContent: 'Localization Helper: Chrome Web Store' }, 'font-weight:600;flex:1'),
      close: button('Close'),
      file: element('input', { type: 'text', placeholder: DEFAULT_FILE, spellcheck: false }, 'width:140px;font:inherit;padding:3px 6px'),
      url: element('input', { type: 'url', placeholder: 'https://github.com/owner/repo/tree/main/store-descriptions' },
        'flex:1;min-width:0;font:inherit;padding:3px 6px'),
      load: button('Load'),
      chooseFolder: button('Choose local folder…'),
      folderInput: element('input', { type: 'file', webkitdirectory: true, hidden: true }),
      fillOnly: element('input', { type: 'checkbox' }),
      start: button('Start'),
      stop: button('Stop'),
      status: element('div', { role: 'status' }, 'margin-top:8px;font-weight:500'),
      details: element('div', {}, 'white-space:pre-wrap;margin-top:6px;color:#5f6368'),
    };
    const fileLabel = element('label', {}, 'display:flex;gap:6px;align-items:center;margin-top:8px');
    fileLabel.append(document.createTextNode('File in each language folder:'), ui.file);
    const sourceHint = element('div', { textContent: 'Descriptions folder: one sub-folder per language (en, de, pt_BR, …).' },
      'margin-top:6px;color:#5f6368');
    const fillOnlyLabel = element('label', {}, 'display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer');
    fillOnlyLabel.append(ui.fillOnly, document.createTextNode('Fill only: do not click Save draft'));
    ui.start.disabled = true;
    ui.stop.disabled = true;
    panel.append(row(ui.title, ui.close), fileLabel, sourceHint, row(ui.url, ui.load), row(ui.chooseFolder), ui.folderInput,
      fillOnlyLabel, row(ui.start, ui.stop), ui.status, ui.details);
    document.body.append(panel);
    return { panel, ...ui };
  }

  // ---------------------------------------------------------------------------
  // Wiring.

  if (!onListingPage()) {
    alert('Open your item\'s Store listing page in the Chrome Web Store Developer Dashboard, then run this again.');
    return;
  }
  const instance = {};
  window[INSTANCE_KEY] = instance;
  const ui = makePanel();
  let loaded = null; // the last loaded descriptions
  // Languages filled but not saved yet (after Fill only, Stop, a failed save or an earlier
  // paste's run). They look up to date in the page, so a later run must still save them.
  // Kept on the page, which holds the edits until a reload.
  const unsaved = window[UNSAVED_KEY] ||= new Map(); // folder -> text
  let running = false;
  let stopRequested = false;
  // A newer paste or Close ends this run after the current step, without touching the page
  // again (the newer panel may be using the Language menu).
  const superseded = () => window[INSTANCE_KEY] !== instance || !ui.panel.isConnected;
  const stopped = () => stopRequested || superseded();

  const status = (text) => { ui.status.textContent = text; };
  const details = (lines) => { ui.details.textContent = lines.filter(Boolean).join('\n'); };
  const setBusy = (busy) => {
    running = busy;
    for (const el of [ui.file, ui.url, ui.load, ui.chooseFolder, ui.fillOnly]) el.disabled = busy;
    ui.start.disabled = busy || !loaded;
    ui.stop.disabled = !busy;
  };

  try { ui.url.value = localStorage.getItem(SOURCE_KEY) || ''; } catch {}
  try { ui.file.value = localStorage.getItem(FILE_KEY) || DEFAULT_FILE; } catch { ui.file.value = DEFAULT_FILE; }
  // The typed file name, or '' (with the reason shown) when it is not a plain file name.
  function fileName() {
    const name = ui.file.value.trim() || DEFAULT_FILE;
    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      status('Not loaded: enter only the file name, such as chrome.txt, without folders.');
      return '';
    }
    try { localStorage.setItem(FILE_KEY, name); } catch {}
    return name;
  }
  status('Load the descriptions, then press Start.');

  // What was loaded and how it matches the dashboard's languages, before anything is filled.
  function showLoaded() {
    const { plan, unoffered, missing } = planFor(loaded.locales);
    ui.start.textContent = `Start: fill ${plan.length} language${plan.length === 1 ? '' : 's'}`;
    ui.start.disabled = !plan.length;
    status(plan.length ? `Loaded ${Object.keys(loaded.locales).length} descriptions (${loaded.fileName}) from ${loaded.source}. Press Start.`
      : `None of the loaded languages is one the dashboard offers.`);
    details([
      plan.length ? `To fill: ${plan.map((p) => p.folder).join(', ')}` : '',
      loaded.skipped.length ? `Skipped:\n  ${loaded.skipped.join('\n  ')}` : '',
      unoffered.length ? `Not offered by the dashboard: ${unoffered.join(', ')}` : '',
      missing.length ? `Dashboard languages with no ${loaded.fileName}: ${missing.join(', ')}` : '',
    ]);
  }

  async function load(loader) {
    setBusy(true);
    loaded = null;
    details([]);
    try {
      // unsaved stays: the page still holds those edits.
      loaded = await loader();
      if (!Object.keys(loaded.locales).length) {
        const why = loaded.skipped.slice(0, 3).join('; ');
        loaded = null;
        throw new Error(`No usable ${loaded.fileName}.${why ? ` ${why}` : ''}`);
      }
      setBusy(false);
      showLoaded();
    } catch (e) {
      setBusy(false);
      status(`Not loaded: ${e.message}`);
    }
  }

  ui.load.onclick = () => {
    const url = ui.url.value.trim();
    const name = fileName();
    if (!name) return;
    try { localStorage.setItem(SOURCE_KEY, url); } catch {}
    status('Loading descriptions from GitHub…');
    load(() => loadFromGithub(url, name));
  };
  ui.url.onkeydown = (e) => { if (e.key === 'Enter') ui.load.click(); };
  // Descriptions loaded for another file name are not used.
  ui.file.oninput = () => {
    if (!loaded || (ui.file.value.trim() || DEFAULT_FILE) === loaded.fileName) return;
    loaded = null;
    ui.start.disabled = true;
    details([]);
    status('File name changed: press Load or choose the folder again.');
  };
  ui.chooseFolder.onclick = () => {
    if (!fileName()) return;
    ui.folderInput.value = '';
    ui.folderInput.click();
  };
  ui.folderInput.onchange = () => {
    const files = [...ui.folderInput.files];
    const name = fileName();
    if (!files.length || !name) return;
    status('Reading the folder…');
    load(() => loadFromFiles(files, name));
  };
  ui.stop.onclick = () => { stopRequested = true; status('Stopping after this language…'); };
  ui.close.onclick = () => {
    if (running && !confirm('A run is in progress. Stop it and close the panel?')) return;
    ui.panel.remove();
  };
  ui.start.onclick = () => run(ui.fillOnly.checked);

  async function run(fillOnly) {
    if (!onListingPage()) {
      status('Open the item\'s Store listing page (this panel stays open), then press Start.');
      return;
    }
    stopRequested = false;
    setBusy(true);
    const failed = [];
    const upToDate = [];
    const filled = [];
    let saveResult = null;
    try {
      const { options, plan } = planFor(loaded.locales);
      const startOption = options.find((o) => o.name === currentLanguage());
      for (const [i, item] of plan.entries()) {
        if (stopped()) break;
        status(`Filling ${i + 1}/${plan.length}: ${item.option.name}`);
        try {
          await selectLanguage(item.option);
          if (descriptionBox().value === item.text) {
            if (!unsaved.has(item.folder)) upToDate.push(item.folder);
            continue;
          }
          setDescription(item.text);
          await sleep(200);
          if (descriptionBox().value !== item.text) throw new Error('the page did not keep the text');
          filled.push(item);
          unsaved.set(item.folder, item.text);
        } catch (e) {
          failed.push(`${item.folder}: ${e.message}`);
        }
      }

      // Read every filled language back from the page before saving.
      for (const [i, item] of filled.slice().entries()) {
        if (superseded()) return;
        status(`Checking ${i + 1}/${filled.length}: ${item.option.name}`);
        await selectLanguage(item.option);
        if (descriptionBox().value !== item.text) {
          failed.push(`${item.folder}: the text was lost when switching languages`);
          filled.splice(filled.indexOf(item), 1);
          unsaved.delete(item.folder);
        }
      }
      if (superseded()) return;
      if (startOption) await selectLanguage(startOption);

      if (unsaved.size && !fillOnly && !stopped()) {
        status(`Saving ${unsaved.size} languages…`);
        saveResult = await saveDraft();
        if (saveResult) failed.push(`Save draft: ${saveResult}`);
      }
    } catch (e) {
      failed.push(`Stopped: ${e.message}`);
    }

    const saved = saveResult === '';
    const savedCount = saved ? unsaved.size : 0;
    const names = [...unsaved.keys()].sort().join(', ');
    if (saved) unsaved.clear();
    details([
      saved ? `Saved as draft: ${names}`
        : unsaved.size ? `Filled, not saved: ${names}` : 'Nothing filled.',
      upToDate.length ? `Already up to date: ${upToDate.join(', ')}` : '',
      failed.length ? `Failed:\n  ${failed.join('\n  ')}` : '',
    ]);
    status(stopped() && !saved ? `Stopped. ${unsaved.size ? 'Filled languages are not saved: Start again, or click Save draft.' : ''}`
      : saved ? `Done. Saved ${savedCount} languages as a draft${failed.length ? `, ${failed.length} failed` : ''}. Reload and Start again to check.`
        : saveResult ? 'Saving failed. The filled text is still in the page: Start again, or click Save draft.'
          : unsaved.size ? `Done. Filled ${unsaved.size} languages, not saved. Check them, then click Save draft or untick Fill only and Start. Reloading or leaving the page drops them.`
            : failed.length ? `Done with ${failed.length} failure(s). Nothing to save.` : 'Done. Nothing to change.');
    setBusy(false);
  }
})();
