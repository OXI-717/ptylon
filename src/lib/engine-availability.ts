export function enginesAvailable(env: NodeJS.ProcessEnv = process.env): string[] {
  const engines = env.ENGINES?.trim();
  if (!engines) return [];
  return engines.split(/\s+/).filter(Boolean);
}
