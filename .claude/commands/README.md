# `.claude/commands/`

Home for the ticket-workflow slash commands.

The command definitions themselves (`start-ticket`, `research`, `plan`,
`implement`, `verify`) are **created in later phases**. This directory is
reserved during the infrastructure phase so the workflow has a stable location
to grow into.

Each command, when added, will operate on a ticket workspace under
`_specs/<ticket>/` and produce the corresponding artifact from
[`_specs/_templates/`](../../_specs/_templates). See
[`_specs/README.md`](../../_specs/README.md) for the full workflow definition.
