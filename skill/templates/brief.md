---
title: Why the nightly build got slower in September
---

Example board from the brief pattern. Replace every card. Claims first; open a card for the evidence.

# What happened

## The build is 9 minutes slower because the cache key changed {#cache-key basis=fact}
Every nightly since 2026-09-12 misses the dependency cache and rebuilds it from scratch.

```facts
before: 14 min median
after: 23 min median
cache hit rate: 96% to 0%
```

## A toolchain bump on 2026-09-12 put its version into the cache key {#toolchain basis=fact from=cache-key}
The new toolchain writes a patch version into the lockfile hash. The patch version changes on every runner image update.

## Runner size and test count are ruled out {#ruled-out basis=inference}
Runner size did not change. The test count grew by 2%, which explains seconds, not minutes.

# What it means

## Pinning the cache key to the minor version restores the old time {#pin-key basis=inference from=cache-key,toolchain}
The minor version only changes on a deliberate upgrade, so the cache stays valid between upgrades. See [[toolchain]] for the cause.
