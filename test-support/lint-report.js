import fs from "node:fs";


/*
 * Reads a `web-ext lint --output json` report from stdin, prints every
 * error, warning and notice in it, and exits with 1 if there is any.
 * check.sh runs it on each Firefox package.
 */
const report = JSON.parse(fs.readFileSync(0, "utf8"));

let count = 0;

for (const type of ["errors", "warnings", "notices"]) {
  for (const message of report[type]) {
    count += 1;

    console.log(
      `    ${type.slice(0, -1)}: ${message.code} ${message.file ?? ""}\n` +
      `      ${message.message}`
    );
  }
}

process.exit(count > 0 ? 1 : 0);
