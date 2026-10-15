// Shared by the packed-consumer scripts (package-smoke, react-compat).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * How to run npm on this platform. Under `npm run`, npm_execpath names npm's
 * own CLI, which runs with this Node anywhere. Otherwise `npm` comes from PATH;
 * on Windows that is npm.cmd, which Node only spawns through a shell, so
 * arguments with spaces (temp paths under a user profile) are quoted.
 */
export function npmInvocation(args, { env = process.env, platform = process.platform, node = process.execPath } = {}) {
  const cli = env.npm_execpath;
  if (cli && path.basename(cli) === 'npm-cli.js') return { command: node, args: [cli, ...args], shell: false };
  if (platform !== 'win32') return { command: 'npm', args, shell: false };
  return { command: 'npm.cmd', args: args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)), shell: true };
}

/** spawnSync for npm with the invocation above. */
export function spawnNpm(args, options = {}) {
  const { command, args: argv, shell } = npmInvocation(args);
  return spawnSync(command, argv, { ...options, shell });
}

/**
 * A `cp` filter that skips installs and build output inside `from`. It tests
 * the path relative to `from`, so a checkout under a directory that happens
 * to be called `dist` or `node_modules` is still copied.
 */
export function skipInstallsAndBuilds(from, names = ['node_modules', 'dist', '.next']) {
  return (source) => {
    const relative = path.relative(from, source);
    return !relative.split(/[/\\]/).some((segment) => names.includes(segment));
  };
}
