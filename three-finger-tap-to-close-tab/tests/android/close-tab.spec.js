import path from "node:path";

import {
  test,
  expect
} from "../../../test-support/firefox-android.js";


test.use({
  extensionPath: path.resolve(__dirname, "../..")
});


// Records every auxclick the extension lets through, as in close-tab.spec.js.
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
<script>
  const shadowButton = document.createElement("button");
  shadowButton.textContent = "Shadow button";
  shadowButton.style.cssText = "width: 100px; height: 40px; margin: 0; padding: 0; border: 0;";
  document.getElementById("shadow-host").attachShadow({ mode: "open" }).append(shadowButton);
</script>`;


const BLANK_SPOT = { x: 400, y: 600 };


test.beforeEach(async ({ firefox }) => {
  firefox.pages.route({
    "http://tap.test/": PAGE,
    "http://tap.test/frame": `<body style="margin: 0; height: 100px;">${RECORD_CLICKS}</body>`
  });
});


/*
 * A real middle click, as a three-finger tap is, from a native mouse
 * button: the page gets trusted events, which a page cannot make up.
 */
async function middleClickCloses(tab, point) {
  // The tab can close before the click call returns.
  await tab.click(point, 1).catch(() => {});

  await tab.waitForClose();
}


async function middleClickPasses(tab, point, frame = "window") {
  await tab.click(point, 1);

  await expect.poll(() => passedClicks(tab, frame)).toEqual([1]);
}


/*
 * Records every close request the background receives from now on, and
 * from which frame. The background outlives a test, so it listens once.
 */
function recordCloseRequests(firefox) {
  return firefox.inBackground(`
    if (!globalThis.closeRequests) {
      browser.runtime.onMessage.addListener((message, sender) => {
        globalThis.closeRequests.push({ type: message.type, frameId: sender.frameId });
      });
    }

    globalThis.closeRequests = [];
  `);
}


function closeRequests(firefox) {
  return firefox.inBackground("return globalThis.closeRequests;");
}


function box(tab, selector) {
  return tab.evaluate(`
    const element = document.querySelector(${JSON.stringify(selector)});
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  `);
}


async function center(tab, selector) {
  const { x, y, width, height } = await box(tab, selector);

  return { x: x + width / 2, y: y + height / 2 };
}


function passedClicks(tab, frame = "window") {
  return tab.evaluate(`return ${frame}.passedClicks;`);
}


test("the extension runs in Firefox for Android", async ({ firefox }) => {
  const platform = await firefox.inBackground(
    "return browser.runtime.getPlatformInfo();"
  );

  expect(platform.os).toBe("android");
});


test("a middle click on an empty part of the page closes the tab", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");

  await middleClickCloses(tab, BLANK_SPOT);
});


test("the toolbar button closes the tab", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");

  await firefox.clickAction(tab);

  await tab.waitForClose();
});


for (const [name, selector] of [
  ["a link", "a"],
  ["a button", "button.at"],
  ["a text field", "input"],
  ["a text area", "textarea"],
  ["editable content", "[contenteditable]"],
  ["an element with a button role", "[role=button]"],
  ["an element with a pointer cursor", "div[style*=pointer]"],
  ["a focusable element", "[tabindex]"],
  ["a canvas", "canvas"],
  ["a video with controls", "video"],
  ["a button inside a shadow root", "#shadow-host"]
]) {
  test(`a middle click on ${name} is left to the page`, async ({ firefox }) => {
    const tab = await firefox.openTab("http://tap.test/");

    await middleClickPasses(tab, await center(tab, selector));
  });
}


test("a middle click just outside a button is left to the page", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");
  const button = await box(tab, "button.at");

  // 10px below the button, inside the 16px proximity radius.
  await middleClickPasses(tab, {
    x: button.x + button.width / 2,
    y: button.y + button.height + 10
  });
});


test("a middle click well clear of a button closes the tab", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");
  const button = await box(tab, "button.at");

  // 30px below the button and 30px above the next element.
  await middleClickCloses(tab, {
    x: button.x + button.width / 2,
    y: button.y + button.height + 30
  });
});


test("a right click on an empty part of the page is left to the page", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");

  await tab.click(BLANK_SPOT, 2);

  await expect.poll(() => passedClicks(tab)).toEqual([2]);
});


test("a middle click inside a frame is left to the frame", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");

  await recordCloseRequests(firefox);

  // The content script runs only in the top frame.
  await middleClickPasses(tab, await center(tab, "iframe"), "frames[0]");

  /*
   * Firefox for Android fires no auxclick for the first press on the
   * page after one in a frame; a left click, which the extension
   * ignores, takes that press.
   */
  await tab.click(BLANK_SPOT, 0);

  // A close the frame asked for would reach the background before this one.
  await middleClickCloses(tab, BLANK_SPOT);

  expect(await closeRequests(firefox)).toEqual([{ type: "CLOSE_TAB", frameId: 0 }]);
});


test("a middle click the page makes up is left to the page", async ({ firefox }) => {
  const tab = await firefox.openTab("http://tap.test/");

  await recordCloseRequests(firefox);

  await tab.evaluate(`
    document.elementFromPoint(${BLANK_SPOT.x}, ${BLANK_SPOT.y}).dispatchEvent(new MouseEvent("auxclick", {
      button: 1,
      bubbles: true,
      cancelable: true,
      clientX: ${BLANK_SPOT.x},
      clientY: ${BLANK_SPOT.y}
    }));
  `);

  expect(await passedClicks(tab)).toEqual([1]);

  // A close the made-up click asked for would reach the background before this one.
  await middleClickCloses(tab, BLANK_SPOT);

  expect(await closeRequests(firefox)).toEqual([{ type: "CLOSE_TAB", frameId: 0 }]);
});

