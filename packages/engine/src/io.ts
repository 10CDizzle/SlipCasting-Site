/**
 * Reading models in.
 *
 * Parsers are hand-written rather than borrowed from three.js loaders, because
 * those assume a DOM and a browser. This runs in a Web Worker and in Node, and
 * the tests exercise the same code the browser does.
 *
 * STEP and IGES are the exception: they need OpenCascade, which is a 10 MB WASM
 * module. It is imported lazily, only when someone actually drops a STEP file, so
 * the common path never pays for it.
 */
import type { MeshData, Unit } from './types.js';
import { UNIT_TO_MM } from './types.js';
import { boundingBox, boxSize } from './mesh.js';

export type Format = 'stl' | 'obj' | 'ply' | '3mf' | 'step';

export function formatOf(filename: string): Format {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'stl':
      return 'stl';
    case 'obj':
      return 'obj';
    case 'ply':
      return 'ply';
    case '3mf':
      return '3mf';
    case 'step':
    case 'stp':
    case 'iges':
    case 'igs':
      return 'step';
    default:
      throw new Error(
        `Unsupported file type ".${ext}". Import STL, OBJ, PLY, 3MF, STEP, or IGES.`,
      );
  }
}

export interface LoadResult {
  mesh: MeshData;
  format: Format;
  /** Set when the model's size suggests it is not in millimetres. */
  unitWarning?: string;
}

export async function loadModel(
  filename: string,
  bytes: Uint8Array,
  unit: Unit = 'mm',
): Promise<LoadResult> {
  const format = formatOf(filename);

  let mesh: MeshData;
  switch (format) {
    case 'stl':
      mesh = parseSTL(bytes);
      break;
    case 'obj':
      mesh = parseOBJ(new TextDecoder().decode(bytes));
      break;
    case 'ply':
      mesh = parsePLY(bytes);
      break;
    case '3mf':
      mesh = await parse3MF(bytes);
      break;
    case 'step':
      mesh = await parseSTEP(bytes);
      break;
  }

  if (mesh.indices.length === 0) {
    throw new Error(`No geometry found in ${filename}.`);
  }

  const scale = UNIT_TO_MM[unit];
  if (scale !== 1) {
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i++) positions[i] = mesh.positions[i]! * scale;
    mesh = { positions, indices: mesh.indices };
  }

  return { mesh, format, unitWarning: sniffUnits(mesh, unit) };
}

/**
 * Guess when a model is not in the units it claims.
 *
 * A pot is somewhere between a thimble and a garden urn. If a model arrives 0.09
 * units tall, it is almost certainly metres; if it is 3000 units tall, someone
 * exported in microns. Saying so beats generating a mold for a teacup the size of
 * a bathtub and letting a print farm discover it.
 */
export function sniffUnits(mesh: MeshData, declared: Unit): string | undefined {
  const size = boxSize(boundingBox(mesh));
  const largest = Math.max(size[0], size[1], size[2]);

  if (largest < 1) {
    return `This model is only ${largest.toFixed(3)} mm across, which is smaller than any castable pot. It was probably exported in metres -- try setting the import units to metres.`;
  }
  if (largest > 2000) {
    return `This model is ${(largest / 1000).toFixed(1)} m across. If that is not deliberate, check the import units.`;
  }
  if (declared === 'mm' && largest < 10) {
    return `This model is only ${largest.toFixed(1)} mm across. If it should be bigger, check the import units.`;
  }
  return undefined;
}

/** Binary or ASCII STL, sniffed by content rather than trusting the header. */
export function parseSTL(bytes: Uint8Array): MeshData {
  // An ASCII STL starts with "solid", but so do some binary ones from careless
  // exporters. The reliable test is arithmetic: a binary STL's length is exactly
  // 84 + 50 * triangleCount.
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tris = view.getUint32(80, true);
    if (84 + tris * 50 === bytes.byteLength) {
      return parseBinarySTL(bytes);
    }
  }
  return parseAsciiSTL(new TextDecoder().decode(bytes));
}

function parseBinarySTL(bytes: Uint8Array): MeshData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = view.getUint32(80, true);

  const positions = new Float32Array(tris * 9);
  const indices = new Uint32Array(tris * 3);

  let offset = 84;
  for (let t = 0; t < tris; t++) {
    offset += 12; // the stored normal is ignored; we recompute from winding
    for (let c = 0; c < 3; c++) {
      const p = (t * 3 + c) * 3;
      positions[p] = view.getFloat32(offset, true);
      positions[p + 1] = view.getFloat32(offset + 4, true);
      positions[p + 2] = view.getFloat32(offset + 8, true);
      offset += 12;
      indices[t * 3 + c] = t * 3 + c;
    }
    offset += 2;
  }

  // Every vertex is unshared -- that is simply what STL is. repair() welds it.
  return { positions, indices };
}

function parseAsciiSTL(text: string): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    positions.push(parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!));
    indices.push(indices.length);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function parseOBJ(text: string): MeshData {
  const verts: number[] = [];
  const indices: number[] = [];

  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') {
      verts.push(parseFloat(parts[1]!), parseFloat(parts[2]!), parseFloat(parts[3]!));
    } else if (parts[0] === 'f') {
      // Faces may be polygons and may carry v/vt/vn; take the position index and
      // fan-triangulate. OBJ indices are 1-based, and negative means "from the end".
      const face: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i]!.split('/')[0]!;
        let idx = parseInt(token, 10);
        if (Number.isNaN(idx)) continue;
        if (idx < 0) idx = verts.length / 3 + idx;
        else idx -= 1;
        face.push(idx);
      }
      for (let i = 1; i + 1 < face.length; i++) {
        indices.push(face[0]!, face[i]!, face[i + 1]!);
      }
    }
  }

  return { positions: new Float32Array(verts), indices: new Uint32Array(indices) };
}

export function parsePLY(bytes: Uint8Array): MeshData {
  const text = new TextDecoder().decode(bytes);
  const headerEnd = text.indexOf('end_header');
  if (headerEnd < 0) throw new Error('Not a valid PLY file: no header.');

  const header = text.slice(0, headerEnd);
  if (!/format\s+ascii/.test(header)) {
    throw new Error('Only ASCII PLY is supported. Re-export as ASCII PLY, or use STL.');
  }

  const vertexCount = parseInt(/element\s+vertex\s+(\d+)/.exec(header)?.[1] ?? '0', 10);
  const faceCount = parseInt(/element\s+face\s+(\d+)/.exec(header)?.[1] ?? '0', 10);

  const body = text
    .slice(headerEnd + 'end_header'.length)
    .trim()
    .split('\n');

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < vertexCount; i++) {
    const parts = body[i]!.trim().split(/\s+/);
    positions.push(parseFloat(parts[0]!), parseFloat(parts[1]!), parseFloat(parts[2]!));
  }
  for (let i = 0; i < faceCount; i++) {
    const parts = body[vertexCount + i]!.trim().split(/\s+/).map(Number);
    const n = parts[0]!;
    for (let k = 1; k + 1 < n; k++) {
      indices.push(parts[1]!, parts[k + 1]!, parts[k + 2]!);
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 3MF is a ZIP of XML. Parsed with a regex scan rather than a DOM, so it runs in a worker. */
export async function parse3MF(bytes: Uint8Array): Promise<MeshData> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(bytes);

  const modelPath = Object.keys(files).find((f) => f.endsWith('.model'));
  if (!modelPath) throw new Error('Not a valid 3MF: no model part inside the archive.');

  const xml = strFromU8(files[modelPath]!);

  const positions: number[] = [];
  const indices: number[] = [];

  const vertexRe = /<vertex[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = vertexRe.exec(xml)) !== null) {
    positions.push(parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!));
  }

  const triRe = /<triangle[^>]*v1="(\d+)"[^>]*v2="(\d+)"[^>]*v3="(\d+)"[^>]*\/>/g;
  while ((m = triRe.exec(xml)) !== null) {
    indices.push(parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10));
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * STEP / IGES via OpenCascade, compiled to WASM.
 *
 * Loaded on demand: the module is around 10 MB, and most people bring an STL.
 * Charging every visitor 10 MB for a format they will not use is not a trade
 * worth making on a static site.
 */
export async function parseSTEP(bytes: Uint8Array): Promise<MeshData> {
  const { default: factory } = await import('occt-import-js');
  const occt = await factory();
  const result = occt.ReadStepFile(bytes, null);

  if (!result.success || result.meshes.length === 0) {
    throw new Error('OpenCascade could not read this STEP file.');
  }

  // A STEP assembly is many solids; concatenate them and let repair() sort out
  // the seams.
  const positions: number[] = [];
  const indices: number[] = [];

  for (const mesh of result.meshes) {
    const offset = positions.length / 3;
    positions.push(...mesh.attributes.position.array);
    for (const i of mesh.index.array) indices.push(i + offset);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
