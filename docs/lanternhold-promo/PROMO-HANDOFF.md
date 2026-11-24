# Lanternhold promotion handoff (24 Nov 2026)

Moved from the Born 2 Game project thread "Promote Lanternhold game on social media" when Lanternhold got its own project.
Everything the promo work produced is in this folder: `images/` (finished art) and `source/` (re-render with `node render.js` / `node rsign.js`; needs Playwright + Chromium).

## Status at handoff

| Item | Status |
|---|---|
| Facebook post | **Posted** 23 Nov 2026 5:49 PM ET, square image. https://www.facebook.com/100755455185182_1623371723136507 |
| Instagram post | **Posted** 23 Nov 2026 5:49 PM ET, square image. https://www.instagram.com/p/DgGfZ3DFzMJ/ |
| Discord store-wide promo | **Not posted, by John's choice** ("dont post the discord one"). Was queued in born2game-bot PR #199 and removed in PR #200 before its slot. A #war-front launch post (bot, 23 Nov 08:10 ET) and #lanternhold-guide/#lanternhold-chat wiki posts already exist. |
| IG/FB Story | Not posted. Image ready (`images/lanternhold-story.png`); Stories can't go through the Wix API, so post by hand with a link sticker to `https://lanternhold.born2gamellc.com/?ref=story`. |
| itch.io description | Approved by John (24 Nov: "update any information like the dev log and everything here: https://itch.io/dashboard"). **Not yet done**: Claude's built-in browser on John's PC hit itch's Cloudflare "Verify you are human" check and is not signed in to the itch account (born2gamellc). John was asked to tick the check and sign in there; then apply the edits below. |
| itch.io devlog | Drafted below. **Needs John's OK before publishing.** |
| More places to list the game | Ranked list + drafts below. **Awaiting John's picks** (nothing listed yet). |
| In-store QR sign | Made: `images/lanternhold-qr-sign-5x7.pdf` (5x7 in, QR to `?ref=store`). Not printed yet. |
| Results tracking | Day-3/day-7 check was scheduled in the old thread and has been cancelled; redo it here. |

**How FB/IG posts were made:** Wix Social Media Marketing API, `POST https://www.wixapis.com/social-publisher/v1/publish` on site `ecac49db-e491-426a-a292-00abaf698ccd`, channels FACEBOOK (accountId 10164379237635374, page 100755455185182) and INSTAGRAM (accountId 17841444373615150), consumerInfo name `b2g-bot`, one `imageUrl` per post (Wix media URL; Instagram needs JPEG). Same body shape as born2game-bot `eventlistings.py`. Image used: https://static.wixstatic.com/media/66be25_7d1c51e9bb4247b49edcb78c014369ca~mv2.jpg. Public copies of all four images: `https://war.born2gamellc.com/static/promo/lanternhold-{square,portrait,story,wide}.jpg` (born2game-bot `koprulu/static/promo/`).

**Tracking baseline:** 7 signed-in heroes on the leaderboard (`https://war.born2gamellc.com/api/lanternhold.json`, field `total`), deepest floor 135, read 23 Nov 2026 ~5:40 PM ET, just before the posts. John's standing rule: track every change against a before-baseline and report whether it helped.
**Attribution gap:** every promo link carries `?ref=<place>`, but the game does not read or log `ref` (checked core.js/ui.js on 23 Nov), and GitHub Pages has no analytics, so per-channel results can't be measured yet. Suggested fix: record `ref` on a player's first visit and include it with the account/leaderboard data.
**Test hero:** a guest hero "Lampwright" (Tank, Mercy Corps) was created in the built-in browser on John's PC for screenshots.

House rules for anything public: no religion, politics or firearms; family-friendly, community-first, veteran-owned voice; store phone (540) 701-7370; never post without John's approval of that specific post.

---

## Posted text (for reference)

### Facebook (posted)
🏮 We made a game! Meet Lanternhold, Born 2 Game's own free dungeon crawler.

Deep under a fortress in the Shattered Reach, one lantern holds back the dark. Your job is to keep it lit.

⚔️ Pick your hero: Tank, Healer, Rogue, Mage or Necromancer
🧭 Build a party of five and march into the Deep, floor by floor
🤝 Recruit other players' heroes, and earn gold when they recruit yours
🐉 Take on guardians, ambushes and a world boss the whole community fights together
⏳ Your party keeps going while you're away, so check in whenever you like

It's free and plays right in your browser on your phone or PC. Nothing to download.
👉 Play now: https://lanternhold.born2gamellc.com/?ref=facebook

Tell us how deep you got next time you're in the store! Questions, bugs or ideas? Join the Lanternhold channels on our Discord.

Born 2 Game · 1372 Old Bridge Rd, Woodbridge · (540) 701-7370

\#Lanternhold #Born2Game #WoodbridgeVA #DungeonCrawler #IdleGame #FreeGame

### Instagram (posted; caption differs from the draft: the URL is written out because the Linktree has no Lanternhold button yet)

🏮 We made a game! Meet Lanternhold, Born 2 Game's free dungeon crawler.

One lantern holds back the dark. Five heroes keep it lit. 🔥

⚔️ Tank, Healer, Rogue, Mage or Necromancer
🧭 March your party into the Deep, floor by floor
🤝 Team up with other players' heroes
🐉 Guardians, ambushes and a community world boss
⏳ Keeps playing while you're away

Free in your browser on phone or PC. Play at lanternhold.born2gamellc.com 🎮

\#Lanternhold #Born2Game #WoodbridgeVA #NoVA #DungeonCrawler #IdleGame #FreeGame #IndieGame #FantasyGame #GameStore

### Discord store-wide draft (NOT posted, John said no)
🏮 **Have you tried Lanternhold yet?**

It's our own free dungeon crawler, set in the same Shattered Reach as the Grand War. Pick a hero, build a party of five and march into the Deep. Your party keeps fighting while you're away, so it's easy to check in between rounds.

⚔️ Five classes: Tank, Healer, Rogue, Mage and Necromancer
🤝 Recruit other members' heroes from the Players Guild (and earn gold when they recruit yours)
🐉 Guardians, ambushes and a world boss we all fight together
🛡️ Fly your alliance banner. Your floors count toward the Lantern Deep front of the war

Free in your browser on PC or phone:
👉 https://lanternhold.born2gamellc.com/?ref=discord

New here? #lanternhold-guide has the how-to, and the full wiki is at https://lanternhold.born2gamellc.com/wiki/. Bugs go in #lanternhold-bugs, ideas in #lanternhold-ideas.

---

## itch.io: full description (23 Nov version, written by an earlier thread)

Paste into Edit game → Description at https://itch.io/dashboard (born2gamellc → Lanternhold), then apply the 24 Nov changes in the next section.

Beneath a forgotten fortress, a single lantern keeps a tear in the Nyx Rift shut. Every alliance in the Grand War wants what lies under it. Pick a hero, pledge a banner and carry the lantern down.

Lanternhold is an idle game that plays like a small party RPG. Your party fights on its own, even while you're away, but the fights are real. Monsters hit back, the tank has to hold their attention, the healer has to keep up, and marching order matters.

### Why we fight

Lanternhold is free to play, made by Born 2 Game, LLC, a veteran-owned game store in Woodbridge, Virginia. Once the costs of running and developing the game are covered, the proceeds go to our Mercy Corps giving:

• Children's Miracle Network: care for kids in children's hospitals
• Food pantries: meals for neighbors who need them
• Local schools: the schools in our community we support

Every hero who joins, every Sigil and every pass helps keep that going. The game opens with a short "Why we fight" story, and you can replay it from Settings.

### What's in it

• Five classes: Tank, Healer, Rogue, Mage and Necromancer, each with a skill tree and its own abilities
• 150 floors across 15 regions, guardian bosses and a story told in chapters, with companions who join along the way
• Your hero levels up and opens new parts of the game as you go: gear, the campfire, camp jobs, the Players Guild, the Ember Ring and rekindling
• Loot with rarities, class gear, item sets and a four-piece set for every region. Lock, merge, enchant and scrap your gear
• Companions with traits that reward smart marching order, and a campfire roster to manage
• The Ember Ring: PvP duels between players' heroes, with class counters, Ring skills and standings
• World boss weekends, where every signed-in player fights one shared Rift boss together
• The Loot Goblin, ambushes, elite warbands and region mastery goals
• Players Guild invites, chat with whispers, a player market and mail
• An original eight-track soundtrack with an in-game music player
• The Wardrobe: outfits, lantern styles and war banners. Looks only
• Progress while you're away, and cloud saves across devices. An account is optional

### Fair by design

Lanternhold is free. The optional store sells looks and convenience items like extra bag space and speed-ups. Nothing you can buy makes your party stronger, and Sigils can be earned in play. When anyone buys a Sigil pack, every player gets a Lantern Surge: +25% gold and XP for a while.

### Part of the Grand War

Lanternhold is a side front of Born 2 Game's Grand War. Your hero flies one of five banners (Iron Covenant, Radiant Ascendancy, Devouring Tide, Mercy Corps or Unsworn), and how deep each alliance delves shows on the war map at war.born2gamellc.com. Act One runs through Season 1 of the Grand War. Act Two opens on January 25, 2027.

### Play and talk

Prefer a bigger window? Play full screen at lanternhold.born2gamellc.com. Your hero is the same on both.

The full player wiki, with every class, skill tree, region, monster and set: lanternhold.born2gamellc.com/wiki

Join the Grand War Discord for player chat, bug reports and ideas: discord.gg/6G7E7rhGFu. Feedback is read and credited in the patch notes.

Made by Born 2 Game, LLC.

---

## itch.io: devlog draft (24 Nov, covers game v69–v93, NEEDS JOHN'S OK)

**Title:** Lanternhold update: mana, status effects, bounties and the wandering merchant

**Short summary (itch "summary" field):** Mana and stamina, stuns and disarms, shielded foes, the Ghost Lantern, a bounty board, a wandering merchant and the Lantern Keeper.

The Deep got a lot more dangerous this week, and a lot more rewarding. Here's everything new.

**Mana and stamina**
• Healers, mages and necromancers now run on a blue mana bar. Rogues and tanks use a gold stamina bar. Both refill over time, and a rest at camp fills them all.
• Abilities cost mana or stamina, and so does healing. A healer that runs dry fights with basic attacks until its mana comes back.
• Four new enchants for the hero wearing them: Flow (regen), Leech (life steal), Bulwark (block) and Plating (defense).

**Monsters fight dirty now**
• Every guardian has a signature special attack, like Furnace-Heart's Magma Wave or the Root Mother's Grasping Roots. Some deeper monsters have one too. A red banner and a red ring warn you who's about to get hit.
• Burns hit cloth wearers twice as hard. Poison bites harder, except against necromancers.
• New: Stun and Disarm. Tanks shrug them off twice as fast, and Shield Wall makes them immune.
• Shielded foes: from floor 12, some monsters and many guardians fight inside a pale blue shield that cuts your damage by 65%. Tap the fight to break it, or let it wear off on its own in about 14 seconds.

**Things worth tapping**
• The Ghost Lantern drifts into the fight now and then and slowly saps your party. Tap it to shatter it for gold, Dust or a free tonic.
• The wandering merchant stops by for 2 minutes with one deal at half price.
• The bounty board (in Quests) offers three bounties every 4 hours, built from floors you've reached. They pay gold and Dust, sometimes a tonic.

**The Lantern Keeper**
When the Lantern Keeper is online, every hero gets +25% damage, healing, gold, hero XP and gear finds. Look for the small glowing lantern in the corner of the battle.

**Progress you can see**
• Region trials replace the old hero level gates. Defeat the region's alliance elites and beat its guardian to open the next region.
• Region mastery now speeds up hero XP: +1% per goal and +5% per fully mastered region.
• Hover the XP bar to see every bonus that adds to your hero XP rate.
• "Power level" (training) and "hero level" (XP) now have separate names, so they never get mixed up.
• The Map of the Deep shows each region's loot, with your own drop odds per kill.
• Every set piece says where it drops, with a Farm floor button.
• Beat a guardian with Descend automatically off and you stay on its floor to farm it again.

**Looks and comfort**
• 11 war banners in the Wardrobe. Looks only.
• Whispers get their own tabs, and a notification bell keeps your last 120 pop-ups, sorted into tabs.
• Room at the fire: party companions no longer count against the campfire.
• Lots of layout fixes for phones and laptops, and the game now pauses an older tab if you open it twice so saves don't fight.

Tank and healer heroes also hit a lot harder now, so every class reaches the deep floors at a similar pace.

Play full screen at lanternhold.born2gamellc.com. Bugs and ideas go in our Discord. Thanks for keeping the lantern lit!

---

## itch.io: description changes for 24 Nov (approved) (replace these parts of the 23 Nov text)

In **What's in it**, replace the first three bullets with:

• Five classes: Tank, Healer, Rogue, Mage and Necromancer, each with a skill tree, its own abilities and a mana or stamina bar
• 150 floors across 15 regions, guardian bosses with signature special attacks, and a story told in chapters, with companions who join along the way
• Region trials: beat each region's alliance elites and its guardian to open the next. Your hero level opens new parts of the game: gear, the campfire, camp jobs, the Players Guild, the Ember Ring and rekindling

Add these bullets after "The Loot Goblin, ambushes, elite warbands and region mastery goals":

• Monsters that fight back: burns, poison, stuns, disarms and shielded foes you tap to break
• A bounty board with fresh bounties every 4 hours, a wandering merchant and the Ghost Lantern
• The Lantern Keeper: when he's online, every hero gets +25% damage, healing, gold, XP and gear finds

Change "The Wardrobe: outfits, lantern styles and war banners. Looks only" to:
• The Wardrobe: outfits, lantern styles and 11 war banners. Looks only

Nothing else in the description changes.

---

## More places to list the game (awaiting John's picks)

Ranked by expected new players per hour of effort. Reach numbers are labeled: "ours" = our own data, "my estimate" = not measured.

| # | Place | Who it reaches | Effort | Who does it |
|---|-------|----------------|--------|-------------|
| 1 | **Customer email** (Wix email to all subscribers) | 1,722 subscribed contacts, 48% opened the 25 Oct email (ours). Clicks run ~1% (ours) | Low | Claude drafts in Wix, John OKs the send |
| 2 | **QR sign at the register and game tables** | Register is ~87% of revenue (ours), so this is where the players already are | Low | Print `lanternhold-qr-sign-5x7.pdf` |
| 3 | **Linktree button** "Play Lanternhold (free game)" | Everyone who taps the Instagram/Facebook bio link | Very low | Claude, in your browser, after OK |
| 4 | **Website**: menu link + homepage banner, plus born2gamellc.com/lanternhold redirect | Site visitors; the short link is easy to say out loud | Low | Claude saves in the Wix Editor, John publishes |
| 5 | **Google Business Profile post** | People who find the store on Google Maps/Search | Very low | Claude, via the same Wix tool as the FB/IG posts |
| 6 | **r/incremental_games** (Reddit) | The biggest idle/incremental game community (my estimate: well over 100K members; check before posting) | Medium: needs a Reddit account and the sub's self-promo rules | John posts, Claude drafts |
| 7 | **Galaxy.click** | A site just for incremental/idle games (my estimate: small but exactly the right audience) | Medium: account + submission review | John signs up, Claude fills it in |
| 8 | **r/WebGames** | Browser game players | Low | John posts, Claude drafts |
| 9 | **Local Facebook groups / Nextdoor** (Woodbridge, Prince William) | Local families who may become store customers | Low, but group rules vary | John or staff post |

**Not recommended:** CrazyGames and Poki. Both want their own SDK and ads in the game, review takes weeks, and our game has its own store. Newgrounds and Kongregate: small idle-game crowd today, and they want the game files uploaded, which is a separate build. Discord server listing sites (Disboard etc.): they list the server, not the game, and you kept Server Discovery separate on 18 Nov.

Note: every link uses `?ref=<place>`, but the game ignores that tag today, so we can't yet see which place sent a player. The fix is a small change in the game (log the ref on first visit). Say the word and I'll ask for it.

---

### Drafts

#### 1. Customer email
**Subject:** We made a game (and it's free)
**Preview:** Meet Lanternhold, Born 2 Game's own dungeon crawler.

Hi there,

We built something new, and it isn't on a shelf. **Lanternhold** is Born 2 Game's own free dungeon crawler, and you can play it right now in your browser on your phone or computer.

Pick a hero (Tank, Healer, Rogue, Mage or Necromancer), build a party of five and march into the Deep, floor by floor. Your party keeps fighting while you're away, so it's perfect for a few minutes between rounds or on your lunch break.

• Team up with other players' heroes from the Players Guild
• Fight guardians, ambushes and a world boss the whole community takes on together
• Loot gear, collect sets and level up your hero

[Play Lanternhold free] → https://lanternhold.born2gamellc.com/?ref=email

Come tell us how deep you got next time you're in. See you at the table!

Born 2 Game · 1372 Old Bridge Rd, Woodbridge, VA · (540) 701-7370

#### 3. Linktree button
Title: 🏮 Play Lanternhold (our free game). URL: https://lanternhold.born2gamellc.com/?ref=linktree. Position: 2nd, under Events.

#### 4. Website
- Redirect: born2gamellc.com/lanternhold → https://lanternhold.born2gamellc.com/?ref=website (301)
- Menu item "Lanternhold" under the main menu, opens in the same tab
- Homepage strip: the wide image (`lanternhold-wide.png`) linking to the game

#### 5. Google Business Profile post
🏮 We made a game! Lanternhold is Born 2 Game's own free dungeon crawler. Pick a hero, build a party of five and march into the Deep. It plays in your browser on phone or PC, nothing to download. Button: Learn more → https://lanternhold.born2gamellc.com/?ref=google. Image: square.

#### 6. r/incremental_games
**Title:** Lanternhold: a free browser idle RPG where marching order matters (made by our game store)

Hi all! We're a small veteran-owned game store in Virginia, and we built an idle dungeon crawler for our community. Sharing it here because it's grown a lot and we'd love feedback from people who really know the genre.

What makes it different:
- Your party of five fights on its own, but the fights are real: tanks hold aggro, healers run on mana, monsters stun, disarm, burn and poison, and marching order matters
- 150 floors across 15 regions, each with a guardian who has its own special attack, plus region trials and mastery goals
- Recruit other players' heroes into your party (you earn gold when yours gets recruited), PvP duels and a shared world boss
- Offline progress, cloud saves, no account required
- Free. The optional store sells looks and convenience, nothing that makes your party stronger

Play: https://lanternhold.born2gamellc.com/?ref=reddit
Wiki: https://lanternhold.born2gamellc.com/wiki/

We read every comment, and ideas that make it in get credited in the patch notes. What would you change first?

#### 7. Galaxy.click listing
Name: Lanternhold. Tags: idle, RPG, party, fantasy. Short description: "An idle party RPG: build a party of five, hold the line and carry the lantern 150 floors down." Long description: the itch description.

#### 8. r/WebGames
**Title:** Lanternhold: free idle dungeon crawler, build a party of five and descend 150 floors (browser, mobile friendly)
Body: one-paragraph version of #6 with the play link (?ref=webgames).

#### 9. Local groups / Nextdoor
Use the Facebook post from 23 Nov with `?ref=local`. Lead line: "Local game store made a free game, and Woodbridge players are already 135 floors deep!"
