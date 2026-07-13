/**
 * Manifold WASM lifecycle.
 *
 * Manifold's WASM build is single-threaded, which is the reason this whole app
 * can live on GitHub Pages: threaded WASM needs SharedArrayBuffer, which needs
 * COOP/COEP response headers, which GitHub Pages cannot set. Staying serial
 * costs us some speed on huge meshes and buys us free static hosting forever.
 */
import ManifoldModule from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

let modulePromise: Promise<ManifoldToplevel> | null = null;

/**
 * Returns the initialised Manifold toplevel. Instantiating the WASM module is
 * expensive, so it is done once per process (Node) or per worker (browser).
 */
export async function manifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await ManifoldModule();
      wasm.setup();
      return wasm;
    })();
  }
  return modulePromise;
}

/**
 * Manifold objects hold WASM heap memory that the JS garbage collector cannot
 * see, so they must be deleted explicitly. Every engine function that creates
 * intermediates runs inside one of these scopes: register an object and it is
 * freed when the scope unwinds, including on the throw path.
 *
 * Whatever you *return* from the scope must not be registered -- it outlives it.
 */
export class Scope {
  #owned: Array<{ delete(): void }> = [];

  /** Track an object for disposal when this scope closes. */
  keep<T extends { delete(): void }>(obj: T): T {
    this.#owned.push(obj);
    return obj;
  }

  /** Stop tracking an object -- use when handing ownership to the caller. */
  release<T extends { delete(): void }>(obj: T): T {
    const i = this.#owned.indexOf(obj);
    if (i >= 0) this.#owned.splice(i, 1);
    return obj;
  }

  dispose(): void {
    // Reverse order: later objects may reference earlier ones.
    for (let i = this.#owned.length - 1; i >= 0; i--) {
      try {
        this.#owned[i]!.delete();
      } catch {
        // Already deleted, or the module is torn down. Nothing useful to do.
      }
    }
    this.#owned = [];
  }
}

/** Run `fn` with a scope that is disposed afterwards, even if `fn` throws. */
export async function withScope<T>(fn: (s: Scope) => Promise<T> | T): Promise<T> {
  const scope = new Scope();
  try {
    return await fn(scope);
  } finally {
    scope.dispose();
  }
}
