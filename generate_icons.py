#!/usr/bin/env python3
"""Generate VendHub PWA icons as SVG (place in images/ folder)."""

icon_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <text x="256" y="225" font-family="Georgia,serif" font-size="120" font-weight="900"
        text-anchor="middle" fill="#c9a84c" letter-spacing="-4">Vend</text>
  <text x="256" y="345" font-family="Georgia,serif" font-size="120" font-weight="900"
        text-anchor="middle" fill="#ffffff" letter-spacing="-4">Hub</text>
  <rect x="96" y="365" width="320" height="4" rx="2" fill="#c9a84c" opacity="0.6"/>
</svg>'''

with open('images/icon-512.svg', 'w') as f:
    f.write(icon_svg)

# 192px version (same SVG, browsers scale it)
with open('images/icon-192.svg', 'w') as f:
    f.write(icon_svg.replace('viewBox="0 0 512 512"', 'viewBox="0 0 192 192"')
            .replace('rx="96"', 'rx="36"')
            .replace('font-size="120"', 'font-size="45"')
            .replace('y="225"', 'y="84"')
            .replace('y="345"', 'y="130"')
            .replace('x="96" y="365" width="320" height="4"', 'x="36" y="137" width="120" height="2"'))

print("Icons written to images/icon-512.svg and images/icon-192.svg")
print("Convert to PNG with: rsvg-convert -w 512 -h 512 images/icon-512.svg > images/icon-512.png")
print("                     rsvg-convert -w 192 -h 192 images/icon-192.svg > images/icon-192.png")