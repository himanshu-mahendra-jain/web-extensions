// Microsoft Edge part of Extension Localization Helper: fills an extension's Store listings
// on Partner Center, one language after another. Paste it into DevTools' console (or save
// it as a DevTools Snippet) on the extension's Store listings page.
//
// It opens a panel in the page's bottom-right corner. Load the descriptions from a GitHub
// folder or a local folder, then Start: for each language it opens "Edit details", fills
// the Description and the YouTube video URL and Search terms typed in the panel, clicks
// Save draft, reads the language back from Partner Center's API, clicks the details view's
// Close, and moves on until all are done. It never clicks Publish.
//
// Settings, loaded descriptions and the run's progress are kept in the page's
// localStorage: after a reload, paste it again and press "Start: all incomplete languages".
(() => {
  'use strict';

  const DEFAULT_FILE = 'edge.txt';
  const DESCRIPTION_CHARS = [250, 10000]; // Partner Center's limits per description
  const SETTINGS_KEY = 'localizationHelper.edge.settings';
  const DATA_KEY = 'localizationHelper.edge.descriptions';
  const RUN_KEY = 'localizationHelper.edge.run';
  const PANEL_ID = 'localization-helper-edge';
  const INSTANCE_KEY = '__localizationHelperEdge'; // the latest paste; older ones stop their run

  if (location.hostname !== 'partner.microsoft.com') {
    alert('Open your extension\'s Store listings page on Partner Center (partner.microsoft.com), then run this again.');
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

  const normalize = (s) => (s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  // The panel lives in a shadow root, so none of the page queries below can find its fields.
  const isVisible = (el) => !!(el && el.isConnected && el.getClientRects().length
    && getComputedStyle(el).visibility !== 'hidden');
  const isDisabled = (el) => !!el.disabled || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
  // Button text without icon glyphs or punctuation.
  const buttonText = (el) => normalize(el.innerText || el.textContent || el.getAttribute('aria-label'))
    .replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

  // Text of a description file as Partner Center expects it: no BOM, \n line ends, no trailing space.
  const cleanDescription = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  function descriptionProblem(text) {
    const [min, max] = DESCRIPTION_CHARS;
    const n = [...text].length;
    return n < min || n > max ? `${n} characters (must be ${min}-${max})` : null;
  }

  // Loaded descriptions ({ source, locales: { de: { description } }, skipped }) and their locales.
  let DATA = null;
  let LOCALES = [];
  function setData(data) {
    DATA = data;
    LOCALES = data ? Object.keys(data.locales).sort() : [];
  }

  // ---------------------------------------------------------------------------
  // Panel settings: YouTube URL and search terms, same for every language.

  // Partner Center's own pattern for the YouTube video URL field.
  const YOUTUBE_URL = /^(https:\/\/(www\.)?youtu\.be\/([a-zA-Z0-9-]|_)+($|\?.*)|https:\/\/(www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9-]|_)+($|&).*)$/;
  const MAX_TERMS = 7;
  const MAX_TERM_CHARS = 30;
  const MAX_TERM_WORDS = 21;
  let settings = {
    sourceKind: 'github', // github | local
    sourceUrl: '',
    fileName: DEFAULT_FILE,
    youtubeUrl: '',
    searchTermsText: '',
  };
  const currentFileName = () => settings.fileName ?? DEFAULT_FILE;

  // Search terms typed in the panel, comma separated: "sms, otp code" -> ['sms', 'otp code'].
  const splitTerms = (text) => (text || '').split(',').map((t) => t.trim()).filter(Boolean);
  // Characters as Partner Center's own term box counts them (its maxlength counts UTF-16
  // units, so an emoji counts as 2).
  const termChars = (term) => term.length;
  const termWords = (terms) => terms.reduce((n, t) => n + t.split(/\s+/).length, 0);

  // Why `text` breaks a Partner Center limit, or null. A trailing comma counts as a new
  // term being started, so the comma after the 7th term is refused.
  function termsLimitProblem(text) {
    const terms = splitTerms(text);
    const startingAnother = /,\s*$/.test(text) ? 1 : 0;
    if (terms.length + startingAnother > MAX_TERMS) return `Maximum ${MAX_TERMS} search terms.`;
    const long = terms.find((t) => termChars(t) > MAX_TERM_CHARS);
    if (long) return `Maximum ${MAX_TERM_CHARS} characters per search term ("${long.slice(0, 20)}…" has ${termChars(long)}).`;
    if (termWords(terms) > MAX_TERM_WORDS) return `Maximum ${MAX_TERM_WORDS} words across all search terms.`;
    return null;
  }

  // Returns { youtubeUrl, searchTerms, errors } from what was typed in the panel.
  function parseSettings({ youtubeUrl, searchTermsText }) {
    const url = (youtubeUrl || '').trim();
    const searchTerms = splitTerms(searchTermsText);
    const errors = [];
    if (url && !YOUTUBE_URL.test(url)) {
      errors.push('YouTube URL must look like https://www.youtube.com/watch?v=… or https://youtu.be/…');
    }
    if (searchTerms.length > MAX_TERMS) errors.push(`${searchTerms.length} search terms: at most ${MAX_TERMS}.`);
    for (const t of searchTerms.filter((term) => termChars(term) > MAX_TERM_CHARS)) {
      errors.push(`"${t}" is ${termChars(t)} characters: at most ${MAX_TERM_CHARS}.`);
    }
    const words = termWords(searchTerms);
    if (words > MAX_TERM_WORDS) errors.push(`${words} words across the search terms: at most ${MAX_TERM_WORDS}.`);
    if (new Set(searchTerms.map(normalize)).size !== searchTerms.length) errors.push('Search terms contain a duplicate.');
    return { youtubeUrl: url, searchTerms, errors };
  }
  const fillValues = () => parseSettings(settings);

  // ---------------------------------------------------------------------------
  // Language names -> locale codes ("Details for German", table cell "Bangla").

  // Names Partner Center might use that Intl.DisplayNames does not produce.
  const NAME_ALIASES = {
    en: ['English (United States)', 'English (US)'],
    es_419: ['Spanish (Latin America)', 'Spanish (Latin America and Caribbean)',
      'Spanish (Latin America and the Caribbean)', 'Latin American Spanish'],
    fil: ['Filipino', 'Tagalog'],
    no: ['Norwegian', 'Norwegian Bokmål', 'Norwegian (Bokmål)'],
    pt_BR: ['Portuguese (Brazil)', 'Brazilian Portuguese'],
    pt_PT: ['Portuguese (Portugal)', 'European Portuguese'],
    sw: ['Swahili', 'Kiswahili'],
    zh_CN: ['Chinese (Simplified)', 'Simplified Chinese', 'Chinese (Simplified, China)', 'Chinese (China)'],
    zh_TW: ['Chinese (Traditional)', 'Traditional Chinese', 'Chinese (Traditional, Taiwan)', 'Chinese (Taiwan)'],
  };

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function englishName(locale, style = 'standard') {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: style }).of(locale.replace('_', '-'));
    } catch {
      return locale;
    }
  }

  // Name patterns of the loaded descriptions' locales, rebuilt when other descriptions load.
  let patternsData = null;
  let NAME_PATTERNS = [];

  function namePatterns() {
    if (DATA === patternsData) return NAME_PATTERNS;
    patternsData = DATA;
    NAME_PATTERNS = LOCALES.flatMap((locale) => {
      const names = new Set([englishName(locale, 'standard'), englishName(locale, 'dialect'),
        ...(NAME_ALIASES[locale] || []), `(${locale.replace('_', '-')})`]);
      return [...names].map((name) => {
        const n = normalize(name);
        // Whole-word match, so "Malay" does not match "Malayalam".
        return { locale, length: n.length, regex: new RegExp(`(^|[^\\p{L}])${escapeRegExp(n)}($|[^\\p{L}])`, 'u') };
      });
    });
    return NAME_PATTERNS;
  }

  function detectLocale(text) {
    const t = normalize(text);
    let best = null;
    for (const p of namePatterns()) {
      if (p.regex.test(t) && (!best || p.length > best.length)) best = p;
    }
    return best ? best.locale : null;
  }

  // ---------------------------------------------------------------------------
  // Page structure.

  // The language of the open "Details for <language>" view, or null.
  function detailsLanguage() {
    for (const node of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
      if (!isVisible(node)) continue;
      const text = node.textContent || '';
      if (/details for\s/i.test(text)) return text.replace(/^[\s\S]*?details for\s+/i, '').trim();
    }
    return null;
  }

  // Command buttons (<v6_he-button> "Save draft" / "Close") of the details view.
  function detailsCommand(name) {
    const buttons = [...document.querySelectorAll('*')]
      .filter((el) => (el.tagName === 'BUTTON' || el.tagName.endsWith('-BUTTON') || el.getAttribute('role') === 'button')
        && isVisible(el));
    const save = buttons.find((b) => buttonText(b) === 'save draft');
    if (name === 'save draft') return save || null;
    // Close next to Save draft, never the Store listings page's own Close.
    const group = save && (save.closest('.button-group') || save.parentElement);
    return group ? [...group.querySelectorAll('*')].find((b) => buttons.includes(b) && buttonText(b) === name) || null : null;
  }

  function labelTexts(el) {
    const texts = [el.getAttribute('aria-label'), el.getAttribute('title')];
    for (const id of (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
      texts.push(document.getElementById(id)?.textContent);
    }
    for (const label of el.labels || []) texts.push(label.textContent);
    return texts.filter(Boolean).map((t) => normalize(t).replace(/\*|\(required\)|\(optional\)/g, '').trim());
  }

  function findDescriptionField() {
    return [...document.querySelectorAll('textarea')].find((el) => isVisible(el) && !el.disabled
      && labelTexts(el).some((t) => t === 'description' || t.startsWith('description,'))) || null;
  }

  function findYoutubeField() {
    return [...document.querySelectorAll('input')].find((el) => isVisible(el)
      && labelTexts(el).some((t) => t.startsWith('youtube video url'))) || null;
  }

  const searchTermsBox = () => document.querySelector('app-search-terms');
  const currentSearchTerms = () => [...(searchTermsBox()?.querySelectorAll('.keyword-value') || [])]
    .map((a) => a.textContent.trim()).filter(Boolean);

  // Rows of the Store listings table: [{ language, locale, description, editButton }].
  function listingRows() {
    return [...document.querySelectorAll('tr')].filter(isVisible).map((tr) => {
      const editButton = [...tr.querySelectorAll('button')].find((b) => buttonText(b) === 'edit details');
      if (!editButton) return null;
      const cells = tr.querySelectorAll('td');
      const language = (cells[0]?.innerText || '').trim();
      return { language, locale: detectLocale(language), status: (cells[1]?.innerText || '').trim(),
        description: (cells[3]?.innerText || '').trim(), editButton };
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Filling fields the way typing or pasting would, so the Angular form sees it.

  const valueOf = (el) => (el.value || '').replace(/\r\n?/g, '\n').trim();

  function setFieldText(el, text, { keyEvents = false } = {}) {
    el.focus();
    el.select();
    const inserted = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    if (!inserted || el.value !== text) {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // The search-term box enables "Add Term" on key events, not on input.
    if (keyEvents) {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, { key: 'a', bubbles: true }));
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return valueOf(el) === text.trim();
  }

  async function setSearchTerms(terms) {
    const box = searchTermsBox();
    if (!box) throw new Error('Search terms section not found');
    // The same terms in any order count as up to date; otherwise ours replace them in our order.
    const sameSet = (a, b) => a.length === b.length && b.every((t) => a.map(normalize).includes(normalize(t)));
    if (sameSet(currentSearchTerms(), terms)) return false;

    // Remove the existing terms, then add ours in order.
    for (let guard = 0; currentSearchTerms().length && guard < 20; guard++) {
      const before = currentSearchTerms().length;
      box.querySelector('a[aria-label^="Delete Search term"]').click();
      if (!(await waitFor(() => currentSearchTerms().length < before, 5000))) throw new Error('Could not delete a search term');
    }
    for (const term of terms) {
      const input = await waitFor(() => box.querySelector('#last-search-item'), 5000);
      if (!input) throw new Error('Search term box not found');
      setFieldText(input, term, { keyEvents: true });
      const add = await waitFor(() => [...box.querySelectorAll('button')]
        .find((b) => isVisible(b) && buttonText(b) === 'add term' && !isDisabled(b)), 5000);
      if (!add) throw new Error(`"Add Term" stayed disabled for "${term}"`);
      const before = currentSearchTerms().length;
      add.click();
      if (!(await waitFor(() => currentSearchTerms().length > before, 5000))) throw new Error(`Search term "${term}" was not added`);
    }
    if (!sameSet(currentSearchTerms(), terms)) throw new Error(`Search terms ended up as: ${currentSearchTerms().join(', ')}`);
    return true;
  }

  // Fills the open details view for `locale`. Returns the list of fields changed.
  // The YouTube URL and search terms come from the panel; empty ones are left as they are.
  async function fillDetails(locale) {
    const data = DATA.locales[locale];
    const { youtubeUrl, searchTerms } = fillValues();
    const changed = [];
    const description = await waitFor(findDescriptionField);
    if (!description) throw new Error('Description field not found');
    if (valueOf(description) !== data.description.trim()) {
      if (!setFieldText(description, data.description)) throw new Error('Description field did not accept the text');
      changed.push('description');
    }
    if (youtubeUrl) {
      const youtube = findYoutubeField();
      if (!youtube) throw new Error('YouTube video URL field not found');
      if (valueOf(youtube) !== youtubeUrl) {
        if (!setFieldText(youtube, youtubeUrl)) throw new Error('YouTube field did not accept the URL');
        changed.push('YouTube URL');
      }
    }
    if (searchTerms.length && (await setSearchTerms(searchTerms))) changed.push('search terms');
    return changed;
  }

  // Fills, then checks again after a pause that the page did not reset the fields
  // (it can when its data arrives late); fills again if it did.
  async function fillAndConfirm(locale) {
    const changed = new Set(await fillDetails(locale));
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(1500);
      const again = await fillDetails(locale);
      if (!again.length) return [...changed];
      again.forEach((f) => changed.add(f));
    }
    throw new Error('The page kept resetting the fields after they were filled');
  }

  // ---------------------------------------------------------------------------
  // Partner Center's own data requests, seen read-only through the browser's resource
  // timing: used to wait until a details view has loaded its data, and to read back
  // what a save stored.

  const API_PATH = /\/dashboard\/microsoftedge\/api\//i;
  const LISTING_URL = /\/api\/[0-9a-f-]{36}\/listings\/storeListings\/[0-9a-f-]{36}(?:[?#]|$)/i;
  const QUIET_MS = 2000;
  const apiRequests = []; // finished requests: { url, start, end } in performance.now() time
  const resourceObserver = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (API_PATH.test(e.name)) {
        apiRequests.push({ url: e.name, start: e.startTime, end: e.responseEnd || e.startTime + e.duration });
      }
    }
  });
  resourceObserver.observe({ type: 'resource', buffered: true });

  const lastApiActivity = () => apiRequests.reduce((t, r) => Math.max(t, r.end), 0);

  // The API URL of the store listing loaded after `since`, such as
  // https://partner.microsoft.com/en-us/dashboard/microsoftedge/api/<product>/listings/storeListings/<id>.
  function listingUrlSince(since) {
    for (let i = apiRequests.length - 1; i >= 0; i--) {
      if (apiRequests[i].start >= since && LISTING_URL.test(apiRequests[i].url)) return apiRequests[i].url.split(/[?#]/)[0];
    }
    return null;
  }

  // Waits until the details view opened at `since` has loaded its data and the page has
  // made no API request for QUIET_MS. Returns the listing's API URL.
  async function waitForDetailsLoaded(since) {
    const url = await waitFor(() => listingUrlSince(since));
    if (!url) throw new Error("The language's data did not load (no listing request seen in 30 s)");
    const settled = await waitFor(() => findDescriptionField() && performance.now() - lastApiActivity() >= QUIET_MS);
    if (!settled) throw new Error('The page kept loading for 30 s');
    return url;
  }

  async function readListing(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`Reading the saved listing back failed (HTTP ${response.status})`);
    return response.json();
  }

  // What in the saved listing differs from what should be there, e.g. ['description (empty)'].
  function listingDifferences(listing, locale) {
    const differences = [];
    const text = (s) => (s || '').replace(/\r\n?/g, '\n').trim();
    if (text(listing.description) !== text(DATA.locales[locale].description)) {
      differences.push(`description (${listing.description ? `${[...listing.description].length} chars` : 'empty'})`);
    }
    const { youtubeUrl, searchTerms } = fillValues();
    if (youtubeUrl && !(listing.urls?.VideoUrl || []).some((v) => v?.url === youtubeUrl)) differences.push('YouTube URL');
    if (searchTerms.length) {
      // Partner Center can store an empty term (it shows none for it); ignore those.
      const saved = (listing.keywords || []).map((k) => normalize(k)).filter(Boolean);
      if (saved.length !== searchTerms.length || searchTerms.some((t) => !saved.includes(normalize(t)))) {
        differences.push(`search terms (${saved.length} saved)`);
      }
    }
    return differences;
  }

  // Reads the listing back until it matches, for up to 30 s (the save may still be landing).
  async function verifySaved(url, locale) {
    let differences = [];
    const end = Date.now() + 30000;
    do {
      differences = listingDifferences(await readListing(url), locale);
      if (!differences.length) return;
      await sleep(2000);
    } while (Date.now() < end);
    throw new Error(`Partner Center did not store: ${differences.join(', ')}`);
  }

  const SAVED_ALERT = /draft saved successfully/i;
  const pageAlerts = () => [...document.querySelectorAll('[role="alert"], .alert-title, [class*="toast" i], [class*="notification" i], [class*="message-bar" i]')]
    .filter(isVisible).map((e) => e.innerText.trim()).filter(Boolean);

  // Clicks Save draft and waits for Partner Center's "Draft saved successfully." (up to
  // 60 s). Whether the data really landed is checked afterwards by verifySaved.
  async function saveDraft() {
    const save = await waitFor(() => {
      const b = detailsCommand('save draft');
      return b && !isDisabled(b) ? b : null;
    }, 5000);
    if (!save) {
      throw new Error('"Save draft" stayed disabled. A field may be invalid: check the page for errors.');
    }
    save.click();
    const saved = await waitFor(() => pageAlerts().some((t) => SAVED_ALERT.test(t)), 60000);
    if (!saved) {
      const alerts = pageAlerts().join(' | ');
      throw new Error(`No "Draft saved successfully" within 60 s${alerts ? `. The page says: ${alerts.slice(0, 200)}` : ''}`);
    }
  }

  async function closeDetails() {
    const close = detailsCommand('close');
    if (!close) throw new Error('Close button of the details view not found');
    close.click();
    if (!(await waitFor(() => !detailsLanguage() && listingRows().length > 0, 60000))) {
      throw new Error('The Store listings table did not come back after Close');
    }
  }

  // ---------------------------------------------------------------------------
  // Descriptions from a GitHub folder: "https://github.com/OWNER/REPO/tree/REF/PATH" (or
  // just the repo URL). Returns { source, locales: { de: { description } }, skipped }.

  class LoadError extends Error {}
  const PARALLEL_DOWNLOADS = 8;
  const encodePath = (parts) => parts.map(encodeURIComponent).join('/');

  async function githubApi(path) {
    const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      if (response.headers.get('x-ratelimit-remaining') === '0' && reset) {
        throw new LoadError(`GitHub's API limit is used up for now. Try again after ${new Date(reset).toLocaleTimeString()}.`);
      }
    }
    return response;
  }

  function parseGithubUrl(url) {
    const usage = 'Enter a GitHub folder URL, such as https://github.com/owner/repo/tree/main/store-descriptions';
    let u;
    try { u = new URL(url.trim()); } catch { throw new LoadError(usage); }
    const segments = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (u.hostname !== 'github.com' || segments.length < 2 || (segments.length > 2 && segments[2] !== 'tree')) {
      throw new LoadError(usage);
    }
    return { owner: segments[0], repo: segments[1].replace(/\.git$/, ''), rest: segments.slice(3) };
  }

  // Finds the branch and folder. A branch name can contain "/", so try each split.
  async function listFolder({ owner, repo, rest }) {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    let splits;
    if (rest.length === 0) {
      const info = await githubApi(base);
      if (info.status === 404) throw new LoadError(`Repository ${owner}/${repo} not found, or it is private.`);
      if (!info.ok) throw new LoadError(`GitHub answered ${info.status} for ${owner}/${repo}.`);
      splits = [{ ref: [(await info.json()).default_branch], path: [] }];
    } else {
      splits = rest.map((_, i) => ({ ref: rest.slice(0, i + 1), path: rest.slice(i + 1) }));
    }
    for (const { ref, path } of splits) {
      const response = await githubApi(`${base}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref.join('/'))}`);
      if (response.status === 404) continue;
      if (!response.ok) throw new LoadError(`GitHub answered ${response.status} for that folder.`);
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new LoadError('That URL is a file, not a folder.');
      return { ref: ref.join('/'), path: path.join('/'), entries };
    }
    throw new LoadError(`Folder not found in ${owner}/${repo}, or the repository is private.`);
  }

  async function loadFromGithub(url, file) {
    const parts = parseGithubUrl(url);
    const { ref, path, entries } = await listFolder(parts);
    const folders = entries.filter((e) => e.type === 'dir').map((e) => e.name).sort();
    if (!folders.length) throw new LoadError('That folder has no language sub-folders (such as en, de, pt_BR).');

    const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.repo)}/`
      + `${encodePath(ref.split('/'))}/${path ? `${encodePath(path.split('/'))}/` : ''}`;
    const locales = {};
    const skipped = [];
    const queue = [...folders];
    async function worker() {
      for (let locale = queue.shift(); locale; locale = queue.shift()) {
        const response = await fetch(`${rawBase}${encodeURIComponent(locale)}/${encodeURIComponent(file)}`, { cache: 'no-store' });
        if (response.status === 404) { skipped.push(`${locale}: no ${file}`); continue; }
        if (!response.ok) throw new LoadError(`Downloading ${locale}/${file} failed (${response.status}).`);
        const description = cleanDescription(await response.text());
        const problem = descriptionProblem(description);
        if (problem) skipped.push(`${locale}: ${problem}`);
        else locales[locale] = { description };
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
    if (!Object.keys(locales).length) throw new LoadError(`No usable ${file} found. ${skipped.slice(0, 3).join('; ')}`);
    return {
      source: { kind: 'github', url: url.trim(), fileName: file, repo: `${parts.owner}/${parts.repo}`, ref, path, loadedAt: new Date().toISOString() },
      locales,
      skipped: skipped.sort(),
    };
  }

  // From the files of a folder picked in a file input with webkitdirectory. The pick can be
  // the descriptions folder or a folder above it: webkitRelativePath is
  // "<pick>/…/<descriptions folder>/<locale>/<file>", and the descriptions folder is the one
  // holding the most language folders with the file.
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
    return { source: { kind: 'local', folder, fileName: file, loadedAt: new Date().toISOString() }, locales, skipped: skipped.sort() };
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
    if (!DATA || loading || parseSettings(settings).errors.length) return;
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

  // Runs until the run is stopped or every language is done; errors end the run (the
  // panel shows them).
  async function runLoop() {
    while (run.active && !superseded()) {
      const open = detailsLanguage();
      if (open) {
        const openLocale = detectLocale(open);
        if (openLocale && (run.failed[openLocale] || run.done[openLocale]) && run.current !== openLocale) {
          stop(`"${open}" is still open after it was processed. Close it, then press Start again.`);
          break;
        }
        await processOpenDetails(open);
        if (run.onlyOne) {
          run.active = false;
          run.message = run.lastResult;
        }
        saveRun();
        continue;
      }
      const rows = await waitFor(() => listingRows().length && listingRows(), 60000);
      if (!run.active || superseded()) break;
      if (!rows) {
        stop('Store listings table not found. Open Store listings and press Start again.');
        break;
      }
      const next = rows.find((r) => r.locale && !run.done[r.locale] && !run.failed[r.locale]);
      if (!next) {
        const unmatched = rows.filter((r) => !r.locale).map((r) => r.language);
        stop(`Finished: ${Object.keys(run.done).length} done, ${Object.keys(run.failed).length} failed`
          + `${unmatched.length ? `; rows with no data: ${unmatched.join(', ')}` : ''}.`);
        break;
      }
      run.current = next.locale;
      run.message = `Opening ${next.language}…`;
      saveRun();
      openedAt = performance.now();
      next.editButton.click();
      const opened = await waitFor(() => detailsLanguage() && findDescriptionField() && searchTermsBox());
      if (!opened) {
        run.failed[next.locale] = 'Details view did not open';
        saveRun();
      }
    }
  }

  // performance.now() when the run clicked Edit details (0: opened some other way).
  let openedAt = 0;
  const MAX_ATTEMPTS = 2;

  async function processOpenDetails(language) {
    const locale = detectLocale(language);
    if (!locale) {
      stop(`No data for "${language}". Close it, then press Start again.`);
      return;
    }
    if (run.current && run.current !== locale) {
      throw new Error(`Opened "${language}" but expected ${run.current}`);
    }
    run.current = locale;
    run.message = `Loading ${language}…`;
    saveRun();
    try {
      const listingUrl = await waitForDetailsLoaded(openedAt);
      checkNotSuperseded();
      run.message = `Filling ${language}…`;
      render();
      const changed = await fillAndConfirm(locale);
      if (changed.length) {
        checkNotSuperseded();
        run.message = `Saving ${language} (${changed.join(', ')})…`;
        render();
        await saveDraft();
      }
      run.message = `Checking what Partner Center stored for ${language}…`;
      render();
      await verifySaved(listingUrl, locale);
      checkNotSuperseded();
      await closeDetails();
      run.done[locale] = { changed, at: new Date().toISOString() };
      delete run.failed[locale];
      delete run.attempts[locale];
      run.lastResult = `${language}: ${changed.length ? `saved ${changed.join(', ')}` : 'already up to date'}, checked.`;
    } catch (e) {
      // A newer panel may be using the page now: leave it alone.
      if (e instanceof Superseded) throw e;
      // Leave the details view so the run can continue; unsaved changes are discarded.
      if (detailsLanguage()) await closeDetails().catch(() => {});
      run.attempts[locale] = (run.attempts[locale] || 0) + 1;
      // Not marked failed before the last attempt, so the run opens the language again.
      if (run.attempts[locale] >= MAX_ATTEMPTS) run.failed[locale] = e.message;
      run.lastResult = `${language} attempt ${run.attempts[locale]} failed: ${e.message}`;
    }
    run.current = null;
    openedAt = 0;
  }

  // ---------------------------------------------------------------------------
  // Panel. Built with DOM calls and styled through element styles, so neither the page's
  // Content Security Policy nor Trusted Types can block it; a shadow root keeps it out of
  // the page's queries and styles.

  function h(tag, props = {}, ...children) {
    const { style, ...rest } = props;
    const el = Object.assign(document.createElement(tag), rest);
    if (style) el.style.cssText = style;
    el.append(...children);
    return el;
  }
  const ST = {
    panel: 'font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#1b1b1b;background:#fff;border:1px solid #8a8886;'
      + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);width:340px;max-width:calc(100vw - 32px);'
      + 'max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:10px 12px',
    title: 'display:flex;justify-content:space-between;align-items:center;font-weight:600',
    icon: 'border:none;background:none;cursor:pointer;font:inherit;font-size:14px;padding:0 4px;color:inherit',
    label: 'display:block;margin:6px 0 2px;font-weight:600;font-size:12px',
    input: 'box-sizing:border-box;width:100%;font:inherit;padding:4px 6px;border:1px solid #8a8886;border-radius:4px;'
      + 'color:#1b1b1b;background:#fff',
    row: 'display:flex;gap:6px;margin:8px 0;align-items:center',
    button: 'flex:1;font:inherit;padding:5px 6px;border-radius:4px;cursor:pointer;border:1px solid #0f6cbd;',
    primary: 'background:#0f6cbd;color:#fff',
    secondary: 'background:#fff;color:#0f6cbd',
    muted: 'color:#605e5c;font-size:12px;white-space:pre-wrap',
    error: 'color:#a4262c;font-size:12px;white-space:pre-wrap',
    choice: 'display:inline-flex;align-items:center;gap:4px;margin-right:12px;cursor:pointer',
  };
  const button = (text, cls, kind = 'primary', title = '') => h('button', { type: 'button', className: cls, textContent: text, title,
    style: ST.button + ST[kind] });
  const choice = (name, value, text) => {
    const input = h('input', { type: 'radio', name, value, style: 'margin:0' });
    return h('label', { style: ST.choice }, input, text);
  };

  document.getElementById(PANEL_ID)?.remove();
  const host = h('div', { id: PANEL_ID, style: 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647' });
  const root = host.attachShadow({ mode: 'open' });
  const body = h('div', { className: 'body', style: 'margin-top:6px' },
    h('div', { style: ST.label }, 'Descriptions from'),
    h('div', {}, choice('source-kind', 'github', 'GitHub folder'), choice('source-kind', 'local', 'Local folder')),
    h('div', { className: 'github-only' },
      h('label', { htmlFor: 'source', style: ST.label }, 'Descriptions folder on GitHub'),
      h('input', { id: 'source', className: 'source', type: 'url', placeholder: 'https://github.com/owner/repo/tree/main/store-descriptions', style: ST.input })),
    h('label', { htmlFor: 'file', style: ST.label }, 'File in each language folder'),
    h('div', { style: ST.row + ';margin:0' },
      h('input', { id: 'file', className: 'file', type: 'text', spellcheck: false, style: `${ST.input};flex:2` }),
      button('Load', 'load', 'secondary')),
    h('input', { className: 'folder', type: 'file', webkitdirectory: true, hidden: true }),
    h('div', { className: 'data', style: `${ST.muted};max-height:90px;overflow:auto;margin-top:4px` }),
    h('div', { className: 'youtube-field' },
      h('label', { htmlFor: 'youtube', style: ST.label }, 'YouTube video URL (empty: leave as is)'),
      h('input', { id: 'youtube', className: 'youtube', type: 'url', placeholder: 'https://www.youtube.com/watch?v=…', style: ST.input })),
    h('div', { className: 'terms-field' },
      h('label', { htmlFor: 'terms', style: ST.label }, 'Search terms, comma separated (empty: leave as is)'),
      h('input', { id: 'terms', className: 'terms', type: 'text', placeholder: 'sms, otp code, desktop sync', style: ST.input }),
      h('div', { className: 'terms-counter', style: ST.muted }),
      h('div', { className: 'terms-hint', role: 'status', style: ST.error })),
    h('div', { className: 'errors', style: ST.error }),
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
    h('div', { style: ST.title }, h('span', {}, 'Localization Helper: Edge'),
      h('span', {}, h('button', { type: 'button', className: 'toggle', title: 'Minimize', textContent: '–', style: ST.icon }),
        h('button', { type: 'button', className: 'close', title: 'Close', textContent: '×', style: ST.icon }))),
    body));
  document.body.append(host);

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const enable = (el, on) => {
    el.disabled = !on;
    if (el.tagName === 'BUTTON' && !el.classList.contains('toggle')) {
      el.style.opacity = on ? '' : '.5';
      el.style.cursor = on ? 'pointer' : 'default';
    }
  };
  let loading = false;
  let loadError = '';

  function sourceStatus() {
    if (loading) return settings.sourceKind === 'local' ? 'Reading the folder…' : 'Loading descriptions from GitHub…';
    if (loadError) return loadError;
    if (!DATA) {
      return settings.sourceKind === 'local'
        ? 'No Edge descriptions loaded. Press Choose folder and pick the folder that holds one folder per language (en, de, pt_BR, …).'
        : 'No Edge descriptions loaded. Enter the GitHub folder that holds one folder per language (en, de, pt_BR, …), then press Load.';
    }
    const { source, skipped } = DATA;
    const when = new Date(source.loadedAt).toLocaleString();
    const from = source.kind === 'local'
      ? `local folder "${source.folder}"`
      : `${source.repo}@${source.ref}${source.path ? `/${source.path}` : ''}`;
    const differs = settings.sourceKind !== source.kind || currentFileName().trim() !== source.fileName
      || (settings.sourceKind === 'github' && settings.sourceUrl.trim() !== source.url);
    const hint = differs
      ? `\nThe choices above differ from what is loaded: press ${settings.sourceKind === 'local' ? 'Choose folder' : 'Load'} to use them.`
      : (source.kind === 'local' ? '\nAfter editing the files, choose the folder again.' : '');
    return `Loaded ${LOCALES.length} Edge descriptions (${source.fileName}) from ${from} at ${when}.`
      + `${skipped.length ? `\nSkipped: ${skipped.join('; ')}` : ''}${hint}`;
  }

  const saveSettings = () => writeStored(SETTINGS_KEY, settings);

  // New descriptions start the run's progress over.
  async function load(loader) {
    loading = true;
    loadError = '';
    render();
    try {
      const data = await loader();
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
      loadError = 'Enter the file name inside each language folder, such as edge.txt.';
      render();
      return '';
    }
    return file;
  }

  // "Will fill: description, YouTube URL, 3 search terms."
  function willFill(parsed) {
    const parts = ['description', parsed.youtubeUrl ? 'YouTube URL' : 'not YouTube URL',
      parsed.searchTerms.length ? `${parsed.searchTerms.length} search terms` : 'not search terms'];
    return `Will fill: ${parts.join(', ')}.`;
  }

  function render() {
    if (superseded()) return;
    const parsed = parseSettings(settings);
    const blocked = run.active || loading || !DATA || parsed.errors.length > 0;
    enable($('.start'), !blocked);
    enable($('.one'), !blocked);
    const doneCount = LOCALES.filter((l) => run.done[l]).length;
    enable($('.incomplete'), !(blocked || doneCount === 0 || doneCount === LOCALES.length));
    $('.incomplete').textContent = `Start: all incomplete languages (${LOCALES.length - doneCount})`;
    enable($('.stop'), run.active);
    const locked = run.active || loading;
    for (const sel of ['.source', '.file', '.load', '.youtube', '.terms']) enable($(sel), !locked);
    for (const radio of $$('input[type="radio"]')) {
      radio.checked = radio.value === settings.sourceKind;
      radio.disabled = locked;
    }
    show($('.github-only'), settings.sourceKind === 'github');
    $('.load').textContent = settings.sourceKind === 'local' ? 'Choose folder' : 'Load';
    if ($('.file').value !== currentFileName()) $('.file').value = currentFileName();
    $('.data').textContent = sourceStatus();
    $('.data').style.color = loadError ? '#a4262c' : '#605e5c';
    $('.errors').textContent = parsed.errors.join('\n');
    const terms = parsed.searchTerms;
    $('.terms-counter').textContent = `${terms.length}/${MAX_TERMS} terms · longest `
      + `${Math.max(0, ...terms.map(termChars))}/${MAX_TERM_CHARS} characters · ${termWords(terms)}/${MAX_TERM_WORDS} words`;
    $('.fills').textContent = willFill(parsed);
    $('.message').textContent = run.message || (DATA ? 'Open Store listings, then press Start.' : '');
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
    resourceObserver.disconnect();
  });
  $('.start').addEventListener('click', () => start('all'));
  $('.incomplete').addEventListener('click', () => start('incomplete'));
  $('.one').addEventListener('click', () => start('one'));
  $('.stop').addEventListener('click', () => stop('Stopped. Press a Start button to go on.'));
  $('.load').addEventListener('click', () => {
    const file = chosenFileName();
    if (!file) return;
    if (settings.sourceKind === 'local') {
      $('.folder').value = '';
      $('.folder').click();
    } else {
      load(() => loadFromGithub(settings.sourceUrl, file));
    }
  });
  $('.folder').addEventListener('change', () => {
    const files = [...$('.folder').files];
    const file = chosenFileName();
    if (files.length && file) load(() => loadFromFiles(files, file));
  });
  $('.source').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.load').click(); });
  for (const radio of $$('input[type="radio"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      loadError = '';
      settings = { ...settings, sourceKind: radio.value };
      saveSettings();
      render();
    });
  }
  for (const [selector, key] of [['.source', 'sourceUrl'], ['.file', 'fileName'], ['.youtube', 'youtubeUrl'], ['.terms', 'searchTermsText']]) {
    $(selector).addEventListener('input', (e) => {
      settings = { ...settings, [key]: e.target.value };
      saveSettings();
      render();
    });
  }

  // Refuse typing or pasting that would break a Partner Center limit, and say which.
  let hintTimer = null;
  function showTermsHint(message) {
    $('.terms-hint').textContent = message;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { $('.terms-hint').textContent = ''; }, 4000);
  }
  const textWith = (input, inserted) => input.value.slice(0, input.selectionStart) + inserted + input.value.slice(input.selectionEnd);
  // Pasting is handled here because only the paste event still has the line breaks (the
  // browser drops them before inserting into a one-line box). Pasted lines become terms.
  $('.terms').addEventListener('paste', (e) => {
    e.preventDefault();
    const input = e.target;
    const inserted = (e.clipboardData?.getData('text/plain') || '').split(/\s*[\r\n\t]+\s*/).filter(Boolean).join(', ');
    const problem = termsLimitProblem(textWith(input, inserted));
    if (problem) {
      showTermsHint(`Paste refused. ${problem}`);
      return;
    }
    input.setRangeText(inserted, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Typing, dropping and autocomplete.
  $('.terms').addEventListener('beforeinput', (e) => {
    if (!e.inputType.startsWith('insert') || e.inputType === 'insertFromPaste') return; // deleting is always allowed
    const inserted = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    const problem = termsLimitProblem(textWith(e.target, inserted));
    if (problem) {
      e.preventDefault();
      showTermsHint(problem);
    }
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
  $('.source').value = settings.sourceUrl;
  $('.youtube').value = settings.youtubeUrl;
  $('.terms').value = settings.searchTermsText;
  render();
})();
