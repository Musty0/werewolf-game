// roles.js — role definitions and pure game-logic helpers.
//
// Rewritten against MASTER_CONTEXT.md Section 3 (consolidated final ruleset)
// and the fully-resolved Section 3.20b open questions. This file holds:
//   - role metadata (icons, blurbs, popup bullets, team, ability shape)
//   - role assignment
//   - vote tallying
//   - win-condition evaluation
//
// Mechanics with genuinely novel/stateful behaviour (Mage silence timing,
// Pirate's two-night duel sequence, Poisoner's two-night poison sequence,
// Veteran alert resolution, Tracker/Seer results, Amnesiac adoption,
// disconnect/host-transfer) are orchestrated in app.js, which calls into
// the helpers here. This file should never need to know about Firebase.
//
// Role definition fields:
//   team: 'town' | 'werewolf' | 'neutral'
//   icon: path to the role's PNG (img/roles/{key}.png)
//   name, blurb — shown in role popups (4.3) and Hunt Rules (4.4)
//   popupBullets: string[] — max 3-4 headline interactions, NOT exhaustive
//   optional: true — appears as a Hunt Rules toggle
//   usesPerGame: number | 'unlimited'
//   silenceable: true — a Mage Werewolf silence blocks this night action
//   night: { type, prompt, allowSelf, groupVote }
//   winsIfVotedOut: true — Jester
//   survivesToFinal2Win: true — Poisoner
//   winsAlongsideTownIfAlive: true — Pirate
//   voteWeight: N — Mayor's hidden double vote

export const ROLE_DEFS = {
  // ── VILLAGER TEAM ────────────────────────────────────────────────
  villager: {
    name: "Villager",
    team: "town",
    icon: "img/roles/villager.png",
    blurb: "No special power. Listen, discuss, and vote out the Werewolves.",
    popupBullets: [
      "No night action",
      "Wins when all Werewolves are eliminated",
    ],
    usesPerGame: 0,
  },

  seer: {
    name: "Seer",
    team: "town",
    icon: "img/roles/seer.png",
    blurb:
      "Once per game: choose exactly 4 players (dead or alive). Learn how many of them are evil — not which ones.",
    popupBullets: [
      "Picks exactly 4 players — dead or alive both count",
      "Cannot select yourself",
      "Result is a count only, never identities",
      "Disabled in Hunt Rules if the lobby is below the minimum size",
    ],
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: {
      type: "inspect4",
      prompt: "Select exactly 4 players to inspect (tap 4, then confirm)",
    },
  },

  sheriff: {
    name: "Sheriff",
    team: "town",
    icon: "img/roles/sheriff.png",
    blurb:
      "Once per game: shoot one player at night. A Werewolf-team target dies. Anyone else and you die instead.",
    popupBullets: [
      "Hit = Werewolf-team target dies",
      "Miss = you die — Doctor cannot save a backfire",
      "Cannot shoot yourself",
    ],
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: { type: "shoot", prompt: "Choose who to shoot tonight" },
  },

  tracker: {
    name: "Tracker",
    team: "town",
    icon: "img/roles/tracker.png",
    blurb:
      "Once per game: choose one living player. Learn whether they took any night action, or stayed home.",
    popupBullets: [
      "Binary result only — activity, not identity or role",
      "Tracking the Veteran on Alert can get you killed",
      "Living targets only",
    ],
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: { type: "track", prompt: "Choose who to track tonight" },
  },

  doctor: {
    name: "Doctor",
    team: "town",
    icon: "img/roles/doctor.png",
    blurb:
      "Every night: protect one player from death. Can protect yourself. Can repeat the same target.",
    popupBullets: [
      "Blocks Werewolf kill, poison, Veteran-alert death, Pirate duel loss",
      "Cannot prevent Sheriff backfire — the one exception",
      "Protecting another player does not protect you if you visit the Veteran on Alert",
    ],
    optional: true,
    usesPerGame: "unlimited",
    silenceable: true,
    night: {
      type: "protect",
      allowSelf: true,
      prompt: "Choose who to protect tonight",
    },
  },

  veteran: {
    name: "Veteran",
    team: "town",
    icon: "img/roles/veteran.png",
    blurb:
      "Once per game: go on Alert. Anyone who visits you that night dies, unless the Doctor protects them.",
    popupBullets: [
      "No target needed — just confirm",
      "Werewolves targeting you on Alert die and their kill is cancelled",
      "Doctor can protect visitors from dying, but does not negate the alert itself",
      "Still counts as used even if nobody visits",
    ],
    optional: true,
    usesPerGame: 1,
    night: {
      type: "alert",
      prompt: "Go on Alert? Anyone who visits you tonight dies.",
    },
  },

  mayor: {
    name: "Mayor",
    team: "town",
    icon: "img/roles/mayor.png",
    blurb:
      "Passive: your vote always counts as 2, including in a revote. Your identity is never revealed by normal means.",
    popupBullets: [
      "No night action — fully passive",
      "Double vote is lost if you die",
    ],
    optional: true,
    usesPerGame: 0,
    voteWeight: 2,
  },

  // ── WEREWOLF TEAM ────────────────────────────────────────────────
  werewolf: {
    name: "Werewolf",
    team: "werewolf",
    icon: "img/roles/werewolf.png",
    blurb:
      "Each night, vote with your fellow Werewolves to choose one player to eliminate. Cannot target a teammate.",
    popupBullets: [
      "Majority vote among Werewolves; split vote means no kill that night",
      "Silence never blocks the Werewolf kill",
    ],
    usesPerGame: "unlimited",
    night: {
      type: "kill",
      groupVote: true,
      prompt: "Choose who to eliminate tonight",
    },
  },

  mageWerewolf: {
    name: "Mage Werewolf",
    team: "werewolf",
    icon: "img/roles/mage-werewolf.png",
    blurb:
      "Once per game: silence one player. Their vote and night action fail — effective the following day and night, not immediately.",
    popupBullets: [
      "Silence takes effect day N+1 and night N+1, never the casting night",
      "Can target yourself",
      "Other Werewolves know you exist; Poisoner never does",
    ],
    optional: true,
    usesPerGame: 1,
    night: {
      type: "silence",
      allowSelf: true,
      prompt: "Choose who to silence (effective the following day and night)",
    },
  },

  // ── NEUTRAL TEAM ─────────────────────────────────────────────────
  poisoner: {
    name: "Poisoner",
    team: "neutral",
    icon: "img/roles/poisoner.png",
    blurb:
      "Once per game: poison a player. Announced next morning, they die the following night unless the Doctor cures them.",
    popupBullets: [
      "Win by surviving into the literal final 2 (or as sole survivor) — beats everyone except a Werewolf",
      "Your identity is never revealed by the announcement",
      "If you die first, the poison still kills on schedule",
    ],
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    survivesToFinal2Win: true,
    night: { type: "poison", prompt: "Choose who to poison tonight" },
  },

  jester: {
    name: "Jester",
    team: "neutral",
    icon: "img/roles/jester.png",
    blurb:
      "No ability. Win alone — but only by being voted out during the day.",
    popupBullets: [
      "Does NOT win if killed at night, shot, or poisoned",
      "A vote-out win is immediate and overrides any simultaneous result",
    ],
    optional: true,
    usesPerGame: 0,
    winsIfVotedOut: true,
  },

  amnesiac: {
    name: "Amnesiac",
    team: "neutral",
    icon: "img/roles/amnesiac.png",
    blurb:
      "Start with no role or team. Once per game, after at least one death, secretly adopt a dead player's role without knowing it first.",
    popupBullets: [
      "Cannot adopt Poisoner, Jester, Pirate, or another Amnesiac",
      "Adoption is instant — Werewolves are notified if you adopt a Werewolf role",
      "Seer adoption shares the original Seer's investigation history alongside any new results",
    ],
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: {
      type: "adopt",
      prompt: "Choose a dead player to secretly adopt their role",
    },
  },

  pirate: {
    name: "Pirate",
    team: "neutral",
    icon: "img/roles/pirate.png",
    blurb:
      "Once per game: secretly nominate a duel target. Two nights later, a coin toss decides who dies.",
    popupBullets: [
      "Target is announced publicly next morning — you never are",
      "Cancelled silently if you or the target die before the duel night",
      "Win by being alive at game end — wins alongside Town, never alongside Werewolves",
    ],
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    winsAlongsideTownIfAlive: true,
    night: {
      type: "duel",
      prompt: "Choose your duel target (resolves two nights from now)",
    },
  },
};

// ── LOOKUP HELPERS ──────────────────────────────────────────────────

export function optionalRoleKeys() {
  return Object.keys(ROLE_DEFS).filter((key) => ROLE_DEFS[key].optional);
}

export function optionalRoleKeysByTeam() {
  const order = ["werewolf", "town", "neutral"];
  const groups = { werewolf: [], town: [], neutral: [] };
  optionalRoleKeys().forEach((key) => groups[ROLE_DEFS[key].team].push(key));
  return order.map((team) => ({ team, keys: groups[team] }));
}

export function teamDisplayLabel(team) {
  if (team === "town") return "Villagers";
  if (team === "werewolf") return "Werewolf";
  return "Neutral";
}

export function werewolfTeamKeys() {
  return Object.keys(ROLE_DEFS).filter(
    (key) => ROLE_DEFS[key].team === "werewolf",
  );
}

// ── SEER LOBBY GATING (pre-game only, never mid-game) ───────────────
// 3.20b #5: minimum lobby count for the Seer toggle to be legal. Value is
// the number of players the Seer needs to be able to pick 4 others plus
// themselves — so 5 minimum (pick 4, can't pick self). We use 5 so the
// ability is always usable at least once if the role is in play.
export const SEER_MIN_LOBBY_SIZE = 5;

// ── SETTINGS ────────────────────────────────────────────────────────

export function defaultSettings() {
  const optionalRoles = {};
  optionalRoleKeys().forEach((key) => {
    optionalRoles[key] = key === "doctor";
  });
  return {
    werewolfCount: 1,
    optionalRoles,
    nightSeconds: 60,
    daySeconds: 120,
  };
}

// Returns { ok, error, warnings }.
// warnings: non-blocking display hints for the Hunt Rules screen.
export function validateSettings(settings, playerCount) {
  const warnings = [];
  const enabledOptionalCount = Object.values(
    settings.optionalRoles || {},
  ).filter(Boolean).length;
  const mageEnabled = settings.optionalRoles?.mageWerewolf;
  const totalWerewolves = settings.werewolfCount + (mageEnabled ? 1 : 0);
  const totalSpecial = totalWerewolves + enabledOptionalCount;

  if (playerCount < 4)
    return {
      ok: false,
      error: "You need at least 4 players to start.",
      warnings,
    };
  if (settings.werewolfCount < 1)
    return { ok: false, error: "You need at least 1 Werewolf.", warnings };

  if (settings.optionalRoles?.seer && playerCount < SEER_MIN_LOBBY_SIZE) {
    warnings.push(
      `Seer requires at least ${SEER_MIN_LOBBY_SIZE} players — it has been turned off.`,
    );
  }
  if (totalSpecial >= playerCount) {
    return {
      ok: false,
      error: "Too many special roles — leave room for at least 1 Villager.",
      warnings,
    };
  }
  if (totalWerewolves >= Math.ceil(playerCount / 2)) {
    return {
      ok: false,
      error: "Too many Werewolves for this player count.",
      warnings,
    };
  }
  return { ok: true, warnings };
}

// Force-disable any role whose pre-game lobby constraint is now violated.
// Call reactively in the waiting room as players join/leave. Never call
// this once the game has started.
export function enforcePreGameRoleConstraints(settings, playerCount) {
  const next = { ...settings, optionalRoles: { ...settings.optionalRoles } };
  if (playerCount < SEER_MIN_LOBBY_SIZE && next.optionalRoles.seer) {
    next.optionalRoles.seer = false;
  }
  return next;
}

// ── ASSIGNMENT ──────────────────────────────────────────────────────

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns { roleByUid, werewolfUids }.
export function assignRoles(playerIds, settings) {
  const shuffled = shuffle(playerIds);
  const roleByUid = {};
  let i = 0;
  const werewolfUids = [];

  for (let w = 0; w < settings.werewolfCount; w++) {
    roleByUid[shuffled[i]] = "werewolf";
    werewolfUids.push(shuffled[i]);
    i++;
  }

  optionalRoleKeys().forEach((key) => {
    if (settings.optionalRoles?.[key]) {
      roleByUid[shuffled[i]] = key;
      if (ROLE_DEFS[key].team === "werewolf") werewolfUids.push(shuffled[i]);
      i++;
    }
  });

  for (; i < shuffled.length; i++) roleByUid[shuffled[i]] = "villager";

  return { roleByUid, werewolfUids };
}

// Randomly assigns each player one of the 10 avatar images + a muted colour ring,
// both without replacement. Section 4.6.
const AVATAR_COLOURS = [
  "#6b2420",
  "#2f4a28",
  "#93a6c4",
  "#8a6d3b",
  "#5b4b8a",
  "#3b6b6b",
  "#a35d3b",
  "#4a4a6b",
  "#6b8a3b",
  "#8a3b6b",
];

export function assignAvatarsAndColours(playerIds) {
  const shuffledAvatars = shuffle(
    Array.from({ length: 10 }, (_, n) => `img/avatars/player${n + 1}.png`),
  );
  const shuffledColours = shuffle(AVATAR_COLOURS.slice());
  const result = {};
  playerIds.forEach((uid, idx) => {
    result[uid] = {
      avatar: shuffledAvatars[idx % shuffledAvatars.length],
      colour: shuffledColours[idx % shuffledColours.length],
    };
  });
  return result;
}

// ── VOTING ──────────────────────────────────────────────────────────

// Tally a {voterUid: targetUid} map.
// weights: optional {uid: number} for Mayor's double vote.
// Returns { targetUid, tie, tally }.
export function tallyVotes(votesObj, weights = {}) {
  const tally = {};
  Object.entries(votesObj || {}).forEach(([voter, target]) => {
    if (!target) return;
    const w = weights[voter] || 1;
    tally[target] = (tally[target] || 0) + w;
  });
  let best = null,
    bestCount = -1,
    tie = false;
  Object.entries(tally).forEach(([target, count]) => {
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  });
  return { targetUid: tie ? null : best, tie, tally };
}

// Returns tied candidates for a revote. Per Section 3.17, 'skip' is treated
// as a normal candidate — if Skip ties with a player, the revote includes
// Skip as one of the options. During the forced random-pick if the revote
// ALSO ties, Skip can be randomly selected (meaning no elimination that day).
export function tiedPlayers(votesObj, weights = {}) {
  const tally = {};
  Object.entries(votesObj || {}).forEach(([voter, target]) => {
    if (!target) return;
    const w = weights[voter] || 1;
    tally[target] = (tally[target] || 0) + w;
  });
  if (!Object.keys(tally).length) return [];
  const max = Math.max(...Object.values(tally));
  const tied = Object.entries(tally)
    .filter(([, c]) => c === max)
    .map(([uid]) => uid);
  return tied.length > 1 ? tied : [];
}

// ── WIN CONDITIONS (Section 3.15 + 3.20b fully resolved) ────────────
//
// ALWAYS call checkJesterWin() first, immediately after any vote or revote
// eliminates someone. If it returns a uid, end the game — do not proceed
// to checkWinCondition() for that round.
//
// Then call checkWinCondition() after every death-causing event
// (night resolution, day vote-out, revote, poison death).

// Returns votedOutUid if that player is a Jester, else null.
export function checkJesterWin(votedOutUid, playersObj) {
  if (!votedOutUid) return null;
  const p = playersObj[votedOutUid];
  if (p && ROLE_DEFS[p.role]?.winsIfVotedOut) return votedOutUid;
  return null;
}

// Returns null (game continues) or a result object:
//   { primary: 'werewolf', winners: ['werewolf'] }
//   { primary: 'poisoner', winners: ['poisoner'] }
//   { primary: 'town',     winners: ['town'] | ['town','pirate'] }
export function checkWinCondition(playersObj) {
  const alive = Object.values(playersObj).filter((p) => p.alive);
  const aliveWolves = alive.filter(
    (p) => ROLE_DEFS[p.role]?.team === "werewolf",
  ).length;
  const aliveOthers = alive.length - aliveWolves;

  // Werewolves win whenever wolves >= non-wolves (includes the full-wipe 0v0 case).
  if (aliveWolves >= aliveOthers) {
    return { primary: "werewolf", winners: ["werewolf"] };
  }

  // Wolves still exist and are outnumbered — the hunt continues.
  if (aliveWolves > 0) {
    return null;
  }

  // No wolves remain (aliveWolves === 0, aliveOthers > 0 here). Poisoner's
  // survival win applies to the literal final 2 OR a sole survivor
  // (3.20b #3: solo survival is a superset, still a win).
  if (alive.length <= 2) {
    const poisoner = alive.find((p) => ROLE_DEFS[p.role]?.survivesToFinal2Win);
    if (poisoner) return { primary: "poisoner", winners: ["poisoner"] };
  }

  // Town wins. Pirate wins alongside if alive.
  // Jester alive at game-end never wins (3.20b #2/#4 confirmed).
  const winners = ["town"];
  if (alive.find((p) => ROLE_DEFS[p.role]?.winsAlongsideTownIfAlive)) {
    winners.push("pirate");
  }
  return { primary: "town", winners };
}

// ── DISPLAY ─────────────────────────────────────────────────────────

// result: the object returned by checkWinCondition(), or { primary: 'jester' }
// for a Jester vote-out.
export function winnerDisplay(result) {
  if (!result) return { label: "Game over", team: "neutral", sub: "" };

  switch (result.primary) {
    case "jester":
      return {
        label: "Jester wins",
        team: "neutral",
        sub: "The Jester wanted to be voted out — and got their wish.",
      };
    case "werewolf":
      return {
        label: "Werewolves win",
        team: "werewolf",
        sub: "The Werewolves now have control of the town.",
      };
    case "poisoner":
      return {
        label: "Poisoner wins",
        team: "neutral",
        sub: "The Poisoner survived to the very end.",
      };
    case "town": {
      const alongside = result.winners.includes("pirate")
        ? " The Pirate survived alongside them."
        : "";
      return {
        label: "Villagers win",
        team: "town",
        sub: `Every Werewolf has been hunted down.${alongside}`,
      };
    }
    default:
      return { label: "Game over", team: "neutral", sub: "" };
  }
}
