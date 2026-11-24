# Lanternhold handoff (24 Nov 2026)

This handoff stands on its own for the new Lanternhold project. It is current as of **v112**, live at https://lanternhold.born2gamellc.com.

## Where the code lives

**`johnmink1/pricing-tools`** is the source of truth. Edit only here.

| Path | What it is |
|---|---|
| `lanternhold/core.js` | All game rules: classes, foes, loot, crafting, events, the `api` export list. Any new function must be added to that big export list at the bottom. |
| `lanternhold/ui.js` | All UI, the in-game Delver's Guide (`GUIDE`) and `PATCH_NOTES` (newest first). The next version is **v113**. |
| `lanternhold/style.css`, `index.html` | Styles and markup. |
| `lanternhold/vector.js` | Illustrated SVG sprites (`ART.enchanter`, `ART.armorer`, classes, foes). |
| `lanternhold/sprites.js` | Pixel fallback sprites and `itemIcon`. |
| `lanternhold/intro.js`, `music.js` | Intro story and the soundtrack player. |
| `lanternhold/stamp.py` | Writes a new build number into `version.json` and the asset query strings. Run it before every release. |
| `lanternhold-wiki/build.js` | Generates the public wiki (`/wiki`) from the game files. Never hand-edit the wiki. Check with `node lanternhold-wiki/build.js` and then `rm -rf out`. |
| `lanternhold-music/` | The music renderer. |
| `infra/lanternhold-accounts.yaml` | CloudFormation stack `lanternhold` in us-east-1. It holds Cognito, DynamoDB, the HTTP API and the inline Lambdas. |
| `infra/lambda/*.js` | Lambda sources: heroes, market, mail, admin, profile, warden, exchange, store, perks, authchal, wixlogin, invite, worldboss, looks, reset, loot. `python3 infra/build.py` minifies them into the YAML. The inline limit is 4 KB each. |
| `infra/chat`, `infra/ring` | Chat and Ember Ring (PvP) server code. |

**`johnmink1/lanternhold`** is only the GitHub Pages mirror. Its `deploy.yml` copies `lanternhold/` from pricing-tools and builds the wiki. It runs every ~10 minutes, or on demand.

## How to release

1. Run `git fetch origin main && git checkout -B claude/lanternhold-vNNN origin/main`.
2. Make the edits and add a `PATCH_NOTES` entry in ui.js. You can skip the patch note for admin-only changes.
3. Run `python3 lanternhold/stamp.py`.
4. Test locally:
   - Start a server with `cd lanternhold && python3 -m http.server 8777`.
   - Test with Playwright on desktop (1280x800) and iPhone 13.
   - Use floor 51 for tests, because floor 50 is a boss floor.
   - `window.LHDebug = { S, save, L, events }` is available in the page. `migrate()` resets `s.foe` on load, so inject foes through `LHDebug.S`, not through the save.
5. Open a PR into `main` and squash-merge it. Threads merge their own PRs.
6. Publish by running `deploy.yml` on `johnmink1/lanternhold` with workflow_dispatch, ref `main`.
   - Sometimes it needs a second trigger.
   - `.github/workflows/lanternhold-publish.yml` in pricing-tools tries to start it automatically, but the `LANTERNHOLD_DEPLOY_TOKEN` secret has not worked.
7. Verify by fetching `https://lanternhold.born2gamellc.com/version.json?t=<now>` and matching the build number.

House rules:
- Family-friendly content.
- Never show a bare "Level": say "power level" (training) or "hero level" (XP).
- Track every change against a before-baseline and report whether it helped.
- Lanternhold stays **off the store Discord**: the bot's LANTERNHOLD_DISCORD switch is off. John plans a separate Lanternhold Discord.

## AWS

Everything is in account 500041422762, region us-east-1. The CloudFormation stack is named `lanternhold`, functions are named `lanternhold-<name>`, and the trade table is `lanternhold-trade`.

There is no working AWS CLI. The cloud container's keys are invalid, and VENGEANCE has no CLI. Deploy server code through **AWS CloudShell** in John's Brave, once John has signed in to the console:
- Write files with `echo <base64> | base64 -d > file`.
- Then `aws lambda update-function-code`.
- A later stack update from `main` carries the same code.

**Admins** are members of the Cognito group `admins`.
- The Admin tab in the game shows only for them, using the `cognito:groups` claim. It has players, ban/unban, Sigil grants, resets, server wipe, Grand War link approvals and the audit log.
- `infra/lambda/admin.js` gates the server side.

**Lantern Keeper:** `/leaderboard` returns `keeper` when an admin's hero was seen in the last 3 minutes. Keepers get +25%, and a small lantern shows top-right in the arena.
- This was deployed 24 Nov by John via CloudShell: the Lambda code plus an inline policy `lanternhold-keeper` on the admin role.

**Sigil store:**
- Purchases credit only when the game calls `POST /store/sync` (`store.js`) with the buyer's Wix member token. There is no webhook.
- Don't hand-grant a purchase with `/admin/grant`, because a later sync would credit it again.
- Sync logs are in CloudWatch under `/aws/lambda/lanternhold-store`.

**Lanternholder** costs 500 Sigils for 30 days, or $4.99/month.

## Live as of v105

- **v86–v91:** mana and stamina, wearer-only enchants, Ghost Lantern, status effects (burn, poison, stun, disarm), mastery XP, shielded foes, wandering merchant, bounty board, Lantern Keeper.
- **v92–v98:** XP bar tooltip, Keeper lantern, ambushes at 6% (×2 XP per creature), XP in the fight log, Lanternholder rename, Sigil shop.
- **v100:** XP for enchanting (8 × tier) and merging (6 × result; half on a failure).
  - Mercy Corps encounters, floor 5+, active play only:
    - **Rescue:** a monster holds a companion; freeing them gives +30% XP for 15 minutes.
    - **Wounded:** healers heal the companion to full within 45 seconds, for +15% damage and healing for 15 minutes.
  - About 1–1.5 of each per 4 hours.
- **v101:** **Admin event spawner** in the Admin tab, under "Test random events". It has one button each for:
  - Loot Goblin, Ghost Lantern, merchant, shielded foe, ambush, alliance elite, chest, Mercy rescue, Mercy wounded.
  - Any special attack, picked from a dropdown.

  It only changes the admin's own save. It uses core `spawnEvent(s, kind, now, rng, events, sp)` and `SPAWN_EVENTS`.
- **v102:** the Hold's tents (John: "just deploy what you think is best"):
  - **Shops at battle scale.** The party stands at its fight positions, and the shopkeeper stands where a monster would, at monster scale, behind a counter with a sign. The tabs in the counter panel are the only controls. The v99 speech bubble is gone.
  - **The Armorer (new):**
    - Upgrade: gold, one level at a time.
    - Merge: pick an item, then a copy, then confirm with the odds.
    - Scrap for gold: `smelt` pays 2× the scrap gold and gives no Dust.
    - The header button switches between the Enchanter and the Armorer.
    - Core uses `visitEnchanter(s, now, kind)` and `s.shopK`. Neither `enchAt` nor `shopK` is ever saved.
  - **Camp card ("In the Deep"):** one big Return to camp button, then a row with Enchanter, Armorer, Store and Draught.
  - **The Hold view:** tapping The Hold on the Map of the Deep opens a scene with four tents (Campfire, Enchanter, Armorer, Store). Each tent takes you there.

- **v103:** fix for John's report "did you get rid of the things?". Visiting a shop from the main camp showed the campfire scene, because `render()` checked `resting` before `visiting`. Now the shop visit wins.
- **v104:** Return to camp, Descend, a Draught, or any floor travel now ends a shop visit. Core `gotoFloor` and `useDraught` clear `enchAt` and `shopK`. Before this, John had to press Leave first.

- **v105: world boss Legendary loot** (John: a chance of a Legendary, drawn by lottery among everyone who fought, one ticket per rounded point of damage; a set per boss; boss shards upgrade them and trade on the market).
  - Server: `infra/lambda/loot.js` (function `lanternhold-loot`). `POST /boss/loot {id}` runs a seeded draw once the event has ended (seed = event id, so every claim agrees). Tickets = max(1, floor(boss score)). Legendary chance = min(75%, 12% × phases broken); shards = 5 + 3 × min(phases, 10), each its own draw. A claim is recorded once (`lc` on the boss row).
  - Shard market on the same Lambda: `GET /shards` (`?mine=1`), `POST /shards/list|buy|cancel`. Listings live in the trade table under `sh#` / `ss#<seller>`; a sale sends a `sale` letter with the gold to the seller's mailbox.
  - Core: rarity `legend`, `WB_SETS` (Colossus = hp, Sovereign = dps, Nyxmaw = heal, Leviathan = gold), 4 pieces each (main, chest/robe, ring, neck), 2-piece +15% (gold +25%), 4-piece +30% damage and health. Legendaries are bound, can't be merged, and upgrade with that boss's shards (`s.shards[boss]`, cost = next level) instead of gold. `makeLegend` caps item level so the winner can wear it.
  - UI: `lootBoss(id)` runs after the Sigil claim; Market > Boss shards view; set block in the item window. `LHDebug.lootBoss` exists for tests.
  - **The stack update for this Lambda must be deployed through CloudShell.** Until it is, the game says "The shard stall opens soon." and loot claims retry later.
  - Also in v105: the Enchanter and Armorer scenes scale to the arena (`shopGeo()`: a 198 × 74 focus box fills the arena, the room grows around it; v106 shrank it from 100 so short, wide panels keep big sprites).
  - v107: the Store is a visited shop too (`S.shopK = 'store'`, keeper sprite `ART.quartermaster` "Old Thessaly", plank-wall room in `buildShop`). Its panel is `storePanelHtml()` with `SW.mode` tabs Tonics/Supplies; `openStore()` falls back to the old `openStoreModal()` when there is no hero. Each shop header (`.shophead .shopbtns`) has swap buttons to the other two shops.
  - v108 Victor's Banner (John, 24 Nov 2026): heroes whose banner matches the last crowned Grand War season's Nexus holder get `WARWIN_FX` (+8% dps/hp/heal/gold, via `sidePerk`) and revive in `WARWIN_REVIVE` (10 s) through `reviveMs(s)`. The game reads `https://war.born2gamellc.com/api/nexus.json` (bot repo `koprulu/web.py` `build_nexus`, any-origin CORS, PR #217) every 15 min into `S.warWin = {side, season}`; `WAR_KEY` maps the war's `ascendancy` to the game's `radiant`. Nulls until Season 1 is crowned. It goes by in-game banner, not the verified commander link. Line `#winline` under Banner kin.
  - v109 Bestiary mastery (John, 24 Nov 2026): kills per Bestiary kind in `s.bk` (key `beastKey(foe)` = 'boss' or 'foe_'+sprite, packs count each foe, world boss/wounded excluded); `beastTier` = floor(n/`BEAST_STEP` 500), max `BEAST_MAX` 10, +`BEAST_PER` 1% each to damage (in `damageFoe` mult) and hero XP (`gainXp`, plus an `xpBonus` part for the current foe). Event 'beast' toasts each step; Journal Bestiary pages show `beastBar`. Full screen: `#btn-full` + Settings button, `toggleFull()`, `body.isfull` widens `#app` to 1840px; the button always shows (v110 added `.fit5`, which narrows the icon buttons) except where the Fullscreen API is missing (iPhone Safari). v111: if the browser grants fullscreen but keeps the window size (seen in John's Brave while Claude in Chrome controls it), a toast says to press F11. v112: `body.isfull` (wide layout) is set by `paintWide()` from the real window size (fills ≥95% of the screen and ≥1500 px wide), so F11 gets it and fake full screen never does; `#app` max is min(1840px,100%), body has overflow-x:clip, and a ResizeObserver on the arena re-runs `resize()` whenever it changes size.

## Open asks and things to watch

- **John's verdict on v102.** He rejected the v98 and v99 shop screens ("horrible", "hard to follow"). v102 follows mockup Option A, the Hold view, and In the Deep option 2.
  - The mockups are in the old project folder `lanternhold/mockups-shops/`: `option-A-tabs-in-counter.png`, `option-B-board-above-shopkeeper.png`, `hold-view-on-map.png`, `in-the-deep-card.png`.
  - If he wants Option B instead, put a wooden action board above the shopkeeper on the canvas and leave the panel with just the list.
- **Should upgrade and merge move to the Armorer only?** They still also work from the Gear tab's item window, which needs a camp. Enchanting already works only at the Enchanter.
- The Hold view has no walking animation yet. Tapping a tent opens that place straight away.
- **Feedback to collect from John:**
  - Ghost Lantern frequency, stun annoyance, and whether healers run out of mana.
  - Ambush frequency and the gold it gives.
  - Mercy Corps rarity.
  - The shop feel.
- The `LANTERNHOLD_DEPLOY_TOKEN` secret, so deploys start on merge.
- A separate Lanternhold Discord, which John will set up later.
- itch.io page: born2gamellc.itch.io/lanternhold. John is signed in in Brave, and the upload is a small wrapper zip that plays the live site.
