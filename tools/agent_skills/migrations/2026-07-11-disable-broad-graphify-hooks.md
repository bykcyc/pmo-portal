# Migration: disable broad Graphify hooks

The previous project hook payload is preserved in
`2026-07-11-broad-graphify-hooks.json`.

It was removed from both active client configurations because it invoked
POSIX-only shell constructs (`python3`, `case`, `[ ... ]`) and injected a
Graphify reminder for nearly every source read, glob, or broad shell search.
The former byte-level SHA-256 values were:

```text
.claude/settings.json  A83C2B5A5A4749C15E2FC05A9FB75B54181DB4EE3057FADFC8A26CE1F28B693D
.codex/hooks.json      C75AFF142FF643B1F37CC61B78C70D2D7151A7CC71911275F44ADC73D1FBD957
```

The only byte difference between the two legacy files was the terminal line
ending. Their JSON payload was otherwise identical to the preserved file.

The active configurations now use an empty hook registry. This is deliberate:
portable skills provide routing and the optional
`../graphify_pretool_hint.py` can be explicitly adopted by a client after its
hook contract is verified. No user permission, MCP, credential, or unrelated
configuration value was removed.
