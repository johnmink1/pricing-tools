"""Ember Ring - battle. E minor, 4/4, fast. Horns, driving strings, taiko and choir; climbs to F# minor."""
from engine import Song, tr_mel, tr_chords, hits

TITLE = 'Ember Ring'
MOOD = 'Battle, driving'

A1 = ("E4:1 B4:1 E5:1.5 D5:.5 | B4:1.5 A4:.5 G4:1 F#4:1 | G4:1.5 A4:.5 B4:1 C5:1 | D5:2 F#5:1 D5:1 | "
      "E5:1 G5:1 B5:1.5 A5:.5 | G5:1.5 F#5:.5 E5:1 B4:1 | C5:1.5 B4:.5 A4:1 E5:1 | D#5:2 F#5:1 B4:1")
CH_A1 = "Em | Em | C | D | Em | Em | Am | B"
A2 = ("E5:1 B4:1 E5:1.5 F#5:.5 | G5:1.5 F#5:.5 E5:1 D5:1 | C5:1.5 D5:.5 E5:1 G5:1 | F#5:2 A5:1 F#5:1 | "
      "G5:1.5 A5:.5 B5:1 G5:1 | A5:1.5 F#5:.5 D5:1 A5:1 | G5:1 E5:1 F#5:1 D#5:1 | E5:4")
CH_A2 = "Em | Em | C | D | G | D/F# | C B | Em"

B = ("B4:1 D5:1 G5:2 | F#5:1.5 E5:.5 D5:2 | E5:1 G5:1 B5:2 | G5:1.5 E5:.5 C5:2 | "
     "D5:1 G5:1 B5:2 | C6:1.5 B5:.5 G5:2 | A5:1 F#5:1 D5:1 A5:1 | A5:4")
CH_B = "G | D | Em | C | G/B | C | D | D"

CHOIR = "E5:4 | E5:2 G5:2 | A5:4 | F#5:4 | G5:4 | E5:2 C5:2 | C5:2 E5:2 | D#5:4"
CH_C = "Em | C | Am | B | Em | C | Am | B7"

GALLOP = [0, 0, 0, 1, 0, 0, 2, 1]
OST = [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 0, 1, 2, 1]
TAIKO = {36: 'X.....x...x.....', 41: '........x.....x.', 43: '....x.......x...'}
TAIKO2 = {36: 'X..x..x...x..x..', 41: '....x.....x.x.x.', 43: '..x.....x.....xx', 38: '....x.......x...'}

ROOM = 0.7
REVERB = 0.6


def build():
    s = Song(TITLE, 144, beats=4, seed=55)
    s.inst('horns', 'horn', 104, 48, 55)
    s.inst('trumpet', 'trumpet', 86, 70, 55)
    s.inst('trombone', 'trombone', 88, 40, 50)
    s.inst('violins', 'strings', 84, 76, 50)
    s.inst('ost', 'strings', 82, 52, 40)
    s.inst('celli', 'cello', 96, 60, 40)
    s.inst('basses', 'contrabass', 90, 64, 35)
    s.inst('choir', 'choir', 84, 64, 80)
    s.inst('trem', 'tremolo', 72, 70, 70)
    s.inst('taiko', 'taiko', 100, 60, 40)
    s.inst('timp', 'timpani', 96, 64, 50)
    s.inst('drums', 0, 96, 64, 45, drum=True)

    def engine(ch, n, drums=TAIKO, dv=70, ost_v=62):
        s.arp('ost', ch, OST, 0.25, ost_v, base=52, legato=0.5)
        s.bass('celli', ch, 80, 'gallop')
        s.bass('basses', ch, 78, 'pulse', octave=1)
        hits(s, 'timp', ch, [0, 2.5], 76)
        s.drums(drums, int(n / 4), dv)

    # intro: low strings and drums
    ch, n = s.chords("Em | Em | C | B")
    s.arp('ost', ch, OST, 0.25, 56, base=52, legato=0.5)
    s.bass('celli', ch[2:], 76, 'gallop')
    s.drums(TAIKO, 2, 64, start=s.t + 8)
    s.expr('ost', s.t, n, 60, 110)
    s.adv(n)

    # A: horns
    ch, n = s.chords(CH_A1 + ' | ' + CH_A2)
    s.melody('horns', A1 + ' | ' + A2, 96, octave=0)
    s.melody('trombone', A1 + ' | ' + A2, 70, octave=-1)
    engine(ch, n)
    s.adv(n)

    # A': violins sing it high, horns punch the harmony
    ch, n = s.chords(CH_A1 + ' | ' + CH_A2)
    s.melody('violins', A1 + ' | ' + A2, 88)
    s.melody('horns', A1 + ' | ' + A2, 82, octave=-1)
    s.pad('trombone', ch, 64, 45, 60, n=3, legato=0.5)
    engine(ch, n, TAIKO2, 72)
    s.drums({49: 'X' + '.' * 15}, 1, 80)
    s.adv(n)

    # B: the tide turns, G major
    ch, n = s.chords(CH_B)
    s.melody('trumpet', B, 92)
    s.melody('violins', B, 80)
    s.guide('horns', ch, 55, 67, 80, rhythm=[1.5, 1.5, 1])
    engine(ch, n, TAIKO2, 74)
    s.drums({49: 'X' + '.' * 15}, 1, 84)
    s.adv(n)

    # C: breath before the last charge, choir over tremolo strings, drums build
    ch, n = s.chords(CH_C)
    s.melody('choir', CHOIR, 78, shape=False)
    s.expr('choir', s.t, n, 60, 120)
    s.pad('trem', ch, 60, 52, 71)
    s.expr('trem', s.t, n, 50, 120)
    s.bass('basses', ch, 70, 'root', octave=1)
    s.drums({36: 'x.......x.......'}, 4, 60)
    s.drums({36: 'x...x...x...x...', 41: '..x...x...x...x.'}, 2, 70, start=s.t + 16)
    s.drums({36: 'x.x.x.x.x.x.x.x.', 41: 'xxxxxxxxxxxxXXXX', 43: 'x.x.x.x.x.x.x.x.'}, 2, 78, start=s.t + 24)
    s.adv(n)

    # A'': up a step to F# minor, full
    ch, n = s.chords(tr_chords(CH_A1 + ' | ' + CH_A2, 2))
    mel = tr_mel(A1 + ' | ' + A2, 2)
    s.melody('horns', mel, 100)
    s.melody('trumpet', mel, 80)
    s.melody('violins', mel, 86)
    s.melody('choir', mel, 64)
    engine(ch, n, TAIKO2, 78, 66)
    s.drums({49: 'X' + '.' * 15}, 1, 90)
    s.adv(n)

    # B'': A major, triumphant
    ch, n = s.chords(tr_chords(CH_B, 2))
    mel = tr_mel(B, 2)
    s.melody('trumpet', mel, 96)
    s.melody('violins', mel, 86)
    s.melody('horns', mel, 90)
    s.pad('choir', ch, 66, 55, 72)
    engine(ch, n, TAIKO2, 80, 66)
    s.drums({49: 'X' + '.' * 15}, 1, 90)
    s.adv(n)

    # outro: three hammer blows and a held F# minor
    ch, n = s.chords("D | E | F#m | F#m")
    for k, (st, d, c) in enumerate(ch[:2]):
        s.pad('horns', [(st, 1.5, c)], 100, 54, 66, n=3)
        s.pad('trombone', [(st, 1.5, c)], 96, 43, 58, n=3)
        s.pad('violins', [(st, 1.5, c)], 96, 66, 81, n=3)
        s.note('basses', st, 1.5, 38 + (2 if k else 0), 100)
        s.drums({36: 'X.....x.X.......', 49: 'X...............'}, 1, 90, start=st)
    st = ch[2][0]
    fm = ch[2][2]
    for nm, lo, hi in (('horns', 54, 66), ('trombone', 42, 57), ('violins', 66, 81), ('choir', 57, 72), ('trem', 54, 70)):
        s.pad(nm, [(st, 8, fm)], 100, lo, hi, n=3)
    s.note('basses', st, 8, 42, 100)
    s.note('celli', st, 8, 54, 96)
    for k in range(32):
        s.note('timp', st + k * 0.25, 0.25, 42, 50 + k * 2, 0.9)
    s.drums({36: 'X...............', 49: 'X...............'}, 1, 100, start=st)
    s.rit(st - 2, 2, 120)
    s.adv(n)
    return s
