import { prepareDevice, restoreDevice } from "./firefox-android.js";


/*
 * Global setup for the firefox-android project: undoes whatever an
 * interrupted run left on the device, points Firefox at the test
 * config, and restores the device after the run.
 */
export default async function globalSetup() {
  await prepareDevice();

  return restoreDevice;
}
