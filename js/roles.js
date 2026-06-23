// roles.js — role definitions and pure game-logic helpers.
//
// DESIGN PRINCIPLE: adding a role that fits an existing mechanical
// pattern should require only a ROLE_DEFS entry. Roles with genuinely
// novel mechanics (Seer's group inspection, Sheriff's backfire kill,
// Tracker's visit detection, Veteran's alert trap, Mage Werewolf's
// silence, Amnesiac's role adoption, Pirate's duel, Poisoner's delayed
// kill and survival win) are handled in app.js with explicit code,
// but their metadata still lives here so the Roles popup, Hunt Rules
// toggles, and role assignment are all automatic.
//
// Role definition fields:
//   team: 'town' | 'werewolf' | 'neutral'
//   icon, name, blurb (string) — displayed in Roles popup and role card
//   optional: true — appears as a toggle in Hunt Rules
//   usesPerGame: number | 'unlimited' — shown in Roles popup
//   night: { type, prompt, allowSelf, groupVote }
//     type: 'kill' | 'protect' | 'investigate' | 'track' | 'alert' |
//           'silence' | 'poison' | 'adopt' | 'duel' | 'inspect4'
//     groupVote: true — all players with this role vote together (Werewolves)
//     allowSelf: true — player can target themselves
//   winsIfVotedOut: true — wins alone if day-voted out (Jester)
//   survivesToFinal2Win: true — wins if alive in final 2 (Poisoner)
//   revealable: true, voteWeight: N — Mayor passive double vote (hidden, not toggled)
//   silenceable: true — ability can be blocked by Mage Werewolf

export const ROLE_DEFS = {

  // ── VILLAGER TEAM ────────────────────────────────────────────────
  villager: {
    name: 'Villager',
    team: 'town',
    icon: '🧑‍🌾',
    blurb: 'No special power. Listen, discuss, and vote out the Werewolves.',
    usesPerGame: 0
  },

  seer: {
    name: 'Seer',
    team: 'town',
    icon: '🔮',
    blurb: 'Once per game: choose exactly 4 living players. You learn how many of them are evil — but not which ones. Cannot be used when 3 or fewer players remain. Cannot select yourself.',
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: { type: 'inspect4', prompt: 'Select exactly 4 players to inspect (tap 4, then confirm)' }
  },

  sheriff: {
    name: 'Sheriff',
    team: 'town',
    icon: '🔫',
    blurb: 'Once per game: shoot one player at night. If they are a Werewolf, they die. If they are anyone else (including Neutral roles), you die instead. Cannot shoot yourself.',
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: { type: 'shoot', prompt: 'Choose who to shoot tonight' }
  },

  tracker: {
    name: 'Tracker',
    team: 'town',
    icon: '🐾',
    blurb: 'Once per game: choose one player. You learn whether they visited someone that night or stayed home. Does not reveal who they visited or their role.',
    optional: true,
    usesPerGame: 1,
    silenceable: true,
    night: { type: 'track', prompt: 'Choose who to track tonight' }
  },

  doctor: {
    name: 'Doctor',
    team: 'town',
    icon: '💉',
    blurb: 'Every night: protect one player from the Werewolf attack and from poison. Can protect yourself. Can protect the same player repeatedly.',
    optional: true,
    usesPerGame: 'unlimited',
    silenceable: true,
    night: { type: 'protect', allowSelf: true, prompt: 'Choose who to protect tonight' }
  },

  veteran: {
    name: 'Veteran',
    team: 'town',
    icon: '🪖',
    blurb: 'Once per game: go on Alert. Anyone who visits you that night dies — Werewolves, Doctor, Tracker, anyone. A Doctor protecting you can prevent visitor deaths.',
    optional: true,
    usesPerGame: 1,
    night: { type: 'alert', prompt: 'Go on Alert? Anyone who visits you tonight dies.' }
  },

  mayor: {
    name: 'Mayor',
    team: 'town',
    icon: '🎖️',
    blurb: 'Passive: your vote always counts as 2. Your identity is hidden — you are never revealed. If you die, your extra vote is lost.',
    optional: true,
    usesPerGame: 0,
    voteWeight: 2
  },

  // ── WEREWOLF TEAM ────────────────────────────────────────────────
  werewolf: {
    name: 'Werewolf',
    team: 'werewolf',
    icon: '🐺',
    blurb: 'Each night, coordinate with your fellow Werewolves to choose one player to eliminate. Cannot target another Werewolf.',
    usesPerGame: 'unlimited',
    night: { type: 'kill', groupVote: true, prompt: 'Choose who to eliminate tonight' }
  },

  mageWerewolf: {
    name: 'Mage Werewolf',
    team: 'werewolf',
    icon: '🧙',
    blurb: 'Once per game: silence one player at night. Their ability fails that night. Does not stop them talking or voting. Other Werewolves know you exist. Can target yourself.',
    optional: true,
    usesPerGame: 1,
    night: { type: 'silence', allowSelf: true, prompt: 'Choose who to silence tonight (their ability will fail)' }
  },

  // ── NEUTRAL TEAM ─────────────────────────────────────────────────
  poisoner: {
    name: 'Poisoner',
    team: 'neutral',
    icon: '☠️',
    blurb: 'Once per game: poison one player. They die the following night unless a Doctor protects them. You win by surviving into the final 2 players alive. In the final 2, you beat a Villager but lose to a Werewolf.',
    optional: true,
    usesPerGame: 1,
    survivesToFinal2Win: true,
    night: { type: 'poison', prompt: 'Choose who to poison tonight' }
  },

  jester: {
    name: 'Jester',
    team: 'neutral',
    icon: '🎭',
    blurb: 'Win alone by being voted out during the day. Does not win if killed at night, shot by the Sheriff, or poisoned.',
    optional: true,
    usesPerGame: 0,
    winsIfVotedOut: true
  },

  amnesiac: {
    name: 'Amnesiac',
    team: 'neutral',
    icon: '🌫️',
    blurb: 'You start with no role, no ability, and no faction. Once per game (once at least one player has died): choose a dead player. You adopt their role and all their abilities — but you do not know what role they were until you choose.',
    optional: true,
    usesPerGame: 1,
    night: { type: 'adopt', prompt: 'Choose a dead player to adopt their role' }
  },

  pirate: {
    name: 'Pirate',
    team: 'neutral',
    icon: '🏴‍☠️',
    blurb: 'Once per game: spend one day in silence (cannot speak or vote) to prepare. The following night, challenge one player to a duel — coin toss decides who dies. Doctor can save your target. Veteran kills you if you visit them on Alert. Win condition: survive.',
    optional: true,
    usesPerGame: 1,
    night: { type: 'duel', prompt: 'Choose your duel target' }
  }
};

// ── HELPERS ──────────────────────────────────────────────────────────

// Roles the host can toggle on/off — everything with optional:true.
// Villager (automatic leftover) and Werewolf (stepper) are excluded.
export function optionalRoleKeys() {
  return Object.keys(ROLE_DEFS).filter(key => ROLE_DEFS[key].optional);
}

// Roles that belong to the Werewolf team (used for win-condition checks
// and for filtering valid kill targets — Werewolves cannot target each other).
export function werewolfTeamKeys() {
  return Object.keys(ROLE_DEFS).filter(key => ROLE_DEFS[key].team === 'werewolf');
}

export function defaultSettings() {
  const optionalRoles = {};
  optionalRoleKeys().forEach(key => {
    // Default on: Doctor only. Everything else off.
    optionalRoles[key] = key === 'doctor';
  });
  return {
    werewolfCount: 1,
    optionalRoles,
    nightSeconds: 60,
    daySeconds: 120
  };
}

// Returns { ok, error }.
export function validateSettings(settings, playerCount) {
  const enabledOptionalCount = Object.values(settings.optionalRoles || {}).filter(Boolean).length;
  // mageWerewolf counts toward the Werewolf team headcount for balance purposes
  const mageEnabled = settings.optionalRoles && settings.optionalRoles.mageWerewolf;
  const totalWerewolves = settings.werewolfCount + (mageEnabled ? 1 : 0);
  const totalSpecial = totalWerewolves + enabledOptionalCount;

  if (playerCount < 4) return { ok: false, error: 'You need at least 4 players to start.' };
  if (settings.werewolfCount < 1) return { ok: false, error: 'You need at least 1 Werewolf.' };
  if (totalSpecial >= playerCount) {
    return { ok: false, error: 'Too many special roles for this many players — leave room for at least 1 Villager.' };
  }
  if (totalWerewolves >= Math.ceil(playerCount / 2)) {
    return { ok: false, error: 'Too many Werewolves for this many players.' };
  }
  return { ok: true };
}

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

  // Assign base Werewolves
  for (let w = 0; w < settings.werewolfCount; w++) {
    roleByUid[shuffled[i]] = 'werewolf';
    werewolfUids.push(shuffled[i]);
    i++;
  }

  // Assign optional roles in definition order
  optionalRoleKeys().forEach(key => {
    if (settings.optionalRoles && settings.optionalRoles[key]) {
      roleByUid[shuffled[i]] = key;
      if (ROLE_DEFS[key].team === 'werewolf') werewolfUids.push(shuffled[i]);
      i++;
    }
  });

  // Fill remaining with Villager
  for (; i < shuffled.length; i++) roleByUid[shuffled[i]] = 'villager';

  return { roleByUid, werewolfUids };
}

// Tally a {voterUid: targetUid} map.
// weights: optional {uid: number} — Mayor's hidden double vote.
// Returns { targetUid, tie, tally }.
export function tallyVotes(votesObj, weights = {}) {
  const tally = {};
  Object.entries(votesObj || {}).forEach(([voter, target]) => {
    if (!target) return;
    const w = weights[voter] || 1;
    tally[target] = (tally[target] || 0) + w;
  });
  let best = null, bestCount = -1, tie = false;
  Object.entries(tally).forEach(([target, count]) => {
    if (count > bestCount) { best = target; bestCount = count; tie = false; }
    else if (count === bestCount) { tie = true; }
  });
  return { targetUid: tie ? null : best, tie, tally };
}

// Find the tied player UIDs (for revote). Returns [] if no tie.
export function tiedPlayers(votesObj, weights = {}) {
  const tally = {};
  Object.entries(votesObj || {}).forEach(([voter, target]) => {
    if (!target) return;
    const w = weights[voter] || 1;
    tally[target] = (tally[target] || 0) + w;
  });
  if (!Object.keys(tally).length) return [];
  const max = Math.max(...Object.values(tally));
  const tied = Object.entries(tally).filter(([, c]) => c === max).map(([uid]) => uid);
  return tied.length > 1 ? tied : [];
}

// playersObj: {uid: {alive, role}}.
// Returns null | 'town' | 'werewolf' | roleKey (for survivesToFinal2Win roles).
export function checkWinCondition(playersObj) {
  const alive = Object.values(playersObj).filter(p => p.alive);
  const aliveWolves = alive.filter(p => ROLE_DEFS[p.role]?.team === 'werewolf').length;
  const aliveOthers = alive.length - aliveWolves;

  // Werewolves win: equal or outnumber non-wolves
  if (aliveWolves > 0 && aliveWolves >= aliveOthers) {
    // Check survivesToFinal2Win: Poisoner in the final 2 loses to Werewolf per spec
    return 'werewolf';
  }

  // All Werewolves gone
  if (aliveWolves === 0) {
    // Check survivesToFinal2Win: Poisoner wins if alive in final 2 vs Villager
    if (alive.length === 2) {
      const survivor = alive.find(p => ROLE_DEFS[p.role]?.survivesToFinal2Win);
      if (survivor) return survivor.role; // e.g. 'poisoner'
    }
    return 'town';
  }

  return null;
}

export function winnerDisplay(winner) {
  if (winner === 'town') {
    return { label: 'Villagers win', team: 'town', sub: 'Every Werewolf has been hunted down.' };
  }
  if (winner === 'werewolf') {
    return { label: 'Werewolves win', team: 'werewolf', sub: 'The Werewolves now outnumber the town.' };
  }
  const def = ROLE_DEFS[winner];
  if (def && def.winsIfVotedOut) {
    return { label: `${def.name} wins`, team: def.team, sub: `${def.name} wanted to be voted out — and got their wish.` };
  }
  if (def && def.survivesToFinal2Win) {
    return { label: `${def.name} wins`, team: def.team, sub: `${def.name} survived into the final two.` };
  }
  if (def) {
    return { label: `${def.name} wins`, team: def.team, sub: '' };
  }
  return { label: 'Game over', team: 'neutral', sub: '' };
}
