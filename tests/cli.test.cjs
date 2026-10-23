"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "..", "bin", "s0ulctl.js");
const SRC = path.join(__dirname, "..", "src");

/** A fake install plus a fake `sudo` that records what it was asked to run. */
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s0ulctl-cli-"));
  const app = path.join(root, "9router", "app");
  const chunks = path.join(app, ".next-cli-build", "server", "chunks");
  fs.mkdirSync(chunks, { recursive: true });

  fs.writeFileSync(
    path.join(app, "custom-server.js"),
    'const { pathToFileURL } = require("url");\nstart();\n',
  );
  fs.writeFileSync(path.join(chunks, "1000.js"), 'var a="You are CodeBuddy Code.";\n');

  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ["npm", "which"]) {
    fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 1\n");
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  // Record the argv of any sudo invocation instead of running it.
  const sudoLog = path.join(root, "sudo.log");
  fs.writeFileSync(
    path.join(bin, "sudo"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${sudoLog}\nexit 0\n`,
  );
  fs.chmodSync(path.join(bin, "sudo"), 0o755);

  return {
    root,
    app,
    chunks,
    bin,
    sudoLog,
    env: {
      PATH: bin + ":/usr/bin:/bin",
      HOME: root,
      S0ULCTL_PATH: path.join(root, "soul.md"),
      S0ULCTL_APP_DIRS: app,
      S0ULCTL_HOME_ROOTS: path.join(root, "empty"),
    },
  };
}

function cli(ctx, args) {
  return spawnSync("node", [CLI].concat(args), {
    env: ctx.env,
    encoding: "utf8",
  });
}

test("--help prints usage and exits 0", () => {
  const ctx = harness();
  const r = cli(ctx, ["--help"]);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /s0ulctl install/);
});

test("no arguments prints usage and exits non-zero", () => {
  const ctx = harness();
  const r = cli(ctx, []);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /usage:/);
});

test("unknown command exits non-zero without touching anything", () => {
  const ctx = harness();
  const r = cli(ctx, ["bogus"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /unknown command/);
  assert.ok(
    !fs.existsSync(path.join(ctx.app, "soul-loader.cjs")),
    "must not install on an unknown command",
  );
});

test("install forwards to install.sh and patches the tree", () => {
  const ctx = harness();
  const r = cli(ctx, ["install"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const patched = fs.readFileSync(path.join(ctx.chunks, "1000.js"), "utf8");
  assert.match(patched, /__s0ulctl/);
});

test("install --restart passes --restart through to the script", () => {
  const ctx = harness();
  const r = cli(ctx, ["install", "--restart"]);
  assert.strictEqual(r.status, 0, r.stderr);

  assert.ok(fs.existsSync(ctx.sudoLog), "sudo should have been invoked");
  const logged = fs.readFileSync(ctx.sudoLog, "utf8");
  assert.match(logged, /systemctl restart 9router\.service/);
});

test("install without --restart never calls sudo", () => {
  const ctx = harness();
  const r = cli(ctx, ["install"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(ctx.sudoLog), "sudo must not run without --restart");
});

test("uninstall forwards to uninstall.sh and restores the tree", () => {
  const ctx = harness();
  cli(ctx, ["install"]);
  const r = cli(ctx, ["uninstall"]);
  assert.strictEqual(r.status, 0, r.stderr);

  const restored = fs.readFileSync(path.join(ctx.chunks, "1000.js"), "utf8").trim();
  assert.strictEqual(restored, 'var a="You are CodeBuddy Code.";');
});

test("a failing script propagates its exit code", () => {
  const ctx = harness();
  fs.rmSync(path.join(ctx.app, "custom-server.js"));
  const r = cli(ctx, ["install"]);
  assert.notStrictEqual(r.status, 0, "install must fail when the app is gone");
});
