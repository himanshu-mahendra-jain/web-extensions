import crypto from "node:crypto";
import fs from "node:fs";


/*
 * Usage: node .github/sign-chrome-crx.mjs <package.zip> <package.crx>
 * Wraps a Chrome package in a CRX3 file signed with the key the Chrome
 * Web Store's verified uploads check: CWS_UPLOAD_PRIVATE_KEY, an RSA PEM
 * encrypted with CWS_UPLOAD_KEY_PASSPHRASE. The key is decrypted in
 * memory and never printed. From the same zip and key, the output is
 * byte for byte what Chrome's --pack-extension makes.
 */
const [zipPath, crxPath] = process.argv.slice(2);

if (!zipPath || !crxPath) {
  console.error("Usage: node .github/sign-chrome-crx.mjs <package.zip> <package.crx>");
  process.exit(2);
}

const pem = process.env.CWS_UPLOAD_PRIVATE_KEY;
const passphrase = process.env.CWS_UPLOAD_KEY_PASSPHRASE;

if (!pem || !passphrase) {
  console.error("Error: CWS_UPLOAD_PRIVATE_KEY and CWS_UPLOAD_KEY_PASSPHRASE must both be set.");
  process.exit(1);
}

let privateKey;

try {
  privateKey = crypto.createPrivateKey({ key: pem, format: "pem", passphrase });
} catch {
  // The error can quote parts of the key, so it is not printed.
  console.error("Error: could not decrypt CWS_UPLOAD_PRIVATE_KEY with CWS_UPLOAD_KEY_PASSPHRASE.");
  process.exit(1);
}

if (privateKey.asymmetricKeyType !== "rsa") {
  console.error("Error: CWS_UPLOAD_PRIVATE_KEY is not an RSA key.");
  process.exit(1);
}


// A protobuf varint: seven bits per byte, low bits first.
function varint(value) {
  const bytes = [];

  while (value > 0x7f) {
    bytes.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);

  return Buffer.from(bytes);
}


// A length-delimited protobuf field, the only wire type CRX3 headers use.
function field(number, bytes) {
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}


function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}


// Field numbers from Chromium's components/crx_file/crx3.proto.
const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
const crxId = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
const signedHeaderData = field(1, crxId);
const archive = fs.readFileSync(zipPath);

// RSA PKCS#1 v1.5 over SHA-256, Node's default for RSA keys.
const signature = crypto.sign(
  "sha256",
  Buffer.concat([
    Buffer.from("CRX3 SignedData\0"),
    uint32(signedHeaderData.length),
    signedHeaderData,
    archive
  ]),
  privateKey
);

const header = Buffer.concat([
  field(2, Buffer.concat([field(1, publicKey), field(2, signature)])),
  field(10000, signedHeaderData)
]);

fs.writeFileSync(
  crxPath,
  Buffer.concat([Buffer.from("Cr24"), uint32(3), uint32(header.length), header, archive])
);

console.log(`Signed ${crxPath}`);
