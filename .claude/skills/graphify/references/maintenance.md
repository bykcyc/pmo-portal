# Graph maintenance

Load this reference only when the user explicitly requests graph maintenance or
when an applicable project policy requires an update after verified code
changes. Maintenance modifies generated artifacts; it is not part of a
read-only architecture query.

## Incremental update

Before updating:

1. Confirm the workspace root and graph scope.
2. Confirm that the source changes are intentional and tests appropriate to
   those changes have completed.
3. Confirm that the update will not include secrets, generated dependencies,
   client adapters, or other excluded material.

Then run the project's configured incremental command:

```text
graphify update .
```

After it completes, run the freshness guard again and make one narrow query or
source check to verify that the expected area is represented. Report the files
and graph artifacts changed by the update.

## Clean rebaseline

Use a clean rebaseline instead of an incremental update when the graph contains
orphaned source paths, duplicate legacy nodes, a changed scan root, materially
changed ignore rules, or a Graphify version change that alters extraction.

A rebaseline needs explicit approval because it can replace generated outputs.
Before running it:

1. Inspect the current Graphify CLI help and project conventions for the
   installed version's full-rebuild command.
2. Confirm the exact scan root and exclusions.
3. Preserve or review existing graph artifacts according to project policy;
   never delete them blindly from this skill.
4. Run the approved rebuild, then repeat the freshness guard.

Do not guess a version-specific full-build command. If the installed CLI does
not document a safe rebaseline path, report the blocker rather than inventing a
command.

## Explicit exclusions

This skill does not install Graphify, configure an MCP server, create hooks or
watchers, fetch remote repositories, or modify ignore rules. Those are separate
environment or repository-configuration changes that require their own scope
and authorization.
