import { describe, expect, it } from 'vitest';
import { instancesAsAttributes } from './webglprograms';

describe('instance matrices as attributes on WebGL (#1711)', () => {
  it('leaves no room for uniform arrays of matrices on the WebGL backend, and leaves another backend as it is', () => {
    const webgl = { capabilities: { maxUniformBlockSize: null as number | null } };
    instancesAsAttributes(webgl);
    expect(webgl.capabilities.maxUniformBlockSize).toBe(0);
    const webgpu = { capabilities: { getUniformBufferLimit: () => 65536 } };
    instancesAsAttributes(webgpu);
    expect(webgpu.capabilities).toEqual({ getUniformBufferLimit: webgpu.capabilities.getUniformBufferLimit });
    expect(() => instancesAsAttributes({})).not.toThrow();
  });
});
