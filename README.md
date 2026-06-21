# Werewolf — a free, no-install Mafia-style party game

Players join with a link or a 5-character code, no app install, no account,
no cost. Works in iOS Safari and Android Chrome.

- **Frontend:** plain HTML/CSS/JS, hosted free on GitHub Pages
- **Backend:** Firebase Realtime Database (free Spark plan) for live sync,
  plus Firebase Anonymous Auth so each player has a stable identity without
  signing up for anything
- **Roles:** Villager, Mafia, Detective, Doctor, Jester, Mayor
- **Phases:** Night/Day with a countdown timer **and** a host override
  ("Resolve now") for either one

There is no server you manage. The host's browser tab does the job of
resolving each phase (counting votes, picking a kill target, checking
win conditions) and writes the result to Firebase; everyone else's tab
just reacts to what's in the database.

---

## 1. Create your Firebase project (5 minutes)

1. Go to **https://console.firebase.google.com** and sign in with any
   Google account.
2. Click **Add project**. Give it any name (e.g. `werewolf-mafia`). You can
   disable Google Analytics for this project — you don't need it.
3. Once the project is created, you'll land on the project overview page.
4. Click the **web icon (`</>`)** to register a web app. Give it a nickname
   (e.g. `werewolf-web`). You do **not** need Firebase Hosting — GitHub Pages
   is handling that.
5. Firebase will show you a `firebaseConfig` object that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "werewolf-mafia.firebaseapp.com",
     databaseURL: "...",
     projectId: "werewolf-mafia",
     storageBucket: "werewolf-mafia.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

   Keep this tab open — you'll paste these values in step 3 below.

   > These values are not secret. They identify your project, the way a
   > URL does. Actual access control is handled by the security rules
   > you'll paste in step 4.

## 2. Turn on the two Firebase features this game uses

1. In the left sidebar, go to **Build → Realtime Database**.
   - Click **Create database**.
   - Pick any region close to you.
   - Start in **locked mode** (you'll paste real rules in step 4 anyway).
2. In the left sidebar, go to **Build → Authentication**.
   - Click **Get started**.
   - Under **Sign-in method**, enable **Anonymous**.
   - This is what gives each player a private, stable ID without making
     them create an account — it's how the game keeps roles secret.

## 3. Add your config to the code

Open `js/firebase-config.js` in this project and replace the placeholder
values with the real ones from step 1:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "werewolf-mafia.firebaseapp.com",
  databaseURL: "https://werewolf-mafia-default-rtdb.firebaseio.com",
  projectId: "werewolf-mafia",
  storageBucket: "werewolf-mafia.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

## 4. Apply the security rules

These rules keep each player's role, the Mafia's private chat-target list,
and the Detective's results hidden from everyone except the right person
(and the host, who needs to see everything to resolve phases).

1. In Firebase Console, go to **Realtime Database → Rules**.
2. Delete what's there and paste in the entire contents of
   `database.rules.json` from this project.
3. Click **Publish**.

> **Honest caveat:** because this game has no backend server (by design —
> that's what keeps it free), the host's *browser* is the authority that
> resolves each round. Someone determined enough to read raw network
> traffic with developer tools could theoretically peek at data they're
> not supposed to see. These rules block the casual/UI-level cheating
> that matters for a living-room party game; they aren't a substitute
> for a real server if you ever needed bulletproof secrecy.

## 5. Put it on GitHub Pages (free hosting) — using VS Code

You don't need git or the command line for any of this — VS Code has a
built-in "Publish to GitHub" button.

1. Unzip this project into a folder, e.g. `werewolf-game`.
2. In VS Code: **File → Open Folder…** and select that folder.
3. Click the **Source Control** icon in the left sidebar (it looks like a
   branching line — third or fourth icon down).
4. You'll see a button called **Publish to GitHub**. Click it.
   - The first time, VS Code will ask you to sign in to GitHub — click
     through and authorize it.
   - Choose **Publish to GitHub public repository**.
   - Name it `werewolf` (or whatever you like).
5. VS Code uploads every file for you and opens the new repo on
   GitHub.com automatically. That's the whole "upload" step done.
6. On GitHub.com, go to your new repo → **Settings → Pages**.
7. Under **Build and deployment → Source**, choose **Deploy from a
   branch**, branch `main`, folder `/ (root)`. Click **Save**.
8. After a minute or two, GitHub will show you a live URL like:

   `https://yourusername.github.io/werewolf/`

   That's it — no servers to maintain, no build step. Whenever you want
   to make a change later, edit the file in VS Code, then use the
   Source Control panel to **Commit** and **Sync/Push** — GitHub Pages
   redeploys automatically within a minute or two.

> **Want to preview it before publishing?** Opening `index.html` by
> double-clicking it will show you the visual design, but the game
> logic won't work (browsers block that for local files — see the
> note below). For a working local preview, install the **Live Server**
> extension in VS Code, right-click `index.html`, and choose **Open
> with Live Server**. No terminal needed.

### Why there's a `404.html` file

Lobby links look like `https://yourusername.github.io/werewolf/lobby/K7X92`.
GitHub Pages only knows about real files, so a direct visit to that URL
(or a page refresh) would normally hit a real 404. `404.html` quietly
redirects that request back to `index.html`, which then restores the
pretty URL in the address bar. You don't need to do anything — it's
already wired up — just don't delete or rename the file.

## 6. Install it like an app (optional, but nice)

This project includes a web app manifest and icons, so players can add
it to their home screen and open it like a normal app — no App Store,
no install size, just a shortcut that skips the browser address bar.

- **iOS (Safari):** open the site → tap the **Share** icon → **Add to
  Home Screen**.
- **Android (Chrome):** open the site → tap the **⋮** menu → **Add to
  Home Screen** / **Install app** (Chrome sometimes offers this
  automatically via a banner).

Each player only needs to do this once. After that, tapping the icon
opens the game directly — though for a brand-new game they'll still need
the fresh lobby link or code from whoever hosts that round, since the
icon just opens the landing page.

## 7. Play

1. Open your GitHub Pages URL.
2. **Create lobby** → you'll land on `/lobby/K7X92`.
3. Share that link (or just the code) with friends. They open the link
   on their own phone, type a name, and tap **Join lobby**.
4. As host, set how many Mafia and which special roles you want, set
   the night/day timer lengths, then **Start game**.
5. Each phase ends automatically when the timer hits zero, or the host
   can tap **Resolve now** to end it early.

---

## How the game data is organized in Firebase

```
lobbies/
  K7X92/
    hostId           — uid of the player who created the lobby
    phase            — "lobby" | "night" | "day" | "ended"
    round            — current round number
    phaseEndsAt      — timestamp the current phase auto-resolves at
    settings         — role counts + timer lengths, host-editable
    players/{uid}    — name, alive/dead, isHost, mayorRevealed
    secretRoles/{uid}— each player's role (readable only by them + host)
    mafiaTeam/{uid}  — which uids are Mafia (readable only by Mafia + host)
    nightActions/{round}/  — mafia kill votes, doctor/detective targets
    votes/{round}/{uid}    — day-phase elimination votes (public/live)
    private/{uid}    — e.g. the Detective's investigation results
    publicReveal/{uid}— every role, written once the game ends
    log/             — the public "what's happening" feed
```

## Customizing

- **Adding a new role:** add one entry to `js/roles.js` → `ROLE_DEFS`. If it
  fits one of these patterns, everything else — the Hunt Rules toggle, role
  assignment, the night-action UI, resolution, vote weighting, and the
  Roles reference popup — works automatically, no other file needs to change:
  - `night: { type: 'kill' | 'protect' | 'investigate', prompt, allowSelf, groupVote }`
    — a "choose one player" night action. `groupVote:true` is for
    Mafia-style shared kills where everyone with the role votes together.
  - `optional: true` — shows up as an on/off toggle in Hunt Rules.
  - `revealable: true, voteWeight: N` — adds a "reveal yourself" button
    that doubles (or *N*-tuples) that player's vote once used.
  - `winsIfVotedOut: true` — wins alone immediately if voted out, like
    a Jester.

  A role with a genuinely new mechanic (something that triggers on death,
  a limited number of uses, linking two players together, etc.) still
  needs real code in `app.js` — no data schema can predict a mechanic it
  doesn't know about. But most of the common "extra" roles people add to
  Mafia variants (Bodyguard, Vigilante, a second investigator, Tanner-style
  alternate win conditions) fit the patterns above as-is.

  One current limitation worth knowing: if you ever enable **two**
  `night: { type: 'kill' }` roles in the same game (say, Mafia *and* a
  Vigilante), only one kill lands per night — whichever role happens to
  resolve last internally, not both. Supporting simultaneous kills from
  multiple roles is a small follow-up to `resolveNightActions()` in
  `js/roles.js` if you need it; it just isn't built yet.
- **Role text/icons:** `js/roles.js` → `ROLE_DEFS`
- **Default role counts & timers:** `js/roles.js` → `defaultSettings()`
- **Look and feel:** `css/style.css` (colors are CSS variables at the top)
- **Minimum player count / role-count guardrails:**
  `js/roles.js` → `validateSettings()`
- **Background art (moon / treeline):** `img/moon.png` and `img/treeline.png`,
  applied via `.app-shell::before` / `::after` in `css/style.css`. Swap in
  your own transparent PNGs of the same rough size to change the look.

## Firebase free tier, in plain terms

The Spark (free) plan's Realtime Database includes 1 GB stored and 10 GB
of monthly data transfer, no credit card required. A round of Mafia uses
a few KB. Casual use among friends won't come close to the limit.

## Troubleshooting

**"Access to script... blocked by CORS policy" in the browser console
when I open `index.html` directly.** This is expected, not a bug. The
game's code is written as JavaScript modules (`import`/`export`), and
browsers refuse to load modules from a `file://` path for security
reasons. It only happens when opening the file straight off your
computer — once it's on GitHub Pages (real `https://`), this error
won't occur. Use the **Live Server** VS Code extension if you want a
working local preview before publishing.

**What are the `icons/` folder and `manifest.json` for?** They're what
makes "Add to Home Screen" (see step 6) show a proper app icon and name
instead of a generic browser bookmark icon. You can ignore them — just
don't delete them, or the install-as-app feature stops working.
