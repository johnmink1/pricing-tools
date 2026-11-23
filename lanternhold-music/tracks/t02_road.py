"""Road to the Shattered Reach - travel and adventure. G major, rising to A major. Horns over driving strings."""
from engine import Song, tr_mel, tr_chords, hits

TITLE = 'Road to the Shattered Reach'
MOOD = 'Adventure, setting out'

A1 = ("G4:1.5 A4:.5 B4:1 D5:1 | F#4:1 A4:1 D5:2 | E5:1.5 D5:.5 B4:1 G4:1 | E5:3 D5:1 | "
      "D5:1.5 B4:.5 G4:1 B4:1 | C5:1.5 E5:.5 G5:2 | G5:1 E5:1 C5:1 A4:1 | D5:3 r:1")
A2 = ("G4:1.5 A4:.5 B4:1 D5:1 | A4:1 D5:1 F#5:2 | G5:1.5 F#5:.5 E5:1 B4:1 | C5:1 E5:1 G5:1 E5:1 | "
      "A5:1.5 G5:.5 E5:1 C5:1 | D5:1 E5:1 F#5:1 A5:1 | G5:4 | r:4")
CH_A = "G | D/F# | Em | C | G/B | C | Am7 | D | G | D/F# | Em | C | Am | D | G | G"

B = ("B4:2 E5:2 | G5:3 E5:1 | D5:2 B4:1 G4:1 | A4:2 D5:2 | "
     "E5:1 F#5:1 G5:1 B5:1 | C6:2 B5:1 G5:1 | A5:1.5 G5:.5 E5:1 C5:1 | D5:2 F#5:1 A5:1")
CH_B = "Em | C | G | D | Em | C | Am | D7"

C = ("E4:1.5 F#4:.5 G4:1 B4:1 | E5:1.5 D5:.5 B4:2 | C5:1.5 D5:.5 E5:1 G5:1 | E5:1.5 D5:.5 C5:2 | "
     "A4:1.5 B4:.5 C5:1 E5:1 | D#5:1.5 E5:.5 F#5:2 | G5:1 F#5:1 E5:1 B4:1 | G#4:1 B4:1 D5:1 E5:1")
CH_C = "Em | Em | C | C | Am | B7 | Em | E7"

CH_INTRO = "G | C/G | G | D"
OUT = "A5:4 | F#5:2 E5:2 | D5:2 F#5:2 | A5:4"
CH_OUT = "A | F#m | D | A"

OST = [0, 2, 1, 2, 0, 2, 1, 2]


def build():
    s = Song(TITLE, 112, beats=4, seed=22)
    s.inst('horn', 'horn', 100, 50, 60)
    s.inst('violins', 'strings', 82, 76, 60)
    s.inst('ost', 'strings', 76, 44, 50)
    s.inst('celli', 'cello', 92, 58, 45)
    s.inst('bass', 'contrabass', 84, 64, 40)
    s.inst('timp', 'timpani', 90, 64, 50)
    s.inst('trumpet', 'trumpet', 80, 70, 60)
    s.inst('flute', 'flute', 84, 80, 70)
    s.inst('brass', 'brass', 70, 54, 60)
    s.inst('harp', 'harp', 74, 90, 70)
    s.inst('drums', 0, 90, 64, 50, drum=True)
    snare = {38: 'o.o.o.o.o.o.x.xx', 49: ''}

    # intro: ostinato starts alone, timpani joins
    ch, n = s.chords(CH_INTRO)
    s.arp('ost', ch, OST, 0.5, 60, base=55, legato=0.55)
    s.expr('ost', s.t, n, 50, 105)
    hits(s, 'timp', ch[2:], [0, 2], 62)
    s.drums({51: 'x...............'}, 1, 40, start=s.t + s.bars(3))
    s.adv(n)

    # A: horns carry the theme an octave down, strings drive
    ch, n = s.chords(CH_A)
    s.melody('horn', A1 + ' | ' + A2, 92, octave=-1)
    s.arp('ost', ch, OST, 0.5, 64, base=55, legato=0.55)
    s.bass('celli', ch, 78, 'pulse')
    s.bass('bass', ch, 70, 'root', octave=1)
    hits(s, 'timp', ch, [0], 70)
    s.drums({38: 'o.......o...o.o.'}, 16, 46)
    s.adv(n)

    # A': violins + flute take the tune up the octave, horns pad underneath
    ch, n = s.chords(CH_A)
    s.melody('violins', A1 + ' | ' + A2, 86)
    s.melody('flute', A1 + ' | ' + A2, 64, octave=1)
    s.guide('horn', ch, 55, 67, 64, rhythm=[2, 2])
    s.arp('ost', ch, OST, 0.5, 66, base=55, legato=0.55)
    s.bass('celli', ch, 80, 'pulse')
    s.bass('bass', ch, 72, 'root', octave=1)
    hits(s, 'timp', ch, [0, 2.5], 72)
    s.drums({38: 'o...x...o.o.x...', 49: 'X' + '.' * 15}, 1, 58)
    s.drums({38: 'o...x...o.o.x...'}, 15, 56, start=s.t + 4)
    s.adv(n)

    # B: a breath in E minor, long lines, harp
    ch, n = s.chords(CH_B)
    s.melody('violins', B, 80)
    s.arp('harp', ch, [0, 1, 2, 3, 4, 3, 2, 1], 0.5, 56, base=52)
    s.pad('brass', ch, 40, 52, 67)
    s.expr('brass', s.t, n, 60, 90)
    s.bass('celli', ch, 70, 'root')
    s.bass('bass', ch, 60, 'root', octave=1)
    s.adv(n)

    # C: the storm on the road, theme in minor, gallop rhythm
    ch, n = s.chords(CH_C)
    s.melody('horn', C, 96)
    s.melody('celli', C, 80, octave=-1)
    s.bass('bass', ch, 82, 'gallop', octave=1)
    s.arp('ost', ch, [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1], 0.25, 58, base=55, legato=0.5)
    hits(s, 'timp', ch, [0, 1.5, 3], 80)
    s.drums({38: 'x.o.x.o.x.o.x.xx'}, 7, 54)
    s.drums({38: 'x.x.x.x.xxxxXXXX', 49: '...............'}, 1, 64, start=s.t + s.bars(7))
    s.expr('ost', s.t, n, 80, 115)
    s.adv(n)

    # A'': up a whole step, everything
    ch, n = s.chords(tr_chords(CH_A, 2))
    mel = tr_mel(A1 + ' | ' + A2, 2)
    s.melody('trumpet', mel, 86)
    s.melody('violins', mel, 84)
    s.melody('horn', mel, 90, octave=-1)
    s.pad('brass', ch, 56, 52, 69)
    s.arp('ost', ch, OST, 0.5, 68, base=57, legato=0.55)
    s.arp('harp', ch, [0, 2, 4, 6, 4, 2, 0, 2], 0.5, 48, base=57)
    s.bass('celli', ch, 82, 'pulse')
    s.bass('bass', ch, 76, 'root', octave=1)
    hits(s, 'timp', ch, [0, 2.5], 78)
    s.drums({38: 'o...x...o.o.x...', 49: 'X' + '.' * 15}, 1, 62)
    s.drums({38: 'o...x...o.o.x...'}, 15, 58, start=s.t + 4)
    s.adv(n)

    # outro: broad A major, timpani roll to the last chord
    ch, n = s.chords(CH_OUT)
    s.melody('violins', OUT, 86)
    s.melody('horn', OUT, 86, octave=-1)
    s.pad('brass', ch, 62, 52, 69)
    s.bass('celli', ch, 80, 'root')
    s.bass('bass', ch, 74, 'root', octave=1)
    for k in range(24):
        s.note('timp', s.t + s.bars(3) + k / 6, 0.2, 45, 50 + k * 1.5, 0.9)
    s.drums({49: 'X' + '.' * 15}, 1, 70, start=s.t + s.bars(3))
    s.rit(s.t + s.bars(2), s.bars(2), 88)
    s.adv(n)
    return s
