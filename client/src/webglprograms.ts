// The WebGL programs a world entry links (#1711). three gives an InstancedMesh under the uniform buffer limit a uniform array of its
// matrices, named by the node's id and sized by its count (`mat4 buffer<id>[count]`): one program per mesh, and new ones at each entry,
// since the next world's meshes are new nodes. With no room for such arrays, three reads the matrices as instance attributes, whose code
// is the same for every mesh of a material: the programs of the last entry serve the next. Only the instance matrices, the skinned
// meshes and `range()` read that limit, and the page has neither of the last two.
type Backend = { capabilities?: { maxUniformBlockSize?: number | null } };

/** On the WebGL backend, the instance matrices go as attributes from now on. The WebGPU backend has no such limit field: unchanged. */
export function instancesAsAttributes(backend: unknown): void {
  const caps = (backend as Backend).capabilities;
  if (caps && 'maxUniformBlockSize' in caps) caps.maxUniformBlockSize = 0;
}
