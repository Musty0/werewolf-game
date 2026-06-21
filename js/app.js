// app.js — Werewolf, a serverless Mafia/Werewolf party game.
//
// Architecture: every browser tab is just a renderer for Firebase
// Realtime Database state. There is no backend server — the HOST's
// browser tab acts as the "resolver" (it computes night/day outcomes
// and writes the result back to Firebase) whenever the phase timer
// runs out or the host taps "Resolve now". Every other tab just
// reacts to whatever the database says.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, push, onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";
import {
  ROLE_DEFS, optionalRoleKeys, defaultSettings, validateSettings, assignRoles,
  resolveNightActions, tallyVotes, checkWinCondition, winnerDisplay
} from "./roles.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

if (!firebaseConfig.apiKey || String(firebaseConfig.apiKey).includes('REPLACE_ME')) {
  console.warn('firebase-config.js still has placeholder values — see README steps 1-3.');
  const banner = document.getElementById('config-warning');
  if (banner) banner.classList.remove('hidden');
}

let uid = null;
let lobbyCode = null;
let isHost = false;
let countdownInterval = null;
let resolvingInProgress = false;
let myNightSubmission = null;
let myNightSubmissionRound = null;

const state = {
  hostId: null, phase: 'lobby', round: 0, phaseEndsAt: null, winner: null,
  settings: defaultSettings(), players: {}, log: {}, votes: {},
  mafiaTeam: null, myRole: null, myPrivate: {}, publicReveal: null
};

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const screens = {
  landing: $('screen-landing'),
  waiting: $('screen-waiting'),
  game: $('screen-game'),
  end: $('screen-end'),
};
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------- modals
// Secondary content (settings, full role detail, the log, the full
// roster) lives in modals so the main screens never need to scroll.
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
});

$('open-settings-btn').addEventListener('click', () => openModal('settings-modal'));
$('settings-modal-close').addEventListener('click', () => closeModal('settings-modal'));
$('role-chip-btn').addEventListener('click', () => openModal('role-modal'));
$('role-modal-close').addEventListener('click', () => closeModal('role-modal'));
$('open-log-btn').addEventListener('click', () => { openModal('log-modal'); markLogSeen(); });
$('log-modal-close').addEventListener('click', () => closeModal('log-modal'));
$('open-roster-btn').addEventListener('click', () => openModal('roster-modal'));
$('roster-modal-close').addEventListener('click', () => closeModal('roster-modal'));

$('open-help-btn').addEventListener('click', () => openModal('help-modal'));
$('help-modal-close').addEventListener('click', () => closeModal('help-modal'));

$('open-roles-btn').addEventListener('click', () => openModal('roles-modal'));
$('roles-modal-close').addEventListener('click', () => closeModal('roles-modal'));

$('roles-reference-list').innerHTML = Object.values(ROLE_DEFS).map(def => `
  <div class="roles-reference-item">
    <span class="rr-icon">${def.icon}</span>
    <div>
      <div class="rr-name">${def.name}</div>
      <p class="rr-blurb">${def.blurb}</p>
    </div>
  </div>
`).join('');

// -------------------------------------------------------- name memory
function getSavedName() { return localStorage.getItem('werewolf_name') || ''; }
function saveName(n) { localStorage.setItem('werewolf_name', n); }
$('create-name-input').value = getSavedName();
$('join-name-input').value = getSavedName();

// -------------------------------------------------------------- route
function getBasePath() {
  const path = location.pathname;
  const idx = path.indexOf('/lobby/');
  if (idx !== -1) return path.slice(0, idx) || '';
  return path.replace(/\/index\.html$/, '').replace(/\/$/, '');
}
function getCodeFromURL() {
  const m = location.pathname.match(/\/lobby\/([A-Za-z0-9]+)/);
  return m ? m[1].toUpperCase() : null;
}
function lobbyURL(code) { return `${location.origin}${getBasePath()}/lobby/${code}`; }
function goToLobbyURL(code) { history.pushState(null, '', `${getBasePath()}/lobby/${code}`); }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read aloud
function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// --------------------------------------------------------------- auth
function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { uid = user.uid; unsub(); resolve(user); }
    }, reject);
    signInAnonymously(auth).catch(reject);
  });
}

// Firebase errors carry a .code like 'auth/invalid-api-key' or
// 'PERMISSION_DENIED'. Translate the common setup mistakes into
// something actionable instead of a generic "check your connection".
function friendlyFirebaseError(e) {
  const code = String((e && e.code) || '').toLowerCase();
  const message = String((e && e.message) || '').toLowerCase();
  if (code.includes('api-key') || code.includes('invalid-api-key') || message.includes('api key')) {
    return 'Firebase rejected the API key — check js/firebase-config.js has your real project values, not the placeholders.';
  }
  if (code.includes('operation-not-allowed')) {
    return 'Anonymous sign-in isn\u2019t turned on in Firebase \u2014 enable it under Authentication \u2192 Sign-in method.';
  }
  if (code.includes('permission_denied') || message.includes('permission_denied') || message.includes('permission denied')) {
    return 'Firebase rejected that request \u2014 check the Realtime Database rules are published (README step 4).';
  }
  if (code.includes('network') || message.includes('network')) {
    return 'Could not reach Firebase \u2014 check your internet connection.';
  }
  if (code.includes('not-found') || message.includes('not-found')) {
    return 'Firebase project not found \u2014 double-check the databaseURL in js/firebase-config.js.';
  }
  console.warn('Unrecognized Firebase error — open DevTools Console for the full message.');
  return 'Could not reach Firebase. Open the browser console (F12) for the exact error.';
}

// ============================================================ CREATE
$('create-lobby-btn').addEventListener('click', async () => {
  const name = $('create-name-input').value.trim();
  if (!name) return toast('Enter your name first', true);
  saveName(name);
  $('create-lobby-btn').disabled = true;
  try {
    await ensureAuth();
    const code = await createUniqueLobby(name);
    goToLobbyURL(code);
    enterLobby(code);
  } catch (e) {
    console.error(e);
    toast(friendlyFirebaseError(e), true);
  } finally {
    $('create-lobby-btn').disabled = false;
  }
});

async function createUniqueLobby(hostName) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const takenSnap = await get(ref(db, `lobbies/${code}/hostId`));
    if (takenSnap.exists()) continue;
    await set(ref(db, `lobbies/${code}/hostId`), uid);
    await update(ref(db, `lobbies/${code}`), {
      createdAt: Date.now(),
      phase: 'lobby',
      round: 0,
      settings: defaultSettings(),
    });
    await set(ref(db, `lobbies/${code}/players/${uid}`), {
      name: hostName, alive: true, isHost: true, joinedAt: Date.now(), revealed: false
    });
    return code;
  }
  throw new Error('Could not generate a unique lobby code — try again.');
}

// ============================================================== JOIN
$('join-lobby-btn').addEventListener('click', async () => {
  const name = $('join-name-input').value.trim();
  const code = $('join-code-input').value.trim().toUpperCase();
  if (!name) return toast('Enter your name first', true);
  if (!code) return toast('Enter a lobby code', true);
  saveName(name);
  $('join-lobby-btn').disabled = true;
  try {
    await ensureAuth();
    await joinLobby(code, name);
    goToLobbyURL(code);
    enterLobby(code);
  } catch (e) {
    console.error(e);
    const knownMessages = ['No lobby found with that code', 'That game has already started'];
    toast(knownMessages.includes(e.message) ? e.message : friendlyFirebaseError(e), true);
  } finally {
    $('join-lobby-btn').disabled = false;
  }
});

async function joinLobby(code, name) {
  const hostSnap = await get(ref(db, `lobbies/${code}/hostId`));
  if (!hostSnap.exists()) throw new Error('No lobby found with that code');
  const meSnap = await get(ref(db, `lobbies/${code}/players/${uid}`));
  if (!meSnap.exists()) {
    const phaseSnap = await get(ref(db, `lobbies/${code}/phase`));
    if (phaseSnap.val() !== 'lobby') throw new Error('That game has already started');
    await set(ref(db, `lobbies/${code}/players/${uid}`), {
      name, alive: true, isHost: false, joinedAt: Date.now(), revealed: false
    });
  }
}

$('copy-link-btn').addEventListener('click', async () => {
  const url = lobbyURL(lobbyCode);
  try {
    if (navigator.share) await navigator.share({ title: 'Join my Werewolf game', url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
  } catch (e) { /* user cancelled share — ignore */ }
});

// ======================================================== ENTER LOBBY
function enterLobby(code) {
  lobbyCode = code;
  attachListeners(code);
}

function attachListeners(code) {
  onValue(ref(db, `lobbies/${code}/hostId`), s => { state.hostId = s.val(); isHost = state.hostId === uid; render(); });
  onValue(ref(db, `lobbies/${code}/phase`), s => { state.phase = s.val() || 'lobby'; render(); });
  onValue(ref(db, `lobbies/${code}/round`), s => { state.round = s.val() || 0; render(); });
  onValue(ref(db, `lobbies/${code}/phaseEndsAt`), s => { state.phaseEndsAt = s.val(); render(); });
  onValue(ref(db, `lobbies/${code}/winner`), s => { state.winner = s.val(); render(); });
  onValue(ref(db, `lobbies/${code}/settings`), s => { state.settings = s.val() || defaultSettings(); render(); });
  onValue(ref(db, `lobbies/${code}/players`), s => { state.players = s.val() || {}; render(); });
  onValue(ref(db, `lobbies/${code}/log`), s => { state.log = s.val() || {}; render(); });
  onValue(ref(db, `lobbies/${code}/votes`), s => { state.votes = s.val() || {}; render(); });
  onValue(ref(db, `lobbies/${code}/publicReveal`), s => { state.publicReveal = s.val(); render(); });
  onValue(ref(db, `lobbies/${code}/private/${uid}`), s => { state.myPrivate = s.val() || {}; render(); });
  onValue(ref(db, `lobbies/${code}/secretRoles/${uid}`), s => {
    state.myRole = s.val() || null;
    if (state.myRole === 'mafia' && !state.mafiaTeam) {
      get(ref(db, `lobbies/${code}/mafiaTeam`))
        .then(snap => { state.mafiaTeam = snap.val() || {}; render(); })
        .catch(() => {});
    }
    render();
  });
}

function render() {
  if (!lobbyCode || !state.hostId) return;
  if (state.phase === 'lobby') renderWaitingRoom();
  else if (state.phase === 'ended') renderEndScreen();
  else renderGameScreen();
}

// ========================================================= INIT/LOAD
async function init() {
  const code = getCodeFromURL();
  if (!code) { showScreen('landing'); return; }
  try {
    await ensureAuth();
    const hostSnap = await get(ref(db, `lobbies/${code}/hostId`));
    if (!hostSnap.exists()) {
      toast('That lobby no longer exists', true);
      history.replaceState(null, '', getBasePath() + '/');
      showScreen('landing');
      return;
    }
    const meSnap = await get(ref(db, `lobbies/${code}/players/${uid}`));
    if (meSnap.exists()) {
      enterLobby(code);
    } else {
      $('join-code-input').value = code;
      showScreen('landing');
      $('join-name-input').focus({ preventScroll: false });
    }
  } catch (e) {
    console.error(e);
    showScreen('landing');
  }
}
init();

// ===================================================== WAITING ROOM
function playerChipHTML(pid, p) {
  const initial = (p.name || '?').slice(0, 1).toUpperCase();
  const meClass = pid === uid ? ' is-me' : '';
  const deadClass = p.alive === false ? ' is-dead' : '';
  let tag = '';
  if (p.isHost) tag = '<span class="tag">Host</span>';
  else if (p.revealed && p.revealedRoleName) tag = `<span class="tag">${escapeHTML(p.revealedRoleName)}</span>`;
  return `<div class="player-chip${meClass}${deadClass}">
    <div class="avatar">${initial}</div>
    <div class="name">${escapeHTML(p.name || 'Player')}</div>
    ${tag}
  </div>`;
}

function clampSeconds(v, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
function updateSetting(key, value) {
  if (!isHost || !lobbyCode) return;
  update(ref(db, `lobbies/${lobbyCode}/settings`), { [key]: value });
}
function updateOptionalRole(roleKey, value) {
  if (!isHost || !lobbyCode) return;
  update(ref(db, `lobbies/${lobbyCode}/settings/optionalRoles`), { [roleKey]: value });
}
$('mafia-minus').addEventListener('click', () => updateSetting('mafiaCount', Math.max(1, (state.settings.mafiaCount || 1) - 1)));
$('mafia-plus').addEventListener('click', () => updateSetting('mafiaCount', (state.settings.mafiaCount || 1) + 1));
$('night-seconds-input').addEventListener('change', e => updateSetting('nightSeconds', clampSeconds(e.target.value, 15, 600)));
$('day-seconds-input').addEventListener('change', e => updateSetting('daySeconds', clampSeconds(e.target.value, 15, 900)));

// Build one toggle row per optional role (anything in ROLE_DEFS with
// optional:true) — add a new role to ROLE_DEFS and it shows up here
// automatically, no HTML or listener wiring needed.
const OPTIONAL_ROLE_KEYS = optionalRoleKeys();
$('optional-roles-rows').innerHTML = OPTIONAL_ROLE_KEYS.map(key => {
  const def = ROLE_DEFS[key];
  return `<div class="toggle-row">
    <span class="role-mini">${def.icon} ${escapeHTML(def.name)}</span>
    <label class="switch"><input type="checkbox" id="toggle-role-${key}"><span class="track"></span></label>
  </div>`;
}).join('');
OPTIONAL_ROLE_KEYS.forEach(key => {
  $(`toggle-role-${key}`).addEventListener('change', e => updateOptionalRole(key, e.target.checked));
});

function renderWaitingRoom() {
  showScreen('waiting');
  $('waiting-code').textContent = lobbyCode;
  const list = Object.entries(state.players);
  $('player-count').textContent = list.length;
  $('waiting-player-list').innerHTML = list.map(([pid, p]) => playerChipHTML(pid, p)).join('');

  $('host-footer-row').classList.toggle('hidden', !isHost);
  $('start-game-hint').classList.toggle('hidden', !isHost);
  $('waiting-non-host-note').classList.toggle('hidden', isHost);

  if (isHost) {
    const s = state.settings;
    $('mafia-count-value').textContent = s.mafiaCount;
    OPTIONAL_ROLE_KEYS.forEach(key => {
      const el = $(`toggle-role-${key}`);
      if (el) el.checked = !!(s.optionalRoles && s.optionalRoles[key]);
    });
    $('night-seconds-input').value = s.nightSeconds;
    $('day-seconds-input').value = s.daySeconds;

    const check = validateSettings(s, list.length);
    $('start-game-btn').disabled = !check.ok;
    $('start-game-hint').textContent = check.ok ? `${list.length} players ready to go.` : check.error;
  }
}

$('start-game-btn').addEventListener('click', async () => {
  if (!isHost) return;
  const playerIds = Object.keys(state.players);
  const settings = state.settings;
  const check = validateSettings(settings, playerIds.length);
  if (!check.ok) return toast(check.error, true);

  const { roleByUid, mafiaUids } = assignRoles(playerIds, settings);
  const updates = {};
  playerIds.forEach(pid => { updates[`lobbies/${lobbyCode}/secretRoles/${pid}`] = roleByUid[pid]; });
  const mafiaTeamObj = {};
  mafiaUids.forEach(pid => { mafiaTeamObj[pid] = true; });
  updates[`lobbies/${lobbyCode}/mafiaTeam`] = mafiaTeamObj;
  updates[`lobbies/${lobbyCode}/phase`] = 'night';
  updates[`lobbies/${lobbyCode}/round`] = 1;
  updates[`lobbies/${lobbyCode}/phaseEndsAt`] = Date.now() + (settings.nightSeconds || 60) * 1000;
  updates[`lobbies/${lobbyCode}/winner`] = null;
  updates[`lobbies/${lobbyCode}/log/${newLogKey()}`] = logEntry(
    `Night falls on the town. ${mafiaUids.length} Mafia ${mafiaUids.length === 1 ? 'is' : 'are'} hiding among ${playerIds.length} players.`,
    'night'
  );

  $('start-game-btn').disabled = true;
  try {
    await update(ref(db), updates);
  } catch (e) {
    console.error(e);
    toast('Could not start the game', true);
  } finally {
    $('start-game-btn').disabled = false;
  }
});

function newLogKey() { return push(ref(db, `lobbies/${lobbyCode}/log`)).key; }
function logEntry(text, type = 'info') { return { text, type, ts: Date.now() }; }

// ============================================================= GAME
function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startCountdown(endsAt, totalSeconds) {
  clearInterval(countdownInterval);
  if (!endsAt) { $('clock-time').textContent = formatTime(totalSeconds); return; }
  function tick() {
    const secLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    $('clock-time').textContent = formatTime(secLeft);
    const pct = totalSeconds > 0 ? Math.max(0, Math.min(100, (secLeft / totalSeconds) * 100)) : 0;
    $('town-clock').style.setProperty('--pct', pct.toFixed(1));
    if (secLeft <= 0) {
      clearInterval(countdownInterval);
      if (isHost) autoResolve();
    }
  }
  tick();
  countdownInterval = setInterval(tick, 250);
}

async function autoResolve() {
  if (resolvingInProgress) return;
  resolvingInProgress = true;
  try {
    if (state.phase === 'night') await resolveNight();
    else if (state.phase === 'day') await resolveDay();
  } catch (e) {
    console.error(e);
  } finally {
    resolvingInProgress = false;
  }
}
$('resolve-now-btn').addEventListener('click', () => { if (isHost) autoResolve(); });

function renderRoleCard(players) {
  const role = state.myRole || 'villager';
  const def = ROLE_DEFS[role] || ROLE_DEFS.villager;
  $('role-icon').textContent = def.icon;
  $('role-chip-icon').textContent = def.icon;
  $('role-chip-name').textContent = def.name;
  $('role-name').textContent = def.name;
  let blurb = def.blurb;

  const teamEl = $('role-team');
  teamEl.textContent = def.team === 'town' ? 'Town' : def.team === 'mafia' ? 'Mafia' : 'Neutral';
  teamEl.className = `role-team team-${def.team}`;

  const mafiaList = $('mafia-team-list');
  if (role === 'mafia' && state.mafiaTeam) {
    const names = Object.keys(state.mafiaTeam).filter(pid => pid !== uid).map(pid => players[pid]?.name).filter(Boolean);
    mafiaList.classList.toggle('hidden', names.length === 0);
    mafiaList.innerHTML = names.length ? `Your fellow Mafia: <strong>${names.map(escapeHTML).join(', ')}</strong>` : '';
  } else {
    mafiaList.classList.add('hidden');
  }

  if (def.night && def.night.type === 'investigate' && state.myPrivate && state.myPrivate.investigations) {
    const results = state.myPrivate.investigations;
    const rounds = Object.keys(results).map(Number);
    if (rounds.length) {
      const lastRound = Math.max(...rounds);
      const r = results[lastRound];
      const name = players[r.target]?.name || 'That player';
      blurb += ` Last night: ${name} is ${r.isMafia ? 'Mafia 🔪' : 'not Mafia ✅'}.`;
    }
  }
  $('role-blurb').textContent = blurb;
}

function renderNightAction() {
  const role = state.myRole;
  const def = ROLE_DEFS[role];
  if (!def || !def.night) { $('night-action-card').classList.add('hidden'); return; }
  $('night-action-card').classList.remove('hidden');
  $('night-action-label').textContent = def.night.prompt || 'Choose your target';

  if (myNightSubmissionRound !== state.round) { myNightSubmission = null; myNightSubmissionRound = state.round; }

  const targets = Object.entries(state.players).filter(([, p]) => p.alive !== false);
  $('night-action-targets').innerHTML = targets.map(([pid, p]) => {
    const disabled = !def.night.allowSelf && pid === uid;
    const selected = myNightSubmission === pid;
    return `<button class="vote-target${selected ? ' selected' : ''}" data-pid="${pid}" ${disabled ? 'disabled' : ''} type="button">${escapeHTML(p.name)}</button>`;
  }).join('');

  $('night-action-targets').querySelectorAll('.vote-target').forEach(btn => {
    btn.addEventListener('click', () => submitNightAction(role, btn.dataset.pid));
  });

  $('night-action-status').textContent = myNightSubmission ? 'Locked in — you can change your mind until night ends.' : 'Pick a target above.';
}

async function submitNightAction(role, targetPid) {
  myNightSubmission = targetPid;
  myNightSubmissionRound = state.round;
  const round = state.round;
  try {
    await set(ref(db, `lobbies/${lobbyCode}/nightActions/${round}/${role}/${uid}`), targetPid);
    renderNightAction();
  } catch (e) { console.error(e); toast('Could not submit — try again', true); }
}

function tallyMarksHTML(count) {
  if (count <= 0) return '';
  const groups = [];
  let remaining = count;
  while (remaining > 0) { groups.push(Math.min(5, remaining)); remaining -= 5; }
  const groupsHTML = groups.map(n => {
    const strokes = Array.from({ length: Math.min(n, 4) }).map(() => `<span class="tally-stroke"></span>`).join('');
    const slash = n === 5 ? `<span class="tally-slash"></span>` : '';
    return `<span class="tally-group">${strokes}${slash}</span>`;
  }).join('');
  return `<span class="tally" aria-label="${count} vote${count === 1 ? '' : 's'}">${groupsHTML}</span>`;
}

function renderDayVote() {
  $('day-vote-card').classList.remove('hidden');
  const round = state.round;
  const roundVotes = state.votes[round] || {};
  const myVote = roundVotes[uid] || null;
  const tally = {};
  Object.values(roundVotes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });

  const targets = Object.entries(state.players).filter(([pid, p]) => p.alive !== false && pid !== uid);
  $('day-vote-targets').innerHTML = targets.map(([pid, p]) => {
    const selected = myVote === pid;
    const count = tally[pid] || 0;
    return `<button class="vote-target${selected ? ' selected' : ''}" data-pid="${pid}" type="button">
      <span>${escapeHTML(p.name)}</span><span class="count">${tallyMarksHTML(count)}</span>
    </button>`;
  }).join('');

  $('day-vote-targets').querySelectorAll('.vote-target').forEach(btn => {
    btn.addEventListener('click', () => castVote(btn.dataset.pid));
  });
}

async function castVote(targetPid) {
  try { await set(ref(db, `lobbies/${lobbyCode}/votes/${state.round}/${uid}`), targetPid); }
  catch (e) { console.error(e); toast('Could not cast vote', true); }
}

$('reveal-btn').addEventListener('click', async () => {
  const def = ROLE_DEFS[state.myRole];
  if (!def || !def.revealable) return;
  try {
    const updates = {};
    updates[`lobbies/${lobbyCode}/players/${uid}/revealed`] = true;
    updates[`lobbies/${lobbyCode}/players/${uid}/revealedRoleName`] = def.name;
    updates[`lobbies/${lobbyCode}/players/${uid}/revealedRoleIcon`] = def.icon;
    const weightNote = def.voteWeight ? ` Their vote now counts for ${def.voteWeight}.` : '';
    updates[`lobbies/${lobbyCode}/log/${newLogKey()}`] = logEntry(
      `${state.players[uid]?.name || 'A player'} has revealed themselves as ${def.name}!${weightNote}`, 'info'
    );
    await update(ref(db), updates);
  } catch (e) { console.error(e); toast('Could not reveal', true); }
});

let lastSeenLogCount = 0;
function markLogSeen() {
  lastSeenLogCount = Object.keys(state.log || {}).length;
  $('log-dot').classList.add('hidden');
}

function renderLog() {
  const entries = Object.values(state.log || {}).sort((a, b) => a.ts - b.ts);
  $('log-feed').innerHTML = entries.map(e =>
    `<div class="log-entry${e.type === 'death' ? ' is-death' : ''}${e.type === 'win' ? ' is-win' : ''}">${escapeHTML(e.text)}</div>`
  ).join('');
  $('log-dot').classList.toggle('hidden', entries.length <= lastSeenLogCount);
}

function renderGamePlayerList() {
  const entries = Object.entries(state.players);
  $('alive-count').textContent = entries.filter(([, p]) => p.alive !== false).length;
  $('game-player-list').innerHTML = entries.map(([pid, p]) => playerChipHTML(pid, p)).join('');
}

function renderGameScreen() {
  showScreen('game');
  const phase = state.phase;
  const settings = state.settings;

  const clock = $('town-clock');
  clock.classList.toggle('is-night', phase === 'night');
  clock.classList.toggle('is-day', phase === 'day');
  $('clock-phase').textContent = phase === 'night' ? 'Night' : 'Day';
  $('clock-round').textContent = `Round ${state.round}`;
  startCountdown(state.phaseEndsAt, phase === 'night' ? (settings.nightSeconds || 60) : (settings.daySeconds || 120));

  renderRoleCard(state.players);

  $('night-action-card').classList.add('hidden');
  $('day-vote-card').classList.add('hidden');
  $('reveal-card').classList.add('hidden');

  const me = state.players[uid];
  const myAlive = me ? me.alive !== false : false;
  const myDef = ROLE_DEFS[state.myRole];

  if (phase === 'night' && myAlive) renderNightAction();
  if (phase === 'day' && myAlive) {
    renderDayVote();
    if (myDef && myDef.revealable && me && !me.revealed) {
      $('reveal-card').classList.remove('hidden');
      $('reveal-btn').textContent = `${myDef.icon} Reveal yourself as ${myDef.name}`;
    }
  }

  const showingNight = !$('night-action-card').classList.contains('hidden');
  const showingDay = !$('day-vote-card').classList.contains('hidden');
  const emptyNote = $('no-action-note');
  if (!myAlive) {
    emptyNote.textContent = 'You have been eliminated. Watch how the hunt unfolds.';
    emptyNote.classList.remove('hidden');
  } else if (phase === 'night' && !showingNight) {
    emptyNote.textContent = 'The town sleeps. Wait for sunrise\u2026';
    emptyNote.classList.remove('hidden');
  } else if (phase === 'day' && !showingDay) {
    emptyNote.textContent = 'The town is voting. Wait for the verdict\u2026';
    emptyNote.classList.remove('hidden');
  } else {
    emptyNote.classList.add('hidden');
  }

  $('host-controls-card').classList.toggle('hidden', !isHost);
  renderLog();
  renderGamePlayerList();
}

// ===================================================== PHASE RESOLVE
async function resolveNight() {
  const round = state.round;
  const code = lobbyCode;
  const [actionsSnap, rolesSnap] = await Promise.all([
    get(ref(db, `lobbies/${code}/nightActions/${round}`)),
    get(ref(db, `lobbies/${code}/secretRoles`)),
  ]);
  const nightActionsByRole = actionsSnap.val() || {};
  const roles = rolesSnap.val() || {};

  const { killedUid, savedByDoctor, investigations } = resolveNightActions(nightActionsByRole);

  const updates = {};
  const playersNow = state.players;
  let logText;
  if (killedUid && playersNow[killedUid]) {
    updates[`lobbies/${code}/players/${killedUid}/alive`] = false;
    logText = `${playersNow[killedUid].name} was found dead this morning.`;
  } else if (savedByDoctor) {
    logText = `Someone was attacked last night, but they were protected.`;
  } else {
    logText = `The town was quiet last night. No one died.`;
  }
  updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(logText, killedUid ? 'death' : 'info');

  investigations.forEach(({ investigatorUid, targetUid }) => {
    if (!playersNow[targetUid]) return;
    const isMafia = roles[targetUid] === 'mafia';
    updates[`lobbies/${code}/private/${investigatorUid}/investigations/${round}`] = { target: targetUid, isMafia, ts: Date.now() };
  });

  const projected = {};
  Object.entries(playersNow).forEach(([pid, p]) => {
    projected[pid] = { ...p, alive: pid === killedUid ? false : p.alive, role: roles[pid] };
  });
  const winner = checkWinCondition(projected);
  if (winner) { await finishGame(updates, winner, roles); return; }

  updates[`lobbies/${code}/phase`] = 'day';
  updates[`lobbies/${code}/phaseEndsAt`] = Date.now() + (state.settings.daySeconds || 120) * 1000;
  await update(ref(db), updates);
}

async function resolveDay() {
  const round = state.round;
  const code = lobbyCode;
  const [votesSnap, rolesSnap] = await Promise.all([
    get(ref(db, `lobbies/${code}/votes/${round}`)),
    get(ref(db, `lobbies/${code}/secretRoles`)),
  ]);
  const votes = votesSnap.val() || {};
  const roles = rolesSnap.val() || {};
  const weights = {};
  Object.entries(state.players).forEach(([pid, p]) => {
    const roleDef = ROLE_DEFS[roles[pid]];
    if (p.revealed && roleDef && roleDef.voteWeight) weights[pid] = roleDef.voteWeight;
  });
  const { targetUid, tie } = tallyVotes(votes, weights);

  const updates = {};
  let eliminatedUid = null;
  if (!targetUid || tie) {
    updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(`The town couldn't agree — no one was voted out.`, 'info');
  } else {
    eliminatedUid = targetUid;
    updates[`lobbies/${code}/players/${eliminatedUid}/alive`] = false;
    const name = state.players[eliminatedUid]?.name || 'A player';
    updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(`${name} was voted out by the town.`, 'death');
  }

  if (eliminatedUid) {
    const eliminatedDef = ROLE_DEFS[roles[eliminatedUid]];
    if (eliminatedDef && eliminatedDef.winsIfVotedOut) {
      const name = state.players[eliminatedUid]?.name || eliminatedDef.name;
      await finishGame(updates, roles[eliminatedUid], roles, `${name} wanted to be voted out \u2014 and got their wish!`);
      return;
    }
  }

  const projected = {};
  Object.entries(state.players).forEach(([pid, p]) => {
    projected[pid] = { ...p, alive: pid === eliminatedUid ? false : p.alive, role: roles[pid] };
  });
  const winner = checkWinCondition(projected);
  if (winner) { await finishGame(updates, winner, roles); return; }

  updates[`lobbies/${code}/phase`] = 'night';
  updates[`lobbies/${code}/round`] = round + 1;
  updates[`lobbies/${code}/phaseEndsAt`] = Date.now() + (state.settings.nightSeconds || 60) * 1000;
  updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(`Night falls once more.`, 'night');
  await update(ref(db), updates);
}

async function finishGame(updates, winner, roles, customLogText = null) {
  const code = lobbyCode;
  updates[`lobbies/${code}/phase`] = 'ended';
  updates[`lobbies/${code}/winner`] = winner;
  Object.entries(roles).forEach(([pid, role]) => { updates[`lobbies/${code}/publicReveal/${pid}`] = role; });
  const { sub } = winnerDisplay(winner);
  updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(customLogText || sub || 'The hunt is over.', 'win');
  await update(ref(db), updates);
}

// ========================================================= END SCREEN
function renderEndScreen() {
  showScreen('end');
  const winner = state.winner;
  const { label: winLabel, team } = winnerDisplay(winner);
  const labelEl = $('winner-label');
  labelEl.className = `winner-label team-${team}`;
  labelEl.textContent = winLabel;
  const lastWinEntry = Object.values(state.log || {}).filter(e => e.type === 'win').sort((a, b) => b.ts - a.ts)[0];
  $('winner-sub').textContent = lastWinEntry ? lastWinEntry.text : winnerDisplay(winner).sub;

  const reveal = state.publicReveal || {};
  $('end-role-list').innerHTML = Object.entries(state.players).map(([pid, p]) => {
    const def = ROLE_DEFS[reveal[pid]];
    return `<div class="player-chip${p.alive === false ? ' is-dead' : ''}${pid === uid ? ' is-me' : ''}">
      <div class="avatar">${(p.name || '?').slice(0, 1).toUpperCase()}</div>
      <div class="name">${escapeHTML(p.name)}</div>
      <span class="tag">${def ? def.icon + ' ' + def.name : '?'}</span>
    </div>`;
  }).join('');

  $('end-host-card').classList.toggle('hidden', !isHost);
}

$('play-again-btn').addEventListener('click', async () => {
  if (!isHost) return;
  const code = lobbyCode;
  const updates = {
    [`lobbies/${code}/phase`]: 'lobby',
    [`lobbies/${code}/round`]: 0,
    [`lobbies/${code}/phaseEndsAt`]: null,
    [`lobbies/${code}/winner`]: null,
    [`lobbies/${code}/secretRoles`]: null,
    [`lobbies/${code}/mafiaTeam`]: null,
    [`lobbies/${code}/nightActions`]: null,
    [`lobbies/${code}/votes`]: null,
    [`lobbies/${code}/log`]: null,
    [`lobbies/${code}/private`]: null,
    [`lobbies/${code}/publicReveal`]: null,
  };
  Object.keys(state.players).forEach(pid => {
    updates[`lobbies/${code}/players/${pid}/alive`] = true;
    updates[`lobbies/${code}/players/${pid}/revealed`] = false;
    updates[`lobbies/${code}/players/${pid}/revealedRoleName`] = null;
    updates[`lobbies/${code}/players/${pid}/revealedRoleIcon`] = null;
  });
  try {
    await update(ref(db), updates);
    state.mafiaTeam = null;
  } catch (e) { console.error(e); toast('Could not reset the game', true); }
});
