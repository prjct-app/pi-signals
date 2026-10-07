## 0.1.1 (2026-10-07)

- Bind the standalone npm CLI to the Pi host's public SDK peers, which Pi intentionally omits from extension installs. Record the host location on session start and use the same bootstrap for scheduled runs.
- Reject repair candidates that changed their base through an agent-created commit before coordinator verification.

## 0.1.0 (2026-10-07)

- Capture latency regressions, crashes and concrete response-quality regressions in global `.prjct/shared/signals/signals.sqlite`, with original evidence, versions and model/reasoning provenance.
- Deduplicate sightings across sessions and subagents; preserve all observations and requeue when new evidence arrives.
- Run daily triage through Pi's public SDK with the originating model and reasoning; distinguish actionable, intermittent and insufficient-evidence findings.
- Prepare isolated repair candidates, replay unchanged regression tests on base and candidate, run package checks and require semantic review before marking a candidate verified.
- Add an npm-shipped worker CLI and a macOS daily scheduler. Capture makes no model requests; unchanged signals do not trigger repeated daily analysis.
- Reuse pi-secrets protection before persistence and model requests. GitHub issues, PR publication and remote merge are outside the local MVP.
