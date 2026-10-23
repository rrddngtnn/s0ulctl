const fs = require("fs");

const DEFAULT_PATH = "/etc/s0ulctl/soul.md";
const DEFAULT_FALLBACK = "You are a helpful assistant.";

/**
 * Build a loader bound to one path.
 *
 * Path and fallback are resolved at call time, not at module load, so a
 * host can change S0ULCTL_PATH between require() and first use, and tests
 * can point at a temp file without touching the environment.
 */
function createLoader(opts) {
  const options = opts || {};
  const path = options.path;
  const fallback = options.fallback;

  let cached = null;
  let lastErr = null;

  function resolvePath() {
    return path || process.env.S0ULCTL_PATH || DEFAULT_PATH;
  }

  function resolveFallback() {
    return fallback || process.env.S0ULCTL_FALLBACK || DEFAULT_FALLBACK;
  }

  function read() {
    const soulPath = resolvePath();
    try {
      const st = fs.statSync(soulPath);
      if (cached && cached.mtimeMs === st.mtimeMs) return cached.content;

      const content = fs.readFileSync(soulPath, "utf8").trim();
      if (!content) {
        if (lastErr !== "empty") {
          console.warn("[s0ulctl] soul.md is empty, using fallback");
          lastErr = "empty";
        }
        return resolveFallback();
      }

      cached = { mtimeMs: st.mtimeMs, content };
      lastErr = null;
      console.log(`[s0ulctl] loaded ${content.length} chars from ${soulPath}`);
      return content;
    } catch (e) {
      const msg = (e && e.code) || String(e);
      if (lastErr !== msg) {
        console.warn(`[s0ulctl] read failed (${msg}), using fallback`);
        lastErr = msg;
      }
      return resolveFallback();
    }
  }

  /** Drop the cache. Tests use it; a host can use it after an out-of-band edit. */
  function reset() {
    cached = null;
    lastErr = null;
  }

  return { read, reset, resolvePath };
}

const defaultLoader = createLoader();

function install(loader) {
  const l = loader || defaultLoader;
  if (typeof globalThis.__s0ulctl === "function") return globalThis.__s0ulctl;
  globalThis.__s0ulctl = l.read;
  try {
    l.read();
  } catch (e) {
    /* install must never throw into the host process */
  }
  console.log("[s0ulctl] global.__s0ulctl installed");
  return globalThis.__s0ulctl;
}

function uninstall() {
  delete globalThis.__s0ulctl;
}

module.exports = {
  install,
  uninstall,
  read: defaultLoader.read,
  reset: defaultLoader.reset,
  createLoader,
  DEFAULT_PATH,
  DEFAULT_FALLBACK,
};
