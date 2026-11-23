"""Starlit Watch - a piano nocturne for quiet hours. F major, 4/4. Piano, then cello and strings."""
from engine import Song, harm, scale_of

TITLE = 'Starlit Watch'
MOOD = 'Night, gentle'

A_HEAD = ("A5:1.5 G5:.5 F5:1 C5:1 | E5:1.5 F5:.5 G5:2 | F5:1 E5:.5 D5:.5 C5:1 A4:1 | D5:2 F5:1 A5:1 | "
          "C6:1.5 Bb5:.5 A5:1 F5:1 | Bb5:1.5 A5:.5 F5:1 D5:1")
A_HALF = "F5:1 G5:.5 A5:.5 Bb5:1 G5:1 | F5:2 E5:2"
A_FULL = "Bb5:1 A5:1 G5:1 E5:1 | F5:4"
CH_A1 = "F | C/E | Dm7 | Bbmaj7 | F/A | Bb | Gm7 | C7sus4 C7"
CH_A2 = "F | C/E | Dm7 | Bbmaj7 | F/A | Bb | Gm7 C7 | F"

B = ("F5:1 A5:1 D6:2 | C6:1.5 A5:.5 E5:2 | D6:1.5 C6:.5 Bb5:2 | A5:2 C6:1 A5:1 | "
     "Bb5:1.5 A5:.5 G5:1 D5:1 | F5:1.5 E5:.5 D5:2 | D5:1 F5:1 Bb5:1 D6:1 | C6:2 G5:1 E5:1")
CH_B = "Dm | Am | Bb | F | Gm | Dm | Bb | C"

CODA = "A5:1.5 G5:.5 F5:1 C5:1 | D5:2 F5:2 | Bb5:1 A5:1 G5:1 E5:1 | F5:4 | D5:2 C5:2 | C5:4"
CH_CODA = "F | Bb/F | Gm7 C7 | F | Bbmaj7 | F"

INTRO_CH = "F | Bbmaj7 | Gm7 | C7sus4 C7"
LH = [0, 2, 4, 5, 6, 5, 4, 2]
SC = scale_of('F')

LUFS = -19.5
ROOM = 0.8
REVERB = 0.7


def build():
    s = Song(TITLE, 74, beats=4, seed=66)
    s.inst('piano', 'piano', 100, 64, 60)
    s.inst('pianoL', 'piano', 88, 60, 60)
    s.inst('cello', 'cello', 92, 52, 70)
    s.inst('strings', 'slowstr', 72, 70, 85)
    s.inst('violin', 'violin', 84, 78, 75)
    s.inst('harp', 'harp', 70, 86, 80)

    def lh(ch, v=50, base=41):
        s.arp('pianoL', ch, LH, 0.5, v, base=base, legato=2.2, span=2)

    ch, n = s.chords(INTRO_CH)
    lh(ch, 48)
    s.melody('piano', "C6:2 A5:2 | D6:2 A5:2 | Bb5:1 A5:1 G5:1 F5:1 | F5:2 E5:2", 58)
    s.adv(n)

    ch, n = s.chords(CH_A1)
    s.melody('piano', A_HEAD + ' | ' + A_HALF, 74)
    lh(ch)
    s.adv(n)

    # second time: thirds in the right hand
    ch, n = s.chords(CH_A2)
    mel = A_HEAD + ' | ' + A_FULL
    s.melody('piano', mel, 76)
    s.melody('piano', harm(mel, SC, flats=True), 56)
    lh(ch, 52)
    s.pad('strings', ch, 36, 53, 69)
    s.adv(n)

    ch, n = s.chords(CH_B)
    s.melody('piano', B, 78)
    lh(ch, 54, base=38)
    s.pad('strings', ch, 44, 53, 69)
    s.expr('strings', s.t, n, 70, 105)
    s.guide('cello', ch, 45, 57, 56, rhythm=[2, 2])
    s.adv(n)

    # cello takes the tune, piano accompanies
    ch, n = s.chords(CH_A1)
    s.melody('cello', A_HEAD + ' | ' + A_HALF, 92, octave=-2)
    lh(ch, 50, base=53)
    s.pad('strings', ch, 40, 55, 72)
    s.adv(n)

    # B again: violin and cello in conversation, harp joins
    ch, n = s.chords(CH_B)
    s.melody('violin', B, 84, octave=-1)
    s.guide('cello', ch, 45, 57, 64, rhythm=[2, 2])
    s.arp('harp', ch, [0, 2, 3, 4, 5, 4, 3, 2], 0.5, 44, base=53)
    lh(ch, 48, base=38)
    s.pad('strings', ch, 46, 55, 72)
    s.adv(n)

    # last A on piano, everyone softly under it
    ch, n = s.chords(CH_A2)
    mel = A_HEAD + ' | ' + A_FULL
    s.melody('piano', mel, 80)
    s.melody('violin', mel, 54, octave=-1)
    lh(ch, 52)
    s.pad('strings', ch, 46, 53, 69)
    s.guide('cello', ch, 45, 57, 56, rhythm=[4])
    s.adv(n)

    ch, n = s.chords(CH_CODA)
    s.melody('piano', CODA, 70)
    lh(ch, 46)
    s.pad('strings', ch, 40, 53, 69)
    s.expr('strings', s.t, n, 100, 50)
    s.rit(s.t + s.bars(3), s.bars(3), 56)
    s.adv(n)
    s.adv(4)
    return s
