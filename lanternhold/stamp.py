"""Stamp a new build id into index.html (cache-busting ?v= on assets, window.LH_BUILD) and version.json.
Run before each release: python3 lanternhold/stamp.py. Open games reload by themselves once every file of the new build is live."""
import os, re, json, time
here = os.path.dirname(os.path.abspath(__file__))
build = time.strftime('%Y%m%d%H%M', time.gmtime())
p = os.path.join(here, 'index.html'); s = open(p).read()
s = re.sub(r'(href="style\.css)(\?v=\w+)?"', r'\1?v=' + build + '"', s)
for js in ('core', 'sprites', 'vector', 'ui'):
    s = re.sub(r'(src="' + js + r'\.js)(\?v=\w+)?"', r'\1?v=' + build + '"', s)
if 'window.LH_BUILD' in s: s = re.sub(r'window\.LH_BUILD = "\w*";', 'window.LH_BUILD = "' + build + '";', s)
else: s = s.replace('<script>window.LH_SUPPORT_URL', '<script>window.LH_BUILD = "' + build + '";</script>\n<script>window.LH_SUPPORT_URL', 1)
# A build marker at the top of every file lets open games check that the web host is handing out the
# new files (its cache ignores query strings and keeps each file up to 10 minutes) before they reload.
mark = re.compile(r'^(<!-- lh-build \w+ -->|/\* lh-build \w+ \*/)\n', re.M)
s = mark.sub('', s); s = s.replace('<!doctype html>\n', '<!doctype html>\n<!-- lh-build ' + build + ' -->\n', 1)
open(p, 'w').write(s)
for f in ('core.js', 'sprites.js', 'vector.js', 'ui.js', 'style.css'):
    fp = os.path.join(here, f); t = mark.sub('', open(fp).read())
    open(fp, 'w').write('/* lh-build ' + build + ' */\n' + t)
json.dump({'build': build}, open(os.path.join(here, 'version.json'), 'w'))
print('build', build)
