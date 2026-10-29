import path from "node:path";

import { testLocales } from "../../test-support/locales.js";


testLocales(path.resolve(__dirname, ".."), {
  pages: ["src/popup.html"],
  shortNames: ["SMS Desktop Sync"]
});
