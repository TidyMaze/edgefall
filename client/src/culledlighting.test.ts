// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { describe, expect, it, vi } from 'vitest';

// The branches and loops the lights node opens, kept to check what they wrap.
const branches: { condition: THREE.Node; body: () => void }[] = [];
const loops: { count: unknown; body: (inputs: { i: THREE.Node }) => void }[] = [];
vi.mock('three/tsl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/tsl')>()),
  If: (condition: THREE.Node, body: () => void) => void branches.push({ condition, body }),
  Loop: (count: unknown, body: (inputs: { i: THREE.Node }) => void) => void loops.push({ count, body }),
}));
const { CulledLighting, MAX_LOOP_LIGHTS } = await import('./culledlighting');

type Culled = THREE.LightsNode & {
  loop: THREE.Node & { lights: THREE.PointLight[]; update(frame: { camera: THREE.Camera }): void; setup(builder: unknown): void };
};
const culled = (lights: THREE.Light[] = []): Culled => new CulledLighting().createNode(lights) as Culled;

describe('CulledLighting (#882)', () => {
  const node = (): THREE.LightsNode => new CulledLighting().createNode([]);

  it('makes a lights node for the lights it is given', () => {
    const light = new THREE.PointLight();
    const made = new CulledLighting().createNode([light]);
    expect(made).toBeInstanceOf(THREE.LightsNode);
    expect(made.getLights()).toEqual([light]);
  });

  it('hands the lights node of a released scene to the next scene, so its shaders keep their code and their programs (#1711)', () => {
    const lighting = new CulledLighting();
    const left = new THREE.Scene();
    const node = lighting.getNode(left);
    lighting.release(left);
    const next = new THREE.Scene();
    expect(lighting.getNode(next)).toBe(node); // the same loop, the same node ids: three finds the programs it linked
    expect(lighting.getNode(next)).toBe(node);
    expect(lighting.getNode(left)).not.toBe(node); // a released scene drawn again gets a node of its own
    lighting.release(new THREE.Scene()); // a scene never drawn has no node to give back
    expect(lighting.getNode(new THREE.Scene())).not.toBe(node);
  });

  it('gives a mesh drawn alone three\'s own node, and a group a node of its own (#1711)', () => {
    const lighting = new CulledLighting();
    expect(lighting.getNode(new THREE.Mesh() as unknown as THREE.Scene)).toBe(new CulledLighting().getNode(new THREE.Mesh() as unknown as THREE.Scene)); // three's default node
    const group = new THREE.Group() as unknown as THREE.Scene;
    expect(lighting.getNode(group)).toBe(lighting.getNode(group));
  });

  it('on a scene left, hands its node on under WebGL, frees it under another lighting (#1258, #1711)', () => {
    const lighting = new CulledLighting();
    const left = new THREE.Scene();
    const node = lighting.getNode(left);
    CulledLighting.releaseScene(lighting, left);
    expect(lighting.getNode(new THREE.Scene())).toBe(node);
    const other = new THREE.Lighting();
    const scene = new THREE.Scene();
    const dispose = vi.spyOn(other.getNode(scene), 'dispose');
    CulledLighting.releaseScene(other, scene);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('declares the direct light sums before the lights, so the sums outlive each light\'s branch', () => {
    const order: string[] = [];
    const sum = (name: string): { addAssign: (v: number) => void } => ({ addAssign: (v) => void order.push(`${name} += ${v}`) });
    const builder = { context: { reflectedLight: { directDiffuse: sum('diffuse'), directSpecular: sum('specular') } } };
    const light = { build: () => void order.push('light') };
    node().setupLights(builder as never, [light as never]);
    expect(order).toEqual(['diffuse += 0', 'specular += 0', 'light']);
  });

  it('shades a point light only inside a branch on its cutoff distance', () => {
    const shade = vi.spyOn(THREE.LightsNode.prototype, 'setupDirectLight').mockImplementation(() => {});
    const point = { light: new THREE.PointLight(), cutoffDistanceNode: uniform(8), getLightVector: () => vec3(1, 2, 3) };
    const data = { lightColor: vec3(1) };
    branches.length = 0;
    node().setupDirectLight({} as never, point as never, data as never);
    expect(shade).not.toHaveBeenCalled();
    expect(branches).toHaveLength(1);
    expect(branches[0]!.condition.isNode).toBe(true);
    branches[0]!.body();
    expect(shade).toHaveBeenCalledWith({}, point, data);
    shade.mockRestore();
  });

  it('shades any other light as three does, with no branch', () => {
    const shade = vi.spyOn(THREE.LightsNode.prototype, 'setupDirectLight').mockImplementation(() => {});
    const other = { light: new THREE.DirectionalLight() };
    branches.length = 0;
    node().setupDirectLight({} as never, other as never, {} as never);
    expect(shade).toHaveBeenCalledWith({}, other, {});
    expect(branches).toHaveLength(0);
    shade.mockRestore();
  });
});

// One unrolled copy of the light code per point light made each lit shader about 200 KB with the 76 lights: software
// WebGL took 17 s to compile a page (#921). The point lights are shaded in one loop over uniform arrays instead.
describe('the point lights in one shader loop (#921)', () => {
  it('loops over the plain point lights and leaves the other lights to three', () => {
    const point = new THREE.PointLight();
    const sun = new THREE.DirectionalLight();
    const shadowed = new THREE.PointLight();
    shadowed.castShadow = true;
    const made = culled([point, sun, shadowed]);
    expect(made.loop.lights).toEqual([point]);
    expect(made.getBuiltinLights()).toEqual([sun, shadowed]);
    expect(made.getLights()).toEqual([point, sun, shadowed]);
  });

  it('gives a light past the loop\'s room its own node, as before', () => {
    const lights = Array.from({ length: MAX_LOOP_LIGHTS + 1 }, () => new THREE.PointLight());
    const made = culled(lights);
    expect(made.loop.lights).toEqual(lights.slice(0, MAX_LOOP_LIGHTS));
    expect(made.getBuiltinLights()).toEqual([lights[MAX_LOOP_LIGHTS]]);
  });

  it('sorts the lights again each time the renderer hands them over', () => {
    const made = culled([new THREE.PointLight(), new THREE.PointLight()]);
    const sun = new THREE.DirectionalLight();
    made.setLights([sun]);
    expect(made.loop.lights).toEqual([]);
    expect(made.getBuiltinLights()).toEqual([sun]);
  });

  it('keeps the shader when the looped lights change, so lighting a lamp builds no new program', () => {
    const sun = new THREE.DirectionalLight();
    const one = culled([sun, new THREE.PointLight()]).customCacheKey();
    const three = culled([sun, new THREE.PointLight(), new THREE.PointLight(), new THREE.PointLight()]).customCacheKey();
    expect(three).toBe(one);
  });

  it('builds the loop after the lights three shades itself', () => {
    const sun = new THREE.DirectionalLight();
    const made = culled([new THREE.PointLight(), sun]);
    const sunNode = { light: sun, isAnalyticLightNode: true };
    const builder = {
      getDataFromNode: () => ({}),
      context: { materialLightings: [] },
      renderer: { library: { getLightNodeClass: () => function SunNode() { return sunNode; } } },
    };
    expect(made.setupLightsNode(builder as never)).toEqual([sunNode, made.loop]);
  });

  it('hands the shader each light\'s view position and cutoff, its colour times intensity and its decay, each render', () => {
    const light = new THREE.PointLight(0xff8040, 1.5, 8, 2);
    light.position.set(1, 2, 3);
    light.updateMatrixWorld();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const made = culled([light]);
    made.loop.update({ camera });
    const { positions, colors, count } = made.loop as unknown as { positions: THREE.Vector4[]; colors: THREE.Vector4[]; count: { value: number } };
    expect(count.value).toBe(1);
    expect(positions[0]!.toArray()).toEqual([1, 2, -7, 8]);
    const color = new THREE.Color(0xff8040).multiplyScalar(1.5);
    expect(colors[0]!.toArray()).toEqual([color.r, color.g, color.b, 2]);
  });

  it('shades each looped light with three\'s point light, only inside its cutoff', () => {
    const direct = vi.fn();
    const reflectedLight = { directDiffuse: vec3(0), directSpecular: vec3(0) };
    const builder = { context: { lightingModel: { direct }, reflectedLight } };
    const made = culled([new THREE.PointLight()]);
    loops.length = 0;
    branches.length = 0;
    made.loop.setup(builder);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.count).toBe((made.loop as unknown as { count: unknown }).count);
    loops[0]!.body({ i: uniform(0, 'int') });
    expect(direct).not.toHaveBeenCalled();
    expect(branches).toHaveLength(1);
    expect(branches[0]!.condition.isNode).toBe(true);
    branches[0]!.body();
    expect(direct).toHaveBeenCalledTimes(1);
    const [data, passed] = direct.mock.calls[0]!;
    expect(passed).toBe(builder);
    expect(data.lightDirection.isNode).toBe(true);
    expect(data.lightColor.isNode).toBe(true);
    expect(data.reflectedLight).toBe(reflectedLight);
    expect(data.lightNode.shadowNode).toBeNull();
  });
});
