import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { to3MF, toGLB, toSTL, heatmapColors } from '../src/exporters.js';
import { formatOf, loadModel, parse3MF, parseOBJ, parsePLY, parseSTL, sniffUnits } from '../src/io.js';
import { cup, cylinder, scaleMesh, sphere } from '../src/fixtures.js';
import { isClosed, volume } from '../src/mesh.js';
import { repair } from '../src/repair.js';
import type { MeshData } from '../src/types.js';

/** Faceted geometry never round-trips bit-exactly; compare relative volume. */
const sameVolume = (a: MeshData, b: MeshData, percent = 0.01) => {
  expect(Math.abs(volume(a) - volume(b)) / volume(b)).toBeLessThan(percent / 100);
};

describe('formatOf', () => {
  it('recognises every supported extension', () => {
    expect(formatOf('pot.stl')).toBe('stl');
    expect(formatOf('pot.OBJ')).toBe('obj');
    expect(formatOf('pot.ply')).toBe('ply');
    expect(formatOf('pot.3mf')).toBe('3mf');
    expect(formatOf('pot.step')).toBe('step');
    expect(formatOf('pot.stp')).toBe('step');
  });

  it('says so plainly when it cannot', () => {
    expect(() => formatOf('pot.dwg')).toThrow(/Unsupported/);
  });
});

describe('STL round-trip', () => {
  it('survives export and re-import with the same volume', async () => {
    const original = cup();
    const bytes = toSTL(original);
    const reloaded = parseSTL(bytes);

    // STL has no shared vertices, so the reload is triangle soup by definition.
    // It only becomes a solid again after welding -- which is exactly why repair
    // exists, and why this is the single most common "broken mesh" in the wild.
    expect(isClosed(reloaded)).toBe(false);

    const healed = await repair(reloaded);
    expect(healed.report.ok).toBe(true);
    sameVolume(healed.mesh, original);
  });

  it('detects binary vs ASCII by length arithmetic, not by the header', async () => {
    // Plenty of binary STLs begin with the word "solid", which is supposed to
    // mean ASCII. Trusting the header is how you get a parser that fails on real
    // files from real exporters.
    const bytes = toSTL(cylinder(10, 20));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('slipc');
    const parsed = parseSTL(bytes);
    expect(parsed.indices.length).toBe(cylinder(10, 20).indices.length);
  });

  it('reads ASCII STL', async () => {
    const ascii = `solid t
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid t`;
    const parsed = parseSTL(new TextEncoder().encode(ascii));
    expect(parsed.indices.length).toBe(3);
    expect(parsed.positions[3]).toBe(1);
  });
});

describe('3MF round-trip', () => {
  it('survives export and re-import', async () => {
    const original = sphere(20);
    const bytes = to3MF([{ name: 'sphere', mesh: original }]);
    const reloaded = await parse3MF(bytes);

    expect(isClosed(reloaded)).toBe(true); // 3MF keeps shared vertices, unlike STL
    sameVolume(reloaded, original);
  });

  it('declares millimetres, so a slicer cannot guess wrong', () => {
    const bytes = to3MF([{ name: 'x', mesh: cylinder() }]);
    const files = unzipSync(bytes);
    const model = strFromU8(files['3D/3dmodel.model']!);
    expect(model).toContain('unit="millimeter"');
  });
});

describe('OBJ and PLY', () => {
  it('parses OBJ, including 1-based and negative indices', () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf -3 -2 -1`;
    const mesh = parseOBJ(obj);
    expect(mesh.indices.length).toBe(6);
    expect(Array.from(mesh.indices.slice(0, 3))).toEqual([0, 1, 2]);
    expect(Array.from(mesh.indices.slice(3, 6))).toEqual([0, 1, 2]);
  });

  it('fan-triangulates OBJ polygons', () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4`;
    expect(parseOBJ(obj).indices.length).toBe(6); // a quad becomes two triangles
  });

  it('parses ASCII PLY', () => {
    const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_index
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2`;
    const mesh = parsePLY(new TextEncoder().encode(ply));
    expect(mesh.indices.length).toBe(3);
  });
});

describe('GLB', () => {
  it('writes a valid, correctly-aligned container', () => {
    const bytes = toGLB([{ name: 'cup', mesh: cup() }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    // glTF requires 4-byte alignment throughout; a viewer will reject it otherwise.
    expect(bytes.byteLength % 4).toBe(0);
  });

  it('carries the heatmap colours', () => {
    const mesh = cup();
    const faceClass = new Uint8Array(mesh.indices.length / 3).fill(2); // all undercut
    const colors = heatmapColors(faceClass, mesh.positions.length / 3, mesh.indices);
    const bytes = toGLB([{ name: 'cup', mesh, colors }]);

    const json = JSON.parse(
      new TextDecoder().decode(bytes.slice(20, 20 + new DataView(bytes.buffer).getUint32(12, true))),
    );
    expect(json.meshes[0].primitives[0].attributes.COLOR_0).toBeDefined();
  });
});

describe('heatmapColors', () => {
  it('paints undercut faces the loudest colour', () => {
    const mesh = cylinder(10, 20);
    const faceClass = new Uint8Array(mesh.indices.length / 3);
    faceClass[0] = 2; // one undercut face

    const colors = heatmapColors(faceClass, mesh.positions.length / 3, mesh.indices);
    const v = mesh.indices[0]!;
    // Dark red: high red, low green. Chosen to survive red-green colour blindness,
    // because "un-moldable" is not a message anyone should be able to miss.
    expect(colors[v * 4]!).toBeGreaterThan(0.5);
    expect(colors[v * 4 + 1]!).toBeLessThan(0.3);
  });
});

describe('unit sniffing', () => {
  it('catches a model exported in metres', () => {
    // A 90 mm cup exported in metres arrives 0.09 units tall. Generating a mold
    // for that produces a thimble, and nobody notices until it is printed.
    const inMetres = scaleMesh(cup(), 0.001);
    expect(sniffUnits(inMetres, 'mm')).toMatch(/metres/i);
  });

  it('catches an absurdly large model', () => {
    expect(sniffUnits(scaleMesh(cup(), 100), 'mm')).toMatch(/m across/);
  });

  it('is quiet about a sensible pot', () => {
    expect(sniffUnits(cup(), 'mm')).toBeUndefined();
  });

  it('converts declared units into millimetres', async () => {
    const bytes = toSTL(scaleMesh(cup(), 0.1)); // same cup, drawn in centimetres
    const result = await loadModel('pot.stl', bytes, 'cm');
    const healed = await repair(result.mesh);
    sameVolume(healed.mesh, cup(), 0.1);
  });
});
