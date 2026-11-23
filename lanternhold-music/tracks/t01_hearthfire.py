"""Hearthfire Waltz - the camp theme. D major, 3/4. Folk waltz: flute and violin over nylon guitar and harp."""
from engine import Song

TITLE = 'Hearthfire Waltz'
MOOD = 'Camp, warm and unhurried'

THEME_A1 = ("A4:1 D5:1 E5:1 | F#5:2 E5:.5 F#5:.5 | G5:1.5 F#5:.5 E5:1 | D5:2 A4:1 | "
            "B4:1 D5:1 F#5:1 | G5:2 F#5:.5 E5:.5 | A4:1 C#5:1 E5:1 | G5:2 E5:1")
THEME_A2 = ("F#5:2 E5:.5 D5:.5 | A5:2 F#5:1 | B5:2 A5:.5 G5:.5 | Bb4:1 D5:1 G5:1 | "
            "F#5:1.5 E5:.5 D5:1 | E5:2 C#5:1 | D5:3 | r:1 A4:1 B4:1")
CH_A = "D | D | G | D | Bm | Em | A7 | A7 | D | D | G | Gm | D/A | A7 | D | D"

# second time: ornamented, turns and passing notes instead of a literal repeat
THEME_A1v = ("A4:.5 B4:.5 D5:1 E5:1 | F#5:1.5 G5:.5 F#5:.5 E5:.5 | G5:1 A5:.5 G5:.5 F#5:.5 E5:.5 | D5:2 A4:1 | "
             "B4:.5 C#5:.5 D5:1 F#5:1 | G5:1.5 A5:.5 G5:.5 E5:.5 | A4:1 C#5:.5 D5:.5 E5:1 | G5:1.5 F#5:.5 E5:1")
THEME_A2v = ("F#5:1 G5:.5 F#5:.5 E5:.5 D5:.5 | A5:2 F#5:.5 A5:.5 | D6:1.5 B5:.5 A5:.5 G5:.5 | Bb5:1.5 A5:.5 G5:1 | "
             "F#5:1.5 E5:.5 D5:.5 F#5:.5 | E5:2 C#5:1 | D5:3 | r:1 A4:1 B4:1")

THEME_B = ("B4:1.5 C#5:.5 D5:1 | F#5:2 D5:1 | E5:1 D5:1 B4:1 | D5:3 | "
           "F#5:1.5 E5:.5 D5:1 | A5:2 F#5:1 | G5:1.5 F#5:.5 E5:1 | E5:1 C#5:1 A#4:1 | "
           "B4:1.5 C#5:.5 D5:1 | F#5:2 B5:1 | B5:1.5 A5:.5 G5:1 | C#5:1 E5:1 A5:1 | "
           "F#5:2 E5:.5 D5:.5 | F#5:1 D5:1 B4:1 | G5:1.5 F#5:.5 E5:1 | E5:1 C#5:1 A4:1")
CH_B = "Bm | Bm | G | G | D | D | Em | F#7 | Bm | Bm | G | A | D | Bm | Em7 | A7"

BRIDGE = ("B5:2 A5:.5 G5:.5 | A5:2 E5:1 | F#5:2 E5:.5 C#5:.5 | D5:2 F#5:1 | "
          "G5:2 F#5:.5 E5:.5 | D5:1 E5:1 A5:1 | C#6:2 B5:.5 A5:.5 | G5:3")
CH_BR = "Gmaj7 | A | F#m | Bm | Em7 | A7sus4 | A7 | A7"

OUTRO = ("A4:1 D5:1 E5:1 | F#5:2 E5:.5 F#5:.5 | G5:1.5 F#5:.5 E5:1 | D5:2 A4:1 | "
         "B4:1 D5:1 G5:1 | F#5:2 E5:1 | D5:3 | D5:3")
CH_OUT = "D | D | G | D | G | D/A A7 | D | D"

CH_INTRO = "D | G/D | D | A/C# | Bm | G | Em7 | A7"
ARP = [0, 2, 3, 4, 3, 2]


def build():
    s = Song(TITLE, 96, beats=3, seed=11)
    s.inst('flute', 'flute', 92, 54, 70)
    s.inst('violin', 'violin', 88, 74, 70)
    s.inst('guitar', 'nylon', 84, 50, 50)
    s.inst('harp', 'harp', 80, 84, 70)
    s.inst('cello', 'cello', 86, 60, 55)
    s.inst('strings', 'slowstr', 70, 64, 80)
    s.inst('horn', 'horn', 66, 44, 70)
    s.inst('clar', 'clarinet', 86, 58, 65)
    s.inst('celesta', 'celesta', 80, 70, 80)
    s.inst('oboe', 'oboe', 80, 56, 70)

    # Intro: harp alone, strings breathe in
    ch, n = s.chords(CH_INTRO)
    s.arp('harp', ch, ARP, 0.5, 58, base=50)
    s.pad('strings', ch, 46, 54, 72)
    s.expr('strings', s.t, n, 40, 100)
    s.bass('cello', ch[4:], 52, 'root')
    s.adv(n)

    # A: flute sings, guitar waltz
    ch, n = s.chords(CH_A)
    s.melody('flute', THEME_A1 + ' | ' + THEME_A2, 84)
    s.bass('cello', ch, 72, 'waltz')
    s.waltz('guitar', ch, 54)
    s.arp('harp', ch[8:], [0, None, 2, None, 3, None], 0.5, 44, base=62)
    s.adv(n)

    # A': violin takes it, ornamented; flute answers with a counter line
    ch, n = s.chords(CH_A)
    s.melody('violin', THEME_A1v + ' | ' + THEME_A2v, 82)
    s.guide('flute', ch, 74, 86, 54, rhythm=[2, 1])
    s.bass('cello', ch, 74, 'waltz')
    s.waltz('guitar', ch, 52)
    s.pad('strings', ch, 42, 52, 69)
    s.adv(n)

    # B: the minor turn, clarinet over harp
    ch, n = s.chords(CH_B)
    s.melody('clar', THEME_B, 84)
    s.arp('harp', ch, ARP, 0.5, 56, base=47)
    s.pad('strings', ch, 48, 52, 70)
    s.bass('cello', ch, 70, 'half')
    s.guide('horn', ch[8:], 55, 67, 46)
    s.adv(n)

    # Bridge: strings swell, violin up high, horn underneath
    ch, n = s.chords(CH_BR)
    s.melody('violin', BRIDGE, 88)
    s.pad('strings', ch, 60, 52, 72)
    s.expr('strings', s.t, n, 70, 112)
    s.guide('horn', ch, 57, 67, 58)
    s.arp('harp', ch, [0, 1, 2, 3, 4, 5], 0.5, 50, base=50)
    s.bass('cello', ch, 74, 'root')
    s.adv(n)

    # A'': everyone home. flute + oboe in octaves, violin above in the second half
    ch, n = s.chords(CH_A)
    s.melody('flute', THEME_A1 + ' | ' + THEME_A2v, 86, octave=0)
    s.melody('oboe', THEME_A1 + ' | ' + THEME_A2v, 70, octave=-1)
    s.waltz('guitar', ch, 56)
    s.bass('cello', ch, 78, 'waltz')
    s.pad('strings', ch, 50, 52, 70)
    s.guide('horn', ch, 55, 66, 50, rhythm=[3])
    s.arp('harp', ch, [4, 3, 2, 3, 2, 1], 0.5, 46, base=60)
    s.adv(n)

    # Outro: celesta remembers the tune, harp and strings slow to a close
    ch, n = s.chords(CH_OUT)
    s.melody('celesta', OUTRO, 74)
    s.arp('harp', ch, ARP, 0.5, 48, base=50)
    s.pad('strings', ch, 44, 54, 72)
    s.expr('strings', s.t, n, 100, 60)
    s.bass('cello', ch, 60, 'root')
    s.rit(s.t + s.bars(4), s.bars(4), 70)
    s.adv(n)
    return s
