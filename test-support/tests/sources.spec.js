import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";


/*
 * The repository's lint, since it has no package.json for ESLint: every
 * file is read as text and checked against the rules below. Shipped
 * files are what build.sh packages, src/ and options/ of each
 * extension; test files are the extensions' tests/ and test-support/.
 */
const ROOT = path.resolve(__dirname, "../..");

const THIS_FILE = path.relative(ROOT, __filename);

const SKIPPED_DIRECTORIES = new Set([".git", "dist", "node_modules", "test-results"]);


const RULES = [
  {
    name: "suppression comment",
    kinds: ["shipped js", "test js", "script"],
    pattern: /eslint-disable|shellcheck\s+disable|@ts-(?:ignore|nocheck|expect-error)|(?:istanbul|c8)\s+ignore/
  },
  {
    name: "skipped or expected-to-fail test",
    kinds: ["test js"],
    pattern: /\btest(?:\.describe)?\.(?:skip|fail|fixme|only)\(/
  },
  {
    name: "fixed wait",
    kinds: ["test js"],
    pattern: /\bwaitForTimeout\(/
  },
  {
    name: "HTML from a string",
    kinds: ["shipped js"],
    pattern: /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(/
  },
  {
    name: "code from a string",
    kinds: ["shipped js"],
    pattern: /\beval\(|\bnew Function\(/
  },
  {
    name: "blocking dialog",
    kinds: ["shipped js"],
    pattern: /(?<![\w.])(?:alert|confirm|prompt)\(/
  },
  {
    name: "var declaration",
    kinds: ["shipped js"],
    pattern: /^\s*var\s/
  },
  {
    name: "console.log",
    kinds: ["shipped js"],
    pattern: /\bconsole\.log\(/
  },
  {
    name: "event handler property",
    kinds: ["shipped js"],
    pattern: /\.on[a-z]+\s*=(?!=)/
  },
  {
    name: "inline style or event handler attribute",
    kinds: ["shipped html"],
    pattern: /\s(?:style|on[a-z]+)=["']/
  },
  {
    name: "inline script",
    kinds: ["shipped html"],
    pattern: /<script(?![^>]*\ssrc=)[^>]*>/
  },
  {
    // Each package names the APIs as its browser does, through extension-api.js.
    name: "extension API outside extension-api.js",
    kinds: ["shipped js"],
    pattern: /\b(?:chrome|browser)\.[A-Za-z]/,
    appliesTo: (file) => {
      const [extension] = file.split(path.sep);

      return (
        fs.existsSync(path.join(ROOT, extension, "manifest-firefox.json")) &&
        !/^extension-api(?:-firefox)?\.js$/.test(path.basename(file))
      );
    }
  },
  {
    // Allowed when a comment on its line, or one of the three above, says why.
    name: "unexplained empty catch",
    kinds: ["shipped js", "test js"],
    pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/,
    allowed: (lines, index) => {
      return lines
        .slice(Math.max(0, index - 3), index + 1)
        .some((line) => /\/\/|\/\*|^\s*\*/.test(line));
    }
  }
];


function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) || entry.name.endsWith("-snapshots")
        ? []
        : walk(file);
    }

    return [path.relative(ROOT, file)];
  });
}


// Every directory with a manifest.json is an extension.
const EXTENSIONS = fs.readdirSync(ROOT).filter((name) => {
  return fs.existsSync(path.join(ROOT, name, "manifest.json"));
});


function kindOf(file) {
  const [top, folder] = file.split(path.sep);
  const extension = path.extname(file);

  if (EXTENSIONS.includes(top) && ["src", "options"].includes(folder)) {
    return { ".js": "shipped js", ".html": "shipped html" }[extension];
  }

  if (
    extension === ".js" &&
    ((EXTENSIONS.includes(top) && folder === "tests") || top === "test-support")
  ) {
    return "test js";
  }

  return extension === ".sh" ? "script" : undefined;
}


const FILES = walk(ROOT)
  .filter((file) => file !== THIS_FILE)
  .map((file) => ({ file, kind: kindOf(file) }))
  .filter(({ kind }) => kind);


// { "<file>": ["<rule>", ...] } for every rule a file breaks, with the lines.
function findViolations() {
  const found = {};

  for (const { file, kind } of FILES) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");

    const rules = RULES.filter(({ kinds, appliesTo }) => {
      return kinds.includes(kind) && (appliesTo?.(file) ?? true);
    });

    for (const rule of rules) {
      const lineNumbers = lines.flatMap((line, index) => {
        return rule.pattern.test(line) && !rule.allowed?.(lines, index)
          ? [index + 1]
          : [];
      });

      if (lineNumbers.length > 0) {
        (found[file] ??= {})[rule.name] = lineNumbers;
      }
    }
  }

  return found;
}


test("the scan finds every kind of file", () => {
  const kinds = new Set(FILES.map(({ kind }) => kind));

  expect([...kinds].sort()).toEqual(["script", "shipped html", "shipped js", "test js"]);
  expect(EXTENSIONS.length).toBeGreaterThan(0);
});


test("no file breaks a rule", () => {
  const found = Object.entries(findViolations()).flatMap(([file, rules]) => {
    return Object.entries(rules).map(([rule, lineNumbers]) => {
      return `${file}:${lineNumbers.join(",")}: ${rule}`;
    });
  });

  expect(found).toEqual([]);
});


test("every shipped script parses", () => {
  const failures = FILES
    .filter(({ kind }) => kind === "shipped js")
    .flatMap(({ file }) => {
      try {
        execFileSync(process.execPath, ["--check", path.join(ROOT, file)], {
          stdio: "pipe"
        });

        return [];
      } catch (error) {
        return [`${file}: ${error.stderr}`];
      }
    });

  expect(failures).toEqual([]);
});
