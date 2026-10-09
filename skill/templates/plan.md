---
title: Move session storage from Redis to Postgres
---

Example board from the plan pattern. Replace every card. Steps run top to bottom; each step names what it needs.

# Steps {list}

## Sessions are written to both Redis and Postgres {#dual-write status=done}
Dual-write has run since 2026-09-30 with no write errors.

## Backfill copies sessions older than the dual-write start {#backfill status=doing progress=3/8 needs=dual-write}
Three of eight shards are copied. Each shard takes about the same time.

## Reads switch to Postgres behind a flag {#switch-reads needs=backfill}
The flag flips per region, smallest region first, so a bad read path hits few users.

## Redis writes stop after one clean week {#remove-redis needs=switch-reads}
A clean week means no flag rollback and no session-not-found spike.

# Open question

## Which sessions can we drop instead of copying? {#drop-policy ask=answer}
Sessions idle for 30 days or more are most of the rows. Dropping them shortens the backfill. Only you know whether a customer depends on them.
