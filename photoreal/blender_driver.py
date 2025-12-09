"""Blender render driver.

Usage (invoked by server.py):
  blender --background --python blender_driver.py -- payload.json output.png quality

The payload file contains the snapshot, camera info, and metadata exported from
the browser. This script builds a simplified architectural scene (rooms as
extruded boxes, pools as water volumes, etc.), configures lighting, and renders
with Cycles. When executed outside Blender, it simply reports an error so the
server can fall back to placeholder imagery.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

try:
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore
except Exception as exc:  # pragma: no cover - only triggered outside Blender
    sys.stderr.write('Blender Python API unavailable: %s\n' % exc)
    sys.exit(1)


def _coerce_vec(value):
    if not value or not isinstance(value, (list, tuple)):
        return Vector((0.0, 0.0, 0.0))
    x = float(value[0]) if len(value) > 0 and math.isfinite(value[0]) else 0.0
    y = float(value[1]) if len(value) > 1 and math.isfinite(value[1]) else 0.0
    z = float(value[2]) if len(value) > 2 and math.isfinite(value[2]) else 0.0
    # Convert from Three.js (x, y=up, z depth) to Blender (x, z, y)
    return Vector((x, z, y))


def _clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _ensure_cycles(samples: int):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.preview_samples = max(32, samples // 4)
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 12
    scene.cycles.glossy_bounces = 6
    scene.cycles.transmission_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.progressive = 'PATH'
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_min_samples = 64


def _build_materials():
    def make_material(name, props):
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get('Principled BSDF')
        if props.get('base_color'):
            bsdf.inputs['Base Color'].default_value = props['base_color']
        bsdf.inputs['Roughness'].default_value = props.get('roughness', 0.4)
        bsdf.inputs['Specular'].default_value = props.get('specular', 0.5)
        bsdf.inputs['Metallic'].default_value = props.get('metallic', 0.0)
        if props.get('transmission'):
            bsdf.inputs['Transmission'].default_value = props['transmission']
        if props.get('ior'):
            bsdf.inputs['IOR'].default_value = props['ior']
        if props.get('clearcoat'):
            bsdf.inputs['Clearcoat'].default_value = props['clearcoat']
            bsdf.inputs['Clearcoat Roughness'].default_value = props.get('clearcoat_roughness', 0.1)
        if props.get('alpha') is not None:
            mat.blend_method = 'BLEND'
            bsdf.inputs['Alpha'].default_value = props['alpha']
        return mat

    palette = {
        'wall_white': {
            'base_color': (0.95, 0.95, 0.93, 1.0),
            'roughness': 0.35,
            'specular': 0.4,
            'clearcoat': 0.2,
            'clearcoat_roughness': 0.2
        },
        'roof_dark': {
            'base_color': (0.1, 0.1, 0.1, 1.0),
            'roughness': 0.4,
            'metallic': 0.2
        },
        'glass_clear': {
            'base_color': (0.95, 0.97, 1.0, 1.0),
            'roughness': 0.02,
            'transmission': 0.98,
            'ior': 1.52
        },
        'water_pool': {
            'base_color': (0.2, 0.5, 0.75, 1.0),
            'roughness': 0.03,
            'transmission': 0.95,
            'ior': 1.333
        },
        'ground_grass': {
            'base_color': (0.25, 0.35, 0.18, 1.0),
            'roughness': 0.8
        }
    }
    return { key: make_material(key, props) for key, props in palette.items() }


def _add_box(name: str, center, dims, material, base_height=0.0):
    width = max(0.01, float(dims[0]))
    depth = max(0.01, float(dims[2] if len(dims) > 2 else dims[1]))
    height = max(0.01, float(dims[1] if len(dims) > 1 else dims[2]))
    pos = _coerce_vec(center)
    # Adjust vertical center to Blender coordinates
    pos.z = float(base_height) + height / 2.0
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=pos)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width / 2.0, depth / 2.0, height / 2.0)
    if material:
        obj.data.materials.append(material)
    return obj


def _add_ground(material):
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'Ground'
    ground.data.materials.append(material)
    return ground


def _add_footprint_volume(name, footprint, height, material, base_height=0.0):
    if not footprint or len(footprint) < 3:
        return None
    curve = bpy.data.curves.new(name=name, type='CURVE')
    curve.dimensions = '2D'
    spline = curve.splines.new('POLY')
    spline.points.add(len(footprint) - 1)
    for idx, pt in enumerate(footprint):
        spline.points[idx].co = (float(pt['x']), float(pt['z']), 0.0, 1.0)
    spline.use_cyclic_u = True
    curve.extrude = height
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location.z = base_height
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    if material:
        obj.data.materials.append(material)
    return obj


def _add_wall_strip(name, strip, material):
    if not strip:
        return None
    start = strip.get('start') or {}
    end = strip.get('end') or {}
    sx = float(start.get('x', 0.0))
    sz = float(start.get('z', 0.0))
    ex = float(end.get('x', sx))
    ez = float(end.get('z', sz))
    base = float(strip.get('baseHeight', 0.0))
    height = float(strip.get('height', 3.0))
    thickness = max(0.02, float(strip.get('thickness', 0.25)))
    length = math.hypot(ex - sx, ez - sz)
    if length < 0.01:
        return None
    mid_x = (sx + ex) / 2.0
    mid_z = (sz + ez) / 2.0
    angle = math.atan2(ez - sz, ex - sx)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(mid_x, mid_z, base + height / 2.0))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (length / 2.0, thickness / 2.0, height / 2.0)
    obj.rotation_euler = (0.0, 0.0, angle)
    if material:
        obj.data.materials.append(material)
    return obj


def _setup_world():
    world = bpy.context.scene.world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    bg = nodes.get('Background')
    bg.inputs['Color'].default_value = (0.7, 0.8, 1.0, 1.0)
    bg.inputs['Strength'].default_value = 1.2


def _setup_sun():
    bpy.ops.object.light_add(type='SUN', location=(15, -10, 18))
    sun = bpy.context.active_object
    sun.data.energy = 6.0
    sun.rotation_euler = (math.radians(45), math.radians(5), math.radians(35))
    return sun


def _setup_camera(payload):
    cam_data = payload.get('camera') or {}
    view = payload.get('view') or {}
    position = _coerce_vec(cam_data.get('position') or view.get('position'))
    target = _coerce_vec(cam_data.get('target') or view.get('target'))
    up_vec = cam_data.get('up') or view.get('up') or [0, 1, 0]
    up = _coerce_vec(up_vec)

    bpy.ops.object.camera_add(location=position)
    cam_obj = bpy.context.active_object
    cam_obj.name = 'RenderCamera'
    direction = (target - position)
    if direction.length < 0.001:
        direction = Vector((0.0, 1.0, 0.0))
    cam_obj.rotation_mode = 'QUATERNION'
    cam_obj.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    cam_obj.data.lens_unit = 'FOV'
    fov = cam_data.get('fov') or 50.0
    cam_obj.data.angle = math.radians(max(10.0, min(120.0, fov)))
    bpy.context.scene.camera = cam_obj
    bpy.context.scene.view_layers[0].update()
    return cam_obj


def _load_snapshot(payload, mats):
    snapshot = payload.get('snapshot') or {}
    all_items = []
    material_map = {
        'room': 'wall_white',
        'garage': 'wall_white',
        'pergola': 'wall_white',
        'balcony': 'wall_white',
        'furniture': 'wall_white',
        'roof': 'roof_dark',
        'pool': 'water_pool',
        'stairs': 'wall_white'
    }

    def add_items(items, kind):
        for idx, item in enumerate(items or []):
            if not isinstance(item, dict):
                continue
            width = float(item.get('width') or 0.01)
            depth = float(item.get('depth') or width)
            height = float(item.get('height') or 3.0)
            base = float(item.get('baseHeight') or item.get('y') or 0.0)
            center = [item.get('x', 0.0), base, item.get('z', 0.0)]
            material = mats.get(material_map.get(kind, 'wall_white')) or mats.get('wall_white')
            name = f"{kind}_{idx}"
            footprint = item.get('footprint')
            if footprint:
                obj = _add_footprint_volume(name, footprint, height, material, base)
            else:
                obj = _add_box(name, center, (width, height, depth), material, base)
            if obj:
                all_items.append(obj)

    add_items(snapshot.get('rooms'), 'room')
    add_items(snapshot.get('garages'), 'garage')
    add_items(snapshot.get('pools'), 'pool')
    add_items(snapshot.get('pergolas'), 'pergola')
    add_items(snapshot.get('balconies'), 'balcony')
    add_items(snapshot.get('furniture'), 'furniture')
    add_items(snapshot.get('roofs'), 'roof')
    add_items(snapshot.get('stairs'), 'stairs')

    for idx, strip in enumerate(snapshot.get('wallStrips') or []):
        _add_wall_strip(f'wallstrip_{idx}', strip, mats.get('wall_white'))

    return all_items


def _configure_output(output_path: Path, payload, quality):
    scene = bpy.context.scene
    width = int(payload.get('stage', {}).get('width') or 3840)
    height = int(payload.get('stage', {}).get('height') or 2160)
    width = max(1280, min(width, 7680))
    height = max(720, min(height, 4320))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 15
    scene.render.filepath = str(output_path)
    samples = int(512 * quality)
    _ensure_cycles(max(64, min(samples, 4096)))


def _render_scene() -> bool:
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as exc:  # pragma: no cover
        sys.stderr.write('Blender render failed: %s\n' % exc)
        return False
    return True


def main(args):
    if len(args) < 3:
        sys.stderr.write('Usage: blender_driver.py <payload.json> <output.png> <quality>\n')
        return 1
    payload_file = Path(args[0])
    output_file = Path(args[1])
    try:
        quality = float(args[2])
    except Exception:
        quality = 1.0

    with payload_file.open('r', encoding='utf-8') as handle:
        payload = json.load(handle)

    _clear_scene()
    mats = _build_materials()
    _add_ground(mats['ground_grass'])
    _setup_world()
    _setup_sun()
    _setup_camera(payload)
    _load_snapshot(payload, mats)
    _configure_output(output_file, payload, max(0.5, min(quality, 4.0)))

    success = _render_scene()
    if success:
        print(f'RENDER_COMPLETE:{output_file}')
        return 0
    return 2


if __name__ == '__main__':
    exit_code = main(sys.argv[1:])
    sys.exit(exit_code)
