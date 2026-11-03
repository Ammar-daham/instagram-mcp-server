import { loadConfig, type Config } from "./config.js";
import { InstagramClient, type ClientOptions } from "./instagram/client.js";
import { resolveAccessToken, type ResolvedToken } from "./instagram/token.js";

export interface AppContext {
  config: Config;
  token: ResolvedToken;
  client: InstagramClient;
}

export type ContextFactory = () => Promise<AppContext>;

/**
 * Built per tool call rather than at startup, so a missing env var shows up as a readable tool
 * error in Claude instead of a server that silently fails to start, and so a token refreshed
 * while the server is running is picked up without a restart.
 */
export function createContextFactory(
  env: NodeJS.ProcessEnv = process.env,
  clientOptions: Partial<ClientOptions> = {},
): ContextFactory {
  return async () => {
    const config = loadConfig(env);
    const token = await resolveAccessToken(config);
    const client = new InstagramClient({
      baseUrl: config.baseUrl,
      apiVersion: config.apiVersion,
      ...clientOptions,
      accessToken: token.accessToken,
    });
    return { config, token, client };
  };
}
