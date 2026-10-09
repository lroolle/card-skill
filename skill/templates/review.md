---
title: Review of the retry change in payments-client
---

Example board from the review pattern. Replace every card. One finding per card, worst first. The gate at the end asks before anything changes.

# Findings {list}

## A retry after a timeout can charge the customer twice {#double-charge .correctness basis=inference}
The client retries on timeout, but the server may have committed the first charge. Without an idempotency key the retry is a second charge.

```diff
- await post('/charges', body)
+ await post('/charges', body, { idempotencyKey: body.orderId })
```

## Backoff has no ceiling, so a long outage stalls the worker for hours {#backoff-ceiling .reliability basis=fact}
The delay doubles on every attempt with no maximum. After 12 attempts one job waits more than an hour.

## The new test mocks the clock but never moves it {#test-clock .tests basis=fact}
`retry.test.ts` installs fake timers and then awaits the real delay, so the test passes without exercising backoff.

# Gate

## Apply the three fixes and rerun the payments suite? {#apply-fixes ask=approve from=double-charge,backoff-ceiling,test-clock}
I will change only the lines named in the findings and report the test result on this card.
