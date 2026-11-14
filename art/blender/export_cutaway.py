"""Headless export of the Hub Cutaway (#1689):
  /Applications/Blender.app/Contents/MacOS/Blender -b art/blender/hub-cutaway.blend -P art/blender/export_cutaway.py
Writes art/blender/export/hub-cutaway-{tall,wide}.glb (Blender Z up -> glTF Y up; the cut faces +Z). One node per part, named
hub_<layout>_<part>_<deck>_<room>; the colours of a deck and a state are the game's (client/src/hubcutaway.ts), so no object colour is exported.
COLOR_0 = the base colour (rgb) and the glow mask (alpha). Every state's props are in the file: a boss door is exported shut (_shut) and
open (_open), with its seal (hub_<layout>_seal_<deck>_<boss>); the game shows the ones of the state. Nothing is saved to the .blend."""
import os
import re

import bpy

OUT = os.path.join(os.path.dirname(bpy.data.filepath), 'export')
BOSS_DATA = ('hub_prop_boss', 'hub_prop_boss_open')


def alpha_is_glow(me):
    """Puts the glow mask in the alpha of the colour layer ('Col'); a mesh with no mask (the hull) gets 0, it never glows."""
    if me.get('glow_packed'):  # a mesh is shared by many nodes, and by both layouts
        return
    me['glow_packed'] = True
    col = me.color_attributes['Col']
    glow = me.color_attributes.get('Glow')
    for i in range(len(me.loops)):
        r, g, b, _ = col.data[i].color
        col.data[i].color = (r, g, b, glow.data[i].color[0] if glow else 0.0)
    me.color_attributes.active_color = col
    if glow:
        me.color_attributes.remove(glow)  # one colour layer in the file: COLOR_0


def both_states(layout):
    """Every boss door as a shut and an open prop, and a seal on each (the blend holds the state it was built in)."""
    coll = bpy.data.collections['hub_' + layout]
    seal = bpy.data.meshes['hub_prop_seal']
    bosses = [o for o in coll.objects if o.data and o.data.name in BOSS_DATA]
    for o in [o for o in coll.objects if o.name.startswith('hub_%s_seal_' % layout)]:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in bosses:
        base = re.sub(r'\.\d+$', '', o.name)
        for name, mesh in (('shut', bpy.data.meshes['hub_prop_boss']), ('open', bpy.data.meshes['hub_prop_boss_open'])):
            n = bpy.data.objects.new('%s_%s' % (base, name), mesh)
            n.location = o.location
            coll.objects.link(n)
        s = bpy.data.objects.new(base.replace('_prop_', '_seal_'), seal)
        s.location = o.location
        coll.objects.link(s)
        bpy.data.objects.remove(o, do_unlink=True)


def export(layout):
    both_states(layout)
    sc = bpy.data.scenes['Hub Cutaway']
    bpy.context.window.scene = sc
    print('SCENE', bpy.context.scene.name)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    chosen = [o for o in sc.collection.all_objects if o.type == 'MESH' and o.name.startswith('hub_%s_' % layout)]
    for o in chosen:
        if 'Col' in o.data.color_attributes:
            alpha_is_glow(o.data)
        o.select_set(True)
    path = os.path.join(OUT, 'hub-cutaway-%s.glb' % layout)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, use_active_scene=True, export_cameras=False,
                              export_lights=False, export_materials='EXPORT', export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True,
                              export_attributes=False, export_texcoords=False, export_normals=True, export_extras=False, export_animations=False)
    tris = sum(len(p.vertices) - 2 for o in chosen for p in o.data.polygons)
    print('EXPORTED', path, len(chosen), 'nodes', tris, 'tris counting every state')


os.makedirs(OUT, exist_ok=True)
for layout in ('tall', 'wide'):
    export(layout)
