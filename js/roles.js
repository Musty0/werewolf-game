// roles.js — role data + pure game-logic helpers.
//
// THE POINT OF THIS FILE: adding a new role should mostly mean adding
// one entry to ROLE_DEFS, not editing code in five places. A role that
// fits one of the existing mechanical patterns below gets the Hunt
// Rules toggle, role assignment, the night-action UI, night
// resolution, vote weighting, and the Roles reference popup all for
// free — nothing else in the app needs to change.
//
// Supported patterns (set these fields on a role definition):
//   night: { type: 'kill' | 'protect' | 'investigate', prompt, allowSelf, groupVote }
//     -> a "choose one player" action at night. groupVote:true means
//        every player with this role votes together and majority wins
//        (this is how Mafia works — multiple players, one shared kill).
//        groupVote:false/omitted means exactly one player normally
//        holds this role and their single submission is used directly.
//   optional: true
//     -> shows up as an on/off toggle in the host's Hunt Rules popup.
//        (Villager is never toggled — it's just "whatever's left over".
//        Mafia uses a headcount stepper instead of a toggle.)
//   revealable: true, voteWeight: N
//     -> shows a "reveal yourself" button during the day; once
//        revealed, this player's vote counts for N instead of 1.
//   winsIfVotedOut: true
//     -> if the town votes this player out, they win alone immediately
//        and the game ends (like a Jester).
//
// A role with a genuinely new mechanic — something that triggers on
// death, links two players' fates together, has a limited number of
// uses, etc. — will still need real code in app.js. No data schema can
// predict a mechanic it doesn't know about; that's not a gap you can
// design around, just a fact about how specific Mafia-variant roles
// can get. Patterns above cover most of the common ones, though
// (Bodyguard/Vigilante-style protect-or-kill roles, extra investigator
// roles, Tanner-style alternate win conditions, vote-weight roles).

export const ROLE_DEFS = {
  villager: {
    name: 'Villager',
    team: 'town',
    icon: '🧑‍🌾',
    blurb: 'No special power. Watch, listen, and vote out the Mafia.'
  },
  mafia: {
    name: 'Mafia',
    team: 'mafia',
    icon: '🔪',
    blurb: 'Each night, choose a target with your fellow Mafia to eliminate.',
    night: { type: 'kill', groupVote: true, prompt: 'Choose who Mafia eliminates tonight' }
  },
  detective: {
    name: 'Detective',
    team: 'town',
    icon: '🔎',
    blurb: 'Each night, investigate one player to learn if they are Mafia.',
    optional: true,
    night: { type: 'investigate', prompt: 'Choose who to investigate tonight' }
  },
  doctor: {
    name: 'Doctor',
    team: 'town',
    icon: '💉',
    blurb: 'Each night, choose one player to protect from the Mafia.',
    optional: true,
    night: { type: 'protect', allowSelf: true, prompt: 'Choose who to protect tonight' }
  },
  jester: {
    name: 'Jester',
    team: 'neutral',
    icon: '🎭',
    blurb: 'You win alone if the town votes you out during the day.',
    optional: true,
    winsIfVotedOut: true
  },
  mayor: {
    name: 'Mayor',
    team: 'town',
    icon: '🎖️',
    blurb: 'Reveal yourself during the day to double your vote — but it makes you a target.',
    optional: true,
    revealable: true,
    voteWeight: 2
  }
};

// Roles the host can switch on/off in Hunt Rules — everything marked
// optional:true. Villager (the automatic leftover role) and Mafia
// (sized with a headcount stepper, not a toggle) are deliberately
// excluded.
export function optionalRoleKeys() {
  return Object.keys(ROLE_DEFS).filter(key => ROLE_DEFS[key].optional);
}

export function defaultSettings() {
  const optionalRoles = {};
  optionalRoleKeys().forEach(key => { optionalRoles[key] = key === 'detective' || key === 'doctor'; });
  return {
    mafiaCount: 1,
    optionalRoles,
    nightSeconds: 60,
    daySeconds: 120
  };
}

// Returns { ok, error } — validates a settings object against a player count.
export function validateSettings(settings, playerCount) {
  const enabledOptionalCount = Object.values(settings.optionalRoles || {}).filter(Boolean).length;
  const specialCount = settings.mafiaCount + enabledOptionalCount;
  if (playerCount < 4) return { ok: false, error: 'You need at least 4 players to start.' };
  if (settings.mafiaCount < 1) return { ok: false, error: 'You need at least 1 Mafia.' };
  if (specialCount >= playerCount) {
    return { ok: false, error: 'Too many special roles for this many players — leave room for at least 1 Villager.' };
  }
  if (settings.mafiaCount >= Math.ceil(playerCount / 2)) {
    return { ok: false, error: 'Too many Mafia for this many players.' };
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

// playerIds: array of uids. settings: object from defaultSettings().
// Returns { roleByUid: {uid: roleKey}, mafiaUids: [uid,...] }
export function assignRoles(playerIds, settings) {
  const shuffled = shuffle(playerIds);
  const roleByUid = {};
  let i = 0;
  const mafiaUids = [];
  for (let m = 0; m < settings.mafiaCount; m++) { roleByUid[shuffled[i]] = 'mafia'; mafiaUids.push(shuffled[i]); i++; }
  optionalRoleKeys().forEach(key => {
    if (settings.optionalRoles && settings.optionalRoles[key]) { roleByUid[shuffled[i]] = key; i++; }
  });
  for (; i < shuffled.length; i++) roleByUid[shuffled[i]] = 'villager';
  return { roleByUid, mafiaUids };
}

// Tally a {voterUid: targetUid} map into the most-voted target.
// weights: optional {voterUid: weight} (used for revealable vote-weight roles).
// Returns { targetUid: string|null, tie: boolean, tally: {targetUid: count} }
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

// Resolve one night from a generic per-role submissions map.
// nightActionsByRole: { [roleKey]: { [submitterUid]: targetUid } }
// For solo roles this naturally holds exactly one entry; for
// groupVote roles (Mafia) it can hold several, and majority wins.
// Returns { killedUid, savedByDoctor, investigations }
//   investigations: [{ roleKey, investigatorUid, targetUid }, ...]
export function resolveNightActions(nightActionsByRole) {
  let killedUid = null;
  let protectedUid = null;
  const investigations = [];

  Object.entries(ROLE_DEFS).forEach(([key, def]) => {
    if (!def.night) return;
    const votes = (nightActionsByRole && nightActionsByRole[key]) || {};
    const { targetUid } = tallyVotes(votes);
    if (!targetUid) return;
    if (def.night.type === 'kill') killedUid = targetUid;
    if (def.night.type === 'protect') protectedUid = targetUid;
    if (def.night.type === 'investigate') {
      Object.entries(votes).forEach(([investigatorUid, target]) => {
        if (target) investigations.push({ roleKey: key, investigatorUid, targetUid: target });
      });
    }
  });

  const savedByDoctor = !!(killedUid && protectedUid === killedUid);
  return {
    killedUid: savedByDoctor ? null : killedUid,
    savedByDoctor,
    investigations
  };
}

// playersObj: {uid: {alive, role}} — full players map with roles attached.
// Returns null (no winner yet) or 'town' | 'mafia'
export function checkWinCondition(playersObj) {
  const alive = Object.values(playersObj).filter(p => p.alive);
  const aliveMafia = alive.filter(p => p.role === 'mafia').length;
  const aliveOther = alive.length - aliveMafia;
  if (aliveMafia === 0) return 'town';
  if (aliveMafia >= aliveOther) return 'mafia';
  return null;
}

// Turns a winner value ('town' | 'mafia' | a winsIfVotedOut role key)
// into end-screen display text, so a future Tanner-style role doesn't
// need its own hardcoded case here.
export function winnerDisplay(winner) {
  if (winner === 'town') {
    return { label: 'Town wins', team: 'town', sub: 'Every Mafia member has been rooted out.' };
  }
  if (winner === 'mafia') {
    return { label: 'Mafia wins', team: 'mafia', sub: 'The Mafia outnumbered the town.' };
  }
  const def = ROLE_DEFS[winner];
  if (def) {
    return {
      label: `${def.name} wins`,
      team: def.team,
      sub: `${def.name} wanted to be voted out \u2014 and got their wish.`
    };
  }
  return { label: 'Game over', team: 'neutral', sub: '' };
}
