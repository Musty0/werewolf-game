# WEREWOLF GAME — MASTER CONTEXT FOR CONTINUATION
### Read this entire document before writing any code. It is the single source of truth for every design decision made so far. Do not re-ask the user anything answered here — only ask about genuinely new gaps.

---

## 0. PROJECT IDENTITY

- **Game name:** Werewolf
- **Type:** Free, browser-based, no-install social deduction party game (Mafia/Werewolf variant) for in-person play — players use their own phones, all in the same room, voice chat happens out loud in real life (NOT in-app).
- **Hosting:** GitHub Pages (static site, no backend server)
- **Backend:** Firebase Realtime Database (free Spark plan) + Firebase Anonymous Auth
- **GitHub repo:** `Musty0/werewolf-game`, live at `https://musty0.github.io/werewolf-game/`
- **Firebase project:** `werewolf-a9450` (already created and configured by the user; rules already published once but WILL need re-publishing after this round of changes since new data paths are being added)
- **User's dev workflow:** VS Code with Live Server extension for local testing, GitHub Pages for live testing, no command line / git CLI — uses VS Code's Source Control panel (stage → commit → sync) exclusively.
- **Critical constraint:** the user is NOT a developer. Every instruction must be plain, exact, and assume zero prior knowledge of git/Firebase/dev tools.
- **Critical constraint:** the layout must NEVER require scrolling on any screen except inside modals/popups — this was a hard requirement from earlier in the project and must be preserved through this entire rebuild.
- **Critical constraint:** the experience must be pixel/behaviour-identical across all devices (iOS Safari, Android Chrome, desktop Chrome) — no responsive divergence in functionality, only scaling.
- **Visual aesthetic:** Confirmed and LOCKED — the user explicitly said "I like the aesthetic it's at right now." Do not redesign the colour palette or general look. It's a Salem-1692-at-night theme: cool dark slate background (`#23252b`), warm parchment/bone cards (`#e6ddc4`), muted blood-red accents (`#6b2420`), moonlight blue (`#93a6c4`), moss green (`#2f4a28`). Fonts: UnifrakturCook (blackletter title), IM Fell English / IM Fell English SC (body/labels), Caveat (handwritten accents). Cards look like nailed-up parchment notices with a small iron nail/pin at the top. A crescent moon + bare treeline decorate the background. Full CSS variable palette is in `css/style.css` — reuse it, don't replace it.

---

## 1. CURRENT BUILD STATUS — READ CAREFULLY

**This is the most important section.** The project has been through several iterations. As of this handoff:

### ✅ DONE and should be preserved/built upon:
- Overall page structure: fixed-viewport, no-scroll layout (`screen-header` / `screen-body` (scrolls internally only if needed) / `screen-footer` flex columns)
- Visual theme/CSS (corkboard/Salem aesthetic) — `css/style.css`
- PWA install support (`manifest.json`, icons in `icons/`)
- GitHub Pages SPA routing trick (`404.html` redirects `/lobby/CODE` deep links)
- Firebase Anonymous Auth wiring
- 13 role icon PNGs, hand-cropped and verified pixel-perfect at 200×200px, located at `img/roles/{rolekey}.png` (filenames: `villager.png`, `seer.png`, `sheriff.png`, `tracker.png`, `doctor.png`, `veteran.png`, `mayor.png`, `werewolf.png`, `mage-werewolf.png`, `poisoner.png`, `jester.png`, `amnesiac.png`, `pirate.png`)
- Background decoration assets: `img/moon.png`, `img/treeline.png`

### ❌ NOT YET DONE — this is the actual remaining work:
1. **`js/app.js` and `js/roles.js` are STALE.** They implement an EARLIER version of the ruleset (13 roles, but missing: correct Mage silence timing, Pirate's two-night declare/duel sequence, Poisoner's two-night poison/reveal sequence, the Among-Us-style voting screen, the all-times HUD redesign, the settings/host panel redesign, disconnect detection & host transfer, skip-vote, revote-tie random-pick animation, coin-toss animation, role popups everywhere, Hunt Rules role-popups grouped by team, max player validation warnings, spectator/dead player visual treatment). **Treat the existing JS as a rough skeleton to selectively reuse (Firebase wiring patterns, modal system, screen-switching) — NOT as a correct implementation of current rules.** A full, careful rewrite of the night/day resolution logic is required against Section 3 below.
2. **10 player avatar icons** — NOT yet generated/cropped. A prompt for generating them is in Section 5. Once generated, they need the same careful pixel-verified cropping process used for the role icons (see Section 6 for the exact method that works, including the mistakes made and how they were caught).
3. **Among Us-style voting screen** — not built at all yet. Full spec in Section 4.
4. **Top HUD redesign** — not built. Full spec in Section 4.
5. **Settings/host panel redesign** — not built. Full spec in Section 4.
6. **Disconnect detection + host transfer system** — not built. Full spec in Section 3.18.
7. **Role popup on click, everywhere (Hunt Rules, role chip, etc.)** — not built. Full spec in Section 4.

---

## 2. ORIGINAL DESIGN SPEC (verbatim, this is the foundational document — all Q&A below refines/clarifies this, never contradicts it unless explicitly noted)

\`\`\`
# Werewolf Party Game — Full Game Design Specification (Developer Handoff)

## Overview
Create a Werewolf-style party game for in-person play where players use their own phones/tablets.
The game should:
* Focus on social deduction.
* Be simple enough for a party.
* Have unique roles without excessive complexity.
* Use clear rules and edge-case handling.
* Allow strong roles but balance them through limitations.
* Avoid unnecessary hidden mechanics that are difficult to enforce physically.
The host controls the game setup manually.

# Lobby / Setup
## Host controls:
* Player count.
* Exact roles included.
* Number of Werewolves.
* Number of Neutral roles.
There is no automatic role balancing.

# Teams
## Villager Team — Goal: Eliminate all Werewolves.
## Werewolf Team — Goal: Reach control over the living players.
## Neutral Team — Goal: Complete their individual win conditions.

# Night System
Players perform actions privately through their device.
## Werewolf communication
At night: Werewolves wake up, see each other, know who other Werewolves are, coordinate.
Rules: Werewolves know Mage Werewolf. Poisoner is not known by Werewolves. Werewolves do not know Poisoner.

# Night Resolution Rules
General order: 1. Players submit night actions. 2. Effects are calculated. 3. Protection/blocking/deaths resolve.
Multiple deaths can happen in the same night.

# Death / Spectator System
When a player dies: They become a spectator.
They can: See all player roles. See all night actions. See results.
They cannot: Vote. Use abilities. Influence living players.
There is: No dead chat. No in-game chat system.

# Role Reveal
When a player dies: They may choose whether to reveal their role.
If revealed: Their role is permanently shown in game history. Players can reference it later.
If hidden: The role remains unknown.

# Voting System
During daytime: Players vote to eliminate someone.
## Tie rule: If there is a tie: No elimination happens immediately. Revote occurs. Only tied players can be voted for.
Example: Alice: 4 votes, Bob: 4 votes, Charlie: 1 vote. Revote: Only Alice and Bob.

# Host Controls
Host can: Pause timer. Resume timer.
Uses: Voting arguments. Player discussions. Technical issues. General pauses.

# WIN CONDITIONS
## Werewolves win when: Werewolves have control of the remaining players.
Example: Alive: Werewolf, Werewolf, Villager. Werewolves win.
## Villagers win when: All Werewolves are eliminated.
## Neutral priority: Neutral roles do not automatically override Werewolf victory.
Example: Final 2: Poisoner, Werewolf. Result: Werewolves win.

# FINAL ROLE LIST — Total roles: 13

# VILLAGER ROLES

# Villager — Team: Villager — Ability: None. Rules: No night action. Only discussion and voting.

# Seer — Team: Villager — Ability: Once per game.
Night action: Choose exactly 4 living players.
Result: Learns exactly how many selected players are evil.
Example: Chosen: Alice, Bob, Charlie, Dave. Result: "1 of these players is evil."
Rules: Does not reveal who. Only reveals the number [SUPERSEDED BY Q&A — see Section 3.5, now binary not a number]. Cannot use if 3 or fewer players remain. Cannot select themselves.

# Sheriff — Team: Villager — Ability: Once per game.
Night action: Shoot one player.
Rules: If target is Werewolf: Target dies. If target is anything else: Sheriff dies.
Important: Neutral roles count as wrong. Cannot shoot themselves.

# Tracker — Team: Villager — Ability: Once per game.
Night action: Choose one player.
Result: Learns if they left home. Possible results: "Visited someone" or "Stayed home"
Rules: Does not reveal role. Does not reveal target. Only detects activity.

# Doctor — Team: Villager — Ability: Every night.
Night action: Protect one player. Protects against: Werewolf attack. Poison.
Rules: Can protect themselves. Can protect same player repeatedly.
Doctor can save: Villagers. Werewolves. Neutral roles.

# Veteran — Team: Villager — Ability: Once per game.
Night action: Activate Alert. Rules: Alert is hidden. Anyone who visits Veteran dies.
Examples: Werewolf visits: Werewolf dies. Seer visits: Seer dies [SUPERSEDED — see Q&A #53, Seer does NOT die visiting Veteran]. Doctor visits: Doctor dies. Tracker visits: Tracker dies.
Doctor protection can prevent these deaths.

# Mayor — Team: Villager — Ability: Passive.
Rules: Has 2 votes during voting. Identity is hidden. Not revealed.
If dead: Vote does not exist.

# WEREWOLF ROLES

# Werewolf — Team: Werewolf — Ability: Night kill.
Rules: Cannot target another Werewolf. Their own teammates do not appear as targets.

# Mage Werewolf — Team: Werewolf — Ability: Once per game.
Night action: Silence one player. Effect: Their ability fails that night [SUPERSEDED — see Q&A, silence takes effect the FOLLOWING day+night, never the current night].
Rules: Can target themselves. Does not stop talking. Does not stop voting [SUPERSEDED — silenced player CANNOT vote following day]. Does not stop Werewolf kill.
Examples: Targets Doctor: Doctor cannot save [following night]. Targets Seer: Seer cannot inspect [following night].

# NEUTRAL ROLES

# Poisoner — Team: Neutral — Ability: Once per game.
Night action: Poison one player. Effect: Target dies later unless cured.
Doctor: Can remove poison.
Win condition: Must survive into the final 2 players.
Rules: Poisoner vs Villager: Poisoner wins. Poisoner vs Werewolf: Werewolves win.
Successfully poisoning someone does not automatically win.

# Jester — Team: Neutral — Ability: None.
Win condition: Must be voted out during daytime.
Does not win if: Killed at night. Shot. Poisoned.

# Amnesiac — Team: Neutral — Starting state: No role. No ability. No faction.
Ability: Once per game. Requirement: At least one player must have died.
Night action: Choose one dead player.
Important: The Amnesiac does NOT know their role before choosing.
After choosing: Learns their original role. Becomes that role.
Example: Choose dead player. Result: "They were Seer." Amnesiac becomes Seer.
## Amnesiac can become: Villager, Seer, Sheriff, Tracker, Doctor, Veteran, Mayor, Werewolf.
## Amnesiac cannot become: Poisoner, Jester, Pirate [also cannot become Amnesiac, confirmed in Q&A].

# Pirate — Team: Neutral — Ability: Once per game.
## Preparation phase: Before attacking: Pirate spends one day preparing. During preparation: Cannot speak. Cannot vote [SUPERSEDED — Q&A final answer: Pirate acts NORMAL during prep, no forced silence/vote-block, to keep their identity hidden — see Section 3.7].
## Duel phase: Following night [SUPERSEDED — now TWO nights later per Q&A sequence, see Section 3.7]: Pirate selects one player. Coin toss: Pirate wins: Target dies. Target wins: Pirate dies.
## Interactions: Doctor: Can save Pirate target. Veteran: Pirate dies if visiting Veteran on Alert. Tracker: Can detect Pirate leaving home. Mage Werewolf: Can block Pirate action.
## Duel cancellation: If Pirate target is eliminated before the duel: Example: Target is voted out during the day. Result: Duel cancelled. No coin toss. Pirate survives.

# Removed Roles — Do not include:
Investigator, Psychic, Vigilante, Bodyguard, Tavern Keeper, Monarch, Jailor, Crusader, Executioner,
Serial Killer, Arsonist, Shroud, Vampire, Guardian Angel, Blackmailer, Hypnotist, Witch, Potion Master,
Retributionist, Survivor.
Reasons: Too complex. Too similar to existing roles. Too powerful. Difficult to enforce. Conflicts with spectator/death rules.

# End of Specification
Implement this as the current source of truth. Do not add assumptions without asking.
\`\`\`

---

## 3. CONSOLIDATED, FINAL RULESET (this OVERRIDES the original spec wherever they differ — built from the full Q&A exchange)

### 3.1 Night resolution order (CONFIRMED — use this exact order)
1. Apply any silence that is currently active (silence cast 1+ nights ago, see 3.6)
2. Doctor protection submitted
3. Veteran alert resolves — anyone who "visited" the Veteran dies (unless Doctor protected them); **if Werewolves target the Veteran while Veteran is on alert, the Werewolves die from the alert and the wolf-kill on the Veteran is CANCELLED** (alert cancels wolf kill — Q&A #48)
4. Werewolf kill resolves (Doctor can save)
5. Sheriff shoot resolves (hit = Werewolf-team target dies; miss = Sheriff dies always, Doctor CANNOT save Sheriff backfire — this is the ONLY case Doctor cannot save)
6. Pirate duel resolves, only on the correct night (see 3.7) — coin toss, Doctor can save the losing side regardless of who loses (Q&A #146/147: if Pirate would lose but Doctor protected Pirate, Pirate survives; if Pirate wins, Doctor protecting Pirate is irrelevant/no-op)
7. Poison from a previous night takes effect (delayed kill, see 3.8) — Doctor can save (permanent cure, not just delay)
8. New poison is applied (announced publicly next day per 3.8, doesn't kill yet)
9. Amnesiac adoption resolves (instant — if they adopt Werewolf, they ARE a Werewolf from this moment, existing Werewolves know immediately, see Q&A "n")
10. Tracker result computed
11. Seer result computed (binary only — see 3.5)

If the host needs to adjust this order for an edge case not covered, default to: **kills/deaths resolve before information-gathering results are computed**, and **Doctor's protection always overrides any kill that targets the protected player that same night, full stop, except Sheriff backfire**.

### 3.2 Werewolves
- Standard team headcount, host-configurable (stepper), minimum 1.
- Cannot target a teammate for the kill.
- Multiple Werewolves vote together; majority wins; if their votes split with no majority, no kill happens that night (acceptable, "use your best judgement" was the answer — this was confirmed as fine).
- If the Werewolf(s) who SUBMITTED the kill vote are silenced, the kill still happens — **silence never blocks the Werewolf kill** (Q&A #8/#26: "even if silenced they can still vote to kill, hard enough to win as werewolves as it is").
- Two Werewolves targeting the same person as Sheriff/other roles = person dies once, not twice (Q&A #10).
- If Werewolves kill the last non-wolf, Werewolves win immediately, checked after deaths resolve (Q&A #13).
- **Order priority over Pirate:** if Werewolves kill the Pirate the same night the duel would happen, the duel does NOT happen — Werewolf kills always take priority/happen first (Q&A's very first clarifying answer: "werewolf kills always happen first so they take priority — duel doesn't happen").

### 3.3 Mage Werewolf (optional role, max 1, single Werewolf-team member with this specific role)
- Other Werewolves know who the Mage Werewolf is (shown in their "pack" list in-game). Poisoner is NEVER known to Werewolves, and Mage Werewolf doesn't know Poisoner either.
- Once per game, silences one player (can target self).
- **CRITICAL TIMING RULE, finalised and locked:** Silence cast on night N does NOT affect night N. It takes effect the FOLLOWING day (day N+1, cannot vote) and the FOLLOWING night (night N+1, cannot submit any night action). After that one day+night, the silence expires completely (Mage can't recast — once per game).
- A silenced player's "cannot vote" is enforced in the UI (vote buttons disabled/hidden) the day after being silenced.
- A silenced player's "cannot speak" is NOT enforced in-app (impossible to enforce digitally) — it's an honour-system instruction for real life. Show a visual "silenced" icon by their name/icon so the group can see and remind them.
- If Mage silences themselves: same timing rule applies to them too — they lose their OWN vote and night actions the following day+night (but their silence ability was already a one-time use, already consumed by submitting it).
- If silence is cast the same night someone was already poisoned (poison applied night N-1, due to resolve night N): the poison still applies even though the poisoned player might be silenced that same night — silence doesn't cancel already-pending poison (Q&A #19).

### 3.4 Doctor (optional role, max 1)
- Acts EVERY night (not once-per-game) unless silenced or dead.
- Can protect self. Can protect the same person repeatedly.
- Can protect ANY player regardless of team (Villager, Werewolf, Neutral) — Doctor doesn't know roles, just picks a name.
- Protection blocks: Werewolf kill, poison (permanently cures it, not just delays — Q&A #98/#111 "permanent"), Veteran-alert death (if the protected player is the one who visited Veteran), Pirate duel loss (for either the Pirate or the duel target, see 3.7).
- Protection does NOT block: Sheriff backfire (the one and only exception, Q&A #38/#60 confirmed explicitly).
- If Doctor protects the Veteran while Veteran is on alert, and Doctor is the one visiting (i.e. Doctor's own protection target is the Veteran), the **Doctor still dies** — protecting the Veteran doesn't exempt the Doctor from the "anyone who visits Veteran dies" rule, because Doctor's protection ability doesn't apply to the Veteran's alert-kill on the visitor themselves unless someone ELSE protects that specific visitor. Re-read Q&A #44/#45 — actually #45 says "doctor overrides all kills so they survive as saved themselves" — **meaning if Doctor protects THEMSELVES and then visits Veteran, Doctor survives** (self-protection counts). If Doctor protects someone else (not themselves) and Doctor visits Veteran, Doctor dies (no one protected the Doctor). This needs to be implemented carefully: Doctor visiting Veteran dies UNLESS Doctor's protection target this night was themselves.
- If two things would kill the same person the same night (e.g. Werewolf kill + Veteran alert both target the same victim), and Doctor protected that victim, Doctor's protection blocks ALL of it — "doctor overrides any kill... that person shouldn't die" (Q&A #42).

### 3.5 Seer (optional role, max 1)
- Once per game. Picks EXACTLY 4 players (can include dead players, see 3.10 for UI implications). Cannot pick self. Cannot use if ≤3 players currently alive (since they need 4 valid targets... actually re-read: spec says cannot use with 3 OR FEWER alive, and they need to pick 4 which can include dead people — so this constraint is really about needing at least 4 total players in the game to have ever picked from, not just currently-alive. Use total players-in-game ≥ 4 as practically the floor; the "3 or fewer alive" wording from the original spec should be interpreted generously since dead players are valid picks too. Implement literally as: must have at least 4 players total (alive+dead) in the lobby to use the ability at all, which is already guaranteed since minimum lobby size is 4).
- **Result is BINARY ONLY, never a count.** "At least one of your 4 chosen is a Werewolf" OR "None of your 4 chosen are Werewolves." This includes Mage Werewolf and any Amnesiac-who-became-Werewolf as counting toward "evil" (Q&A #89/#90).
- Result is private to the Seer only. They may choose to say it out loud in real life — the app does not auto-broadcast it.
- Seer does NOT die from visiting Veteran on alert, even though they "visit" via picking — explicit override confirmed (Q&A #53: "no seer wouldn't die"). This is a deliberate spec exception — the Seer's group-inspect action does not count as a Veteran-visit for death purposes, ONLY for Tracker-detection purposes (a Tracker checking the Seer would see "visited someone" since they submitted an action).
- If one of the Seer's 4 picks dies the same night before the result is computed, they're still counted toward the evil/not-evil result by their role regardless of alive/dead status at time of death (Q&A #95 "still counted").

### 3.6 Sheriff (optional role, max 1)
- Once per game. Shoots one living player. Cannot shoot self.
- Hit (target is on Werewolf team, including Mage Werewolf and Amnesiac-turned-Werewolf): target dies, Doctor CAN save the target (Q&A #58).
- Miss (target is anyone NOT on Werewolf team — Villager-team, Neutral, anyone): **Sheriff always dies, Doctor CANNOT prevent this, no exceptions** (Q&A #38, #59, #60 — this is the single confirmed exception to "Doctor can save anyone").
- If Sheriff's target died earlier the same night from something else (e.g. Veteran alert, Werewolf kill), the shot fails silently — no hit, no backfire, ability is still marked as used (Q&A #3 "yes, should cancel shot").
- If Sheriff is on the Veteran's alert and visits Veteran by targeting them: Sheriff dies from the alert visit, not from the shot mechanic — Veteran is NOT a Werewolf so technically this would also "backfire" but the visit-death takes priority/is the same outcome either way (Q&A #51/#70/#71: "shot" — sheriff dies either way because wrong target, confirmed visiting Veteran = dies, consistent outcome).

### 3.7 Pirate (optional role, max 1) — REVISED MULTI-NIGHT SEQUENCE (this is the most complex revision from the original spec)
**Final confirmed sequence:**
1. **Night N:** Pirate, acting completely normally (no forced silence, no vote restriction, NOT distinguishable from any other player that night), submits their night action: declares intent to duel and picks their target. This is private — nobody else knows yet.
2. **Start of Day N+1 ("Morning Report"):** The game publicly announces "A duel has been declared. Tonight, [Target Name] will face an unknown challenger." — **the Pirate's own identity is NEVER revealed, only the target's name.**
3. **Day N+1:** Normal discussion and voting happens. If EITHER the Pirate or the announced target is voted out this day, the duel is cancelled silently (no coin toss, survivor(s) just continue normally) (Q&A #142, #144 "yes duel does not happen" if pirate visits Veteran/dies first).
4. **Night N+1 (the night immediately after the announcement):** If both Pirate and target are still alive, the duel resolves — coin toss. **Doctor, having had the full Day N+1 to decide, can choose to protect the target (or the Pirate) that night.**
5. Coin toss outcome: Pirate wins → target dies (unless Doctor protected target, in which case "the pirate wouldn't die either way then" — wait, re-read Q&A #146: "pirate wouldn't die either way then" was the answer to "if Pirate wins coin toss, does Doctor protecting Pirate matter" — answer: irrelevant, Pirate already wasn't going to die since they won. If Pirate LOSES (target wins) and Doctor protected the PIRATE, "pirate survives since doctor saved" (Q&A #147). If Doctor protected the TARGET and Pirate wins, target survives (Q&A #145 "yes").
- **Self-targeting:** Pirate cannot target themselves (Q&A #156 "no").
- **Can target a Werewolf:** yes (Q&A #157 "yes").
- **If Pirate dies (any cause) before the duel night:** duel is cancelled silently, the public Day N+1 announcement may have already happened (target named) but nothing further occurs — no coin toss (Q&A #11/#21/#160 "cancelled").
- **If both Pirate and target survive Day N+1 but then BOTH die from unrelated causes the same Night N+1 the duel was supposed to happen** — Werewolf kills take priority/happen first per 3.1 order, so if Werewolves kill the Pirate that same night, duel is cancelled (3.2 last bullet).
- **If Pirate wins the duel AND also dies that same night from Werewolves/poison**, both deaths are real — target died from the duel, Pirate ALSO died from the other cause (Q&A #149/#150 "yes both target and pirate would die then").
- **Win condition:** Pirate's only loss condition is dying. If Pirate is alive when the game ends (whenever Town/Werewolf win condition triggers, or simply game reaches a natural end with Pirate alive), Pirate wins ALONGSIDE whichever team would otherwise be celebrating — e.g. alongside Villagers if Town wins, but per Q&A #153 "werewolf wins" takes priority if Werewolves are the ones who win (i.e. Pirate does NOT win alongside Werewolves — only alongside Town/Villagers). Per Q&A #155 "use your best judgement" for Pirate vs Poisoner final 2 — judgement call made: **Poisoner's survivesToFinal2Win takes priority over Pirate's "alive at game end" win**, so if Poisoner is also alive at the end, Poisoner wins (and Pirate does NOT also win in that specific final-2-vs-Poisoner scenario, since Poisoner winning means town did NOT win, and Pirate only wins "alongside Villagers"). If Pirate is literally the sole survivor with nobody else alive, they win alone (Q&A #159 "they can do that if they like, they'd win alongside villagers even being a neutral" — meaning solo survival still counts as a town-adjacent win for the Pirate).
- **Coin toss is a simultaneous animation** shown on all players' screens at the end of the night, 2-3 seconds, with explanatory text so it's clear what's being decided (NOT just an unexplained random animation) — e.g. "⚔️ The Pirate has challenged [Target Name] to a duel. The coin is cast..." → spin animation → "The Pirate wins — [Target Name] does not survive." or "The challenger falls — the Pirate does not survive." **Never name the Pirate, only the target.**

### 3.8 Poisoner (optional role, max 1) — REVISED ANNOUNCEMENT SEQUENCE
- Once per game only — cannot poison more than once (Q&A #106).
- **Sequence mirrors the Pirate's:** Night N, Poisoner secretly picks a target. **Start of Day N+1 ("Morning Report"): publicly announce "[Target Name] has been poisoned." — show a poison icon by that player's name/icon for the rest of the game (or until cured). The Poisoner's own identity is NEVER revealed (unless they later die and personally choose to reveal their own role, same as anyone).**
- Doctor has the rest of Day N+1 to decide whether to protect the poisoned target that Night N+1.
- Night N+1: if Doctor protected the target, poison is cured PERMANENTLY (Q&A #98/#111). If not protected, target dies Night N+1 from the poison.
- If the poisoned target dies from a DIFFERENT cause before Night N+1 (e.g. voted out Day N+1, or killed by Werewolves same night poison was applied — wait, re-read: poison takes effect the NEXT night, so same-night-as-poisoning deaths from other causes would make the poison redundant/moot for that player, just clear the pending poison silently, no double-kill messaging needed).
- If the Poisoner themselves dies before the poison resolves, the poison still kills the target on schedule (Q&A #100 "yes poison still kills").
- **Win condition:** survive to exactly the final 2 players alive. In the final 2: Poisoner vs Villager-team → Poisoner wins. Poisoner vs Werewolf-team → Werewolf wins (Poisoner loses). Poisoner vs Jester → Poisoner wins (Q&A #110). Poisoner vs Pirate → Poisoner wins (Q&A #109, judgement call, consistent with Poisoner generally beating any non-Werewolf in the final 2). Poisoner vs another Poisoner is impossible (max 1 per role).
- Game continues normally (does not end) if Poisoner dies and there are still other Villagers/Neutrals alive and the Werewolf win condition hasn't triggered — Poisoner dying isn't a special trigger (Q&A #12).

### 3.9 Jester (optional role, max 1)
- No night action, no ability.
- Wins ONLY if voted out during the day (first vote OR the revote — both count, Q&A #112/#113).
- Does NOT win if killed at night by any means: Werewolf kill, Sheriff shot, poison, Veteran alert, Pirate duel (Q&A #114-121 "use your best judgement" — judgement made: ALL non-vote deaths fail to trigger Jester's win, consistently with the spec's explicit "does not win if killed at night, shot, or poisoned").
- If voting out the Jester ALSO would satisfy a simultaneous Werewolf win condition (e.g. final 3 = Jester + 2 Werewolves, town votes out Jester) — **Jester wins** (Q&A #122 "jester wins" — the act of being voted out is checked/resolved before the resulting board state's win condition would otherwise crown Werewolves; Jester's win is immediate and takes priority over a simultaneous Werewolf-numbers win in this specific case).

### 3.10 Tracker (optional role, max 1)
- Once per game. Picks one player (dead or alive — though practically should be alive since the point is detecting that NIGHT's activity; UI should probably only allow picking living players since dead players can't act. Use best judgement: restrict Tracker's target list to living players only).
- Result: "visited someone" (they submitted SOME night action that round, regardless of role/type) or "stayed home" (they had no night action, e.g. a Villager, a role that's already used their one-time ability, or someone silenced that night).
- Does not reveal WHO they visited or their role — purely binary activity detection.
- If Tracker tracks someone who is on Veteran's alert and that someone visited the Veteran specifically — that's irrelevant to the Tracker's own result about their own target; if the TRACKER THEMSELVES visits the Veteran (picks the Veteran as their tracked target), Tracker dies from the alert (explicitly stated in original spec example, never overridden) — but does the Tracker's result still get computed despite dying? Use best judgement: yes, still show them the result as a spectator (harmless, matches how Seer's result is "still counted" even amid deaths).

### 3.11 Veteran (optional role, max 1)
- Once per game. Activates "Alert" — no target needed, just a confirm button. Hidden from everyone (the group doesn't know who's on alert, or even that anyone is, until someone dies from it).
- Anyone who "visits" the Veteran that night (submits any night action targeting the Veteran) dies, UNLESS Doctor protected that specific visitor (or the visitor protected themselves if the visitor IS the Doctor).
- If Werewolves target the Veteran while on alert: this is a "visit" — the Werewolves who submitted that kill vote die from the alert, AND the wolf-kill itself is cancelled (alert cancels the wolf kill outcome on the Veteran — Veteran does NOT die from the werewolf attack in this scenario, only the visiting wolves die) (Q&A #48).
- Seer does NOT die from visiting (explicit override, see 3.5).
- If nobody visits, the ability is simply used up with no effect (Q&A #43, confirmed, ability marked as used regardless of outcome).
- Only one Veteran possible in the game (Q&A #56, true of all non-Werewolf/non-Villager optional roles — exactly one of each, see 3.16).

### 3.12 Mayor (optional role, max 1)
- Fully passive. No night action, no button, no UI prompt ever.
- Vote always counts as 2, completely hidden — Mayor's identity is NEVER revealed even if they die and choose to "reveal role" (re-check this: original death-reveal mechanic lets ANY dying player choose to reveal — does this apply to Mayor too, or is Mayor's identity permanently secret even post-death? The spec says "Identity is hidden. Not revealed." with no death exception carved out, unlike other roles. SAFEST READING: Mayor CAN still choose to reveal-on-death like anyone else per the universal death-reveal mechanic (Q&A point 4), since the "not revealed" language refers to their vote-weight being a SECRET MECHANIC during life, not a permanent ban on ever disclosing their role posthumously. Implement consistently: Mayor gets the same death-reveal choice as every other role.)
- If Mayor dies, their double-vote is simply gone — remaining votes are normal (Q&A #162).
- Mayor's double vote applies during the revote too (Q&A #164/#174).
- Mayor can vote for themselves (Q&A #166, true for everyone — confirmed any player can self-vote, no rule against it).

### 3.13 Amnesiac (optional role, max 1)
- Starts with NO role, no team, no ability — just a Villager-presentation player with a hidden special status, until they adopt.
- Once per game, ONLY after at least 1 player has died. Picks a dead player (Q&A #177 "yes, anyone that's dead"). Does NOT know that dead player's role before picking — it's a gamble (Q&A #177 explicit reminder).
- Cannot adopt: Poisoner, Jester, Pirate, or another Amnesiac.
- Can adopt: Villager, Seer, Sheriff, Tracker, Doctor, Veteran, Mayor, Werewolf, Mage Werewolf (the original spec list didn't mention Mage Werewolf explicitly but there's no reason to exclude it given the general werewolf-team exception list — include it as adoptable).
- The moment they adopt, the change is IMMEDIATE and PERMANENT for the rest of the game — if they adopt Werewolf, they instantly become a full Werewolf-team member, the existing Werewolves are notified immediately (shown in their "pack" list from that point on) (Q&A "n": "they become werewolves immediately, so existing werewolves will also know they joined").
- If they adopt a once-per-game role (Seer, Sheriff, Tracker, Veteran), they get a FRESH, unused copy of that ability — they can use it on a future night (not the same night they adopted — adoption happens at the end of night resolution, after all other actions for that night already resolved, so the earliest they could use their new ability is the following night).
- If they adopt Doctor, they get full unlimited nightly protection from the next night onward.
- If they adopt Mayor, they get the hidden double-vote from the next day's vote onward.
- Until they adopt, Amnesiac plays/votes as an ordinary Villager-presentation player with no special win condition of their own (they ride along with whichever team they end up on, or stay a plain Villager forever if they choose never to adopt or run out of opportunity) (Q&A #137/#159-adjacent "they can do that if they like, they'd win alongside villagers even being a neutral" — actually that quote was about Pirate, but the same logic applies: an Amnesiac who never adopts effectively wins/loses alongside Town since they have no other win condition).

### 3.14 Villager
- No ability, no night action. Just discussion + voting. The default/filler role for any player not assigned an optional role.

### 3.15 Win conditions — final consolidated logic
1. Check Werewolf win FIRST, always, even amid simultaneous deaths: if after a night's resolution (or a day's vote) the number of living Werewolf-team members is ≥ the number of living non-Werewolf players, **Werewolves win**, regardless of what else happened that same round (Q&A #169 "possibly the order, so if werewolves die alongside everyone else werewolves still win" — meaning: compute the FINAL state after ALL of that round's deaths are applied, then check Werewolf-numbers; if Werewolves still meet/exceed the threshold in that final state, they win even if some Werewolves also died that round, as long as enough non-wolves also died to keep the ratio in the wolves' favour. And Q&A #180 "werewolves win" — explicit confirmation for the scenario of literally everyone dying simultaneously, Werewolves still take the win in that edge case, i.e. Werewolf win is checked even in a full-wipe scenario as long as the wolf:non-wolf ratio at time of the wipe was ≥1:1. Use this exact priority order:**
   - **Step A:** After all deaths for the round are computed, build the resulting alive-player list.
   - **Step B:** If alive Werewolf-team count ≥ alive non-Werewolf count (and alive Werewolf count > 0), Werewolves win. (This correctly also handles "everyone died" since 0 ≥ 0 — wait, if EVERYONE dies including all werewolves, alive Werewolf count = 0, so this condition would be false (0 ≥ 0 is technically true if non-wolf count is also 0!). Re ad Q&A #180 again: "werewolves win" was the answer to a scenario where literally all remaining players die simultaneously. So even 0 wolves vs 0 others should resolve to Werewolf win per the user's explicit ruling. Implement as: if alive Werewolf count ≥ alive non-Werewolf count, Werewolves win — this naturally covers the 0-vs-0 edge case correctly without special-casing it, AS LONG AS you check this BEFORE checking "all Werewolves eliminated = Town wins". Order matters: check Werewolf-win condition first, only if it's false do you then check Town-win.
   - **Step C:** If Werewolf-win condition is false (i.e., alive Werewolf count < alive non-Werewolf count) AND alive Werewolf count = 0, then: if alive count = 2 and the survivor (other than... wait there's only 2 alive total at this point) includes a survivesToFinal2Win role (Poisoner), that role wins instead of Town. Otherwise (no surviving Poisoner, or more than 2 alive with 0 wolves), **Town/Villagers win** — and Pirate (if alive) wins alongside them, and Amnesiac (if never adopted, still plain Villager-presentation) wins alongside them too.
   - **Step D:** Jester's win is a special immediate trigger checked at the moment of being voted out (day vote or revote only), independent of/prior to the above — if Jester is voted out, game ends immediately with Jester as winner, no further win-condition checks needed for that round.
2. Recheck win conditions after EVERY death-causing event resolves (end of night resolution, end of day vote, end of revote) — never mid-resolution.

### 3.16 Role count limits
- Exactly one of each optional role can be active per game: Seer, Sheriff, Tracker, Doctor, Veteran, Mayor, Mage Werewolf, Poisoner, Jester, Amnesiac, Pirate (confirmed repeatedly, e.g. Q&A #56, #108, #179).
- Werewolf (base) has a host-configurable headcount stepper, minimum 1, no fixed max other than the balance constraint below.
- Villager has no count control — it's just whatever's left over after all other roles are assigned.
- Minimum lobby size to start a game: 4 players (existing validation, keep).
- Minimum role requirement: at least 1 Werewolf-team role AND at least 1 Villager-team role must be in any valid configuration (Q&A #170: "host picks roles, but there has to be minimum of 1 werewolf minimum of 1 villager faction role").
- **Maximum player count: 10** (Q&A #14 "maximum player count you suggest, if it's able to handle 10 then do 10"). Enforce this as a hard cap — if an 11th person tries to join a lobby that already has 10 players, block them with a clear message (e.g. "This lobby is full (10/10).") (Q&A #14 final sentence).
- Host should see a live warning if their role selection would be unbalanced/invalid for the current player count (already partially implemented via `validateSettings` — extend the UI to show the warning in real time as they toggle, not just block the Start button).

### 3.17 Voting system
- Day vote: simple plurality, weighted by Mayor's hidden 2x (if Mayor is alive and not silenced — wait, can a silenced player vote? NO — see 3.3, silenced = cannot vote that day; if Mayor happens to be silenced, normal handling: a silenced Mayor simply cannot vote at all that day, double-vote moot since they have zero votes that day).
- **Skip vote option** — explicit "Skip" choice in the vote list, same as Among Us. Counts toward determining if the round results in elimination or not — if Skip "wins" the plurality, no elimination that day (Q&A "m": "skip vote means no elimination, just like among us").
- **Auto-skip on timeout** — if a player does not vote before the timer expires, their vote defaults to Skip (Q&A "i": "failing to vote within the time limit defaults to skip vote").
- **Tie handling:** if the top vote-getters are tied (excluding Skip, presumably — but what if Skip ties with a player? Use best judgement: treat Skip as a normal "candidate" for tie-detection purposes too, so a Skip/Player tie also triggers a revote, with Skip remaining an eligible "candidate" in the revote alongside the tied player(s)), trigger a revote where ONLY the tied options (which may include Skip) are selectable. Votes from the first round are cleared/reset for the revote — players vote fresh.
- **Revote MUST produce an elimination** — re-read Q&A #11 carefully: "for revote there HAS to be an elimination so if its still a tie then it becomes a random select (i wouldve said coin toss but lets say theres 3 people in the revote, you cant have coin toss for 3 people)". This means: if the REVOTE also ties, do NOT allow a second indefinite revote loop — instead, randomly select one of the tied candidates from the revote and eliminate them. **EXCEPTION/CLARIFICATION NEEDED IN NEXT CHAT: does this apply even if "Skip" is one of the tied revote options? E.g., if revote ties between [Skip, Alice], does random-select potentially "eliminate" Skip (meaning no elimination happens, chosen by chance) or does it force an elimination of a PLAYER specifically? This was not explicitly clarified — RECOMMEND defaulting to: if Skip is part of the final random pool, it's a valid random outcome (no elimination that day), since the user's core skip-vote feature should remain meaningfeing in the revote too. But if you want a stricter "revote must eliminate a player" reading, that's also defensible. ASK THE USER if it matters before finalizing — flagged as the one remaining genuine ambiguity in the voting spec.**
- The random-pick (revote-tie-breaker) is shown as a simultaneous animation on all screens — "The town cannot decide... Fate will choose." → spin/random-pick animation → "[Name] has been chosen." (Q&A #11 follow-up: "visually shown as some animation, probably random pick animation", confirmed plays on everyone's screens simultaneously).
- Both normal-elimination and random-pick-elimination outcomes are visually presented as just a normal death afterward — no special "this was random" framing needed beyond the announcement that fate chose them (Q&A #10/last item: "in both cases i just want it normal death").
- **Among Us-style vote visualisation (reference image provided by user):** every player has a coloured icon (Section 4 below). When you vote for someone, your coloured icon appears next to/under their name. This is visible to everyone, live, during the vote (not just at the end). Dead players' historical votes from past rounds still show (greyed out / muted, but visible) somewhere accessible (likely in the log or a "past votes" view — exact placement is a UI decision for the rebuild, use judgement, doesn't need to be on the main voting screen permanently).
- Colours are randomly assigned to players when they join (not host-chosen, not sequential) — toned-down/muted versions of the classic Among Us palette so they fit the dark parchment aesthetic without being "tone deaf" to the theme (user's words). Suggest: muted red, muted blue, muted green, muted yellow/gold, muted purple, muted cyan/teal, muted orange, muted pink, muted brown, muted white/cream — desaturated versions, NOT the bright saturated Among Us originals.
- **Fixed (non-scrolling) voting grid** confirmed for up to 10 players — user said "ideally fixed" and accepted the suggested 2-column × 5-row layout, sized so cards aren't too small to misclick but don't need to scroll.

### 3.18 Disconnect & host transfer system
- A player who disconnects (loses connection to the site for a sustained period — exact threshold doesn't need to be precisely 60 seconds, "a time frame is more than good enough", implement via Firebase's `.info/connected` + `onDisconnect()` presence pattern with a reasonable client-side heartbeat, e.g. 10s heartbeat / 60s-ish timeout before marking removed) becomes a **spectator for the rest of that round** — they keep their role/state in the background but cannot act. If they reconnect before being fully removed, they should be able to resume seeing the spectator view for the remainder of that round (they do NOT regain the ability to act even if they reconnect mid-round — Q&A #6 final answer: "they become a spectator until game ends when they can join back in for next game, so they can see everything that round just like a normal spectator" — meaning once disconnected, that's it for THAT round/game, they're a spectator until "Play Again" starts a fresh game, at which point they're a normal player again if still present).
- **Visual indicator while connected-but-flaky vs fully removed:** use Option A — greyed out icon + a wifi-disconnect indicator badge while in the grace period before full removal (confirmed, "Option A").
- **Manual leave button:** must exist, inside Settings, last item (or clearly separated/styled as a destructive action). Leaving manually removes the player from the lobby/game entirely (same as a kick).
- **Host disconnect/leave handling:**
  - If the HOST disconnects for the threshold period, host status automatically transfers to whichever player joined the lobby next-earliest among those still connected (i.e., next in the original join-order queue, skipping anyone else who's also disconnected) (Q&A #171: "next person that joined lobby gets put in charge").
  - The new host is notified ("You are now the host") (Q&A #7 "yes they will get notified").
  - If the original host reconnects later, they do NOT automatically regain host status — they're now a normal player, unless manually transferred back, or unless the full join-order loop comes back around to them naturally in a future auto-transfer scenario (Q&A #7: "the ex host becomes a normal player and not the host again unless manually transferred or everyone leaves and its their turn in the loop around again").
  - **Manual host leave (Option A confirmed, Q&A #8):** if the host manually clicks "Leave Lobby" mid-game (not a disconnect, a deliberate leave), host status auto-transfers immediately to the next-in-join-order connected player, THEN the original host is removed/becomes a spectator-then-removed, in one seamless action — no extra confirmation step required beyond the leave button itself (though a simple "are you sure" confirm dialog before leaving is sensible UX, use judgement).
  - **Critical fairness rule, host has NO special game-info privileges** — "The host does not have access to any hidden game information and only sees the same information available to all players. Hosting is purely an administrative role and does not grant special visibility into role assignments, night actions, or resolution details." (Q&A #172, verbatim). This means: even though the host's browser tab is technically the one computing night/day resolution (an architecture necessity, no real backend server), the UI MUST NOT show the host any extra information beyond what their own role/player state would normally reveal. The resolution math can happen "behind the scenes" in their browser's JS without rendering any of the other players' private data to the screen.
  - Host-only abilities, clearly scoped: pause/resume the timer, access Hunt Rules (waiting room), transfer host to a specific player (via a small button next to that player's name in the Settings → Player List view, visible/usable only to the host). NOTHING else is host-exclusive.

### 3.19 Role reveal on death (universal mechanic)
- Every player, immediately upon dying (any cause — night kill, day vote, revote, random-pick), gets a private prompt: "Reveal your role?" with two choices — Reveal or Keep Hidden.
- If they reveal: their role becomes permanently, publicly visible for the rest of the game (shown next to their name everywhere — roster, voting screen, end screen).
- If they keep hidden: their role stays secret until the game ends (end screen always reveals everyone's role regardless, that's existing/unchanged behaviour).
- This applies to every role including Mayor (see 3.12 discussion), Pirate, and Poisoner — death-reveal is the ONLY way a Pirate or Poisoner's identity is ever voluntarily disclosed before game-end (their day-announcement mechanics never reveal who THEY are, only their target).

### 3.20 Edge cases found in a full re-audit against the original ~200-item Q&A — read this section as carefully as 3.1-3.19

This section exists because a full line-by-line re-check was done against every numbered/lettered Q&A item from the conversation. Most are already folded into 3.1-3.19 above. The following are cases that were either missed entirely, or answered by the user with "use your best judgement" and then NOT given an explicit judgement call in the sections above. **Treat 3.20a as settled (confident inference from already-confirmed rules). Treat 3.20b as genuinely open — ask the user directly before implementing, do not silently guess.**

#### 3.20a — Resolved by direct inference from already-confirmed rules (safe to implement as stated)

- **Werewolves target a dead player:** the kill attempt simply fails/has no effect (consistent with how Sheriff-shoots-a-dead-target is handled in 3.6 — same logic applies here, the original spec gives no indication Werewolves should be told their target was already dead, so just silently no-op).
- **Mage Werewolf silences an already-dead player:** the ability is wasted (consumed, no effect) — consistent with the user's confirmed answer for the equivalent Doctor case below.
- **Doctor protects an already-dead player:** the protection is wasted that night (no effect, but since Doctor acts every night this costs them nothing long-term, unlike a wasted once-per-game ability).
- **Amnesiac is killed (e.g. by Werewolves) the same night they submit their adoption choice:** per the confirmed resolution order (3.1, Werewolf kill is step 4, Amnesiac adoption is step 9), the Amnesiac dies BEFORE their adoption would resolve. The adoption should NOT complete — they die as a plain Amnesiac (no team, no role), and their adoption attempt simply fails/is wasted. This follows mechanically from the stated order and doesn't need a new ruling.
- **Multiple deaths in the same night are all announced together** in the following day's Morning Report (4.7) — this was implicit in the Morning Report design but is now stated explicitly here for clarity.
- **A host who is also playing a role with day/night actions (e.g. host happens to be the Pirate) is not restricted in any way by being host** — per the confirmed "host has no special privileges, purely administrative" rule (3.18), being silenced/prepping/etc. works identically for a host-player as for anyone else. The only thing host status adds is access to the Host settings sub-panel (pause/resume, hunt rules, transfer host) — it never blocks or alters their ability to act as a normal player.
- **Host-transfer UI updates instantly for both the outgoing and incoming host** — the outgoing host's Settings → Host sub-panel disappears, the incoming host's appears, both happening live via the same Firebase listener pattern already used for every other piece of shared state in the app (no special-casing needed, this is just normal reactive rendering).

#### 3.20b — Genuinely open, the user answered "use your best judgement" but no specific call was made in this document — ASK before implementing

1. **Doctor protects the Veteran (not themselves) on the same night the Veteran is on alert, AND Werewolves separately target the Veteran that same night.** Three things are potentially true at once: (a) the wolf-kill on the Veteran is cancelled by the alert regardless (per 3.1/3.11), (b) the Doctor, by choosing to protect the Veteran specifically, themselves becomes a "visitor" to the Veteran and would normally die from that visit (per 3.4/3.11) UNLESS they protected themselves instead, (c) the visiting Werewolves die from the alert unless THEY were separately protected by someone. The user confirmed each of these sub-rules individually in isolation but the exact combined resolution when several happen on the same night together was never explicitly walked through end-to-end. Confirm the combined outcome before implementing: does the Doctor really die here even though their protection (just aimed at the wrong person) was technically "spent" trying to help the Veteran? Get explicit confirmation.
2. **Poisoner poisons a player, and that player happens to be the Veteran who is on alert that same night.** Does the Poisoner's act of poisoning count as "visiting" the Veteran for alert-kill purposes (i.e. does the Poisoner die from the alert)? User said "use your best judgement" and no call was recorded. Open.
3. **Amnesiac picks a dead Veteran as their adoption target, on a night when (hypothetically) some other living Veteran-adjacent interaction is in play** — more simply: does an Amnesiac's adoption-pick count as "visiting" for Veteran-alert-death purposes, the same way Tracker/Doctor/Sheriff picks do? (This only matters in the edge case where the Amnesiac is choosing a dead Veteran's corpse as their adopt-target in the SAME night that some other living Veteran is separately on alert — rare but possible if a second Veteran-like situation existed; more realistically this question may be moot since you can only ever have 1 Veteran in the game per 3.16, so there's no "other living Veteran" to be alerted while the Amnesiac picks the dead one. RECOMMEND treating this as a non-issue/moot given the 1-Veteran-max rule, but flag it to the user briefly to confirm moot-ness rather than silently assuming.)
4. **Sheriff shoots a Werewolf, and that same Werewolf is ALSO the player the Veteran has gone on alert against that night (i.e., the Werewolf is being shot AND would also "die from visiting" for some other reason in the same night's web of actions).** The user's answer to the closest version of this question was a one-word "shot" which is genuinely ambiguous — it could mean "the shot just resolves normally and that's the only relevant outcome" or could imply something else. Get explicit clarification rather than assuming "the shot just resolves normally, full stop" is correct.
5. **Seer's "cannot use with 3 or fewer alive" constraint, precisely interpreted.** The Seer needs to pick exactly 4 players (dead or alive both count as valid picks, per 3.5) but the original spec's "cannot use with 3 or fewer ALIVE players remaining" wording is ambiguous when dead players are also valid picks. Does "3 or fewer alive" really mean the constraint is about total game size (≥4 players ever joined, trivially always true since minimum lobby is 4), or does it mean something stricter about how many of the Seer's 4 picks must currently be alive? This was never fully resolved — get explicit clarification on what exactly disables the Seer's ability and when.
6. **Q178's "both" answer** — when asked whether a Seer-result display should show "both" after an Amnesiac later adopts the (now-dead) original Seer's role and uses a fresh Seer ability themselves, the user said "both." The exact intended meaning of this is unclear — it might mean: (a) show both the original dead Seer's historical result AND the new Amnesiac-Seer's own result, perhaps in a shared "Seer investigations" history view accessible to spectators/at game-end, or (b) something else entirely. This needs a follow-up question to the user with a concrete mockup/example before implementing, rather than guessing at the UI.
7. **The full win-condition priority ordering in 3.15 was constructed by inference/judgement from the user's answers to a few key scenarios (#169, #180) plus the explicit Poisoner/Jester/Pirate rules** — it was NOT walked through by the user as an exhaustive list of every possible end-state combination. The logic in 3.15 is internally consistent and believed correct, but treat it as a confident proposal rather than a literally-confirmed-line-by-line ruleset. If any implemented scenario produces a result that feels wrong when actually tested, that's a signal to double check with the user rather than assume the 3.15 logic must be right just because it's written down.

**Bottom line on completeness:** the consolidated ruleset in 3.1-3.19 covers the large majority of the ~200 Q&A items accurately and directly. The items in 3.20a are confidently resolved without needing to bother the user further. The items in 3.20b are real, narrow, genuinely-unresolved edge cases — they are rare in actual play (most require a specific unlikely combination of roles/targets landing on the same night) but should be confirmed with the user before the relevant code path is written, rather than guessed at silently the way some early-session questions were glossed over.



### 4.1 Top HUD — "invisible" floating bar, visible at ALL times (every screen: landing, waiting room, in-game, end screen)
- No background panel, no border — just floating icons/text directly on the dark slate background.
- All interactive elements in the HUD should be visually consistent in size with each other (no element noticeably bigger/smaller than its neighbours) — user was specific about this ("all the top bar stuff to be same size roughly so it doesn't look weird").
- Confirmed contents and rough layout (exact pixel arrangement is an implementation decision, but functionally must include all of these, accessible without scrolling, on every screen, sized to never overlap or wrap awkwardly even on the narrowest supported phone width ~360-375px):
  - Lobby code (always visible once in a lobby)
  - Clock / phase+timer indicator (the existing "town clock" circular countdown element, or a more compact version — keep the existing visual language if it fits the compact requirement, adapt size if needed)
  - Role icon button — shows the player's OWN role icon (using the new PNGs) + the word "role" as a compact label/button; tapping opens the role detail popup (see 4.3). Must not be too small to tap comfortably, must not be larger than other HUD elements.
  - Log/event-history icon button (compact, same sizing family as role button)
  - Settings cog (⚙️ icon only, no text label needed, top right corner) — opens the full settings panel (see 4.2)
- The role icon + log icon do NOT need to disappear/move into settings — user confirmed (4. in the second-to-last round): "role can be an icon button so it doesn't take a lot of room... log can also be an icon... keep in mind I want all the top bar stuff to be same size roughly." So: HUD stays populated with role + log + clock + lobby code + settings cog, all at all times, all roughly equal visual weight.

### 4.2 Settings panel (⚙️, no text label on the button itself)
- Available to everyone, contents visible to everyone:
  - Player list (shows every player's avatar icon, name, connection-status indicator — see 3.18)
  - Roles reference button — opens a compact list of all 13 roles; clicking a specific role expands/opens its individual popup (see 4.3) with description + key interactions. Keep it compact until expanded (Q&A: "compact until they click on that specific role, then it should be the summary of what they do").
  - Leave Lobby button (last item, visually separated as a meaningfully "exit" action)
- **Nested "Host" section** — only visible to the current host, appears as its own sub-area/sub-panel within Settings (Q&A #9: "for settings host stuff should be inside 'host' and its a settings within settings"):
  - Pause / Resume timer toggle (in-game only, hidden in lobby/end screen)
  - Hunt Rules (role toggles + werewolf count stepper + night/day timer length inputs) — waiting-room-only, hidden once game has started
  - Transfer Host — a small button next to each OTHER connected player's name in the player list, host-only visibility, instantly transfers host role on click

### 4.3 Role popups (used in THREE places: HUD role-icon button, Settings → Roles reference, Hunt Rules role toggles)
- Clicking any role anywhere in the app opens a popup showing: the role's icon (new PNG), name, team badge (Town/Werewolf/Neutral, colour-coded consistent with existing `.role-team` classes), the core one-line ability description, and a short bullet list (max 3-4 bullets) of key interactions with other roles — NOT exhaustive, just the headline interactions someone would want to know at a glance (e.g. for Doctor: "Can protect yourself", "Blocks Werewolf kill, poison, and Pirate duel loss", "Cannot prevent Sheriff backfire", "Can protect the same player every night").
- **Universal popup dismissal rule:** EVERY popup/modal in the entire app must close when the user taps/clicks outside of it (on the dark backdrop). This was an explicit, blanket requirement, not just for role popups — audit every existing modal in the codebase (settings, log, roster, help, role detail) to ensure this behaviour is correctly implemented everywhere, not just newly-added popups.

### 4.4 Hunt Rules (waiting room, host-only) — role list MUST be grouped by team
- Three clearly labelled groups: **Werewolf**, **Town/Villager** (use whichever exact label reads best in-game, "Town" or "Civilian"/"Villager" — user said "werewolf/civilian/neutral" so possibly label it "Civilian" rather than "Town" or "Villager" for this specific screen — use best judgement but lean toward matching whatever label is used consistently elsewhere in the app for that team, likely "Town" based on existing code's `team: 'town'` internal key, but the user's own wording here was literally "civilian" — RECOMMEND clarifying with user which exact label they prefer, OR just default to "Town" since that's the existing internal/visual convention and is functionally identical to "civilian").
- **Neutral** group.
- Each role in each group is clickable to open its popup (per 4.3).
- Werewolf count: stepper (existing pattern, keep).
- Each optional role: on/off toggle (existing pattern, keep) — but now visually organised under its team heading instead of one flat list.
- Real-time validation warning displayed if the current selection would be invalid/unbalanced for the current player count (extend beyond just disabling the Start button — show the actual warning text live as they toggle, not only when they try to start).
- **Role-count ceiling enforcement:** once the host's selections hit whatever the valid maximum is for the current player count, prevent further role toggles from being enabled and show a clear warning explaining why (Q&A #6, second-to-last round: "the game then shouldn't allow them to choose anymore and to warn them of it").

### 4.5 Voting screen (Among Us-inspired, see user's reference screenshot)
- Fixed (non-scrolling) layout, portrait-oriented, roughly a 2-column grid for up to 10 players (5 rows × 2 columns), sized so each card is comfortably tappable without easy misclicks but doesn't force scrolling.
- Each player card shows: their randomly-assigned avatar icon (new player PNGs once generated) in their randomly-assigned muted colour treatment, their name, and (live, updating in real time as votes come in) small coloured dots/icons representing who has voted for them, matching the COLOUR of the voter (not their avatar, just colour is enough per the reference image's vote-icon style).
- Dead players appear visually greyed-out/desaturated in this same list (not removed, just muted) — and if they revealed their role, show their role icon as a small badge too.
- "Skip Vote" is a dedicated button, bottom of the screen, full-width or prominent — same visual tier as a real player option, can receive vote-dots same as any player slot.
- Voting timer countdown shown (reuse existing clock element or a compact text countdown, consistent with the rest of the HUD).
- This is a SEPARATE concern from the day/night "Morning Report" announcements (3.7/3.8) — the Morning Report (duel target announced, poison target announced, overnight deaths) should appear as a dedicated screen/modal shown automatically to everyone at the start of each day, BEFORE the voting screen becomes interactive, then dismisses into the normal day/voting view (Q&A "5. Option A" confirmed: a dedicated screen, not just buried in the log).

### 4.6 Player avatars
- 10 unique avatar PNGs (Player 1 through Player 10) — already generated by the user via another AI (image provided, see Section 6 for the exact filenames/process to crop them, not yet done).
- **Assignment: RANDOM** at the moment a player joins the lobby (not sequential/first-come, not self-chosen) (Q&A round 4, "player avatar assignment" question answered: "random").
- Combined with a randomly-assigned muted colour (see 3.17) — the avatar PNG itself is presumably a neutral bone/parchment-coloured silhouette (matching the role-icon style), so the "colour" assignment is likely applied as a tinted background circle/badge behind the avatar, or a coloured border/ring around the avatar — exact rendering technique is an implementation decision, but the avatar graphic itself stays the bone/red palette from the generated PNGs; colour-coding for vote-identification purposes should be a separate visual layer (e.g. a coloured ring/background), not a recolour of the artwork itself, to avoid muddying the established icon style.

### 4.7 Morning Report screen
- Appears automatically at the start of every day phase, before the day/voting screen.
- Content, in order: overnight deaths (with names, cause can stay vague/narrative per existing log-message style), any Pirate duel announcement (target name only, never Pirate's identity), any Poisoner announcement (target name + poison icon), any other relevant public info for that morning.
- Dismisses (tap to continue, or auto-advances after a few seconds — use judgement) into the normal Day screen with voting available.

### 4.8 Coin toss / duel animation & random-pick (revote tiebreak) animation
- Both are short (2-3 second) animations that play SIMULTANEOUSLY on every connected player's screen at the moment of resolution.
- Both must include clear explanatory text so the scenario is understood by everyone watching, not just an unexplained spinning graphic — exact wording examples given in 3.7 (duel) and 3.17 (random-pick).
- After the animation, the outcome is announced as a normal log/death entry — no special "this was random" framing needed in the permanent log afterward (Q&A: "in both cases I just want it normal death").

---

## 5. PLAYER AVATAR — AI IMAGE GENERATION PROMPT (already given to user, they've generated the image — see uploaded reference, NOT yet cropped/integrated)

The exact prompt already used (for reference, in case regeneration is ever needed):

> Create 10 player avatar icons for a Werewolf party game. Style must exactly match this set: flat vector illustration, aged/gothic aesthetic, dark background (#23252b slate), bone/parchment colour (#e6ddc4) as primary with muted blood red (#6b2420) as accent. Clean silhouettes, minimal detail, readable at 64×64px, generate at 256×256px. No gradients, no shadows, flat shapes only. Each avatar should be a distinct human character silhouette/bust that fits a Salem witch trial era setting. Generate 10 variations labelled Player 1 through Player 10, each with a different character type such as: hooded villager, cloaked figure, town elder, blacksmith, innkeeper, priest, herbalist, merchant, soldier, farmer. Each character should be immediately visually distinct from the others at a glance.

**Result:** user has already generated and uploaded a 10-avatar sheet (image provided in conversation, a 5-column × 2-row grid, busts only, labelled "Player 1" through "Player 10" beneath each). **This has NOT yet been cropped into individual files.** It needs the same careful process as Section 6 below.

---

## 6. ICON CROPPING METHOD — PROVEN PROCESS, USE THIS EXACTLY (avoid repeating mistakes made on the role icon sheet)

The role icon sheet (13 icons, 4-column grid + 1 standalone) was successfully cropped using this method. The SAME sheet-cropping approach should be used for the 10-avatar sheet once that's tackled. Key lessons learned (do not skip these steps or the same mistakes will repeat):

1. **Never guess crop boundaries from assumed equal grid math.** The source sheets have inconsistent padding/label-overflow between cells — some labels (e.g. "Mage Werewolf") are wider than their notional grid cell and will get clipped if you just divide image width by column count.
2. **Use pixel-level background-colour detection to find TRUE content boundaries, not assumed grid lines.** Method: load the image, compute a per-pixel difference from the known background colour (e.g. `#23252b` → RGB `(35,37,43)`), threshold that difference (e.g. `diff < 30` counts as "background"), then scan rows/columns for bands that are ≥98% background — those are the real gaps between content cells. This correctly finds irregular boundaries that simple division misses.
3. **When checking a specific cell's true left/right/top/bottom edge, scan a WIDE window first** (e.g. the full distance to the next cell, not just your assumed boundary) to catch content that overflows the "expected" cell size — this is what caught the Mage Werewolf label clipping.
4. **CRITICAL bug encountered twice on the Jester icon — learn from this:** when first re-checking a clipped edge, a wide-window scan was used but the window's OWN boundary cut off mid-content (stopped scanning at exactly x=740, missing that real content continued to x=756 well past a deceptive "edge" at x=827 that turned out to be noise from anti-aliasing of the NEXT icon, not real content). **The fix that actually worked: do a fine-grained, single-pixel-column-by-column scan (e.g. `for x in range(750, 765): print(non_bg_pixel_count_in_that_column)`) to find the EXACT last column with real content (a meaningful non-bg pixel count, not just 1-5 stray anti-aliasing pixels), rather than trusting a single wide-window min/max scan.** Always verify suspicious "edges" found by a wide scan with a fine-grained column-by-column re-check before trusting them.
5. **Always pad asymmetrically, not uniformly** — top padding should generally be SMALLER than bottom/side padding, because the previous row's label text tends to sit close above the next row's icon (small gaps vertically between rows, larger gaps horizontally between columns). A uniform 12px pad on all sides was what caused the Mayor-text-bleeding-into-Jester bug — fix was top pad ~6px, bottom/side pad ~12px.
6. **After every crop, paste onto a solid background-colour square canvas (matching the sheet's own bg colour) before resizing**, so non-square crops don't get squished — centre the crop within a square canvas first, then resize the whole square to the final target size (200×200 was used for role icons).
7. **Always do a final visual contact-sheet review** (paste all cropped icons into one grid image and view it) before declaring done — this caught issues a programmatic check alone would miss (e.g. the bell-tip-looks-naturally-tapered-not-clipped false alarm that was correctly caught and reverted).
8. **Final role icon output spec used:** 200×200px, RGB (not RGBA — the source sheets had a solid background colour already, no transparency needed since the icons are displayed inside cards with their own background anyway... THIS MAY NEED REVISITING — original asset plan (early in the project) called for transparent PNGs via a background-remover tool. The role icons as actually delivered/cropped in this session were left as solid dark-slate-background squares, NOT transparency-stripped. CONFIRM WITH USER whether they still want background removal applied (they mentioned wanting to use an online background remover tool themselves) — if so, that's a remaining step even for the already-cropped role icons, not just the player avatars.**
9. **Exact filenames already in place for role icons** (in `img/roles/`): `villager.png`, `seer.png`, `sheriff.png`, `tracker.png`, `doctor.png`, `veteran.png`, `mayor.png`, `werewolf.png`, `mage-werewolf.png`, `poisoner.png`, `jester.png`, `amnesiac.png`, `pirate.png` — all 200×200px, all visually verified correct as of this handoff (including the twice-fixed Jester).
10. **For player avatars, use the same target size discussed earlier in the project: 300×400px (portrait/bust ratio, not square)** — this was specified before the role icons (which ended up square at 200×200) were finalised; confirm this is still the desired ratio for avatars specifically, since they'll be used in circular/badge contexts on the voting screen (per the Among Us reference) which might actually want a square or circular crop instead of a tall portrait rectangle. **RECOMMEND reconfirming the exact target dimensions/aspect ratio for player avatars with the user before cropping, given they'll primarily be seen as small circular icons on the voting screen, not large portraits** — a square crop (e.g. 200×200, matching the role icons) may actually be more appropriate than the originally-discussed 300×400 portrait ratio. This is a small open question worth a 1-line confirmation before spending time cropping.

---

## 7. KNOWN BUGS ALREADY FOUND & FIXED IN THE STALE CODE (for context only — these fixes exist in the current `js/app.js`/`js/roles.js` but since those files need a substantial rewrite anyway, treat this list as "don't reintroduce these same mistakes" rather than "code to preserve as-is")

- Revote votes must be cleared before the revote starts (old votes for non-tied players would otherwise corrupt the revote tally).
- Mage Werewolf silence must check only the specific submitter(s) of an action, not "all werewolf team members," when determining if an action is blocked (now superseded anyway by the bigger timing change in 3.3 — silence never blocks the SAME night it's cast at all).
- Sheriff shooting an already-dead target (from another same-night cause) must fail silently, not still resolve hit/backfire.
- Stale `poisoned` Firebase entries for already-dead players must be cleared, not left dangling (less relevant now given the revised poison sequence in 3.8, but the general principle of cleaning up stale per-round Firebase state still applies).
- Once-per-game ability gating must use a PERMANENT `abilityUsed` flag, not a per-round `submitted_rN` flag — otherwise once-per-game roles incorrectly get to act again on later nights.
- Pirate's prep/duel state must be reliably cleared in every exit path (silenced, target died, duel resolved, pirate died) to avoid the player getting permanently stuck unable to act — this principle carries forward strongly into the NEW two-night Pirate sequence (3.7), which has even more exit paths to handle carefully (cancelled via vote-out, cancelled via death, normal resolution, Werewolf-kill-takes-priority cancellation).
- A kicked/removed player's OWN client must detect their removal from the player list and redirect them back to the landing screen — don't just rely on the host-side removal, the removed player's tab needs its own listener for "did I get removed."
- Mayor's hidden vote weight must be read from the authoritative `secretRoles` data on the host/resolution side, never gated behind a `revealed` flag (since Mayor, per spec, is never meant to be revealed through normal means — though see the death-reveal universal-mechanic question raised in 3.12, which may mean this needs revisiting once that's clarified).

---

## 8. FIREBASE / REPO PRACTICAL DETAILS

- **Firebase project ID:** `werewolf-a9450`
- **Realtime Database region:** `europe-west1` (Belgium)
- The user's `js/firebase-config.js` already contains their real project values (not placeholders) — preserve this file as-is when rebuilding, don't reset it to placeholder text.
- **`database.rules.json` will need updates** once the new data paths from the rebuilt mechanics are finalised (e.g. paths for: per-player connection/presence status, host-transfer state, vote-skip tracking, pirate/poisoner two-night announcement state, player colour/avatar assignment, Mage silence "expires following night" timestamp tracking, etc.) — the user knows the drill: paste the new rules into Firebase Console → Realtime Database → Rules tab → Publish, after every rules-file change.
- **User's update workflow:** replace the whole project folder with the new zip → re-check `js/firebase-config.js` didn't get reset to placeholders (it won't, since the real one should be included in the handoff zip) → VS Code Source Control → stage all → commit → sync → wait ~1 min for GitHub Pages to redeploy → hard refresh.
- GitHub repo is currently public. User was offered the option to make it private (Settings → Danger Zone → Change visibility) due to a GitHub secret-scanning email about the exposed Firebase API key — this is a non-issue per Firebase's own documentation (API keys are safe to expose, access is controlled by database rules not key secrecy) but the option remains available if the user wants extra peace of mind. Not yet confirmed whether they did this.

---

## 9. IMMEDIATE NEXT STEPS, IN RECOMMENDED ORDER

1. Crop the 10 player avatars (confirm square vs portrait aspect ratio first — see Section 6, point 10).
2. Confirm with user: does background removal (transparency) still need to be applied to the already-cropped role icons, and will it be applied to the player avatars too, or is the solid-background square treatment fine as-is given they'll sit inside parchment cards anyway?
3. Resolve the one flagged ambiguity in Section 3.17 about Skip-vote interacting with the revote random-pick tiebreaker.
4. Resolve the Hunt Rules team-label wording question in Section 4.4 ("Town" vs "Civilian" vs "Villager").
5. Full rewrite of `js/roles.js` (role definitions + all pure game-logic helpers) against Section 3 in its entirety.
6. Full rewrite of `js/app.js` (Firebase wiring, all UI rendering, night/day resolution) against Sections 3 and 4 in their entirety — this is the bulk of the remaining work.
7. Rewrite `index.html` structure for the new HUD/Settings/Voting-screen/Morning-Report UI.
8. Extend `css/style.css` for all new UI elements (Among Us-style voting cards, coloured avatar rings, coin-toss/random-pick animation, Morning Report screen, nested Host settings sub-panel, disconnect indicator badges) — keep using the existing CSS variable palette, don't introduce new colours outside it without good reason.
9. Update `database.rules.json` for all new data paths.
10. Full regression pass using the same rigorous scenario-audit method already demonstrated earlier in this project (the 180-point exhaustive case-by-case audit) — re-run that same exhaustive thinking against the FINAL ruleset in Section 3, since several rules changed significantly from what was originally audited (especially Mage silence timing, the Pirate/Poisoner two-night sequences, and the win-condition priority ordering).

