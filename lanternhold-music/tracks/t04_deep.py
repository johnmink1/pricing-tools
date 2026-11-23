"""Beneath the Lantern Deep - the dungeon. D minor, 4/4, slow. English horn, celesta, choir and low strings."""
from engine import Song

TITLE = 'Beneath the Lantern Deep'
MOOD = 'Dungeon, mysterious'

INTRO = "A5:.5 D6:.5 F6:.5 E6:.5 D6:2 | r:.5 D6:.5 F6:.5 A6:.5 F6:2 | G5:.5 Bb5:.5 D6:.5 C6:.5 Bb5:2 | A5:.5 C#6:.5 E6:.5 G6:.5 E6:2"
CH_INTRO = "Dm | Bbmaj7 | Gm | A7"

A = ("A4:1.5 D5:.5 F5:1 E5:1 | D5:2 C5:1 A4:1 | Bb4:1.5 A4:.5 F4:1 D5:1 | C#5:1.5 D5:.5 E5:2 | "
     "F5:1.5 E5:.5 D5:1 A5:1 | A5:1.5 G5:.5 F5:1 C5:1 | Bb4:1.5 C5:.5 D5:1 G5:1 | A4:1 C#5:1 E5:2")
CH_A = "Dm | Dm/C | Bbmaj7 | A | Dm | F/C | Gm | A"
Av = ("A4:1.5 D5:.5 F5:1 E5:1 | D5:2 C5:1 A4:1 | Bb4:1.5 A4:.5 F4:1 D5:1 | C#5:1.5 D5:.5 E5:2 | "
      "F5:1.5 E5:.5 D5:1 A5:1 | A5:1.5 G5:.5 F5:1 C5:1 | Bb5:1.5 A5:.5 G5:1 D5:1 | E5:2 G5:1 C5:1")
CH_Av = "Dm | Dm/C | Bbmaj7 | A | Dm | F/C | Gm | C7"

B = ("A5:3 G5:.5 F5:.5 | G5:2 E5:2 | F5:1.5 E5:.5 D5:1 A4:1 | Bb4:2 D5:1 F5:1 | "
     "A5:2 C6:2 | Bb5:1.5 A5:.5 G5:1 F5:1 | F5:1 D5:1 A5:2 | G5:1 E5:1 C#5:2")
CH_B = "F | C/E | Dm | Bb | F/A | Gm7 | Bbmaj7 | A7"

C = ("D3:1 F3:1 A3:1.5 G3:.5 | F3:2 D3:2 | G3:1 Bb3:1 D4:1.5 C4:.5 | C#4:3 A3:1 | "
     "D4:1 F4:1 A4:1.5 G4:.5 | F4:2 Bb3:2 | G4:1.5 F4:.5 Eb4:1 Bb3:1 | C#4:2 E4:1 G4:1")
CH_C = "Dm | Bb | Gm | A | Dm | Bb | Eb | A7"

OUTRO = "A5:.5 D6:.5 F6:.5 E6:.5 D6:2 | r:.5 D6:.5 F6:.5 A6:.5 F6:2 | G5:.5 Bb5:.5 D6:.5 C6:.5 Bb5:2 | F#5:.5 A5:.5 D6:3"
CH_OUT = "Dm | Bbmaj7 | Gm6 | D"

LUFS = -19.5
ROOM = 0.88
REVERB = 0.85


def build():
    s = Song(TITLE, 72, beats=4, seed=44)
    s.inst('celesta', 'celesta', 84, 76, 90)
    s.inst('ehorn', 'ehorn', 96, 56, 75)
    s.inst('flute', 'flute', 80, 70, 85)
    s.inst('harp', 'harp', 80, 86, 85)
    s.inst('strings', 'slowstr', 80, 64, 90)
    s.inst('violins', 'strings', 82, 74, 80)
    s.inst('choir', 'oohs', 74, 50, 95)
    s.inst('cello', 'cello', 94, 52, 70)
    s.inst('basses', 'contrabass', 80, 64, 60)
    s.inst('pulse', 'strings', 64, 40, 60)
    s.inst('timp', 'timpani', 70, 64, 70)
    s.inst('oboe', 'oboe', 82, 60, 80)

    ch, n = s.chords(CH_INTRO)
    s.melody('celesta', INTRO, 70)
    s.pad('strings', ch, 46, 50, 69)
    s.expr('strings', s.t, n, 30, 90)
    s.bass('basses', ch, 50, 'root', octave=1)
    s.adv(n)

    ch, n = s.chords(CH_A)
    s.melody('ehorn', A, 86)
    s.arp('harp', ch, [0, 2, 3, 4, 5, 4, 3, 2], 0.5, 50, base=50)
    s.pad('strings', ch, 48, 50, 69)
    s.bass('basses', ch, 60, 'root', octave=1)
    s.adv(n)

    ch, n = s.chords(CH_Av)
    s.melody('celesta', Av, 72, octave=1)
    s.melody('flute', Av, 72)
    s.guide('ehorn', ch, 57, 67, 52, rhythm=[2, 2])
    s.arp('harp', ch, [0, 2, 3, 4, 5, 4, 3, 2], 0.5, 46, base=50)
    s.pad('strings', ch, 50, 50, 69)
    s.bass('basses', ch, 62, 'root', octave=1)
    s.adv(n)

    # B: a glimpse of daylight in F major
    ch, n = s.chords(CH_B)
    s.melody('violins', B, 80)
    s.pad('choir', ch, 50, 53, 72)
    s.expr('choir', s.t, n, 60, 110)
    s.arp('harp', ch, [0, 1, 2, 3, 4, 3, 2, 1], 0.5, 48, base=48)
    s.guide('cello', ch, 48, 60, 62)
    s.bass('basses', ch, 64, 'root', octave=1)
    s.adv(n)

    # C: deeper, the floor trembles. cello solo over a pulse, Neapolitan Eb at bar 7
    ch, n = s.chords(CH_C)
    s.melody('cello', C, 92)
    s.arp('pulse', ch, [0, 1, 2, 1, 0, 1, 2, 1], 0.5, 52, base=50, legato=0.6)
    s.expr('pulse', s.t, n, 60, 115)
    s.pad('choir', ch, 44, 55, 72)
    s.bass('basses', ch, 70, 'half', octave=1)
    for st, d, c in ch:
        s.note('timp', st, 1, 38 if c.root == 2 else 45 if c.root == 9 else 43 if c.root == 7 else 46, 56, 0.9)
    s.adv(n)

    # A'': the theme returns on strings with oboe, choir glows
    ch, n = s.chords(CH_A)
    s.melody('violins', A, 84)
    s.melody('oboe', A, 70, octave=-1)
    s.pad('choir', ch, 54, 53, 72)
    s.arp('harp', ch, [0, 2, 3, 4, 5, 4, 3, 2], 0.5, 52, base=50)
    s.guide('cello', ch, 45, 57, 70, rhythm=[2, 2])
    s.bass('basses', ch, 66, 'root', octave=1)
    s.adv(n)

    # outro: celesta again, ends on a D major chord (the lantern holds)
    ch, n = s.chords(CH_OUT)
    s.melody('celesta', OUTRO, 66)
    s.pad('strings', ch, 46, 50, 69)
    s.pad('choir', ch, 40, 53, 72)
    s.expr('strings', s.t, n, 90, 50)
    s.bass('basses', ch, 52, 'root', octave=1)
    s.rit(s.t + s.bars(2), s.bars(2), 58)
    s.adv(n)
    s.adv(4)
    return s
