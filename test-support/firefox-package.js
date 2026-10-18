import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";


const execFileAsync = promisify(execFile);


/*
 * Builds the extension's Firefox package with build.sh, from a copy
 * because build.sh replaces the extension's dist/ directory, and
 * unpacks it. Returns the unpacked package's directory, under
 * outputDir.
 */
export async function buildFirefoxPackage(extensionPath, outputDir) {
  const name = path.basename(extensionPath);
  const root = path.join(outputDir, name);

  fs.rmSync(root, { recursive: true, force: true });

  fs.cpSync(extensionPath, path.join(root, name), {
    recursive: true,
    filter: (source) => {
      return !["dist", "tests"].includes(
        path.relative(extensionPath, source).split(path.sep)[0]
      );
    }
  });

  fs.copyFileSync(
    path.join(extensionPath, "..", "build.sh"),
    path.join(root, "build.sh")
  );

  await execFileAsync("bash", ["build.sh", name], { cwd: root });

  const dist = path.join(root, name, "dist");
  const zip = fs.readdirSync(dist).find((file) => /-firefox-v.+\.zip$/.test(file));
  const packageDir = path.join(root, "firefox");

  await execFileAsync("unzip", ["-q", path.join(dist, zip), "-d", packageDir]);

  return packageDir;
}
