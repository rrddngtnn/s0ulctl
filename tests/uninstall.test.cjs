"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SRC = path.join(__dirname, "..", "src");

const PERSONAS = [
  'var a="You are CodeBuddy Code.";',
  'var b="You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";',
  'var c="You are a helpful AI assistant that helps with software engineering tasks.";',
];

function fakeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s0ulctl-uni-"));
  const app = path.join(root, "9router", "app");
  const chunks = path.join(app, ".next-cli-build", "server", "chunks");
  fs.mkdirSync(chunks, { recursive: true });

  fs.writeFileSync(
    path.join(app, "custom-server.js"),
    'const { pathToFileURL } = require("url");\nstart();\n',
  );
  PERSONAS.forEach((src, i) => {
    fs.writeFileSync(path.join(chunks, `${1000 * (i + 1)}.js`), src + "\n");
  });

  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 1\n");
  fs.writeFileSync(path.join(bin, "which"), "#!/bin/sh\nexit 1\n");
  fs.chmodSync(path.join(bin, "npm"), 0o755);
  fs.chmodSync(path.join(bin, "which"), 0o755);

  return { root, app, chunks, bin };
}

function env(ctx) {
  return {
    PATH: ctx.bin + ":/usr/bin:/bin",
    HOME: ctx.root,
    S0ULCTL_PATH: path.join(ctx.root, "soul.md"),
    S0ULCTL_APP_DIRS: ctx.app,
    S0ULCTL_HOME_ROOTS: path.join(ctx.root, "empty"),
  };
}

function run(script, ctx, extraArgs) {
  return execFileSync("bash", [path.join(SRC, script)].concat(extraArgs || []), {
    env: env(ctx),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function install(ctx) {
  return run("install.sh", ctx);
}

function uninstall(ctx) {
  return run("uninstall.sh", ctx);
}

test("uninstall restores every patched chunk to its original bytes", () => {
  const ctx = fakeInstall();
  install(ctx);
  uninstall(ctx);

  ["1000.js", "2000.js", "3000.js"].forEach((name, i) => {
    const now = fs.readFileSync(path.join(ctx.chunks, name), "utf8").trim();
    assert.strictEqual(now, PERSONAS[i], name + " should be byte-identical");
    assert.ok(!now.includes("__s0ulctl"), name + " must not stay patched");
  });
});

test("uninstall removes the .bak-s0ulctl siblings after restoring", () => {
  const ctx = fakeInstall();
  install(ctx);
  uninstall(ctx);

  const leftovers = fs.readdirSync(ctx.chunks).filter((f) => f.endsWith(".bak-s0ulctl"));
  assert.deepStrictEqual(leftovers, [], "no backups should remain");
});

test("uninstall removes soul-loader.cjs from the app directory", () => {
  const ctx = fakeInstall();
  install(ctx);
  assert.ok(fs.existsSync(path.join(ctx.app, "soul-loader.cjs")));

  uninstall(ctx);
  assert.ok(!fs.existsSync(path.join(ctx.app, "soul-loader.cjs")));
});

test("uninstall restores custom-server.js and removes the loader require", () => {
  const ctx = fakeInstall();
  const cs = path.join(ctx.app, "custom-server.js");
  const original = fs.readFileSync(cs, "utf8");

  install(ctx);
  assert.match(fs.readFileSync(cs, "utf8"), /soul-loader/);

  uninstall(ctx);
  const restored = fs.readFileSync(cs, "utf8");
  assert.strictEqual(restored, original);
  assert.ok(!restored.includes("soul-loader"));
});

test("install then uninstall is a round trip: repo state is unchanged", () => {
  const ctx = fakeInstall();
  const snapshot = () =>
    fs
      .readdirSync(ctx.chunks)
      .sort()
      .map((f) => f + ":" + fs.readFileSync(path.join(ctx.chunks, f), "utf8"))
      .join("\n");

  const before = snapshot();
  install(ctx);
  assert.notStrictEqual(snapshot(), before, "install should change something");
  uninstall(ctx);
  assert.strictEqual(snapshot(), before, "uninstall should return to the start");
});

test("uninstall is safe to run when nothing was installed", () => {
  const ctx = fakeInstall();
  assert.doesNotThrow(() => uninstall(ctx));
  // chunks untouched
  ["1000.js", "2000.js", "3000.js"].forEach((name, i) => {
    const now = fs.readFileSync(path.join(ctx.chunks, name), "utf8").trim();
    assert.strictEqual(now, PERSONAS[i]);
  });
});

test("uninstall is idempotent: a second run changes nothing", () => {
  const ctx = fakeInstall();
  install(ctx);
  uninstall(ctx);
  const afterFirst = fs.readFileSync(path.join(ctx.chunks, "1000.js"), "utf8");

  assert.doesNotThrow(() => uninstall(ctx));
  const afterSecond = fs.readFileSync(path.join(ctx.chunks, "1000.js"), "utf8");
  assert.strictEqual(afterSecond, afterFirst);
});

test("uninstall leaves an unrelated .bak file alone", () => {
  const ctx = fakeInstall();
  install(ctx);
  const stray = path.join(ctx.app, "custom-server.js.bak-19700101000000");
  fs.writeFileSync(stray, "// unrelated backup\n");

  uninstall(ctx);
  assert.ok(fs.existsSync(stray), "must not delete backups it did not create");
});
