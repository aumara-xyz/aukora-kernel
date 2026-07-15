# Graticube for Aukora Apps - Build Brief

Generated: 2026-07-07
Source workspace: `/Users/asd/Downloads/graticube/web`
Current implementation source: `apps/next/public`
Primary data source: `apps/next/public/story-cards.js`, generated from `graticube_reclassified_full_spectrum.csv`

## Purpose

Build a version of Graticube inside the Aukora apps ecosystem. The current web prototype is a browser game with 3D dice, reflective story prompts, gratitude/resonance actions, curiosity and gift-round modals, and a filterable prompt database. The Aukora version should keep the emotional feel and core game loop, while translating the implementation into whatever native app architecture Fable/Claude Code chooses for Aukora.

The spirit: calm, playful, emotionally intelligent, relational, and facilitator-friendly. It should feel like a game people can play in a room together, not like a worksheet.

## Core Game Loop

1. Player begins a turn by rolling two dice.
2. The dice are `Time` and `Space`/emotion style dice.
3. The roll uses a spin-heavy “cyclone” style by default. Users liked this; keep it as the default roll feel.
4. After the final die settles, wait about `1.5s` before showing the prompt card so players can see the dice words.
5. A prompt card appears with:
   - prompt text
   - character title prefixed by `Character: `
   - character description/subtext
   - Time and Space pill values
   - low-opacity chakra/character icon in the card background
   - compact metadata chips: Depth, Complexity, Audience, Context, Energy
6. Dice remain visible after the prompt appears.
7. Dice rolling is locked while a prompt is visible so accidental gestures do not lose the prompt.
8. User taps `Next turn` to clear the prompt and allow another roll.
9. Prompt selection uses a shuffle bag, not pure random:
   - build a shuffled queue from the active filtered pool
   - draw through the queue before reshuffling
   - avoid/deprioritize the last `15` cards where possible
   - reset the bag when filters change

## Dice

Current implementation uses:

- `three.min.js` for 3D rendering
- `cannon.min.js` for physics
- `dice.js` for dice geometry/materials/physics
- `teal.js` helper utilities

Aukora does not need to keep this exact stack, but it should preserve the behavior:

- Two visible dice.
- Finger drag/flick or mouse drag initiates roll.
- Roll has randomized strength and direction.
- Spin-heavy mode is always on.
- Dice result maps to Time and Space words.
- Dice are visible after prompt reveal.
- Roll input is ignored while prompt card is visible.

Current dice face labels:

Time die, d6-like labels:

- never
- past
- future
- always
- some time
- now

Space/feeling die, d12-like labels:

- love
- wisdom
- gratitude
- trust
- joy
- courage
- shame
- regret
- fear
- desire
- anger
- guilt

Blank/unused indices exist in the current JS arrays because of the original dice library indexing. Rebuild cleanly in Aukora if desired.

## Left Icon Stack

The current left-side control stack is icon-first. Keep this compact and expressive.

Current order:

1. `?` - How to Play modal
2. Heart - gratitude/resonance action
3. Sound toggle - gratitude sound on/off
4. Comment bubble - curiosity modal
5. Gift - gift round modal
6. Magic wand - story filters modal

The old spin toggle has been commented out because cyclone spin is now default.

## Gratitude Heart

This is emotionally important. The heart is not a tiny “like”; it is a visible resonance/thank-you gesture.

Current behavior:

- User taps heart to share resonance or thanks for another player’s story.
- Text feedback says `thank you`.
- Large hearts bloom across about 90% of the viewport.
- Prompt card briefly receives a warm glow if visible.
- Optional audio is on by default.
- Sound toggle uses bell icons in current web version.
- The chosen sound is the `Harp Bloom` variant: sweet, reward-like, gentle enough for repeated use in a group.

Aukora recommendation:

- Keep audio on by default but obvious to toggle.
- Sound should feel like a soft harp/singing bowl achievement cue.
- It should be noticeable but soothing if multiple people tap hearts in the same room.

## Curiosity Modal

Icon: comment bubble, blue-styled in web version.

Modal content:

**Are you open to my curiosity?**

Would you be willing to share more?

Is there any advice for yourself or action you might take?

Can I tell you what I felt or noticed?

Can I ask you an open question?

Behavior:

- modal covers most of the viewport
- light blue card style
- closes by explicit close, backdrop, or escape where available

## Gift Round Modal

Icon: gift.

Modal content:

**The Gift Round**

Start with the first player. Each person (including the first player) will pick a character that best represents how they played. Share what you chose and why, then go to the next player. Repeat until complete.

Image:

- `character-reference.jpg`

Behavior:

- modal height about 90% of vertical screen
- image appears below text
- should scroll if needed

## How To Play Modal

Icon: question mark.

Top image:

- `GC-Color-with-Name-1500.png`

Title:

**How to Play**

Numbered list:

1. Roll the time & space dice and see what comes up! (We’ll come back to the dice later.)
2. A prompt will appear. Consider your question/prompt...what comes to mind? (yes, *that* thought)
3. Share what is true for you. (Consider how the character may play a role.)
4. Other players may choose to ask a question or share a gratitude during your share. You can too.
5. Before you finish your turn, come back to look at the time & space dice. Did they make their way into your story? How might they relate to what you shared?

Footer after generous spacing:

[Graticube](https://www.graticube.game) © 2020-2026 | [Contact](mailto:us@graticube.game)

Current link color notes:

- default: `#6692cb`
- hover/focus: `#4b4a9f`

## Story Filters

Icon: magic wand.

Filters compose together. If a filter group has no selected values, treat it as “all.” If selected values produce no cards, show a graceful empty state.

Filter groups:

- Deck
- Depth
- Complexity
- Audience
- Context
- Energy

Depth labels:

- D1 Light
- D2 Personal
- D3 Vulnerable
- D4 Deep

Complexity labels:

- C1 Very Simple
- C2 Simple
- C3 Moderate
- C4 Complex

Audience values:

- Youth
- Universal
- Advanced

Context values:

- Group-safe
- Pair
- Facilitated-only

Energy values:

- Playful
- Reflective
- Activating
- Grounding

Current UI detail:

- filter options show counts, e.g. `C3 Moderate (83)`
- unavailable options are disabled
- legend/help text: `Depth = emotional challenge. Complexity = reading/parsing difficulty.`

## Card Database Summary

Total canonical cards: 247

Deck counts:

```json
{
  "abundance": 63,
  "alive": 63,
  "alive_bonus": 58,
  "og": 63
}
```

Framework counts:

```json
{
  "alive": 121,
  "shared": 126
}
```

Depth counts:

```json
{
  "D1": 221,
  "D2": 20,
  "D3": 5,
  "D4": 1
}
```

Complexity counts:

```json
{
  "C1": 19,
  "C2": 123,
  "C3": 83,
  "C4": 22
}
```

Audience counts:

```json
{
  "Universal": 193,
  "Youth": 54
}
```

Context counts:

```json
{
  "Facilitated-only": 1,
  "Group-safe": 30,
  "Pair": 216
}
```

Energy counts:

```json
{
  "Activating": 7,
  "Grounding": 19,
  "Playful": 211,
  "Reflective": 10
}
```

## Card Data Model

Recommended model:

```ts
type StoryCard = {
  id: string;
  source_row_id?: string;
  prompt: string;
  character_key: string;
  framework: 'alive' | 'shared';
  source_decks: string[];
  depth?: 'D1' | 'D2' | 'D3' | 'D4';
  complexity?: 'C1' | 'C2' | 'C3' | 'C4';
  audience?: 'Youth' | 'Universal' | 'Advanced';
  context?: 'Group-safe' | 'Pair' | 'Facilitated-only';
  energy?: 'Playful' | 'Reflective' | 'Activating' | 'Grounding';
  status?: string;
  notes?: string;
}
```

Important compatibility rule:

- Old CSV `difficulty` maps to new `depth`.
- If future data has both `depth` and `difficulty`, prefer `depth`.

Legacy depth normalization:

- light/easy/low -> D1
- medium -> D2
- challenging -> D3
- hard/deep/high -> D4
- unknown -> warn and default D2

Legacy complexity normalization:

- simple/low -> C1
- medium -> C2
- complex -> C3
- advanced/high -> C4
- unknown -> warn and default C2

## Decks

```json
{
  "alive": {
    "id": "alive",
    "label": "Alive",
    "framework": "alive",
    "description": "Alive core story prompts.",
    "sortOrder": 1
  },
  "alive_bonus": {
    "id": "alive_bonus",
    "label": "Alive Bonus",
    "framework": "alive",
    "description": "Alive bonus story prompts.",
    "sortOrder": 2
  },
  "og": {
    "id": "og",
    "label": "OG",
    "framework": "shared",
    "description": "Original Graticube story prompts.",
    "sortOrder": 3
  },
  "abundance": {
    "id": "abundance",
    "label": "Abundance",
    "framework": "shared",
    "description": "Abundance story prompts.",
    "sortOrder": 4
  }
}
```

## Alive Character Framework

| Key | Display Name | Subtext | Chakra | Shared/Alive Map | Gradient | Icon |
|---|---|---|---:|---|---|---|
| connector | The Connector | One who invites some or all players to share. | 1 | facilitator | `linear-gradient(90deg,#c76301,#b61f24)` | `chakras/root-facilitator-connector.png` |
| explorer | The Explorer | Explores the "what if" moment and lets it flow. | 2 | curiositor | `linear-gradient(90deg,#b49500,#c76301)` | `chakras/sacral-curiositor-explorer.png` |
| noticer | The Noticer | One who is aware of their playful mind. | 3 | self_aware | `linear-gradient(90deg,#114b18,#b49500)` | `chakras/solar plexus -selfaware-noticer.png` |
| brave_heart | Brave Heart | Enjoys connection...giving and receiving kindness. | 4 | purveyor_of_love | `linear-gradient(90deg,#006d94,#114b18)` | `chakras/heart-purveyoroflove-brave heart.png` |
| dreamweaver | Dreamweaver | Imagines what is possible with creative color. | 5 | storyteller | `linear-gradient(90deg,#293370,#006d94)` | `chakras/throat-storyteller-dreamweaver.png` |
| grateful_spirit | Grateful Spirit | One who appreciates what is special in every moment. | 6 | apprecianado | `linear-gradient(90deg,#361967,#293370)` | `chakras/third eye-apprecianado-grateful spirit.png` |
| uplifter | The Uplifter | Inspires a lighter and brighter moment for all. | 7 | inspirator | `linear-gradient(90deg,#a1366e,#361967)` | `chakras/crown-inspirator-uplifter.png` |
| listener | The Listener | One who listens deeply with an open heart and mind. | 8 | listener | `linear-gradient(90deg,#b61f24,#a1366e)` | `chakras/meta-listener.png` |

## Shared Character Framework

| Key | Display Name | Subtext | Chakra | Shared/Alive Map | Gradient | Icon |
|---|---|---|---:|---|---|---|
| facilitator | Facilitator | One who invites some or all players to share. | 1 | connector | `linear-gradient(90deg,#c76301,#b61f24)` | `chakras/root-facilitator-connector.png` |
| curiositor | Curiositor | Explores the "what if" moment and lets it flow. | 2 | explorer | `linear-gradient(90deg,#b49500,#c76301)` | `chakras/sacral-curiositor-explorer.png` |
| self_aware | Self-Aware | One who considers an empowering aha moment. | 3 | noticer | `linear-gradient(90deg,#114b18,#b49500)` | `chakras/solar plexus -selfaware-noticer.png` |
| purveyor_of_love | Purveyor of Love | Enjoys connection...giving and receiving more love. | 4 | brave_heart | `linear-gradient(90deg,#006d94,#114b18)` | `chakras/heart-purveyoroflove-brave heart.png` |
| storyteller | Storyteller | One who adds extra color and context to their share. | 5 | dreamweaver | `linear-gradient(90deg,#293370,#006d94)` | `chakras/throat-storyteller-dreamweaver.png` |
| apprecianado | Apprecianado | Reflects on an insight of gratitude and appreciation. | 6 | grateful_spirit | `linear-gradient(90deg,#361967,#293370)` | `chakras/third eye-apprecianado-grateful spirit.png` |
| inspirator | Inspirator | One who liberates a moment of inspiration. | 7 | uplifter | `linear-gradient(90deg,#a1366e,#361967)` | `chakras/crown-inspirator-uplifter.png` |
| listener | Listener | Enjoys listening deeply with an open heart and mind. | 8 | listener | `linear-gradient(90deg,#b61f24,#a1366e)` | `chakras/meta-listener.png` |

## Chakra / Character Mapping

The two frameworks share the same chakra progression:

| Chakra | Shared Framework | Alive Framework |
|---|---|---|
| Root | Facilitator | The Connector |
| Sacral | Curiositor | The Explorer |
| Solar Plexus | Self-Aware | The Noticer |
| Heart | Purveyor of Love | Brave Heart |
| Throat | Storyteller | Dreamweaver |
| Third Eye | Apprecianado | Grateful Spirit |
| Crown | Inspirator | The Uplifter |
| Meta / Awareness | Listener | The Listener |

## Visual Direction

The current app moved away from heavy cosmic/water experiments toward a client-configurable, asset-driven setup.

Preserve:

- soft emotional atmosphere
- clear readable prompt card
- character icon as low-opacity card background
- Time and Space pills using purple `#845f8a`
- character title/description colors in the current web version:
  - title: `#9b5660`
  - description: `#be5c4c`
- gratitude interaction should feel big and celebratory
- modals should be clear, spacious, and readable on mobile

Avoid:

- hiding prompt text behind decorative backgrounds
- making roll areas unclear
- accidental rerolls while a prompt is active
- tiny emotional feedback for gratitude

## Assets To Bring Over

- `apps/next/public/assets/images/logo_rainbow_400.png`
- `apps/next/public/assets/images/wood.jpeg`
- `apps/next/public/assets/images/cosmic2.png`
- `apps/next/public/assets/images/spiritfest.jpg`
- `apps/next/public/assets/images/GC-Color-with-Name-1500.png`
- `apps/next/public/assets/images/character-reference.jpg`
- `apps/next/public/chakras/root-facilitator-connector.png`
- `apps/next/public/chakras/sacral-curiositor-explorer.png`
- `apps/next/public/chakras/solar plexus -selfaware-noticer.png`
- `apps/next/public/chakras/heart-purveyoroflove-brave heart.png`
- `apps/next/public/chakras/throat-storyteller-dreamweaver.png`
- `apps/next/public/chakras/third eye-apprecianado-grateful spirit.png`
- `apps/next/public/chakras/crown-inspirator-uplifter.png`
- `apps/next/public/chakras/meta-listener.png`

Current dice texture path in web config often uses `wood.jpeg` or `cosmic2.png` depending on deployment. In the latest `next` config file it references `wood.jpeg`, but previous client versions used `cosmic2.png` for dice. Choose intentionally for Aukora.

## Suggested Aukora Architecture

For the Aukora app, do not treat public JS as the long-term data source. Build toward:

- local typed card database for early app builds
- later server/API-backed card retrieval if content protection matters
- one canonical card model with filterable metadata
- shuffle-bag card selection service
- separate character-framework metadata
- reusable game-state controller

Suggested modules:

- `CardRepository`
  - loads cards
  - validates schema
  - exposes filters/counts
- `CardSelector`
  - owns shuffle bag and recent-card history
  - accepts active filters
  - returns next card
- `DiceRollController`
  - handles roll gesture/button/input
  - emits dice words and settle event
- `PromptController`
  - owns prompt visible/hidden state
  - locks rolling while prompt is visible
- `GratitudeController`
  - heart burst
  - thank-you text
  - audio state
- `GameResourcesController`
  - how-to-play, curiosity, gift round, filters

## Future WordPress Plugin Plan

Keep this in memory for later web work:

- move story-card storage out of public JS
- custom WordPress plugin
- custom database tables rather than posts
- REST endpoints for filter metadata and random card retrieval
- frontend fetches only the needed card(s)
- admin/editor tooling later

Potential public endpoints:

- `GET /wp-json/graticube/v1/filters`
- `GET /wp-json/graticube/v1/story-card?decks=alive,abundance&depth=D2&energy=Playful`

## Acceptance Criteria For Aukora Build

- App can roll two dice with spin-heavy feel.
- Prompt appears after a short post-roll delay.
- Dice remain visible while prompt is shown.
- Prompt card prevents accidental reroll.
- Next turn clears prompt and unlocks roll.
- Cards are selected through shuffle bag with recent-card avoidance.
- Filters work for deck, depth, complexity, audience, context, and energy.
- Prompt card shows character, subtext, dice words, and compact metadata chips.
- Character icon appears subtly behind prompt text.
- Gratitude heart has big visual feedback and sweet optional sound.
- Curiosity, Gift Round, How to Play, and Story Filters are available as modal tools.
- Works cleanly on phone and desktop/tablet layouts.

## Implementation Notes From Current Web Version

Current important source files:

- `apps/next/public/main.js`
- `apps/next/public/dice.js`
- `apps/next/public/graticube.css`
- `apps/next/public/story-cards.js`
- `tools/build_story_cards_from_csv.py`
- `graticube_reclassified_full_spectrum.csv`

The current `story-cards.js` is generated from CSV. If Aukora wants direct JSON, generate JSON from the same CSV rather than manually copying JS.

## Full Card Appendix

| ID | Decks | Framework | Character | Depth | Complexity | Audience | Context | Energy | Prompt |
|---|---|---|---|---|---|---|---|---|---|
| abundance-27 | abundance | shared | apprecianado | D1 | C2 | Youth | Pair | Playful | Describe your relationship with conformity or nonconformity. |
| abundance-28 | abundance | shared | apprecianado | D1 | C3 | Universal | Pair | Grounding | Like "blowing dust off a mirror," you've just cleared an old limiting experience. What do you see now? |
| abundance-55 | abundance | shared | apprecianado | D1 | C3 | Universal | Pair | Playful | This is the Karma Card. How is karma a cause or effect in your life? |
| abundance-56 | abundance | shared | apprecianado | D1 | C2 | Universal | Pair | Playful | "I am enough." How might this be true for you? |
| abundance-57 | abundance | shared | apprecianado | D1 | C3 | Universal | Pair | Grounding | Is there a line of poetry that you know and would like to share? |
| abundance-58 | abundance | shared | apprecianado | D1 | C2 | Youth | Pair | Playful | How might others say you are an original? |
| abundance-59 | abundance | shared | apprecianado | D2 | C2 | Youth | Pair | Playful | Who do you think could appreciate your appreciation? |
| abundance-60 | abundance | shared | apprecianado | D1 | C2 | Universal | Pair | Playful | How do you celebrate the gifts you've been given? |
| abundance-10 | abundance | shared | curiositor | D1 | C3 | Universal | Pair | Playful | In a moment, you were magnetically attracted. How did your relationship with them or it evolve? |
| abundance-11 | abundance | shared | curiositor | D1 | C2 | Youth | Group-safe | Activating | Who here is most motivated to create change? |
| abundance-12 | abundance | shared | curiositor | D1 | C3 | Universal | Pair | Playful | The generosity of spirit is infinite. How might you access your spiritual birthright of abundance? |
| abundance-5 | abundance | shared | curiositor | D1 | C2 | Universal | Pair | Playful | Describe a time when money came to you easily. |
| abundance-6 | abundance | shared | curiositor | D1 | C3 | Universal | Pair | Playful | From this moment, you will get more out of life. What do you need to put in? |
| abundance-7 | abundance | shared | curiositor | D1 | C4 | Universal | Pair | Playful | You're playing this game because of choices you've made your entire life. What events brought you to this moment? |
| abundance-8 | abundance | shared | curiositor | D2 | C3 | Universal | Pair | Reflective | Have you ever had an intuitive feeling about a relationship that you did or did not follow? |
| abundance-9 | abundance | shared | curiositor | D1 | C4 | Universal | Pair | Playful | Start the first sentence of a story inspired by the cubes. Have the next person add the next sentence until it comes back to you to finish the story. |
| abundance-1 | abundance | shared | facilitator | D1 | C2 | Universal | Pair | Playful | What is the most important thing you have not yet accomplished? |
| abundance-2 | abundance | shared | facilitator | D2 | C4 | Universal | Pair | Reflective | Consider how you feel affected by this present moment. Invite others to share. How might we positively affect this moment? |
| abundance-3 | abundance | shared | facilitator | D1 | C3 | Universal | Pair | Playful | Describe a moment of synchronicity and/or your connection to Shakti (life force energy). |
| abundance-4 | abundance | shared | facilitator | D1 | C4 | Universal | Pair | Playful | You are about to embark on a magnificent human quest. What one item of creative intelligence will each of you bring? |
| abundance-41 | abundance | shared | facilitator | D1 | C3 | Universal | Group-safe | Playful | Creative intelligence is consciousness in action. Are we using it or is it using us? |
| abundance-42 | abundance | shared | facilitator | D1 | C3 | Universal | Group-safe | Activating | Is it true that we can make our own luck? If so, what might we co-create? |
| abundance-43 | abundance | shared | facilitator | D1 | C2 | Universal | Pair | Playful | Have you ever experienced turning no into yes, where everybody wins? |
| abundance-44 | abundance | shared | facilitator | D1 | C2 | Youth | Group-safe | Playful | I need _____ hours of sleep, but... |
| abundance-29 | abundance | shared | inspirator | D1 | C2 | Universal | Pair | Playful | Hum aum and see if you can get others to hum along. |
| abundance-30 | abundance | shared | inspirator | D1 | C2 | Universal | Pair | Playful | Who needs to be inspired and uplifted by you? |
| abundance-31 | abundance | shared | inspirator | D1 | C2 | Universal | Pair | Playful | Ignorance is bliss or "consciousness is blissful." Which is true for you? |
| abundance-32 | abundance | shared | inspirator | D1 | C2 | Universal | Pair | Playful | When you follow your bliss, where are you going? |
| abundance-33 | abundance | shared | inspirator | D1 | C2 | Youth | Pair | Playful | What do you enjoy giving to others? |
| abundance-34 | abundance | shared | inspirator | D1 | C3 | Universal | Pair | Playful | Welcome to being in the zone. All obstacles are disappearing. What are you excited to accomplish? |
| abundance-35 | abundance | shared | inspirator | D1 | C2 | Universal | Pair | Playful | What is one of your favorite sources of inspiration? |
| abundance-36 | abundance | shared | inspirator | D1 | C3 | Universal | Pair | Playful | You have unlimited access to the ATM of Bliss. What is your secret... |
| abundance-37 | abundance | shared | inspirator | D1 | C1 | Youth | Group-safe | Playful | Share a moment of inspiration. |
| abundance-61 | abundance | shared | inspirator | D1 | C4 | Universal | Pair | Playful | "Some people are so poor, all they have is money." - Bob Marley. What does wealth mean to you? |
| abundance-38 | abundance | shared | listener | D1 | C2 | Universal | Pair | Grounding | What is a fixed belief about you that we should know? |
| abundance-39 | abundance | shared | listener | D1 | C3 | Universal | Group-safe | Playful | There's a sense of peace here. What or who is contributing to it? |
| abundance-40 | abundance | shared | listener | D1 | C2 | Universal | Pair | Playful | What role do diverse people, places and/or ideas play in your life? |
| abundance-62 | abundance | shared | listener | D1 | C3 | Universal | Pair | Playful | How might you rely on creative intelligence in some aspect of your life? |
| abundance-63 | abundance | shared | listener | D1 | C2 | Youth | Pair | Playful | Have you ever been in your own way? |
| abundance-20 | abundance | shared | purveyor_of_love | D1 | C1 | Youth | Pair | Playful | What is your eraser for negativity? |
| abundance-21 | abundance | shared | purveyor_of_love | D1 | C2 | Youth | Pair | Playful | In a moment you were misunderstood. What happened? |
| abundance-22 | abundance | shared | purveyor_of_love | D2 | C3 | Universal | Group-safe | Reflective | Like a breath of fresh air, it feels as though all time has stopped. What caused this? |
| abundance-46 | abundance | shared | purveyor_of_love | D1 | C3 | Universal | Pair | Playful | This is a get out of stress free card. How would you like to redeem it? |
| abundance-47 | abundance | shared | purveyor_of_love | D1 | C2 | Youth | Pair | Reflective | Where do you see your love reflected? |
| abundance-48 | abundance | shared | purveyor_of_love | D1 | C4 | Universal | Pair | Playful | If a stranger gave you $500 to spend in the next five minutes on something that gives you true joy, how would you spend it? |
| abundance-49 | abundance | shared | purveyor_of_love | D2 | C3 | Universal | Pair | Playful | Think of a tiny moment of bliss. Open your heart to tell the story. |
| abundance-50 | abundance | shared | purveyor_of_love | D1 | C2 | Universal | Pair | Playful | How do you cultivate your state of inner affluence? |
| abundance-13 | abundance | shared | self_aware | D1 | C2 | Universal | Pair | Playful | What was your last "aha moment?" What might be your next one? |
| abundance-14 | abundance | shared | self_aware | D1 | C4 | Universal | Pair | Playful | Consider what you find yourself doing and what's not working. What's one thing you might choose to stop doing? |
| abundance-15 | abundance | shared | self_aware | D1 | C3 | Universal | Pair | Playful | This is a free "aha moment" card. When do you apply it and what for? |
| abundance-16 | abundance | shared | self_aware | D1 | C3 | Universal | Pair | Playful | You just won the spiritual lottery. What is the emotional debt you would like to pay off? |
| abundance-17 | abundance | shared | self_aware | D3 | C2 | Universal | Group-safe | Playful | Describe a time when it was difficult to speak the truth. |
| abundance-18 | abundance | shared | self_aware | D1 | C2 | Universal | Group-safe | Reflective | Describe a flattering or unflattering reflection in a relationship. |
| abundance-19 | abundance | shared | self_aware | D1 | C2 | Youth | Pair | Grounding | What is something you know you don't know? |
| abundance-45 | abundance | shared | self_aware | D1 | C2 | Universal | Group-safe | Playful | "Nothing is more natural than abundance." How is it manifesting? |
| abundance-23 | abundance | shared | storyteller | D1 | C2 | Universal | Pair | Playful | Describe a time when you turned consciousness into wealth. |
| abundance-24 | abundance | shared | storyteller | D1 | C4 | Universal | Pair | Playful | It's no secret that life is dynamic - all of us are tossed around by change. What change do you invite or reject? |
| abundance-25 | abundance | shared | storyteller | D1 | C3 | Universal | Pair | Playful | Describe a time when you got what you needed instead of what you wanted, or vice-versa. |
| abundance-26 | abundance | shared | storyteller | D1 | C2 | Universal | Pair | Playful | You were blocked from getting what you wanted. What happened? |
| abundance-51 | abundance | shared | storyteller | D1 | C2 | Universal | Pair | Playful | How do you support your own life and the life of others? |
| abundance-52 | abundance | shared | storyteller | D1 | C4 | Universal | Pair | Playful | Consider a moment you wish had been different. Like a movie director, describe the new scene as you desire. |
| abundance-53 | abundance | shared | storyteller | D1 | C2 | Youth | Pair | Playful | How do cooperation and competition affect your life? |
| abundance-54 | abundance | shared | storyteller | D1 | C3 | Universal | Pair | Playful | Imagine you are the hero's sidekick. When might you choose to stop the hero? |
| alive-15 | alive | alive | brave_heart | D1 | C3 | Universal | Pair | Playful | You get to invent a new holiday that everyone can celebrate, what's it all about? |
| alive-26 | alive | alive | brave_heart | D1 | C2 | Universal | Pair | Playful | What have you made with your hands that you're really proud of? |
| alive-45 | alive | alive | brave_heart | D1 | C2 | Universal | Pair | Playful | What art do you find beautiful? How do you describe it? |
| alive-48 | alive | alive | brave_heart | D1 | C3 | Universal | Pair | Playful | In a moment, someone was left out, teased, or hurt. What was your part in it? |
| alive-59 | alive | alive | brave_heart | D1 | C3 | Universal | Pair | Grounding | What's a funny or cool thing about you that not many people know? |
| alive-6 | alive | alive | brave_heart | D1 | C3 | Universal | Pair | Playful | If you could do one nice thing for someone, what would it be? |
| alive-63 | alive | alive | brave_heart | D1 | C2 | Youth | Pair | Playful | What is something important you have lost? |
| alive-8 | alive | alive | brave_heart | D1 | C2 | Universal | Group-safe | Playful | What does it mean to be a good friend? |
| alive-31 | alive | alive | connector | D1 | C1 | Youth | Pair | Playful | You're not friends anymore. What happened? |
| alive-34 | alive | alive | connector | D1 | C3 | Universal | Pair | Activating | If you created the best school in the world, what would it be like? |
| alive-36 | alive | alive | connector | D2 | C3 | Universal | Pair | Playful | You have a button that shows what everybody is really thinking. When would you use it? |
| alive-37 | alive | alive | connector | D1 | C3 | Universal | Group-safe | Playful | What should every teacher learn to do? Invite some or all players to share. |
| alive-38 | alive | alive | connector | D1 | C3 | Universal | Pair | Playful | You have an easy button. When do you press it? Who might you share it with? |
| alive-40 | alive | alive | connector | D1 | C2 | Youth | Pair | Playful | What's the weirdest food combo you secretly love? |
| alive-52 | alive | alive | connector | D1 | C3 | Universal | Pair | Playful | Who is one of your closest friends? What do you like about them? |
| alive-62 | alive | alive | connector | D1 | C2 | Youth | Pair | Grounding | How do you know you can trust someone? |
| alive-16 | alive | alive | dreamweaver | D1 | C3 | Universal | Pair | Playful | What would slow you down from accomplishing your dream? What would speed it up? |
| alive-17 | alive | alive | dreamweaver | D1 | C3 | Universal | Pair | Playful | If you could help make someone's dream come true, whose would it be? |
| alive-21 | alive | alive | dreamweaver | D1 | C2 | Universal | Pair | Playful | What do you enjoy doing so much that you forget about time? |
| alive-41 | alive | alive | dreamweaver | D1 | C3 | Universal | Pair | Playful | Imagine a perfect day. What is it like? Who is with you and what are you doing? |
| alive-50 | alive | alive | dreamweaver | D1 | C2 | Universal | Pair | Playful | If you could be like anyone, who would it be? |
| alive-56 | alive | alive | dreamweaver | D1 | C3 | Universal | Pair | Playful | There is a door to a magic room. Where would you place the door? What's inside? |
| alive-57 | alive | alive | dreamweaver | D1 | C3 | Universal | Pair | Activating | Everyone playing gets to create a new planet, starting with you. What's it like? |
| alive-9 | alive | alive | dreamweaver | D2 | C1 | Youth | Pair | Playful | Who believes in your dreams? |
| alive-19 | alive | alive | explorer | D3 | C2 | Universal | Pair | Playful | In a moment, you were challenged to be brave. What happened? |
| alive-2 | alive | alive | explorer | D1 | C2 | Universal | Pair | Grounding | What do you know how to make in the kitchen? |
| alive-27 | alive | alive | explorer | D1 | C2 | Youth | Pair | Playful | Where does your mind go when you're bored? |
| alive-28 | alive | alive | explorer | D1 | C2 | Universal | Pair | Playful | If you had a magic backpack, what magical things would it do? |
| alive-46 | alive | alive | explorer | D1 | C2 | Universal | Pair | Playful | If you could make any kind of art, what would you make? |
| alive-49 | alive | alive | explorer | D1 | C3 | Universal | Pair | Playful | You just stepped into a time machine. It can take you anywhere. Where are you going? |
| alive-55 | alive | alive | explorer | D1 | C3 | Universal | Pair | Activating | You get to create an imaginary superhero pet. What in the world is it? What's its name? |
| alive-61 | alive | alive | explorer | D1 | C2 | Universal | Group-safe | Grounding | A job I would really like to know more about is... |
| alive-11 | alive | alive | grateful_spirit | D1 | C1 | Youth | Pair | Playful | Who or what makes you laugh? |
| alive-13 | alive | alive | grateful_spirit | D1 | C3 | Universal | Pair | Playful | What is one of the most important things to you in the world? |
| alive-14 | alive | alive | grateful_spirit | D1 | C4 | Universal | Pair | Grounding | What is one thing that you have now, that you want to keep for the rest of your life? |
| alive-18 | alive | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | When have you felt yourself smiling inside with pride? |
| alive-29 | alive | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | What's the best thing about living where you do? |
| alive-53 | alive | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | It's so exciting you can hardly wait. What is it? |
| alive-58 | alive | alive | grateful_spirit | D1 | C2 | Youth | Pair | Playful | What is something interesting about your family? |
| alive-60 | alive | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | What's a smell that reminds you of a favorite memory? |
| alive-22 | alive | alive | listener | D2 | C2 | Universal | Pair | Reflective | What's a sound that makes you feel really happy or calm? |
| alive-23 | alive | alive | listener | D1 | C2 | Youth | Pair | Playful | What is something that makes you laugh? |
| alive-25 | alive | alive | listener | D1 | C3 | Universal | Pair | Playful | If you could sing a duet with any famous singer, who would it be? What song? |
| alive-3 | alive | alive | listener | D1 | C2 | Universal | Pair | Grounding | How do you know if someone is or is not ok? |
| alive-35 | alive | alive | listener | D1 | C2 | Universal | Pair | Playful | What would you like your voice to be able to do? |
| alive-42 | alive | alive | listener | D1 | C2 | Universal | Pair | Playful | What kinds of problems do you want to solve when you're older? |
| alive-7 | alive | alive | listener | D1 | C3 | Universal | Pair | Playful | You've just been asked to invent a new sport. What are some of your ideas? |
| alive-20 | alive | alive | noticer | D1 | C2 | Universal | Pair | Playful | What is something that most people don't notice about you? |
| alive-24 | alive | alive | noticer | D1 | C2 | Universal | Pair | Playful | What does "being a good kid" mean to you? |
| alive-30 | alive | alive | noticer | D1 | C2 | Universal | Pair | Playful | What is one thing you promised not to do and did anyway? |
| alive-33 | alive | alive | noticer | D1 | C1 | Youth | Pair | Playful | What is something you don't understand? |
| alive-43 | alive | alive | noticer | D2 | C3 | Universal | Pair | Reflective | What's the most colorful thing you've ever seen? How did you feel when you saw it? |
| alive-47 | alive | alive | noticer | D1 | C1 | Youth | Group-safe | Playful | I wish I didn't have to... |
| alive-54 | alive | alive | noticer | D1 | C4 | Universal | Pair | Grounding | Your favorite thing to drink now makes you super smart. What is it and what do you want to know? |
| alive-64 | alive | alive | noticer | D1 | C1 | Youth | Group-safe | Playful | How will next year be different? |
| alive-1 | alive | alive | uplifter | D1 | C2 | Youth | Pair | Playful | Who's a real hero in your life? |
| alive-10 | alive | alive | uplifter | D1 | C2 | Universal | Pair | Playful | What advice might you give to someone who is sad? |
| alive-12 | alive | alive | uplifter | D1 | C3 | Universal | Pair | Playful | What is something you thought you couldn't do and you made it happen anyway? |
| alive-32 | alive | alive | uplifter | D1 | C2 | Universal | Pair | Playful | What advice would you like to give to someone younger than you? |
| alive-39 | alive | alive | uplifter | D1 | C3 | Universal | Pair | Playful | You get to change just one thing about the world. What is it? |
| alive-4 | alive | alive | uplifter | D1 | C3 | Universal | Pair | Playful | If you had one superpower that could change the world for good, what would it be? |
| alive-5 | alive | alive | uplifter | D1 | C2 | Universal | Pair | Playful | Who is the most supportive person in your life? |
| alive-51 | alive | alive | uplifter | D1 | C3 | Universal | Pair | Playful | If you could accomplish only one thing this year, what would it be? |
| alive_bonus-10 | alive_bonus | alive | brave_heart | D3 | C2 | Universal | Pair | Grounding | What do you consider difficult in life that is now easy? |
| alive_bonus-25 | alive_bonus | alive | brave_heart | D1 | C3 | Universal | Pair | Playful | What is something you thought you couldn't do and you made it happen? |
| alive_bonus-5 | alive_bonus | alive | brave_heart | D1 | C2 | Universal | Pair | Playful | Have you ever been the bully or been bullied? |
| alive_bonus-52 | alive_bonus | alive | brave_heart | D3 | C2 | Youth | Pair | Playful | You challenged someone in authority. What happened? |
| alive_bonus-20 | alive_bonus | alive | connector | D2 | C4 | Universal | Group-safe | Playful | Invite each person playing to think of a person, place or thing. Tell a story that includes all of them. |
| alive_bonus-24 | alive_bonus | alive | connector | D1 | C2 | Universal | Group-safe | Playful | My favorite game to play with my friends is __________ because __________. |
| alive_bonus-33 | alive_bonus | alive | connector | D1 | C2 | Universal | Group-safe | Playful | What does it mean to be a super friend? |
| alive_bonus-38 | alive_bonus | alive | connector | D1 | C2 | Universal | Group-safe | Playful | Who is the coolest person or group of people? |
| alive_bonus-40 | alive_bonus | alive | connector | D1 | C4 | Universal | Pair | Playful | What's something you've learned about a friend recently that surprised you? How did it make your friendship even stronger? |
| alive_bonus-11 | alive_bonus | alive | dreamweaver | D1 | C1 | Youth | Pair | Playful | What's something you've always wanted? |
| alive_bonus-14 | alive_bonus | alive | dreamweaver | D1 | C1 | Youth | Group-safe | Playful | Describe the perfect career. |
| alive_bonus-27 | alive_bonus | alive | dreamweaver | D1 | C2 | Universal | Pair | Activating | Way to go! You created the funnest job ever. What is it? |
| alive_bonus-29 | alive_bonus | alive | dreamweaver | D1 | C2 | Universal | Pair | Playful | Tonight you will have the craziest dream ever. What is it? |
| alive_bonus-31 | alive_bonus | alive | dreamweaver | D1 | C2 | Youth | Pair | Playful | How do you keep a dream ALIVE? |
| alive_bonus-45 | alive_bonus | alive | dreamweaver | D1 | C3 | Universal | Pair | Playful | Imagine you have a secret garden that only you can visit. What would it look like? |
| alive_bonus-49 | alive_bonus | alive | dreamweaver | D1 | C3 | Universal | Pair | Playful | Imagine you are a famous artist. What would you include in your art show? |
| alive_bonus-7 | alive_bonus | alive | dreamweaver | D1 | C3 | Universal | Pair | Grounding | In 5 years from now, you get nominated as the best player. What is the game? |
| alive_bonus-1 | alive_bonus | alive | explorer | D1 | C2 | Universal | Pair | Playful | What food do you wish was good for you? |
| alive_bonus-18 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | The circus just called. They want you to choose animals for their show. What comes to mind? |
| alive_bonus-2 | alive_bonus | alive | explorer | D1 | C2 | Universal | Pair | Grounding | What's a dance move you know, or one you want to learn? |
| alive_bonus-21 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | Imagine that you could be friends with ANY animal on the planet. What would you do together? |
| alive_bonus-22 | alive_bonus | alive | explorer | D1 | C2 | Youth | Pair | Playful | What's a "good" food you actually like? |
| alive_bonus-23 | alive_bonus | alive | explorer | D1 | C3 | Universal | Group-safe | Playful | If I could survive and only eat this one food, it would be ___________. Why? |
| alive_bonus-3 | alive_bonus | alive | explorer | D1 | C2 | Youth | Pair | Playful | You planted something in the ground. What happened? |
| alive_bonus-34 | alive_bonus | alive | explorer | D1 | C4 | Universal | Pair | Playful | You have your own 10 foot pet dragon. What did you name it and where do you take it? |
| alive_bonus-36 | alive_bonus | alive | explorer | D1 | C2 | Universal | Pair | Playful | What's a musical instrument you've always or never wanted to play? |
| alive_bonus-37 | alive_bonus | alive | explorer | D2 | C3 | Universal | Pair | Playful | Imagine that aliens are real. How do you think life on their planet is? |
| alive_bonus-41 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Activating | If you could build anything with Legos, what would you build, and how would it come to life? |
| alive_bonus-46 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | If you could take an adventure anywhere, where would you go, and what would you bring with you? |
| alive_bonus-47 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | Imagine you could taste a food that you've never tried before. What would it be? |
| alive_bonus-48 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Grounding | If you could touch anything in the world right now, what would you choose and why? |
| alive_bonus-51 | alive_bonus | alive | explorer | D1 | C1 | Youth | Group-safe | Playful | What is the perfect climate? |
| alive_bonus-56 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | If you could grow any plant in your backyard, what would it be? |
| alive_bonus-58 | alive_bonus | alive | explorer | D1 | C2 | Universal | Pair | Playful | What do you like to draw? How do you do it? |
| alive_bonus-6 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | Imagine you just got an award for creating the best game on the planet. What is it for? |
| alive_bonus-8 | alive_bonus | alive | explorer | D1 | C3 | Universal | Pair | Playful | Imagine you have to get there really fast. How do you get there? |
| alive_bonus-16 | alive_bonus | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | When have you been most excited to wake up in the morning? |
| alive_bonus-17 | alive_bonus | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | Something is happening, it's so exciting you can't sleep. What is it? |
| alive_bonus-19 | alive_bonus | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | It's a silly dance. One that makes you smile. What is it? |
| alive_bonus-26 | alive_bonus | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | What's the funniest thing that has ever happened to you? |
| alive_bonus-32 | alive_bonus | alive | grateful_spirit | D1 | C2 | Youth | Pair | Playful | What is your favorite movie of all time? |
| alive_bonus-39 | alive_bonus | alive | grateful_spirit | D2 | C2 | Universal | Pair | Reflective | What makes you feel excited to wake up in the morning? |
| alive_bonus-55 | alive_bonus | alive | grateful_spirit | D1 | C2 | Universal | Pair | Playful | What is your favorite tree or plant? What makes it special? |
| alive_bonus-4 | alive_bonus | alive | listener | D2 | C2 | Universal | Pair | Playful | What is something you think is not ok to ask someone? |
| alive_bonus-57 | alive_bonus | alive | listener | D1 | C2 | Universal | Pair | Playful | Imagine you're walking through a forest. What's the first thing you notice? |
| alive_bonus-12 | alive_bonus | alive | noticer | D1 | C2 | Youth | Pair | Playful | How does luck show up in your life? |
| alive_bonus-13 | alive_bonus | alive | noticer | D1 | C2 | Youth | Group-safe | Playful | What does it mean to be rich? |
| alive_bonus-15 | alive_bonus | alive | noticer | D1 | C3 | Universal | Pair | Playful | What is something you have watched or read more than once, and why? |
| alive_bonus-35 | alive_bonus | alive | noticer | D1 | C2 | Universal | Pair | Playful | When you look at a rainbow, what stands out to you? |
| alive_bonus-42 | alive_bonus | alive | noticer | D2 | C2 | Universal | Pair | Reflective | If your feelings were a color, what would they be? |
| alive_bonus-50 | alive_bonus | alive | noticer | D1 | C2 | Universal | Pair | Grounding | What is something cool you know how to do? |
| alive_bonus-53 | alive_bonus | alive | noticer | D2 | C2 | Universal | Pair | Playful | What do you think your parents are doing right or wrong? |
| alive_bonus-54 | alive_bonus | alive | noticer | D1 | C2 | Universal | Pair | Playful | What art do you find beautiful? How might you describe it? |
| alive_bonus-9 | alive_bonus | alive | noticer | D1 | C2 | Universal | Pair | Playful | Imagine you are a pet. What instructions should your owner give? |
| alive_bonus-28 | alive_bonus | alive | uplifter | D1 | C3 | Universal | Pair | Playful | What superpower energy would you like to have that you could teach to the world? |
| alive_bonus-30 | alive_bonus | alive | uplifter | D1 | C3 | Universal | Group-safe | Playful | The next time a bell rings somebody's dream will come true. What should it be? |
| alive_bonus-43 | alive_bonus | alive | uplifter | D1 | C4 | Universal | Pair | Playful | If you could help someone in a big way today, who would it be, and what would you do for them? |
| alive_bonus-44 | alive_bonus | alive | uplifter | D1 | C4 | Universal | Pair | Playful | If you could invent a new superpower, what would it be? How would you use it to help others? |
| og-41 | og | shared | apprecianado | D1 | C2 | Universal | Pair | Playful | What's a meaningful way that you give or receive gratitude? |
| og-42 | og | shared | apprecianado | D3 | C2 | Universal | Pair | Grounding | What have you considered difficult in your life that is now easy? |
| og-43 | og | shared | apprecianado | D1 | C2 | Universal | Pair | Playful | What would you put in a 30 minute vacation every day? |
| og-44 | og | shared | apprecianado | D1 | C2 | Universal | Pair | Playful | What is something you have watched or read more than once? Why? |
| og-45 | og | shared | apprecianado | D1 | C3 | Universal | Pair | Playful | Describe a time you've been in "flow" (where your heart and head were in sync). |
| og-46 | og | shared | apprecianado | D1 | C2 | Youth | Pair | Grounding | Do you know why you were born? |
| og-47 | og | shared | apprecianado | D1 | C1 | Youth | Pair | Playful | Describe a person you celebrate. |
| og-48 | og | shared | apprecianado | D1 | C3 | Universal | Pair | Playful | If you could ask one question of your ancestors, what would it be? |
| og-10 | og | shared | curiositor | D1 | C1 | Youth | Group-safe | Playful | Share a curious "first-time" experience. |
| og-11 | og | shared | curiositor | D1 | C3 | Universal | Pair | Playful | Aliens have landed on Earth. How would you direct them to learn about us? |
| og-12 | og | shared | curiositor | D1 | C4 | Universal | Pair | Playful | If you could add one key to your computer / tablet / phone, what would it be and what would you have it do? |
| og-13 | og | shared | curiositor | D1 | C4 | Universal | Pair | Playful | One of the wisest people on Earth is on hold waiting to talk to you. What question would you ask? |
| og-14 | og | shared | curiositor | D1 | C3 | Universal | Pair | Playful | There's one cookie, your favorite, left on the plate at the party, do you eat it? |
| og-15 | og | shared | curiositor | D1 | C3 | Universal | Pair | Playful | The doctor's office called: you no longer need any sleep. How is life different? |
| og-16 | og | shared | curiositor | D1 | C2 | Youth | Pair | Playful | What is a worthy investment of your time? |
| og-9 | og | shared | curiositor | D1 | C3 | Universal | Pair | Playful | If you only accomplished one thing with the time that remains in this year, what would it be? |
| og-1 | og | shared | facilitator | D2 | C4 | Universal | Pair | Playful | Share what you believe you are doing right. Ask others to share what they think you are doing right. |
| og-2 | og | shared | facilitator | D1 | C4 | Universal | Pair | Reflective | What is something others can rely on you for? Ask others for their reflection about you, then share your answer. |
| og-3 | og | shared | facilitator | D1 | C3 | Universal | Pair | Playful | Ask advice from the group. Each person playing may offer one sentence of advice to you. |
| og-4 | og | shared | facilitator | D1 | C3 | Universal | Pair | Playful | Share one thing you like about each person playing. (Be sure to include yourself.) |
| og-5 | og | shared | facilitator | D2 | C3 | Universal | Pair | Playful | What do you think everyone playing the game has in common? Invite everyone to share. |
| og-6 | og | shared | facilitator | D1 | C2 | Universal | Group-safe | Playful | Describe success. Invite others to each share one sentence. |
| og-7 | og | shared | facilitator | D1 | C1 | Youth | Pair | Playful | Describe someone who makes you smile. |
| og-8 | og | shared | facilitator | D2 | C3 | Universal | Pair | Playful | Describe one of your aspirations. Ask others to share why they think you may be called to it. |
| og-49 | og | shared | inspirator | D1 | C3 | Universal | Pair | Playful | If you could only improve one thing about yourself in your lifetime, what would it be? |
| og-50 | og | shared | inspirator | D1 | C4 | Universal | Pair | Playful | If you were told you had only one year to live, what would you do with this final year? |
| og-51 | og | shared | inspirator | D1 | C2 | Universal | Pair | Playful | If you knew you couldn't fail, what would you do (differently)? |
| og-52 | og | shared | inspirator | D4 | C2 | Universal | Facilitated-only | Playful | You've just broken through...what fear do you not have anymore? |
| og-53 | og | shared | inspirator | D1 | C3 | Universal | Pair | Playful | If you could change only one thing about the world, what would it be? |
| og-54 | og | shared | inspirator | D1 | C2 | Youth | Pair | Playful | Who is a real hero in your life? |
| og-55 | og | shared | inspirator | D1 | C2 | Youth | Pair | Playful | Describe a time when you felt inspired. |
| og-56 | og | shared | inspirator | D2 | C2 | Universal | Pair | Grounding | What is an idea you think everyone should know? |
| og-57 | og | shared | listener | D1 | C3 | Universal | Pair | Playful | Name one song that you turn up when you hear it and why. |
| og-58 | og | shared | listener | D1 | C2 | Youth | Pair | Playful | Has anyone ever shared one of your secrets? |
| og-59 | og | shared | listener | D1 | C2 | Universal | Pair | Playful | Someone is talking about you. What are they saying? |
| og-60 | og | shared | listener | D1 | C2 | Universal | Pair | Playful | Share a time when you sang to yourself or to someone else. |
| og-61 | og | shared | listener | D1 | C3 | Universal | Pair | Playful | If you could hear "I love you" from someone, from whom would it be most meaningful? |
| og-62 | og | shared | listener | D2 | C3 | Universal | Pair | Playful | Think of a project that you enjoy. Whose voice do you hear while doing it? |
| og-63 | og | shared | listener | D1 | C2 | Universal | Pair | Playful | What is something you would like others to ask you? |
| og-25 | og | shared | purveyor_of_love | D1 | C2 | Universal | Pair | Playful | What has most surprised you so far in your life? |
| og-26 | og | shared | purveyor_of_love | D1 | C3 | Universal | Pair | Playful | If you could change one thing about your health in the next month, what would it be? |
| og-27 | og | shared | purveyor_of_love | D1 | C1 | Youth | Pair | Playful | What's one of your pet peeves? |
| og-28 | og | shared | purveyor_of_love | D1 | C2 | Youth | Pair | Playful | What is something important that you've lost? |
| og-29 | og | shared | purveyor_of_love | D1 | C4 | Universal | Pair | Playful | Before they die, or you do, what is something that you want to say? What might be keeping you from saying it? |
| og-30 | og | shared | purveyor_of_love | D1 | C3 | Universal | Pair | Playful | Imagine that you are a pet. What care instructions should your owner give the pet sitter? |
| og-31 | og | shared | purveyor_of_love | D1 | C1 | Youth | Group-safe | Playful | Describe what deep friendship means. |
| og-32 | og | shared | purveyor_of_love | D1 | C3 | Universal | Group-safe | Playful | If I could perform one miracle for someone in my life, it would be... |
| og-17 | og | shared | self_aware | D1 | C2 | Youth | Pair | Playful | Share a time when you made a mistake. |
| og-18 | og | shared | self_aware | D1 | C2 | Universal | Pair | Playful | What's one thing you promised never to do that you did anyway? |
| og-19 | og | shared | self_aware | D1 | C2 | Universal | Pair | Playful | What's something you have been afraid to do or start? |
| og-20 | og | shared | self_aware | D1 | C2 | Universal | Pair | Playful | Where might you be playing too small in your life? |
| og-21 | og | shared | self_aware | D1 | C3 | Universal | Pair | Playful | What is something you've been holding onto that you want to let go? |
| og-22 | og | shared | self_aware | D1 | C2 | Universal | Pair | Playful | It's your last day on earth. Do you make your bed? |
| og-23 | og | shared | self_aware | D1 | C2 | Youth | Pair | Playful | When is the hardest you've ever worked? |
| og-24 | og | shared | self_aware | D1 | C2 | Youth | Pair | Playful | How do you define and protect your boundaries? |
| og-33 | og | shared | storyteller | D1 | C2 | Universal | Pair | Playful | What is a job that you always or never wanted to have? |
| og-34 | og | shared | storyteller | D1 | C2 | Universal | Pair | Playful | Name a time when your plans unexpectedly changed for the better. |
| og-35 | og | shared | storyteller | D1 | C1 | Youth | Pair | Playful | What wakes you up at night? |
| og-36 | og | shared | storyteller | D1 | C2 | Universal | Pair | Playful | What's something that you will never forget about a friend/sibling/parent/stranger? |
| og-37 | og | shared | storyteller | D1 | C2 | Youth | Pair | Playful | Have you ever been caught... What happened? |
| og-38 | og | shared | storyteller | D1 | C1 | Youth | Group-safe | Playful | Describe a "perfect" day. (sarcasm allowed) |
| og-39 | og | shared | storyteller | D1 | C1 | Youth | Group-safe | Playful | Describe a famous or favorite failure. |
| og-40 | og | shared | storyteller | D1 | C3 | Universal | Pair | Playful | If you were told you were performing stand-up comedy tonight, what would it be about? |
