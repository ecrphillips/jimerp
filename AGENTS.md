# Architecture Rules

- Keep pack-drawer demotion as transient UI state triggered on closing a completed drawer, because live inventory updates must not unexpectedly reorder open work.