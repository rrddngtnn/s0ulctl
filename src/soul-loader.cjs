const fs = require("fs");

const SOUL_PATH = process.env.S0ULCTL_PATH || "/etc/s0ulctl/soul.md";
const FALLBACK_ENV = process.env.S0ULCTL_FALLBACK || "You are a helpful assistant.";

let cached = null;
let lastErr = null;

function read() {
  try {
    const st = fs.statSync(SOUL_PATH);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.content;
    const content = fs.readFileSync(SOUL_PATH, "utf8").trim();
    if (!content) {
      if (lastErr !== "empty") {
        console.warn("[s0ulctl] soul.md is empty, using fallback");
        lastErr = "empty";
      }
      return FALLBACK_ENV;
    }
    cached = { mtimeMs: st.mtimeMs, content };
    lastErr = null;
    console.log(`[s0ulctl] loaded ${content.length} chars from ${SOUL_PATH}`);
    return content;
  } catch (e) {
    const msg = (e && e.code) || String(e);
    if (lastErr !== msg) {
      console.warn(`[s0ulctl] read failed (${msg}), using fallback`);
      lastErr = msg;
    }
    return FALLBACK_ENV;
  }
}

function install() {
  if (typeof globalThis.__s0ulctl === "function") return;
  globalThis.__s0ulctl = read;
  try { read(); } catch {}
  console.log("[s0ulctl] global.__s0ulctl installed");
}

module.exports = { install, read, SOUL_PATH };
