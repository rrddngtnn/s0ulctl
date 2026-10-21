# Finding the strings to patch

When 9router updates, the three target strings in `src/install.sh` may change. To find the new ones:

```bash
APP=/path/to/9router/app   # e.g. $(dirname $(readlink -f $(which 9router)))/app
grep -rhoE '"You are [^"]{5,200}"' $APP/.next-cli-build/server/chunks/*.js | sort -u
```

What qualifies as a target: the string is inside a provider adapter's `transformRequest()` method and gets written into `e.messages` as `{role:"system", content: "You are …"}`. For each candidate, dump the surrounding 500 chars and look for that pattern.

What is **not** a target:

- Strings used as rewrite-rule *sources* (the adapter is sanitising a known agent-CLI prompt out of the request before forwarding).
- UI preset strings (e.g. "You are a lazy senior developer…" in the opencode preset UI).
- Strings used by the anonymiser (replacement target, not injection source).

If you want to validate, dump the chunk and `grep -A 20` for the string, then check whether the surrounding code is pushing it into a `messages[]` or using it as a `replace()` input.

## Known chunk

As of 9router 16.3.x the three current targets all live in `.next-cli-build/server/chunks/5330.js`. That filename is minification-derived and may change between major 9router releases.
