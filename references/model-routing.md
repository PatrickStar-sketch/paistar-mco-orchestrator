# Model routing reference

## Task profiles

| Profile | Primary | Secondary | Default level |
| --- | --- | --- | --- |
| `visual` | WorkBuddy `kimi-k3-1` | Grok `grok-4.6` | Kimi `xhigh`, Grok `high` |
| `code` | Grok `grok-4.6` | WorkBuddy `deepseek-v4-pro` | Grok `high` |
| `architecture` | WorkBuddy `deepseek-v4-pro` | WorkBuddy `glm-5.2` | `xhigh` or `max` |
| `security` | WorkBuddy `glm-5.2` | WorkBuddy `deepseek-v4-pro` | `max` |
| `copy-ia` | WorkBuddy `kimi-k3-1` | Grok `grok-4.6` | `xhigh` |
| `scout` | WorkBuddy `hy3` + `minimax-m3` | none | `minimal`/`low` |
| `final-review` | Kimi-K3 + Grok | DeepSeek/GLM when needed | `max` |

Kimi-K3 is the premium visual route by user preference. Do not replace it with a cheaper model merely to reduce usage. `hy3` and `minimax-m3` are useful parallel scouts, but their result must not be the sole basis for a high-risk decision until a benchmark establishes the capability.

## Confirmed CLI identifiers

WorkBuddy currently exposes these identifiers through `codebuddy --help`: `auto`, `hy3`, `glm-5.2`, `glm-5.1`, `glm-5v-turbo`, `minimax-m3`, `kimi-k3-1`, `kimi-k2.7`, `kimi-k2.6`, `deepseek-v4-flash`, and `deepseek-v4-pro`. The UI label “Kimi-K3” maps to the CLI identifier `kimi-k3-1`.

Grok is routed through the local safe shim and defaults to `grok-4.6`.

## Reasoning levels

- Grok shim: `low`, `medium`, `high`, `xhigh`, `max` through the `reasoning` option.
- WorkBuddy shim: `minimal`, `low`, `medium`, `high`, `xhigh`, `max` through the `effort` option.

If a provider rejects a level, retry at the next lower supported level for that same provider. Do not silently switch model families on a visual or security task; record the fallback in the result.

## Capability probe

Before routing to a model not listed above, run the bundled inspector:

```sh
node /Users/zx/.codex/skills/paistar-mco-orchestrator/scripts/inspect-models.mjs
```

Treat model names, prices, and availability as runtime data. Do not infer quality from price alone. Update the profile only after comparing the same task across models with build/test results, visual review, latency, and failure behavior.

## Evidence gate

Every sub-agent result must include:

1. the repository-relative path it inspected;
2. the relevant line, selector, test, or reproducible command;
3. a distinction between observed fact and recommendation.

If a response mentions files that are absent from the manifest or describes a different framework/project, discard it and rerun with a narrower snapshot.
