# Management Chat Routing

Recallant management chat uses a local-first, fail-closed routing contract.

## Model call

The configured `RECALLANT_MANAGEMENT_CHAT_MODEL` is used for one request only. If it is not
configured, Recallant uses `mistral-small3.2:24b`. Recallant does not silently switch to another
model after a timeout, unavailable response, invalid JSON, or schema violation.

The model request has a configurable `RECALLANT_MANAGEMENT_CHAT_AI_TIMEOUT_MS` deadline. After a
failed request, Recallant remains available through deterministic rules.

## Response contract

The model must return one JSON object with these fields:

- `intent`: one of the supported management-chat intents;
- `language`: `ru`, `en`, or `mixed`;
- `confidence`: a JSON number from `0` to `1`;
- `summary`: a non-empty string;
- `destructive_or_sensitive`: a JSON boolean.

Invalid JSON or a schema violation is never accepted as a model classification.

## Safety behavior

The critical intents are cleanup, global rules, source management, project onboarding, and pilot
QA. If a critical intent is ambiguous, conflicts with deterministic classification, or the model
fails, Recallant asks for clarification and proposes no action. Safe read-only intents may use the
deterministic fallback without stopping the service.

The model's confidence is not a safety override. A high confidence value cannot authorize an
ambiguous critical action. Risky actions still follow the existing dry-run and confirmation
workflows.

Routing telemetry contains only safe metadata such as the final intent, language, confidence,
model, result type, failure category, and classification latency. Raw user messages, raw model
responses, and raw model errors are not stored in the management-chat telemetry.

Focused regression checks:

```bash
npm run management-chat-ai:smoke
npm run stage2:intent-matrix
```
