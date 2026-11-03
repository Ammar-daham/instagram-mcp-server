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

export const ACCOUNT_FIELDS = [
  "user_id",
  "username",
  "name",
  "account_type",
  "followers_count",
  "follows_count",
  "media_count",
].join(",");

export function getAccountInfo(client: InstagramClient): Promise<AccountInfo> {
  return client.get<AccountInfo>("me", { fields: ACCOUNT_FIELDS });
}
