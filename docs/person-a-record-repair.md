# Person A deterministic record repair

The Person A repair compiler applies only transformations that can be proven from canonical schema v0.1.2 fields and exact source grounding. It preserves the original extraction and emits append-only audit records describing applied, skipped, and rejected operations.

## Aggregate splitting is unsupported in v0.1.2

The compiler intentionally does not split aggregate deliverables or aggregate evidence objects. Canonical schema v0.1.2 has no explicit aggregate-to-child membership relationship, so a claim link, object label, title, description, or lexical enumeration cannot prove that a proposed child set fully represents the aggregate.

When an object label appears aggregate-like, the compiler may emit a deterministic `aggregate_split_unsupported_v0_1_2` skipped audit entry. It does not remove the aggregate, create child objects, rewrite claim or evidence links, or promote evidence state. The audit entry is internal and does not automatically produce a clarification question.

Ambiguous aggregate structure remains a model-quality or human-clarification issue. Preserving the submitted aggregate is safer than risking information loss.

## Future schema requirement

Aggregate splitting must not be reintroduced until a reviewed schema version provides, at minimum:

- `aggregate_object_id`;
- explicit `child_object_ids`;
- a typed membership source;
- membership attribution status;
- exact source grounding for every child.

That future relationship must also define how membership affects evidence availability, inspection, authorship, filenames, occurrence state, and existing typed links. No schema migration is part of PR #4.
