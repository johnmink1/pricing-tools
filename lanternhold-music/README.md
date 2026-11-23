# Lanternhold music

Source for the game's soundtrack. Each track in `tracks/` is a hand-written score (melodies, chord charts,
arrangement) rendered by `engine.py` to MIDI, then to audio with FluidSynth and the MuseScore General
SoundFont (MIT). `analyze.py` flags sustained semitone clashes between parts.

    apt-get install fluidsynth musescore-general-soundfont ffmpeg && pip install mido
    LH_PUBLISH=1 python3 render.py t01_hearthfire   # writes lanternhold/music/hearthfire.mp3

MP3s are 112 kbps, loudness-normalised (two-pass, linear) to -18 LUFS (-19.5 for quiet pieces).
After changing a track, update its length in `lanternhold/music.js`.
