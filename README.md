# instagram-nutrition-mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude design and publish
nutrition content to an Instagram **Business** account through Meta's official
Instagram API.

> Status: in development (MVP in progress).

## Requirements

- Node.js 22+
- An Instagram Business (or Creator) account
- A Meta developer app and access token: follow [docs/META_SETUP.md](docs/META_SETUP.md).
  Both Instagram-login (`IGAA…`) and Facebook-login (`EAA…`) tokens work.

## Setup

```bash
npm install
cp .env.example .env   # then fill in IG_ACCESS_TOKEN and IG_USER_ID
npm run build
```

## Use it with Claude Code

Register the server (use the absolute path to your clone):

```bash
claude mcp add instagram \
  -e IG_ACCESS_TOKEN=... -e IG_USER_ID=... \
  -- node /abs/path/to/instagram-nutrition-mcp/dist/index.js
```

You can leave out the `-e` flags: the server also reads `.env` from the repo root.

Then ask Claude things like "how many followers do I have?" or "check my Instagram token".

### Tools

| Tool                           | What it does                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `check_token`                  | Checks the token works, which account it belongs to, and days until it expires                  |
| `get_account_info`             | Username, name, account type, followers, following, post count                                  |
| `render_card`                  | Renders a branded 1080×1350 nutrition card, saves it to `out/` and shows a preview              |
| `upload_image`                 | Uploads a rendered card to Cloudinary and returns the public URL Instagram needs                |
| `delete_image`                 | Deletes an uploaded image from Cloudinary (e.g. once the post is live) so its URL stops working |
| `publish_post`                 | Publishes one image with a caption (dry run unless `confirm: true`)                             |
| `publish_carousel`             | Publishes 2–10 images as a carousel (dry run unless `confirm: true`)                            |
| `create_and_publish_card_post` | Renders 1–10 cards, previews them all, and publishes on `confirm: true`                         |

### Cards

`render_card` makes cards in **English or Arabic**. Claude asks which language first if you
haven't said. Arabic cards are laid out right-to-left with Arabic labels (e.g. "نصيحة غذائية",
"القيم الغذائية") in IBM Plex Sans Arabic. Short-vowel marks (tashkeel) are left out for clean
rendering.

Templates: `tip`, `macros`, `recipe`, `myth_fact`, `cover` (carousel cover) and `follow`
("follow for more" end slide). Ask Claude for a card, e.g. "make an Arabic tip card about
drinking more water" or "make a macros card for a Greek yogurt bowl: 420 kcal, 32 g protein,
48 g carbs, 11 g fat", and it previews it in chat.

Cards are 1080×1350 (4:5 portrait, the tallest format the feed shows) and use the Inter and IBM
Plex Sans Arabic fonts (both SIL Open Font License). Text is length-limited so it always fits; emoji aren't drawn on cards
(put them in the caption). Set your brand with these optional variables:

| Variable                                          | Default            | Used for                                              |
| ------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| `BRAND_HANDLE`                                    | none               | Footer and the "follow" slide, e.g. `@body.blooms.ai` |
| `BRAND_PRIMARY`                                   | `#2E7D5B`          | Pills, numbers, cover background, protein bar         |
| `BRAND_ACCENT`                                    | `#E9964A`          | Highlights, carbs bar                                 |
| `BRAND_HIGHLIGHT`                                 | `#D0645A`          | "Myth" box, fat bar                                   |
| `BRAND_BACKGROUND` / `BRAND_TEXT` / `BRAND_MUTED` | cream / ink / grey | Card colours                                          |
| `BRAND_LOGO`                                      | none               | `.png`, `.jpg` or `.svg` shown in the footer          |
| `CARD_OUTPUT_DIR`                                 | `out`              | Where rendered JPEGs are saved                        |

### Publishing

Nothing is posted without your approval. Every publishing tool runs as a **dry run** unless it's
called with `confirm: true`: it validates the caption (max 2,200 characters, 30 hashtags,
20 mentions) and images (JPEG, max 8 MB, aspect ratio between 4:5 and 1.91:1), checks
Instagram's limit of 100 posts per 24 hours, and returns a summary (and, for card posts, a
preview of every slide) without uploading anything. Claude shows you that and only publishes
after you approve.

On `confirm: true`, the cards are uploaded to Cloudinary under random names, Instagram
fetches them, the post goes live, and the uploads are **deleted right away**, so nothing stays
public except the Instagram post. If publishing fails, the uploads are deleted too. Pass
`keep_uploads: true` to keep them.

Try: "Make a 5-slide Arabic carousel about high-protein breakfasts and publish it" → Claude
renders the slides, shows the preview and caption, and waits for your OK.

Publishing a carousel can take 20–60 seconds (Instagram processes each slide). The tools send
progress updates while they work. If the client cancels or times out before the final publish
step, nothing is posted and the uploads are deleted. In the MCP Inspector, keep **Reset Timeout
on Progress** enabled (Configuration), or raise **Request Timeout** to e.g. `120000`.

Publishing needs the token permissions `instagram_content_publish` (Facebook login) or
`instagram_business_content_publish` (Instagram login), see [docs/META_SETUP.md](docs/META_SETUP.md).

### Image hosting (Cloudinary)

Instagram only publishes images from a public HTTPS URL, so cards are uploaded to
[Cloudinary](https://cloudinary.com)'s free tier first.

1. Sign up for a free account at <https://cloudinary.com/users/register_free> (no card needed).
2. In the Cloudinary console, open **Settings → API Keys** (or the dashboard's
   **Product Environment Credentials**) and copy the **Cloud name**, **API Key** and
   **API Secret**.
3. Add them to `.env`:

   ```
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=123456789012345
   CLOUDINARY_API_SECRET=...
   ```

   Or paste the single `CLOUDINARY_URL=cloudinary://...` value the console shows.

Then ask Claude to "upload that card". `upload_image` returns a URL like
`https://res.cloudinary.com/<cloud>/image/upload/v…/instagram/<name>.jpg` and checks that it
opens publicly. Uploaded images are public, so `upload_image` only accepts JPEGs (max 8 MB,
Instagram's limit) from `out/`, plus any folders you list in `UPLOAD_ALLOWED_DIRS`.
Re-uploading a file with the same name replaces it.

The publishing tools upload and delete images by themselves. `upload_image` is only needed to
get a URL by hand; such uploads stay public until deleted (`delete_image` with the URL, or
automatically when that URL is published with `publish_post`/`publish_carousel`). Deleting also purges Cloudinary's CDN cache, so
the link stops working, and only images in the server's Cloudinary folder (`instagram/` by
default) can be deleted. Deleting never affects the published Instagram post.

### Keeping the token valid

Long-lived tokens last 60 days. Run `npm run token:refresh` every ~50 days (see
[docs/META_SETUP.md](docs/META_SETUP.md#7-keep-the-token-alive)).

### Configuration

| Variable          | Required               | Default              |
| ----------------- | ---------------------- | -------------------- |
| `IG_ACCESS_TOKEN` | yes                    |                      |
| `IG_USER_ID`      | for publishing (later) |                      |
| `IG_API_VERSION`  | no                     | `v24.0`              |
| `IG_TOKEN_STORE`  | no                     | `.tokens/token.json` |

## Development

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run inspect   # MCP Inspector against dist/index.js
```

## License

MIT
