// Watches the globe view's lazy `import('./renderer.js')` through synchronous
// in-thread module hooks (Node 22.15+, 23.5+). @types/node 20 predates
// module.registerHooks, so its shape is declared here.
import * as nodeModule from 'node:module';

interface ResolveContext { parentURL?: string }
interface ResolveResult { url: string; shortCircuit?: boolean }
interface ResolveHooks {
  resolve(specifier: string, context: ResolveContext, nextResolve: (specifier: string, context: ResolveContext) => ResolveResult): ResolveResult;
}
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: ResolveHooks) => { deregister(): void } };

export interface RendererImportSpy {
  /** Dynamic imports of the renderer module issued since the spy was installed. */
  readonly imports: number;
  /** While true, the import fails the way a chunk that cannot be downloaded does. */
  fail: boolean;
  restore(): void;
}

export function spyOnRendererImport(): RendererImportSpy {
  const spy = {
    imports: 0,
    fail: false,
    restore() { hooks.deregister(); },
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== './renderer.js' || !/\/globe\/GlobeView\.[jt]sx?$/.test(context.parentURL ?? '')) return nextResolve(specifier, context);
      spy.imports += 1;
      if (spy.fail) return { url: `data:text/javascript,throw new Error('chunk ${spy.imports} failed')`, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  return spy;
}
