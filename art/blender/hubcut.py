"""Builds the Hub Cutaway of Edgefall in Blender, in its own scene "Hub Cutaway".
It never resets Blender and never touches another scene. Everything it makes is named hub_* and lives in that scene.
Use from Blender:  import sys; sys.path.insert(0, DIR); import hubcut, importlib; importlib.reload(hubcut); hubcut.build()
Axes: X to the right, Z up, Y into the ship. The cut faces -Y. One unit is one bay width."""
import math

import bpy
from mathutils import Vector

SCENE = 'Hub Cutaway'
W, H, D = 1.0, 1.16, 0.8  # a bay: width, height, depth
SW, HULL, BEAM, DOME, KEEL, HD = 0.58, 0.13, 0.22, 0.5, 0.24, 1.15  # lift shaft, hull wall, deck beam, dome, keel, hull depth
GLOW = 1.7  # emission strength of the glow material

# The game's colours (client/src/neonlook.ts NEON and DECK_KEY, ui.css, neonworld.ts).
PAL = dict(sky=0x04050c, gap=0x0a0e18, slab=0x171c2b, rim=0x0f1320, rimlight=0x39466a, ground=0x1d2433, cell=0x5d6a82, cyan=0x19e6ff,
           accent=0x7fd6e8, violet=0x9a6bff, white=0xf2f0ea, black=0x14161a, sodium=0xd9822b, amber=0xffb000, warm=0xffe3bf, bridge=0xe8f0ff,
           gold=0xffd43b, ink=0x0b0d0f, plate=0x0d1114, moon=0x20222c, danger=0xff6b5a, muted=0x9aa3a8, steel=0x2a3347)
LAMP = dict(mess='warm', cargo='accent', furnace='sodium', chapel='violet', bridge='bridge')  # warm Mess, cyan Cargo, sodium Furnace, violet Chapel, white Bridge
SEATS = dict(mess='echo', cargo='hull', furnace='choir', chapel='chaplain', bridge='ballast')
BOSSES = {'echo', 'dual', 'hull', 'alien', 'railyard', 'assembly', 'swarm', 'choir', 'magnetizer', 'core', 'chaplain', 'overseer', 'stalker', 'ballast', 'pulsar'}
WAITS = {'royale', 'daily', 'world', 'run', 'coop', 'ranked', 'trainer'}  # the mode rooms that wait for the first win
DECOR = {'hold', 'crates', 'nave', 'vents', 'console'}

# The two layouts of one kit: (deck, tiers of (bays left of the lift, bays right of it)), top to bottom.
TALL = [
    ('bridge', [(['trainer', 'ranked'], ['ballast', 'pulsar', 'logs'])]),
    ('chapel', [(['nave', 'logs'], ['chaplain', 'overseer', 'stalker'])]),
    ('furnace', [(['coop', 'logs'], ['choir', 'magnetizer', 'core'])]),
    ('cargo', [(['hold', 'hold'], ['hull', 'alien', 'railyard']), (['logs', 'crates'], ['assembly', 'swarm', 'run'])]),
    ('mess', [(['medals', 'logs'], ['echo', 'dual', 'daily']), (['world', 'royale'], ['bot', 'hotseat', 'online'])]),
]
WIDE = [
    ('bridge', [(['logs', 'trainer', 'ranked'], ['ballast', 'pulsar', 'console'])]),
    ('chapel', [(['nave', 'nave', 'logs'], ['chaplain', 'overseer', 'stalker'])]),
    ('furnace', [(['vents', 'logs', 'coop'], ['choir', 'magnetizer', 'core'])]),
    ('cargo', [(['hold', 'hold', 'crates', 'logs', 'swarm'], ['hull', 'alien', 'railyard', 'assembly', 'run'])]),
    ('mess', [(['world', 'royale', 'online', 'hotseat', 'bot'], ['echo', 'dual', 'daily', 'medals', 'logs'])]),
]
ALL_DECKS = {'mess', 'cargo', 'furnace', 'chapel', 'bridge'}
LATE = dict(waiting=False, open=set(ALL_DECKS), beaten={'echo', 'hull', 'choir', 'chaplain', 'dual', 'alien', 'railyard', 'magnetizer', 'overseer'}, goal='ballast')
MID = dict(waiting=False, open={'mess', 'cargo'}, beaten={'echo'}, goal='run')
NEW = dict(waiting=True, open={'mess'}, beaten=set(), goal='bot')


def C(name, k=1.0):
    """A palette colour as linear RGBA."""
    h = PAL[name]

    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255) * k, lin((h >> 8) & 255) * k, lin(h & 255) * k, 1.0)


class MB:
    """A mesh from quads and n-gons, with a colour ('Col') and a glow mask ('Glow') per corner."""

    def __init__(self):
        self.v, self.f, self.col, self.glow = [], [], [], []

    def poly(self, pts, col, glow=0.0, face=None):
        pts = [tuple(p) for p in pts]
        cols = list(col) if isinstance(col, list) else [col] * len(pts)
        gl = list(glow) if isinstance(glow, (list, tuple)) else [glow] * len(pts)
        if face is not None:
            nrm = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
            if nrm.dot(Vector(face)) < 0:
                pts.reverse()
                cols.reverse()
                gl.reverse()
        i = len(self.v)
        self.v += pts
        self.f.append(tuple(range(i, i + len(pts))))
        self.col.append(cols)
        self.glow.append(gl)

    def box(self, x0, x1, y0, y1, z0, z1, col, glow=0.0, skip=''):
        faces = {
            'f': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)), 'b': ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0)),
            'l': ([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], (-1, 0, 0)), 'r': ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
            't': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)), 'd': ([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], (0, 0, -1)),
        }
        for k, (p, nrm) in faces.items():
            if k not in skip:
                self.poly(p, col, glow, nrm)

    def disc(self, cx, y, cz, r, n, col, glow=0.0, t=0.03):
        """A coin facing -Y: n-gon front and back, a rim between."""
        ring = [(cx + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        self.poly([(x, y, z) for x, z in ring], col, glow, (0, -1, 0))
        self.poly([(x, y + t, z) for x, z in ring], col, glow, (0, 1, 0))
        for i in range(n):
            (xa, za), (xb, zb) = ring[i], ring[(i + 1) % n]
            self.poly([(xa, y, za), (xb, y, zb), (xb, y + t, zb), (xa, y + t, za)], col, glow)

    def ball(self, cx, cy, cz, r, col, glow=0.0):
        """An icosahedron: 20 triangles."""
        t = (1 + 5 ** 0.5) / 2
        vs = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        fs = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        k = r / (1 + t * t) ** 0.5
        for a, b, c in fs:
            self.poly([(cx + vs[i][0] * k, cy + vs[i][1] * k, cz + vs[i][2] * k) for i in (a, b, c)], col, glow)

    def octa(self, cx, cy, cz, r, col, glow=0.0):
        p = [(cx + r, cy, cz), (cx - r, cy, cz), (cx, cy + r, cz), (cx, cy - r, cz), (cx, cy, cz + r * 1.4), (cx, cy, cz - r * 1.4)]
        for a, b, c in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            self.poly([p[a], p[b], p[c]], col, glow)

    def build(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        ga = me.color_attributes.new('Glow', 'FLOAT_COLOR', 'CORNER')
        for fi, p in enumerate(me.polygons):
            for j, li in enumerate(p.loop_indices):
                ca.data[li].color = self.col[fi][j]
                g = self.glow[fi][j]
                ga.data[li].color = (g, g, g, 1.0)
        me.materials.append(mat)
        return me


def tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ------------------------------------------------------------------ scene, materials, light
def scene():
    return bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)


def clear():
    """Removes what a previous build left: only hub_* data, only in this scene."""
    sc = scene()
    for ob in list(sc.collection.all_objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(sc.collection.children_recursive):
        bpy.data.collections.remove(c)
    for block in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
        for d in list(block):
            if d.name.startswith('hub_') and d.users == 0:
                block.remove(d)


def _principled(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for nd in list(nt.nodes):
        if nd.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(nd)
    bsdf = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
    return m, nt, bsdf


def materials():
    """Three materials for the whole Hub: the hull (lit), the glow (lit, plus a mask times the object's colour), the marble."""
    hull, nt, b = _principled('hub_mat_hull')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    nt.links.new(col.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    glow, nt, b = _principled('hub_mat_glow')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    mask = nt.nodes.new('ShaderNodeVertexColor')
    mask.layer_name = 'Glow'
    info = nt.nodes.new('ShaderNodeObjectInfo')
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(col.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(mask.outputs['Color'], mul.inputs[0])
    nt.links.new(info.outputs['Color'], mul.inputs[1])
    nt.links.new(mul.outputs['Vector'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = GLOW
    b.inputs['Roughness'].default_value = 0.85
    marble, nt, b = _principled('hub_mat_marble')
    b.inputs['Base Color'].default_value = C('white')
    b.inputs['Roughness'].default_value = 0.55
    b.inputs['Emission Color'].default_value = C('white')
    b.inputs['Emission Strength'].default_value = 0.6
    return hull, glow, marble


def world(sc):
    """A near-black sky for the camera, a dim violet-blue ambient for the hull, and the game's cold sun, low on the left."""
    w = bpy.data.worlds.get('hub_world') or bpy.data.worlds.new('hub_world')
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    sky = nt.nodes.new('ShaderNodeBackground')
    sky.inputs['Color'].default_value = C('sky')
    amb = nt.nodes.new('ShaderNodeBackground')
    amb.inputs['Color'].default_value = C('rimlight')
    amb.inputs['Strength'].default_value = 0.9
    path = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(path.outputs['Is Camera Ray'], mix.inputs[0])
    nt.links.new(amb.outputs['Background'], mix.inputs[1])
    nt.links.new(sky.outputs['Background'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    sc.world = w
    sun = bpy.data.lights.new('hub_sun', 'SUN')
    sun.energy = 2.2
    sun.color = C('bridge')[:3]
    sun.use_shadow = False
    ob = bpy.data.objects.new('hub_sun', sun)
    ob.rotation_euler = (math.radians(62), 0, math.radians(-38))
    sc.collection.objects.link(ob)
    try:
        sc.view_settings.view_transform = 'Standard'
    except TypeError:
        pass


# ------------------------------------------------------------------ the kit
def kit(hull, glow):
    k = {}
    slab, rim, edge, gnd, dark, body = C('slab'), C('rim'), C('rimlight'), C('ground'), C('black'), C('steel')
    t = 0.035
    # the bay shell: floor, back wall, two side walls, ceiling, the cut edges, a sign over the door, a lamp under it
    m = MB()
    m.poly([(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)], gnd, [0.1, 0.1, 0.3, 0.3], (0, 0, 1))
    m.poly([(0, D, 0), (W, D, 0), (W, D, H), (0, D, H)], slab, [0.05, 0.05, 0.5, 0.5], (0, -1, 0))
    m.poly([(0, 0, 0), (0, D, 0), (0, D, H), (0, 0, H)], rim, [0.02, 0.05, 0.3, 0.12], (1, 0, 0))
    m.poly([(W, 0, 0), (W, D, 0), (W, D, H), (W, 0, H)], rim, [0.02, 0.05, 0.3, 0.12], (-1, 0, 0))
    m.poly([(0, 0, H), (W, 0, H), (W, D, H), (0, D, H)], rim, 0.25, (0, 0, -1))
    for x0, x1, z0, z1 in ((0, t, 0, H), (W - t, W, 0, H), (t, W - t, 0, t), (t, W - t, H - t, H)):
        m.poly([(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)], edge, 0, (0, -1, 0))
    m.poly([(0.06, -0.012, H - 0.3), (W - 0.06, -0.012, H - 0.3), (W - 0.06, -0.012, H - 0.06), (0.06, -0.012, H - 0.06)], C('plate'), 0, (0, -1, 0))
    m.box(0.36, 0.64, 0.02, 0.1, H - 0.365, H - 0.325, dark, 1.0)
    k['bay'] = m.build('hub_bay', glow)
    # the lift shaft, one level: back wall and two rails
    m = MB()
    m.poly([(0, D, 0), (SW, D, 0), (SW, D, H), (0, D, H)], C('gap'), [0.03, 0.03, 0.1, 0.1], (0, -1, 0))
    for x in (0.17, 0.39):
        m.box(x, x + 0.03, D - 0.07, D - 0.03, 0, H, dark, 0.7, skip='tdb')
    k['shaft'] = m.build('hub_shaft', glow)
    m = MB()
    m.box(0.07, SW - 0.07, -0.03, 0.07, 0.035, BEAM - 0.035, dark, 0.9)
    k['hatch'] = m.build('hub_hatch', glow)
    m = MB()
    m.box(0.07, SW - 0.07, 0.12, 0.62, 0, 0.05, dark, 1.0)
    k['car'] = m.build('hub_car', glow)

    def prop(name, fn):
        mb = MB()
        fn(mb)
        k[name] = mb.build('hub_prop_' + name, glow)

    def bot(m):
        m.box(-0.16, 0.16, -0.1, 0.1, 0.04, 0.3, body)
        m.box(-0.11, 0.11, -0.08, 0.08, 0.32, 0.47, body)
        m.poly([(-0.08, -0.082, 0.37), (0.08, -0.082, 0.37), (0.08, -0.082, 0.43), (-0.08, -0.082, 0.43)], dark, 1.0, (0, -1, 0))
        m.box(-0.012, 0.012, -0.012, 0.012, 0.47, 0.57, dark, 1.0, skip='d')

    def hotseat(m):
        m.box(-0.2, 0.2, -0.14, 0.14, 0.24, 0.27, dark, 0.9)
        m.box(-0.03, 0.03, -0.03, 0.03, 0, 0.24, body, skip='td')
        for x in (-0.34, 0.26):
            m.box(x, x + 0.08, -0.06, 0.06, 0, 0.36, body, skip='d')

    def online(m):
        m.box(-0.1, 0.1, -0.1, 0.1, 0, 0.04, body, skip='d')
        m.box(-0.02, 0.02, -0.02, 0.02, 0.04, 0.42, body, skip='d')
        m.box(-0.1, 0.1, -0.012, 0.012, 0.46, 0.485, dark, 1.0)
        m.box(-0.17, 0.17, -0.012, 0.012, 0.535, 0.56, dark, 1.0)

    def royale(m):
        ring = [(0.24 * math.cos(math.pi / 3 * i), 0.2 * math.sin(math.pi / 3 * i)) for i in range(6)]
        m.poly([(x, y, 0.06) for x, y in ring], body, 0, (0, 0, 1))
        for i in range(6):
            (xa, ya), (xb, yb) = ring[i], ring[(i + 1) % 6]
            m.poly([(xa, ya, 0), (xb, yb, 0), (xb, yb, 0.06), (xa, ya, 0.06)], body)
        for i in (0, 2, 4):
            x, y = 0.3 * math.cos(math.pi / 3 * i + 0.5), 0.25 * math.sin(math.pi / 3 * i + 0.5)
            m.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0, 0.26, dark, 1.0, skip='d')

    def daily(m):
        m.box(-0.17, 0.17, -0.02, 0.02, 0.1, 0.44, body)
        m.poly([(-0.17, -0.022, 0.37), (0.17, -0.022, 0.37), (0.17, -0.022, 0.44), (-0.17, -0.022, 0.44)], dark, 1.0, (0, -1, 0))
        m.poly([(-0.04, -0.022, 0.19), (0.04, -0.022, 0.19), (0.04, -0.022, 0.27), (-0.04, -0.022, 0.27)], dark, 1.0, (0, -1, 0))
        m.box(-0.025, 0.025, -0.02, 0.06, 0, 0.1, body, skip='td')

    def globe(m):
        m.ball(0, 0, 0.32, 0.18, C('steel'), 0.35)
        m.box(-0.03, 0.03, -0.03, 0.03, 0, 0.14, body, skip='td')

    def medals(m):
        m.box(-0.11, 0.11, -0.1, 0.1, 0, 0.2, body, skip='d')
        m.disc(0, -0.03, 0.37, 0.13, 8, dark, 1.0)

    def logs(m):
        m.box(-0.17, 0.17, -0.08, 0.1, 0.15, 0.42, body)
        m.poly([(-0.13, -0.082, 0.2), (0.13, -0.082, 0.2), (0.13, -0.082, 0.38), (-0.13, -0.082, 0.38)], dark, 0.9, (0, -1, 0))
        m.box(-0.04, 0.04, -0.04, 0.04, 0, 0.15, body, skip='td')

    def run(m):
        m.box(-0.23, 0.23, -0.14, 0.14, 0.17, 0.21, body)
        m.box(-0.03, 0.03, -0.03, 0.03, 0, 0.17, body, skip='td')
        for x, z in ((-0.15, 0.24), (0, 0.3), (0.15, 0.37)):
            m.box(x - 0.03, x + 0.03, -0.03, 0.03, 0.21, z, dark, 1.0, skip='d')

    def coop(m):
        m.box(-0.22, 0.22, -0.11, 0.11, 0, 0.1, body, skip='d')
        for x in (-0.1, 0.1):
            m.ball(x, 0, 0.21, 0.11, C('white'), 0.15)

    def ranked(m):
        m.box(-0.25, -0.08, -0.1, 0.1, 0, 0.15, body, skip='d')
        m.box(-0.08, 0.08, -0.1, 0.1, 0, 0.27, body, skip='dt')
        m.poly([(-0.08, -0.1, 0.27), (0.08, -0.1, 0.27), (0.08, 0.1, 0.27), (-0.08, 0.1, 0.27)], dark, 1.0, (0, 0, 1))
        m.box(0.08, 0.25, -0.1, 0.1, 0, 0.09, body, skip='d')

    def trainer(m):
        m.box(-0.02, 0.02, -0.02, 0.02, 0, 0.3, body, skip='d')
        m.disc(0, -0.03, 0.4, 0.15, 8, C('white', 0.55), 0)
        m.poly([(-0.045, -0.034, 0.355), (0.045, -0.034, 0.355), (0.045, -0.034, 0.445), (-0.045, -0.034, 0.445)], dark, 1.0, (0, -1, 0))

    def boss(m, shut=True):
        for x in (-0.23, 0.17):
            m.box(x, x + 0.06, -0.05, 0.05, 0, 0.52, body, skip='d')
        m.box(-0.23, 0.23, -0.05, 0.05, 0.52, 0.58, dark, 1.0)
        if shut:
            m.box(-0.17, 0.17, -0.02, 0.02, 0, 0.52, C('gap'), skip='dtlr')
            m.octa(0, -0.05, 0.27, 0.06, dark, 1.0)

    def seal(m):
        m.disc(0, -0.04, 0.27, 0.1, 8, dark, 1.0)

    def hold(m):  # the ore hold, two bays wide: a gantry, a crate on its cable, two heaps
        m.box(-0.85, 0.85, -0.03, 0.03, 0.84, 0.88, dark, 0.55)
        m.box(0.2, 0.34, -0.05, 0.05, 0.78, 0.84, body)
        m.box(0.265, 0.275, -0.005, 0.005, 0.5, 0.78, body, skip='td')
        m.box(0.16, 0.38, -0.1, 0.1, 0.34, 0.5, body)
        for cx, r, hh in ((-0.5, 0.3, 0.34), (-0.12, 0.2, 0.2)):
            base = [(cx - r, -r * 0.7), (cx + r, -r * 0.7), (cx + r, r * 0.7), (cx - r, r * 0.7)]
            for i in range(4):
                (xa, ya), (xb, yb) = base[i], base[(i + 1) % 4]
                m.poly([(xa, ya, 0), (xb, yb, 0), (cx, 0, hh)], C('ground', 1.6))

    def crates(m):
        for x, z in ((-0.2, 0), (0.02, 0), (-0.09, 0.2)):
            m.box(x, x + 0.2, -0.1, 0.1, z, z + 0.2, body, skip='d')

    def nave(m):
        for x, hh in ((-0.2, 0.22), (0, 0.36), (0.2, 0.16)):
            m.box(x - 0.02, x + 0.02, -0.02, 0.02, 0, hh, C('white', 0.5), skip='d')
            m.octa(x, 0, hh + 0.05, 0.022, dark, 1.0)

    def vents(m):
        for x in (-0.14, 0.14):
            m.box(x - 0.06, x + 0.06, -0.06, 0.06, 0, 0.5, body, skip='dt')
            m.poly([(x - 0.06, -0.06, 0.5), (x + 0.06, -0.06, 0.5), (x + 0.06, 0.06, 0.5), (x - 0.06, 0.06, 0.5)], dark, 0.8, (0, 0, 1))

    def console(m):
        m.box(-0.24, 0.24, -0.08, 0.12, 0, 0.2, body, skip='d')
        m.box(-0.16, 0.16, 0.02, 0.06, 0.2, 0.42, body, skip='d')
        m.poly([(-0.13, 0.018, 0.24), (0.13, 0.018, 0.24), (0.13, 0.018, 0.39), (-0.13, 0.018, 0.39)], dark, 0.9, (0, -1, 0))

    for name, fn in (('bot', bot), ('hotseat', hotseat), ('online', online), ('royale', royale), ('daily', daily), ('world', globe), ('medals', medals), ('logs', logs),
                     ('run', run), ('coop', coop), ('ranked', ranked), ('trainer', trainer), ('boss', boss), ('boss_open', lambda m: boss(m, False)), ('seal', seal),
                     ('hold', hold), ('crates', crates), ('nave', nave), ('vents', vents), ('console', console)):
        prop(name, fn)
    # where the current deck has a prop, it replaces the stand-in above
    reused = []
    if ensure_kit():
        for name, parts in KIT_PROPS.items():
            mb = MB()
            if all(from_kit(mb, *part) for part in parts):
                k[name] = mb.build('hub_prop_' + name, glow)
                reused.append(name)
    k['_reused'] = reused
    return k


GLB = '/Users/yann.rolland/perso/ab-alone/art/blender/export/scene_hub_deck.glb'
# our room: (the deck file's prop, its offset along X, the box it must fit in)
KIT_PROPS = {
    'bot': [('robot', 0, (0.5, 0.4, 0.56))], 'hotseat': [('table', 0, (0.7, 0.5, 0.4))], 'online': [('antenna', 0, (0.5, 0.5, 0.62))],
    'royale': [('arena', 0, (0.74, 0.6, 0.4))], 'daily': [('calendar', 0, (0.5, 0.3, 0.52))], 'world': [('globe', 0, (0.5, 0.5, 0.56))],
    'run': [('map', 0, (0.7, 0.55, 0.4))], 'ranked': [('podium', 0, (0.66, 0.5, 0.42))], 'trainer': [('dummy', 0, (0.5, 0.4, 0.58))],
    'logs': [('crt', -0.16, (0.4, 0.4, 0.5)), ('terminal', 0.24, (0.26, 0.2, 0.34))],
}


def ensure_kit():
    """The prop meshes of the current deck file, imported once (read only). Their objects are removed at once: only the meshes are read."""
    if bpy.data.meshes.get('kit_prop_hub_robot'):
        return True
    before = set(bpy.data.objects.keys())
    scenes = set(bpy.data.scenes.keys())
    try:
        bpy.context.window.scene = scene()
        bpy.ops.import_scene.gltf(filepath=GLB)
    except Exception as e:  # no file, or an importer without meshopt: the stand-ins stay
        print('deck file not imported:', str(e)[:200])
        return False
    for name in set(bpy.data.objects.keys()) - before:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    for name in set(bpy.data.scenes.keys()) - scenes:
        if not bpy.data.scenes[name].objects:
            bpy.data.scenes.remove(bpy.data.scenes[name])
    bpy.context.window.scene = scene()
    return bpy.data.meshes.get('kit_prop_hub_robot') is not None


def from_kit(mb, kname, dx, fit):
    """Copies a prop of the deck file into `mb`, scaled to `fit`: its saturated faces (or, with none, its brightest) become the glow, the rest slate."""
    src = bpy.data.meshes.get('kit_prop_hub_' + kname)
    if not src or 'Color' not in src.color_attributes:
        return False
    ca = src.color_attributes['Color']
    xs, ys, zs = [v.co.x for v in src.vertices], [v.co.y for v in src.vertices], [v.co.z for v in src.vertices]
    sc = min(fit[0] / (max(xs) - min(xs)), fit[1] / (max(ys) - min(ys)), fit[2] / (max(zs) - min(zs)))
    cx, cy, z0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
    faces = []
    for p in src.polygons:
        c = ca.data[p.loop_indices[0]].color if ca.domain == 'CORNER' else ca.data[p.vertices[0]].color
        r, g, b = c[0], c[1], c[2]
        mx, mn = max(r, g, b), min(r, g, b)
        faces.append((p, mx, (mx - mn) / mx if mx > 0 else 0, 0.2126 * r + 0.7152 * g + 0.0722 * b))
    sat = [f for f in faces if f[2] > 0.45 and f[1] > 0.18]
    top = max(f[3] for f in faces)
    accent = {f[0].index for f in sat} if sat else {f[0].index for f in faces if f[3] > 0.75 * top}
    amax = max(f[1] for f in faces if f[0].index in accent)
    bmax = max([f[3] for f in faces if f[0].index not in accent] or [1.0]) or 1.0
    for p, mx, _, lum in faces:
        pts = [((src.vertices[i].co.x - cx) * sc + dx, (src.vertices[i].co.y - cy) * sc, (src.vertices[i].co.z - z0) * sc) for i in p.vertices]
        if p.index in accent:
            mb.poly(pts, C('black'), 0.45 + 0.55 * mx / amax)
        else:
            mb.poly(pts, C('steel', 0.45 + 0.9 * lum / bmax))
    return True


# ------------------------------------------------------------------ one layout
def item_state(i, deck, st):
    if deck not in st['open']:
        return 'dark'
    if st['waiting'] and (i in BOSSES or i in WAITS):
        return 'locked'
    if st['goal'] == i:
        return 'goal'
    if i in st['beaten']:
        return 'beaten'
    return 'lit'


def add(coll, name, me, loc, color=None, scale=None):
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    if color is not None:
        ob.color = color
    if scale is not None:
        ob.scale = scale
    coll.objects.link(ob)
    return ob


def blocks_of(layout, sx):
    total = sum(BEAM + H * len(tiers) for _, tiers in layout)
    z = KEEL + total
    out = []
    for did, tiers in layout:
        L, R = len(tiers[0][0]), len(tiers[0][1])
        zb = z - BEAM - H * len(tiers)
        out.append(dict(id=did, tiers=tiers, zt=z, zb=zb, xl=sx - L * W - HULL, xr=sx + SW + R * W + HULL))
        z = zb
    return out


def outline(blocks):
    b0, bl = blocks[0], blocks[-1]
    zt, r = b0['zt'], DOME
    pts = [(b0['xl'] + r + r * math.cos(math.pi - i * math.pi / 8), zt + r * math.sin(math.pi - i * math.pi / 8)) for i in range(5)]
    pts += [(b0['xr'] - r + r * math.cos(math.pi / 2 - i * math.pi / 8), zt + r * math.sin(math.pi / 2 - i * math.pi / 8)) for i in range(5)]
    for i, b in enumerate(blocks):
        pts.append((b['xr'], b['zb']))
        if i + 1 < len(blocks) and blocks[i + 1]['xr'] != b['xr']:
            pts.append((blocks[i + 1]['xr'], b['zb']))
    pts += [(bl['xr'] - 0.35, bl['zb'] - KEEL), (bl['xl'] + 0.35, bl['zb'] - KEEL), (bl['xl'], bl['zb'])]
    for i in range(len(blocks) - 1, 0, -1):
        b = blocks[i]
        pts.append((b['xl'], b['zt']))
        if blocks[i - 1]['xl'] != b['xl']:
            pts.append((blocks[i - 1]['xl'], b['zt']))
    return pts


def hull_mesh(name, blocks, mat):
    m = MB()
    rim, edge, slab = C('rim'), C('rimlight'), C('slab')
    pts = outline(blocks)
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    m.poly([(x, HD, z) for x, z in pts], rim, 0, (0, 1, 0))
    for i in range(len(pts)):
        (xa, za), (xb, zb) = pts[i], pts[(i + 1) % len(pts)]
        out = Vector(((xa + xb) / 2 - cx, 0, (za + zb) / 2 - cz))
        nrm = Vector((zb - za, 0, -(xb - xa)))
        if nrm.dot(out) < 0:
            nrm = -nrm
        up = nrm.normalized().z > 0.5
        m.poly([(xa, 0, za), (xb, 0, zb), (xb, HD, zb), (xa, HD, za)], C('steel') if up else rim, 0, tuple(nrm))
    b0, bl = blocks[0], blocks[-1]
    m.poly([(x, 0, z) for x, z in pts[:10]], rim, 0, (0, -1, 0))  # the dome's cut face
    m.poly([(bl['xl'], 0, bl['zb']), (bl['xr'], 0, bl['zb']), (bl['xr'] - 0.35, 0, bl['zb'] - KEEL), (bl['xl'] + 0.35, 0, bl['zb'] - KEEL)], rim, 0, (0, -1, 0))
    for b in blocks:
        for x0, x1 in ((b['xl'], b['xl'] + HULL), (b['xr'] - HULL, b['xr'])):  # the hull wall, cut
            m.poly([(x0, 0, b['zb']), (x1, 0, b['zb']), (x1, 0, b['zt']), (x0, 0, b['zt'])], edge, 0, (0, -1, 0))
        m.box(b['xl'] + HULL, b['xr'] - HULL, 0, D, b['zt'] - BEAM, b['zt'], slab, skip='b')  # the deck beam
    return m.build(name, mat)


def build_layout(sc, name, layout, sx, st, kitm, hull, glow, marble, hero=None):
    coll = bpy.data.collections.new('hub_' + name)
    sc.collection.children.link(coll)
    blocks = blocks_of(layout, sx)
    add(coll, 'hub_%s_hull' % name, hull_mesh('hub_hull_' + name, blocks, hull), (0, 0, 0))
    off = (0, 0, 0, 1)
    pos = {}
    ids = [b['id'] for b in blocks]
    for bi, b in enumerate(blocks):
        did = b['id']
        opened = did in st['open']
        lamp = C(LAMP[did])
        if bi > 0:  # the hatch to the deck above, in this deck's beam
            above = ids[bi - 1] in st['open']
            add(coll, 'hub_%s_hatch_%s' % (name, did), kitm['hatch'], (sx, 0, b['zt'] - BEAM), C('cyan') if above else C('sodium', 1.0 if opened else 0.25))
        for ti, (left, right) in enumerate(b['tiers']):
            z = b['zt'] - BEAM - H * (ti + 1)
            add(coll, 'hub_%s_shaft_%s%d' % (name, did, ti), kitm['shaft'], (sx, 0, z), C('cyan', 0.9) if opened else C('rimlight', 0.25))
            cells = [(sx - (len(left) - i) * W, it) for i, it in enumerate(left)] + [(sx + SW + j * W, it) for j, it in enumerate(right)]
            k = 0
            while k < len(cells):
                x, it = cells[k]
                w = 1
                if it in DECOR:
                    while k + 1 < len(cells) and cells[k + 1][1] == it and abs(cells[k + 1][0] - (x + w * W)) < 1e-6:
                        w += 1
                        k += 1
                    add(coll, 'hub_%s_bay_%s_%s' % (name, did, it), kitm['bay'], (x, 0, z), lamp if opened else off, (w, 1, 1))
                    add(coll, 'hub_%s_set_%s_%s' % (name, did, it), kitm[it], (x + w * W / 2, D * 0.55, z), (C('sodium') if it == 'nave' else lamp) if opened else C('rimlight', 0.15))
                else:
                    s = item_state(it, did, st)
                    isboss = it in BOSSES
                    bay_col = off if s == 'dark' else C(LAMP[did], 0.05) if s == 'locked' else C('amber') if s == 'goal' else lamp
                    kind = C('gold') if it == 'medals' else C('violet') if isboss else C('cyan')
                    prop_col = C('rimlight', 0.15) if s == 'dark' else C('muted', 0.2) if s == 'locked' else C('amber') if s == 'goal' else kind
                    add(coll, 'hub_%s_bay_%s_%s' % (name, did, it), kitm['bay'], (x, 0, z), bay_col)
                    me = kitm['boss_open' if s == 'beaten' else 'boss'] if isboss else kitm[it]
                    add(coll, 'hub_%s_prop_%s_%s' % (name, did, it), me, (x + W / 2, D * 0.55, z), prop_col)
                    if isboss and s == 'beaten':
                        add(coll, 'hub_%s_seal_%s' % (name, it), kitm['seal'], (x + W / 2, D * 0.55, z), C('gold'))
                    pos[(did, it)] = (x, z)
                k += 1
            pos[(did, ti)] = z
    b0, bl = blocks[0], blocks[-1]
    cx = (b0['xl'] + b0['xr']) / 2
    top_open = 'bridge' in st['open']
    m = MB()  # the mast and its lamp, the Bridge's window, three nozzles
    zt = b0['zt'] + DOME
    m.box(cx - 0.02, cx + 0.02, HD / 2 - 0.02, HD / 2 + 0.02, zt, zt + 0.7, C('steel'), skip='d')
    m.box(cx - 0.05, cx + 0.05, HD / 2 - 0.05, HD / 2 + 0.05, zt + 0.7, zt + 0.8, C('black'), 1.0)
    add(coll, 'hub_%s_mast' % name, m.build('hub_mast_' + name, glow), (0, 0, 0), C('bridge') if top_open else C('danger', 0.6))
    m = MB()
    m.poly([(cx - 0.9, -0.01, b0['zt'] + 0.17), (cx + 0.9, -0.01, b0['zt'] + 0.17), (cx + 0.9, -0.01, b0['zt'] + 0.31), (cx - 0.9, -0.01, b0['zt'] + 0.31)], C('black'), 1.0, (0, -1, 0))
    add(coll, 'hub_%s_window' % name, m.build('hub_window_' + name, glow), (0, 0, 0), C('bridge') if top_open else C('rimlight', 0.12))
    m = MB()
    for f in (0.27, 0.5, 0.73):
        nx = bl['xl'] + (bl['xr'] - bl['xl']) * f
        zk = bl['zb'] - KEEL
        ring = [(math.cos(math.pi / 3 * i), math.sin(math.pi / 3 * i)) for i in range(6)]
        for i in range(6):
            (ca, sa), (cb, sb) = ring[i], ring[(i + 1) % 6]
            m.poly([(nx + 0.2 * ca, HD / 2 + 0.2 * sa, zk), (nx + 0.2 * cb, HD / 2 + 0.2 * sb, zk), (nx + 0.13 * cb, HD / 2 + 0.13 * sb, zk - 0.16), (nx + 0.13 * ca, HD / 2 + 0.13 * sa, zk - 0.16)], C('steel'))
        m.poly([(nx + 0.13 * c, HD / 2 + 0.13 * s, zk - 0.16) for c, s in ring], C('black'), 1.0, (0, 0, -1))
    add(coll, 'hub_%s_nozzles' % name, m.build('hub_nozzles_' + name, glow), (0, 0, 0), C('sodium'))
    # the two rooms that lead off the ship: the Airlock's tube and the Mining cut's cable, down to Hollow
    m = MB()
    x, z = pos[('mess', 'world')]
    hx = x - HULL
    m.box(hx - 0.14, hx, 0.15, 0.55, z + 0.08, z + 0.6, C('steel'), 0.25)
    m.box(hx - 0.09, hx - 0.05, 0.33, 0.37, -2.6, z + 0.08, C('black'), 0.7, skip='td')
    s = item_state('world', 'mess', st)
    add(coll, 'hub_%s_airlock' % name, m.build('hub_airlock_' + name, glow), (0, 0, 0), C('accent') if s != 'locked' else C('muted', 0.25))
    m = MB()
    x, z = pos[('cargo', 'run')]
    hx = x + W + HULL
    m.box(hx, hx + 0.14, 0.15, 0.55, z + 0.1, z + 0.5, C('steel'), 0.25)
    m.box(hx + 0.05, hx + 0.09, 0.33, 0.37, -2.6, z + 0.1, C('black'), 0.7, skip='td')
    s = item_state('run', 'cargo', st)
    add(coll, 'hub_%s_cable' % name, m.build('hub_cable_' + name, glow), (0, 0, 0), C('amber') if s == 'goal' else C('accent') if s in ('lit', 'beaten') else C('muted', 0.25))
    # Hollow's limb, lit warm, below and behind the keel
    m = MB()
    R, n = 34.0, 28
    mx, mz = (bl['xl'] + bl['xr']) / 2, -R - 1.5
    arc = [(mx + R * math.sin(a), mz + R * math.cos(a)) for a in [(-0.26 + 0.52 * i / n) for i in range(n + 1)]]
    m.poly([(x, 3.0, z) for x, z in arc] + [(arc[-1][0], 3.0, arc[-1][1] - 5), (arc[0][0], 3.0, arc[0][1] - 5)], C('black'), 0.03, (0, -1, 0))
    for i in range(n):
        (xa, za), (xb, zb) = arc[i], arc[i + 1]
        m.poly([(xa, 2.98, za - 0.03), (xb, 2.98, zb - 0.03), (xb, 2.98, zb + 0.02), (xa, 2.98, za + 0.02)], C('black'), 0.9, (0, -1, 0))
    add(coll, 'hub_%s_hollow' % name, m.build('hub_hollow_' + name, glow), (0, 0, 0), C('warm'))
    if hero:  # the lift car and the marble
        z = pos[(hero[0], hero[1])] + hero[2]
        add(coll, 'hub_%s_car' % name, kitm['car'], (sx, 0, z), C('cyan'))
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.17)
        me = bpy.data.meshes.new('hub_marble_' + name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(marble)
        add(coll, 'hub_%s_marble' % name, me, (sx + SW / 2, 0.37, z + 0.05 + 0.17))
    ext = (min(b['xl'] for b in blocks), max(b['xr'] for b in blocks), blocks[0]['zt'] + DOME, blocks[-1]['zb'] - KEEL)
    return coll, ext


def camera(sc, name, target, ortho, res, tilt=(0.2, 0.15)):
    """A fixed, near-straight camera: orthographic, a little to the right of the cut and a little above it."""
    cam = bpy.data.cameras.new('hub_cam_' + name)
    cam.type = 'ORTHO'
    cam.ortho_scale = ortho
    cam.clip_end = 200
    ob = bpy.data.objects.new('hub_cam_' + name, cam)
    t = Vector(target)
    ob.location = t + Vector((tilt[0] * 30, -30, tilt[1] * 30))
    ob.rotation_euler = (t - ob.location).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(ob)
    ob['res'] = res
    return ob


def counts(coll):
    t, mats, obs = 0, set(), 0
    for ob in coll.all_objects:
        if ob.type == 'MESH':
            obs += 1
            n = tris(ob.data)
            for mod in ob.modifiers:
                if mod.type == 'SUBSURF':
                    n *= 4 ** mod.render_levels
            t += n
            mats |= {s.material.name for s in ob.material_slots if s.material}
    return t, sorted(mats), obs


def build(tall=LATE, wide=MID):
    sc = scene()
    clear()
    hull, glow, marble = materials()
    world(sc)
    kitm = kit(hull, glow)
    out = {}
    c1, e1 = build_layout(sc, 'tall', TALL, 0.0, tall, kitm, hull, glow, marble, hero=('cargo', 1, 0.0))
    c2, e2 = build_layout(sc, 'wide', WIDE, 40.0, wide, kitm, hull, glow, marble, hero=('mess', 0, 0.0))
    # three bays close up: waits for the first win, open, next goal
    c3 = bpy.data.collections.new('hub_close')
    sc.collection.children.link(c3)
    for i, (it, bay_col, prop_col) in enumerate((('world', C('warm', 0.05), C('muted', 0.2)), ('bot', C('warm'), C('cyan')), ('run', C('amber'), C('amber')))):
        x = -30 + i * 1.12
        add(c3, 'hub_close_bay_%s' % it, kitm['bay'], (x, 0, 0), bay_col)
        add(c3, 'hub_close_prop_%s' % it, kitm[it], (x + W / 2, D * 0.55, 0), prop_col)
    m = MB()
    m.box(-30.1, -30 + 3 * 1.12, 0, D, -0.2, 0, C('slab'), skip='b')
    add(c3, 'hub_close_beam', m.build('hub_close_beam', hull), (0, 0, 0))
    # cameras: the phone frames the tall ship as the page does (ship 362 of 390 px wide, its top 90 px down)
    wt = e1[1] - e1[0]
    oh = wt / 0.928 * (844 / 390)
    camera(sc, 'phone', ((e1[0] + e1[1]) / 2 + 0.1, 0, e1[2] + 0.107 * oh - oh / 2 - 0.25), oh, (780, 1688), tilt=(0.16, 0.13))
    ww = e2[1] - e2[0]
    ow = ww / 0.82
    camera(sc, 'window', ((e2[0] + e2[1]) / 2 + 0.3, 0, (e2[2] + e2[3]) / 2 - 0.35), ow, (1600, 1120), tilt=(0.16, 0.13))
    camera(sc, 'close', (-30 + 1.68, 0, 0.55), 4.4, (1600, 800), tilt=(0.2, 0.16))
    for nm, c in (('tall', c1), ('wide', c2), ('close', c3)):
        out[nm] = counts(c)
    out['reused'] = kitm.pop('_reused')
    out['kit'] = {k: tris(v) for k, v in kitm.items()}
    return out


def render(view, path):
    sc = scene()
    cam = bpy.data.objects['hub_cam_' + view]
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = cam['res']
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True, scene=sc.name)
    return path


# ------------------------------------------------------------------ showing the build in the 3D view (nothing here changes the scene's data)
STEPS = [('hull', ('_hull', '_mast', '_window', '_nozzles')), ('bays', ('_bay_',)), ('lift', ('_shaft_', '_hatch_', '_car', '_marble')),
         ('props', ('_prop_', '_set_', '_seal_')), ('outside', ('_airlock', '_cable', '_hollow'))]


def view3d():
    win = bpy.context.window
    for area in win.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    return win, area, region
    return None


def frame(objs, cam='phone'):
    """Turns the 3D view to the fixed camera's angle and frames `objs`. The view only: no object moves."""
    v = view3d()
    if not v:
        return 'no 3D view in this window'
    win, area, region = v
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    seen = [o for o in objs if o.visible_get()]
    for o in seen:
        o.select_set(True)
    r3d = area.spaces.active.region_3d
    r3d.view_perspective = 'ORTHO'
    r3d.view_rotation = bpy.data.objects['hub_cam_' + cam].matrix_world.to_quaternion()
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.view3d.view_selected()
    for o in seen:
        o.select_set(False)
    return 'framed %d objects' % len(seen)


def reveal(layout, upto):
    """Shows the first `upto` steps of a layout in the 3D view and hides its other parts (the eye icon only, renders are not affected)."""
    coll = bpy.data.collections['hub_' + layout]
    shown = [s for _, group in STEPS[:upto] for s in group]
    n = 0
    head = 'hub_' + layout
    for ob in coll.objects:  # a pattern ending in _ is a prefix (bays, props), any other is the whole name (the hull, the car)
        vis = any(ob.name.startswith(head + s) if s.endswith('_') else ob.name == head + s for s in shown)
        ob.hide_set(not vis)
        n += vis
    return n


def show_all():
    for ob in scene().objects:
        ob.hide_set(False)
