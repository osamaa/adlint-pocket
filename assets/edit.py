#!/usr/bin/env python3
"""Assemble the AdLint Pocket demo video from screen recordings, cards and voiceover.
Usage: python3 edit.py segments.json out.mp4   (run inside the folder with the assets)"""
import json, os, subprocess, sys, textwrap

W, H, BAND = 1920, 1080, 150
FONT = next(p for p in [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
] if os.path.exists(p))
BG = '0x0f1115'


def dur(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode().strip())


def run(cmd):
    print(' '.join(cmd)[:300], flush=True)
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def caption_file(i, text):
    lines = textwrap.wrap(text, 78)
    p = f'cap_{i:02d}.txt'
    with open(p, 'w') as f:
        f.write('\n'.join(lines))
    return p


def render(i, seg, assets):
    vo = seg.get('vo')
    vo_d = dur(vo) if vo else 0
    cap = f'cap_{i:02d}.png' if seg.get('caption') else None  # pre-rendered caption band (no drawtext needed)
    out = f'seg_{i:02d}.mp4'
    inputs, fc = [], []
    if 'image' in seg:
        D = max(seg.get('min', 0), vo_d + 0.8)
        inputs += ['-loop', '1', '-t', f'{D:.3f}', '-i', seg['image']]
        v = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},fps=30,format=yuv420p"
        n = 1
        if cap:
            inputs += ['-i', cap]
            fc.append(v + '[vb]')
            fc.append(f'[vb][{n}:v]overlay=0:{H - BAND}:format=auto,format=yuv420p[vout]')
            n += 1
        else:
            fc.append(v + '[vout]')
    else:
        crop = seg['crop']
        labels, vlen = [], 0.0
        for j, (take, s, e, sp) in enumerate(seg['parts']):
            inputs += ['-ss', f'{s:.3f}', '-to', f'{e:.3f}', '-i', f'{take}/recording.mp4']
            fc.append(f"[{j}:v]crop={crop},setpts=(PTS-STARTPTS)/{sp},fps=30,"
                      f"scale=-2:{H - BAND},pad={W}:{H}:(ow-iw)/2:0:color={BG},format=yuv420p[v{j}]")
            labels.append(f'[v{j}]')
            vlen += (e - s) / sp
        n = len(seg['parts'])
        D = max(vlen, vo_d + 0.6, seg.get('min', 0))
        fc.append(''.join(labels) + f"concat=n={n}:v=1:a=0[vc]")
        inputs += ['-i', cap]
        fc.append(f"[vc]tpad=stop_mode=clone:stop_duration={max(0.0, D - vlen):.3f}[vp]")
        fc.append(f'[vp][{n}:v]overlay=0:{H - BAND}:format=auto,format=yuv420p[vout]')
        n += 1
    if vo:
        inputs += ['-i', vo]
        fc.append(f'[{n}:a]adelay=250|250,apad,atrim=0:{D:.3f}[aout]')
    else:
        inputs += ['-f', 'lavfi', '-t', f'{D:.3f}', '-i', 'anullsrc=r=48000:cl=stereo']
        fc.append(f'[{n}:a]anull[aout]')
    cmd = ['ffmpeg', '-y'] + inputs + ['-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '[aout]',
           '-t', f'{D:.3f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30',
           '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', out]
    run(cmd)
    return out, D


def main():
    segs = json.load(open(sys.argv[1]))
    outs, total = [], 0
    for i, seg in enumerate(segs):
        o, d = render(i, seg, '.')
        outs.append(o)
        total += d
        print(f'segment {i}: {d:.1f}s  (total {total:.1f}s)', flush=True)
    with open('concat.txt', 'w') as f:
        for o in outs:
            f.write(f"file '{o}'\n")
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', sys.argv[2]])
    print('done', sys.argv[2], f'{dur(sys.argv[2]):.1f}s')


if __name__ == '__main__':
    main()
