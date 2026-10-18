import path from "node:path";

import { testManifests } from "../../test-support/manifests.js";


// Firefox gives extensions no service worker, so no Web Push.
testManifests(path.resolve(__dirname, ".."), { firefox: false });
