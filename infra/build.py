"""Minify infra/lambda/*.js with esbuild and inline them into lanternhold-accounts.yaml.
CloudFormation's inline ZipFile code is limited to 4 KB, hence the minifying.
Usage: python3 infra/build.py  (needs esbuild: npm i -g esbuild, or ESBUILD=path)"""
import os, re, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
esb = os.environ.get('ESBUILD', 'esbuild')
yml = os.path.join(here, 'lanternhold-accounts.yaml')
s = open(yml).read()
for fn, res in [('heroes.js', 'HeroFunction'), ('chat.js', 'ChatFunction'), ('market.js', 'MarketFunction'), ('mail.js', 'MailFunction'), ('admin.js', 'AdminFunction'), ('profile.js', 'ProfileFunction'), ('warden.js', 'WardenFunction'), ('exchange.js', 'ExchangeFunction'), ('store.js', 'StoreFunction')]:
    code = subprocess.check_output([esb, os.path.join(here, 'lambda', fn), '--minify', '--platform=node', '--format=cjs', '--log-level=warning']).decode().strip()
    if len(code.encode()) > 4000: sys.exit(f'{fn} is {len(code)} bytes minified; the inline limit is 4096')
    i = s.index('\n  ' + res + ':\n'); z = s.index('ZipFile: |', i) + len('ZipFile: |'); e = s.index('\n\n', z)
    s = s[:z] + '\n' + '\n'.join('          ' + l for l in ('// built from infra/lambda/' + fn + ' by infra/build.py\n' + code).split('\n')) + s[e:]
    print(fn, len(code), 'bytes')
open(yml, 'w').write(s)
