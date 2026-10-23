#!/usr/bin/env node
"use strict";

/**
 * Thin wrapper so `npx s0ulctl install` works. All real work stays in the
 * shell script — this only locates it and forwards argv.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const SRC = path.join(__dirname, "..", "src");
const SCRIPTS = {
  install: path.join(SRC, "install.sh"),
  uninstall: path.join(SRC, "uninstall.sh"),
};

function usage() {
  console.error(
    [
      "s0ulctl — replace 9router's hardcoded system prompts",
      "",
      "usage:",
      "  s0ulctl install [--restart]",
      "  s0ulctl uninstall",
      "",
      "env:",
      "  S0ULCTL_PATH         path to soul.md   (default /etc/s0ulctl/soul.md)",
      "  S0ULCTL_FALLBACK     text when soul.md is missing or empty",
      "  S0ULCTL_APP_DIRS     explicit 9router app dirs to patch",
      "  S0ULCTL_HOME_ROOTS   override the /home/* discovery glob",
    ].join("\n"),
  );
}

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

const script = SCRIPTS[cmd];
if (!script) {
  console.error(`error: unknown command '${cmd}'`);
  usage();
  process.exit(1);
}
if (!fs.existsSync(script)) {
  console.error(`error: ${script} not found — is the package complete?`);
  process.exit(1);
}

const result = spawnSync("bash", [script, ...rest], { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
