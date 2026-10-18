import path from "node:path";

import { testManifests } from "../../test-support/manifests.js";


testManifests(path.resolve(__dirname, ".."), {
  // Firefox also clears cookies in container tabs.
  firefoxOnlyPermissions: ["contextualIdentities"]
});
