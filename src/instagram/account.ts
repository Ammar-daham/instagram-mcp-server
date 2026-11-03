import type { Config } from "../config.js";
import type { InstagramClient } from "./client.js";

export interface AccountInfo {
  user_id: string;
  username: string;
  name?: string;
  account_type?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

const COMMON_FIELDS = ["username", "name", "followers_count", "follows_count", "media_count"];

/**
 * Instagram login reads `/me`; Facebook login reads the Instagram account by ID (`/me` there is
 * the Facebook user). The Facebook flavour has no `user_id`/`account_type` fields, only `id`.
 */
export async function getAccountInfo(
  client: InstagramClient,
  config: Pick<Config, "loginType" | "userId">,
): Promise<AccountInfo> {
  if (config.loginType === "facebook") {
    const { id, ...rest } = await client.get<Omit<AccountInfo, "user_id"> & { id: string }>(
      config.userId!,
      { fields: ["id", ...COMMON_FIELDS].join(",") },
    );
    return { user_id: id, ...rest };
  }
  return client.get<AccountInfo>("me", {
    fields: ["user_id", "account_type", ...COMMON_FIELDS].join(","),
  });
}
