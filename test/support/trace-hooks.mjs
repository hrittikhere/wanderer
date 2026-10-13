// Module customization hook that reports every resolved module URL back to
// the main thread so a test can prove which modules were (not) loaded.
let port;
export function initialize(data) { port = data.port; }
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  port?.postMessage(result.url);
  return result;
}
