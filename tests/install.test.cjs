"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SRC = path.join(__dirname, "..", "src");

/**
 * Build a fake 9router install so install.sh has something real to patch.
 * Mirrors the layout the script expects: custom-server.js with the require
 * anchor, and .next-cli-build/server/chunks/*.js holding the persona strings.
 */
function fakeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s0ulctl-inst-"));
  const app = path.join(root, "9router", "app");
  const chunks = path.join(app, ".next-cli-build", "server", "chunks");
  fs.mkdirSync(chunks, { recursive: true });

  fs.writeFileSync(
    path.join(app, "custom-server.js"),
    'const { pathToFileURL } = require("url");\nstart();\n',
  );

  fs.writeFileSync(
    path.join(chunks, "1000.js"),
    'var a="You are CodeBuddy Code.";module.exports=a;\n',
  );
  fs.writeFileSync(
    path.join(chunks, "2000.js"),
    'var b="You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";\n',
  );
  fs.writeFileSync(
    path.join(chunks, "3000.js"),
    'var c="You are a helpful AI assistant that helps with software engineering tasks.";\n',
  );
  return { root, app, chunks };
}

/**
 * Run install.sh with the fake install as the only discoverable tree.
 * The script scans hardcoded /home paths, so we shadow `npm` and `which`
 * to keep the real machine out of the picture.
 */
function runInstall(root, extraArgs) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 1\n");
  fs.writeFileSync(path.join(bin, "which"), "#!/bin/sh\nexit 1\n");
  fs.chmodSync(path.join(bin, "npm"), 0o755);
  fs.chmodSync(path.join(bin, "which"), 0o755);

  const appDir = path.join(root, "9router", "app");
  const args = [path.join(SRC, "install.sh")].concat(extraArgs || []);
  return execFileSync("bash", args, {
    env: {
      PATH: bin + ":" + process.env.PATH,
      HOME: root,
      S0ULCTL_PATH: path.join(root, "soul.md"),
      S0ULCTL_APP_DIRS: fs.existsSync(path.join(appDir, "custom-server.js")) ? appDir : "",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("install.sh patches the persona strings in every chunk", () => {
  const { root, chunks } = fakeInstall();
  const out = runInstall(root);

  assert.match(out, /patched 1000\.js/);
  const one = fs.readFileSync(path.join(chunks, "1000.js"), "utf8");
  assert.match(one, /globalThis\.__s0ulctl\?\.\(\)\|\|"You are CodeBuddy Code\."/);
});

test("install.sh leaves a .bak-s0ulctl of each patched chunk", () => {
  const { root, chunks } = fakeInstall();
  runInstall(root);

  for (const name of ["1000.js", "2000.js", "3000.js"]) {
    const bak = path.join(chunks, name + ".bak-s0ulctl");
    assert.ok(fs.existsSync(bak), name + " should have a backup");
    const original = fs.readFileSync(bak, "utf8");
    assert.ok(
      original.includes("You are"),
      "backup must hold the unpatched string",
    );
  }
});

test("install.sh wires the loader into custom-server.js", () => {
  const { root, app } = fakeInstall();
  runInstall(root);
  const cs = fs.readFileSync(path.join(app, "custom-server.js"), "utf8");
  assert.match(cs, /require\("\.\/soul-loader\.cjs"\)/);
  assert.match(cs, /s0ul\.install\(\)/);
});

test("install.sh copies soul-loader.cjs next to custom-server.js", () => {
  const { root, app } = fakeInstall();
  runInstall(root);
  assert.ok(fs.existsSync(path.join(app, "soul-loader.cjs")));
});

test("install.sh is idempotent: a second run does not double-patch", () => {
  const { root, chunks } = fakeInstall();
  runInstall(root);
  const afterFirst = fs.readFileSync(path.join(chunks, "1000.js"), "utf8");
  runInstall(root);
  const afterSecond = fs.readFileSync(path.join(chunks, "1000.js"), "utf8");

  assert.strictEqual(afterSecond, afterFirst);
  const occurrences = (afterSecond.match(/__s0ulctl/g) || []).length;
  assert.strictEqual(occurrences, 1, "only one s0ulctl call should exist");
});

test("install.sh keeps the original backup across repeated runs", () => {
  const { root, chunks } = fakeInstall();
  const bak = path.join(chunks, "1000.js.bak-s0ulctl");

  runInstall(root);
  const firstBackup = fs.readFileSync(bak, "utf8");

  runInstall(root);
  const secondBackup = fs.readFileSync(bak, "utf8");

  assert.strictEqual(secondBackup, firstBackup, "backup must not be overwritten");
  assert.ok(
    !secondBackup.includes("__s0ulctl"),
    "backup must stay unpatched",
  );
});

test("install.sh fails loudly when no 9router install exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s0ulctl-none-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 1\n");
  fs.writeFileSync(path.join(bin, "which"), "#!/bin/sh\nexit 1\n");
  fs.chmodSync(path.join(bin, "npm"), 0o755);
  fs.chmodSync(path.join(bin, "which"), 0o755);

  // Empty HOME and no override: the script must not find the real install
  // that happens to exist on the machine running the suite.
  assert.throws(
    () =>
      execFileSync("bash", [path.join(SRC, "install.sh")], {
        env: {
          PATH: bin + ":/usr/bin:/bin",
          HOME: root,
          S0ULCTL_PATH: path.join(root, "soul.md"),
          S0ULCTL_APP_DIRS: "",
          S0ULCTL_HOME_ROOTS: path.join(root, "empty-homes"),
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    (err) => {
      const out = (err.stdout || "") + (err.stderr || "");
      return /no 9router install found/.test(out);
    },
  );
});

test("install.sh refuses a custom-server.js whose anchor is missing", () => {
  const { root, app } = fakeInstall();
  fs.writeFileSync(path.join(app, "custom-server.js"), "start();\n");
  assert.throws(
    () => runInstall(root),
    (err) => {
      const out = (err.stdout || "") + (err.stderr || "");
      return /anchor count = 0/.test(out);
    },
  );
});

test("install.sh reports when no chunk matches the target strings", () => {
  const { root, chunks } = fakeInstall();
  fs.writeFileSync(path.join(chunks, "1000.js"), "var x=1;\n");
  fs.writeFileSync(path.join(chunks, "2000.js"), "var y=2;\n");
  fs.writeFileSync(path.join(chunks, "3000.js"), "var z=3;\n");
  assert.throws(
    () => runInstall(root),
    (err) => {
      const out = (err.stdout || "") + (err.stderr || "");
      return /no chunk matched any target string/.test(out);
    },
  );
});
