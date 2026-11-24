/* lh-build 202611241259 */
/* Lanternhold intro: "Why we fight". A short cinematic that plays the first time someone opens the game.
   Skippable at any time, replayable from Settings (window.LHIntro.play()). Seen flag: localStorage "lh_intro". */
(function () {
  'use strict';
  const KEY = 'lh_intro', VER = 1;
  const WHY_URL = 'https://war.born2gamellc.com/why';
  // The giving wording lives here so it can be changed in one place.
  const GIVING = {
    lead: 'Lanternhold is free to play, made by Born 2 Game, LLC.',
    body: 'Once the costs of running and developing the game are covered, the proceeds go to our Mercy Corps giving:',
    causes: [
      ['heart', 'Children’s Miracle Network', 'Care for kids in children’s hospitals'],
      ['bowl', 'Food pantries', 'Meals for neighbors who need them'],
      ['book', 'Local schools', 'The schools in our community we support'],
    ],
    foot: 'Every hero who joins, every Sigil and every pass helps keep that going.',
  };
  const SCENES = [
    { id: 'title', ms: 0 },      // waits for a tap so music and the show start together
    { id: 'reach', ms: 5200 },
    { id: 'rift', ms: 5600 },
    { id: 'five', ms: 6200 },
    { id: 'why', ms: 5000 },
    { id: 'give', ms: 11000 },
    { id: 'end', ms: 0 },
  ];
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

  const CSS = `
#lh-intro{position:fixed;inset:0;z-index:100000;background:#04070d;color:#e8eef8;font-family:Inter,system-ui,sans-serif;overflow:hidden;
  display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .6s ease;-webkit-user-select:none;user-select:none;touch-action:manipulation}
#lh-intro.on{opacity:1}#lh-intro.out{opacity:0}
#lh-intro canvas.i-fx{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
#lh-intro .i-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 55%,transparent 40%,rgba(0,0,0,.75) 100%)}
#lh-intro .i-glow{position:absolute;left:50%;top:50%;width:140vmax;height:140vmax;margin:-70vmax 0 0 -70vmax;pointer-events:none;
  background:radial-gradient(circle,rgba(245,194,66,.16) 0,rgba(245,194,66,.05) 18%,transparent 40%);transition:background 1.2s ease,transform 1.2s ease}
#lh-intro[data-s=rift] .i-glow{background:radial-gradient(circle,rgba(154,92,255,.22) 0,rgba(110,60,200,.07) 20%,transparent 42%)}
#lh-intro[data-s=why] .i-glow{background:radial-gradient(circle,rgba(255,170,60,.3) 0,rgba(245,194,66,.08) 22%,transparent 44%);transform:scale(1.15)}
#lh-intro .i-stage{position:relative;width:min(92vw,900px);min-height:70vh;display:flex;align-items:center;justify-content:center;text-align:center}
#lh-intro .i-sc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;opacity:0;visibility:hidden;
  transform:scale(1.04);transition:opacity .9s ease,transform 1.4s cubic-bezier(.2,.7,.2,1),visibility 0s linear .9s;padding:0 4px}
#lh-intro .i-sc.on{opacity:1;visibility:visible;transform:none;transition:opacity .9s ease,transform 1.4s cubic-bezier(.2,.7,.2,1),visibility 0s}
#lh-intro .i-eyebrow{font:600 12px/1 'Chakra Petch',sans-serif;letter-spacing:.32em;text-transform:uppercase;color:#f5c242;opacity:.85}
#lh-intro h1,#lh-intro h2{font-family:'Chakra Petch',sans-serif;margin:0;font-weight:700;letter-spacing:.06em}
#lh-intro h1{font-size:clamp(40px,10vw,84px);line-height:1.05;text-transform:uppercase;color:#f5c242;text-shadow:0 0 22px rgba(245,194,66,.35)}
#lh-intro h1 .i-word{display:inline-block;white-space:nowrap;font-weight:inherit}
#lh-intro h1 span{display:inline-block;opacity:0;transform:translateY(18px) scale(.9);filter:blur(6px);color:#f5c242;
  background:linear-gradient(180deg,#fff6d8 0%,#f5c242 50%,#c4871a 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-shadow:none}
#lh-intro .i-sc.on h1 span{animation:lhiL .7s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes lhiL{to{opacity:1;transform:none;filter:drop-shadow(0 0 14px rgba(245,194,66,.4))}}
#lh-intro h2{font-size:clamp(26px,6.2vw,46px);line-height:1.12;color:#fff}
#lh-intro h2 em{font-style:normal;color:#f5c242}
#lh-intro p.i-line{font-size:clamp(16px,3.9vw,21px);line-height:1.55;max-width:34em;margin:0;color:#cdd7e6}
#lh-intro .i-sc.on .i-rise{animation:lhiR 1s cubic-bezier(.2,.8,.2,1) both}
#lh-intro .i-sc.on .i-d1{animation-delay:.35s}#lh-intro .i-sc.on .i-d2{animation-delay:.9s}#lh-intro .i-sc.on .i-d3{animation-delay:1.5s}#lh-intro .i-sc.on .i-d4{animation-delay:2.1s}
@keyframes lhiR{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
#lh-intro .i-lamp{width:clamp(110px,26vw,170px);height:auto;filter:drop-shadow(0 0 28px rgba(255,190,80,.55))}
#lh-intro .i-sc.on .i-lamp .i-flame{animation:lhiF 1.6s ease-in-out infinite alternate;transform-origin:60px 92px}
@keyframes lhiF{0%{transform:scale(1,1)}50%{transform:scale(.94,1.06)}100%{transform:scale(1.04,.95)}}
#lh-intro .i-sc.on .i-lamp .i-halo{animation:lhiH 2.4s ease-in-out infinite alternate}
@keyframes lhiH{from{opacity:.55}to{opacity:1}}
#lh-intro .i-tapgo{margin-top:8px;font:600 13px/1 'Chakra Petch',sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#f5c242;animation:lhiB 1.8s ease-in-out infinite}
@keyframes lhiB{0%,100%{opacity:.35}50%{opacity:1}}
#lh-intro .i-crack{width:min(80vw,420px);height:auto;overflow:visible}
#lh-intro .i-crack path{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:900;stroke-dashoffset:900}
#lh-intro .i-sc.on .i-crack path{animation:lhiD 1.6s cubic-bezier(.6,0,.2,1) .3s forwards}
@keyframes lhiD{to{stroke-dashoffset:0}}
#lh-intro .i-sc.on.i-shake{animation:lhiS .5s linear 1.5s 2}
@keyframes lhiS{0%,100%{translate:0 0}20%{translate:-4px 2px}40%{translate:5px -2px}60%{translate:-3px -3px}80%{translate:3px 3px}}
#lh-intro .i-foes{display:flex;gap:clamp(8px,3vw,26px);align-items:flex-end;justify-content:center;margin-top:-6px}
#lh-intro .i-foes img{width:clamp(54px,14vw,96px);image-rendering:auto;filter:drop-shadow(0 0 14px rgba(154,92,255,.6)) brightness(.9);opacity:0}
#lh-intro .i-sc.on .i-foes img{animation:lhiE 1.2s ease-out forwards}
#lh-intro .i-sc.on .i-foes img:nth-child(2){animation-delay:.25s;width:clamp(72px,19vw,130px)}#lh-intro .i-sc.on .i-foes img:nth-child(3){animation-delay:.5s}
@keyframes lhiE{from{opacity:0;transform:translateY(24px) scale(.85)}to{opacity:1;transform:none}}
#lh-intro .i-party{display:flex;gap:clamp(4px,2vw,18px);justify-content:center;align-items:flex-end;flex-wrap:nowrap}
#lh-intro .i-hero{display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0}
#lh-intro .i-sc.on .i-hero{animation:lhiP .8s cubic-bezier(.2,.9,.3,1.2) forwards}
#lh-intro .i-hero img{width:clamp(54px,15vw,108px);filter:drop-shadow(0 6px 14px rgba(0,0,0,.6)) drop-shadow(0 0 10px rgba(245,194,66,.25))}
#lh-intro .i-hero b{font:600 clamp(10px,2.6vw,13px)/1 'Chakra Petch',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#f5c242}
@keyframes lhiP{from{opacity:0;transform:translateY(40px) scale(.8)}to{opacity:1;transform:none}}
#lh-intro .i-big{font-size:clamp(46px,13vw,110px)!important;letter-spacing:.04em!important}
#lh-intro .i-sc.on .i-flash{position:absolute;inset:-20%;background:radial-gradient(circle,rgba(255,230,170,.9),rgba(245,194,66,.25) 30%,transparent 60%);
  pointer-events:none;animation:lhiX 1.3s ease-out forwards}
@keyframes lhiX{0%{opacity:0;transform:scale(.4)}12%{opacity:1}100%{opacity:0;transform:scale(1.5)}}
#lh-intro .i-ring{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px;border:2px solid rgba(245,194,66,.8);border-radius:50%;opacity:0;pointer-events:none}
#lh-intro .i-sc.on .i-ring{animation:lhiW 1.4s ease-out .1s forwards}
@keyframes lhiW{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(22)}}
#lh-intro .i-causes{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;max-width:680px}
#lh-intro .i-cause{background:linear-gradient(180deg,rgba(20,30,50,.92),rgba(11,18,32,.92));border:1px solid #2a3650;border-radius:14px;padding:16px 12px;
  display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:0 0 0 1px rgba(245,194,66,.06) inset,0 10px 30px rgba(0,0,0,.4)}
#lh-intro .i-cause svg{width:34px;height:34px;color:#f5c242;filter:drop-shadow(0 0 8px rgba(245,194,66,.45))}
#lh-intro .i-cause b{font:700 15px/1.2 'Chakra Petch',sans-serif;color:#fff;letter-spacing:.02em}
#lh-intro .i-cause div{display:flex;flex-direction:column;gap:4px}
#lh-intro .i-cause small{font-size:12.5px;line-height:1.4;color:#9fb0c8}
#lh-intro .i-give p.i-line{font-size:clamp(15px,3.6vw,18px)}
#lh-intro .i-give .i-foot{font-size:13.5px;color:#9fb0c8;max-width:36em;margin:0}
#lh-intro .i-btn-go{font:700 15px/1 'Chakra Petch',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#1a1204;cursor:pointer;
  background:linear-gradient(180deg,#ffe08a,#f5c242 55%,#d89b1c);border:0;border-radius:12px;padding:16px 30px;min-height:48px;
  box-shadow:0 0 0 1px rgba(255,240,200,.5) inset,0 8px 28px rgba(245,194,66,.35)}
#lh-intro .i-btn-go:hover{filter:brightness(1.08)}
#lh-intro a.i-why{color:#f5c242;font-size:14px;text-decoration:none;border-bottom:1px solid rgba(245,194,66,.4);padding-bottom:2px}
#lh-intro .i-skip{position:absolute;top:max(14px,env(safe-area-inset-top));right:14px;z-index:3;background:rgba(11,18,32,.7);color:#cdd7e6;
  border:1px solid #2a3650;border-radius:999px;font:600 12px/1 'Chakra Petch',sans-serif;letter-spacing:.18em;text-transform:uppercase;padding:11px 16px;cursor:pointer}
#lh-intro .i-skip:hover{color:#fff;border-color:#f5c242}
#lh-intro .i-dots{position:absolute;bottom:max(18px,env(safe-area-inset-bottom));left:0;right:0;display:flex;gap:8px;justify-content:center;z-index:3}
#lh-intro .i-dots i{width:7px;height:7px;border-radius:50%;background:#2a3650;transition:background .4s,transform .4s}
#lh-intro .i-dots i.on{background:#f5c242;transform:scale(1.3)}
#lh-intro .i-hint{position:absolute;bottom:max(38px,calc(env(safe-area-inset-bottom) + 22px));left:0;right:0;text-align:center;font-size:11.5px;color:#5f6f88;letter-spacing:.08em;z-index:3}
@media (max-width:560px){
  #lh-intro .i-causes{grid-template-columns:1fr;gap:8px}
  #lh-intro .i-cause{flex-direction:row;text-align:left;padding:11px 14px;gap:12px}
  #lh-intro .i-cause svg{width:28px;height:28px;flex:none}
  #lh-intro .i-cause div{display:flex;flex-direction:column;gap:2px}
  #lh-intro .i-stage{min-height:78vh}
  #lh-intro .i-sc{gap:14px}
}
@media (max-height:620px){#lh-intro .i-lamp{width:90px}#lh-intro .i-causes{gap:6px}#lh-intro .i-cause{padding:8px 12px}}
@media (prefers-reduced-motion:reduce){#lh-intro *{animation-duration:.01s!important;animation-delay:0s!important}}
`;

  const ICON = {
    heart: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.1C1 8.7 2.9 5 6.5 5c2 0 3.6 1.1 4.5 2.6C11.9 6.1 13.5 5 15.5 5 19.1 5 21 8.7 19.6 11.9 17.5 16.4 12 21 12 21z"/></svg>',
    bowl: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 11h18a9 9 0 0 1-6 8.5V21H9v-1.5A9 9 0 0 1 3 11zm5-8c1 1.2 1 2.3 0 3.5S7 8.8 8 10H6.6c-1-1.2-1-2.3 0-3.5S7.6 4.2 6.6 3zm4.5 0c1 1.2 1 2.3 0 3.5s-1 2.3 0 3.5h-1.4c-1-1.2-1-2.3 0-3.5s1-2.3 0-3.5zm4.5 0c1 1.2 1 2.3 0 3.5s-1 2.3 0 3.5h-1.4c-1-1.2-1-2.3 0-3.5s1-2.3 0-3.5z"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 6.3C10.3 5 7.8 4.4 4 4.5v13c3.6-.1 6 .5 8 1.9 2-1.4 4.4-2 8-1.9v-13c-3.8-.1-6.3.5-8 1.8zM11 17c-1.6-.8-3.5-1.2-5.5-1.3V6.5c2.3 0 4.1.5 5.5 1.4zm2 0V7.9c1.4-.9 3.2-1.4 5.5-1.4v9.2c-2 .1-3.9.5-5.5 1.3z"/></svg>',
  };
  const LAMP = '<svg class="i-lamp" viewBox="0 0 120 180" aria-hidden="true"><defs>' +
    '<radialGradient id="lhiHalo"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset=".5" stop-color="#f5a623" stop-opacity=".25"/><stop offset="1" stop-color="#f5a623" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="lhiMetal" x1="0" x2="1"><stop offset="0" stop-color="#6b4a1a"/><stop offset=".45" stop-color="#e2b257"/><stop offset="1" stop-color="#5a3c12"/></linearGradient>' +
    '<radialGradient id="lhiFl" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fffbe8"/><stop offset=".35" stop-color="#ffd35a"/><stop offset=".8" stop-color="#ff8a1e"/><stop offset="1" stop-color="#d6420c"/></radialGradient></defs>' +
    '<circle class="i-halo" cx="60" cy="96" r="58" fill="url(#lhiHalo)"/>' +
    '<path d="M48 22a12 12 0 0 1 24 0" fill="none" stroke="url(#lhiMetal)" stroke-width="5"/>' +
    '<path d="M36 34h48l-6 14H42z" fill="url(#lhiMetal)"/>' +
    '<path d="M42 48h36l4 80H38z" fill="rgba(255,214,120,.16)" stroke="url(#lhiMetal)" stroke-width="4"/>' +
    '<path d="M60 48v80M48 48l-4 80M72 48l4 80" stroke="url(#lhiMetal)" stroke-width="2" opacity=".55"/>' +
    '<path class="i-flame" d="M60 64c9 13 13 21 13 30a13 13 0 0 1-26 0c0-9 4-17 13-30z" fill="url(#lhiFl)"/>' +
    '<path d="M32 128h56l-5 12H37z" fill="url(#lhiMetal)"/><rect x="44" y="140" width="32" height="6" rx="2" fill="#4a3210"/></svg>';
  const CRACK = '<svg class="i-crack" viewBox="0 0 400 120" aria-hidden="true"><defs><filter id="lhiGl" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter></defs>' +
    '<g filter="url(#lhiGl)"><path d="M10 64 L70 52 L96 74 L150 40 L186 70 L222 34 L262 66 L300 46 L338 72 L390 58" stroke="#a46bff" stroke-width="9"/></g>' +
    '<path d="M10 64 L70 52 L96 74 L150 40 L186 70 L222 34 L262 66 L300 46 L338 72 L390 58" stroke="#f1e4ff" stroke-width="2.5"/>' +
    '<path d="M150 40 L160 14 M222 34 L214 8 M186 70 L196 104 M300 46 L318 20 M96 74 L84 100" stroke="#c9a4ff" stroke-width="1.6" opacity=".8"/></svg>';

  const sprite = (name, hue) => { try { return window.LHSprites ? LHSprites.spriteURL(name, 4, hue || 0) : ''; } catch (e) { return ''; } };
  const letters = s => { let i = 0; return s.split(' ').map(w => '<b class="i-word">' + w.split('').map(c => '<span style="animation-delay:' + (0.25 + (i++) * 0.07).toFixed(2) + 's">' + c + '</span>').join('') + '</b>').join(' '); };

  function html() {
    const heroes = [['tank', 'Tank'], ['healer', 'Healer'], ['rogue', 'Rogue'], ['mage', 'Mage'], ['necro', 'Necromancer']];
    const foes = ['riftling', 'wyrm', 'lich'];
    return '<canvas class="i-fx"></canvas><div class="i-glow"></div><div class="i-vig"></div>' +
      '<button class="i-skip" type="button" aria-label="Skip the intro">Skip</button>' +
      '<div class="i-stage">' +
      '<section class="i-sc" data-id="title">' + LAMP +
        '<div class="i-eyebrow i-rise i-d1">Born 2 Game presents</div><h1 aria-label="Lanternhold">' + letters('Lanternhold') + '</h1>' +
        '<div class="i-eyebrow i-rise i-d3" style="color:#9fb0c8">A Grand War story</div><div class="i-tapgo i-rise i-d4">Tap to light the lantern</div></section>' +
      '<section class="i-sc" data-id="reach"><div class="i-eyebrow i-rise">The Shattered Reach</div>' +
        '<h2 class="i-rise i-d1">The world is <em>breaking</em>.</h2>' +
        '<p class="i-line i-rise i-d2">Thirteen sectors torn apart by war. Iron Covenant, Radiant Ascendancy and the Devouring Tide fight for every inch of the Reach.</p></section>' +
      '<section class="i-sc i-shake" data-id="rift">' + CRACK +
        '<div class="i-foes">' + foes.map(f => '<img src="' + sprite(f) + '" alt="">').join('') + '</div>' +
        '<h2 class="i-rise i-d2">Beneath a Covenant Hold, <em style="color:#c9a4ff">the Nyx Rift</em> tears open.</h2>' +
        '<p class="i-line i-rise i-d3">One lantern holds it shut. If its flame goes out, the dark comes through.</p></section>' +
      '<section class="i-sc" data-id="five"><div class="i-eyebrow i-rise">Five answer the call</div>' +
        '<div class="i-party">' + heroes.map((h, i) => '<div class="i-hero" style="animation-delay:' + (0.3 + i * 0.22).toFixed(2) + 's"><img src="' + sprite(h[0]) + '" alt=""><b>' + h[1] + '</b></div>').join('') + '</div>' +
        '<p class="i-line i-rise i-d4">Shield, salve, blade, spell and bone. Together they keep the lantern lit.</p></section>' +
      '<section class="i-sc" data-id="why"><div class="i-flash"></div><div class="i-ring"></div>' +
        '<div class="i-eyebrow i-rise">Every war has a reason</div><h1 class="i-big" aria-label="Why we fight">' + letters('Why we fight') + '</h1>' +
        '<p class="i-line i-rise i-d4">This is ours.</p></section>' +
      '<section class="i-sc i-give" data-id="give"><div class="i-eyebrow i-rise">Why we fight</div>' +
        '<p class="i-line i-rise i-d1"><b style="color:#fff">' + GIVING.lead + '</b> ' + GIVING.body + '</p>' +
        '<div class="i-causes">' + GIVING.causes.map((c, i) => '<div class="i-cause i-rise" style="animation-delay:' + (1.1 + i * 0.35).toFixed(2) + 's">' + ICON[c[0]] + '<div><b>' + c[1] + '</b><small>' + c[2] + '</small></div></div>').join('') + '</div>' +
        '<p class="i-foot i-rise" style="animation-delay:2.4s">' + GIVING.foot + '</p></section>' +
      '<section class="i-sc" data-id="end">' + LAMP +
        '<h2 class="i-rise i-d1">Light the lantern. <em>Hold the line.</em></h2>' +
        '<button class="i-btn-go i-rise i-d2" type="button">Enter Lanternhold</button>' +
        '<a class="i-why i-rise i-d3" href="' + WHY_URL + '" target="_blank" rel="noopener">Read why we fight</a></section>' +
      '</div><div class="i-hint">Tap to continue</div><div class="i-dots">' + SCENES.map(() => '<i></i>').join('') + '</div>';
  }

  // Embers drifting up; they turn violet during the rift and burst on "Why we fight".
  function embers(cv, root) {
    const x = cv.getContext('2d'); let w = 0, h = 0, dpr = 1, raf = 0, P = [], burst = 0;
    const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const N = () => Math.round(Math.min(90, (w * h) / 9000));
    const spawn = (b) => ({ x: b ? w / 2 + (Math.random() - .5) * 40 : Math.random() * w, y: b ? h / 2 : h + 10 + Math.random() * h * .4,
      vx: b ? (Math.random() - .5) * 9 : (Math.random() - .5) * .3, vy: b ? (Math.random() - .5) * 9 : -(0.3 + Math.random() * 0.9),
      r: 0.6 + Math.random() * 2.2, life: 1, b });
    size(); for (let i = 0; i < N(); i++) { const p = spawn(); p.y = Math.random() * h; P.push(p); }
    function tick() {
      x.clearRect(0, 0, w, h);
      const rift = root.dataset.s === 'rift';
      if (burst > 0) { for (let i = 0; i < burst; i++) P.push(spawn(true)); burst = 0; }
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.x += p.vx; p.y += p.vy;
        if (p.b) { p.vx *= .965; p.vy *= .965; p.life -= .012; if (p.life <= 0) { P.splice(i, 1); continue; } }
        else { p.vx += (Math.random() - .5) * .04; if (p.y < -10) Object.assign(p, spawn()); }
        const a = p.b ? p.life : Math.min(1, (h - p.y) / (h * .3)) * .8;
        x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.283);
        x.fillStyle = rift && !p.b ? 'rgba(180,130,255,' + a + ')' : 'rgba(255,' + (170 + (p.r * 20 | 0)) + ',80,' + a + ')';
        x.shadowColor = rift && !p.b ? '#9a5cff' : '#ffb347'; x.shadowBlur = 8; x.fill();
      }
      raf = requestAnimationFrame(tick);
    }
    if (!reduce) tick();
    window.addEventListener('resize', size);
    return { burst: n => { burst += n; }, stop: () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); } };
  }

  let el = null;
  function play(opts) {
    opts = opts || {};
    if (el) return;
    if (!document.getElementById('lh-intro-css')) { const st = document.createElement('style'); st.id = 'lh-intro-css'; st.textContent = CSS; document.head.appendChild(st); }
    el = document.createElement('div'); el.id = 'lh-intro'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Lanternhold intro'); el.innerHTML = html();
    document.body.appendChild(el);
    const fx = embers(el.querySelector('canvas.i-fx'), el);
    const secs = [...el.querySelectorAll('.i-sc')], dots = [...el.querySelectorAll('.i-dots i')], hint = el.querySelector('.i-hint');
    let i = -1, timer = 0, lockUntil = 0;
    function go(n) {
      if (n >= SCENES.length) return done();
      clearTimeout(timer); i = n; const s = SCENES[i];
      secs.forEach((x, k) => x.classList.toggle('on', k === i));
      dots.forEach((x, k) => x.classList.toggle('on', k === i));
      el.dataset.s = s.id; lockUntil = Date.now() + 700;
      hint.style.visibility = s.id === 'title' || s.id === 'end' ? 'hidden' : 'visible';
      if (s.id === 'why') setTimeout(() => fx.burst(reduce ? 0 : 140), 120);
      if (s.ms) timer = setTimeout(() => go(i + 1), reduce ? s.ms + 2000 : s.ms);
    }
    function done() {
      if (!el) return;
      clearTimeout(timer); try { localStorage.setItem(KEY, String(VER)); } catch (e) {}
      const node = el; el = null; node.classList.add('out'); document.removeEventListener('keydown', key, true);
      setTimeout(() => { fx.stop(); node.remove(); if (opts.onDone) opts.onDone(); }, 600);
    }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(); }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); if (Date.now() > lockUntil) go(i + 1); }
    }
    el.addEventListener('click', e => {
      if (e.target.closest('.i-skip') || e.target.closest('.i-btn-go')) return done();
      if (e.target.closest('a')) return;
      if (Date.now() > lockUntil) go(i + 1);
    });
    document.addEventListener('keydown', key, true);
    requestAnimationFrame(() => { el.classList.add('on'); go(0); });
  }
  const seen = () => { try { return +localStorage.getItem(KEY) >= VER; } catch (e) { return true; } };
  window.LHIntro = { play, seen, giving: GIVING };
  // First visit: show it before anything else. ?intro=1 forces it (handy for sharing and testing).
  const force = /[?&]intro=1\b/.test(location.search);
  if (force || !seen()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => play()); else play();
  }
})();
