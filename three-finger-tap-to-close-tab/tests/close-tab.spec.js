import path from "node:path";

import {
  test,
  expect,
  routePages
} from "../../test-support/extension.js";


test.use({
  extensionPath: path.resolve(__dirname, "..")
});


/*
 * The page records every auxclick that reaches it. The extension
 * stops the event at the window's capture phase when it closes the
 * tab, so a recorded click is one the extension let through.
 */
const RECORD_CLICKS = `<script>
  window.passedClicks = [];
  window.addEventListener("auxclick", (event) => {
    window.passedClicks.push(event.button);
  });
</script>`;

const PAGE = `<!DOCTYPE html>
<style>
  body { margin: 0; height: 1000px; }
  .at { position: absolute; width: 100px; height: 40px; margin: 0; padding: 0; border: 0; }
</style>
${RECORD_CLICKS}
<a class="at" href="#link" style="left: 20px; top: 20px;">Link</a>
<button class="at" style="left: 200px; top: 20px;">Button</button>
<input class="at" style="left: 380px; top: 20px;">
<textarea class="at" style="left: 560px; top: 20px;"></textarea>
<div class="at" contenteditable style="left: 20px; top: 120px;">Editable</div>
<div class="at" role="button" style="left: 200px; top: 120px;">Role button</div>
<div class="at" style="left: 380px; top: 120px; cursor: pointer;">Pointer</div>
<span class="at" tabindex="0" style="left: 560px; top: 120px;">Focusable</span>
<canvas class="at" style="left: 20px; top: 220px;"></canvas>
<video class="at" controls style="left: 200px; top: 220px;"></video>
<div class="at" id="shadow-host" style="left: 380px; top: 220px;"></div>
<iframe class="at" src="/frame" style="left: 560px; top: 220px; width: 200px; height: 100px;"></iframe>
<div class="at" contenteditable="false" style="left: 20px; top: 380px;">Not editable</div>
<span class="at" tabindex="-1" style="left: 200px; top: 380px;">Not in tab order</span>
<script>
  const shadowButton = document.createElement("button");
  shadowButton.textContent = "Shadow button";
  shadowButton.style.cssText = "width: 100px; height: 40px; margin: 0; padding: 0; border: 0;";
  document.getElementById("shadow-host").attachShadow({ mode: "open" }).append(shadowButton);
</script>`;


const BLANK_SPOT = { x: 400, y: 600 };


test.beforeEach(async ({ context, page }) => {
  await routePages(context, {
    "http://tap.test/": PAGE,
    "http://tap.test/frame": `<body style="margin: 0; height: 100px;">${RECORD_CLICKS}</body>`
  });

  await page.goto("http://tap.test/");
});


async function middleClickCloses(page, point) {
  const closed = page.waitForEvent("close");

  // The tab can close before the click call returns.
  await page.mouse.click(point.x, point.y, { button: "middle" })
    .catch(() => {});

  await closed;
}


function passedClicks(frame) {
  return frame.evaluate(() => window.passedClicks);
}


test("a middle click on an empty part of the page closes the tab", async ({ page }) => {
  await middleClickCloses(page, BLANK_SPOT);
});


test("the toolbar button closes the tab", async ({ page, clickAction }) => {
  const closed = page.waitForEvent("close");

  await clickAction(page);

  await closed;
});


for (const [name, selector] of [
  ["a link", "a"],
  ["a button", "button.at"],
  ["a text field", "input"],
  ["a text area", "textarea"],
  ["editable content", "[contenteditable='']"],
  ["an element with a button role", "[role=button]"],
  ["an element with a pointer cursor", "div[style*=pointer]"],
  ["a focusable element", "[tabindex='0']"],
  ["a canvas", "canvas"],
  ["a video with controls", "video"],
  ["a button inside a shadow root", "#shadow-host >> button"]
]) {
  test(`a middle click on ${name} is left to the page`, async ({ page }) => {
    await page.locator(selector).click({ button: "middle" });

    expect(await passedClicks(page)).toEqual([1]);
  });
}


test("a middle click just outside a button is left to the page", async ({ page }) => {
  const box = await page.locator("button.at").boundingBox();

  // 10px below the button, inside the 16px proximity radius.
  await page.mouse.click(
    box.x + box.width / 2,
    box.y + box.height + 10,
    { button: "middle" }
  );

  expect(await passedClicks(page)).toEqual([1]);
});


test("the proximity radius ends 16px from a button", async ({ page }) => {
  const box = await page.locator("button.at").boundingBox();
  const x = box.x + box.width / 2;
  const bottom = box.y + box.height;

  // 15px below, the sample 16px up lands on the button's last row.
  await page.mouse.click(x, bottom + 15, { button: "middle" });
  expect(await passedClicks(page)).toEqual([1]);

  // 17px below, every sample misses it.
  await middleClickCloses(page, { x, y: bottom + 17 });
});


test("a middle click diagonally off a button's corner is left to the page", async ({ page }) => {
  const box = await page.locator("button.at").boundingBox();

  // Only the up-left sample, 11px each way, lands on the button.
  await page.mouse.click(
    box.x + box.width + 10,
    box.y + box.height + 10,
    { button: "middle" }
  );

  expect(await passedClicks(page)).toEqual([1]);
});


for (const [name, selector] of [
  ["content marked not editable", "[contenteditable=false]"],
  ["an element taken out of the tab order", "[tabindex='-1']"]
]) {
  test(`a middle click on ${name} closes the tab`, async ({ page }) => {
    const box = await page.locator(selector).boundingBox();

    await middleClickCloses(page, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    });
  });
}


test("the back and forward mouse buttons are left to the page", async ({ page }) => {
  // Playwright's mouse has no back or forward button; CDP input is trusted too.
  const cdp = await page.context().newCDPSession(page);

  // Stays on the page instead of going back, as web apps do.
  await page.evaluate(() => {
    window.addEventListener("mouseup", (event) => event.preventDefault());
  });

  for (const [button, buttons] of [["back", 8], ["forward", 16]]) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        button,
        buttons: type === "mousePressed" ? buttons : 0,
        clickCount: 1,
        ...BLANK_SPOT
      });
    }
  }

  await expect.poll(() => passedClicks(page)).toEqual([3, 4]);
});


test("a middle click well clear of a button closes the tab", async ({ page }) => {
  const box = await page.locator("button.at").boundingBox();

  // 30px below the button and 30px above the next element.
  await middleClickCloses(page, {
    x: box.x + box.width / 2,
    y: box.y + box.height + 30
  });
});


test("a right click on an empty part of the page is left to the page", async ({ page }) => {
  await page.mouse.click(BLANK_SPOT.x, BLANK_SPOT.y, { button: "right" });

  expect(await passedClicks(page)).toEqual([2]);
});


// Records every close request the worker receives, and from which frame.
function recordCloseRequests(serviceWorker) {
  return serviceWorker.evaluate(() => {
    self.closeRequests = [];

    chrome.runtime.onMessage.addListener((message, sender) => {
      self.closeRequests.push({ type: message.type, frameId: sender.frameId });
    });
  });
}


test("a middle click inside a frame is left to the frame", async ({ page, serviceWorker }) => {
  await recordCloseRequests(serviceWorker);

  const frame = page.frame({ url: "http://tap.test/frame" });
  const box = await page.locator("iframe").boundingBox();

  await page.mouse.click(
    box.x + box.width / 2,
    box.y + box.height / 2,
    { button: "middle" }
  );

  // The content script runs only in the top frame.
  expect(await passedClicks(frame)).toEqual([1]);

  // A close the frame asked for would reach the worker before this one.
  await middleClickCloses(page, BLANK_SPOT);

  expect(await serviceWorker.evaluate(() => self.closeRequests))
    .toEqual([{ type: "CLOSE_TAB", frameId: 0 }]);
});


test("a middle click the page makes up is left to the page", async ({ page, serviceWorker }) => {
  await recordCloseRequests(serviceWorker);

  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y).dispatchEvent(new MouseEvent("auxclick", {
      button: 1,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y
    }));
  }, BLANK_SPOT);

  expect(await passedClicks(page)).toEqual([1]);

  // A close the made-up click asked for would reach the worker before this one.
  await middleClickCloses(page, BLANK_SPOT);

  expect(await serviceWorker.evaluate(() => self.closeRequests))
    .toEqual([{ type: "CLOSE_TAB", frameId: 0 }]);
});
