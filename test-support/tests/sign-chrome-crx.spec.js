import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { test, expect, chromium } from "@playwright/test";


/*
 * .github/sign-chrome-crx.mjs signs the Chrome packages the release
 * drafts carry. Chrome's own --pack-extension is the reference: from the
 * same zip and key, both must write the same bytes. The encrypted key is
 * made with openssl, as the key in the repository's secrets was.
 */
const SIGNER = path.resolve(__dirname, "../../.github/sign-chrome-crx.mjs");

const PASSPHRASE = "test passphrase";


// A throwaway extension, its key for Chrome, and the same key encrypted.
function makeFixture() {
  const directory = test.info().outputPath("fixture");
  const extension = path.join(directory, "extension");
  const plainKey = path.join(directory, "key.pem");
  const encryptedKey = path.join(directory, "key.enc.pem");

  fs.mkdirSync(extension, { recursive: true });
  fs.writeFileSync(
    path.join(extension, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "Signing test", version: "1.0" })
  );
  execFileSync("openssl", [
    "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", plainKey
  ], { stdio: "pipe" });
  execFileSync("openssl", [
    "pkey", "-in", plainKey, "-aes256", "-passout", `pass:${PASSPHRASE}`, "-out", encryptedKey
  ], { stdio: "pipe" });

  return { directory, extension, plainKey, encryptedKey };
}


function sign(zip, crx, env) {
  return spawnSync(process.execPath, [SIGNER, zip, crx], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8"
  });
}


test("the signed package matches Chrome's own", () => {
  const { directory, extension, plainKey, encryptedKey } = makeFixture();

  // Chrome writes extension.crx next to the extension directory.
  execFileSync(chromium.executablePath(), [
    "--headless=new",
    "--no-sandbox",
    `--pack-extension=${extension}`,
    `--pack-extension-key=${plainKey}`
  ], { stdio: "pipe" });
  const chromeCrx = fs.readFileSync(path.join(directory, "extension.crx"));

  // The zip is what follows the magic number, version, header length and header.
  const zip = path.join(directory, "extension.zip");
  fs.writeFileSync(zip, chromeCrx.subarray(12 + chromeCrx.readUInt32LE(8)));

  const crx = path.join(directory, "signed.crx");
  const result = sign(zip, crx, {
    CWS_UPLOAD_PRIVATE_KEY: fs.readFileSync(encryptedKey, "utf8"),
    CWS_UPLOAD_KEY_PASSPHRASE: PASSPHRASE
  });

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(fs.readFileSync(crx).equals(chromeCrx)).toBe(true);
});


test("a wrong passphrase writes nothing and prints no key", () => {
  const { directory, extension, encryptedKey } = makeFixture();
  const zip = path.join(directory, "extension.zip");
  const crx = path.join(directory, "signed.crx");
  const pem = fs.readFileSync(encryptedKey, "utf8");

  execFileSync("zip", ["-qr", zip, "."], { cwd: extension });

  // A newline pasted after the passphrase makes it a different passphrase.
  const result = sign(zip, crx, {
    CWS_UPLOAD_PRIVATE_KEY: pem,
    CWS_UPLOAD_KEY_PASSPHRASE: `${PASSPHRASE}\n`
  });
  const output = result.stdout + result.stderr;

  expect(result.status).toBe(1);
  expect(output).toContain("could not decrypt");
  expect(output).not.toContain("PRIVATE KEY");
  expect(output).not.toContain(pem.split("\n")[1]);
  expect(output).not.toContain(PASSPHRASE);
  expect(fs.existsSync(crx)).toBe(false);
});


test("a missing key writes nothing", () => {
  const { directory, extension } = makeFixture();
  const zip = path.join(directory, "extension.zip");
  const crx = path.join(directory, "signed.crx");

  execFileSync("zip", ["-qr", zip, "."], { cwd: extension });

  const result = sign(zip, crx, { CWS_UPLOAD_KEY_PASSPHRASE: PASSPHRASE });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("must both be set");
  expect(fs.existsSync(crx)).toBe(false);
});
