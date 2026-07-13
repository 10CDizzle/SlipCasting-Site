/**
 * Getting geometry out: STL and 3MF for the slicer, GLB for the viewport, and a
 * ZIP that bundles the lot with printed instructions.
 *
 * All of it is written by hand rather than pulled from three.js exporters, for
 * one reason: this runs in a Web Worker with no DOM, and the engine has to stay
 * usable from Node so the tests exercise the same code the browser does.
 */
import { zipSync, strToU8 } from 'fflate';
import type { Body, MeshData } from './types.js';
import { triangleCount, triangleNormal } from './mesh.js';

/** Binary STL. The universal currency of 3D printing, warts and all. */
export function toSTL(data: MeshData, _name = 'slipcast'): Uint8Array {
  const tris = triangleCount(data);
  const buffer = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const header = `slipcast mold - ${tris} triangles`;
  for (let i = 0; i < Math.min(header.length, 79); i++) {
    bytes[i] = header.charCodeAt(i);
  }
  view.setUint32(80, tris, true);

  let offset = 84;
  const { positions, indices } = data;

  for (let t = 0; t < tris; t++) {
    const n = triangleNormal(data, t);
    view.setFloat32(offset, n[0], true);
    view.setFloat32(offset + 4, n[1], true);
    view.setFloat32(offset + 8, n[2], true);
    offset += 12;

    for (let c = 0; c < 3; c++) {
      const v = indices[t * 3 + c]! * 3;
      view.setFloat32(offset, positions[v]!, true);
      view.setFloat32(offset + 4, positions[v + 1]!, true);
      view.setFloat32(offset + 8, positions[v + 2]!, true);
      offset += 12;
    }

    view.setUint16(offset, 0, true); // attribute byte count
    offset += 2;
  }

  return bytes;
}

/**
 * 3MF. Unlike STL it carries units, so a mold cannot silently arrive in a slicer
 * at 1/25th scale because someone's exporter assumed inches. Worth the extra XML.
 */
export function to3MF(bodies: Array<{ name: string; mesh: MeshData }>): Uint8Array {
  const objects: string[] = [];
  const items: string[] = [];

  bodies.forEach((body, i) => {
    const id = i + 1;
    const verts: string[] = [];
    const p = body.mesh.positions;
    for (let v = 0; v < p.length; v += 3) {
      verts.push(`<vertex x="${p[v]}" y="${p[v + 1]}" z="${p[v + 2]}"/>`);
    }

    const tris: string[] = [];
    const idx = body.mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      tris.push(`<triangle v1="${idx[t]}" v2="${idx[t + 1]}" v3="${idx[t + 2]}"/>`);
    }

    objects.push(
      `<object id="${id}" type="model" name="${escapeXml(body.name)}">` +
        `<mesh><vertices>${verts.join('')}</vertices>` +
        `<triangles>${tris.join('')}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" ` +
    `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources>${objects.join('')}</resources>` +
    `<build>${items.join('')}</build></model>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" ` +
    `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * GLB for the viewport. Carries per-vertex colours, which is how the undercut
 * heatmap gets from the engine to the screen without the UI having to re-derive
 * the analysis it would only get wrong differently.
 */
export function toGLB(
  bodies: Array<{ name: string; mesh: MeshData; colors?: Float32Array }>,
): Uint8Array {
  const buffers: Uint8Array[] = [];
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const meshes: unknown[] = [];
  const nodes: unknown[] = [];
  let byteOffset = 0;

  const pushView = (bytes: Uint8Array, target?: number): number => {
    // glTF requires 4-byte alignment for every buffer view.
    const padding = (4 - (byteOffset % 4)) % 4;
    if (padding > 0) {
      buffers.push(new Uint8Array(padding));
      byteOffset += padding;
    }
    buffers.push(bytes);
    const view: Record<string, unknown> = {
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
    };
    if (target !== undefined) view.target = target;
    bufferViews.push(view);
    byteOffset += bytes.byteLength;
    return bufferViews.length - 1;
  };

  bodies.forEach((body, i) => {
    const { positions, indices } = body.mesh;

    let min: [number, number, number] = [Infinity, Infinity, Infinity];
    let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < positions.length; v += 3) {
      for (let a = 0; a < 3; a++) {
        const c = positions[v + a]!;
        if (c < min[a]!) min[a] = c;
        if (c > max[a]!) max[a] = c;
      }
    }
    if (positions.length === 0) {
      min = [0, 0, 0];
      max = [0, 0, 0];
    }

    const posView = pushView(new Uint8Array(positions.buffer.slice(0)), 34962);
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: positions.length / 3,
      type: 'VEC3',
      min,
      max,
    });
    const posAccessor = accessors.length - 1;

    const idxView = pushView(new Uint8Array(indices.buffer.slice(0)), 34963);
    accessors.push({
      bufferView: idxView,
      componentType: 5125, // UNSIGNED_INT
      count: indices.length,
      type: 'SCALAR',
    });
    const idxAccessor = accessors.length - 1;

    const attributes: Record<string, number> = { POSITION: posAccessor };

    if (body.colors) {
      const colView = pushView(new Uint8Array(body.colors.buffer.slice(0)), 34962);
      accessors.push({
        bufferView: colView,
        componentType: 5126,
        count: body.colors.length / 4,
        type: 'VEC4',
      });
      attributes.COLOR_0 = accessors.length - 1;
    }

    meshes.push({ name: body.name, primitives: [{ attributes, indices: idxAccessor }] });
    nodes.push({ name: body.name, mesh: i });
  });

  const totalLength = byteOffset;
  const json = {
    asset: { version: '2.0', generator: 'slipcast' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalLength }],
  };

  const jsonBytes = strToU8(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPadding = (4 - (totalLength % 4)) % 4;

  const jsonChunkLength = jsonBytes.byteLength + jsonPadding;
  const binChunkLength = totalLength + binPadding;
  const total = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPadding; i++) out[20 + jsonBytes.byteLength + i] = 0x20; // spaces

  const binStart = 20 + jsonChunkLength;
  view.setUint32(binStart, binChunkLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN"

  let cursor = binStart + 8;
  for (const chunk of buffers) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  return out;
}

/**
 * Colour a mesh by its draft classification: green pulls cleanly, amber drags,
 * red cannot come out at all.
 *
 * Colours are chosen to survive red-green colour blindness -- red is dark and
 * deeply saturated, green is light -- because "your part is un-moldable" is not
 * a message anyone should be able to miss.
 */
export function heatmapColors(faceClass: Uint8Array, vertexCount: number, indices: Uint32Array): Float32Array {
  const colors = new Float32Array(vertexCount * 4);
  const palette: Array<[number, number, number]> = [
    [0.42, 0.78, 0.52], // ok: light green
    [0.95, 0.71, 0.25], // shallow: amber
    [0.72, 0.16, 0.22], // undercut: dark red
  ];

  for (let t = 0; t < faceClass.length; t++) {
    const c = palette[faceClass[t]!] ?? palette[0]!;
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]!;
      // A vertex shared between an undercut face and a clean one takes the worse
      // of the two: a red streak that is one triangle too wide is a nuisance,
      // one that is one triangle too narrow is a lie.
      const existing = colors[v * 4 + 3];
      const severity = faceClass[t]!;
      if (existing === 0 || severity >= (colors[v * 4 + 3] ?? 0)) {
        colors[v * 4] = c[0];
        colors[v * 4 + 1] = c[1];
        colors[v * 4 + 2] = c[2];
      }
      colors[v * 4 + 3] = 1;
    }
  }
  return colors;
}

export interface BundleOptions {
  bodies: Body[];
  instructions: string;
}

/** Everything a user needs, in one download. */
export function toZip(opts: BundleOptions): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'INSTRUCTIONS.md': strToU8(opts.instructions),
  };

  const printable = opts.bodies.filter((b) => b.printable);
  for (const body of printable) {
    files[`stl/${safeName(body.name)}.stl`] = toSTL(body.mesh, body.name);
  }

  files['slipcast-mold.3mf'] = to3MF(
    printable.map((b) => ({ name: b.name, mesh: b.mesh })),
  );

  return zipSync(files, { level: 6 });
}

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
