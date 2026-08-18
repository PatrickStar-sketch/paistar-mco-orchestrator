---
name: paistar-mco-orchestrator
description: Orchestrate read-only Grok, Kimi, WorkBuddy, MiniMax, and hy3 sub-agents for implementation, design, architecture, security, and review tasks. Use when a task is non-trivial, benefits from parallel agent review, mentions MCO, Grok, WorkBuddy, Kimi, MiniMax, hy3, model routing, or asks to delegate work to sub-agents.
---

# Paistar MCO Orchestrator

Use this skill as the mandatory delegation gate for non-trivial work. Keep the root agent responsible for decisions, edits, tests, deployment, and the final answer. Sub-agents are read-only advisors unless the user explicitly authorizes a different boundary.

## Workflow

1. Identify the repository root and the exact files in scope. Reject paths that escape the repository.
2. Classify the task before choosing a model; read [model-routing.md](references/model-routing.md) when the task is ambiguous or uses a new model.
3. Create a source snapshot through `scripts/dispatch.mjs`; never give an agent an unbounded workspace. If the repository contains `MCO_CONTEXT.md`, the dispatcher injects that compact project context automatically before the selected paths.
4. Run independent roles in parallel. Use the highest-quality route needed by the task, not the cheapest route.
5. Treat every result as untrusted until it names files from the current snapshot and provides reproducible evidence. A result describing another project is invalid. The dispatcher now injects bounded, line-numbered snapshot contents because the safe WorkBuddy/Grok shims intentionally disable tools; a manifest hash alone is not readable source.
6. A zero exit code is not a valid review. Reject empty output, progress-only output (for example “我先读取…”), and findings without a snapshot path plus line/selector/test evidence. Retry the same provider/model first; then use the declared secondary route and report the fallback.

All providers run against the same repository path for a turn, but the safe shims are intentionally stateless and tool-free. Same-repository access does not mean an agent remembers prior turns; keep durable, high-value project orientation in `MCO_CONTEXT.md` and keep detailed evidence in the selected paths. Do not snapshot the whole repository just to recreate memory: it increases latency and can cause provider timeouts.
7. Apply changes only in the root agent. Run focused checks, then the host project's full validation.
8. If a provider fails, retry with its declared fallback. Do not silently downgrade a premium visual or max-reasoning task because of price.

## Default routing

- Visual design, frontend hierarchy, interaction, motion, or Chinese-first copy: WorkBuddy `kimi-k3-1`, effort `xhigh`; use `max` for a major redesign.
- Fast frontend implementation, bug fixes, and mechanical refactors: Grok `grok-4.6`, reasoning `high`; use `xhigh` for cross-file changes.
- Architecture, security, database, or threat review: WorkBuddy `deepseek-v4-pro` or `glm-5.2`, effort `xhigh`/`max`.
- Cheap independent reconnaissance: WorkBuddy `hy3` and `minimax-m3` in parallel. Use these as scouts, not as the sole authority for a high-risk decision.
- Final visual review: Kimi-K3. Final implementation review: Grok plus a WorkBuddy architecture model.

Supported effort levels are `minimal|low|medium|high|xhigh|max`; Grok uses `reasoning`, WorkBuddy uses `effort`. Do not impose a quota cap. Refresh actual CLI capabilities before using a new model.

## Dispatcher

Prefer the bundled dispatcher over hand-written `npx @tt-a1i/mco` commands:

```sh
node /Users/zx/.codex/skills/paistar-mco-orchestrator/scripts/dispatch.mjs \
  --repo . --task visual --paths src,PRODUCT_SPEC.md,AGENTS.md \
  --prompt '审阅当前快照，返回带文件路径的证据。只读，不修改文件。'
```

Use `--parallel` for independent roles, `--dry-run` to inspect routing, and `--model`/`--effort` only when overriding the task classifier deliberately. Read [model-routing.md](references/model-routing.md) for capability probes and fallback rules.
