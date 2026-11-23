"""Stamp a new build id into index.html (cache-busting ?v= on assets, window.LH_BUILD) and version.json.
Run before each release: python3 lanternhold/stamp.py. Open games see an 'Update available' button."""
import os, re, json, time
here = os.path.dirname(os.path.abspath(__file__))
build = time.strftime('%Y%m%d%H%M', time.gmtime())
p = os.path.join(here, 'index.html'); s = open(p).read()
s = re.sub(r'(href="style\.css)(\?v=\w+)?"', r'\1?v=' + build + '"', s)
for js in ('core', 'sprites', 'ui'):
    s = re.sub(r'(src="' + js + r'\.js)(\?v=\w+)?"', r'\1?v=' + build + '"', s)
if 'window.LH_BUILD' in s: s = re.sub(r'window\.LH_BUILD = "\w*";', 'window.LH_BUILD = "' + build + '";', s)
else: s = s.replace('<script>window.LH_SUPPORT_URL', '<script>window.LH_BUILD = "' + build + '";</script>\n<script>window.LH_SUPPORT_URL', 1)
open(p, 'w').write(s)
json.dump({'build': build}, open(os.path.join(here, 'version.json'), 'w'))
print('build', build)
