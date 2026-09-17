#!/usr/bin/env python3
"""Build and optionally render the Straight Line Mission Earth flyover.

Run from the repo root with Blender:

    /Applications/Blender.app/Contents/MacOS/Blender --python tools/render_straight_line_flyover.py -- --render

The default route is the current minland candidate from the 1 km heatmap:
lat/lon A = (36.1, -30), B = (-55.3, 30).
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "assets" / "straight-line-flyover"
DEFAULT_TEXTURE = DEFAULT_OUTPUT_DIR / "blue-marble-july-5400.jpg"
DEFAULT_STAR_MAP = DEFAULT_OUTPUT_DIR / "tycho-skymap-t4-4096.jpg"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    script_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lat-a", type=float, default=36.1)
    parser.add_argument("--lon-a", type=float, default=-30.0)
    parser.add_argument("--lat-b", type=float, default=-55.3)
    parser.add_argument("--lon-b", type=float, default=30.0)
    parser.add_argument("--focus-lat", type=float, default=65.6, help="Camera path anchor latitude.")
    parser.add_argument("--focus-lon", type=float, default=-104.6, help="Camera path anchor longitude.")
    parser.add_argument("--arc-degrees", type=float, default=360.0, help="Degrees of great-circle travel in the animation.")
    parser.add_argument("--altitude", type=float, default=0.30, help="Camera altitude in Earth radii above the surface.")
    parser.add_argument("--lookahead", type=float, default=1.10, help="How far along the tangent the camera looks.")
    parser.add_argument("--texture", type=Path, default=DEFAULT_TEXTURE)
    parser.add_argument("--star-map", type=Path, default=DEFAULT_STAR_MAP)
    parser.add_argument("--ease-camera", action="store_true", help="Ease camera motion; leave off for a seamless full-circle loop.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument("--frames", type=int, default=240)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--blend-name", default="straight-line-flyover.blend")
    parser.add_argument("--movie-name", default="straight-line-flyover.mp4")
    return parser.parse_args(script_args)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def lat_lon_to_xyz(lat_deg: float, lon_deg: float, radius: float = 1.0) -> Vector:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    cos_lat = math.cos(lat)
    return Vector((radius * cos_lat * math.cos(lon), radius * cos_lat * math.sin(lon), radius * math.sin(lat)))


def make_route_basis(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> tuple[Vector, Vector, Vector]:
    a = lat_lon_to_xyz(lat_a, lon_a).normalized()
    b = lat_lon_to_xyz(lat_b, lon_b).normalized()
    normal = a.cross(b)
    if normal.length < 1e-8:
        raise ValueError("Route endpoints are identical or antipodal and do not define one great circle.")
    normal.normalize()
    e1 = a
    e2 = normal.cross(e1).normalized()
    return e1, e2, normal


def route_point(e1: Vector, e2: Vector, theta: float, radius: float = 1.0) -> Vector:
    return radius * (math.cos(theta) * e1 + math.sin(theta) * e2)


def route_tangent(e1: Vector, e2: Vector, theta: float) -> Vector:
    return (-math.sin(theta) * e1 + math.cos(theta) * e2).normalized()


def closest_theta_to_lat_lon(e1: Vector, e2: Vector, lat: float, lon: float) -> float:
    target = lat_lon_to_xyz(lat, lon).normalized()
    best_theta = 0.0
    best_dot = -2.0
    for i in range(1440):
        theta = 2.0 * math.pi * i / 1440
        dot = route_point(e1, e2, theta).dot(target)
        if dot > best_dot:
            best_dot = dot
            best_theta = theta
    return best_theta


def create_lat_lon_sphere_mesh(
    name: str,
    radius: float = 1.0,
    segments: int = 192,
    rings: int = 96,
    inward_faces: bool = False,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    faces: list[tuple[int, int, int, int]] = []

    for i in range(rings + 1):
        lat = -math.pi / 2.0 + math.pi * i / rings
        for j in range(segments + 1):
            lon = -math.pi + 2.0 * math.pi * j / segments
            cos_lat = math.cos(lat)
            vertices.append((radius * cos_lat * math.cos(lon), radius * cos_lat * math.sin(lon), radius * math.sin(lat)))
            uvs.append((j / segments, i / rings))

    for i in range(rings):
        for j in range(segments):
            a = i * (segments + 1) + j
            b = a + 1
            c = (i + 1) * (segments + 1) + j + 1
            d = c - 1
            faces.append((a, d, c, b) if inward_faces else (a, b, c, d))

    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="LatLonUV")
    for poly in mesh.polygons:
        poly.use_smooth = True
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uvs[vertex_index]

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def create_uv_earth_mesh(name: str, segments: int = 192, rings: int = 96) -> bpy.types.Object:
    return create_lat_lon_sphere_mesh(name, segments=segments, rings=rings)


def make_earth_material(texture_path: Path) -> bpy.types.Material:
    material = bpy.data.materials.new("NASA Blue Marble July")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if not bsdf:
        return material
    if texture_path.exists():
        image = bpy.data.images.load(str(texture_path))
        tex = nodes.new(type="ShaderNodeTexImage")
        tex.name = "Blue Marble July 2004"
        tex.image = image
        material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.05, 0.17, 0.34, 1.0)
        print(f"WARNING: Missing texture {texture_path}; Earth will render as plain ocean blue.")
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.82
    if "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = 0.18
    return material


def make_star_material(star_map_path: Path, strength: float = 0.75) -> bpy.types.Material:
    material = bpy.data.materials.new("NASA SVS Tycho star sphere")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new(type="ShaderNodeOutputMaterial")
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Strength"].default_value = strength
    if star_map_path.exists():
        image = bpy.data.images.load(str(star_map_path))
        tex = nodes.new(type="ShaderNodeTexImage")
        tex.name = "Tycho Skymap II threshold 4"
        tex.image = image
        material.node_tree.links.new(tex.outputs["Color"], emission.inputs["Color"])
    else:
        emission.inputs["Color"].default_value = (0.01, 0.012, 0.018, 1.0)
        print(f"WARNING: Missing star map {star_map_path}; star sphere will render as dark blue.")
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def create_star_sphere(star_map_path: Path) -> bpy.types.Object:
    star_sphere = create_lat_lon_sphere_mesh(
        "Tycho star sphere",
        radius=18.0,
        segments=192,
        rings=96,
        inward_faces=True,
    )
    star_sphere.data.materials.append(make_star_material(star_map_path))
    return star_sphere


def make_emission_material(name: str, color: tuple[float, float, float, float], strength: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new(type="ShaderNodeOutputMaterial")
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = strength
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def create_dotted_route(e1: Vector, e2: Vector) -> bpy.types.Object:
    material = make_emission_material("Dotted mission line", (1.0, 0.86, 0.08, 1.0), 2.8)
    curve = bpy.data.curves.new("Minland dotted great circle", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = 0.0042
    curve.bevel_resolution = 2

    dash_count = 132
    dash_fraction = 0.43
    points_per_dash = 7
    for dash in range(dash_count):
        start = 2.0 * math.pi * dash / dash_count
        end = start + 2.0 * math.pi * dash_fraction / dash_count
        spline = curve.splines.new(type="POLY")
        spline.points.add(points_per_dash - 1)
        for idx in range(points_per_dash):
            theta = start + (end - start) * idx / (points_per_dash - 1)
            p = route_point(e1, e2, theta, radius=1.010)
            spline.points[idx].co = (p.x, p.y, p.z, 1.0)

    obj = bpy.data.objects.new("Dotted yellow minland great circle", curve)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def make_atmosphere() -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.018, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = "Thin atmosphere"
    bpy.ops.object.shade_smooth()

    material = bpy.data.materials.new("Thin blue limb glow")
    material.use_nodes = True
    material.blend_method = "BLEND"
    material.use_screen_refraction = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.18, 0.55, 1.0, 0.22)
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = 0.16
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.3
    obj.data.materials.append(material)
    return obj


def look_rotation(location: Vector, target: Vector, up_hint: Vector) -> Matrix:
    forward = (target - location).normalized()
    right = forward.cross(up_hint).normalized()
    if right.length < 1e-6:
        right = Vector((1.0, 0.0, 0.0))
    up = right.cross(forward).normalized()
    return Matrix(((right.x, up.x, -forward.x), (right.y, up.y, -forward.y), (right.z, up.z, -forward.z)))


def add_camera_animation(args: argparse.Namespace, e1: Vector, e2: Vector) -> bpy.types.Object:
    camera_data = bpy.data.cameras.new("Flyover camera")
    camera_data.angle = math.radians(55.0)
    camera_data.clip_start = 0.01
    camera_data.clip_end = 20.0
    camera = bpy.data.objects.new("Flyover camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    center_theta = closest_theta_to_lat_lon(e1, e2, args.focus_lat, args.focus_lon)
    arc = math.radians(args.arc_degrees)
    for frame in range(1, args.frames + 1):
        t = 0.0 if args.frames == 1 else (frame - 1) / args.frames
        progress = t * t * (3.0 - 2.0 * t) if args.ease_camera else t
        theta = center_theta + (progress - 0.5) * arc
        surface = route_point(e1, e2, theta).normalized()
        tangent = route_tangent(e1, e2, theta)
        camera.location = surface * (1.0 + args.altitude)
        target = surface * 0.20 + tangent * args.lookahead
        camera.rotation_euler = look_rotation(camera.location, target, surface).to_euler()
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)

    light_data = bpy.data.lights.new("Camera fill", type="AREA")
    light_data.energy = 60.0
    light_data.size = 4.5
    light = bpy.data.objects.new("Camera fill", light_data)
    light.parent = camera
    light.location = (-0.5, 0.45, 0.35)
    light.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.collection.objects.link(light)
    return camera


def add_scene_lighting() -> None:
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.color = (0.002, 0.005, 0.014)

    sun_data = bpy.data.lights.new("Low angled sun", type="SUN")
    sun_data.energy = 2.8
    sun = bpy.data.objects.new("Low angled sun", sun_data)
    sun.rotation_euler = (math.radians(72.0), 0.0, math.radians(-38.0))
    bpy.context.collection.objects.link(sun)

    rim_data = bpy.data.lights.new("Cool blue rim", type="SUN")
    rim_data.energy = 0.38
    rim = bpy.data.objects.new("Cool blue rim", rim_data)
    rim.rotation_euler = (math.radians(112.0), 0.0, math.radians(140.0))
    rim_data.color = (0.45, 0.66, 1.0)
    bpy.context.collection.objects.link(rim)


def configure_render(args: argparse.Namespace) -> None:
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.frame_start = 1
    scene.frame_end = args.frames
    scene.frame_set(1)
    scene.render.fps = args.fps
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 64
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 3.0
    scene.eevee.gtao_factor = 1.2

    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "High Contrast"
    scene.view_settings.exposure = -0.15
    scene.view_settings.gamma = 1.0

    args.output_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(args.output_dir / args.movie_name)
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.ffmpeg.audio_codec = "NONE"


def main() -> None:
    args = parse_args()
    args.texture = args.texture.expanduser().resolve()
    args.star_map = args.star_map.expanduser().resolve()
    args.output_dir = args.output_dir.expanduser().resolve()
    reset_scene()

    e1, e2, _normal = make_route_basis(args.lat_a, args.lon_a, args.lat_b, args.lon_b)

    create_star_sphere(args.star_map)
    earth = create_uv_earth_mesh("Earth")
    earth.data.materials.append(make_earth_material(args.texture))
    create_dotted_route(e1, e2)
    make_atmosphere()
    add_scene_lighting()
    add_camera_animation(args, e1, e2)
    configure_render(args)

    blend_path = args.output_dir / args.blend_name
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    print(f"Saved Blender scene: {blend_path}")

    if args.render:
        print(f"Rendering animation to: {args.output_dir / args.movie_name}")
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
