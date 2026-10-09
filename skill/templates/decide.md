---
title: Pick a queue for the ingest service
---

Example board from the decide pattern; the numbers are illustrative. Replace every card. Needs first, then options side by side, then one decision.

# What the queue must do

## Peak load is 80k messages a second; steady load is 5k {#need-peak basis=fact}
Measured from the October replay of production traffic.

## A broker restart must not lose messages {#need-durable basis=fact}
A lost batch means re-billing customers by hand.

# Options {compare}

## NATS JetStream covers the peak with one binary {#nats basis=inference}
It meets both needs on a three-node cluster and adds the least operating work.

```facts
peak: 120k msg/s on 3 nodes
replay: 7 days
operations: one binary
cost: about $40 a month
```

```tradeoffs
+ Smallest operating surface of the three
+ The team ran it in 2025 for the notifier
- Replay window is shorter than Kafka's
```

## Kafka pays off only if we need months of replay {#kafka basis=inference}
It has the most headroom and the longest replay, at the cost of a cluster to run.

```facts
peak: 1M msg/s on 3 brokers
replay: as long as disk allows
operations: brokers plus a controller quorum
cost: about $400 a month
```

## SQS is cheapest to run but needs sharding at this peak {#sqs basis=guess}
No servers to run, but one queue does not take 80k a second without batching and many queues.

```facts
peak: needs sharding across queues
replay: none after delete
operations: none
cost: per request; about $90 a month here
```

# Decision

## Pick NATS JetStream unless replay beyond 7 days matters {#pick-queue ask=choose from=nats,kafka,sqs}
NATS meets both needs at the lowest operating cost. Kafka only wins if long replay is a requirement.

- [x] [[nats]]
- [ ] [[kafka]]
- [ ] [[sqs]]
