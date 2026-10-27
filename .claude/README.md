# Claude Code adapter

`.claude/skills/` is a generated mirror of the canonical project skills in
`../.agents/skills/`. Do not hand-edit the mirror. Use:

```text
python tools/agent_skills/sync_agent_skills.py check
python tools/agent_skills/sync_agent_skills.py sync
```

The synchronization protocol and safe adoption/backup flow are documented in
[`tools/agent_skills/README.md`](../tools/agent_skills/README.md).
