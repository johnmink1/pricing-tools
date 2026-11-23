"""Market of Many Lanterns - a playful stroll. A dorian, swung 4/4. Clarinet, bassoon, pizzicato, marimba."""
from engine import Song, stabs

TITLE = 'Market of Many Lanterns'
MOOD = 'Market, playful'

A_HEAD = ("A4:.5 C5:.5 E5:.5 A5:.5 G5:1 E5:1 | F#5:1 D5:.5 E5:.5 F#5:1 A5:1 | E5:.5 D5:.5 C5:.5 B4:.5 A4:1 E4:1 | "
          "F#4:.5 A4:.5 D5:.5 F#5:.5 E5:2 | G5:.5 E5:.5 C5:.5 E5:.5 G5:1 C6:1 | B5:1 G5:.5 D5:.5 B4:1 D5:1")
A_OPEN = "C5:.5 B4:.5 A4:.5 C5:.5 E5:1 A5:1 | G#5:1.5 E5:.5 B4:1 r:1"
A_SHUT = "C5:.5 B4:.5 A4:.5 B4:.5 D5:1 F#5:1 | A5:2 E5:1 A4:1"
CH_A1 = "Am | D | Am | D | C | G | Am | E7"
CH_A2 = "Am | D | Am | D | C | G | Am D | Am"

B = ("A5:1 C6:1 A5:.5 G5:.5 F5:1 | G5:1.5 D5:.5 B4:2 | E5:.5 G5:.5 B5:.5 G5:.5 E5:1 B4:1 | C5:1 E5:1 A5:2 | "
     "F5:.5 E5:.5 D5:.5 F5:.5 A5:1 C6:1 | B5:1.5 A5:.5 G5:1 D5:1 | E5:1 F5:.5 A5:.5 C6:1 A5:1 | G#5:2 B5:1 E5:1")
CH_B = "F | G | Em | Am | Dm7 | G | Fmaj7 | E7"

C = ("C6:2 A5:1 E5:1 | D5:1.5 E5:.5 G5:2 | F5:1.5 E5:.5 D5:1 A4:1 | E5:2 B4:2 | "
     "A5:1.5 G5:.5 F5:1 C6:1 | B5:2 G5:1 E5:1 | A5:1.5 G5:.5 F5:1 D5:1 | A5:2 G#5:2")
CH_C = "Fmaj7 | Em7 | Dm7 | Cmaj7 | Fmaj7 | Em7 | Dm7 | E7sus4 E7"

PERC = {70: 'x.o.x.o.x.o.x.o.', 76: '....x.......x...'}
PERC2 = {70: 'x.o.x.o.x.o.x.o.', 76: '....x.......x..x', 54: '..x...x...x...x.'}
ROOM = 0.6
REVERB = 0.55


def build():
    s = Song(TITLE, 116, beats=4, seed=77, swing=0.09)
    s.inst('clar', 'clarinet', 94, 56, 55)
    s.inst('bassoon', 'bassoon', 92, 46, 50)
    s.inst('flute', 'flute', 86, 76, 60)
    s.inst('oboe', 'oboe', 88, 64, 65)
    s.inst('pizz', 'pizz', 84, 70, 50)
    s.inst('pbass', 'pizz', 92, 58, 40)
    s.inst('marimba', 'marimba', 82, 36, 50)
    s.inst('strings', 'strings', 64, 64, 70)
    s.inst('guitar', 'nylon', 70, 90, 45)
    s.inst('drums', 0, 80, 64, 40, drum=True)

    def band(ch, n, perc=PERC, mar=True):
        s.bass('pbass', ch, 80, 'walk', octave=2, legato=0.6)
        stabs(s, 'pizz', ch, [1, 3], 56, 57, 72, 0.3)
        if mar:
            s.arp('marimba', ch, [0, 2, 1, 2, 3, 2, 1, 2], 0.5, 50, base=55, legato=0.8)
        s.drums(perc, int(n / 4), 56)

    ch, n = s.chords("Am | D | Am | E7")
    s.bass('pbass', ch, 76, 'walk', octave=2, legato=0.6)
    s.drums(PERC, 2, 50, start=s.t + 8)
    stabs(s, 'pizz', ch[2:], [1, 3], 52, 57, 72, 0.3)
    s.adv(n)

    ch, n = s.chords(CH_A1)
    s.melody('clar', A_HEAD + ' | ' + A_OPEN, 86, legato=0.7)
    band(ch, n, mar=False)
    s.adv(n)
    # bassoon answers down low, clarinet joins for the close
    ch, n = s.chords(CH_A2)
    s.melody('bassoon', A_HEAD + ' | ' + A_SHUT, 90, octave=-1, legato=0.7)
    s.melody('clar', "r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | " + A_SHUT, 80, legato=0.7)
    band(ch, n)
    s.adv(n)

    ch, n = s.chords(CH_B)
    s.melody('flute', B, 84, legato=0.8)
    s.guide('clar', ch, 60, 72, 56, rhythm=[1.5, 2.5])
    band(ch, n, PERC2)
    s.adv(n)

    ch, n = s.chords(CH_A2)
    s.melody('clar', A_HEAD + ' | ' + A_SHUT, 88, legato=0.7)
    s.melody('flute', A_HEAD + ' | ' + A_SHUT, 70, octave=1, legato=0.7)
    s.melody('bassoon', A_HEAD + ' | ' + A_SHUT, 74, octave=-1, legato=0.7)
    band(ch, n, PERC2)
    s.adv(n)

    # C: the lantern-maker's stall, slower-feeling and warm (oboe, strings, guitar)
    ch, n = s.chords(CH_C)
    s.melody('oboe', C, 86)
    s.pad('strings', ch, 50, 52, 69)
    s.strum('guitar', ch, [0, 1.5, 2.5], 50, roll=0.03)
    s.bass('pbass', ch, 72, 'half', octave=2, legato=0.6)
    s.drums({70: 'x...x...x...x...'}, 8, 44)
    s.adv(n)

    ch, n = s.chords(CH_B)
    s.melody('flute', B, 84, legato=0.8)
    s.melody('oboe', B, 64, octave=-1, legato=0.8)
    band(ch, n, PERC2)
    s.adv(n)

    ch, n = s.chords(CH_A2)
    s.melody('clar', A_HEAD + ' | ' + A_SHUT, 90, legato=0.7)
    s.melody('marimba', A_HEAD + ' | ' + A_SHUT, 60, octave=1, legato=0.6)
    s.melody('bassoon', A_HEAD + ' | ' + A_SHUT, 76, octave=-1, legato=0.7)
    s.bass('pbass', ch, 80, 'walk', octave=2, legato=0.6)
    stabs(s, 'pizz', ch, [1, 3], 56, 57, 72, 0.3)
    s.drums(PERC2, 8, 58)
    s.adv(n)

    # tag: a wink at the end
    ch, n = s.chords("D | Am")
    s.melody('clar', "F#5:.5 E5:.5 D5:.5 F#5:.5 A5:1 r:1 | A4:.5 r:3.5", 84, legato=0.6)
    s.melody('bassoon', "D4:1 r:3 | A2:.5 r:3.5", 84, legato=0.6)
    stabs(s, 'pizz', ch[1:], [0], 70, 57, 72, 0.3)
    s.drums({76: 'x...............'}, 1, 70, start=s.t + 4)
    s.adv(n)
    return s
