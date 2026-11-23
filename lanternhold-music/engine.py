"""Lanternhold score engine.

Scores are written by hand as melodies and chord charts (see tracks/*.py) and rendered
to MIDI here, then to audio with FluidSynth and the MuseScore General SoundFont (MIT).

Melody syntax:  "D5:1 E5:.5 F#5:.5 | G5:3"   note:beats, r = rest, | = barline (checked)
                 a trailing ! accents a note, a trailing ~ plays it softer.
Chord syntax:   "D | G A7 | Bm | G/B"          chords split each bar evenly.
"""
import math, random, re
import mido

PPQ = 480
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

# GM programs (0-based)
GM = dict(piano=0, epiano=4, harpsichord=6, celesta=8, glock=9, musicbox=10, vibes=11, marimba=12,
          dulcimer=15, organ=19, accordion=21, nylon=24, steel=25, ebass=33, fretless=35, violin=40, viola=41,
          cello=42, contrabass=43, tremolo=44, pizz=45, harp=46, timpani=47, strings=48, slowstr=49,
          synstr=50, choir=52, oohs=53, voice=54, orchhit=55, trumpet=56, trombone=57, tuba=58,
          mutetp=59, horn=60, brass=61, sax=65, oboe=68, ehorn=69, bassoon=70, clarinet=71,
          piccolo=72, flute=73, recorder=74, panflute=75, bottle=76, shaku=77, whistle=78, ocarina=79,
          pad_warm=89, pad_choir=91, pad_halo=94, sitar=104, banjo=105, shamisen=106, koto=107,
          kalimba=108, bagpipe=109, fiddle=110, taiko=116, melotom=117)

QUAL = {'': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10],
        'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14],
        'dim': [0, 3, 6], 'm7b5': [0, 3, 6, 10], 'aug': [0, 4, 8], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
        '9': [0, 4, 7, 10, 14], 'm9': [0, 3, 7, 10, 14], '5': [0, 7], '7sus4': [0, 5, 7, 10], 'maj9': [0, 4, 7, 11, 14]}


def pc(name):
    v = NOTE[name[0]]
    for ch in name[1:]:
        v += 1 if ch == '#' else -1 if ch == 'b' else 0
    return v % 12


def midi(n):
    m = re.fullmatch(r'([A-G][#b]?)(-?\d)', n)
    if not m:
        raise ValueError('bad note ' + n)
    return pc(m.group(1)) + 12 * (int(m.group(2)) + 1) if m.group(1) not in ('Cb', 'B#') else \
        (NOTE[m.group(1)[0]] + (1 if '#' in m.group(1) else -1)) + 12 * (int(m.group(2)) + 1)


class Chord:
    def __init__(self, sym):
        self.sym = sym
        m = re.fullmatch(r'([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?', sym)
        if not m or m.group(2) not in QUAL:
            raise ValueError('bad chord ' + sym)
        self.root = pc(m.group(1))
        self.ivs = QUAL[m.group(2)]
        self.pcs = sorted({(self.root + i) % 12 for i in self.ivs})
        self.bass = pc(m.group(3)) if m.group(3) else self.root
        self.fifth = (self.root + (7 if 7 in self.ivs else 6 if 6 in self.ivs else 8 if 8 in self.ivs else 7)) % 12
        self.third = (self.root + (4 if 4 in self.ivs else 3 if 3 in self.ivs else 5 if 5 in self.ivs else 2 if 2 in self.ivs else 7)) % 12


def near(pcv, target):
    """midi note with pitch class pcv closest to target"""
    base = target - ((target - pcv) % 12)
    return base if target - base <= 6 else base + 12


def parse_melody(s, bar_beats, pickup=0.0):
    """returns list of (start, dur, midi or None, velmul)"""
    out, t, bar_start, first = [], 0.0, 0.0, True
    for tok in s.split():
        if tok == '|':
            want = pickup if (first and pickup) else bar_beats
            if abs((t - bar_start) - want) > 1e-6:
                raise ValueError('bar length %.3f != %.3f near %r (bar at beat %.2f)' % (t - bar_start, want, s[:60], bar_start))
            bar_start, first = t, False
            continue
        vm = 1.0
        if tok.endswith('!'):
            vm, tok = 1.18, tok[:-1]
        elif tok.endswith('~'):
            vm, tok = 0.8, tok[:-1]
        n, d = tok.split(':')
        d = float(d)
        if n != 'r':
            out.append((t, d, midi(n), vm))
        t += d
    want = pickup if (first and pickup) else bar_beats
    if abs((t - bar_start) - want) > 1e-6:
        raise ValueError('last bar length %.3f != %.3f in %r' % (t - bar_start, want, s[-60:]))
    return out, t


def parse_chords(s, bar_beats):
    out, t = [], 0.0
    for bar in s.split('|'):
        syms = bar.split()
        if not syms:
            continue
        d = bar_beats / len(syms)
        for sy in syms:
            if sy == '%':
                out.append((t, d, out[-1][2]))
            else:
                out.append((t, d, Chord(sy)))
            t += d
    return out, t


class Song:
    def __init__(self, title, bpm, beats=4, seed=1, swing=0.0):
        self.title, self.bpm, self.beats = title, bpm, beats
        self.events = []        # (beat, kind, ch, a, b)
        self.notes = []         # [start, end, ch, note, vel]
        self.channels = {}      # name -> (ch, program)
        self.t = 0.0            # cursor in beats
        self.rng = random.Random(seed)
        self.tempo = [(0.0, bpm)]
        self.swing = swing
        self.voicing = {}

    # ---- channel setup ----
    def inst(self, name, prog, vol=100, pan=64, rev=60, cho=0, drum=False):
        if drum:
            ch = 9
        else:
            used = {c for c, _ in self.channels.values()}
            ch = next(i for i in range(16) if i != 9 and i not in used)
        self.channels[name] = (ch, prog)
        self.events += [(0, 'cc', ch, 7, vol), (0, 'cc', ch, 10, pan), (0, 'cc', ch, 91, rev),
                        (0, 'cc', ch, 93, cho), (0, 'cc', ch, 11, 100)]
        if not drum:
            self.events.append((0, 'prog', ch, GM[prog] if isinstance(prog, str) else prog, 0))

    def ch(self, name):
        return self.channels[name][0]

    # ---- low-level ----
    def note(self, name, start, dur, n, vel, legato=0.96, jitter=0.012):
        ch = self.ch(name)
        r = self.rng
        st = start + r.uniform(-jitter, jitter) * (self.bpm / 60.0) * 0.5
        st = max(0.0, st)
        if self.swing and abs((start * 2) % 2 - 1) < 1e-6:
            st += self.swing
        vel = int(max(12, min(127, vel + r.randint(-5, 5))))
        self.notes.append([st, st + max(0.05, dur * legato), ch, n, vel])

    def expr(self, name, start, dur, v0, v1, steps=16):
        ch = self.ch(name)
        for i in range(steps + 1):
            self.events.append((start + dur * i / steps, 'cc', ch, 11, int(v0 + (v1 - v0) * i / steps)))

    def rit(self, start_beat, dur, to_bpm, steps=12):
        b0 = self.tempo_at(start_beat)
        for i in range(1, steps + 1):
            self.tempo.append((start_beat + dur * (i - 1) / steps, b0 + (to_bpm - b0) * i / steps))

    def set_tempo(self, beat, bpm):
        self.tempo.append((beat, bpm))

    def tempo_at(self, beat):
        cur = self.bpm
        for b, v in sorted(self.tempo):
            if b <= beat:
                cur = v
        return cur

    # ---- parts ----
    def melody(self, name, s, vel=84, at=None, octave=0, legato=0.97, pickup=0.0, shape=True):
        t0 = self.t if at is None else at
        notes, length = parse_melody(s, self.beats, pickup)
        t0 -= pickup if pickup else 0
        total = length
        for (st, d, n, vm) in notes:
            v = vel * vm
            if shape:   # gentle phrase arch + downbeat lift
                ph = st / max(total, 1)
                v *= 0.9 + 0.16 * math.sin(math.pi * ph)
                if abs((st + pickup) % self.beats) < 1e-6:
                    v *= 1.06
            self.note(name, t0 + st, d, n + 12 * octave, v, legato)
        return length

    def chords(self, s):
        cs, length = parse_chords(s, self.beats)
        return [(self.t + st, d, c) for st, d, c in cs], length

    def voice(self, name, c, lo, hi, n=4):
        """voice-led close-ish voicing"""
        prev = self.voicing.get(name)
        pcs = [(c.root + i) % 12 for i in c.ivs]
        pcs = list(dict.fromkeys(pcs))
        if len(pcs) < n:
            pcs = pcs + [c.root]
        pcs = pcs[:n] if len(pcs) > n else pcs
        best, bd = None, 1e9
        cand = [m for m in range(lo, hi + 1) if m % 12 in pcs]
        import itertools
        center = (lo + hi) / 2
        for strict, combo in [(st_, cb) for st_ in (True, False) for cb in itertools.combinations(cand, len(pcs))]:
            if best is not None and not strict and bd < 1e8:
                break
            if sorted(x % 12 for x in combo) != sorted(pcs):
                continue
            if combo[-1] - combo[0] > (16 if strict else 20):
                continue
            if strict and any((y - x) in (1, 13) for i, x in enumerate(combo) for y in combo[i + 1:]):
                continue
            if prev:
                d = sum(min(abs(a - b) for b in prev) for a in combo) + sum(min(abs(a - b) for a in combo) for b in prev)
            else:
                d = abs(sum(combo) / len(combo) - center) * 2
            d += 0.15 * abs(sum(combo) / len(combo) - center)
            if d < bd:
                best, bd = combo, d
        if best is None:
            best = tuple(near(p, int(center)) for p in pcs)
        self.voicing[name] = list(best)
        return list(best)

    def pad(self, name, chords, vel=60, lo=55, hi=74, n=4, legato=1.0):
        for st, d, c in chords:
            for m in self.voice(name, c, lo, hi, n):
                self.note(name, st, d, m, vel, legato=legato, jitter=0.02)

    def bass(self, name, chords, vel=80, style='root', octave=2, legato=0.95):
        lo = 12 * (octave + 1) + 4    # E of octave
        for i, (st, d, c) in enumerate(chords):
            r = near(c.bass, lo + 5)
            f = near(c.fifth, r + 7)
            if f < r:
                f += 12
            if style == 'root':
                self.note(name, st, d, r, vel, legato)
            elif style == 'half':
                h = d / 2
                self.note(name, st, h, r, vel, legato)
                self.note(name, st + h, h, f if f - r <= 7 else f - 12, vel * 0.85, legato)
            elif style == 'waltz':   # 1 only, chords elsewhere
                self.note(name, st, 1, r, vel, 0.9)
            elif style == 'walk':
                nxt = chords[i + 1][2] if i + 1 < len(chords) else c
                tgt = near(nxt.bass, r)
                q = d / 4 if d >= 4 else d / 2
                seq = [r, f if f - r <= 7 else f - 12, near(c.third, r + 3)]
                appr = tgt - 1 if tgt > r else tgt + 1 if tgt < r else f
                seq = (seq + [appr])[:int(round(d / q))]
                for k, m in enumerate(seq):
                    self.note(name, st + k * q, q, m, vel * (1 if k == 0 else 0.82), 0.9)
            elif style == 'pulse':  # repeated 8ths
                k = 0
                while k * 0.5 < d - 1e-6:
                    self.note(name, st + k * 0.5, 0.5, r, vel * (1 if k % 2 == 0 else 0.78), 0.7)
                    k += 1
            elif style == 'gallop':  # 8th + two 16ths
                k = 0.0
                while k < d - 1e-6:
                    self.note(name, st + k, 0.5, r, vel, 0.8)
                    self.note(name, st + k + 0.5, 0.25, r, vel * 0.7, 0.8)
                    self.note(name, st + k + 0.75, 0.25, r, vel * 0.75, 0.8)
                    k += 1

    def arp(self, name, chords, pattern, step=0.5, vel=64, base=48, legato=1.6, span=2):
        """pattern: indexes into ascending chord tones from base (0=lowest)"""
        for st, d, c in chords:
            r = near(c.bass if c.bass != c.root else c.root, base + 5)
            pcs = c.pcs
            tones = sorted(m for m in range(r, r + 12 * span + 1) if m % 12 in pcs)
            k, t = 0, st
            while t < st + d - 1e-6:
                idx = pattern[k % len(pattern)]
                if idx is not None:
                    m = tones[min(idx, len(tones) - 1)]
                    acc = 1.0 if k % len(pattern) == 0 else 0.86
                    self.note(name, t, step, m, vel * acc, legato, jitter=0.008)
                t += step
                k += 1

    def waltz(self, name, chords, vel=56, lo=55, hi=72):
        for st, d, c in chords:
            v = self.voice(name, c, lo, hi, 3)
            b = 1.0
            while b < d - 1e-6:
                for m in v:
                    self.note(name, st + b, 0.9, m, vel * (1 if b == 1 else 0.88), 0.85)
                b += 1

    def strum(self, name, chords, beats_on, vel=62, lo=48, hi=67, roll=0.035, n=5):
        for st, d, c in chords:
            v = self.voice(name, c, lo, hi, min(n, len(set(c.pcs)) + (1 if len(c.pcs) < 4 else 0)))
            for b in beats_on:
                if b >= d - 1e-6:
                    continue
                for j, m in enumerate(v):
                    self.note(name, st + b + j * roll, min(1.0, d - b), m, vel * (1 - 0.04 * j), 0.95, jitter=0.004)

    def drums(self, pattern, bars, vel=80, start=None, step=0.25):
        """pattern: {gm_note: 'x...X...'} one bar; X = accent, x = normal, o = ghost"""
        t0 = self.t if start is None else start
        for b in range(bars):
            for n, p in pattern.items():
                for i, chh in enumerate(p):
                    if chh in 'xXo':
                        v = vel * (1.2 if chh == 'X' else 0.55 if chh == 'o' else 0.9)
                        self.note('drums', t0 + b * self.beats + i * step, step, n, v, 0.5, jitter=0.006)

    def guide(self, name, chords, lo, hi, vel=60, rhythm=None, prefer=(1, 3), legato=1.0):
        """smooth counter line on chord tones (3rds and 7ths first), one note per chord or per rhythm list"""
        prev = self.voicing.get(name, [(lo + hi) // 2])[0]
        for st, d, c in chords:
            pts = [c.third] + ([(c.root + 10) % 12] if 10 in c.ivs else [(c.root + 11) % 12] if 11 in c.ivs else []) + c.pcs
            best, bd = None, 1e9
            for k, p in enumerate(pts):
                m = near(p, prev)
                for mm in (m, m - 12, m + 12):
                    if lo <= mm <= hi:
                        dd = abs(mm - prev) + (0 if k < 2 else 2.5)
                        if dd < bd:
                            best, bd = mm, dd
            best = best or prev
            parts = rhythm or [d]
            t = st
            for r in parts:
                if t >= st + d - 1e-6:
                    break
                self.note(name, t, min(r, st + d - t), best, vel, legato, jitter=0.015)
                t += r
            prev = best
        self.voicing[name] = [prev]

    def adv(self, beats):
        self.t += beats

    def bars(self, n):
        return n * self.beats

    # ---- output ----
    def save(self, path):
        mf = mido.MidiFile(ticks_per_beat=PPQ)
        tr = mido.MidiTrack()
        mf.tracks.append(tr)
        ev = []
        # a re-struck pitch on the same channel cuts the earlier note just before it (otherwise its note-off kills the new one)
        by = {}
        for nt in sorted(self.notes):
            by.setdefault((nt[2], nt[3]), []).append(nt)
        for lst in by.values():
            for a, b in zip(lst, lst[1:]):
                if a[1] > b[0] - 0.01:
                    a[1] = max(a[0] + 0.02, b[0] - 0.01)
            for st, en, ch, n, v in lst:
                ev.append((st, 2, mido.Message('note_on', channel=ch, note=n, velocity=v)))
                ev.append((en, 1, mido.Message('note_off', channel=ch, note=n, velocity=0)))
        for (b, bpm) in sorted(self.tempo):
            ev.append((b, 0, mido.MetaMessage('set_tempo', tempo=int(60_000_000 / bpm))))
        for (b, kind, ch, a, v) in self.events:
            if kind == 'on':
                ev.append((b, 2, mido.Message('note_on', channel=ch, note=a, velocity=v)))
            elif kind == 'off':
                ev.append((b, 1, mido.Message('note_off', channel=ch, note=a, velocity=0)))
            elif kind == 'cc':
                ev.append((b, 0, mido.Message('control_change', channel=ch, control=a, value=max(0, min(127, v)))))
            elif kind == 'prog':
                ev.append((b, 0, mido.Message('program_change', channel=ch, program=a)))
        ev.sort(key=lambda e: (e[0], e[1]))
        last = 0
        for b, _, msg in ev:
            tick = int(round(b * PPQ))
            msg.time = tick - last
            last = tick
            tr.append(msg)
        mf.save(path)
        return mf.length


SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']


def tr_mel(s, k, flats=False):
    names = FLAT if flats else SHARP
    out = []
    for tok in s.split():
        if tok == '|' or tok.startswith('r:'):
            out.append(tok)
            continue
        suf = tok[-1] if tok[-1] in '!~' else ''
        body = tok[:-1] if suf else tok
        n, d = body.split(':')
        m = midi(n) + k
        out.append('%s%d:%s%s' % (names[m % 12], m // 12 - 1, d, suf))
    return ' '.join(out)


def tr_chords(s, k, flats=False):
    names = FLAT if flats else SHARP
    def one(sym):
        if sym in ('|', '%'):
            return sym
        m = re.fullmatch(r'([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?', sym)
        r = names[(pc(m.group(1)) + k) % 12] + m.group(2)
        if m.group(3):
            r += '/' + names[(pc(m.group(3)) + k) % 12]
        return r
    return ' '.join(one(x) for x in s.split())


def hits(song, name, chords, beats, vel=80, octave=2, dur=1.0):
    for st, d, c in chords:
        r = near(c.root, 12 * (octave + 1) + 7)
        for b in beats:
            if b < d - 1e-6:
                song.note(name, st + b, dur, r, vel, 0.9)


def scale_of(tonic, mode='major'):
    steps = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10]}[mode]
    return [(pc(tonic) + x) % 12 for x in steps]


def harm(s, scale, steps=-2, flats=False):
    """diatonic parallel line (default a third below) for a melody string"""
    names = FLAT if flats else SHARP
    out = []
    for tok in s.split():
        if tok == '|' or tok.startswith('r:'):
            out.append(tok)
            continue
        n, d = tok.rstrip('!~').split(':')
        m = midi(n)
        if m % 12 in scale:
            i = scale.index(m % 12)
            j = i + steps
            octs, j = divmod(j, 7)
            t = scale[j] + 12 * ((m - m % 12) // 12 + octs)
            if t > m and steps < 0:
                t -= 12
            if t < m and steps > 0:
                t += 12
            # fix wrap: keep it within an octave of the source
            while m - t > 12:
                t += 12
            while t - m > 12:
                t -= 12
            m = t
        out.append('%s%d:%s' % (names[m % 12], m // 12 - 1, d))
    return ' '.join(out)


def stabs(song, name, chords, beats_on, vel=56, lo=55, hi=72, dur=0.4, n=3):
    for st, d, c in chords:
        v = song.voice(name, c, lo, hi, n)
        for b in beats_on:
            if b < d - 1e-6:
                for m in v:
                    song.note(name, st + b, dur, m, vel, 0.9)
