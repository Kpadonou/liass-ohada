---
name: accounting-integrity
description: Use this skill when changing accounting posting, ledgers, balances, fiscal or period locks, auxiliary accounting, lettering, financial reports, reconciliation, recovery, cross-domain accounting generation, or a financial workflow whose persistence can affect accounting integrity. Applies across products even without a DynamoDB code change; unrelated UI, configuration, and ordinary database work do not trigger it.
---

# Accounting Integrity Skill

## Purpose and authority

Protect financial correctness across Accounting and producing domains. `SPEC.md` defines platform architecture; `ohada-legal-reference` owns applicable legal and accounting meaning; `dynamodb-data-modeling` owns persistence mechanics; `liass-platform-architecture` owns cross-domain boundaries. Do not copy their rules here. DynamoDB remains the selected persistence technology.

## Mandatory invariants

For every affected financial command and derived view, Codex must:

1. Preserve balanced double-entry posting: validate complete debit and credit lines, exact amounts and currency rules, and equality of totals before a posted entry becomes visible.
2. Commit the canonical entry, its required lines, posting state, and durable deduplication evidence atomically. If a required effect cannot fit one atomic boundary, design an explicit recoverable workflow that never exposes a partially posted entry as complete.
3. Give each retryable financial intent a stable identity and durable outcome. Replays with the same intent return the established result; reuse with different material intent fails. Resolve ambiguous outcomes before retrying to prevent duplicate effects.
4. Guard concurrent writes and state transitions with authoritative versions or conditions. Reject or safely retry conflicts; never lose an accepted financial update.
5. Enforce fiscal-year and period open/closed state at the authoritative write boundary, including races with closing. Closing must not certify a period while an in-flight posting can still commit into it.
6. Preserve posted history and audit provenance. Correct posted records through authorized, linked reversal or adjustment workflows, never silent mutation or deletion.
7. Keep canonical journal entries authoritative. Balances, general and auxiliary ledgers, lettering, and financial reports must derive consistently from the same accepted effects, with explicit freshness and completeness semantics. Never present an incomplete projection as final.
8. Define deterministic reconciliation against canonical facts and an idempotent, restartable projection rebuild. Detect missing, duplicate, or divergent effects and repair them without creating new accounting effects.
9. Trace cross-domain source facts to accounting consequences with stable source identity, ownership, authorization, and audit correlation. A producer must not write Accounting internals; late, duplicate, reversed, and failed deliveries require defined outcomes.
10. Preserve verified organization isolation and fiscal-year identity through writes, reads, retries, reconciliation, and rebuilds. Prevent cross-tenant or cross-year contamination.
11. Test critical failure boundaries: injected failures, ambiguous responses, duplicate delivery, concurrent posting and closing, reversal, recovery, reconciliation, and regressions for affected invariants.
12. Validate material throughput and contention risks using evidence representative of expected volume, including hot counters/items, transaction cost, projection lag, and rebuild time. State assumptions and capacity limits.

Never accept an implementation known to violate a critical invariant. Stop and report the blocker if a safe design cannot be established.

## Optional optimizations

Caching, pre-aggregation, asynchronous projections, batching, and partition tuning are optional performance choices. They may improve latency or cost only when the mandatory invariants and stated freshness contract still hold. Apply the frontend cache review and DynamoDB modeling guidance in their owning instructions before adding infrastructure.

## Implementation workflow

1. Identify the source facts, owning domain, tenant/year boundary, canonical record, affected commands, and derived views.
2. State the invariant, atomic or recoverable commit boundary, lock/close race handling, idempotency key and outcome, and concurrent-write conditions before changing code.
3. Map each read and projection to its authoritative source, consistency/freshness requirement, reconciliation method, and rebuild procedure.
4. Use `ohada-legal-reference` for applicable business rules; `dynamodb-data-modeling` for persistence or transaction changes; and `liass-platform-architecture` for platform ownership or cross-domain integration.
5. Implement the smallest safe change, then run targeted invariant, concurrency, failure-injection, recovery, and regression validation. Measure scale-sensitive paths when material.

## Final response requirements

Report the invariants and affected flows, atomicity and retry design, concurrency and period-lock guarantees, canonical-versus-derived consistency, reconciliation/rebuild plan, cross-domain audit and tenant/year isolation, tests and performance evidence, and explicit unresolved integrity risks. Separate verified results from assumptions and Product Owner acceptance.
