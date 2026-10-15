import type { TalksPlugin } from './component-types.js';
import { compareIds } from './ids.js';

/** Contributions are ordered numerically, then by code-point ID (never locale). */
export interface Registration {
  id: string;
  order?: number;
}

/** Pure, instance-local registration. Invalid/colliding IDs fail loudly. */
export function registerPlugins<T extends Registration>(
  plugins: readonly T[],
  reservedIds: readonly string[] = [],
): T[] {
  const seen = new Set(reservedIds);
  plugins.forEach((plugin, index) => {
    // JavaScript callers can pass anything, for example `[base, flag && extra]`.
    if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string') {
      throw new Error(`Plugins and contributions must be objects with a string id; entry ${index} is ${plugin === null ? 'null' : typeof plugin === 'object' ? 'an object without a string id' : String(plugin)}.`);
    }
    if (!plugin.id || plugin.id.trim() !== plugin.id) {
      throw new Error('Plugin/contribution IDs must be nonempty and have no surrounding whitespace.');
    }
    if (seen.has(plugin.id)) {
      throw new Error(`Duplicate or reserved plugin/contribution ID: ${plugin.id}`);
    }
    if (plugin.order !== undefined && !Number.isFinite(plugin.order)) {
      throw new Error(`Invalid order for plugin/contribution: ${plugin.id}`);
    }
    seen.add(plugin.id);
  });
  return [...plugins].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || compareIds(a.id, b.id));
}

/** Flatten ordered plugins into one contribution namespace; no overrides are implicit. */
export function collectContributions<P extends Registration, C extends Registration>(
  plugins: readonly P[],
  select: (plugin: P) => readonly C[] | undefined,
  reservedIds: readonly string[] = [],
): C[] {
  return registerPlugins(registerPlugins(plugins).flatMap((plugin) => select(plugin) ?? []), reservedIds);
}

/** Identity helper: contextual typing for callbacks inside a plugin literal, with the literal's own type preserved. */
export function definePlugin<T extends TalksPlugin>(plugin: T): T {
  return plugin;
}
