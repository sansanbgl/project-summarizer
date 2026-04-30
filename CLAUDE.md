# CLAUDE.md

This file gives Claude context and working conventions for this repository.

## Project Purpose

`project-summarizer` pulls commit activity from many local git repositories and generates AI summaries.

High-level flow:
1. Read project list from `projects.json`.
2. Collect git logs/stat output per project into `reports_raw/YYYY-MM-DD/*.txt`.
3. Summarize activity with a selected provider into `reports/YYYY-MM-DD-<provider>/*.md`.
4. Build a combined `README.md` report.

## Tech Stack

- Runtime: Node.js (ES modules, `type: module`)
- Main scripts:
  - `pull.js`: git pull across configured projects
  - `summarize.js`: collect logs and/or run AI summaries
- AI SDKs:
  - `@google/generative-ai`
  - `@anthropic-ai/sdk`
  - `openai` (used for OpenAI, OpenRouter, and Groq-compatible APIs)

## Important Files

- `projects.json`: source of projects and local paths (`~/Sites/...` format is supported)
- `pull.js`: batch git pull utility
- `summarize.js`: end-to-end summarization logic
- `pull_and_summarize_7days.sh`: pull + raw + OpenRouter summarize pipeline
- `pull_and_summarize_7days_google.sh`: Google-oriented pipeline (currently only AI step active)
- `pull_and_summarize_7days_groq.sh`: Groq-oriented pipeline (currently only AI step active)
- `reports_raw/`: raw git data snapshots
- `reports/`: generated markdown summaries
- `open-router.key`, `google.key`, `groq.key`: optional local key files loaded by scripts

## Common Commands

Install dependencies:

```bash
npm install
```

Pull all repositories listed in `projects.json`:

```bash
node pull.js
```

Pull with rebase:

```bash
node pull.js --rebase
```

Collect raw logs only (last 7 days):

```bash
node summarize.js --days 7 --raw-only
```

Summarize from latest raw logs with OpenRouter:

```bash
node summarize.js --ai-only --provider openrouter
```

Summarize with Google and enforce slower pacing:

```bash
node summarize.js --provider google --google-delay 9000
```

Single combined summary across all active projects:

```bash
node summarize.js --single-summary
```

OpenRouter pipeline script:

```bash
sh pull_and_summarize_7days.sh
```

## Providers and Key Resolution

Provider selection in `summarize.js`:

- If `--provider <name>` is passed, that provider is used.
- Otherwise auto-detect order is effectively:
  1. OpenRouter if `OPENROUTER_API_KEY` exists
  2. First available among Google/Anthropic/OpenAI/Groq env keys
  3. Fallback to local Ollama

Key loading behavior:

- `summarize.js` can load `open-router.key` and `groq.key` automatically when env vars are absent.
- Google key file loading is done in `pull_and_summarize_7days_google.sh`, not in `summarize.js`.

## Output Structure

Raw data:

- `reports_raw/YYYY-MM-DD/<project>.txt`

AI summaries:

- `reports/YYYY-MM-DD-<provider>/<project>.md`
- `reports/YYYY-MM-DD-<provider>/README.md`

Modes:

- Default mode: one AI call per active project + combined README.
- `--single-summary`: one AI call for all active projects; only combined README is generated.
- `--raw-only`: skip AI.
- `--ai-only`: skip git collection, summarize existing raw data.

## Editing Guidance for Claude

When modifying this repo, preserve these conventions:

- Keep scripts runnable from repo root with `node <script>.js`.
- Preserve plain, dependency-light shell scripts (`#!/usr/bin/env sh`, minimal assumptions).
- Keep report directories and naming stable (`reports_raw/<date>`, `reports/<date-provider>`).
- Avoid changing prompt/output shape unless explicitly requested; users likely depend on current report format.
- Keep retry/rate-limit behavior intact unless fixing a clear bug.
- Maintain compatibility with `projects.json` `~/` path expansion.

## Safety and Secrets

- Never print or commit API keys.
- Treat `*.key` files as secrets.
- Do not embed credentials in code, logs, or markdown reports.

## Known Caveats

- `pull_and_summarize_7days_google.sh` and `pull_and_summarize_7days_groq.sh` currently echo a pull step but do not run `node pull.js`.
- In those same scripts, raw collection step is commented out; they depend on existing raw reports for today unless manually collected.

## If You Need To Extend Functionality

Preferred extension points:

- Add CLI flags in `parseArgs()` in `summarize.js`.
- Add provider integrations via the `PROVIDERS` map (`build` + `summarize`).
- Keep new report formats additive; avoid breaking existing README layout.
- For new pipeline scripts, follow existing 3-phase flow naming: pull -> raw -> summarize.
