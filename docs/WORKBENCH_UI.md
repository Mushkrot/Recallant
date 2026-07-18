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
human-readable name, recording state, and last activity; technical identifiers and counters are
intentionally kept out of the first decision. Recallant remembers the last valid project in a
signed browser preference, so `/review` returns to that project's Home. Invalid, stale, or
unauthorized project preferences fall back safely to an available project.

The chooser is an explicit switching surface rather than the default landing page:

- search by project name;
- keep frequently used projects in **Favorites**;
- see at most four favorite or recent cards at once;
- open the remaining inventory from **All other projects**;
- expand **Technical details** only when source, session, memory, or event counts are needed.

The chooser keeps the requested destination visible (for example, **Ask & Search**) and opens the
selected project directly in that destination. If no project is connected, it shows one onboarding
step: run `recallant connect .` in the project folder.

## Five primary destinations

- **Home** — orientation and next action.
- **Ask & Search** — ask Recallant a question or search memories with ordinary words. Search
  results link to Review so provenance and decision history remain one click away.
- **Review** — decide what becomes usable memory, what is rejected or archived, and which possible
  conflicts need resolution.
- **Sources** — see which inputs are ready to cite, need setup, or need attention; attach or
  detach a source from the selected project.
- **Activity** — replay what agents did, inspect errors and recovery, and see whether capture is
  complete.

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

## Agent activity without raw-log overload

Activity opens on **Runs**, a bounded list of recent agent runs rather than a stream of every
technical event. Each row summarizes status, client, last activity, and capture completeness. Pick a
run, then use:

- **Replay** for the chronological prompt, visible response, tool, error, retry, remediation, and
  verification story;
- **Errors** for grouped failure patterns, affected runs, and the observed error → retry →
  remediation → verification chain, including whether each link was automatic or explicit;
- **Coverage** for missing prompt/response pairs, missing tool results, run sequence gaps,
  unresolved errors, adapter activity, and independent OpenTelemetry agreement/gaps.

Technical identifiers and redacted metadata stay inside collapsed details. The older memory-write,
checkpoint, and source-event stream remains available under **Memory recording history**, also
collapsed by default. Empty and partially instrumented projects explain what evidence is absent
instead of showing a misleading success state.

See [Agent observability](AGENT_OBSERVABILITY.md) for the capture, completeness, retention, and
privacy contract.

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
visible keyboard focus. Project search and selection work by keyboard, project names wrap without
horizontal scroll, and the full project inventory stays collapsed by default. The five primary
destinations wrap on small screens, long source names and memory text wrap instead of creating
horizontal scroll, and advanced panels remain collapsible.

For contributors changing the Workbench, run the focused UI smoke and browser checks:

```bash
npm run review-ui:smoke
npm run review-ui:playwright
```
