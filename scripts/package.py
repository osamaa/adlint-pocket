"""Zip dist/ (without source maps) into release/adlint-pocket-extension.zip for testers."""
import os, zipfile
os.makedirs('release', exist_ok=True)
out = 'release/adlint-pocket-extension.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('dist'):
        for f in files:
            if f.endswith('.map'):
                continue
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, 'dist'))
print('wrote', out)
