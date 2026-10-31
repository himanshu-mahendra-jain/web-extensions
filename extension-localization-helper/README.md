# Extension Localization Helper

These scripts fill in every language of an extension's store listing from translation
files in a folder. There is one script per store:

- `chrome.js` for the Chrome Web Store
- `edge.js` for the Microsoft Edge Add-ons store (Partner Center)
- `firefox.js` for Firefox Add-ons (addons.mozilla.org, or AMO)

https://github.com/user-attachments/assets/c6b19cd8-07b0-4eac-9ab0-867be3a8fe33

You paste a script into the browser's DevTools console on the store's page, and it opens a
small panel there. The descriptions need to be in a folder with one sub-folder per
language:

```
my-extension/
  manifest.json          (Firefox summaries: "description": "__MSG_extensionDescription__")
  _locales/de/messages.json
  store-descriptions/
    en/chrome.txt  en/edge.txt  en/firefox.txt
    de/chrome.txt  de/edge.txt  de/firefox.txt
    pt_BR/edge.txt
    ...
```

## Running a script

Open the store page, press F12, and paste the script into the **Console**. The first time,
the browser asks you to type `allow pasting` before it accepts pasted code. In Chrome and
Edge you can also save the script as a Snippet (Sources → Snippets) and run it with
Ctrl+Enter. The panel appears in the bottom-right corner of the page.

Each panel asks for the name of the file inside each language folder. It defaults to
`chrome.txt`, `edge.txt` or `firefox.txt`. You then load the descriptions:

- **From a local folder.** Pick the descriptions folder or any folder above it. The browser
  may ask whether to "upload" the files. Nothing is uploaded; the script only reads them
  in the page.
- **From GitHub** (Chrome and Edge only). Enter the descriptions folder's URL, such as
  `https://github.com/owner/repo/tree/main/store-descriptions`. The repository must be
  public. GitHub allows 60 API calls an hour without signing in, and each load uses one or
  two.

After loading, the panel shows what it found and which files it skipped, for example
because a file is missing or too long for the store. Reloading the page stops the script.
The Edge and Firefox scripts save their settings, descriptions and progress in the
browser, so after a reload you paste the script again and press **Start: all incomplete
languages** to carry on. Pasting a script a second time replaces its panel and stops the
old run. The scripts find buttons and menus by their English labels, so the store pages
must be in English.

## Chrome: Web Store Developer Dashboard (`chrome.js`)

Open the item's **Store listing** page and paste the script. After you load the
descriptions, the panel lists the languages it will fill and any folders the **Language**
menu doesn't offer. It also lists the dashboard languages that have no file; those are
left as they are. Folder `pt_BR` maps to `pt-BR`, and `he` to Hebrew. Descriptions can be
up to 16,000 characters.

**Start** picks each language in the **Language** menu, fills in its **Description**, and
checks every filled language. Then it clicks **Save draft** once. The dashboard keeps all
languages in the page, so one save stores them all. Tick **Fill only** to stop before
saving, so you can review the text and save it yourself. **Stop** ends the run after the
current language, without saving. The script never clicks **Submit for review**. If
languages are filled but not saved (after Fill only, Stop or a failed save), the next
Start saves them, as long as the page hasn't been reloaded. To check a run, reload the
page, paste the script again, load and press Start. Every language should then be "already
up to date".

## Edge: Partner Center (`edge.js`)

Open your extension's **Store listings** page and paste the script. Load the descriptions.
If you like, also enter a **YouTube video URL** and **Search terms** (comma separated).
These go to every language; leave a field empty to keep what the listing already has.

For each language, the script:

1. Opens **Edit details** and waits for the page to load that language's data. Text filled
   in earlier would be wiped when the data arrives.
2. Fills in the **Description**, YouTube URL and search terms, then checks a moment later
   that the page kept them.
3. Clicks **Save draft** if anything changed, and waits for "Draft saved successfully."
4. Reads the saved language back from Partner Center and compares it with what it filled
   in. It doesn't trust the Store listings table, which can show old data for a while.
5. Clicks **Close** and moves on to the next language.

A language that fails gets one more try before it's reported as failed. The script never
clicks **Publish**, so nothing goes live until you publish it yourself.

The panel enforces Partner Center's limits on search terms: at most 7 terms, 30 characters
each and 21 words in total. It refuses typing or pasting past them and shows a counter.
Pasted lines become separate terms. If the existing terms are the same as yours in a
different order, they're left alone; otherwise yours replace them. Descriptions must be
250 to 10,000 characters long.

The buttons:

- **Next language only** does one language and stops. It's a good first test.
- **Start: all languages** goes through every language from the top.
- **Start: all incomplete languages (N)** skips languages already done and retries failed ones.
- **Stop** ends the run after the current language.

The script matches each row to a folder by the language's English name, so "Bangla" goes to
`bn`, "Kiswahili" to `sw`, and "Spanish (Latin America and the Caribbean)" to `es_419`.
When the run finishes, it lists any rows it had no description for.

## Firefox: AMO Developer Hub (`firefox.js`)

AMO copies the name and summary from the manifest only when an add-on is first created. It
never copies the description. Later translations have to be entered on the add-on's **Edit
Product Page**, which is where you paste this script.

This script reads a local folder only. AMO's security policy blocks the page from
connecting to anything but AMO, GitHub included. Choose the extension folder (the one with
the manifest and `_locales`) to fill in summaries as well. Choose just the descriptions
folder to fill in descriptions only.

AMO keeps all languages of a field in one form, so the script:

1. Clicks **Edit** in the **Describe Add-on** section.
2. Fills in each language's **Description** from `firefox.txt`, up to 15,000 characters. It
   fills the **Summary** from `_locales/<locale>/messages.json`, using the message the
   manifest's `description` points to. Summaries can be at most 250 characters and can't
   contain URLs. `manifest-firefox.json` is used if it exists, otherwise `manifest.json`.
   Languages the listing doesn't have yet are added.
3. Clicks **Save Changes** once for all languages. **AMO has no drafts, so this updates the
   public listing immediately.** If AMO refuses a language, that language is marked as
   failed and the rest are saved again without it.
4. Reads the form back from AMO and compares. A language AMO didn't store gets one more try.

Folder names are matched to AMO's language codes. Most match directly (`de` → `de`,
`pt_BR` → `pt-br`). A few differ: `en` → `en-us`, `es` → `es-es`, `no` → `nb-no`,
`nn` → `nn-no`, `sv` → `sv-se` and `fy` → `fy-nl`. `es_419` fills `es-mx`, `es-ar` and
`es-cl`, unless those have folders of their own. A folder whose language isn't in the
page's **Localize for** menu is reported as failed.

Changing a summary may send the add-on to AMO's content review; changing a description
doesn't. The buttons work as in `edge.js`, except that a run saves all its languages at once.

## Files

- `chrome.js`, `edge.js`, `firefox.js`: the scripts. Each one stands alone.
- `tests/autofill_on_mock_*.test.cjs`: Playwright tests that run the scripts on copies of the
  three store pages, built to behave like the real ones, with a fake GitHub and test folders.
- `demo/record_chrome_demo_video_on_mock_dashboard.cjs`: records a 1920x1080 WebM, about 40
  seconds, of `chrome.js` filling Change Video Playback Speed's 52 listings on a mock page.

## Test

```sh
NODE_PATH=$(npm root -g) node tests/autofill_on_mock_chrome_webstore_dashboard.test.cjs
NODE_PATH=$(npm root -g) node tests/autofill_on_mock_partner_center.test.cjs
NODE_PATH=$(npm root -g) node tests/autofill_on_mock_amo_devhub.test.cjs   # add --firefox to run in Firefox
NODE_PATH=$(npm root -g) node demo/record_chrome_demo_video_on_mock_dashboard.cjs [out.webm]   # the video
```

The video takes about three minutes to record and goes to `dist/chrome-js-demo.webm` unless you
pass a path. It needs Playwright's ffmpeg (`npx playwright install ffmpeg`) and internet access for
the Noto fonts.
