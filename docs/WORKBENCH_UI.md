# Recallant Workbench UI

The Workbench is organized around the question a project owner is trying to answer, rather than
around database or graph implementation details.

## Start at Home

The default page is **Home**. It shows the current project, recording status, the next useful
action, a short attention list, and recent activity. The first screen should answer:

- Is Recallant recording?
- Does anything need my decision?
- Where do I go next?

Use **Switch project** in the header to choose another connected project. Project cards show a
human-readable name, source count, and memory count; technical identifiers are intentionally kept
out of the first decision. When no project is selected, the chooser keeps the requested destination
visible (for example, **Ask & Search**) and each project card opens directly in that destination.

## Five primary destinations

- **Home** — orientation and next action.
- **Ask & Search** — ask Recallant a question or search memories with ordinary words. Search
  results link to Review so provenance and decision history remain one click away.
- **Review** — decide what becomes usable memory, what is rejected or archived, and which possible
  conflicts need resolution.
- **Sources** — see which inputs are ready to cite, need setup, or need attention; attach or
  detach a source from the selected project.
- **Activity** — inspect the recording flow, memory writes, checkpoints, and source-linked events.

**Settings** and **Diagnostics** are secondary destinations. They are available from **More** so
the everyday path stays short.

## Review without the graph overload

Review starts with a decision guide, summary counts, and four lanes:

1. Imported evidence
2. Needs your decision
3. Possible conflicts
4. Active rules

Graph candidates, topology, maintenance, and migration evidence remain available under **Advanced
graph review** or **Imported migration details**. These panels preserve the governed graph actions
without forcing every owner to understand graph internals before completing ordinary review.
Large review queues stay collapsed until you choose a lane, so a busy project does not turn the
first Review screen into an endless card list.

## Sources without the map-first trap

Sources starts with health counts, source filtering, connected source cards, and **Add a source**.
The **Open source map** disclosure contains the Memory Tree, provenance legend, and topology view
for owners who need that context.

## Safety and technical detail

Risky operations stay separate from normal work:

- project removal and purge start with a dry-run;
- **Forget forever** redacts Recallant-controlled records only and requires confirmation;
- settings that affect cost or capture behavior may require confirmation;
- remote credentials remain scoped and confirmation-gated.

Technical values, project identifiers, exact paths, and credential material remain behind explicit
technical details or governed result states. They are not the first thing a non-technical user
sees.

## Keyboard and mobile behavior

Primary buttons, links, form controls, and disclosure summaries use comfortable touch targets and
visible keyboard focus. The five primary destinations wrap on small screens, long source names and
memory text wrap instead of creating horizontal scroll, and advanced panels remain collapsible.

For contributors changing the Workbench, run the focused UI smoke and browser checks:

```bash
npm run review-ui:smoke
npm run review-ui:playwright
```
