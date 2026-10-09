# Writing cards: near ASD-STE100

ASD-STE100 (Simplified Technical English) is a controlled language for
aircraft maintenance. Karpathy suggests it for model output, about "80% of
the way", because the full spec is strict. Cards use the rules below. The
source is the ASD-STE100 sheet on his post:
https://x.com/karpathy/status/2105819303471976479

`cards check` and `cards render` test the rules marked **checked**. The
writer keeps the other rules. A board with `#+language:` other than English
skips the checks.

## Sentences

- **checked** A sentence has 25 words at most. An instruction has 20 at most.
- One fact in each sentence. One instruction in each sentence.
- Use the active voice: "The compiler records each version", not "Each
  version is recorded".
- Use simple tenses: the imperative, the simple present, past and future.
  Do not use "is closing", "has closed", or "must be closed".
- Do not leave out "the", "a" and "this". "Open the card", not "Open card".
- A noun group has three words at most: "card numeral", not "board card
  numeral address".
- Put the condition first and the action second: "If the server is down,
  use Copy."

## Paragraphs

- **checked** A paragraph has 6 sentences at most.
- One topic in each paragraph.
- Use a vertical list for three or more parallel items or steps.

## Words

- Use the same word for the same thing every time. On a board, pick one
  word for each thing (card, claim, ask, link, rack, desk) and keep it.
- One word has one meaning. "Close" is a verb, not "near".
- **checked** Replace these words. The first group is from the STE sheet.
  The second group is ours: words that make agent prose longer or vaguer.

| Do not write | Write |
|---|---|
| utilize | use |
| in order to | to |
| prior to | before |
| approximately | about |
| commence | start |
| ensure | make sure |
| replenish | fill |

| Do not write | Write |
|---|---|
| leverage, harness | use |
| facilitate | help |
| subsequently | then |
| numerous, myriad, plethora | many |
| additional | more |
| demonstrate | show |
| sufficient | enough |
| terminate | stop |
| initiate | start |
| obtain | get |
| endeavor | try |
| regarding | about |
| in the event that | if |
| due to the fact that | because |
| a number of | some, or the number |
| delve | look at |
| seamless | nothing; say what works |
| robust | strong, or say what it survives |
| crucial, pivotal | important |
| comprehensive | full |
| streamline | simplify |
| empower, unlock | let |
| holistic | whole |
| synergy | nothing; say what it does |
| paradigm | model |
| cutting-edge | new |

Quoted words of other people and code do not count.

## On a card

- The claim is one sentence that can be true or false.
- The gist is one paragraph, 60 words at most (**checked**).
- Say how you know with `:BASIS:`, not with "I think" or "it seems".
- Technical names stay as they are: `board.org`, `:FROM:`, `cards serve`.

## Show, then tell

When the claim is about a shape, draw it. A layout, a view, a flow, a
structure, a before and after: put a `sketch` or a `flow` under the gist
(see `format.md`). The text then names what the figure shows. A decision
about a view shows each option as a figure, so the human compares
pictures, not paragraphs.

A figure earns its place when it shows something that the text cannot
show in one glance. Do not draw a figure for a single fact.
