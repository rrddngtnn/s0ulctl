# s0ulctl

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-000000?style=flat-square">
  <img alt="target" src="https://img.shields.io/badge/target-9router-6E56CF?style=flat-square">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-node-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="hot-reload" src="https://img.shields.io/badge/soul.md-hot--reload-F7DF1E?style=flat-square">
  <img alt="scope" src="https://img.shields.io/badge/providers-CodeBuddy_|_MiMoCode-FF6B6B?style=flat-square">
</p>

<p align="center">
  Replace the hardcoded upstream system prompts in <a href="https://www.npmjs.com/package/9router">9router</a> with your own markdown file.<br>
  Edit the file &mdash; next request picks it up. No restart. 🔥
</p>

---

Three provider adapters inside 9router wipe the inbound `role:system` message and inject their own identity string before forwarding to the upstream. `s0ulctl` swaps those strings for a call to a loader that reads your `soul.md` from disk, mtime-cached.

## Contents

- [What gets patched](#what-gets-patched)
- [How it flows](#how-it-flows)
- [Requirements](#requirements)
- [Install](#install) &middot; [Verify](#verify) &middot; [Iterate](#iterate)
- [Re-apply after a 9router update](#re-apply-after-a-9router-update) &middot; [Uninstall](#uninstall)
- [Troubleshooting](#troubleshooting)
- [How it works internally](#how-it-works-internally)
- [Example personas](#example-personas) &middot; [Credits](#credits) &middot; [License](#license)

## What gets patched

| Provider | Hardcoded string being replaced |
|---|---|
| `codebuddy-intl` | `"You are CodeBuddy Code."` |
| `codebuddy-cn` (fallback) | `"You are a helpful AI assistant that helps with software engineering tasks."` |
| `xiaomi-mimo` / `mimo-free` | `"You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks."` |

If 9router updates and these strings change, re-grep them from the chunks (see [`docs/discovery.md`](docs/discovery.md)) and update the `targets` list in `src/install.sh`.

## How it flows

A request comes in from the client as a `POST /v1/chat/completions`. 9router routes it to the matching provider adapter, which calls its `transformRequest` hook on the message array before anything is forwarded upstream.

Unpatched, that hook overwrites `messages[0]` with a hardcoded system string — `"You are CodeBuddy Code."` for the CodeBuddy adapters, the MiMoCode string for the Xiaomi ones — and that is what reaches the upstream model.

Patched, the same slot is filled by `globalThis.__s0ulctl()` instead. That call lands in `soul-loader.cjs`, which is `require`d from `custom-server.js` at startup and kept on the global scope. The loader `stat()`s your `soul.md` on every call: if the mtime is unchanged it hands back the cached content, otherwise it does a `readFileSync()` and refreshes the cache. Either way the returned text becomes `messages[0]` and the request goes upstream with your persona in place of the vendor's.

So the request path after patching is: client → 9router → patched chunk (`transformRequest`) → `soul-loader.cjs` → `stat`/read of `soul.md` → upstream → client. The only branch in it is the mtime check inside the loader; nothing else changes between requests.

## Requirements

- Linux host with 9router already installed and running (user process or `9router.service` via systemd).
- `node` on `$PATH`, same major version 9router runs on.
- `python3` on `$PATH` &mdash; used by the installer to rewrite the server chunk and the `custom-server.js` anchor.
- `sudo` if 9router runs under systemd (needed for `systemctl restart` and, depending on your install, for writing into the app directory).

## Install

```bash
git clone https://github.com/<you>/s0ulctl
cd s0ulctl

# drop a persona file at the default path
sudo -S -p '' mkdir -p /etc/s0ulctl
sudo -S -p '' cp examples/coding-assistant.md /etc/s0ulctl/soul.md
# or examples/ratman4080.md, or write your own

# patch every discovered 9router install
bash src/install.sh

# activate
sudo -S -p '' systemctl restart 9router.service
```

To put `soul.md` somewhere else, export `S0ULCTL_PATH=/your/path` before running the installer, and set the same variable in the systemd unit's `Environment=` so the running service sees it.

<details>
<summary><b>✅ Click: what a healthy install run looks like</b></summary>

```
found 9router installs:
  /home/you/.nvm/versions/node/v24.21.0/lib/node_modules/9router/app
  /home/you/.hermes/tools/node-26.7.0-linux-x64/lib/node_modules/9router/app

patching /home/you/.nvm/versions/node/v24.21.0/lib/node_modules/9router/app
  patched 5330.js
  chunks with s0ulctl call: 1

patching /home/you/.hermes/tools/node-26.7.0-linux-x64/lib/node_modules/9router/app
  patched 5330.js
  chunks with s0ulctl call: 1

done. restart 9router to activate: sudo systemctl restart 9router.service
```

</details>

If you run 9router as a plain user process, kill and restart it the usual way.

## Verify

Confirm the loader installed and read your file:

```bash
sudo journalctl -u 9router.service -n 20 --no-pager | grep s0ulctl
```

Expected:

```
[s0ulctl] loaded 423 chars from /etc/s0ulctl/soul.md
[s0ulctl] global.__s0ulctl installed
```

Round-trip through 9router to confirm the string reached the upstream:

```bash
curl -s https://<your-9router-host>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"model":"cbai/glm-5.3-flash","stream":false,
       "messages":[{"role":"user","content":"in one sentence, who are you?"}]}' | jq -r .choices[0].message.content
```

Before / after, with `examples/coding-assistant.md`:

<table>
<tr><th>❌ without s0ulctl</th><th>✅ with s0ulctl</th></tr>
<tr>
<td>

> I am CodeBuddy Code, your AI programming assistant. How can I help you with your coding tasks today?

</td>
<td>

> A direct, concise coding assistant.

</td>
</tr>
</table>

If the response still looks like the left column, the chunk patch did not land on this install &mdash; see [Troubleshooting](#troubleshooting).

## Iterate

Edit `/etc/s0ulctl/soul.md`. The next request picks up the new content:

```bash
sudo nano /etc/s0ulctl/soul.md
# re-run the curl above, no restart needed ♻️
```

The loader `stat()`s the file each call and reloads on mtime change. You will see one `[s0ulctl] loaded N chars …` line in the journal per edit. The soul content itself is never logged.

Swap personas without touching the installer:

```bash
sudo cp examples/ratman4080.md /etc/s0ulctl/soul.md
```

## Re-apply after a 9router update

`npm i -g 9router`, or any other 9router upgrade path, replaces `custom-server.js` and the chunk files. Re-run the installer; it is idempotent and will patch the new copy:

```bash
cd s0ulctl
bash src/install.sh
sudo systemctl restart 9router.service
```

If the installer reports `error: no chunk matched any target string`, the upstream renamed the hardcoded strings. Re-grep them with the recipe in [`docs/discovery.md`](docs/discovery.md) and update the `targets` list in `src/install.sh`.

## Uninstall

```bash
bash src/uninstall.sh
sudo systemctl restart 9router.service
```

This restores `custom-server.js` from its newest `.bak-*` sibling, deletes `soul-loader.cjs` from each app directory, and reverts every patched chunk from its `.bak-s0ulctl` sibling. Your `/etc/s0ulctl/soul.md` is left in place; delete it manually if you want.

## Troubleshooting

<details>
<summary><b><code>error: anchor count = 0 in …/custom-server.js</code></b></summary>

9router changed the require layout in `custom-server.js`. Open the file, find a stable single-occurrence line near the top (an existing `require(...)` works), and update the `anchor = ...` assignment in `src/install.sh`.
</details>

<details>
<summary><b><code>error: no chunk matched any target string</code></b></summary>

9router renamed the hardcoded persona strings. Run the grep from [`docs/discovery.md`](docs/discovery.md), identify the new strings, and update the `targets` list in `src/install.sh`.
</details>

<details>
<summary><b>Journal shows <code>[s0ulctl] read failed (ENOENT)</code></b></summary>

The loader could not find `soul.md`. Either put it at `/etc/s0ulctl/soul.md` or export `S0ULCTL_PATH=/your/path` in the service's environment.
</details>

<details>
<summary><b>Journal shows <code>[s0ulctl] soul.md is empty</code></b></summary>

The file exists but is zero-byte or whitespace. The loader falls back to the original hardcoded string so requests still succeed; put real content in the file to override.
</details>

<details>
<summary><b>Response still shows the generic CodeBuddy identity</b></summary>

The chunk patch did not land on this install, or 9router is being served from a different install than the one you patched.

```bash
# which install is systemd actually running?
systemctl cat 9router.service | grep ExecStart

# which installs got the s0ulctl call?
grep -l globalThis.__s0ulctl \
  /home/*/.nvm/versions/node/*/lib/node_modules/9router/app/.next-cli-build/server/chunks/*.js \
  /home/*/.hermes/tools/node-*/lib/node_modules/9router/app/.next-cli-build/server/chunks/*.js 2>/dev/null
```

Re-run `bash src/install.sh` and read its output to confirm every discovered install was patched.
</details>

<details>
<summary><b>Roll back a single edit without a full uninstall</b></summary>

Every modified file has a `.bak-*` sibling (`custom-server.js.bak-<timestamp>`, `*.js.bak-s0ulctl`). Copy the backup back over the live file and restart.
</details>

## How it works internally

1. `src/soul-loader.cjs` is copied into every 9router app directory and `require`d from `custom-server.js` at startup. It installs `globalThis.__s0ulctl`, which reads `soul.md` on each call with an mtime cache.
2. `src/install.sh` rewrites the hardcoded persona strings inside `.next-cli-build/server/chunks/*.js` from `"You are X."` to `(globalThis.__s0ulctl?.()||"You are X.")`.
   - `?.()` guards the startup race window before `custom-server.js` has installed the loader.
   - `||<original>` is the safety net: if `soul.md` is missing, empty, or unreadable, the chunk falls back to the original string so requests still succeed.
3. Both edits are backed up (`*.bak-*` next to the originals). `src/uninstall.sh` restores them.

<details>
<summary><b>Why multiple 9router installs can exist on one host</b></summary>

Different Node managers each keep their own `node_modules` tree (nvm per-version, Hermes-managed node, global npm). `npm i -g 9router` installs into whichever manager's `global` prefix is active at install time, so hosts that mix managers accumulate copies. systemd picks exactly one of them &mdash; whichever `ExecStart` in `/etc/systemd/system/9router.service` points at. The installer patches every discoverable copy so later `which 9router` resolution shifts don't silently revert the running service.
</details>

## Model notes

The three adapters above are relays &mdash; the real upstream can be any of the models exposed through them (glm-5.3, kimi-k3, deepseek-v4.1-flash, claude-opus-4.6, etc.). How closely each model follows a strongly-worded persona is model-specific; smaller or more aggressively tuned models tend to drift back toward their training defaults. For a working example of a dense persona that most models honour, see [`examples/ratman4080.md`](examples/ratman4080.md).

## Example personas

- [`examples/coding-assistant.md`](examples/coding-assistant.md) &mdash; minimal, generic.
- [`examples/ratman4080.md`](examples/ratman4080.md) &mdash; the `ratman4080` persona by [SeloGPT](https://github.com/SeloGPT/selogpt-prompt-labs), reproduced verbatim. Dense, opinionated, framed as a prompt-engineering research artefact. Credit, context and the full set of related personas live in the upstream repo.

## Credits

The `examples/ratman4080.md` persona was created by [**SeloGPT**](https://github.com/SeloGPT) and originally published in [`selogpt-prompt-labs`](https://github.com/SeloGPT/selogpt-prompt-labs) (file: `Qwen-Manipulasyon.md`). It is included here under the research / prompt-engineering framing established in the upstream repo. If you build on the persona itself, credit SeloGPT.

The `s0ulctl` installer, loader, and chunk-patch mechanism in this repo are independent of SeloGPT's work.

## License

MIT. See [`LICENSE`](LICENSE).
