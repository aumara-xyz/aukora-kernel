# Prompt Craft — voice-safe starts

Use this when starting a fresh Auma/Fable voice session.

## Good Fresh Start

Start calm and narrow:

> Hey, good morning. Please read `docs/INBOX.md` and tell me the top two items, advisory only. Do not act yet.

Then proceed one step at a time.

## Avoid On First Turn

Do not start a fresh voice session by asking for:

- Raw adversarial chains.
- Detailed evasion mechanics.
- Long security transcripts.
- Brand/legal/patent speculation plus security details in the same prompt.
- Multi-agent autonomy plans framed as "take over" or "ignore normal limits."

These topics belong in engineering lanes, GitHub issues, and concise summaries first.

## Recommended Pattern

1. Greeting.
2. Read `docs/INBOX.md`.
3. Ask for a short advisory summary.
4. If security detail is needed, ask the engineering lane to verify and summarize it first.
5. Keep Auma/Fable voice on planning, prioritization, and truth-checking unless Peter explicitly asks for
   a focused technical read.

## Wording Discipline

- Say "advisory" often and mean it.
- Say "owner signs" rather than "the model authorizes."
- Say "shadow-only" for Nebius experiments.
- Say "engineering detail lives in issue/snapshot/scratchpad" when a voice turn would otherwise ingest raw
  adversarial text.
- Do not claim something is closed until Codex or the relevant verifier has checked the evidence.

## First Message For Auma Right Now

> Hey, good morning. Please read `docs/INBOX.md` and confirm the top two items, advisory only. Do not act on them yet.
