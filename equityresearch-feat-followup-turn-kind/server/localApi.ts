const DEFAULT_PORT = 5000;
const DEFAULT_LOCAL_API_HOST = "127.0.0.1";

export function parseConfiguredPort(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const rawPort = env.PORT?.trim();
  if (!rawPort) {
    return undefined;
  }

  if (!/^\d+$/.test(rawPort)) {
    return undefined;
  }

  const parsedPort = Number(rawPort);
  if (parsedPort < 1 || parsedPort > 65535) {
    return undefined;
  }

  return parsedPort;
}

export function getRuntimePort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseConfiguredPort(env) ?? DEFAULT_PORT;
}

export function getLocalApiBase(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `http://${DEFAULT_LOCAL_API_HOST}:${getRuntimePort(env)}`;
}

export { DEFAULT_PORT };
