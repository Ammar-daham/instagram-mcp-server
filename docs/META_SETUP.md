# Connecting your Instagram account

This guide walks you through getting the two values the server needs:

- `IG_ACCESS_TOKEN`: a long-lived token (valid for 60 days) that lets the server act for your account
- `IG_USER_ID`: your account's numeric Instagram user ID

It takes about 15 minutes. You don't need to publish a Meta app or go through App Review: the app
stays in **Development mode** and only ever manages your own account.

> Meta renames buttons in its dashboard fairly often. If a label below doesn't match what you
> see, look for the closest equivalent; the overall flow stays the same.

## Before you start

- Your Instagram account must be a **Business** (or Creator) account. In the Instagram app go to
  **Settings → Account type and tools → Switch to professional account** if it isn't.
- You need a Facebook login to create a Meta developer account.

## 1. Create a Meta developer account

1. Go to <https://developers.facebook.com> and click **Get started** / **Log in**.
2. Log in with Facebook, accept the terms, and verify your phone number or email when asked.

## 2. Create an app

1. Open **My Apps → Create App**.
2. When asked for a use case, choose **Other** (or "Manage messaging & content on Instagram" if
   it's offered), then **Next**.
3. Choose app type **Business**, then **Next**.
4. Give it a name, e.g. `My Nutrition MCP`, and click **Create app**.

## 3. Add Instagram to the app

1. On the app dashboard, find **Instagram** in the product list and click **Set up**.
2. Choose **API setup with Instagram login** (not "with Facebook login").

## 4. Add yourself as an Instagram tester

Apps in Development mode can only access accounts that have a role on the app.

1. In the left menu open **App roles → Roles**.
2. Click **Add people** → **Instagram Tester** and enter your Instagram username.
3. Accept the invite **in Instagram**: on the website, go to
   **Settings → Apps and websites → Tester invites** (in some versions: **Website permissions**)
   and click **Accept**.

## 5. Generate the token

1. Go back to **Instagram → API setup with Instagram login**.
2. Under **Generate access tokens**, click **Add account** and log in with your Instagram account.
3. Grant these permissions when asked:
   - `instagram_business_basic`: read your profile and posts
   - `instagram_business_content_publish`: publish posts
   - `instagram_business_manage_insights`: read post and account insights
   - `instagram_business_manage_comments`: optional for now, used by a later feature
4. Click **Generate token** next to your account and copy it. This is already a **long-lived**
   token (60 days).
5. The same row shows your account's **Instagram user ID** (a long number). Copy that too.

## 6. Put the values in `.env`

```bash
cp .env.example .env
```

Then edit `.env`:

```
IG_ACCESS_TOKEN=IGAA...your token...
IG_USER_ID=17841400000000000
```

`.env` is gitignored: never commit it or paste the token anywhere public.

Check that it works:

```bash
npm run build
npm run inspect   # opens the MCP Inspector; call check_token and get_account_info
```

If `get_account_info` shows your username and follower count, you're done.

## 7. Keep the token alive

Long-lived tokens expire after 60 days. Refreshing gives you a new 60-day token:

```bash
npm run token:refresh
```

- The token must be **at least 24 hours old** to be refreshed, and **not yet expired**.
- The new token is saved to `.tokens/token.json` (gitignored) together with its expiry date. The
  server uses it automatically, so you don't need to edit `.env` or re-register the server.
- Ask Claude to "check my Instagram token" at any time: the `check_token` tool reports how many
  days are left once you've refreshed at least once.
- A good habit is refreshing every ~50 days.

If the token has already expired, generate a new one (step 5) and put it in `.env`. The server
notices the new token and stops using the old refreshed one.

## Troubleshooting

| Message                                             | What to do                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Instagram rejected the access token`               | The token expired or was revoked. Generate a new one (step 5).                                              |
| `The access token is missing a permission`          | Regenerate the token and make sure all permissions in step 5 are ticked.                                    |
| `Instagram rate limit reached`                      | Wait an hour and try again.                                                                                 |
| `IG_USER_ID ... doesn't match this token's account` | Copy the `user_id` shown by `get_account_info` into `IG_USER_ID`.                                           |
| Tester invite doesn't appear                        | Make sure you entered the exact username, and check the invite from the Instagram **website**, not the app. |
