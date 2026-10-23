"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loader = require("../src/soul-loader.cjs");

function tmpSoul(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s0ulctl-"));
  const p = path.join(dir, "soul.md");
  if (content !== undefined) fs.writeFileSync(p, content);
  return { dir, path: p };
}

function quiet(fn) {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

test("returns file content when soul.md exists", () => {
  const { path: p } = tmpSoul("You are RED.\n");
  const l = loader.createLoader({ path: p });
  assert.strictEqual(quiet(() => l.read()), "You are RED.");
});

test("trims surrounding whitespace", () => {
  const { path: p } = tmpSoul("\n\n  You are RED.  \n\n");
  const l = loader.createLoader({ path: p });
  assert.strictEqual(quiet(() => l.read()), "You are RED.");
});

test("falls back when the file is missing", () => {
  const { path: p } = tmpSoul(undefined);
  const l = loader.createLoader({ path: p, fallback: "FALLBACK" });
  assert.strictEqual(quiet(() => l.read()), "FALLBACK");
});

test("falls back when the file is empty", () => {
  const { path: p } = tmpSoul("");
  const l = loader.createLoader({ path: p, fallback: "FALLBACK" });
  assert.strictEqual(quiet(() => l.read()), "FALLBACK");
});

test("falls back when the file is only whitespace", () => {
  const { path: p } = tmpSoul("   \n\t\n");
  const l = loader.createLoader({ path: p, fallback: "FALLBACK" });
  assert.strictEqual(quiet(() => l.read()), "FALLBACK");
});

test("caches by mtime and does not re-read an unchanged file", () => {
  const { path: p } = tmpSoul("first");
  const l = loader.createLoader({ path: p });
  quiet(() => l.read());

  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function () {
    reads += 1;
    return original.apply(fs, arguments);
  };
  try {
    quiet(() => l.read());
    quiet(() => l.read());
  } finally {
    fs.readFileSync = original;
  }
  assert.strictEqual(reads, 0, "unchanged file should come from cache");
});

test("re-reads when mtime changes", () => {
  const { path: p } = tmpSoul("first");
  const l = loader.createLoader({ path: p });
  assert.strictEqual(quiet(() => l.read()), "first");

  fs.writeFileSync(p, "second");
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(p, future, future);

  assert.strictEqual(quiet(() => l.read()), "second");
});

test("keeps serving the cache after the file is deleted", () => {
  const { path: p } = tmpSoul("survives");
  const l = loader.createLoader({ path: p, fallback: "FALLBACK" });
  assert.strictEqual(quiet(() => l.read()), "survives");

  fs.unlinkSync(p);
  assert.strictEqual(quiet(() => l.read()), "FALLBACK");
});

test("reset() forces the next read to hit disk", () => {
  const { path: p } = tmpSoul("first");
  const l = loader.createLoader({ path: p });
  assert.strictEqual(quiet(() => l.read()), "first");

  // Freeze mtime so the cache cannot be invalidated by the write itself.
  const frozen = fs.statSync(p).mtimeMs;
  const realStat = fs.statSync;
  fs.statSync = function (target) {
    const st = realStat.apply(fs, arguments);
    if (target === p) st.mtimeMs = frozen;
    return st;
  };
  try {
    fs.writeFileSync(p, "second");
    assert.strictEqual(quiet(() => l.read()), "first", "still cached");
    l.reset();
    assert.strictEqual(quiet(() => l.read()), "second", "cache dropped");
  } finally {
    fs.statSync = realStat;
  }
});

test("resolvePath prefers the explicit option over the environment", () => {
  const prev = process.env.S0ULCTL_PATH;
  process.env.S0ULCTL_PATH = "/from/env";
  try {
    const l = loader.createLoader({ path: "/explicit" });
    assert.strictEqual(l.resolvePath(), "/explicit");
  } finally {
    if (prev === undefined) delete process.env.S0ULCTL_PATH;
    else process.env.S0ULCTL_PATH = prev;
  }
});

test("resolvePath falls back to S0ULCTL_PATH", () => {
  const prev = process.env.S0ULCTL_PATH;
  process.env.S0ULCTL_PATH = "/from/env";
  try {
    const l = loader.createLoader({});
    assert.strictEqual(l.resolvePath(), "/from/env");
  } finally {
    if (prev === undefined) delete process.env.S0ULCTL_PATH;
    else process.env.S0ULCTL_PATH = prev;
  }
});

test("resolvePath falls back to the default path", () => {
  const prev = process.env.S0ULCTL_PATH;
  delete process.env.S0ULCTL_PATH;
  try {
    const l = loader.createLoader({});
    assert.strictEqual(l.resolvePath(), loader.DEFAULT_PATH);
  } finally {
    if (prev !== undefined) process.env.S0ULCTL_PATH = prev;
  }
});

test("install() exposes read on globalThis and is idempotent", () => {
  const { path: p } = tmpSoul("global soul");
  const l = loader.createLoader({ path: p });
  loader.uninstall();
  try {
    const fn = quiet(() => loader.install(l));
    assert.strictEqual(typeof fn, "function");
    assert.strictEqual(globalThis.__s0ulctl, fn);

    const again = quiet(() => loader.install(l));
    assert.strictEqual(again, fn, "second install must not replace the first");
  } finally {
    loader.uninstall();
  }
});

test("install() never throws even when the path is unreadable", () => {
  const l = loader.createLoader({ path: "/nonexistent/soul.md", fallback: "F" });
  loader.uninstall();
  try {
    assert.doesNotThrow(() => quiet(() => loader.install(l)));
    assert.strictEqual(globalThis.__s0ulctl(), "F");
  } finally {
    loader.uninstall();
  }
});

test("uninstall() removes the global", () => {
  const { path: p } = tmpSoul("x");
  const l = loader.createLoader({ path: p });
  quiet(() => loader.install(l));
  loader.uninstall();
  assert.strictEqual(globalThis.__s0ulctl, undefined);
});
