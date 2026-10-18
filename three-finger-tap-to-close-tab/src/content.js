const INTERACTIVE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  'details',
  'dialog',
  'canvas',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="treeitem"]',
  '[role="option"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  'article[role="article"]'
].join(', ');

const PROXIMITY_RADIUS_PX = 16;

function isInteractive(element) {
  if (!(element instanceof Element)) return false;
  if (element === document.body || element === document.documentElement) return false;

  if (typeof element.closest === 'function' && element.closest(INTERACTIVE_SELECTOR) !== null) {
    return true;
  }

  return window.getComputedStyle(element).cursor === 'pointer';
}

function isNearInteractive(x, y, radius = PROXIMITY_RADIUS_PX) {
  if (typeof document.elementsFromPoint !== 'function') return false;
  if (typeof x !== 'number' || typeof y !== 'number') return false;
  if (window.innerWidth <= 0 || window.innerHeight <= 0) return false;

  const diag = Math.round(radius * 0.7071);
  const offsets = [
    [-radius, 0],
    [radius, 0],
    [0, -radius],
    [0, radius],
    [-diag, -diag],
    [diag, -diag],
    [-diag, diag],
    [diag, diag]
  ];

  const maxW = window.innerWidth - 1;
  const maxH = window.innerHeight - 1;

  for (const [dx, dy] of offsets) {
    const sampleX = Math.min(Math.max(0, x + dx), maxW);
    const sampleY = Math.min(Math.max(0, y + dy), maxH);
    const elements = document.elementsFromPoint(sampleX, sampleY);
    if (elements.some(isInteractive)) {
      return true;
    }
  }

  return false;
}

window.addEventListener(
  'auxclick',
  (event) => {
    // Only a real middle click: a page could make one up to close itself.
    if (!event.isTrusted || event.button !== 1) return;

    // Preserve normal behavior on links, controls, and editable fields.
    if (event.composedPath().some(isInteractive) || isNearInteractive(event.clientX, event.clientY)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    // Fails only once the extension is updated or removed; the page stays.
    extensionApi.runtime
      .sendMessage({ type: 'CLOSE_TAB' })
      .catch(() => { });
  },
  true
);