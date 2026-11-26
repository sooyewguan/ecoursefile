## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `sooyewguan/ecoursefile`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## UI

The UI is stock shadcn/ui and Tailwind only.

- Find components, blocks and examples with the shadcn MCP server (`.mcp.json`) or `npx shadcn search`, `view` and `docs`. Add them with `npx shadcn add <name>`.
- Never edit `src/components/ui/` or the theme in `src/index.css`. Style with Tailwind classes at the call site. Use a stock variant before reaching for classes.
- Write no custom CSS, theme variables or hand-built copies of a shadcn component.
- `npm run ui:check` fails when a file in `src/components/ui/` differs from the registry. CI runs it.

