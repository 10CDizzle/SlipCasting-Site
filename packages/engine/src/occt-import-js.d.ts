/**
 * occt-import-js ships no types. This declares only the sliver of its surface we
 * touch -- reading a STEP or IGES file into triangle meshes -- rather than
 * pretending to describe all of OpenCascade.
 */
declare module 'occt-import-js' {
  interface OcctMesh {
    name?: string;
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }

  interface OcctResult {
    success: boolean;
    root?: unknown;
    meshes: OcctMesh[];
  }

  interface Occt {
    ReadStepFile(content: Uint8Array, params: unknown): OcctResult;
    ReadBrepFile(content: Uint8Array, params: unknown): OcctResult;
    ReadIgesFile(content: Uint8Array, params: unknown): OcctResult;
  }

  const factory: () => Promise<Occt>;
  export default factory;
}
