import struct, sys, json, collections
d = open(sys.argv[1], 'rb').read()
assert d[:4] == b'VOX '
pos = 8; models = []; pal = None; sizes = []
def chunks(p, end):
    while p < end:
        cid = d[p:p+4].decode('latin1'); n, m = struct.unpack('<ii', d[p+4:p+12])
        yield cid, p+12, n, m
        p += 12 + n + m
# MAIN
cid, p, n, m = next(chunks(8, len(d)))
for cid, p, n, m in chunks(p + n, p + n + m):
    if cid == 'SIZE': sizes.append(struct.unpack('<iii', d[p:p+12]))
    elif cid == 'XYZI':
        k = struct.unpack('<i', d[p:p+4])[0]
        models.append([tuple(d[p+4+i*4:p+8+i*4]) for i in range(k)])
    elif cid == 'RGBA': pal = [tuple(d[p+i*4:p+i*4+4]) for i in range(256)]
print('models:', len(models), 'sizes:', sizes, file=sys.stderr)
vox = models[0]
print('voxels:', len(vox), file=sys.stderr)
colors = collections.Counter(v[3] for v in vox)
print('color indices:', colors.most_common(20), file=sys.stderr)
xs=[v[0] for v in vox]; ys=[v[1] for v in vox]; zs=[v[2] for v in vox]
print('x', min(xs), max(xs), 'y', min(ys), max(ys), 'z', min(zs), max(zs), file=sys.stderr)
for i, c in colors.most_common(20): print(i, '#%02x%02x%02x' % pal[i-1][:3], file=sys.stderr)
json.dump({'size': sizes[0], 'voxel': vox, 'palette': ['#%02x%02x%02x' % p[:3] for p in pal]}, open(sys.argv[2], 'w'))
