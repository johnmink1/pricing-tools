"""Banners at Dawn - the main theme. Bb major, 4/4. A lone horn grows into full orchestra and choir."""
from engine import Song, hits, harm, scale_of

TITLE = 'Banners at Dawn'
MOOD = 'Main theme, hopeful'

HEAD = ("F4:1 Bb4:1 D5:1.5 C5:.5 | C5:2 A4:1 F4:1 | G4:1 Bb4:1 D5:1.5 Eb5:.5 | G5:2 Eb5:1 Bb4:1")
A1_TAIL = "F5:1.5 D5:.5 Bb4:1 D5:1 | Eb5:1 G5:1 Bb5:1.5 G5:.5 | G5:1.5 F5:.5 Eb5:1 C5:1 | A4:1 C5:1 F5:2"
A2_TAIL = "D5:1.5 F5:.5 Bb5:2 | C6:1.5 Bb5:.5 G5:1 Eb5:1 | A5:1.5 G5:.5 F5:1 Eb5:1 | D5:4"
CH_A1 = "Bb | F/A | Gm | Eb | Bb/D | Eb | Cm7 | F"
CH_A2 = "Bb | F/A | Gm | Eb | Bb/F | Eb | F7 | Bb"

B = ("D5:1 G5:1 Bb5:2 | Bb5:1.5 G5:.5 Eb5:2 | F5:1 Bb5:1 D6:2 | C6:1.5 A5:.5 F5:2 | "
     "G5:1 Bb5:1 D6:1.5 C6:.5 | Bb5:1.5 G5:.5 Eb5:1 G5:1 | C6:1.5 Bb5:.5 G5:1 Eb5:1 | F5:2 A5:2")
CH_B = "Gm | Eb | Bb | F | Gm | Eb | Cm | F7"

SC = scale_of('Bb')
ROOM = 0.8
REVERB = 0.72


def build():
    s = Song(TITLE, 88, beats=4, seed=88)
    s.inst('horn', 'horn', 100, 52, 70)
    s.inst('trumpet', 'trumpet', 84, 70, 65)
    s.inst('trombone', 'trombone', 84, 42, 60)
    s.inst('violins', 'strings', 86, 76, 70)
    s.inst('strings', 'slowstr', 80, 60, 80)
    s.inst('celli', 'cello', 90, 54, 60)
    s.inst('basses', 'contrabass', 86, 64, 55)
    s.inst('flute', 'flute', 82, 80, 70)
    s.inst('oboe', 'oboe', 80, 62, 70)
    s.inst('choir', 'choir', 82, 64, 85)
    s.inst('harp', 'harp', 74, 88, 75)
    s.inst('timp', 'timpani', 92, 64, 60)
    s.inst('drums', 0, 90, 64, 60, drum=True)

    # intro: the lone horn call over a held string chord
    ch, n = s.chords("Bb | Eb/Bb | Bb | F")
    s.melody('horn', "F4:1 Bb4:1 D5:2 | Eb5:2 C5:2 | D5:1.5 C5:.5 Bb4:2 | A4:4", 80)
    s.pad('strings', ch, 40, 50, 65)
    s.expr('strings', s.t, n, 40, 90)
    s.bass('basses', ch, 50, 'root', octave=1)
    s.adv(n)

    # A: soft strings carry it
    ch, n = s.chords(CH_A1)
    s.melody('violins', HEAD + ' | ' + A1_TAIL, 74)
    s.arp('harp', ch, [0, 2, 4, 2, 3, 5, 3, 2], 0.5, 46, base=46)
    s.pad('strings', ch, 46, 50, 67)
    s.bass('celli', ch, 60, 'root')
    s.adv(n)

    # A': winds take it, horn counter line
    ch, n = s.chords(CH_A2)
    mel = HEAD + ' | ' + A2_TAIL
    s.melody('flute', mel, 80)
    s.melody('oboe', harm(mel, SC, flats=True), 62)
    s.guide('horn', ch, 55, 67, 62, rhythm=[2, 2])
    s.arp('harp', ch, [0, 2, 4, 2, 3, 5, 3, 2], 0.5, 48, base=46)
    s.pad('strings', ch, 50, 50, 67)
    s.bass('celli', ch, 70, 'half')
    s.bass('basses', ch, 60, 'root', octave=1)
    s.adv(n)

    # B: the sweep
    ch, n = s.chords(CH_B)
    s.melody('violins', B, 86)
    s.melody('horn', B, 72, octave=-1)
    s.pad('strings', ch, 58, 50, 67)
    s.expr('strings', s.t, n, 80, 110)
    s.bass('celli', ch, 78, 'half')
    s.bass('basses', ch, 70, 'root', octave=1)
    hits(s, 'timp', ch, [0], 60)
    s.adv(n)

    # build: choir climbs, timpani rolls
    ch, n = s.chords("Eb | F | Eb/G | F/A")
    s.melody('choir', "G4:4 | A4:4 | Bb4:4 | C5:4", 70, shape=False)
    s.expr('choir', s.t, n, 60, 120)
    s.pad('strings', ch, 60, 50, 67)
    s.expr('strings', s.t, n, 80, 120)
    s.bass('basses', ch, 74, 'root', octave=1)
    s.bass('celli', ch, 74, 'root')
    for k in range(48):
        s.note('timp', s.t + s.bars(1) + k * 0.25, 0.25, 41, 40 + k, 0.9)
    s.drums({49: '............X...'}, 1, 70, start=s.t + s.bars(3))
    s.adv(n)

    # A'': full orchestra and choir
    for tail, chs in ((A1_TAIL, CH_A1), (A2_TAIL, CH_A2)):
        ch, n = s.chords(chs)
        mel = HEAD + ' | ' + tail
        s.melody('trumpet', mel, 88)
        s.melody('horn', mel, 92, octave=-1)
        s.melody('violins', mel, 86, octave=1 if tail == A1_TAIL else 0)
        s.pad('choir', ch, 62, 55, 72)
        s.pad('trombone', ch, 66, 43, 58, n=3)
        s.arp('harp', ch, [0, 2, 4, 6, 4, 2, 4, 2], 0.5, 50, base=46)
        s.bass('celli', ch, 84, 'half')
        s.bass('basses', ch, 80, 'root', octave=1)
        hits(s, 'timp', ch, [0, 2], 72)
        s.drums({49: 'X' + '.' * 15}, 1, 80)
        s.adv(n)

    ch, n = s.chords(CH_B)
    s.melody('violins', B, 90)
    s.melody('trumpet', B, 80, octave=-1)
    s.melody('flute', B, 70)
    s.guide('horn', ch, 55, 67, 76, rhythm=[1.5, 2.5])
    s.pad('choir', ch, 64, 55, 72)
    s.pad('trombone', ch, 64, 43, 58, n=3)
    s.bass('celli', ch, 84, 'half')
    s.bass('basses', ch, 80, 'root', octave=1)
    hits(s, 'timp', ch, [0], 72)
    s.adv(n)

    # coda
    ch, n = s.chords("Eb | F | Bb | Bb")
    s.melody('violins', "G5:2 F5:2 | Eb5:2 C5:2 | D5:4 | D5:4", 86)
    s.melody('horn', "Bb4:2 A4:2 | G4:2 A4:2 | F4:4 | F4:4", 82)
    s.pad('choir', ch, 66, 55, 72)
    s.pad('trombone', ch, 64, 43, 58, n=3)
    s.pad('strings', ch, 60, 50, 67)
    s.bass('basses', ch, 80, 'root', octave=1)
    s.bass('celli', ch, 80, 'root')
    s.arp('harp', ch[2:], [0, 1, 2, 3, 4, 5, 6, 7], 0.25, 50, base=46, span=3)
    for k in range(32):
        s.note('timp', s.t + s.bars(2) + k * 0.25, 0.25, 46, 50 + k, 0.9)
    s.drums({49: 'X' + '.' * 15}, 1, 84, start=s.t + s.bars(2))
    s.rit(s.t + s.bars(1), s.bars(2), 66)
    s.adv(n)
    s.adv(2)
    return s
