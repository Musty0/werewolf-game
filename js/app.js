// app.js — Werewolf party game
// Architecture: the host's browser resolves each phase and writes results
// back to Firebase. All other tabs react to the database state.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, get, update, push, onValue, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  ROLE_DEFS, optionalRoleKeys, werewolfTeamKeys, defaultSettings,
  validateSettings, assignRoles, tallyVotes, tiedPlayers,
  checkWinCondition, winnerDisplay
} from "./roles.js";

const app   = initializeApp(firebaseConfig);
const auth  = getAuth(app);
const db    = getDatabase(app);

if (!firebaseConfig.apiKey || String(firebaseConfig.apiKey).includes('REPLACE_ME')) {
  console.warn('firebase-config.js still has placeholder values.');
  const b = document.getElementById('config-warning');
  if (b) b.classList.remove('hidden');
}

// ── state ────────────────────────────────────────────────────────────
let uid = null, lobbyCode = null, isHost = false;
let countdownInterval = null, resolvingInProgress = false;
let pausedTimeRemaining = null; // seconds remaining when paused

// Client-side selections for multi-step actions (not persisted until submit)
let seerPicks = [];        // up to 4 UIDs
let usedAbility = false;   // has this player used their once-per-game ability this round?

const state = {
  hostId: null, phase: 'lobby', round: 0,
  phaseEndsAt: null, paused: false, winner: null,
  settings: defaultSettings(),
  players: {}, log: {}, votes: {}, revoteEligible: null,
  werewolfTeam: null, myRole: null, myPrivate: {},
  publicReveal: null, silencedThisRound: null,
  poisoned: null,      // {uid: roundPoisoned}
  piratePrepping: null // {uid: true}
};

// ── DOM helpers ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(name) {
  ['landing','waiting','game','end'].forEach(k =>
    $(`screen-${k}`).classList.toggle('hidden', k !== name)
  );
}

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3800);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── modals ───────────────────────────────────────────────────────────
function openModal(id)  { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('.modal-overlay').forEach(el =>
  el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); })
);

$('open-help-btn').addEventListener('click',    () => openModal('help-modal'));
$('help-modal-close').addEventListener('click', () => closeModal('help-modal'));

$('open-roles-btn').addEventListener('click',    () => openModal('roles-modal'));
$('roles-modal-close').addEventListener('click', () => closeModal('roles-modal'));

$('open-settings-btn').addEventListener('click',    () => openModal('settings-modal'));
$('settings-modal-close').addEventListener('click', () => closeModal('settings-modal'));

$('role-chip-btn').addEventListener('click',    () => openModal('role-modal'));
$('role-modal-close').addEventListener('click', () => closeModal('role-modal'));

$('open-log-btn').addEventListener('click', () => { openModal('log-modal'); markLogSeen(); });
$('log-modal-close').addEventListener('click',  () => closeModal('log-modal'));

$('open-roster-btn').addEventListener('click',    () => openModal('roster-modal'));
$('roster-modal-close').addEventListener('click', () => closeModal('roster-modal'));

// Roles reference popup — built once from ROLE_DEFS
$('roles-reference-list').innerHTML = Object.values(ROLE_DEFS).map(def => `
  <div class="roles-reference-item">
    <span class="rr-icon">${def.icon}</span>
    <div>
      <div class="rr-name">${escapeHTML(def.name)}</div>
      <p class="rr-blurb">${escapeHTML(def.blurb)}</p>
    </div>
  </div>`).join('');

// ── name memory ──────────────────────────────────────────────────────
const getSavedName = () => localStorage.getItem('werewolf_name') || '';
const saveName     = n  => localStorage.setItem('werewolf_name', n);
$('create-name-input').value = getSavedName();
$('join-name-input').value   = getSavedName();

// ── routing ──────────────────────────────────────────────────────────
function getBasePath() {
  const p = location.pathname, idx = p.indexOf('/lobby/');
  return idx !== -1 ? (p.slice(0, idx) || '') : p.replace(/\/index\.html$/, '').replace(/\/$/, '');
}
function getCodeFromURL() {
  const m = location.pathname.match(/\/lobby\/([A-Za-z0-9]+)/);
  return m ? m[1].toUpperCase() : null;
}
function lobbyURL(code) { return `${location.origin}${getBasePath()}/lobby/${code}`; }
function goToLobbyURL(code) { history.pushState(null, '', `${getBasePath()}/lobby/${code}`); }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// ── auth ─────────────────────────────────────────────────────────────
function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { uid = user.uid; unsub(); resolve(user); }
    }, reject);
    signInAnonymously(auth).catch(reject);
  });
}

function friendlyFirebaseError(e) {
  const code = String((e && e.code) || '').toLowerCase();
  const msg  = String((e && e.message) || '').toLowerCase();
  if (code.includes('api-key') || msg.includes('api key'))
    return 'Firebase rejected the API key — check js/firebase-config.js has your real values.';
  if (code.includes('operation-not-allowed'))
    return 'Anonymous sign-in is not enabled in Firebase — enable it under Authentication → Sign-in method.';
  if (code.includes('permission_denied') || msg.includes('permission_denied'))
    return 'Firebase rejected the request — check the Realtime Database rules are published (README step 4).';
  if (code.includes('network') || msg.includes('network'))
    return 'Could not reach Firebase — check your internet connection.';
  console.warn('Unrecognised Firebase error:', e);
  return 'Could not reach Firebase. Open the browser console (F12) for the exact error.';
}

// ── CREATE lobby ─────────────────────────────────────────────────────
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
    const snap = await get(ref(db, `lobbies/${code}/hostId`));
    if (snap.exists()) continue;
    await set(ref(db, `lobbies/${code}/hostId`), uid);
    await update(ref(db, `lobbies/${code}`), {
      createdAt: Date.now(), phase: 'lobby', round: 0,
      paused: false, settings: defaultSettings()
    });
    await set(ref(db, `lobbies/${code}/players/${uid}`), {
      name: hostName, alive: true, isHost: true,
      joinedAt: Date.now(), revealed: false, piratePrepping: false
    });
    return code;
  }
  throw new Error('Could not generate a unique lobby code — please try again.');
}

// ── JOIN lobby ───────────────────────────────────────────────────────
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
    const known = ['No lobby found with that code', 'That game has already started'];
    toast(known.includes(e.message) ? e.message : friendlyFirebaseError(e), true);
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
      name, alive: true, isHost: false,
      joinedAt: Date.now(), revealed: false, piratePrepping: false
    });
  }
}

$('copy-link-btn').addEventListener('click', async () => {
  const url = lobbyURL(lobbyCode);
  try {
    if (navigator.share) await navigator.share({ title: 'Join my Werewolf game', url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
  } catch { /* user cancelled */ }
});

// ── ENTER lobby ───────────────────────────────────────────────────────
function enterLobby(code) {
  lobbyCode = code;
  attachListeners(code);
}

function attachListeners(code) {
  const on = (path, fn) => onValue(ref(db, path), s => { fn(s.val()); render(); });
  on(`lobbies/${code}/hostId`,         v => { state.hostId = v; isHost = v === uid; });
  on(`lobbies/${code}/phase`,          v => { state.phase = v || 'lobby'; });
  on(`lobbies/${code}/round`,          v => { state.round = v || 0; });
  on(`lobbies/${code}/phaseEndsAt`,    v => { state.phaseEndsAt = v; });
  on(`lobbies/${code}/paused`,         v => { state.paused = !!v; });
  on(`lobbies/${code}/winner`,         v => { state.winner = v; });
  on(`lobbies/${code}/settings`,       v => { state.settings = v || defaultSettings(); });
  on(`lobbies/${code}/players`,        v => { state.players = v || {}; });
  on(`lobbies/${code}/log`,            v => { state.log = v || {}; });
  on(`lobbies/${code}/votes`,          v => { state.votes = v || {}; });
  on(`lobbies/${code}/revoteEligible`, v => { state.revoteEligible = v; });
  on(`lobbies/${code}/publicReveal`,   v => { state.publicReveal = v; });
  on(`lobbies/${code}/poisoned`,       v => { state.poisoned = v; });
  on(`lobbies/${code}/piratePrepping`, v => { state.piratePrepping = v; });
  on(`lobbies/${code}/silenced`,       v => { state.silencedThisRound = v; });
  on(`lobbies/${code}/private/${uid}`, v => { state.myPrivate = v || {}; });
  on(`lobbies/${code}/secretRoles/${uid}`, v => {
    state.myRole = v || null;
    if (v && werewolfTeamKeys().includes(v) && !state.werewolfTeam) {
      get(ref(db, `lobbies/${code}/werewolfTeam`))
        .then(s => { state.werewolfTeam = s.val() || {}; render(); });
    }
  });
}

function render() {
  if (!lobbyCode || !state.hostId) return;
  const phase = state.phase;
  if (phase === 'lobby')   renderWaitingRoom();
  else if (phase === 'ended') renderEndScreen();
  else renderGameScreen(); // night | day | revote
}

// ── INIT/LOAD ────────────────────────────────────────────────────────
async function init() {
  const code = getCodeFromURL();
  if (!code) { showScreen('landing'); return; }
  try {
    await ensureAuth();
    const snap = await get(ref(db, `lobbies/${code}/hostId`));
    if (!snap.exists()) {
      toast('That lobby no longer exists', true);
      history.replaceState(null, '', getBasePath() + '/');
      showScreen('landing');
      return;
    }
    const me = await get(ref(db, `lobbies/${code}/players/${uid}`));
    if (me.exists()) {
      enterLobby(code);
    } else {
      $('join-code-input').value = code;
      $('join-name-input').focus({ preventScroll: false });
      showScreen('landing');
    }
  } catch (e) {
    console.error(e);
    showScreen('landing');
  }
}
init();

// ── SETTINGS toggles ─────────────────────────────────────────────────
const OPTIONAL_ROLE_KEYS = optionalRoleKeys();

function clampSeconds(v, min, max) {
  const n = parseInt(v, 10);
  return isNaN(n) ? min : Math.min(max, Math.max(min, n));
}
function updateSetting(key, value) {
  if (!isHost || !lobbyCode) return;
  update(ref(db, `lobbies/${lobbyCode}/settings`), { [key]: value });
}
function updateOptionalRole(roleKey, value) {
  if (!isHost || !lobbyCode) return;
  update(ref(db, `lobbies/${lobbyCode}/settings/optionalRoles`), { [roleKey]: value });
}

$('wolf-minus').addEventListener('click', () =>
  updateSetting('werewolfCount', Math.max(1, (state.settings.werewolfCount || 1) - 1)));
$('wolf-plus').addEventListener('click', () =>
  updateSetting('werewolfCount', (state.settings.werewolfCount || 1) + 1));
$('night-seconds-input').addEventListener('change', e =>
  updateSetting('nightSeconds', clampSeconds(e.target.value, 15, 600)));
$('day-seconds-input').addEventListener('change', e =>
  updateSetting('daySeconds', clampSeconds(e.target.value, 15, 900)));

// Build toggle rows dynamically from ROLE_DEFS
$('optional-roles-rows').innerHTML = OPTIONAL_ROLE_KEYS.map(key => {
  const def = ROLE_DEFS[key];
  return `<div class="toggle-row">
    <span class="role-mini">${def.icon} ${escapeHTML(def.name)}</span>
    <label class="switch">
      <input type="checkbox" id="toggle-role-${key}">
      <span class="track"></span>
    </label>
  </div>`;
}).join('');

OPTIONAL_ROLE_KEYS.forEach(key => {
  $(`toggle-role-${key}`).addEventListener('change', e =>
    updateOptionalRole(key, e.target.checked));
});

// ── WAITING ROOM render ───────────────────────────────────────────────
function playerChipHTML(pid, p, showRole = false) {
  const initial   = (p.name || '?').slice(0, 1).toUpperCase();
  const meClass   = pid === uid ? ' is-me' : '';
  const deadClass = p.alive === false ? ' is-dead' : '';
  let tag = '';
  if (p.isHost) tag = '<span class="tag">Host</span>';
  else if (p.revealed && p.revealedRoleName) tag = `<span class="tag">${escapeHTML(p.revealedRoleName)}</span>`;
  // Spectators and end-screen see everyone's role
  if (showRole && state.publicReveal && state.publicReveal[pid]) {
    const def = ROLE_DEFS[state.publicReveal[pid]];
    if (def) tag = `<span class="tag">${def.icon} ${escapeHTML(def.name)}</span>`;
  }
  return `<div class="player-chip${meClass}${deadClass}">
    <div class="avatar">${initial}</div>
    <div class="name">${escapeHTML(p.name || 'Player')}</div>
    ${tag}
  </div>`;
}

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
    $('wolf-count-value').textContent = s.werewolfCount;
    OPTIONAL_ROLE_KEYS.forEach(key => {
      const el = $(`toggle-role-${key}`);
      if (el) el.checked = !!(s.optionalRoles && s.optionalRoles[key]);
    });
    $('night-seconds-input').value = s.nightSeconds;
    $('day-seconds-input').value   = s.daySeconds;

    const check = validateSettings(s, list.length);
    $('start-game-btn').disabled     = !check.ok;
    $('start-game-hint').textContent = check.ok
      ? `${list.length} players ready to go.`
      : check.error;
  }
}

// ── START GAME ────────────────────────────────────────────────────────
$('start-game-btn').addEventListener('click', async () => {
  if (!isHost) return;
  const playerIds = Object.keys(state.players);
  const settings  = state.settings;
  const check     = validateSettings(settings, playerIds.length);
  if (!check.ok) return toast(check.error, true);

  const { roleByUid, werewolfUids } = assignRoles(playerIds, settings);

  const updates = {};
  playerIds.forEach(pid => {
    updates[`lobbies/${lobbyCode}/secretRoles/${pid}`] = roleByUid[pid];
  });

  const werewolfTeamObj = {};
  werewolfUids.forEach(pid => { werewolfTeamObj[pid] = true; });
  updates[`lobbies/${lobbyCode}/werewolfTeam`]  = werewolfTeamObj;
  updates[`lobbies/${lobbyCode}/phase`]         = 'night';
  updates[`lobbies/${lobbyCode}/round`]         = 1;
  updates[`lobbies/${lobbyCode}/paused`]        = false;
  updates[`lobbies/${lobbyCode}/phaseEndsAt`]   = Date.now() + (settings.nightSeconds || 60) * 1000;
  updates[`lobbies/${lobbyCode}/winner`]        = null;
  updates[`lobbies/${lobbyCode}/poisoned`]      = null;
  updates[`lobbies/${lobbyCode}/piratePrepping`] = null;
  updates[`lobbies/${lobbyCode}/silenced`]      = null;
  updates[`lobbies/${lobbyCode}/log/${newLogKey()}`] = logEntry(
    `The first night falls. ${werewolfUids.length} Werewolf${werewolfUids.length !== 1 ? 'ves are' : ' is'} hiding among ${playerIds.length} players.`,
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

// ── TIMER ─────────────────────────────────────────────────────────────
function formatTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startCountdown(endsAt, totalSeconds) {
  clearInterval(countdownInterval);
  if (state.paused) {
    $('clock-time').textContent = formatTime(Math.round(pausedTimeRemaining || 0));
    return;
  }
  if (!endsAt) { $('clock-time').textContent = formatTime(totalSeconds); return; }

  function tick() {
    if (state.paused) { clearInterval(countdownInterval); return; }
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

// Pause/resume
$('pause-btn').addEventListener('click', async () => {
  if (!isHost || !lobbyCode || state.paused) return;
  const secLeft = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));
  pausedTimeRemaining = secLeft;
  await update(ref(db, `lobbies/${lobbyCode}`), { paused: true, pausedSecsLeft: secLeft });
});

$('resume-btn').addEventListener('click', async () => {
  if (!isHost || !lobbyCode || !state.paused) return;
  const snap = await get(ref(db, `lobbies/${lobbyCode}/pausedSecsLeft`));
  const secsLeft = snap.val() || 30;
  const newEndsAt = Date.now() + secsLeft * 1000;
  await update(ref(db, `lobbies/${lobbyCode}`), {
    paused: false, phaseEndsAt: newEndsAt, pausedSecsLeft: null
  });
});

async function autoResolve() {
  if (resolvingInProgress) return;
  resolvingInProgress = true;
  try {
    const phase = state.phase;
    if (phase === 'night')  await resolveNight();
    else if (phase === 'day')    await resolveDay(false);
    else if (phase === 'revote') await resolveDay(true);
  } catch (e) {
    console.error(e);
  } finally {
    resolvingInProgress = false;
  }
}
$('resolve-now-btn').addEventListener('click', () => { if (isHost) autoResolve(); });

// ── ROLE CARD ─────────────────────────────────────────────────────────
function renderRoleCard() {
  const role = state.myRole || 'villager';
  const def  = ROLE_DEFS[role] || ROLE_DEFS.villager;
  $('role-icon').textContent      = def.icon;
  $('role-chip-icon').textContent = def.icon;
  $('role-chip-name').textContent = def.name;
  $('role-name').textContent      = def.name;

  const teamEl = $('role-team');
  teamEl.textContent = { town: 'Town', werewolf: 'Werewolf', neutral: 'Neutral' }[def.team] || 'Neutral';
  teamEl.className   = `role-team team-${def.team}`;

  let blurb = def.blurb;

  // Werewolf team: show teammates
  const wolfList = $('werewolf-team-list');
  if (werewolfTeamKeys().includes(role) && state.werewolfTeam) {
    const teammates = Object.keys(state.werewolfTeam)
      .filter(pid => pid !== uid)
      .map(pid => {
        const pRole = state.myRole === 'mageWerewolf' || pid !== uid
          ? (state.players[pid]?.name || '?') : null;
        return pRole;
      }).filter(Boolean);
    wolfList.classList.toggle('hidden', !teammates.length);
    wolfList.innerHTML = teammates.length
      ? `Your pack: <strong>${teammates.map(escapeHTML).join(', ')}</strong>`
      : '';
  } else {
    wolfList.classList.add('hidden');
  }

  // Append last known private result to blurb
  if (state.myPrivate) {
    const priv = state.myPrivate;
    // Seer
    if (priv.seerResults) {
      const rounds = Object.keys(priv.seerResults).map(Number).sort((a,b)=>b-a);
      if (rounds.length) {
        const r = priv.seerResults[rounds[0]];
        blurb += ` Round ${rounds[0]} inspection: ${r.evilCount} of your 4 chosen players ${r.evilCount === 1 ? 'is' : 'are'} evil.`;
      }
    }
    // Tracker
    if (priv.trackerResults) {
      const rounds = Object.keys(priv.trackerResults).map(Number).sort((a,b)=>b-a);
      if (rounds.length) {
        const r = priv.trackerResults[rounds[0]];
        blurb += ` Round ${rounds[0]} tracking: ${escapeHTML(r.name)} ${r.visited ? 'visited someone that night' : 'stayed home that night'}.`;
      }
    }
    // Sheriff
    if (priv.sheriffResults) {
      const rounds = Object.keys(priv.sheriffResults).map(Number).sort((a,b)=>b-a);
      if (rounds.length) {
        const r = priv.sheriffResults[rounds[0]];
        if (r.hit) blurb += ` Round ${rounds[0]}: you shot ${escapeHTML(r.name)} — they were a Werewolf.`;
        else blurb += ` Round ${rounds[0]}: you shot ${escapeHTML(r.name)} — they were not a Werewolf. The shot backfired.`;
      }
    }
    // Amnesiac
    if (priv.adoptedRole) {
      const adoptedDef = ROLE_DEFS[priv.adoptedRole];
      if (adoptedDef) blurb += ` You adopted the role of ${adoptedDef.name}.`;
    }
  }

  $('role-blurb').textContent = blurb;
}

// ── NIGHT ACTION UI ───────────────────────────────────────────────────
function renderNightAction() {
  const role = state.myRole;
  const def  = ROLE_DEFS[role];
  const me   = state.players[uid];
  const alive = me && me.alive !== false;

  $('night-action-card').classList.add('hidden');
  $('seer-confirm-btn').classList.add('hidden');

  if (!def || !def.night || !alive) return;

  // Has this player already used their once-per-game ability?
  const submitted = state.myPrivate && state.myPrivate[`submitted_r${state.round}`];
  if (submitted && def.usesPerGame === 1) {
    // Already used — show nothing
    return;
  }

  // Is this player silenced this round?
  const silenced = state.silencedThisRound && state.silencedThisRound[uid];
  if (silenced) {
    $('night-action-card').classList.remove('hidden');
    $('night-action-label').textContent = 'Your ability has been silenced this night.';
    $('night-action-targets').innerHTML = '';
    $('night-action-status').textContent = '';
    return;
  }

  // Amnesiac: only show if at least one player has died
  if (role === 'amnesiac') {
    const deadPlayers = Object.entries(state.players).filter(([, p]) => p.alive === false);
    if (!deadPlayers.length) {
      $('night-action-card').classList.remove('hidden');
      $('night-action-label').textContent = 'Amnesiac — no one has died yet';
      $('night-action-targets').innerHTML = '<p style="color:var(--ink-soft);font-size:0.9rem;">You can only adopt a role once at least one player has died.</p>';
      $('night-action-status').textContent = '';
      return;
    }
  }

  // Seer: cannot use with ≤3 players alive
  if (role === 'seer') {
    const aliveCount = Object.values(state.players).filter(p => p.alive !== false).length;
    if (aliveCount <= 3) {
      $('night-action-card').classList.remove('hidden');
      $('night-action-label').textContent = 'Seer — cannot use with 3 or fewer players alive';
      $('night-action-targets').innerHTML = '';
      $('night-action-status').textContent = '';
      return;
    }
  }

  $('night-action-card').classList.remove('hidden');
  $('night-action-label').textContent = def.night.prompt || 'Choose your target';

  // Build target list
  let candidates;
  if (role === 'amnesiac') {
    // Dead players only, not knowing their roles
    candidates = Object.entries(state.players).filter(([, p]) => p.alive === false);
  } else if (role === 'werewolf' || role === 'mageWerewolf') {
    // Werewolves cannot target their own team for kills; Mage can target anyone
    candidates = Object.entries(state.players).filter(([pid, p]) => {
      if (p.alive === false) return false;
      if (role === 'werewolf' && state.werewolfTeam && state.werewolfTeam[pid]) return false;
      if (!def.night.allowSelf && pid === uid) return false;
      return true;
    });
  } else {
    candidates = Object.entries(state.players).filter(([pid, p]) => {
      if (p.alive === false) return false;
      if (!def.night.allowSelf && pid === uid) return false;
      return true;
    });
  }

  if (role === 'seer') {
    // Multi-select: up to 4
    $('night-action-targets').innerHTML = candidates.map(([pid, p]) => {
      const selected = seerPicks.includes(pid);
      return `<button class="vote-target${selected ? ' selected' : ''}" data-pid="${pid}" type="button">
        ${escapeHTML(p.name)}
      </button>`;
    }).join('');

    $('night-action-targets').querySelectorAll('.vote-target').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        if (seerPicks.includes(pid)) {
          seerPicks = seerPicks.filter(p => p !== pid);
        } else if (seerPicks.length < 4) {
          seerPicks.push(pid);
        }
        renderNightAction();
      });
    });

    $('night-action-status').textContent = `Selected: ${seerPicks.length} / 4`;
    if (seerPicks.length === 4) {
      $('seer-confirm-btn').classList.remove('hidden');
    }
  } else if (role === 'veteran') {
    // Single button, no target needed
    $('night-action-targets').innerHTML = `
      <button class="vote-target" id="veteran-alert-btn" type="button">
        🪖 Go on Alert — anyone who visits you tonight dies
      </button>`;
    $('veteran-alert-btn').addEventListener('click', () => submitNightAction(role, uid));
    $('night-action-status').textContent = 'Warning: this includes the Doctor and Tracker.';
  } else {
    // Standard single-target
    $('night-action-targets').innerHTML = candidates.map(([pid, p]) => {
      const submitted_target = state.myPrivate && state.myPrivate[`target_r${state.round}`];
      const selected = submitted_target === pid;
      return `<button class="vote-target${selected ? ' selected' : ''}" data-pid="${pid}" type="button">
        ${escapeHTML(p.name)}
      </button>`;
    }).join('');

    $('night-action-targets').querySelectorAll('.vote-target').forEach(btn => {
      btn.addEventListener('click', () => submitNightAction(role, btn.dataset.pid));
    });

    const alreadySubmitted = state.myPrivate && state.myPrivate[`target_r${state.round}`];
    $('night-action-status').textContent = alreadySubmitted
      ? 'Locked in — you can change until night ends.'
      : 'Pick a target above.';
  }
}

// Seer confirm button
$('seer-confirm-btn').addEventListener('click', () => {
  if (seerPicks.length !== 4) return;
  submitSeerPicks();
});

async function submitSeerPicks() {
  const round = state.round;
  try {
    const picksObj = {};
    seerPicks.forEach(pid => { picksObj[pid] = true; });
    await set(ref(db, `lobbies/${lobbyCode}/nightActions/${round}/inspect4/${uid}`), picksObj);
    // Record locally that we've submitted
    await update(ref(db, `lobbies/${lobbyCode}/private/${uid}`), {
      [`submitted_r${round}`]: true
    });
    $('night-action-status').textContent = 'Selection confirmed — waiting for night to end.';
    $('seer-confirm-btn').classList.add('hidden');
  } catch (e) { console.error(e); toast('Could not submit — try again', true); }
}

async function submitNightAction(role, targetPid) {
  const round = state.round;
  try {
    await set(ref(db, `lobbies/${lobbyCode}/nightActions/${round}/${role}/${uid}`), targetPid);
    await update(ref(db, `lobbies/${lobbyCode}/private/${uid}`), {
      [`target_r${round}`]: targetPid,
      [`submitted_r${round}`]: true
    });
    renderNightAction();
  } catch (e) { console.error(e); toast('Could not submit — try again', true); }
}

// ── DAY VOTE UI ───────────────────────────────────────────────────────
function tallyMarksHTML(count) {
  if (count <= 0) return '';
  const groups = [];
  let rem = count;
  while (rem > 0) { groups.push(Math.min(5, rem)); rem -= 5; }
  return `<span class="tally" aria-label="${count} vote${count === 1 ? '' : 's'}">${
    groups.map(n => `<span class="tally-group">${
      Array.from({length: Math.min(n,4)}).map(() => '<span class="tally-stroke"></span>').join('')
    }${n === 5 ? '<span class="tally-slash"></span>' : ''}</span>`).join('')
  }</span>`;
}

function renderDayVote(isRevote = false) {
  const me = state.players[uid];
  if (!me || me.alive === false) { $('day-vote-card').classList.add('hidden'); return; }

  // Pirate in prep mode cannot vote
  if (state.piratePrepping && state.piratePrepping[uid]) {
    $('day-vote-card').classList.add('hidden');
    return;
  }

  $('day-vote-card').classList.remove('hidden');
  $('day-vote-label').textContent = isRevote ? 'Revote — tied players only' : 'Cast your vote';

  const revoteNote = $('revote-note');
  if (isRevote && state.revoteEligible) {
    const names = Object.keys(state.revoteEligible)
      .map(pid => state.players[pid]?.name).filter(Boolean).map(escapeHTML).join(', ');
    revoteNote.textContent = `Tied players: ${names}. Only they can be voted for.`;
    revoteNote.classList.remove('hidden');
  } else {
    revoteNote.classList.add('hidden');
  }

  const round = state.round;
  const roundVotes = state.votes[round] || {};
  const myVote = roundVotes[uid] || null;
  const tally = {};
  Object.values(roundVotes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });

  // In revote, only eligible (tied) players can be targeted
  let candidates = Object.entries(state.players).filter(([pid, p]) => {
    if (p.alive === false) return false;
    if (pid === uid) return false;
    if (isRevote && state.revoteEligible && !state.revoteEligible[pid]) return false;
    return true;
  });

  $('day-vote-targets').innerHTML = candidates.map(([pid, p]) => {
    const selected = myVote === pid;
    const count    = tally[pid] || 0;
    return `<button class="vote-target${selected ? ' selected' : ''}" data-pid="${pid}" type="button">
      <span>${escapeHTML(p.name)}</span>
      <span class="count">${tallyMarksHTML(count)}</span>
    </button>`;
  }).join('');

  $('day-vote-targets').querySelectorAll('.vote-target').forEach(btn => {
    btn.addEventListener('click', () => castVote(btn.dataset.pid));
  });
}

async function castVote(targetPid) {
  try {
    await set(ref(db, `lobbies/${lobbyCode}/votes/${state.round}/${uid}`), targetPid);
  } catch (e) { console.error(e); toast('Could not cast vote', true); }
}

// ── PIRATE PREP ───────────────────────────────────────────────────────
$('pirate-prep-btn').addEventListener('click', async () => {
  if (state.myRole !== 'pirate') return;
  try {
    await update(ref(db, `lobbies/${lobbyCode}`), {
      [`piratePrepping/${uid}`]: true
    });
    await update(ref(db, `lobbies/${lobbyCode}/log`), {
      [newLogKey()]: logEntry(`${state.players[uid]?.name || 'A player'} has gone silent and is preparing something…`, 'info')
    });
  } catch (e) { console.error(e); toast('Could not prepare', true); }
});

// ── ROLE REVEAL ON DEATH ─────────────────────────────────────────────
$('reveal-yes-btn').addEventListener('click', async () => {
  const def = ROLE_DEFS[state.myRole];
  if (!def) return;
  try {
    await update(ref(db, `lobbies/${lobbyCode}/players/${uid}`), {
      revealed: true,
      revealedRoleName: def.name,
      revealedRoleIcon: def.icon
    });
    await update(ref(db, `lobbies/${lobbyCode}/log`), {
      [newLogKey()]: logEntry(`${state.players[uid]?.name || 'A player'} reveals they were the ${def.name} ${def.icon}.`, 'info')
    });
    $('reveal-choice-card').classList.add('hidden');
  } catch (e) { console.error(e); toast('Could not reveal', true); }
});

$('reveal-no-btn').addEventListener('click', async () => {
  try {
    // Mark that they've made their choice so we don't keep showing the prompt
    await update(ref(db, `lobbies/${lobbyCode}/private/${uid}`), { revealChoiceMade: true });
    $('reveal-choice-card').classList.add('hidden');
  } catch (e) { console.error(e); }
});

// ── LOG & ROSTER ──────────────────────────────────────────────────────
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

function renderRoster() {
  const entries = Object.entries(state.players);
  $('alive-count').textContent = entries.filter(([, p]) => p.alive !== false).length;
  const amSpectator = state.players[uid] && state.players[uid].alive === false;
  $('game-player-list').innerHTML = entries.map(([pid, p]) =>
    playerChipHTML(pid, p, amSpectator)
  ).join('');
}

// ── GAME SCREEN render ────────────────────────────────────────────────
function renderGameScreen() {
  showScreen('game');
  const phase    = state.phase;
  const settings = state.settings;
  const me       = state.players[uid];
  const myAlive  = me && me.alive !== false;
  const isRevote = phase === 'revote';

  // Clock
  const clock = $('town-clock');
  clock.classList.toggle('is-night', phase === 'night');
  clock.classList.toggle('is-day',   phase === 'day' || isRevote);
  $('clock-phase').textContent = phase === 'night' ? 'Night' : isRevote ? 'Revote' : 'Day';
  $('clock-round').textContent = `Round ${state.round}`;

  if (state.paused) {
    clearInterval(countdownInterval);
    $('clock-time').textContent = pausedTimeRemaining != null
      ? formatTime(Math.round(pausedTimeRemaining))
      : $('clock-time').textContent;
  } else {
    startCountdown(
      state.phaseEndsAt,
      phase === 'night' ? (settings.nightSeconds || 60) : (settings.daySeconds || 120)
    );
  }

  renderRoleCard();

  // Host pause/resume
  $('pause-btn').classList.toggle('hidden',  !isHost || state.paused);
  $('resume-btn').classList.toggle('hidden', !isHost || !state.paused);

  // Spectator badge
  $('spectator-badge').classList.toggle('hidden', myAlive);

  // Hide all action panels, then show what's appropriate
  $('night-action-card').classList.add('hidden');
  $('day-vote-card').classList.add('hidden');
  $('pirate-prep-card').classList.add('hidden');
  $('reveal-choice-card').classList.add('hidden');
  $('no-action-note').classList.add('hidden');

  if (!myAlive) {
    // Dead: offer role reveal if not yet done
    const revealDone = state.myPrivate && (state.myPrivate.revealChoiceMade || (me && me.revealed));
    if (!revealDone && state.myRole) {
      $('reveal-choice-card').classList.remove('hidden');
    } else {
      $('no-action-note').textContent = 'You are a spectator. Watch how the hunt unfolds.';
      $('no-action-note').classList.remove('hidden');
    }
  } else if (phase === 'night') {
    renderNightAction();
    // If no night action shown
    if ($('night-action-card').classList.contains('hidden')) {
      $('no-action-note').textContent = 'The town sleeps. Wait for sunrise…';
      $('no-action-note').classList.remove('hidden');
    }
  } else if (phase === 'day' || isRevote) {
    // Pirate prep button (only if not already prepping and haven't used duel)
    if (state.myRole === 'pirate' &&
        !(state.piratePrepping && state.piratePrepping[uid]) &&
        !(state.myPrivate && state.myPrivate.pirateUsed)) {
      $('pirate-prep-card').classList.remove('hidden');
    }
    renderDayVote(isRevote);
  }

  $('host-controls-card').classList.toggle('hidden', !isHost);
  renderLog();
  renderRoster();
}

// ── NIGHT RESOLUTION ─────────────────────────────────────────────────
async function resolveNight() {
  const round = state.round;
  const code  = lobbyCode;

  const [actionsSnap, rolesSnap, poisonedSnap] = await Promise.all([
    get(ref(db, `lobbies/${code}/nightActions/${round}`)),
    get(ref(db, `lobbies/${code}/secretRoles`)),
    get(ref(db, `lobbies/${code}/poisoned`))
  ]);

  const actions  = actionsSnap.val()  || {};
  const roles    = rolesSnap.val()    || {};
  const poisoned = poisonedSnap.val() || {}; // {uid: roundPoisoned}

  const playersNow = { ...state.players };

  // Helper: is a player alive in playersNow?
  const isAlive = pid => playersNow[pid] && playersNow[pid].alive !== false;

  const updates      = {};
  const deathLog     = [];
  const deaths       = new Set(); // UIDs dying this night
  const infoMsgs     = [];

  // 1. Silence (Mage Werewolf)
  const silenceActions = actions.mageWerewolf || {};
  const { targetUid: silenceTarget } = tallyVotes(silenceActions);
  const silencedUid = silenceTarget || null;
  if (silencedUid) {
    updates[`lobbies/${code}/silenced`] = { [silencedUid]: true };
    infoMsgs.push(`The Mage's silence fell somewhere in the night…`);
  } else {
    updates[`lobbies/${code}/silenced`] = null;
  }

  const isSilenced = uid_ => silencedUid === uid_;

  // 2. Doctor protection
  const doctorActions = actions.doctor || {};
  const doctorUid = Object.keys(doctorActions)[0];
  const doctorTarget = doctorUid && !isSilenced(doctorUid) ? doctorActions[doctorUid] : null;

  // 3. Veteran alert
  const veteranActions = actions.veteran || {};
  const veteranUid = Object.keys(veteranActions)[0];
  const veteranAlerted = veteranUid && !isSilenced(veteranUid) && isAlive(veteranUid);

  // 4. Collect all players who performed a night action (for Tracker + Veteran)
  const visitedByUid = {}; // uid → targetUid they visited
  Object.entries(actions).forEach(([roleKey, roleActions]) => {
    if (!roleActions || typeof roleActions !== 'object') return;
    Object.entries(roleActions).forEach(([actorUid, targetUid]) => {
      // Veteran's own alert targets themselves — skip for "visited" purposes
      if (roleKey === 'veteran') return;
      visitedByUid[actorUid] = targetUid;
    });
  });
  // Seer picks — count as visiting
  const seerActions = actions.inspect4 || {};
  Object.keys(seerActions).forEach(seerUid => { visitedByUid[seerUid] = '__seer__'; });

  // 5. Veteran kills visitors
  if (veteranAlerted) {
    Object.entries(visitedByUid).forEach(([actorUid, targetUid]) => {
      // Did this actor visit the Veteran?
      const visitedVet = targetUid === veteranUid || actorUid === doctorUid && doctorTarget === veteranUid;
      if (targetUid === veteranUid || (actorUid === doctorUid && doctorTarget === veteranUid)) {
        if (isAlive(actorUid)) {
          // Doctor can protect a visitor to the Veteran
          if (doctorTarget === actorUid && actorUid !== doctorUid) {
            infoMsgs.push(`Someone who visited the Veteran was protected by the Doctor.`);
          } else {
            deaths.add(actorUid);
            deathLog.push(`${playersNow[actorUid]?.name || 'A player'} visited the Veteran on Alert and did not survive.`);
          }
        }
      }
    });
  }

  // 6. Werewolf kill
  const killActions = actions.werewolf || {};
  const { targetUid: wolfTarget } = tallyVotes(killActions);
  // Werewolf team silenced = kill fails
  const allWolvesInTeam = Object.keys(state.werewolfTeam || {});
  const allWolvesSilenced = allWolvesInTeam.length > 0 &&
    allWolvesInTeam.every(wuid => isSilenced(wuid));
  if (wolfTarget && !allWolvesSilenced && isAlive(wolfTarget)) {
    if (doctorTarget === wolfTarget) {
      infoMsgs.push('The Werewolves attacked someone, but the Doctor protected them.');
    } else if (!deaths.has(wolfTarget)) {
      deaths.add(wolfTarget);
      deathLog.push(`${playersNow[wolfTarget]?.name || 'A player'} was found dead this morning.`);
    }
  } else if (wolfTarget && !allWolvesSilenced) {
    // Target already dead (from Veteran etc)
    infoMsgs.push('The Werewolves attacked someone who had already fallen.');
  }

  // 7. Sheriff shoot
  const shootActions = actions.sheriff || {};
  const sheriffUid   = Object.keys(shootActions)[0];
  const shootTarget  = sheriffUid && !isSilenced(sheriffUid) ? shootActions[sheriffUid] : null;
  if (shootTarget && isAlive(sheriffUid)) {
    const targetRole    = roles[shootTarget];
    const targetIsWolf  = werewolfTeamKeys().includes(targetRole);
    if (targetIsWolf) {
      // Hit — target dies (Doctor can save the target)
      if (doctorTarget === shootTarget) {
        infoMsgs.push('The Sheriff fired — but the Doctor protected the target.');
        updates[`lobbies/${code}/private/${sheriffUid}/sheriffResults/${round}`] =
          { name: playersNow[shootTarget]?.name, hit: true, saved: true };
      } else if (isAlive(shootTarget) && !deaths.has(shootTarget)) {
        deaths.add(shootTarget);
        deathLog.push(`The Sheriff's shot found its mark — ${playersNow[shootTarget]?.name || 'a player'} was a Werewolf.`);
        updates[`lobbies/${code}/private/${sheriffUid}/sheriffResults/${round}`] =
          { name: playersNow[shootTarget]?.name, hit: true };
      }
    } else {
      // Backfire — Sheriff dies (cannot be saved by Doctor)
      if (isAlive(sheriffUid) && !deaths.has(sheriffUid)) {
        deaths.add(sheriffUid);
        deathLog.push(`The Sheriff's shot backfired — they were not a Werewolf. The Sheriff did not survive.`);
        updates[`lobbies/${code}/private/${sheriffUid}/sheriffResults/${round}`] =
          { name: playersNow[shootTarget]?.name, hit: false };
      }
    }
    // Mark Sheriff's ability as used
    updates[`lobbies/${code}/private/${sheriffUid}/submitted_r${round}`] = true;
  }

  // 8. Pirate duel
  const duelActions = actions.pirate || {};
  const pirateUid   = Object.keys(duelActions)[0];
  const duelTarget  = pirateUid && !isSilenced(pirateUid) ? duelActions[pirateUid] : null;
  if (duelTarget && isAlive(pirateUid)) {
    // If Pirate visited the Veteran on Alert, Pirate dies instead of a duel
    if (veteranAlerted && duelTarget === veteranUid) {
      // Already handled above — Pirate dies visiting Veteran
    } else if (isAlive(duelTarget)) {
      // Check if target is Veteran on alert
      if (veteranAlerted && duelTarget === veteranUid) {
        // Pirate dies — handled in Veteran section
      } else {
        const pirateWins = Math.random() < 0.5;
        const loser = pirateWins ? duelTarget : pirateUid;
        const winner = pirateWins ? pirateUid : duelTarget;
        const loserName = playersNow[loser]?.name || 'A player';
        if (doctorTarget === loser && loser !== pirateUid) {
          infoMsgs.push(`The Pirate's duel target was protected by the Doctor.`);
        } else if (!deaths.has(loser) && isAlive(loser)) {
          deaths.add(loser);
          deathLog.push(`The Pirate's coin came up — ${loserName} lost the duel and did not survive.`);
        }
        updates[`lobbies/${code}/players/${pirateUid}/piratePrepping`] = false;
        updates[`lobbies/${code}/piratePrepping/${pirateUid}`] = null;
        updates[`lobbies/${code}/private/${pirateUid}/pirateUsed`] = true;
      }
    } else {
      // Target already dead — duel cancelled
      infoMsgs.push(`The Pirate's duel target had already fallen — the duel was cancelled.`);
      updates[`lobbies/${code}/players/${pirateUid}/piratePrepping`] = false;
      updates[`lobbies/${code}/piratePrepping/${pirateUid}`] = null;
    }
  }

  // 9. Poison from PREVIOUS round
  Object.entries(poisoned).forEach(([victimUid, roundPoisoned]) => {
    if (roundPoisoned !== round - 1) return; // only last round's poison
    if (!isAlive(victimUid)) return;
    if (doctorTarget === victimUid) {
      infoMsgs.push('The Doctor cured someone of the Poisoner\'s poison.');
      updates[`lobbies/${code}/poisoned/${victimUid}`] = null;
    } else if (!deaths.has(victimUid)) {
      deaths.add(victimUid);
      deathLog.push(`${playersNow[victimUid]?.name || 'A player'} succumbed to poison in the night.`);
      updates[`lobbies/${code}/poisoned/${victimUid}`] = null;
    }
  });

  // 10. New poison application
  const poisonActions = actions.poison || {};
  const poisonerUid   = Object.keys(poisonActions)[0];
  const poisonTarget  = poisonerUid && !isSilenced(poisonerUid) ? poisonActions[poisonerUid] : null;
  if (poisonTarget && isAlive(poisonTarget) && !deaths.has(poisonTarget)) {
    updates[`lobbies/${code}/poisoned/${poisonTarget}`] = round;
  }

  // 11. Amnesiac adoption
  const adoptActions = actions.amnesiac || {};
  const amnUid       = Object.keys(adoptActions)[0];
  const adoptTarget  = amnUid && !isSilenced(amnUid) ? adoptActions[amnUid] : null;
  if (adoptTarget && isAlive(amnUid)) {
    const deadRole = roles[adoptTarget];
    const canAdopt = deadRole && !['poisoner', 'jester', 'pirate', 'amnesiac'].includes(deadRole);
    if (canAdopt) {
      updates[`lobbies/${code}/secretRoles/${amnUid}`] = deadRole;
      updates[`lobbies/${code}/private/${amnUid}/adoptedRole`] = deadRole;
      // If adopted role is werewolf team, add to werewolf team
      if (werewolfTeamKeys().includes(deadRole)) {
        updates[`lobbies/${code}/werewolfTeam/${amnUid}`] = true;
      }
      infoMsgs.push('The Amnesiac remembered something in the dark…');
    }
  }

  // 12. Tracker results
  const trackActions = actions.tracker || {};
  Object.entries(trackActions).forEach(([trackerUid, trackedUid]) => {
    if (isSilenced(trackerUid)) return;
    if (!isAlive(trackerUid)) return;
    const visited = !!visitedByUid[trackedUid];
    updates[`lobbies/${code}/private/${trackerUid}/trackerResults/${round}`] = {
      name: playersNow[trackedUid]?.name || '?', visited
    };
    updates[`lobbies/${code}/private/${trackerUid}/submitted_r${round}`] = true;
  });

  // 13. Seer results
  Object.entries(seerActions).forEach(([seerUid, picks]) => {
    if (isSilenced(seerUid)) return;
    if (!isAlive(seerUid)) return;
    const pickedUids = Object.keys(picks || {});
    if (pickedUids.length !== 4) return;
    const evilCount = pickedUids.filter(pid => {
      const r = roles[pid];
      return r && ROLE_DEFS[r] && ROLE_DEFS[r].team === 'werewolf';
    }).length;
    updates[`lobbies/${code}/private/${seerUid}/seerResults/${round}`] = {
      evilCount, total: 4
    };
    updates[`lobbies/${code}/private/${seerUid}/submitted_r${round}`] = true;
  });

  // Apply deaths
  deaths.forEach(pid => {
    if (isAlive(pid)) {
      updates[`lobbies/${code}/players/${pid}/alive`] = false;
      playersNow[pid] = { ...playersNow[pid], alive: false };
    }
  });

  // Write log
  if (deathLog.length) {
    deathLog.forEach(t => { updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(t, 'death'); });
  } else {
    updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry('The town was quiet last night. No one died.', 'info');
  }
  infoMsgs.forEach(t => { updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(t, 'info'); });

  // Win check
  const projected = {};
  Object.entries(playersNow).forEach(([pid, p]) => {
    projected[pid] = { ...p, role: roles[pid] };
  });
  const winner = checkWinCondition(projected);
  if (winner) {
    await finishGame(updates, winner, roles);
    return;
  }

  // Advance to day
  updates[`lobbies/${code}/phase`]       = 'day';
  updates[`lobbies/${code}/phaseEndsAt`] = Date.now() + (state.settings.daySeconds || 120) * 1000;
  updates[`lobbies/${code}/paused`]      = false;
  await update(ref(db), updates);
}

// ── DAY / REVOTE RESOLUTION ───────────────────────────────────────────
async function resolveDay(isRevote = false) {
  const round = state.round;
  const code  = lobbyCode;

  const [votesSnap, rolesSnap] = await Promise.all([
    get(ref(db, `lobbies/${code}/votes/${round}`)),
    get(ref(db, `lobbies/${code}/secretRoles`))
  ]);

  const votes = votesSnap.val() || {};
  const roles = rolesSnap.val() || {};

  // Mayor: hidden double vote weight
  const weights = {};
  Object.entries(state.players).forEach(([pid, p]) => {
    if (p.alive === false) return;
    const def = ROLE_DEFS[roles[pid]];
    if (def && def.voteWeight) weights[pid] = def.voteWeight;
  });

  const { targetUid, tie } = tallyVotes(votes, weights);

  const updates = {};

  if (tie && !isRevote) {
    // Tie on first vote → trigger revote
    const tied = tiedPlayers(votes, weights);
    const tiedObj = {};
    tied.forEach(pid => { tiedObj[pid] = true; });
    const names = tied.map(pid => state.players[pid]?.name).filter(Boolean).map(escapeHTML).join(' and ');
    updates[`lobbies/${code}/revoteEligible`]         = tiedObj;
    updates[`lobbies/${code}/phase`]                  = 'revote';
    updates[`lobbies/${code}/phaseEndsAt`]            = Date.now() + (state.settings.daySeconds || 120) * 1000;
    updates[`lobbies/${code}/paused`]                 = false;
    updates[`lobbies/${code}/log/${newLogKey()}`]     = logEntry(
      `The vote is tied between ${names}. A revote begins — only they can be voted for.`, 'info'
    );
    await update(ref(db), updates);
    return;
  }

  // Clear revote state
  updates[`lobbies/${code}/revoteEligible`] = null;

  let eliminatedUid = null;
  if (!targetUid || (tie && isRevote)) {
    // Second tie or no consensus → no elimination
    updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(
      'The town could not agree — no one was eliminated today.', 'info'
    );
  } else {
    eliminatedUid = targetUid;
    updates[`lobbies/${code}/players/${eliminatedUid}/alive`] = false;
    const name = state.players[eliminatedUid]?.name || 'A player';
    updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(
      `${name} was voted out by the town.`, 'death'
    );

    // Jester / winsIfVotedOut
    const elDef = ROLE_DEFS[roles[eliminatedUid]];
    if (elDef && elDef.winsIfVotedOut) {
      await finishGame(updates, roles[eliminatedUid], roles,
        `${name} wanted to be voted out — and got their wish!`);
      return;
    }
  }

  // Win check after elimination
  const projected = {};
  Object.entries(state.players).forEach(([pid, p]) => {
    projected[pid] = { ...p, alive: pid === eliminatedUid ? false : p.alive, role: roles[pid] };
  });
  const winner = checkWinCondition(projected);
  if (winner) { await finishGame(updates, winner, roles); return; }

  // Advance to next night
  updates[`lobbies/${code}/phase`]       = 'night';
  updates[`lobbies/${code}/round`]       = round + 1;
  updates[`lobbies/${code}/phaseEndsAt`] = Date.now() + (state.settings.nightSeconds || 60) * 1000;
  updates[`lobbies/${code}/paused`]      = false;
  updates[`lobbies/${code}/silenced`]    = null;
  updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry('Night falls once more.', 'night');
  await update(ref(db), updates);
}

// ── FINISH GAME ───────────────────────────────────────────────────────
async function finishGame(updates, winner, roles, customLog = null) {
  const code = lobbyCode;
  updates[`lobbies/${code}/phase`]  = 'ended';
  updates[`lobbies/${code}/winner`] = winner;
  // Reveal all roles
  Object.entries(roles).forEach(([pid, role]) => {
    updates[`lobbies/${code}/publicReveal/${pid}`] = role;
  });
  const { sub } = winnerDisplay(winner);
  updates[`lobbies/${code}/log/${newLogKey()}`] = logEntry(customLog || sub || 'The hunt is over.', 'win');
  await update(ref(db), updates);
}

// ── END SCREEN ────────────────────────────────────────────────────────
function renderEndScreen() {
  showScreen('end');
  const winner = state.winner;
  const { label, team } = winnerDisplay(winner);
  const labelEl = $('winner-label');
  labelEl.className   = `winner-label team-${team}`;
  labelEl.textContent = label;
  // Use the last win log entry as the subtitle
  const winEntry = Object.values(state.log || {})
    .filter(e => e.type === 'win').sort((a, b) => b.ts - a.ts)[0];
  $('winner-sub').textContent = winEntry ? winEntry.text : winnerDisplay(winner).sub;

  const reveal = state.publicReveal || {};
  $('end-role-list').innerHTML = Object.entries(state.players).map(([pid, p]) => {
    const def = ROLE_DEFS[reveal[pid]];
    return `<div class="player-chip${p.alive === false ? ' is-dead' : ''}${pid === uid ? ' is-me' : ''}">
      <div class="avatar">${(p.name || '?').slice(0, 1).toUpperCase()}</div>
      <div class="name">${escapeHTML(p.name)}</div>
      <span class="tag">${def ? `${def.icon} ${def.name}` : '?'}</span>
    </div>`;
  }).join('');

  $('end-host-card').classList.toggle('hidden', !isHost);
}

// ── PLAY AGAIN ────────────────────────────────────────────────────────
$('play-again-btn').addEventListener('click', async () => {
  if (!isHost) return;
  const code    = lobbyCode;
  const updates = {
    [`lobbies/${code}/phase`]:          'lobby',
    [`lobbies/${code}/round`]:          0,
    [`lobbies/${code}/phaseEndsAt`]:    null,
    [`lobbies/${code}/paused`]:         false,
    [`lobbies/${code}/winner`]:         null,
    [`lobbies/${code}/secretRoles`]:    null,
    [`lobbies/${code}/werewolfTeam`]:   null,
    [`lobbies/${code}/nightActions`]:   null,
    [`lobbies/${code}/votes`]:          null,
    [`lobbies/${code}/revoteEligible`]: null,
    [`lobbies/${code}/log`]:            null,
    [`lobbies/${code}/private`]:        null,
    [`lobbies/${code}/publicReveal`]:   null,
    [`lobbies/${code}/poisoned`]:       null,
    [`lobbies/${code}/piratePrepping`]: null,
    [`lobbies/${code}/silenced`]:       null
  };
  Object.keys(state.players).forEach(pid => {
    updates[`lobbies/${code}/players/${pid}/alive`]          = true;
    updates[`lobbies/${code}/players/${pid}/revealed`]       = false;
    updates[`lobbies/${code}/players/${pid}/revealedRoleName`] = null;
    updates[`lobbies/${code}/players/${pid}/revealedRoleIcon`] = null;
    updates[`lobbies/${code}/players/${pid}/piratePrepping`] = false;
  });
  try {
    await update(ref(db), updates);
    state.werewolfTeam = null;
    seerPicks = [];
  } catch (e) { console.error(e); toast('Could not reset the game', true); }
});
