// Firefox Add-ons (addons.mozilla.org, AMO) part of Extension Localization Helper: fills
// the "Describe Add-on" section of an add-on's Edit Product Page. Paste it into the
// browser console's command line on that page (Firefox: type "allow pasting" first).
//
// It opens a panel in the page's bottom-right corner. Choose the local folder with the
// descriptions (one folder per language, each with firefox.txt), or the extension folder
// above it so the summaries come from the manifest's _locales too. AMO's Content Security
// Policy lets the page connect only to AMO itself, so the script cannot read GitHub.
//
// AMO keeps every language of a field in one form, one textarea per language
// (<textarea name="description_de" lang="de">), and its "Save Changes" stores them all.
// So a run opens the section's Edit, fills the Description and Summary of each language it
// does, saves once, then reads the form back from AMO and compares. Languages AMO refuses
// are marked failed and the others saved again. AMO has no draft: a save is public at once.
//
// Settings, loaded descriptions and the run's progress are kept in the page's
// localStorage: after a reload, paste it again and press "Start: all incomplete languages".
(() => {
  'use strict';

  const DEFAULT_FILE = 'firefox.txt';
  const DESCRIPTION_CHARS = [1, 15000];
  const SUMMARY_CHARS = [1, 250];
  const MANIFEST_FILES = ['manifest-firefox.json', 'manifest.json'];
  const SETTINGS_KEY = 'localizationHelper.firefox.settings';
  const DATA_KEY = 'localizationHelper.firefox.descriptions';
  const RUN_KEY = 'localizationHelper.firefox.run';
  const PANEL_ID = 'localization-helper-firefox';
  const INSTANCE_KEY = '__localizationHelperFirefox'; // the latest paste; older ones stop their run

  if (location.hostname !== 'addons.mozilla.org' || !/\/developers\/addon\/[^/]+\/edit\/?$/.test(location.pathname)) {
    alert('Open your add-on\'s Edit Product Page on addons.mozilla.org (Developer Hub → the add-on → Edit Product Page), then run this again.');
    return;
  }

  // localStorage can be unavailable (blocked site data); the panel then works without it.
  const readStored = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  };
  const writeStored = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(check, timeout = 30000, interval = 200) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() > end) return null;
      await sleep(interval);
    }
  }

  // Text of a description file as AMO expects it: no BOM, \n line ends, no trailing space.
  const cleanDescription = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  function descriptionProblem(text) {
    const [min, max] = DESCRIPTION_CHARS;
    const n = [...text].length;
    return n < min || n > max ? `${n} characters (must be ${min}-${max})` : null;
  }
  // AMO counts characters as Python does (code points), refuses URLs in summaries and
  // wants at least one letter or digit.
  function summaryProblem(text) {
    const [min, max] = SUMMARY_CHARS;
    const n = [...text].length;
    if (n < min || n > max) return `${n} characters (must be ${min}-${max})`;
    if (/https?:\/\/\S/i.test(text)) return 'contains a URL (AMO refuses URLs in summaries)';
    if (!/[\p{L}\p{N}]/u.test(text)) return 'has no letter or digit';
    return null;
  }

  // Loaded descriptions ({ source, locales: { de: { description, summary? } }, skipped,
  // summaries }) and their locales.
  let DATA = null;
  let LOCALES = [];
  function setData(data) {
    DATA = data;
    LOCALES = data ? Object.keys(data.locales).sort() : [];
  }
  let settings = { fileName: DEFAULT_FILE };
  const currentFileName = () => settings.fileName ?? DEFAULT_FILE;

  // ---------------------------------------------------------------------------
  // Descriptions from a local folder, picked in a file input with webkitdirectory.

  class LoadError extends Error {}

  // Adds each locale's summary from the extension's manifest and _locales to `locales`
  // ({ de: { description } } -> { de: { description, summary } }). `ancestors` are the
  // folders above the descriptions folder, nearest first; `readFile(path)` returns the
  // file's text, or null when it does not exist. Returns what the panel shows:
  // { manifest: 'path/manifest.json', count, skipped: ['dsb: …'] } or { error }.
  async function addManifestSummaries({ locales, ancestors, readFile }) {
    const join = (...parts) => parts.filter(Boolean).join('/');
    for (const dir of ancestors) {
      for (const name of MANIFEST_FILES) {
        const text = await readFile(join(dir, name));
        if (text === null) continue;
        const manifestPath = join(dir, name);
        let manifest;
        try {
          manifest = JSON.parse(text.replace(/^﻿/, ''));
        } catch (e) {
          return { error: `${manifestPath} is not valid JSON (${e.message})` };
        }
        const key = /^__MSG_(\w+)__$/.exec(manifest.description || '')?.[1];
        if (!key) return { error: `${manifestPath}'s "description" is not translated (no __MSG_…__ key)` };
        let count = 0;
        const skipped = [];
        await Promise.all(Object.keys(locales).map(async (locale) => {
          const messagesPath = join(dir, '_locales', locale, 'messages.json');
          const messagesText = await readFile(messagesPath);
          if (messagesText === null) { skipped.push(`${locale}: no _locales/${locale}/messages.json`); return; }
          let messages;
          try {
            messages = JSON.parse(messagesText.replace(/^﻿/, ''));
          } catch {
            skipped.push(`${locale}: messages.json is not valid JSON`);
            return;
          }
          // Message names are case-insensitive in extensions.
          const entry = Object.entries(messages).find(([n]) => n.toLowerCase() === key.toLowerCase())?.[1];
          const summary = (entry?.message || '').trim();
          const problem = summary ? summaryProblem(summary) : `no "${key}" message`;
          if (problem) skipped.push(`${locale}: summary ${problem}`);
          else {
            locales[locale].summary = summary;
            count++;
          }
        }));
        return { manifest: manifestPath, count, skipped: skipped.sort() };
      }
    }
    return { error: 'no manifest.json found in the folders above the descriptions folder' };
  }

  // The pick can be the descriptions folder or a folder above it, such as the extension
  // folder: webkitRelativePath is "<pick>/…/<descriptions folder>/<locale>/<file>", and
  // the descriptions folder is the one holding the most language folders with the file.
  // The summaries come from the manifest found in a folder above it.
  async function loadFromFiles(files, file) {
    const all = files.map((f) => ({ file: f, parts: f.webkitRelativePath.split('/') }));
    const candidates = all.filter(({ parts }) => parts.length >= 3 && parts.at(-1) === file);
    if (!candidates.length) {
      const folder = files[0]?.webkitRelativePath.split('/')[0] || 'that folder';
      throw new LoadError(`No ${file} found in language folders inside "${folder}". `
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
    for (const { file: f, parts } of matches) {
      const description = cleanDescription(await f.text());
      const problem = descriptionProblem(description);
      if (problem) skipped.push(`${parts[depth]}: ${problem}`);
      else locales[parts[depth]] = { description };
    }
    const folders = new Set(all.filter((f) => inFolder(f) && f.parts.length >= depth + 2).map(({ parts }) => parts[depth]));
    for (const locale of folders) {
      if (!matches.some(({ parts }) => parts[depth] === locale)) skipped.push(`${locale}: no ${file}`);
    }
    if (!Object.keys(locales).length) throw new LoadError(`No usable ${file}. ${skipped.slice(0, 3).join('; ')}`);

    const byPath = new Map(all.map(({ file: f }) => [f.webkitRelativePath, f]));
    const segments = folder.split('/');
    const ancestors = segments.slice(1).map((_, i) => segments.slice(0, segments.length - 1 - i).join('/'));
    const summaries = await addManifestSummaries({
      locales, ancestors, readFile: async (path) => (byPath.has(path) ? byPath.get(path).text() : null),
    });
    return {
      source: { kind: 'local', folder, fileName: file, loadedAt: new Date().toISOString() },
      locales,
      skipped: skipped.sort(),
      summaries,
    };
  }

  // ---------------------------------------------------------------------------
  // Locale folders -> AMO languages. AMO writes its codes in lowercase (pt-br, en-us).

  // Folders whose name is not an AMO code. A folder named exactly like an AMO language
  // (es_MX -> es-mx) wins over these, so es_419's text only goes where no es_MX, es_AR or
  // es_CL folder exists.
  const AMO_LOCALES = {
    en: ['en-us'], es: ['es-es'], es_419: ['es-mx', 'es-ar', 'es-cl'], fil: ['tl'], fy: ['fy-nl'],
    ga: ['ga-ie'], hy: ['hy-am'], nb: ['nb-no'], ne: ['ne-np'], nn: ['nn-no'], no: ['nb-no'],
    pt: ['pt-pt'], sv: ['sv-se'], tt: ['tt-ru'],
  };

  // Languages this add-on's page offers (default, existing and new) in its "Localize for" menu.
  const offeredLocales = () => new Set([...document.querySelectorAll('#locale-popup a[href^="#"]')]
    .map((a) => a.getAttribute('href').slice(1).toLowerCase()).filter(Boolean));

  // { targets: { es_419: ['es-mx', 'es-ar', 'es-cl'] }, unmatched: ['xx'] } for the folders.
  function amoTargets(folders, offered) {
    const code = (folder) => folder.toLowerCase().replace(/_/g, '-');
    const exact = new Set(folders.map(code).filter((l) => offered.has(l)));
    const taken = new Set();
    const targets = {};
    const unmatched = [];
    for (const folder of folders) {
      const locales = offered.has(code(folder)) ? [code(folder)]
        : (AMO_LOCALES[folder.toLowerCase().replace(/-/g, '_')] || [])
          .filter((l) => offered.has(l) && !exact.has(l) && !taken.has(l));
      locales.forEach((l) => taken.add(l));
      if (locales.length) targets[folder] = locales;
      else unmatched.push(folder);
    }
    return { targets, unmatched };
  }

  // ---------------------------------------------------------------------------
  // The Describe Add-on form.

  const describeForm = () => document.querySelector('#edit-addon-describe form');
  const isEditable = () => !!describeForm()?.querySelector('.trans[data-name="description"] textarea');

  // Opens the section's edit form (AMO loads it into the page) unless it is open already.
  async function openEditForm() {
    if (!isEditable()) {
      const edit = document.querySelector('#edit-addon-describe h3 a[data-editurl]');
      if (!edit) throw new Error('"Describe Add-on" section not found, or it cannot be edited here');
      edit.click();
    }
    const form = await waitFor(() => isEditable() && describeForm());
    if (!form) throw new Error('The Describe Add-on form did not open within 30 s');
    return form;
  }

  // Puts `text` into the `field` translation for `locale`, adding that language's textarea
  // the way AMO's own language menu does when it has none yet. `filled` collects the
  // textareas set. Returns whether the form now differs from what AMO has stored.
  function setTranslation(form, field, locale, text, filled) {
    const box = form.querySelector(`.trans[data-name="${field}"]`);
    if (!box) throw new Error(`The ${field} field was not found`);
    let el = [...box.querySelectorAll('[lang]')].find((e) => e.getAttribute('lang').toLowerCase() === locale
      && !e.classList.contains('trans-init'));
    // A "cloned" textarea is the page's placeholder showing the default language's text;
    // it is not stored unless it is turned into a real translation.
    let changed = !el || el.classList.contains('cloned');
    if (!el) {
      const init = box.querySelector('.trans-init');
      if (!init) throw new Error(`The ${field} field cannot take new languages`);
      el = init.cloneNode(false);
      el.removeAttribute('class');
      el.setAttribute('lang', locale);
      el.name = `${field}_${locale}`;
      el.id = `id_${field}_${locale}`;
      el.style.display = 'none'; // the page shows one language at a time
      box.append(el);
    }
    el.classList.remove('cloned');
    filled.add(el);
    if (el.value.replace(/\r\n?/g, '\n').trim() !== text.trim()) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }
    return changed;
  }

  // Clicks Save Changes and waits until AMO has answered (the page then replaces the
  // section). Returns AMO's error messages: [{ locale: 'de' or null, text }].
  async function saveForm(form, filled) {
    // The page adds a placeholder in every field for its "Localize for" language. Inputs
    // get the default language's text and the class "cloned"; textareas stay empty (the
    // page sets their value attribute, which a textarea ignores) and lose that class. None
    // must be posted, or AMO stores the default text or an empty translation (which hides
    // the fallback to the default language). The page removes "cloned" ones only from
    // forms that were there when it loaded, not from this one. A language left out of the
    // post keeps what AMO has.
    for (const el of form.querySelectorAll('.trans [lang]:not(.trans-init)')) {
      if (filled.has(el)) el.classList.remove('cloned');
      else if (el.classList.contains('cloned') || !el.value.trim()) el.remove();
    }
    const button = form.querySelector('.listing-footer button[type="submit"]');
    if (!button) throw new Error('"Save Changes" button not found');
    button.click();
    if (!(await waitFor(() => !button.isConnected, 60000))) throw new Error('AMO did not answer "Save Changes" within 60 s. Reload the page and check you are still signed in');
    return [...(document.querySelector('#edit-addon-describe')?.querySelectorAll('.errorlist li') || [])]
      .map((li) => ({ locale: li.getAttribute('data-lang')?.toLowerCase() || null, text: li.textContent.trim() }));
  }

  // Leaves the edit form without saving (AMO's Cancel).
  async function cancelEdit() {
    const cancel = document.querySelector('#edit-addon-describe a.addon-edit-cancel');
    if (!cancel) return;
    cancel.click();
    await waitFor(() => !cancel.isConnected && !isEditable());
  }

  // What AMO has stored, read from a fresh copy of the edit form:
  // { description: { de: 'text' }, summary: { de: 'text' } }.
  async function storedTranslations() {
    const url = describeForm()?.getAttribute('action') || location.pathname.replace(/\/edit\/?$/, '/edit_describe/edit');
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`Reading the saved listing back failed (HTTP ${response.status})`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const read = (field) => Object.fromEntries([...doc.querySelectorAll(`.trans[data-name="${field}"] [lang]:not(.trans-init)`)]
      .map((el) => [el.getAttribute('lang').toLowerCase(), el.value]));
    return { description: read('description'), summary: read('summary') };
  }

  // What AMO stored differently from the folder's texts, e.g. ['es-mx description (empty)'].
  function differences(stored, folder, locales) {
    const { description, summary } = DATA.locales[folder];
    const text = (s) => (s || '').replace(/\r\n?/g, '\n').trim();
    const out = [];
    for (const locale of locales) {
      const saved = stored.description[locale];
      if (text(saved) !== text(description)) out.push(`${locale} description (${saved ? `${[...text(saved)].length} chars` : 'empty'})`);
      if (summary && text(stored.summary[locale]) !== text(summary)) out.push(`${locale} summary`);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Run state, kept in localStorage so a reload loses no progress.

  const instance = {};
  window[INSTANCE_KEY] = instance;
  const newRun = () => ({ active: false, onlyOne: false, done: {}, failed: {}, attempts: {}, current: null, message: '' });
  let run = newRun();
  let looping = false;

  // Pasting the script again, or Close, replaces this panel: its run stops after the
  // current step and no longer touches the page or the stored progress.
  const superseded = () => window[INSTANCE_KEY] !== instance || !host.isConnected;
  class Superseded extends Error {}
  const checkNotSuperseded = () => { if (superseded()) throw new Superseded('replaced by a newer panel'); };

  function saveRun() {
    if (superseded()) return;
    writeStored(RUN_KEY, run);
    render();
  }

  async function runLoopSafely() {
    if (looping) return;
    looping = true;
    try {
      await runLoop();
    } catch (e) {
      if (!(e instanceof Superseded)) stop(`Stopped: ${e.message}`);
    } finally {
      looping = false;
    }
  }

  // mode 'all': every language from the top; 'incomplete': keeps the languages already
  // done and retries the failed ones; 'one': the next language that is not done.
  function start(mode) {
    if (!DATA || loading) return;
    const onlyOne = mode === 'one';
    if (!onlyOne || !run.active) {
      const keep = mode === 'all' ? {} : { done: run.done };
      run = { ...newRun(), ...keep };
    }
    run.active = true;
    run.onlyOne = onlyOne;
    run.message = 'Starting…';
    saveRun();
    runLoopSafely();
  }

  function stop(message) {
    run.active = false;
    run.current = null;
    run.message = message;
    saveRun();
  }

  // ---------------------------------------------------------------------------
  // The run.

  const MAX_ATTEMPTS = 2;

  async function runLoop() {
    const folders = Object.keys(DATA.locales).sort();
    while (run.active && !superseded()) {
      const offered = offeredLocales();
      if (!offered.size) {
        stop('The page\'s "Localize for" menu was not found. Open the add-on\'s Edit Product Page and press Start again.');
        break;
      }
      const { targets, unmatched } = amoTargets(folders, offered);
      for (const folder of unmatched) run.failed[folder] ??= 'AMO offers no matching language for this add-on';
      const todo = folders.filter((f) => targets[f] && !run.done[f] && !run.failed[f]);
      if (!todo.length) {
        stop(`Finished: ${Object.keys(run.done).length} done, ${Object.keys(run.failed).length} failed.`);
        break;
      }
      await processBatch(run.onlyOne ? todo.slice(0, 1) : todo, targets);
      if (run.onlyOne) {
        run.active = false;
        run.message = run.lastResult;
      }
      saveRun();
    }
  }

  // Fills, saves and checks the folders in `batch` in one save.
  async function processBatch(batch, targets) {
    const what = batch.length === 1 ? `${batch[0]} (${targets[batch[0]].join(', ')})` : `${batch.length} languages`;
    run.current = batch.length === 1 ? batch[0] : null;
    run.message = `Opening Describe Add-on for ${what}…`;
    saveRun();
    try {
      const form = await openEditForm();
      checkNotSuperseded();
      run.message = `Filling ${what}…`;
      render();
      const filled = new Set();
      const changed = {};
      for (const folder of batch) {
        const { description, summary } = DATA.locales[folder];
        const fields = new Set();
        for (const locale of targets[folder]) {
          if (setTranslation(form, 'description', locale, description, filled)) fields.add('description');
          if (summary && setTranslation(form, 'summary', locale, summary, filled)) fields.add('summary');
        }
        changed[folder] = [...fields];
      }
      checkNotSuperseded();
      if (Object.values(changed).some((fields) => fields.length)) {
        run.message = `Saving ${what}…`;
        render();
        const errors = await saveForm(form, filled);
        if (errors.length) {
          const refused = batch.filter((f) => errors.some((e) => targets[f].includes(e.locale)));
          // An error that is not about a language of this batch: leave the form open so the
          // message stays visible, and count it as a failed attempt for the whole batch.
          if (!refused.length || errors.some((e) => !batch.some((f) => targets[f].includes(e.locale)))) {
            throw new Error(`AMO refused the save: ${errors.map((e) => e.text).join(' | ').slice(0, 300)}`);
          }
          for (const folder of refused) {
            run.failed[folder] = `AMO refused it: ${errors.filter((e) => targets[folder].includes(e.locale)).map((e) => e.text).join(' | ')}`;
          }
          await cancelEdit(); // nothing was saved; the others are saved again without these
          run.lastResult = `AMO refused ${refused.join(', ')}; ${batch.length - refused.length} languages left to save again.`;
          return;
        }
      } else {
        await cancelEdit();
      }
      run.message = `Checking what AMO stored for ${what}…`;
      render();
      const stored = await storedTranslations();
      let ok = 0;
      for (const folder of batch) {
        const diffs = differences(stored, folder, targets[folder]);
        if (diffs.length) {
          run.attempts[folder] = (run.attempts[folder] || 0) + 1;
          if (run.attempts[folder] >= MAX_ATTEMPTS) run.failed[folder] = `AMO did not store: ${diffs.join(', ')}`;
          continue;
        }
        run.done[folder] = { changed: changed[folder], amo: targets[folder], at: new Date().toISOString() };
        delete run.failed[folder];
        delete run.attempts[folder];
        ok++;
      }
      const fields = changed[batch[0]];
      run.lastResult = batch.length === 1
        ? `${what}: ${ok ? `${fields.length ? `saved ${fields.join(' and ')}` : 'already up to date'}, checked.` : 'AMO did not store it.'}`
        : `${what} saved and checked: ${ok} stored as filled, ${batch.length - ok} not.`;
    } catch (e) {
      // A newer panel may be using the page now: leave it alone.
      if (e instanceof Superseded) throw e;
      for (const folder of batch) {
        run.attempts[folder] = (run.attempts[folder] || 0) + 1;
        // Not marked failed before the last attempt, so the run tries it again.
        if (run.attempts[folder] >= MAX_ATTEMPTS) run.failed[folder] = e.message;
      }
      run.lastResult = `${what} failed: ${e.message}`;
    }
    run.current = null;
  }

  // ---------------------------------------------------------------------------
  // Panel. Built with DOM calls and styled through element styles, so the page's Content
  // Security Policy cannot block it; a shadow root keeps it out of the page's queries and
  // styles.

  function h(tag, props = {}, ...children) {
    const { style, ...rest } = props;
    const el = Object.assign(document.createElement(tag), rest);
    if (style) el.style.cssText = style;
    el.append(...children);
    return el;
  }
  const ST = {
    panel: 'font:13px/1.4 system-ui,sans-serif;color:#1b1b1b;background:#fff;border:1px solid #8a8886;'
      + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);width:340px;max-width:calc(100vw - 32px);'
      + 'max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:10px 12px',
    title: 'display:flex;justify-content:space-between;align-items:center;font-weight:600',
    icon: 'border:none;background:none;cursor:pointer;font:inherit;font-size:14px;padding:0 4px;color:inherit',
    label: 'display:block;margin:6px 0 2px;font-weight:600;font-size:12px',
    input: 'box-sizing:border-box;width:100%;font:inherit;padding:4px 6px;border:1px solid #8a8886;border-radius:4px;'
      + 'color:#1b1b1b;background:#fff',
    row: 'display:flex;gap:6px;margin:8px 0;align-items:center',
    button: 'flex:1;font:inherit;padding:5px 6px;border-radius:4px;cursor:pointer;border:1px solid #0060df;',
    primary: 'background:#0060df;color:#fff',
    secondary: 'background:#fff;color:#0060df',
    muted: 'color:#605e5c;font-size:12px;white-space:pre-wrap',
    error: 'color:#a4262c;font-size:12px;white-space:pre-wrap',
  };
  const button = (text, cls, kind = 'primary', title = '') => h('button', { type: 'button', className: cls, textContent: text, title,
    style: ST.button + ST[kind] });

  document.getElementById(PANEL_ID)?.remove();
  const host = h('div', { id: PANEL_ID, style: 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647' });
  const root = host.attachShadow({ mode: 'open' });
  const body = h('div', { className: 'body', style: 'margin-top:6px' },
    h('div', { style: ST.muted }, 'Choose the descriptions folder (one folder per language), or the extension folder '
      + 'above it to fill the summaries from its _locales too.'),
    h('label', { htmlFor: 'file', style: ST.label }, 'File in each language folder'),
    h('div', { style: ST.row + ';margin:0' },
      h('input', { id: 'file', className: 'file', type: 'text', spellcheck: false, style: `${ST.input};flex:2` }),
      button('Choose folder', 'load', 'secondary')),
    h('input', { className: 'folder', type: 'file', webkitdirectory: true, hidden: true }),
    h('div', { className: 'data', style: `${ST.muted};max-height:120px;overflow:auto;margin-top:4px` }),
    h('div', { className: 'fills', style: `${ST.muted};margin-top:4px` }),
    h('div', { style: ST.row },
      button('Start: all languages', 'start', 'primary', 'Fill every language again, from the first one'),
      button('Start: all incomplete languages', 'incomplete', 'primary', 'Skip the languages already done; retry the failed ones')),
    h('div', { style: ST.row },
      button('Next language only', 'one', 'secondary'),
      button('Stop', 'stop', 'secondary')),
    h('div', { className: 'message', style: 'min-height:1.4em;white-space:pre-wrap' }),
    h('div', { className: 'progress', style: ST.muted }),
    h('div', { className: 'failed', style: `${ST.error};max-height:120px;overflow:auto` }));
  root.append(h('div', { className: 'panel', style: ST.panel },
    h('div', { style: ST.title }, h('span', {}, 'Localization Helper: Firefox'),
      h('span', {}, h('button', { type: 'button', className: 'toggle', title: 'Minimize', textContent: '–', style: ST.icon }),
        h('button', { type: 'button', className: 'close', title: 'Close', textContent: '×', style: ST.icon }))),
    body));
  document.body.append(host);

  const $ = (sel) => root.querySelector(sel);
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const enable = (el, on) => {
    el.disabled = !on;
    if (el.tagName === 'BUTTON') {
      el.style.opacity = on ? '' : '.5';
      el.style.cursor = on ? 'pointer' : 'default';
    }
  };
  let loading = false;
  let loadError = '';

  function sourceStatus() {
    if (loading) return 'Reading the folder…';
    if (loadError) return loadError;
    if (!DATA) return 'No Firefox descriptions loaded. Press Choose folder.';
    const { source, skipped, summaries } = DATA;
    const when = new Date(source.loadedAt).toLocaleString();
    const hint = currentFileName().trim() !== source.fileName
      ? '\nThe file name differs from what is loaded: press Choose folder to use it.'
      : '\nAfter editing the files, choose the folder again.';
    const summaryLine = summaries.error ? `\nNo summaries: ${summaries.error}. Choose the extension folder to fill them too.`
      : `\nSummaries for ${summaries.count} languages from ${summaries.manifest}.`
        + `${summaries.skipped.length ? ` No summary for ${summaries.skipped.join('; ')}.` : ''}`;
    return `Loaded ${LOCALES.length} Firefox descriptions (${source.fileName}) from local folder "${source.folder}" at ${when}.`
      + `${skipped.length ? `\nSkipped: ${skipped.join('; ')}` : ''}${summaryLine}${hint}`;
  }

  // New descriptions start the run's progress over.
  async function load(files, file) {
    loading = true;
    loadError = '';
    render();
    try {
      const data = await loadFromFiles(files, file);
      setData(data);
      writeStored(DATA_KEY, data);
      if (!run.active) {
        run = { ...newRun(), message: 'Descriptions loaded. Press Start.' };
        saveRun();
      }
    } catch (e) {
      loadError = e instanceof LoadError ? e.message : `Loading failed: ${e.message}`;
    }
    loading = false;
    render();
  }

  function chosenFileName() {
    const file = currentFileName().trim();
    if (!file || /[\\/]/.test(file)) {
      loadError = 'Enter the file name inside each language folder, such as firefox.txt.';
      render();
      return '';
    }
    return file;
  }

  function willFill() {
    const count = DATA?.summaries?.count;
    return `Will fill: description, ${count ? `summary (${count} languages)` : 'not summary'}.`
      + ' Save Changes updates the public listing at once (AMO has no draft).'
      + (count ? ' AMO may send the add-on to content review when its summaries change.' : '');
  }

  function render() {
    if (superseded()) return;
    const blocked = run.active || loading || !DATA;
    enable($('.start'), !blocked);
    enable($('.one'), !blocked);
    const doneCount = LOCALES.filter((l) => run.done[l]).length;
    enable($('.incomplete'), !(blocked || doneCount === 0 || doneCount === LOCALES.length));
    $('.incomplete').textContent = `Start: all incomplete languages (${LOCALES.length - doneCount})`;
    enable($('.stop'), run.active);
    for (const sel of ['.file', '.load']) enable($(sel), !(run.active || loading));
    if ($('.file').value !== currentFileName()) $('.file').value = currentFileName();
    $('.data').textContent = sourceStatus();
    $('.data').style.color = loadError ? '#a4262c' : '#605e5c';
    $('.fills').textContent = willFill();
    $('.message').textContent = run.message || (DATA ? 'Press Start to fill the languages on this Edit Product Page.' : '');
    const done = Object.keys(run.done).length;
    const failed = Object.entries(run.failed);
    $('.progress').textContent = `Done ${done}/${LOCALES.length}${failed.length ? `, failed ${failed.length}` : ''}`;
    $('.failed').textContent = failed.map(([l, why]) => `${l}: ${why}`).join('\n');
  }

  $('.toggle').addEventListener('click', () => {
    const hidden = body.style.display !== 'none';
    show(body, !hidden);
    $('.toggle').textContent = hidden ? '+' : '–';
  });
  $('.close').addEventListener('click', () => {
    if (run.active && !confirm('A run is in progress. Stop it and close the panel?')) return;
    if (run.active) stop('Stopped: the panel was closed. Paste the script again to go on.');
    host.remove();
  });
  $('.start').addEventListener('click', () => start('all'));
  $('.incomplete').addEventListener('click', () => start('incomplete'));
  $('.one').addEventListener('click', () => start('one'));
  $('.stop').addEventListener('click', () => stop('Stopped. Press a Start button to go on.'));
  $('.load').addEventListener('click', () => {
    if (!chosenFileName()) return;
    $('.folder').value = '';
    $('.folder').click();
  });
  $('.folder').addEventListener('change', () => {
    const files = [...$('.folder').files];
    const file = chosenFileName();
    if (files.length && file) load(files, file);
  });
  $('.file').addEventListener('input', (e) => {
    settings = { ...settings, fileName: e.target.value };
    writeStored(SETTINGS_KEY, settings);
    render();
  });

  // Restore what an earlier paste on this site kept. A run that was going when the page
  // reloaded is not resumed by itself: the panel says how to go on.
  settings = { ...settings, ...(readStored(SETTINGS_KEY) || {}) };
  setData(readStored(DATA_KEY));
  run = { ...newRun(), ...(readStored(RUN_KEY) || {}) };
  if (run.active) {
    run.active = false;
    run.current = null;
    run.message = 'The last run was interrupted (the page reloaded, or the script was pasted again). Press "Start: all incomplete languages" to go on.';
    saveRun();
  }
  render();
})();
