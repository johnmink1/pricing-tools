"""The Lost Lantern Tavern - a jig. E dorian, 6/8. Fiddle, tin whistle, accordion, guitar and bodhran."""
from engine import Song

TITLE = 'The Lost Lantern Tavern'
MOOD = 'Tavern, lively'

A1 = ("E5:1 B4:.5 E5:.5 F#5:.5 G5:.5 | F#5:1 D5:.5 A4:.5 D5:.5 F#5:.5 | E5:.5 F#5:.5 G5:.5 B5:1 G5:.5 | "
      "F#5:.5 E5:.5 D5:.5 A4:.5 B4:.5 D5:.5")
A_END1 = "E5:1 B4:.5 E5:.5 F#5:.5 G5:.5 | A5:1 F#5:.5 D5:.5 E5:.5 F#5:.5 | G5:.5 E5:.5 C5:.5 D5:.5 F#5:.5 A5:.5 | G5:.5 F#5:.5 D5:.5 E5:1.5"
A1v = ("E5:.5 D5:.5 B4:.5 E5:.5 F#5:.5 G5:.5 | A5:.5 F#5:.5 D5:.5 A4:.5 D5:.5 F#5:.5 | E5:.5 F#5:.5 G5:.5 B5:.5 A5:.5 G5:.5 | "
       "F#5:.5 E5:.5 D5:.5 A4:.5 B4:.5 D5:.5")
A_END2 = "E5:.5 G5:.5 B5:.5 E6:1 B5:.5 | A5:.5 B5:.5 A5:.5 F#5:.5 E5:.5 D5:.5 | C5:.5 E5:.5 G5:.5 A5:.5 F#5:.5 D5:.5 | E5:1.5 E4:1.5"
CH_A = "Em | D | Em | D | Em | D | C D | Em"

B1 = ("B5:1 G5:.5 B5:.5 A5:.5 G5:.5 | A5:1 F#5:.5 D5:1 F#5:.5 | G5:.5 F#5:.5 E5:.5 B4:.5 E5:.5 G5:.5 | "
      "B5:.5 A5:.5 G5:.5 F#5:.5 E5:.5 D5:.5")
B_END1 = "B5:1 G5:.5 B5:.5 A5:.5 G5:.5 | A5:1 B5:.5 D6:1 A5:.5 | G5:.5 E5:.5 C5:.5 D5:.5 F#5:.5 A5:.5 | G5:.5 F#5:.5 D5:.5 E5:1.5"
B_END2 = "D6:1 B5:.5 G5:1 B5:.5 | A5:.5 B5:.5 A5:.5 F#5:.5 D5:.5 F#5:.5 | G5:.5 E5:.5 C5:.5 D5:.5 F#5:.5 A5:.5 | B5:1 A5:.5 E5:1.5"
CH_B = "G | D | Em | Em | G | D | C D | Em"

C = ("E5:1.5 G5:1 E5:.5 | D5:1.5 B4:1.5 | C5:1 E5:.5 A5:1 G5:.5 | F#5:1.5 A5:1.5 | "
     "G5:1 E5:.5 C5:1 E5:.5 | D5:1 B4:.5 G5:1.5 | A5:1 C6:.5 B5:1 A5:.5 | B5:3")
CH_C = "C | G | Am | D | C | G | Am D | B7"

# a harmony part a third/sixth under the B tune, for the last pass
B1h = ("G5:1 E5:.5 G5:.5 F#5:.5 E5:.5 | F#5:1 D5:.5 A4:1 D5:.5 | E5:.5 D5:.5 B4:.5 G4:.5 B4:.5 E5:.5 | "
       "G5:.5 F#5:.5 E5:.5 D5:.5 B4:.5 A4:.5")
B_END1h = "G5:1 E5:.5 G5:.5 F#5:.5 E5:.5 | F#5:1 G5:.5 A5:1 F#5:.5 | E5:.5 C5:.5 G4:.5 A4:.5 D5:.5 F#5:.5 | E5:.5 D5:.5 A4:.5 B4:1.5"

BODH = {45: 'X..x.x', 48: '..o..o', 54: '..x..x'}
BODH2 = {45: 'X.xX.x', 48: '.o..oo', 54: '.xx.xx'}


def chop(s, name, chords, vel=52, lo=55, hi=71):
    for st, d, c in chords:
        v = s.voice(name, c, lo, hi, 3)
        b = 0.5
        while b < d - 1e-6:
            if abs(b % 1.5) > 1e-6:
                for m in v:
                    s.note(name, st + b, 0.4, m, vel * (1 if abs(b % 1.5 - 0.5) < 1e-6 else 0.8), 0.8)
            b += 0.5


def build():
    s = Song(TITLE, 168, beats=3, seed=33)
    s.inst('fiddle', 'fiddle', 92, 70, 55)
    s.inst('whistle', 'whistle', 80, 52, 60)
    s.inst('accordion', 'accordion', 66, 40, 45)
    s.inst('guitar', 'steel', 74, 86, 45)
    s.inst('bass', 'pizz', 90, 60, 40)
    s.inst('cello', 'cello', 70, 64, 50)
    s.inst('drums', 0, 92, 64, 40, drum=True)
    REVERB = 0.5

    def rhythm(ch, n, drums=BODH, guitar=True, accordion=True, dv=62):
        s.bass('bass', ch, 82, 'half', octave=2)
        if guitar:
            s.strum('guitar', ch, [0, 1.5], 56, roll=0.02)
        if accordion:
            chop(s, 'accordion', ch)
        s.drums(drums, int(n / 3), dv, step=0.5)

    # intro: guitar and bodhran count in
    ch, n = s.chords("Em | D | C D | Em")
    s.strum('guitar', ch, [0, 1.5], 58, roll=0.02)
    s.drums(BODH, 2, 54, start=s.t + 6, step=0.5)
    s.adv(n)

    # A A on fiddle
    for i, (a_end) in enumerate((A_END1, A_END2)):
        ch, n = s.chords(CH_A)
        s.melody('fiddle', (A1 if i == 0 else A1v) + ' | ' + a_end, 86)
        rhythm(ch, n, accordion=i == 1)
        s.adv(n)
    # B B on fiddle, whistle joins second time
    for i, b_end in enumerate((B_END1, B_END2)):
        ch, n = s.chords(CH_B)
        s.melody('fiddle', B1 + ' | ' + b_end, 86)
        if i == 1:
            s.melody('whistle', B1 + ' | ' + b_end, 66, octave=0)
        rhythm(ch, n)
        s.adv(n)
    # A A on whistle, fiddle answers with long notes
    for i, a_end in enumerate((A_END1, A_END2)):
        ch, n = s.chords(CH_A)
        s.melody('whistle', (A1 if i == 0 else A1v) + ' | ' + a_end, 84)
        s.guide('fiddle', ch, 62, 74, 54, rhythm=[1.5, 1.5])
        rhythm(ch, n)
        s.adv(n)
    # C: the slow-hearted part in G, cello under the fiddle, lighter drums
    ch, n = s.chords(CH_C)
    s.melody('fiddle', C, 84)
    s.guide('cello', ch, 45, 57, 70, rhythm=[3])
    s.bass('bass', ch, 74, 'half', octave=2)
    s.strum('guitar', ch, [0, 1, 1.5, 2.5], 52, roll=0.02)
    s.drums({45: 'x.....', 54: '...x..'}, 8, 50, step=0.5)
    s.adv(n)
    ch, n = s.chords(CH_C)
    s.melody('whistle', C, 80)
    s.melody('fiddle', C, 70, octave=-1)
    s.guide('cello', ch, 45, 57, 70, rhythm=[3])
    s.bass('bass', ch, 78, 'half', octave=2)
    chop(s, 'accordion', ch)
    s.strum('guitar', ch, [0, 1.5], 54, roll=0.02)
    s.drums({45: 'x..x..', 54: '..x..x'}, 8, 56, step=0.5)
    s.adv(n)
    # break: just accordion + bodhran
    ch, n = s.chords("Em | D | Em | D | C | D | C D | B7")
    chop(s, 'accordion', ch, 64)
    s.bass('bass', ch, 76, 'half', octave=2)
    s.drums(BODH2, 8, 66, step=0.5)
    s.adv(n)
    # full: A with both, B in harmony
    ch, n = s.chords(CH_A)
    s.melody('fiddle', A1v + ' | ' + A_END1, 90)
    s.melody('whistle', A1v + ' | ' + A_END1, 72)
    rhythm(ch, n, BODH2, dv=66)
    s.adv(n)
    for i in range(2):
        ch, n = s.chords(CH_B)
        s.melody('fiddle', B1 + ' | ' + B_END1, 90)
        s.melody('whistle', B1h + ' | ' + B_END1h, 72)
        rhythm(ch, n, BODH2, dv=66)
        if i == 1:
            s.rit(s.t + s.bars(6), s.bars(2), 140)
        s.adv(n)
    # button ending
    ch, n = s.chords("Em")
    s.strum('guitar', ch, [0], 70, roll=0.03)
    s.note('fiddle', s.t, 2.5, 64, 90)
    s.note('whistle', s.t, 2.5, 76, 74)
    s.note('bass', s.t, 1, 40, 90)
    s.drums({45: 'X.....'}, 1, 80, step=0.5)
    s.adv(n)
    return s


REVERB = 0.55
ROOM = 0.6
