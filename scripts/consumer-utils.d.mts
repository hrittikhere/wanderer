import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';

export interface NpmInvocation { command: string; args: string[]; shell: boolean }
export function npmInvocation(args: string[], options?: { env?: Record<string, string | undefined>; platform?: string; node?: string }): NpmInvocation;
export function spawnNpm(args: string[], options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
export function skipInstallsAndBuilds(from: string, names?: string[]): (source: string) => boolean;
