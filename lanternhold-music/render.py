"""python3 render.py <track_module> [--mp3]  -> out/<id>.mid, .wav, .mp3"""
import importlib, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SF = os.environ.get('LH_SF', '/usr/share/sounds/sf3/MuseScore_General_Full.sf3')
OUT = os.environ.get('LH_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))

def render(modname, mp3=True):
    os.makedirs(OUT, exist_ok=True)
    mod = importlib.import_module('tracks.' + modname)
    song = mod.build()
    mid, wav, final = (os.path.join(OUT, modname + e) for e in ('.mid', '.wav', '.mp3'))
    length = song.save(mid)
    subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.6', '-r', '44100', '-R', '1', '-C', '1',
                    '-o', 'synth.reverb.room-size=%s' % getattr(mod, 'ROOM', 0.72),
                    '-o', 'synth.reverb.damp=0.35', '-o', 'synth.reverb.width=1.0',
                    '-o', 'synth.reverb.level=%s' % getattr(mod, 'REVERB', 0.75),
                    '-o', 'synth.polyphony=512',
                    '-F', wav, SF, mid], check=True)
    if mp3:
        # trim silence, fade the tail, gentle air, then two-pass linear loudness normalisation (no pumping)
        lufs = getattr(mod, 'LUFS', -18)
        pre = ('silenceremove=start_periods=1:start_threshold=-60dB,highpass=f=30,treble=g=1.5:f=9000,'
               'areverse,silenceremove=start_periods=1:start_threshold=-65dB,afade=t=in:d=1.5,areverse')
        r = subprocess.run(['ffmpeg', '-hide_banner', '-i', wav, '-af', pre + ',loudnorm=I=%s:TP=-1.5:LRA=20:print_format=json' % lufs,
                            '-f', 'null', '-'], capture_output=True, text=True, check=True)
        import json
        js = json.loads(r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1])
        ln = ('loudnorm=I={I}:TP=-1.5:LRA=20:measured_I={mi}:measured_TP={mtp}:measured_LRA={mlra}:'
              'measured_thresh={mth}:offset={off}:linear=true').format(I=lufs, mi=js['input_i'], mtp=js['input_tp'],
                                                                        mlra=js['input_lra'], mth=js['input_thresh'], off=js['target_offset'])
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', pre + ',' + ln, '-ar', '44100',
                        '-c:a', 'libmp3lame', '-b:a', '112k', final], check=True)
    print('%s: %.0fs midi' % (modname, length))
    if os.environ.get('LH_PUBLISH'):
        import shutil
        dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lanternhold', 'music', modname.split('_', 1)[1] + '.mp3')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(final, dst)
    return final

if __name__ == '__main__':
    for m in sys.argv[1:]:
        render(m)
