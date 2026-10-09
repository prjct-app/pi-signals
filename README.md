# Pi Signals

Failure signals for Pi: capture locally, triage daily, prepare and verify repairs. The active agent owns detection and semantic decisions. This extension does not use JEV, a classifier, a cheaper replacement model, or an independent context-compaction policy.

## Local MVP

1. `signal_report` records an issue in `${PRJCT_HOME:-~/.prjct}/shared/signals/signals.sqlite`. Categories are `latency`, `crash`, and `response-quality`. Reports include reproduction steps, expected/actual results, exact session evidence, package version and originating model/reasoning. Capture performs no network or generation requests.
2. The daily worker reviews new signals with Pi's public SDK. It chooses `attention`, `flaky`, or `needs_evidence`. Flaky requires mixed results from the same reproduction command. The agent interprets the evidence; a transient error alone is not a diagnosis.
3. When repair is enabled, actionable signals get an isolated Git worktree. A repair candidate must add a new regression test. The coordinator copies those exact test files to the unchanged base, requires the specific failure there three times, requires success on the candidate three times, runs configured package validation and obtains a semantic review with the same model/reasoning. Changed candidates or moved bases are rejected.

The MVP retains verified commits and branches locally. It does **not** create GitHub issues, publish PRs or merge remotely. A verified candidate is not marked resolved. Those external delivery steps require a separately enabled implementation after the MVP scope is settled. Passing these checks provides evidence for a specific defect, not proof of general model intelligence improvement.

## Installation

```sh
pi install npm:@prjct.app/pi-signals@0.1.1
```

Node >=22.19 and Pi >=1.0.4 are required. The CLI is shipped inside the npm package; no source checkout or development loader is required. SDKs are peer dependencies and privacy protection comes from the independent `@prjct.app/pi-secrets` dependency. Existing sessions load the extension on an idle `/reload`; installation does not restart them. On session start the extension records Pi's public SDK location in `host.json` so the standalone CLI uses the host-provided peers. Before the first Pi load, `PI_SIGNALS_SDK_ROOT` can explicitly supply that installed SDK directory.

Pi's private npm bin directory may not be on your shell PATH. In that case use `~/.pi/agent/npm/node_modules/.bin/pi-signals` (adjust for `PI_CODING_AGENT_DIR`). The scheduler records the absolute npm entry point and does not depend on a PATH alias.

## Agent tools and commands

- `signal_report`: select minimal evidence, a stable signature identifying the component and failure mechanism, and one of the three signal categories. The same signature groups repeated sightings; repeated submission of the same session evidence is deduplicated.
- `signal_inspect`: list `targets`, `issues`, or `observations`. Supply `issueId` for persisted issue observations. Pages have explicit continuation offsets; history is never trimmed.
- `/signals`: the docked panel (shared with the other prjct extensions). What needs a fix comes first, then queued, running, flaky and resolved issues, each with its component, status and sightings. Enter shows the triage decision, recent observations and runs; the **Daily triage** row shows the schedule, recent days, repositories and repair setting. `r` queues an issue for triage again. Outside the TUI the same list prints as text.
- `pi-signals status`, `show <id>` and `retry <id>`: inspect or explicitly requeue a signal.
- `pi-signals once`: run queued triage/repair now. `once --scheduled` respects the daily clock and completed-day record.
- `pi-signals schedule install`: install a macOS LaunchAgent using the absolute installed npm CLI path. An hourly OS wake checks the configured timezone; the worker runs once after the configured hour and catches up after sleep/login. There is no resident polling process inside Pi. Other platforms can schedule `once --scheduled` hourly with their OS scheduler.

Native non-cancelled compaction failures are retained as protected session observations. The active agent can inspect and report them. This is not a process-crash monitor: a killed Pi process cannot execute an extension hook. Crash traces discovered by a later session can be reported with their original evidence.

## Global configuration

Only `${PRJCT_HOME:-~/.prjct}/shared/signals/config.json` controls automation. Project files cannot expand its authority. Example:

```json
{
  "enabled": true,
  "hour": 9,
  "minute": 0,
  "timezone": "America/Cancun",
  "repair": true,
  "delivery": "local",
  "packages": ["@prjct.app/"],
  "repositories": {
    "@prjct.app/pi-signals": {
      "path": "/absolute/path/to/pi-signals",
      "base": "main",
      "setup": ["npm ci --ignore-scripts --no-audit --no-fund"],
      "tests": ["npm run check", "npm test", "npm run build"]
    }
  }
}
```

The checkout is repair input, not how the extension is installed. The original checkout is left untouched; worktrees, worker sessions and run evidence live under the global signals directory. Repository bindings and their commands are trusted operator configuration. Workers need real commands to verify a fix; `bash` is not a security sandbox. Repair defaults off until bindings and validation commands are configured. Missing bindings/models, failed tests or insufficient evidence retain a visible blocked/pending signal instead of guessing a substitute or claiming success.

The originating provider/model/reasoning are used for triage, repair and review. Signals without model provenance use Pi's configured default. Effective native compaction, retry and thinking-budget settings are preserved. By default the worker admits pi-secrets, pi-context-control and pi-self-compact; add provider extensions explicitly through `workerPackages` if needed. It does not load unrelated ambient project extensions.

Triage is serial. Unchanged reviewed signals are not sent to a model every day; new evidence requeues them. Flaky and insufficient-evidence findings remain stored and can be retried explicitly. A shared SQLite lease prevents concurrent workers; stale workers cannot overwrite decisions. Interrupted runs retain evidence and can recover. No issue history or original conversation is silently deleted.

## Evidence and privacy

Reports must quote current-branch evidence exactly. A claim of reproduction requires actual tool output or a native SDK observation. Author language and original session history remain intact. Workspace/home paths and recognized secrets are protected before report persistence; privacy failure saves no draft. Stored reports and validation results are protected again before model use. Never include unrelated private source or user data in a signal.

Latency needs comparable workloads, repeated measurements and environmental context. Crashes need a trigger plus stack/exit evidence. Response-quality regressions need specific original constraints and expected versus observed behavior with a controlled baseline. A small deterministic fixture does not establish a general quality gain.

## Subagents and validation

With `@prjct.app/pi-subagents` >=0.5.5, explicitly add `@prjct.app/pi-signals` to its global `extensionPackages`, preserving the other packages. All admitted child roles can record signals while keeping their existing file/command boundaries and model/reasoning. They share the global database for deduplication.

Run `npm run check`, `npm test`, `npm run build`, and `npm run check:package`. Tests isolate credentials/state and use offline model fixtures. Validate the installed host with the other extensions and both child runners before releasing.
