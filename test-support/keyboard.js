/*
 * Presses Tab from the top of the page, or with fromFocus from the
 * control that has the focus, until focus leaves the page or comes
 * back to a control it already reached. Returns each control it
 * stopped on as its ARIA snapshot line, such as 'button "Save"', and
 * the ones that showed no focus outline.
 */
export async function tabThrough(page, { fromFocus = false, limit = 50 } = {}) {
  await page.evaluate((fromFocus) => {
    if (!fromFocus) {
      document.activeElement?.blur();
    }

    window.tabbedTo = new WeakSet();
  }, fromFocus);

  const stops = [];
  const withoutOutline = [];

  for (let i = 0; i < limit; i++) {
    if (i > 0 || !fromFocus) {
      await page.keyboard.press("Tab");
    }

    const reached = await page.evaluate(() => {
      const element = document.activeElement;

      if (!element || element === document.body || window.tabbedTo.has(element)) {
        return null;
      }

      window.tabbedTo.add(element);

      const style = getComputedStyle(element);

      return {
        outlined: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0
      };
    });

    if (!reached) {
      break;
    }

    const [line] = (await page.locator(":focus").ariaSnapshot()).split("\n");
    const stop = line.replace(/^- /, "").replace(/:$/, "");

    stops.push(stop);

    if (!reached.outlined) {
      withoutOutline.push(stop);
    }
  }

  return { stops, withoutOutline };
}
