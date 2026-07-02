// app.js — Werewolf party game (full rewrite)
// Architecture: host's browser resolves each phase and writes results to
// Firebase. All other tabs listen and render reactively. Host sees NO extra
// information beyond their own role.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  onValue,
  remove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  ROLE_DEFS,
  optionalRoleKeys,
  optionalRoleKeysByTeam,
  teamDisplayLabel,
  werewolfTeamKeys,
  defaultSettings,
  validateSettings,
  enforcePreGameRoleConstraints,
  SEER_MIN_LOBBY_SIZE,
  assignRoles,
  assignAvatarsAndColours,
  tallyVotes,
  tiedPlayers,
  checkJesterWin,
  checkWinCondition,
  winnerDisplay,
  resolveNightPure,
} from "./roles.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getDatabase(fbApp);

// ASSET PRELOADING
// All role icons + player avatars + background art are small (under 1MB
// total combined) -- warm the browser cache immediately on load so nothing
// pops in slowly later, even for first-time visitors with an empty cache.
(function preloadAssets() {
  const roleIconPaths = Object.values(ROLE_DEFS).map(function (def) {
    return def.icon;
  });
  const avatarPaths = [];
  for (var n = 1; n <= 10; n++)
    avatarPaths.push("img/avatars/player" + n + ".png");
  const backgroundPaths = ["img/moon.png", "img/treeline.png"];
  roleIconPaths
    .concat(avatarPaths)
    .concat(backgroundPaths)
    .forEach(function (src) {
      var img = new Image();
      img.src = src;
    });
})();

// Wraps any promise with a timeout so Firebase hangs fail loudly instead of silently.
// databaseURL mismatches are the most common cause of silent hangs.
function withTimeout(promise, ms = 8000, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          label +
            " timed out after " +
            ms / 1000 +
            "s. " +
            "Most likely cause: databaseURL in firebase-config.js does not match your " +
            "Firebase Realtime Database URL. Find the correct URL in Firebase Console " +
            "→ Realtime Database → Data tab (it looks like " +
            "https://YOUR-PROJECT-default-rtdb.firebaseio.com or " +
            "https://YOUR-PROJECT-default-rtdb.REGION.firebasedatabase.app).",
        ),
      );
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Monitor database connection state — shows a persistent banner if the
// Realtime Database is unreachable (wrong databaseURL is the #1 cause).
// NOTE: uses document.getElementById directly (not $) because this fires
// before the $ helper const is initialised further down the module.
let _dbWarnTimer = null;
onValue(ref(db, ".info/connected"), (snap) => {
  const connected = snap.val() === true;
  const banner = document.getElementById("db-error-banner");
  if (!banner) return;
  if (connected) {
    clearTimeout(_dbWarnTimer);
    _dbWarnTimer = null;
    banner.classList.add("hidden");
  } else {
    if (!_dbWarnTimer) {
      _dbWarnTimer = setTimeout(() => {
        banner.textContent =
          "⚠️ Cannot reach Firebase Realtime Database. " +
          "Check that databaseURL in firebase-config.js exactly matches the URL " +
          "shown in Firebase Console → Realtime Database → Data tab " +
          "(yours should end in .europe-west1.firebasedatabase.app).";
        banner.classList.remove("hidden");
      }, 4000);
    }
  }
});

if (
  !firebaseConfig.apiKey ||
  String(firebaseConfig.apiKey).includes("REPLACE_ME")
) {
  console.warn("firebase-config.js still has placeholder values.");
  const b = document.getElementById("config-warning");
  if (b) b.classList.remove("hidden");
}

// ── MODULE STATE ─────────────────────────────────────────────────────
let uid = null;
let lobbyCode = null;
let isHost = false;
let myRole = null; // role key for this player
let mySecretData = {}; // private per-player data (tracker result etc.)
let cachedGame = null; // last Firebase snapshot value
let countdownRAF = null; // requestAnimationFrame handle for timer
let phaseEndTs = null; // ms timestamp when current phase ends
let presenceInterval = null; // heartbeat setInterval
let seerPicksLocal = []; // client-side staging for Seer's 4 picks
let resolvingInProgress = false; // guard against double-resolve
let pendingNightActionType = null; // what night action type this player submitted

// ── BOT AI STATE (host-side only) ─────────────────────────────────────
// Bots are simulated players managed entirely by the host's browser.
// They never authenticate — the host writes their actions on their behalf,
// which is already permitted since the host has full write access to the
// whole lobby subtree. See runBotController() further down.
const BOT_NAMES = [
  "Bot Abigail",
  "Bot Elias",
  "Bot Mercy",
  "Bot Increase",
  "Bot Constance",
  "Bot Ezekiel",
  "Bot Patience",
  "Bot Jeremiah",
  "Bot Prudence",
  "Bot Nathaniel",
];
let botPlannedRound = {}; // uid -> round they'll use their once-per-game ability
let botScheduled = {}; // `${round}-${phase}-${uid}` -> true (already scheduled/acted)
let botWolfTarget = {}; // round -> shared target uid the wolf-bot pack leans toward

function resetBotState() {
  botPlannedRound = {};
  botScheduled = {};
  botWolfTarget = {};
}

// ── DOM HELPERS ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (el) =>
  typeof el === "string"
    ? $(el).classList.remove("hidden")
    : el.classList.remove("hidden");
const hide = (el) =>
  typeof el === "string"
    ? $(el).classList.add("hidden")
    : el.classList.add("hidden");

function showScreen(name) {
  ["landing", "waiting", "game", "end"].forEach((k) =>
    $(`screen-${k}`).classList.toggle("hidden", k !== name),
  );
  // Hide the entire HUD on landing — nothing there makes sense before joining a lobby
  const hud = document.getElementById("global-hud");
  const specBadge = document.getElementById("hud-spectator-badge");
  if (hud) hud.classList.toggle("hidden", name === "landing");
  if (specBadge) specBadge.classList.toggle("hidden", true);
  // Hide role button until in-game (role is only assigned when game starts)
  const roleBtn = document.getElementById("hud-role-btn");
  if (roleBtn)
    roleBtn.classList.toggle(
      "hidden",
      name === "landing" || name === "waiting",
    );
}

function escHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function toast(msg, isError = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3800);
}

// ── MODALS ───────────────────────────────────────────────────────────
function openModal(id) {
  $(id).classList.remove("hidden");
}
function closeModal(id) {
  $(id).classList.add("hidden");
}

document.querySelectorAll(".modal-overlay").forEach((el) =>
  el.addEventListener("click", (e) => {
    if (e.target === el) el.classList.add("hidden");
  }),
);

// ── ROLE POPUP ───────────────────────────────────────────────────────
// Used in three places: HUD role button, Settings roles list, Hunt Rules toggles.
function openRolePopup(roleKey, contextForPlayer = false) {
  const def = ROLE_DEFS[roleKey];
  if (!def) return;

  $("role-popup-icon").src = def.icon;
  $("role-popup-icon").alt = def.name;
  $("role-popup-name").textContent = def.name;

  const teamEl = $("role-popup-team");
  teamEl.textContent = teamDisplayLabel(def.team);
  teamEl.className = "role-team role-team--" + def.team;

  $("role-popup-blurb").textContent = def.blurb;

  const bullets = $("role-popup-bullets");
  bullets.innerHTML = "";
  (def.popupBullets || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    bullets.appendChild(li);
  });

  // If this is the player's own role in-game and they know their werewolf teammates
  const packEl = $("role-popup-pack");
  packEl.innerHTML = "";
  packEl.classList.add("hidden");
  if (contextForPlayer && cachedGame && def.team === "werewolf") {
    const packUids = getWolfPackUids();
    if (packUids.length) {
      packEl.classList.remove("hidden");
      packEl.innerHTML =
        '<p class="pack-label">Your pack:</p>' +
        packUids
          .map((wuid) => {
            if (wuid === uid) return "";
            const p = cachedGame.players?.[wuid];
            if (!p) return "";
            const role = cachedGame.secrets?.[wuid] || "";
            const def2 = ROLE_DEFS[role] || {};
            return `<div class="pack-member">
            <img src="${escHTML(p.avatar || "")}" class="pack-avatar" style="border-color:${escHTML(p.colour || "#888")}">
            <span>${escHTML(p.name)}</span>
            ${def2.icon ? `<img src="${def2.icon}" class="pack-role-icon" title="${def2.name || ""}">` : ""}
          </div>`;
          })
          .join("");
    }
  }

  openModal("role-popup-modal");
}

$("role-popup-modal-close").addEventListener("click", () =>
  closeModal("role-popup-modal"),
);

// HUD role button
$("hud-role-btn").addEventListener("click", () => {
  if (myRole) openRolePopup(myRole, true);
});

// ── SETTINGS PANEL ────────────────────────────────────────────────────
$("hud-settings-btn").addEventListener("click", () => {
  settingsShowMain();
  buildSettingsPanel(cachedGame); // populate immediately — don't wait for the next DB update
  openModal("settings-modal");
});
$("settings-modal-close").addEventListener("click", () =>
  closeModal("settings-modal"),
);

// Sub-panel navigation
function settingsShowMain() {
  $("settings-main-menu").classList.remove("hidden");
  ["players", "roles", "host"].forEach((p) =>
    $("settings-sub-" + p)?.classList.add("hidden"),
  );
}
function settingsShowSub(name) {
  $("settings-main-menu").classList.add("hidden");
  ["players", "roles", "host"].forEach((p) => {
    const el = $("settings-sub-" + p);
    if (el) el.classList.toggle("hidden", p !== name);
  });
}

$("settings-btn-players").addEventListener("click", () =>
  settingsShowSub("players"),
);
$("settings-btn-roles").addEventListener("click", () =>
  settingsShowSub("roles"),
);
$("settings-btn-host").addEventListener("click", () => settingsShowSub("host"));
$("settings-back-players").addEventListener("click", settingsShowMain);
$("settings-back-roles").addEventListener("click", settingsShowMain);
$("settings-back-host").addEventListener("click", settingsShowMain);

// Role popup from role reference list
$("settings-modal").addEventListener("click", (e) => {
  const roleBtn = e.target.closest("[data-role-popup]");
  if (roleBtn) openRolePopup(roleBtn.dataset.rolePopup);
});

function buildSettingsPanel(game) {
  if (!game) return;
  const phase = game.phase || "lobby";
  const inGame = phase !== "lobby" && phase !== "end";

  // ── Player list (built fresh each time)
  const listEl = $("settings-player-list");
  listEl.innerHTML = "";
  const players = game.players || {};
  Object.entries(players)
    .sort((a, b) => (a[1].joinOrder || 0) - (b[1].joinOrder || 0))
    .forEach(([puid, p]) => {
      const row = document.createElement("div");
      row.className = "settings-player-row";
      const connBadge =
        p.connected === false
          ? '<span class="conn-badge conn-badge--offline" title="Disconnected">⚡</span>'
          : "";
      const botBadge = p.isBot ? '<span class="bot-badge">🤖 Bot</span>' : "";
      const transferBtn =
        isHost && puid !== uid && !p.isBot
          ? `<button class="btn-ghost btn-xs transfer-host-btn" data-uid="${escHTML(puid)}" title="Make host">👑 Make host</button>`
          : puid === uid
            ? '<span class="you-badge">You</span>'
            : "";
      row.innerHTML = `
        <img src="${escHTML(p.avatar || "img/avatars/player1.png")}" class="settings-avatar"
             style="border-color:${escHTML(p.colour || "#888")}">
        <span class="settings-pname">${escHTML(p.name)}${!p.alive && phase !== "lobby" ? ' <span class="dead-label">(dead)</span>' : ""}</span>
        ${botBadge}${connBadge}${transferBtn}
      `;
      listEl.appendChild(row);
    });
  listEl
    .querySelectorAll(".transfer-host-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => transferHostTo(btn.dataset.uid)),
    );

  // ── Role reference list — only build once (icons are static, no need to rebuild)
  const rolesListEl = $("settings-roles-list");
  if (!rolesListEl.dataset.built) {
    rolesListEl.dataset.built = "1";
    const allKeys = [...optionalRoleKeys(), "werewolf", "villager"];
    optionalRoleKeysByTeam().forEach(({ team, keys }) => {
      const heading = document.createElement("p");
      heading.className = "roles-group-heading";
      heading.textContent = teamDisplayLabel(team);
      rolesListEl.appendChild(heading);
      keys.forEach((rk) => appendRoleListItem(rolesListEl, rk));
    });
    // Base roles at bottom
    const baseHeading = document.createElement("p");
    baseHeading.className = "roles-group-heading";
    baseHeading.textContent = "Base roles";
    rolesListEl.appendChild(baseHeading);
    ["werewolf", "villager"].forEach((rk) =>
      appendRoleListItem(rolesListEl, rk),
    );
  }

  // ── Host controls button — visible only to host
  $("settings-btn-host").classList.toggle("hidden", !isHost);

  // ── Host sub-panel controls
  $("settings-pause-btn").classList.toggle("hidden", !inGame || !!game.paused);
  $("settings-resume-btn").classList.toggle("hidden", !inGame || !game.paused);
  $("settings-hunt-rules-btn").classList.toggle("hidden", phase !== "lobby");

  // ── Transfer host list inside host sub-panel
  const transferEl = $("settings-transfer-list");
  transferEl.innerHTML = "";
  if (isHost && Object.keys(players).length > 1) {
    const heading = document.createElement("p");
    heading.className = "settings-section-heading";
    heading.textContent = "Transfer host";
    transferEl.appendChild(heading);
    Object.entries(players)
      .filter(([puid, p]) => puid !== uid && !p.isBot)
      .sort((a, b) => (a[1].joinOrder || 0) - (b[1].joinOrder || 0))
      .forEach(([puid, p]) => {
        const btn = document.createElement("button");
        btn.className = "btn-ghost btn-block";
        btn.style.marginBottom = "6px";
        btn.textContent = "👑 Make " + (p.name || "them") + " host";
        btn.addEventListener("click", () => transferHostTo(puid));
        transferEl.appendChild(btn);
      });
  }
}

function appendRoleListItem(container, rk) {
  const def = ROLE_DEFS[rk];
  if (!def) return;
  const btn = document.createElement("button");
  btn.className = "role-list-item";
  btn.dataset.rolePopup = rk;
  btn.innerHTML = `<img src="${escHTML(def.icon)}" class="role-list-icon" alt="">
                   <span>${escHTML(def.name)}</span>`;
  container.appendChild(btn);
}

$("settings-leave-btn").addEventListener("click", () => {
  if (!confirm("Leave this lobby? You will be removed from the game.")) return;
  leaveGame();
});

$("settings-pause-btn").addEventListener("click", async () => {
  if (!isHost || !lobbyCode || !cachedGame) return;
  const remaining = phaseEndTs ? Math.max(0, phaseEndTs - Date.now()) : 0;
  await update(ref(db, `lobbies/${lobbyCode}`), {
    paused: true,
    pausedRemaining: remaining,
  });
});

$("settings-resume-btn").addEventListener("click", async () => {
  if (!isHost || !lobbyCode || !cachedGame) return;
  const remaining = cachedGame.pausedRemaining || 0;
  const newEnd = Date.now() + remaining;
  await update(ref(db, `lobbies/${lobbyCode}`), {
    paused: false,
    pausedRemaining: null,
    phaseEndsAt: newEnd,
  });
});

// ── HUNT RULES (HOST-ONLY, LOBBY ONLY) ───────────────────────────────
$("settings-hunt-rules-btn").addEventListener("click", () => {
  buildHuntRulesPanel();
  openModal("hunt-rules-modal");
});
$("hunt-rules-modal-close").addEventListener("click", () =>
  closeModal("hunt-rules-modal"),
);

function buildHuntRulesPanel() {
  if (!cachedGame) return;
  const settings = cachedGame.settings || defaultSettings();
  const playerCount = Object.keys(cachedGame.players || {}).length;

  renderBotList();

  // Werewolf stepper
  $("wolf-count-value").textContent = settings.werewolfCount || 1;

  // Optional roles by team group
  const container = $("hunt-rules-roles");
  container.innerHTML = "";
  optionalRoleKeysByTeam().forEach(({ team, keys }) => {
    const heading = document.createElement("p");
    heading.className = "roles-group-heading";
    heading.textContent = teamDisplayLabel(team);
    container.appendChild(heading);

    keys.forEach((rk) => {
      const def = ROLE_DEFS[rk];
      const isOn = !!settings.optionalRoles?.[rk];
      const isSeerGated = rk === "seer" && playerCount < SEER_MIN_LOBBY_SIZE;

      const row = document.createElement("div");
      row.className = "hunt-rules-row";
      row.innerHTML = `
        <button class="role-info-btn" data-role-popup="${rk}" type="button">
          <img src="${def.icon}" class="role-list-icon" alt="">
          <span>${escHTML(def.name)}</span>
        </button>
        <label class="toggle-switch">
          <input type="checkbox" data-role="${rk}" ${isOn ? "checked" : ""} ${isSeerGated ? "disabled" : ""}>
          <span class="toggle-slider"></span>
        </label>
      `;
      if (isSeerGated) {
        const note = document.createElement("p");
        note.className = "muted-note hunt-rules-gate-note";
        note.textContent = `Needs ${SEER_MIN_LOBBY_SIZE}+ players`;
        row.appendChild(note);
      }
      container.appendChild(row);
    });
  });

  // Timer inputs
  $("night-seconds-input").value = settings.nightSeconds ?? 60;
  $("day-seconds-input").value = settings.daySeconds ?? 120;

  updateHuntRulesValidation();
}

// Role info buttons within hunt rules panel
$("hunt-rules-modal").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-role-popup]");
  if (btn) openRolePopup(btn.dataset.rolePopup);
});

// Wolf stepper
$("wolf-minus").addEventListener("click", () => nudgeWolfCount(-1));
$("wolf-plus").addEventListener("click", () => nudgeWolfCount(+1));

async function nudgeWolfCount(delta) {
  if (!isHost || !lobbyCode || !cachedGame) return;
  const settings = cachedGame.settings || defaultSettings();
  const next = Math.max(1, (settings.werewolfCount || 1) + delta);
  await update(ref(db, `lobbies/${lobbyCode}/settings`), {
    werewolfCount: next,
  });
}

// Role toggles
$("hunt-rules-roles").addEventListener("change", async (e) => {
  const cb = e.target;
  if (cb.type !== "checkbox" || !cb.dataset.role) return;
  if (!isHost || !lobbyCode || !cachedGame) return;
  const roleKey = cb.dataset.role;
  const settings = cachedGame.settings || defaultSettings();
  const nextOptional = {
    ...(settings.optionalRoles || {}),
    [roleKey]: cb.checked,
  };
  const playerCount = Object.keys(cachedGame.players || {}).length;
  const constrained = enforcePreGameRoleConstraints(
    { ...settings, optionalRoles: nextOptional },
    playerCount,
  );
  await update(ref(db, `lobbies/${lobbyCode}/settings`), {
    optionalRoles: constrained.optionalRoles,
  });
});

// ── BOTS (HOST-ONLY, LOBBY ONLY) ──────────────────────────────────────
// Bots are added/removed for testing directly from the Hunt Rules panel.
// They never authenticate with Firebase — the host writes their name/state
// on join, then drives all their in-game decisions from runBotController().
function renderBotList() {
  if (!cachedGame) return;
  const listEl = $("hunt-rules-bot-list");
  if (!listEl) return;
  const players = cachedGame.players || {};
  const bots = Object.entries(players).filter(([, p]) => p.isBot);

  listEl.innerHTML = "";
  if (!bots.length) {
    listEl.innerHTML = '<p class="muted-note">No bots added yet.</p>';
  } else {
    bots
      .sort((a, b) => (a[1].joinOrder || 0) - (b[1].joinOrder || 0))
      .forEach(([botUid, p]) => {
        const row = document.createElement("div");
        row.className = "hunt-rules-bot-row";
        row.innerHTML = `
          <span class="hunt-rules-bot-name">${escHTML(p.name)}</span>
          <button class="btn-ghost btn-xs" data-remove-bot="${escHTML(botUid)}" type="button">Remove</button>
        `;
        listEl.appendChild(row);
      });
  }

  const playerCount = Object.keys(players).length;
  const addBtn = $("add-bot-btn");
  if (addBtn) addBtn.disabled = playerCount >= 10;
}

async function addBot() {
  if (!isHost || !lobbyCode || !cachedGame) return;
  const players = cachedGame.players || {};
  const count = Object.keys(players).length;
  if (count >= 10) {
    toast("Lobby is full (10/10)", true);
    return;
  }

  const usedNames = new Set(Object.values(players).map((p) => p.name));
  const available = BOT_NAMES.filter((n) => !usedNames.has(n));
  const name = available.length
    ? available[Math.floor(Math.random() * available.length)]
    : "Bot " + Math.floor(Math.random() * 1000);

  const botUid = "bot_" + Math.random().toString(36).slice(2, 10);
  const joinOrderNum = count;

  try {
    await update(ref(db, `lobbies/${lobbyCode}`), {
      [`players/${botUid}`]: {
        name,
        isBot: true,
        joinOrder: joinOrderNum,
        alive: true,
        revealedRole: null,
        connected: true,
        disconnectedAt: null,
        isSpectator: false,
        avatar: "",
        colour: "",
      },
      [`joinOrder/${botUid}`]: joinOrderNum,
    });
  } catch (err) {
    console.error("addBot failed:", err);
    toast("Failed to add bot: " + (err.message || err.code), true);
  }
}

async function removeBot(botUid) {
  if (!isHost || !lobbyCode) return;
  try {
    await update(ref(db, `lobbies/${lobbyCode}`), {
      [`players/${botUid}`]: null,
      [`joinOrder/${botUid}`]: null,
    });
  } catch (err) {
    console.error("removeBot failed:", err);
    toast("Failed to remove bot: " + (err.message || err.code), true);
  }
}

$("add-bot-btn")?.addEventListener("click", addBot);
$("hunt-rules-bot-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-bot]");
  if (btn) removeBot(btn.dataset.removeBot);
});

// Timer inputs
["night-seconds-input", "day-seconds-input"].forEach((id) => {
  $(id).addEventListener("change", async () => {
    if (!isHost || !lobbyCode) return;
    const n = parseInt($("night-seconds-input").value, 10) || 60;
    const d = parseInt($("day-seconds-input").value, 10) || 120;
    await update(ref(db, `lobbies/${lobbyCode}/settings`), {
      nightSeconds: Math.max(10, n),
      daySeconds: Math.max(10, d),
    });
  });
});

function updateHuntRulesValidation() {
  if (!cachedGame) return;
  const settings = cachedGame.settings || defaultSettings();
  const playerCount = Object.keys(cachedGame.players || {}).length;
  const { ok, error, warnings } = validateSettings(settings, playerCount);
  const errEl = $("hunt-rules-error");
  errEl.textContent = ok ? warnings[0] || "" : error;
  errEl.classList.toggle("is-error", !ok);
  errEl.classList.toggle("is-warning", ok && warnings.length > 0);
  errEl.classList.toggle("hidden", ok && !warnings.length);
}

// ── TIMER / COUNTDOWN ────────────────────────────────────────────────
function startCountdown(endTs, paused, pausedRemaining) {
  phaseEndTs = endTs;
  if (countdownRAF) cancelAnimationFrame(countdownRAF);

  function tick() {
    const hudTimerEl = $("hud-timer");
    if (!hudTimerEl) return;
    if (paused) {
      const secs = Math.ceil((pausedRemaining || 0) / 1000);
      hudTimerEl.textContent = formatTime(secs);
      return;
    }
    const msLeft = Math.max(0, (phaseEndTs || 0) - Date.now());
    hudTimerEl.textContent = formatTime(Math.ceil(msLeft / 1000));
    if (msLeft > 0) countdownRAF = requestAnimationFrame(tick);
  }
  countdownRAF = requestAnimationFrame(tick);
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

// ── HUD RENDER ───────────────────────────────────────────────────────
function renderHUD(game) {
  if (!game) return;
  const phase = game.phase || "lobby";

  // Lobby code
  $("hud-lobby-code").textContent = lobbyCode || "";
  $("hud-lobby-code").classList.toggle("hidden", !lobbyCode || phase === "end");

  // Phase label
  const phaseLabels = {
    lobby: "Lobby",
    night: "🌙 Night",
    morning: "🌅 Morning",
    day: "☀ Day",
    revote: "⚖ Revote",
    animation: "🎲 Fate",
    end: "Game Over",
  };
  $("hud-phase").textContent = phaseLabels[phase] || phase;

  // Round
  $("hud-round").textContent =
    game.round && phase !== "lobby" ? `Round ${game.round}` : "";

  // Timer
  if (
    game.phaseEndsAt &&
    phase !== "lobby" &&
    phase !== "morning" &&
    phase !== "animation" &&
    phase !== "end"
  ) {
    $("hud-timer").classList.remove("hidden");
    startCountdown(game.phaseEndsAt, !!game.paused, game.pausedRemaining);
  } else {
    $("hud-timer").classList.add("hidden");
    if (countdownRAF) cancelAnimationFrame(countdownRAF);
  }

  // Role icon
  const roleForHUD = myRole || "villager";
  const roleDef = ROLE_DEFS[roleForHUD];
  if (roleDef) $("hud-role-icon").src = roleDef.icon;

  // Spectator badge
  const myPlayer = game.players?.[uid];
  const isSpectator = myPlayer && !myPlayer.alive;
  $("hud-spectator-badge").classList.toggle("hidden", !isSpectator);

  // Settings button always visible
}

// ── LOG MODAL ────────────────────────────────────────────────────────
$("hud-log-btn").addEventListener("click", () => {
  renderLog(cachedGame);
  openModal("log-modal");
});
$("log-modal-close").addEventListener("click", () => closeModal("log-modal"));

function renderLog(game) {
  const feed = $("log-feed");
  feed.innerHTML = "";
  if (!game?.log) {
    feed.innerHTML = '<p class="muted-note">No events yet.</p>';
    return;
  }
  const entries = Object.values(game.log).sort(
    (a, b) => (a.ts || 0) - (b.ts || 0),
  );
  entries.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = `<span class="log-round">R${entry.round}·${(entry.phase || "").slice(0, 1).toUpperCase()}</span>
                     <span class="log-text">${escHTML(entry.text)}</span>`;
    feed.appendChild(div);
  });
  feed.scrollTop = feed.scrollHeight;
}

// ── LANDING SCREEN ────────────────────────────────────────────────────
$("create-lobby-btn").addEventListener("click", createLobby);
$("join-lobby-btn").addEventListener("click", joinLobby);
["create-name-input", "join-name-input", "join-code-input"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (id.includes("join")) joinLobby();
      else createLobby();
    }
  });
});

async function createLobby() {
  const name = $("create-name-input").value.trim();
  if (!name) {
    toast("Enter your name first", true);
    return;
  }
  if (!uid) {
    toast("Still connecting…", true);
    return;
  }

  const code = randomCode();
  lobbyCode = code;
  isHost = true;

  const settings = defaultSettings();
  const joinOrder = { [uid]: 0 };

  try {
    await withTimeout(
      set(ref(db, `lobbies/${code}`), {
        host: uid,
        phase: "lobby",
        round: 0,
        winner: null,
        settings,
        joinOrder,
        players: {
          [uid]: {
            name,
            joinOrder: 0,
            alive: true,
            revealedRole: null,
            connected: true,
            disconnectedAt: null,
            isSpectator: false,
            avatar: "",
            colour: "",
          },
        },
      }),
      8000,
      "Create lobby database write",
    );
    startPresence();
    subscribeToLobby(code);
  } catch (err) {
    console.error("createLobby failed:", err);
    lobbyCode = null;
    isHost = false;
    let msg;
    if ((err.message || "").includes("timed out")) {
      msg = err.message;
    } else if ((err.message || "").includes("PERMISSION_DENIED")) {
      msg =
        "Database permission denied — your Firebase rules may not be published yet.";
    } else {
      msg = "Failed to create lobby: " + (err.message || err.code || err);
    }
    toast(msg, true);
    const errEl = $("landing-error");
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
  }
}

async function joinLobby() {
  const name = $("join-name-input").value.trim();
  const code = $("join-code-input")
    .value.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (!name) {
    toast("Enter your name first", true);
    return;
  }
  if (!code) {
    toast("Enter a lobby code", true);
    return;
  }
  if (!uid) {
    toast("Still connecting…", true);
    return;
  }

  try {
    const snap = await withTimeout(
      get(ref(db, `lobbies/${code}`)),
      8000,
      "Lobby lookup database read",
    );
    if (!snap.exists()) {
      toast("Lobby not found — check the code", true);
      return;
    }
    const g = snap.val();
    if (g.phase !== "lobby") {
      toast("That game is already in progress", true);
      return;
    }

    const playerCount = Object.keys(g.players || {}).length;
    if (playerCount >= 10) {
      toast("This lobby is full (10/10)", true);
      return;
    }

    lobbyCode = code;
    isHost = g.host === uid;

    const myJoinOrder = playerCount;
    await withTimeout(
      update(ref(db, `lobbies/${code}/players/${uid}`), {
        name,
        joinOrder: myJoinOrder,
        alive: true,
        revealedRole: null,
        connected: true,
        disconnectedAt: null,
        isSpectator: false,
        avatar: "",
        colour: "",
      }),
      8000,
      "Join lobby player write",
    );
    await withTimeout(
      update(ref(db, `lobbies/${code}/joinOrder`), { [uid]: myJoinOrder }),
      8000,
      "Join lobby joinOrder write",
    );

    startPresence();
    subscribeToLobby(code);
  } catch (err) {
    console.error("joinLobby failed:", err);
    lobbyCode = null;
    let msg;
    if ((err.message || "").includes("timed out")) {
      msg = err.message;
    } else if ((err.message || "").includes("PERMISSION_DENIED")) {
      msg =
        "Database permission denied — your Firebase rules may not be published yet.";
    } else {
      msg = "Failed to join lobby: " + (err.message || err.code || err);
    }
    toast(msg, true);
    const errEl = $("landing-error");
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
  }
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Handle deep-link joining from URL (/lobby/CODE)
const urlMatch = location.pathname.match(/\/lobby\/([A-Z0-9]{4,6})/i);
if (urlMatch) $("join-code-input").value = urlMatch[1].toUpperCase();

$("copy-link-btn")?.addEventListener("click", () => {
  if (!lobbyCode) return;
  const link = `${location.origin}${location.pathname.replace(/\/lobby\/.*$/, "")}lobby/${lobbyCode}`;
  navigator.clipboard.writeText(link).then(() => toast("Link copied!"));
});

// ── PRESENCE / DISCONNECT ─────────────────────────────────────────────
const HEARTBEAT_MS = 10_000;
const TIMEOUT_MS = 60_000;

function startPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  writeHeartbeat();
  presenceInterval = setInterval(writeHeartbeat, HEARTBEAT_MS);
  // Firebase onDisconnect — mark offline immediately when connection drops
  if (uid && lobbyCode) {
    const presRef = ref(db, `lobbies/${lobbyCode}/presence/${uid}`);
    // Can't set onDisconnect to a specific value reliably without server SDK,
    // so we rely on the host-side timeout check in the listener below.
  }
}

function writeHeartbeat() {
  if (!uid || !lobbyCode) return;
  set(ref(db, `lobbies/${lobbyCode}/presence/${uid}`), Date.now());
  update(ref(db, `lobbies/${lobbyCode}/players/${uid}`), {
    connected: true,
    disconnectedAt: null,
  });
}

// Host checks for stale heartbeats and marks players as disconnected
function checkPresence(game) {
  if (!isHost || !game?.presence) return;
  const now = Date.now();
  Object.entries(game.presence).forEach(([puid, ts]) => {
    const player = game.players?.[puid];
    if (!player || !player.alive) return;
    const stale = now - ts > TIMEOUT_MS;
    if (stale && player.connected !== false) {
      update(ref(db, `lobbies/${lobbyCode}/players/${puid}`), {
        connected: false,
        disconnectedAt: ts,
        isSpectator: true,
      });
      // If host disconnected, transfer host
      if (puid === game.host) {
        autoTransferHost(game, puid);
      }
    } else if (!stale && player.connected === false) {
      // Reconnected
      update(ref(db, `lobbies/${lobbyCode}/players/${puid}`), {
        connected: true,
        disconnectedAt: null,
      });
    }
  });
}

async function autoTransferHost(game, oldHostUid) {
  const joinOrders = game.joinOrder || {};
  const playersSorted = Object.entries(game.players || {})
    .filter(
      ([puid, p]) => puid !== oldHostUid && p.connected !== false && !p.isBot,
    )
    .sort((a, b) => (joinOrders[a[0]] || 0) - (joinOrders[b[0]] || 0));
  if (!playersSorted.length) return;
  const newHostUid = playersSorted[0][0];
  await update(ref(db, `lobbies/${lobbyCode}`), { host: newHostUid });
  addLog(
    "system",
    `${escHTML(game.players[newHostUid]?.name || "Someone")} is now the host.`,
  );
}

async function transferHostTo(targetUid) {
  if (!isHost || !lobbyCode || !cachedGame) return;
  if (
    !confirm(
      `Make ${cachedGame.players?.[targetUid]?.name || "them"} the new host?`,
    )
  )
    return;
  await update(ref(db, `lobbies/${lobbyCode}`), { host: targetUid });
  addLog(
    "system",
    `${escHTML(cachedGame.players?.[targetUid]?.name || "Someone")} is now the host.`,
  );
  isHost = false;
}

async function leaveGame() {
  if (!uid || !lobbyCode) return;
  clearInterval(presenceInterval);
  if (isHost) {
    // Transfer host before leaving
    await autoTransferHost(cachedGame, uid);
  }
  await remove(ref(db, `lobbies/${lobbyCode}/players/${uid}`));
  await remove(ref(db, `lobbies/${lobbyCode}/presence/${uid}`));
  lobbyCode = null;
  isHost = false;
  myRole = null;
  cachedGame = null;
  showScreen("landing");
}

// ── SUBSCRIBE TO LOBBY ────────────────────────────────────────────────
function subscribeToLobby(code) {
  onValue(ref(db, `lobbies/${code}`), (snap) => {
    const g = snap.val();
    if (!g) {
      showScreen("landing");
      return;
    }

    // Were we removed from the player list?
    if (uid && !g.players?.[uid] && g.phase !== "lobby") {
      lobbyCode = null;
      showScreen("landing");
      return;
    }

    isHost = g.host === uid;
    cachedGame = g;

    // Update my role from secrets (if assigned)
    if (g.secrets?.[uid]) myRole = g.secrets[uid];

    checkPresence(g);
    if (isHost) runBotController(g);
    if (!$("hunt-rules-modal").classList.contains("hidden")) {
      buildHuntRulesPanel();
    }
    renderGame(g);
  });
}

// ── WAITING ROOM ──────────────────────────────────────────────────────
function renderWaiting(game) {
  showScreen("waiting");
  $("waiting-code").textContent = lobbyCode || "";

  const players = game.players || {};
  const count = Object.keys(players).length;
  $("player-count").textContent = count;

  const list = $("waiting-player-list");
  list.innerHTML = "";
  Object.values(players)
    .sort((a, b) => (a.joinOrder || 0) - (b.joinOrder || 0))
    .forEach((p) => {
      const div = document.createElement("div");
      div.className = "player-row";
      div.innerHTML = `<span>${escHTML(p.name)}</span>
                       ${p.connected === false ? '<span class="conn-badge--offline">⚡</span>' : ""}`;
      list.appendChild(div);
    });

  // Host controls
  $("host-footer-row").classList.toggle("hidden", !isHost);
  $("waiting-non-host-note").classList.toggle("hidden", isHost);

  if (isHost) {
    const { ok, error } = validateSettings(
      game.settings || defaultSettings(),
      count,
    );
    $("start-game-btn").disabled = !ok;
    $("start-game-hint").textContent = ok ? "" : error;
    // Auto-enforce Seer constraint
    const constrained = enforcePreGameRoleConstraints(
      game.settings || defaultSettings(),
      count,
    );
    if (
      constrained.optionalRoles?.seer !== game.settings?.optionalRoles?.seer
    ) {
      update(ref(db, `lobbies/${lobbyCode}/settings`), {
        optionalRoles: constrained.optionalRoles,
      });
    }
  }
}

$("start-game-btn").addEventListener("click", startGame);

// ── GAME START ────────────────────────────────────────────────────────
async function startGame() {
  if (!isHost || !lobbyCode || !cachedGame) return;
  const game = cachedGame;
  const settings = game.settings || defaultSettings();
  const playerIds = Object.keys(game.players || {});
  const count = playerIds.length;

  const { ok, error } = validateSettings(settings, count);
  if (!ok) {
    toast(error, true);
    return;
  }

  resetBotState();

  const { roleByUid, werewolfUids } = assignRoles(playerIds, settings);
  const avatarData = assignAvatarsAndColours(playerIds);

  // Build player updates (avatar + colour)
  const playerUpdates = {};
  playerIds.forEach((pid) => {
    playerUpdates[`players/${pid}/avatar`] = avatarData[pid].avatar;
    playerUpdates[`players/${pid}/colour`] = avatarData[pid].colour;
  });

  // Werewolves see each other — store their pack for HUD display
  // Write secrets (host writes all, each player reads their own)
  const secrets = {};
  playerIds.forEach((pid) => {
    secrets[pid] = roleByUid[pid];
  });

  // Spectator data — full role map for dead players to read
  const spectatorRoles = { ...secrets };

  await update(ref(db, `lobbies/${lobbyCode}`), {
    ...playerUpdates,
    secrets,
    spectatorRoles, // always readable — clients only display to spectators
    phase: "night",
    round: 1,
    phaseEndsAt: Date.now() + (settings.nightSeconds || 60) * 1000,
    paused: false,
    wolfPack: werewolfUids.reduce((o, wuid) => ({ ...o, [wuid]: true }), {}),
  });
}

// ── WOLF PACK HELPER ──────────────────────────────────────────────────
// Returns UIDs of all living werewolf-team members visible to this player.
function getWolfPackUids() {
  if (!cachedGame || !myRole) return [];
  if (ROLE_DEFS[myRole]?.team !== "werewolf") return [];
  const pack = cachedGame.wolfPack || {};
  return Object.keys(pack).filter((wuid) => cachedGame.players?.[wuid]?.alive);
}

// ── NIGHT PHASE RENDER ────────────────────────────────────────────────
function renderNight(game) {
  showScreen("game");
  renderHUD(game);

  const myPlayer = game.players?.[uid];
  const alive = myPlayer?.alive !== false;
  const silenced =
    game.silence?.targetUid === uid && game.silence.activeRound === game.round;
  const abilityUsed = !!game.abilityUsed?.[uid];
  const role = myRole || "villager";
  const def = ROLE_DEFS[role] || ROLE_DEFS.villager;

  // Show spectator overlay for dead players
  $("spectator-overlay").classList.toggle("hidden", alive);

  // Determine if player has an actionable night ability
  const hasNightAction =
    def.night &&
    !abilityUsed &&
    !silenced &&
    alive &&
    (def.usesPerGame === "unlimited" || !abilityUsed);

  // Night action card
  const card = $("night-action-card");
  card.classList.toggle("hidden", !hasNightAction && role !== "werewolf");

  if (hasNightAction || role === "werewolf") {
    renderNightActionCard(game, role, def, silenced, abilityUsed);
  }

  // No-action note for roles without night actions
  const noAction =
    !hasNightAction &&
    (role === "villager" ||
      role === "mayor" ||
      role === "jester" ||
      abilityUsed ||
      silenced);
  $("no-action-note").classList.toggle("hidden", !noAction);
  if (noAction) {
    $("no-action-note").textContent = silenced
      ? "🔇 You are silenced — your night action is blocked."
      : abilityUsed
        ? "Your ability has already been used."
        : "Rest quietly. Your fate lies in the hands of the town.";
  }

  // Werewolves can see their pack
  const packEl = $("wolf-pack-display");
  if (ROLE_DEFS[role]?.team === "werewolf") {
    packEl.classList.remove("hidden");
    const packUids = getWolfPackUids().filter((w) => w !== uid);
    packEl.innerHTML = packUids.length
      ? '<p class="pack-label">Your pack: ' +
        packUids
          .map((w) => {
            const p = game.players[w];
            return `<span style="color:${p.colour || "#888"}">${escHTML(p.name)}</span>`;
          })
          .join(", ") +
        "</p>"
      : '<p class="pack-label">You are alone.</p>';
  } else {
    packEl.classList.add("hidden");
  }

  // Silenced indicator
  $("silenced-badge").classList.toggle("hidden", !silenced);

  // Host resolve button
  $("resolve-btn").classList.toggle("hidden", !isHost);
  $("resolve-btn").textContent = "Skip";
}

function renderNightActionCard(game, role, def, silenced, abilityUsed) {
  const card = $("night-action-card");
  const label = $("night-action-label");
  const targets = $("night-action-targets");
  const status = $("night-action-status");

  label.textContent = def.night?.prompt || "Choose your action";
  targets.innerHTML = "";
  status.textContent = "";

  const players = game.players || {};
  const alivePids = Object.keys(players).filter((pid) => players[pid]?.alive);
  const deadPids = Object.keys(players).filter((pid) => !players[pid]?.alive);

  // Already submitted this round?
  const alreadySubmitted = !!game.nightActions?.[uid];

  if (alreadySubmitted) {
    targets.innerHTML =
      '<p class="muted-note">✓ Submitted. Waiting for night to resolve.</p>';
    return;
  }

  switch (def.night?.type) {
    case "kill": {
      // Werewolf kill — group vote, can't target teammates
      const packUids = getWolfPackUids();
      alivePids
        .filter((pid) => !packUids.includes(pid))
        .forEach((pid) => {
          const p = players[pid];
          const btn = makeTargetBtn(pid, p, () =>
            submitNightAction(role, "kill", { target: pid }),
          );
          targets.appendChild(btn);
        });
      // Show current wolf vote tally to wolf team
      const wolfVotes = game.wolfVotes || {};
      if (Object.keys(wolfVotes).length) {
        status.textContent =
          "Current pack vote: " +
          Object.entries(wolfVotes)
            .map(
              ([voter, t]) =>
                `${players[voter]?.name}→${t === "abstain" ? "Skip" : players[t]?.name}`,
            )
            .join(", ");
      }
      break;
    }
    case "protect": {
      const pool = def.night.allowSelf
        ? alivePids
        : alivePids.filter((p) => p !== uid);
      pool.forEach((pid) => {
        const p = players[pid];
        const btn = makeTargetBtn(pid, p, () =>
          submitNightAction(role, "protect", { target: pid }),
        );
        targets.appendChild(btn);
      });
      break;
    }
    case "shoot":
    case "poison":
    case "duel": {
      alivePids
        .filter((pid) => pid !== uid)
        .forEach((pid) => {
          const p = players[pid];
          const btn = makeTargetBtn(pid, p, () =>
            submitNightAction(role, def.night.type, { target: pid }),
          );
          targets.appendChild(btn);
        });
      break;
    }
    case "track": {
      // Tracker picks living players only (dead can't act)
      alivePids
        .filter((pid) => pid !== uid)
        .forEach((pid) => {
          const p = players[pid];
          const btn = makeTargetBtn(pid, p, () =>
            submitNightAction(role, "track", { target: pid }),
          );
          targets.appendChild(btn);
        });
      break;
    }
    case "inspect4": {
      // Seer picks exactly 4 (dead or alive, not self)
      seerPicksLocal = [];
      const pool = [...alivePids, ...deadPids].filter((pid) => pid !== uid);
      pool.forEach((pid) => {
        const p = players[pid];
        const btn = makeTargetBtn(pid, p, () => toggleSeerPick(pid, btn));
        btn.dataset.pid = pid;
        targets.appendChild(btn);
      });
      const confirmBtn = document.createElement("button");
      confirmBtn.id = "seer-confirm-local";
      confirmBtn.className = "btn-primary btn-block hidden";
      confirmBtn.textContent = "Confirm (0/4 selected)";
      confirmBtn.addEventListener("click", () => {
        if (seerPicksLocal.length !== 4) {
          toast("Select exactly 4 players", true);
          return;
        }
        submitNightAction(role, "inspect4", { picks: [...seerPicksLocal] });
      });
      targets.appendChild(confirmBtn);
      break;
    }
    case "alert": {
      // Veteran just confirms
      const btn = document.createElement("button");
      btn.className = "btn-danger btn-block";
      btn.textContent = "🪖 Go on Alert (anyone who visits you tonight dies)";
      btn.addEventListener("click", () => submitNightAction(role, "alert", {}));
      targets.appendChild(btn);
      const skipBtn = document.createElement("button");
      skipBtn.className = "btn-ghost btn-block";
      skipBtn.style.marginTop = "8px";
      skipBtn.textContent = "Stay home (save alert for another night)";
      skipBtn.addEventListener("click", () =>
        submitNightAction(role, "none", {}),
      );
      targets.appendChild(skipBtn);
      break;
    }
    case "silence": {
      const pool2 = def.night.allowSelf
        ? alivePids
        : alivePids.filter((p) => p !== uid);
      pool2.forEach((pid) => {
        const p = players[pid];
        const btn = makeTargetBtn(pid, p, () =>
          submitNightAction(role, "silence", { target: pid }),
        );
        targets.appendChild(btn);
      });
      break;
    }
    case "adopt": {
      // Amnesiac picks a dead player (at least 1 must exist)
      const adoptable = deadPids.filter((pid) => {
        const r = game.spectatorRoles?.[pid] || "";
        return !["poisoner", "jester", "pirate", "amnesiac"].includes(r);
      });
      if (!adoptable.length) {
        targets.innerHTML =
          '<p class="muted-note">No one has died yet — wait until next night.</p>';
        return;
      }
      adoptable.forEach((pid) => {
        const p = players[pid];
        const btn = makeTargetBtn(
          pid,
          p,
          () => submitNightAction(role, "adopt", { target: pid }),
          true,
        );
        targets.appendChild(btn);
      });
      status.textContent = "You will NOT know their role before choosing.";
      break;
    }
  }
}

function makeTargetBtn(pid, playerData, onClick, isDead = false) {
  const btn = document.createElement("button");
  btn.className = "target-btn" + (isDead ? " target-btn--dead" : "");
  btn.style.borderColor = playerData?.colour || "#888";
  const avatar = playerData?.avatar || "img/avatars/player1.png";
  const name = playerData?.name || "Unknown";
  btn.innerHTML = `
    <img src="${escHTML(avatar)}" class="target-avatar">
    <span class="target-name">${escHTML(name)}</span>
    ${isDead ? '<span class="dead-label">(dead)</span>' : ""}
  `;
  btn.addEventListener("click", onClick);
  return btn;
}

function toggleSeerPick(pid, btn) {
  const idx = seerPicksLocal.indexOf(pid);
  if (idx >= 0) {
    seerPicksLocal.splice(idx, 1);
    btn.classList.remove("selected");
  } else {
    if (seerPicksLocal.length >= 4) {
      toast("Already selected 4", true);
      return;
    }
    seerPicksLocal.push(pid);
    btn.classList.add("selected");
  }
  const confirmBtn = document.getElementById("seer-confirm-local");
  if (confirmBtn) {
    confirmBtn.textContent = `Confirm (${seerPicksLocal.length}/4 selected)`;
    confirmBtn.classList.toggle("hidden", seerPicksLocal.length !== 4);
  }
}

async function submitNightAction(role, type, data) {
  if (!uid || !lobbyCode) return;
  pendingNightActionType = type;

  if (ROLE_DEFS[role]?.night?.groupVote && type === "kill") {
    // Wolf kill is a group vote — goes to wolfVotes node
    await set(
      ref(db, `lobbies/${lobbyCode}/wolfVotes/${uid}`),
      data.target || "abstain",
    );
    toast("Vote submitted — waiting for pack.");
    renderNight(cachedGame);
    return;
  }

  const payload = { type, ...data };
  await set(ref(db, `lobbies/${lobbyCode}/nightActions/${uid}`), payload);

  // Mark ability as used for once-per-game roles
  const def = ROLE_DEFS[role];
  if (def?.usesPerGame === 1 && type !== "none") {
    await set(ref(db, `lobbies/${lobbyCode}/abilityUsed/${uid}`), true);
  }

  toast("Action submitted.");
  renderNight(cachedGame);
}

$("resolve-btn").addEventListener("click", () => {
  if (!isHost) return;
  const phase = cachedGame?.phase;
  if (phase === "night") resolveNight();
  else if (phase === "day" || phase === "revote") resolveDay();
  else if (phase === "morning") advanceToDay();
});

// ── NIGHT RESOLUTION (HOST ONLY) ─────────────────────────────────────
async function resolveNight() {
  if (!isHost || !lobbyCode || resolvingInProgress) return;
  const game = cachedGame;
  if (!game || game.phase !== "night") return;
  resolvingInProgress = true;

  try {
    const allRoles = game.secrets || game.spectatorRoles || {};

    // All the actual game-rule logic lives in roles.js's resolveNightPure(),
    // which is unit-tested in isolation (see testing/). This function only
    // handles turning that result into Firebase writes.
    const result = resolveNightPure({
      players: game.players,
      roles: allRoles,
      nightActions: game.nightActions,
      wolfVotes: game.wolfVotes,
      round: game.round,
      poison: game.poison,
      pirate: game.pirate,
      silence: game.silence,
    });

    const {
      deaths,
      amnesiasResult,
      trackerResult,
      trackerUid,
      seerResult,
      seerUid,
      coinTossResult,
      newPoison,
      newSilence,
      newPirate,
      logMessages,
      winResult,
    } = result;

    const round = game.round;
    const deadUids = Object.keys(deaths);

    // ── Build Firebase multi-path update
    const updates = {};

    // Kill players
    deadUids.forEach((pid) => {
      updates[`players/${pid}/alive`] = false;
      updates[`players/${pid}/isSpectator`] = true;
    });

    // Amnesiac adoption
    if (amnesiasResult) {
      updates[`secrets/${amnesiasResult.amnesiacUid}`] =
        amnesiasResult.adoptedRole;
      updates[`spectatorRoles/${amnesiasResult.amnesiacUid}`] =
        amnesiasResult.adoptedRole;
      updates[`abilityUsed/${amnesiasResult.amnesiacUid}`] = true;
      if (ROLE_DEFS[amnesiasResult.adoptedRole]?.team === "werewolf") {
        updates[`wolfPack/${amnesiasResult.amnesiacUid}`] = true;
      }
    }

    // Private results for Tracker and Seer
    if (trackerResult && trackerUid)
      updates[`nightResults/${trackerUid}`] = {
        type: "track",
        ...trackerResult,
      };
    if (seerResult && seerUid) {
      updates[`nightResults/${seerUid}`] = { type: "seer", ...seerResult };
      const existingHistory = Array.isArray(cachedGame.seerInvestigations)
        ? cachedGame.seerInvestigations
        : [];
      updates.seerInvestigations = [
        ...existingHistory,
        {
          investigatorUid: seerUid,
          picks: seerResult.picks,
          isEvil: seerResult.isEvil,
          round,
        },
      ];
    }

    // Morning report data (read by all clients during morning phase)
    updates.morning = {
      deaths,
      coinToss: coinTossResult,
      poisonAnnounce: newPoison ? { targetUid: newPoison.targetUid } : null,
      pirateAnnounce: newPirate ? { targetUid: newPirate.targetUid } : null,
      quietNight: !deadUids.length,
    };

    // Pending reveals for newly-dead players
    deadUids.forEach((pid) => {
      updates[`pendingReveal/${pid}`] = true;
    });

    // Clear night actions
    updates.nightActions = null;
    updates.wolfVotes = null;

    // Poison state
    if (newPoison) updates.poison = newPoison;
    else if (game.poison?.killRound === round) updates.poison = null;

    // Silence
    if (newSilence) updates.silence = newSilence;
    else if (game.silence?.activeRound === round) updates.silence = null;

    // Pirate state
    if (newPirate) updates.pirate = newPirate;
    else if (game.pirate?.duelRound === round) updates.pirate = null;

    // Phase transition
    if (winResult) {
      updates.phase = "end";
      updates.winner = winResult;
      updates.round = round;
    } else {
      updates.phase = "morning";
      updates.round = round;
      updates.phaseEndsAt = Date.now() + 8000; // 8s auto-advance
    }

    await update(ref(db, `lobbies/${lobbyCode}`), updates);

    // Write log entries
    for (const msg of logMessages) {
      await push(ref(db, `lobbies/${lobbyCode}/log`), {
        round,
        phase: "night",
        text: msg,
        ts: Date.now(),
      });
    }
    if (winResult) {
      const wd = winnerDisplay(winResult);
      await push(ref(db, `lobbies/${lobbyCode}/log`), {
        round,
        phase: "end",
        text: wd.label + ". " + wd.sub,
        ts: Date.now(),
      });
    }
  } finally {
    resolvingInProgress = false;
  }
}

// ── MORNING REPORT ────────────────────────────────────────────────────
function renderMorning(game) {
  showScreen("game");
  renderHUD(game);

  const morning = game.morning || {};
  const players = game.players || {};
  const myPlayer = players[uid];

  $("morning-report-card").classList.remove("hidden");
  $("night-action-card").classList.add("hidden");
  $("day-vote-card").classList.add("hidden");
  $("no-action-note").classList.add("hidden");

  const content = $("morning-report-content");
  content.innerHTML = "";

  // Deaths
  const deaths = morning.deaths || {};
  const deadUids = Object.keys(deaths);
  if (morning.quietNight || !deadUids.length) {
    content.innerHTML +=
      '<p class="morning-item">🌙 A quiet night — no one perished.</p>';
  } else {
    deadUids.forEach((pid) => {
      const name = players[pid]?.name || "Unknown";
      const cause = deaths[pid];
      const causeText =
        {
          wolves: "hunted by Werewolves",
          "veteran-alert": "slain by the Veteran",
          sheriff: "shot by the Sheriff",
          "sheriff-backfire": "the shot misfired on the Sheriff",
          "pirate-duel": "fell in a duel",
          poison: "succumbed to poison",
        }[cause] || "found dead";

      const revealedRole = players[pid]?.revealedRole;
      const roleText = revealedRole
        ? ` <span class="morning-role-reveal">[${ROLE_DEFS[revealedRole]?.name || revealedRole}]</span>`
        : "";

      content.innerHTML += `<p class="morning-item morning-item--death">
        💀 <strong>${escHTML(name)}</strong> was ${causeText}.${roleText}
      </p>`;
    });
  }

  // Pirate duel announcement
  if (morning.pirateAnnounce) {
    const target = players[morning.pirateAnnounce.targetUid]?.name || "Someone";
    content.innerHTML += `<p class="morning-item morning-item--pirate">
      🏴‍☠️ <strong>${escHTML(target)}</strong> has been challenged to a duel — it will be settled tonight.
    </p>`;
    // Mark pirate as announced
    if (isHost && game.pirate && !game.pirate.announced) {
      update(ref(db, `lobbies/${lobbyCode}/pirate`), { announced: true });
    }
  }

  // Poison announcement
  if (morning.poisonAnnounce) {
    const target = players[morning.poisonAnnounce.targetUid]?.name || "Someone";
    content.innerHTML += `<p class="morning-item morning-item--poison">
      ☠️ <strong>${escHTML(target)}</strong> has been poisoned. They will die tonight unless cured.
    </p>`;
    if (isHost && game.poison && !game.poison.revealed) {
      update(ref(db, `lobbies/${lobbyCode}/poison`), { revealed: true });
    }
  }

  // Reveal prompt for newly-dead players
  const pendingReveal = game.pendingReveal || {};
  if (pendingReveal[uid] && myPlayer && !myPlayer.alive) {
    $("reveal-choice-card").classList.remove("hidden");
  } else {
    $("reveal-choice-card").classList.add("hidden");
  }

  // Night results for Seer / Tracker
  const myResult = game.nightResults?.[uid];
  if (myResult) {
    if (myResult.type === "seer") {
      const pickedNames = (myResult.picks || [])
        .map((pid) => players[pid]?.name || "Unknown")
        .join(", ");
      content.innerHTML += `<p class="morning-item morning-item--seer">
        🔮 Seer result: among ${escHTML(pickedNames)}<br>
        → <strong>${myResult.isEvil ? "At least one is a Werewolf." : "None are Werewolves."}</strong>
      </p>`;
    }
    if (myResult.type === "track") {
      const trackedName = players[myResult.trackedUid]?.name || "Unknown";
      content.innerHTML += `<p class="morning-item morning-item--tracker">
        🐾 Tracker result: ${escHTML(trackedName)} ${myResult.didAct ? "left home last night." : "stayed home all night."}
      </p>`;
    }
    // Clear after displaying
    if (isHost)
      update(ref(db, `lobbies/${lobbyCode}/nightResults/${uid}`), null);
  }

  // Host advance — uses the single unified resolve-btn (see the resolve-btn
  // click handler dispatch, which routes to advanceToDay() during morning)
  $("resolve-btn").classList.toggle("hidden", !isHost);
  $("resolve-btn").textContent = "Skip";
}

// Role reveal buttons
$("reveal-yes-btn").addEventListener("click", () => submitRevealChoice(true));
$("reveal-no-btn").addEventListener("click", () => submitRevealChoice(false));

async function submitRevealChoice(reveal) {
  if (!uid || !lobbyCode || !cachedGame) return;
  const updates = {};
  updates[`pendingReveal/${uid}`] = null;
  if (reveal && myRole) {
    updates[`players/${uid}/revealedRole`] = myRole;
    await push(ref(db, `lobbies/${lobbyCode}/log`), {
      round: cachedGame.round,
      phase: "morning",
      text: `${cachedGame.players?.[uid]?.name} revealed their role: ${ROLE_DEFS[myRole]?.name || myRole}.`,
      ts: Date.now(),
    });
  }
  await update(ref(db, `lobbies/${lobbyCode}`), updates);
  $("reveal-choice-card").classList.add("hidden");
}

async function advanceToDay() {
  if (!isHost || !lobbyCode || !cachedGame) return;
  const game = cachedGame;
  const settings = game.settings || defaultSettings();
  const nextRound = game.round + 1;
  await update(ref(db, `lobbies/${lobbyCode}`), {
    phase: "day",
    round: nextRound,
    phaseEndsAt: Date.now() + (settings.daySeconds || 120) * 1000,
    morning: null,
    nightResults: null,
    dayVotes: null,
    revoteEligible: null,
  });
}

// Auto-advance morning after timer
function checkMorningAutoAdvance(game) {
  if (!isHost || game.phase !== "morning") return;
  if (!game.phaseEndsAt) return;
  const msLeft = game.phaseEndsAt - Date.now();
  if (msLeft <= 0) advanceToDay();
}

// ── DAY PHASE / VOTING ────────────────────────────────────────────────
function renderDay(game) {
  showScreen("game");
  renderHUD(game);

  const players = game.players || {};
  const myPlayer = players[uid];
  const alive = myPlayer?.alive !== false;
  const phase = game.phase || "day";
  const isRevote = phase === "revote";
  const silenced =
    game.silence?.targetUid === uid && game.silence.activeRound === game.round;

  $("morning-report-card").classList.add("hidden");
  $("night-action-card").classList.add("hidden");
  $("reveal-choice-card").classList.add("hidden");
  $("no-action-note").classList.add("hidden");

  // Spectator / silenced can't vote
  const canVote = alive && !silenced;
  const myVote = game.dayVotes?.[uid];

  const dayCard = $("day-vote-card");
  dayCard.classList.remove("hidden");

  $("day-vote-label").textContent = isRevote
    ? "⚖ Revote — cast your vote"
    : "☀ Cast your vote";

  // Revote note
  const revoteNote = $("revote-note");
  if (isRevote && game.revoteEligible?.length) {
    revoteNote.classList.remove("hidden");
    revoteNote.textContent =
      "Revote: choose from " +
      (game.revoteEligible || [])
        .map((id) => (id === "skip" ? "Skip" : players[id]?.name || "?"))
        .join(" or ");
  } else {
    revoteNote.classList.add("hidden");
  }

  // Build Among-Us-style voting grid
  const grid = $("day-vote-targets");
  grid.innerHTML = "";

  // In revote, only eligible candidates
  let candidates;
  if (isRevote && game.revoteEligible?.length) {
    candidates = game.revoteEligible;
  } else {
    // Full day vote: all alive players + Skip
    candidates = Object.keys(players).filter((pid) => players[pid]?.alive);
  }

  // Build player vote cards
  const dayVotes = game.dayVotes || {};

  candidates.forEach((candId) => {
    const isSkip = candId === "skip";
    const p = isSkip ? null : players[candId];
    if (!isSkip && !p) return;

    const card = document.createElement("div");
    card.className =
      "vote-card" + (myVote === candId ? " vote-card--voted" : "");

    if (!isSkip) {
      // Avatar
      const avatarEl = document.createElement("img");
      avatarEl.src = p.avatar || "img/avatars/player1.png";
      avatarEl.className = "vote-card-avatar";
      avatarEl.style.borderColor = p.colour || "#888";
      card.appendChild(avatarEl);

      // Name
      const nameEl = document.createElement("div");
      nameEl.className = "vote-card-name";
      nameEl.textContent = p.name;
      card.appendChild(nameEl);

      // Revealed role badge
      if (p.revealedRole) {
        const roleImg = document.createElement("img");
        roleImg.src = ROLE_DEFS[p.revealedRole]?.icon || "";
        roleImg.className = "vote-card-role-badge";
        roleImg.title = ROLE_DEFS[p.revealedRole]?.name || "";
        card.appendChild(roleImg);
      }

      // Vote dots (who voted for this candidate)
      const dotsEl = document.createElement("div");
      dotsEl.className = "vote-dots";
      Object.entries(dayVotes).forEach(([voter, target]) => {
        if (target !== candId) return;
        const voter_p = players[voter];
        if (!voter_p) return;
        const dot = document.createElement("div");
        dot.className = "vote-dot";
        dot.style.backgroundColor = voter_p.colour || "#888";
        dot.title = voter_p.name;
        dotsEl.appendChild(dot);
      });
      card.appendChild(dotsEl);

      // Dead players: greyed out
      if (!p.alive) card.classList.add("vote-card--dead");
    } else {
      // Skip card
      card.classList.add("vote-card--skip");
      card.innerHTML =
        '<div class="vote-card-skip-icon">⏭</div><div class="vote-card-name">Skip</div>';
      // Vote dots on skip
      const dotsEl = document.createElement("div");
      dotsEl.className = "vote-dots";
      Object.entries(dayVotes).forEach(([voter, target]) => {
        if (target !== "skip") return;
        const voter_p = players[voter];
        if (!voter_p) return;
        const dot = document.createElement("div");
        dot.className = "vote-dot";
        dot.style.backgroundColor = voter_p.colour || "#888";
        dot.title = voter_p.name;
        dotsEl.appendChild(dot);
      });
      card.appendChild(dotsEl);
    }

    // Click to vote
    if (canVote && !myVote) {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => submitVote(candId));
    }

    grid.appendChild(card);
  });

  // Silenced note
  $("no-action-note").classList.toggle("hidden", !silenced);
  if (silenced)
    $("no-action-note").textContent =
      "🔇 You are silenced — you cannot vote today.";

  // Host resolve
  $("resolve-btn").classList.toggle("hidden", !isHost);
  $("resolve-btn").textContent = "Skip";
}

async function submitVote(targetId) {
  if (!uid || !lobbyCode) return;
  await set(ref(db, `lobbies/${lobbyCode}/dayVotes/${uid}`), targetId);
}

// ── DAY RESOLUTION (HOST ONLY) ────────────────────────────────────────
async function resolveDay() {
  if (!isHost || !lobbyCode || resolvingInProgress) return;
  const game = cachedGame;
  if (!game || (game.phase !== "day" && game.phase !== "revote")) return;
  resolvingInProgress = true;

  try {
    const { players, secrets, spectatorRoles, dayVotes, round, phase } = game;
    const allRoles = secrets || spectatorRoles || {};
    const roleOf = (pid) => allRoles[pid] || "villager";
    const isRevote = phase === "revote";

    // Mayor vote weights
    const weights = {};
    Object.keys(players || {}).forEach((pid) => {
      if (roleOf(pid) === "mayor" && players[pid]?.alive) {
        const silenced =
          game.silence?.targetUid === pid && game.silence.activeRound === round;
        if (!silenced) weights[pid] = 2;
      }
    });

    const { targetUid, tie, tally } = tallyVotes(dayVotes || {}, weights);

    // Auto-default non-voters to skip
    const alivePids = Object.keys(players || {}).filter(
      (pid) => players[pid]?.alive,
    );
    const autoSkipUpdates = {};
    alivePids.forEach((pid) => {
      const silenced =
        game.silence?.targetUid === pid && game.silence.activeRound === round;
      if (!dayVotes?.[pid] && !silenced) {
        autoSkipUpdates[`dayVotes/${pid}`] = "skip";
      }
    });
    if (Object.keys(autoSkipUpdates).length) {
      await update(ref(db, `lobbies/${lobbyCode}`), autoSkipUpdates);
    }

    // Re-tally with auto-skips
    const allVotes = { ...(dayVotes || {}) };
    Object.entries(autoSkipUpdates).forEach(([path, v]) => {
      const pidPart = path.split("/")[1];
      allVotes[pidPart] = v;
    });
    const { targetUid: finalTarget, tie: finalTie } = tallyVotes(
      allVotes,
      weights,
    );

    if (finalTie || !finalTarget) {
      // Tie — trigger revote (unless this IS already the revote → random pick)
      const tied = tiedPlayers(allVotes, weights);
      if (isRevote) {
        // Random pick from tied candidates
        const choice = tied[Math.floor(Math.random() * tied.length)];
        await triggerAnimation(game, "randompick", tied, choice);
        return;
      } else {
        // Enter revote phase
        await update(ref(db, `lobbies/${lobbyCode}`), {
          phase: "revote",
          revoteEligible: tied,
          dayVotes: null,
          phaseEndsAt: Date.now() + (game.settings?.daySeconds || 120) * 500, // half day timer for revote
        });
        await push(ref(db, `lobbies/${lobbyCode}/log`), {
          round,
          phase: "day",
          text: `The vote is tied between ${tied.map((id) => (id === "skip" ? "Skip" : players[id]?.name || "?")).join(" and ")}. Revote!`,
          ts: Date.now(),
        });
        return;
      }
    }

    // Result: finalTarget won
    if (finalTarget === "skip") {
      // Skip wins — no elimination
      const updates = {
        phase: "night",
        round: round + 1,
        dayVotes: null,
        revoteEligible: null,
        phaseEndsAt: Date.now() + (game.settings?.nightSeconds || 60) * 1000,
      };
      await update(ref(db, `lobbies/${lobbyCode}`), updates);
      await push(ref(db, `lobbies/${lobbyCode}/log`), {
        round,
        phase: "day",
        text: "The town chose not to eliminate anyone today.",
        ts: Date.now(),
      });
      return;
    }

    // A player was voted out
    await eliminatePlayer(game, finalTarget, true /* voted out */);
  } finally {
    resolvingInProgress = false;
  }
}

async function eliminatePlayer(game, targetUid, wasVotedOut) {
  const { players, secrets, spectatorRoles, round, settings } = game;
  const allRoles = secrets || spectatorRoles || {};
  const roleOf = (pid) => allRoles[pid] || "villager";

  // Check Jester win FIRST (only applies to vote-outs)
  if (wasVotedOut) {
    const jesterWin = checkJesterWin(
      targetUid,
      Object.entries(players || {}).reduce((obj, [pid, p]) => {
        obj[pid] = { alive: p.alive, role: roleOf(pid) };
        return obj;
      }, {}),
    );
    if (jesterWin) {
      // Jester wins immediately
      const winResult = { primary: "jester", winners: ["jester"] };
      await update(ref(db, `lobbies/${lobbyCode}`), {
        [`players/${targetUid}/alive`]: false,
        [`players/${targetUid}/isSpectator`]: true,
        [`pendingReveal/${targetUid}`]: true,
        phase: "end",
        winner: winResult,
        dayVotes: null,
        revoteEligible: null,
      });
      const name = players[targetUid]?.name || "They";
      await push(ref(db, `lobbies/${lobbyCode}/log`), {
        round,
        phase: "day",
        text: `${name} was voted out. The Jester wins!`,
        ts: Date.now(),
      });
      return;
    }
  }

  // Kill the player
  const updatesKill = {
    [`players/${targetUid}/alive`]: false,
    [`players/${targetUid}/isSpectator`]: true,
    [`pendingReveal/${targetUid}`]: true,
    dayVotes: null,
    revoteEligible: null,
  };

  // Build updated players for win check
  const updatedPlayerMap = {};
  Object.entries(players || {}).forEach(([pid, p]) => {
    updatedPlayerMap[pid] = {
      alive: pid === targetUid ? false : p.alive,
      role: roleOf(pid),
    };
  });

  const winResult = checkWinCondition(updatedPlayerMap);

  if (winResult) {
    updatesKill.phase = "end";
    updatesKill.winner = winResult;
  } else {
    // Move to night
    updatesKill.phase = "night";
    updatesKill.round = round + 1;
    updatesKill.phaseEndsAt =
      Date.now() + (settings?.nightSeconds || 60) * 1000;
  }

  await update(ref(db, `lobbies/${lobbyCode}`), updatesKill);

  const name = players[targetUid]?.name || "Someone";
  const cause = wasVotedOut ? "voted out by the town" : "chosen by fate";
  await push(ref(db, `lobbies/${lobbyCode}/log`), {
    round,
    phase: "day",
    text: `${name} has been ${cause}.`,
    ts: Date.now(),
  });

  if (winResult) {
    const wd = winnerDisplay(winResult);
    await push(ref(db, `lobbies/${lobbyCode}/log`), {
      round,
      phase: "end",
      text: wd.label + " " + wd.sub,
      ts: Date.now(),
    });
  }
}

// ── ANIMATION (COIN TOSS / RANDOM PICK) ─────────────────────────────
async function triggerAnimation(game, type, candidates, winnerId) {
  const animData = {
    type,
    candidates,
    winnerId,
    loserUid: null,
    ts: Date.now(),
  };
  if (type === "cointoss") {
    // Handled during night resolution where we already know winner
  }
  await update(ref(db, `lobbies/${lobbyCode}`), {
    phase: "animation",
    animation: animData,
  });

  // After 3 seconds, resolve the animation result
  setTimeout(async () => {
    if (!isHost) return;
    const g = cachedGame;
    if (g?.phase !== "animation") return;

    if (type === "randompick") {
      if (winnerId === "skip") {
        // Skip won the random pick — no elimination
        await update(ref(db, `lobbies/${lobbyCode}`), {
          phase: "night",
          round: (g.round || 1) + 1,
          dayVotes: null,
          revoteEligible: null,
          animation: null,
          phaseEndsAt: Date.now() + (g.settings?.nightSeconds || 60) * 1000,
        });
        await push(ref(db, `lobbies/${lobbyCode}/log`), {
          round: g.round,
          phase: "day",
          text: "Fate decreed: no elimination today.",
          ts: Date.now(),
        });
      } else {
        await update(ref(db, `lobbies/${lobbyCode}`), { animation: null });
        await eliminatePlayer(g, winnerId, true);
      }
    }
  }, 3500);
}

function renderAnimation(game) {
  showScreen("game");
  renderHUD(game);
  const anim = game.animation || {};
  const players = game.players || {};

  $("animation-card").classList.remove("hidden");
  $("night-action-card").classList.add("hidden");
  $("day-vote-card").classList.add("hidden");
  $("morning-report-card").classList.add("hidden");

  const card = $("animation-card");
  if (anim.type === "randompick") {
    const candidateNames = (anim.candidates || [])
      .map((id) => (id === "skip" ? "Skip" : players[id]?.name || "?"))
      .join(", ");
    card.innerHTML = `
      <p class="anim-headline">⚖ The town cannot decide…</p>
      <p class="anim-sub">Fate will choose from: ${escHTML(candidateNames)}</p>
      <div class="spinner-rune">☽</div>
      ${
        anim.winnerId
          ? `<p class="anim-result">
        ${
          anim.winnerId === "skip"
            ? "No elimination — the town is spared."
            : `<strong>${escHTML(players[anim.winnerId]?.name || "?")}</strong> has been chosen.`
        }
      </p>`
          : ""
      }
    `;
  }
}

// ── END SCREEN ────────────────────────────────────────────────────────
function renderEnd(game) {
  showScreen("end");
  renderHUD(game);

  const winResult = game.winner;
  const wd = winnerDisplay(winResult);
  $("winner-label").textContent = wd.label;
  $("winner-sub").textContent = wd.sub;
  $("winner-label").className =
    "winner-label winner-label--" + (winResult?.primary || "neutral");

  const allRoles = game.secrets || game.spectatorRoles || {};
  const players = game.players || {};
  const list = $("end-role-list");
  list.innerHTML = "";

  Object.entries(players)
    .sort((a, b) => (a[1].joinOrder || 0) - (b[1].joinOrder || 0))
    .forEach(([pid, p]) => {
      const roleKey = allRoles[pid] || "villager";
      const def = ROLE_DEFS[roleKey] || ROLE_DEFS.villager;
      const row = document.createElement("div");
      row.className = "end-player-row";
      row.innerHTML = `
        <img src="${escHTML(p.avatar || "")}" class="end-avatar" style="border-color:${escHTML(p.colour || "#888")}">
        <span class="end-pname">${escHTML(p.name)}</span>
        <img src="${def.icon}" class="end-role-icon" title="${def.name}">
        <span class="end-role-name">${def.name}</span>
        ${!p.alive ? '<span class="dead-label">✝</span>' : ""}
      `;
      list.appendChild(row);
    });

  $("end-host-card").classList.toggle("hidden", !isHost);
}

$("play-again-btn").addEventListener("click", async () => {
  if (!isHost || !lobbyCode) return;
  resetBotState();
  // Reset game to lobby with same players
  const game = cachedGame;
  if (!game) return;
  const players = game.players || {};
  const resetPlayers = {};
  Object.entries(players).forEach(([pid, p]) => {
    resetPlayers[pid] = {
      ...p,
      alive: true,
      isSpectator: false,
      revealedRole: null,
      connected: true,
    };
  });
  await update(ref(db, `lobbies/${lobbyCode}`), {
    phase: "lobby",
    round: 0,
    winner: null,
    secrets: null,
    spectatorRoles: null,
    wolfPack: null,
    nightActions: null,
    wolfVotes: null,
    dayVotes: null,
    revoteEligible: null,
    abilityUsed: null,
    pendingReveal: null,
    poison: null,
    pirate: null,
    silence: null,
    morning: null,
    nightResults: null,
    seerInvestigations: null,
    animation: null,
    phaseEndsAt: null,
    paused: false,
    log: null,
    players: resetPlayers,
  });
});

// ── BOT AI CONTROLLER (host-side only) ────────────────────────────────
// Called on every lobby update while isHost is true. Schedules randomized-
// delay actions for each living bot so games can be tested without needing
// a full group of human players. Bots play at a "decent but imperfect"
// level: they use their abilities, vote, and coordinate loosely as a wolf
// pack, but have no deep suspicion-tracking or memory beyond what's cheap
// to compute here.

function randDelay(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs);
}

// Once-per-game roles get a randomly pre-planned round (1-3) at which the
// bot will use their ability, so bots don't all fire on round 1 and don't
// all wait until it's too late either.
function plannedRoundFor(botUid) {
  if (!botPlannedRound[botUid]) {
    botPlannedRound[botUid] = 1 + Math.floor(Math.random() * 3);
  }
  return botPlannedRound[botUid];
}

function runBotController(game) {
  if (!isHost || !lobbyCode || !game) return;
  const phase = game.phase;
  const round = game.round || 1;
  const players = game.players || {};
  const roles = game.spectatorRoles || game.secrets || {};

  const bots = Object.entries(players).filter(([, p]) => p.isBot && p.alive);
  if (!bots.length) return;

  if (phase === "night") {
    const silencedThisRound =
      game.silence?.activeRound === round ? game.silence.targetUid : null;

    bots.forEach(([botUid]) => {
      const key = `${round}-night-${botUid}`;
      if (botScheduled[key]) return;
      if (botUid === silencedThisRound) {
        botScheduled[key] = true;
        return;
      }

      const role = roles[botUid] || "villager";
      const def = ROLE_DEFS[role];
      const isWolf = def?.team === "werewolf";

      botScheduled[key] = true;

      if (isWolf) {
        if (!game.wolfVotes?.[botUid]) scheduleBotWolfVote(botUid, round);
        // Mage Werewolf additionally has its own silence ability
        if (role === "mageWerewolf" && !game.nightActions?.[botUid]) {
          scheduleBotSingleAction(botUid, role, round);
        }
        return;
      }

      if (!def?.night) return; // villager / mayor / jester — nothing to do at night
      if (game.nightActions?.[botUid]) return;
      scheduleBotSingleAction(botUid, role, round);
    });
  }

  if (phase === "day" || phase === "revote") {
    bots.forEach(([botUid]) => {
      const key = `${round}-${phase}-${botUid}`;
      if (botScheduled[key]) return;
      if (game.dayVotes?.[botUid]) {
        botScheduled[key] = true;
        return;
      }
      botScheduled[key] = true;
      scheduleBotVote(botUid, round, phase);
    });
  }
}

function scheduleBotWolfVote(botUid, round) {
  const delay = randDelay(2500, 7500);
  setTimeout(async () => {
    if (
      !cachedGame ||
      cachedGame.phase !== "night" ||
      cachedGame.round !== round
    )
      return;
    if (!cachedGame.players?.[botUid]?.alive) return;
    if (cachedGame.wolfVotes?.[botUid]) return;

    const players = cachedGame.players || {};
    const roles = cachedGame.spectatorRoles || cachedGame.secrets || {};
    const aliveNonWolf = Object.keys(players).filter(
      (pid) => players[pid].alive && ROLE_DEFS[roles[pid]]?.team !== "werewolf",
    );
    if (!aliveNonWolf.length) return;

    // Loose pack coordination: lean toward whatever target another wolf
    // bot already picked this round, with some chance of disagreement.
    let target = botWolfTarget[round];
    if (!target || !aliveNonWolf.includes(target) || Math.random() < 0.15) {
      target = aliveNonWolf[Math.floor(Math.random() * aliveNonWolf.length)];
      botWolfTarget[round] = target;
    }

    try {
      await set(ref(db, `lobbies/${lobbyCode}/wolfVotes/${botUid}`), target);
    } catch (err) {
      console.error("bot wolf vote failed:", err);
    }
  }, delay);
}

function scheduleBotSingleAction(botUid, role, round) {
  const def = ROLE_DEFS[role];
  const delay = randDelay(3000, 8500);

  setTimeout(async () => {
    if (
      !cachedGame ||
      cachedGame.phase !== "night" ||
      cachedGame.round !== round
    )
      return;
    if (!cachedGame.players?.[botUid]?.alive) return;
    if (cachedGame.nightActions?.[botUid]) return;
    if (def.usesPerGame === 1 && cachedGame.abilityUsed?.[botUid]) return;

    const players = cachedGame.players || {};
    const aliveIds = Object.keys(players).filter((pid) => players[pid].alive);
    const otherAlive = aliveIds.filter((pid) => pid !== botUid);
    const deadIds = Object.keys(players).filter((pid) => !players[pid].alive);
    const roles = cachedGame.spectatorRoles || cachedGame.secrets || {};

    let payload = null;

    switch (def.night?.type) {
      case "protect": {
        const pool = def.night.allowSelf ? aliveIds : otherAlive;
        if (!pool.length) return;
        const target =
          def.night.allowSelf && Math.random() < 0.25
            ? botUid
            : pool[Math.floor(Math.random() * pool.length)];
        payload = { type: "protect", target };
        break;
      }
      case "shoot": {
        if (round < plannedRoundFor(botUid) || !otherAlive.length) return;
        payload = {
          type: "shoot",
          target: otherAlive[Math.floor(Math.random() * otherAlive.length)],
        };
        break;
      }
      case "track": {
        if (round < plannedRoundFor(botUid) || !otherAlive.length) return;
        payload = {
          type: "track",
          target: otherAlive[Math.floor(Math.random() * otherAlive.length)],
        };
        break;
      }
      case "poison": {
        if (round < plannedRoundFor(botUid) || !otherAlive.length) return;
        payload = {
          type: "poison",
          target: otherAlive[Math.floor(Math.random() * otherAlive.length)],
        };
        break;
      }
      case "duel": {
        if (round < plannedRoundFor(botUid) || !otherAlive.length) return;
        payload = {
          type: "duel",
          target: otherAlive[Math.floor(Math.random() * otherAlive.length)],
        };
        break;
      }
      case "alert": {
        if (round < plannedRoundFor(botUid)) return;
        payload = { type: "alert" };
        break;
      }
      case "silence": {
        if (round < plannedRoundFor(botUid) || !otherAlive.length) return;
        payload = {
          type: "silence",
          target: otherAlive[Math.floor(Math.random() * otherAlive.length)],
        };
        break;
      }
      case "inspect4": {
        if (round < plannedRoundFor(botUid)) return;
        const pool = [...aliveIds, ...deadIds].filter((pid) => pid !== botUid);
        if (pool.length < 4) return;
        const shuffled = pool.slice().sort(() => Math.random() - 0.5);
        payload = { type: "inspect4", picks: shuffled.slice(0, 4) };
        break;
      }
      case "adopt": {
        const adoptable = deadIds.filter((pid) => {
          const r = roles[pid] || "";
          return !["poisoner", "jester", "pirate", "amnesiac"].includes(r);
        });
        if (!adoptable.length) return;
        payload = {
          type: "adopt",
          target: adoptable[Math.floor(Math.random() * adoptable.length)],
        };
        break;
      }
      default:
        return;
    }

    if (!payload) return;
    try {
      const updates = { [`nightActions/${botUid}`]: payload };
      if (def.usesPerGame === 1) updates[`abilityUsed/${botUid}`] = true;
      await update(ref(db, `lobbies/${lobbyCode}`), updates);
    } catch (err) {
      console.error("bot night action failed:", err);
    }
  }, delay);
}

function scheduleBotVote(botUid, round, phase) {
  const delay = randDelay(3000, 9000);
  setTimeout(async () => {
    if (!cachedGame || cachedGame.phase !== phase || cachedGame.round !== round)
      return;
    if (!cachedGame.players?.[botUid]?.alive) return;
    if (cachedGame.dayVotes?.[botUid]) return;

    const players = cachedGame.players || {};
    const roles = cachedGame.spectatorRoles || cachedGame.secrets || {};
    const myRoleKey = roles[botUid] || "villager";
    const isWolfBot = ROLE_DEFS[myRoleKey]?.team === "werewolf";

    let candidates;
    if (phase === "revote" && cachedGame.revoteEligible?.length) {
      candidates = cachedGame.revoteEligible.filter((id) => id !== botUid);
    } else {
      candidates = Object.keys(players).filter(
        (pid) => players[pid].alive && pid !== botUid,
      );
      candidates.push("skip");
    }
    if (!candidates.length) return;

    // Wolf-team bots avoid voting for their own pack when possible
    let pool = candidates;
    if (isWolfBot) {
      const wolfPack = cachedGame.wolfPack || {};
      const filtered = candidates.filter(
        (id) => id === "skip" || !wolfPack[id],
      );
      if (filtered.length) pool = filtered;
    }

    let target;
    if (pool.includes("skip") && Math.random() < 0.12) {
      target = "skip";
    } else {
      const realPool = pool.filter((id) => id !== "skip");
      target = realPool.length
        ? realPool[Math.floor(Math.random() * realPool.length)]
        : pool[0] || "skip";
    }

    try {
      await set(ref(db, `lobbies/${lobbyCode}/dayVotes/${botUid}`), target);
    } catch (err) {
      console.error("bot day vote failed:", err);
    }
  }, delay);
}

// ── MAIN RENDER DISPATCH ──────────────────────────────────────────────
function renderGame(game) {
  if (!game) return;
  const phase = game.phase || "lobby";

  // Always update HUD
  renderHUD(game);
  // Always sync settings panel if open
  if (!$("settings-modal").classList.contains("hidden")) {
    buildSettingsPanel(game);
  }

  // Check morning auto-advance timer
  if (phase === "morning") checkMorningAutoAdvance(game);

  switch (phase) {
    case "lobby":
      renderWaiting(game);
      break;
    case "night":
      renderNight(game);
      break;
    case "morning":
      renderMorning(game);
      break;
    case "day":
    case "revote":
      renderDay(game);
      break;
    case "animation":
      renderAnimation(game);
      break;
    case "end":
      renderEnd(game);
      break;
  }
}

// ── LOG HELPERS ───────────────────────────────────────────────────────
async function addLog(phase, text) {
  if (!lobbyCode || !cachedGame) return;
  await push(ref(db, `lobbies/${lobbyCode}/log`), {
    round: cachedGame.round || 0,
    phase,
    text,
    ts: Date.now(),
  });
}

// ── BOOT ───────────────────────────────────────────────────────────────────
function setAuthStatus(ready, errMsg) {
  const overlay = $("auth-overlay");
  if (overlay) overlay.classList.toggle("hidden", ready);
  [$("create-lobby-btn"), $("join-lobby-btn")].forEach((btn) => {
    if (btn) btn.disabled = !ready;
  });
  if (errMsg) {
    const errEl = $("landing-error");
    if (errEl) {
      errEl.textContent = errMsg;
      errEl.classList.remove("hidden");
    }
  }
}

// Disable buttons while auth initialises
setAuthStatus(false);

// Safety net: if auth takes longer than 6 seconds, re-enable buttons
const authTimeout = setTimeout(() => {
  if (!uid) {
    console.warn(
      "Auth timed out after 6s — check firebase-config.js for REPLACE_ME placeholders",
    );
    setAuthStatus(
      true,
      "Connection timed out. Your firebase-config.js likely still has REPLACE_ME placeholder values — replace them with your real Firebase project config.",
    );
  }
}, 6000);

onAuthStateChanged(auth, (user) => {
  if (user) {
    uid = user.uid;
    clearTimeout(authTimeout);
    setAuthStatus(true);
    const urlCode = urlMatch?.[1];
    if (urlCode) {
      $("join-code-input").value = urlCode.toUpperCase();
    }
  }
});

signInAnonymously(auth).catch((err) => {
  clearTimeout(authTimeout);
  console.error("Firebase auth error:", err.code, err.message);
  let msg;
  if (err.code === "auth/operation-not-allowed") {
    msg =
      "Anonymous sign-in is disabled — go to Firebase Console → Authentication → Sign-in method → Anonymous and enable it.";
  } else if (
    err.code === "auth/invalid-api-key" ||
    err.code === "auth/invalid-credential"
  ) {
    msg =
      "Invalid Firebase API key — firebase-config.js still has REPLACE_ME placeholder values. Replace them with your real project config.";
  } else if (err.code === "auth/network-request-failed") {
    msg = "Network error reaching Firebase — check your internet connection.";
  } else {
    msg =
      "Firebase auth failed (" +
      (err.code || err.message) +
      "). Check firebase-config.js and open the browser Console (F12) for details.";
  }
  setAuthStatus(true, msg);
});

showScreen("landing");
