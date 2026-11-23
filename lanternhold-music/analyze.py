"""Harmony lint: lists sustained minor-2nd / minor-9th clashes between parts (things that sound wrong)."""
import importlib, sys, collections
sys.path.insert(0, '.')

def notes_of(song):
    inv = {c: n for n, (c, _) in song.channels.items()}
    return [(st, en, n, inv[ch]) for st, en, ch, n, v in song.notes if ch != 9]

def lint(song, beats):
    ns = sorted(notes_of(song))
    bad = collections.Counter(); where = collections.defaultdict(list)
    for i, a in enumerate(ns):
        for b in ns[i + 1:]:
            if b[0] >= a[1]:
                break
            ov = min(a[1], b[1]) - max(a[0], b[0])
            if ov < 0.7:
                continue
            iv = abs(a[2] - b[2])
            if iv in (1, 13, 25):
                key = tuple(sorted((a[3], b[3])))
                bad[key] += 1
                where[key].append(int(max(a[0], b[0]) // beats) + 1)
    return bad, where

if __name__ == '__main__':
    for m in sys.argv[1:]:
        mod = importlib.import_module('tracks.' + m)
        s = mod.build()
        bad, where = lint(s, s.beats)
        tot = len(notes_of(s))
        print(m, 'notes', tot, 'clashes', sum(bad.values()))
        for k, v in bad.most_common(12):
            print('  ', k, v, 'bars', sorted(set(where[k]))[:20])
