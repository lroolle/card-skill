---
title: Search reindex, status
---

Example board from the status pattern. Replace every card. Work in flight first; done work recedes; blocked work names what it waits on.

# In flight

## The product catalog reindex is five shards in {#reindex-catalog status=doing progress=5/12}
Each shard takes about the same time. No errors so far.

## Synonym rebuild waits on the dictionary import {#synonyms status=blocked needs=dictionary-import}
It starts when the import card is done.

## Can I make the search API read-only for 10 minutes at 02:00 UTC? {#read-only ask=approve}
The final swap needs a write freeze. Reads keep working. 02:00 UTC is the lowest-traffic window this week.

# Done

## The dictionary import loaded all terms {#dictionary-import status=done}
No rejected rows.
