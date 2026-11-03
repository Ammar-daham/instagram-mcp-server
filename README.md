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

| Tool               | What it does                                                                       |
| ------------------ | ---------------------------------------------------------------------------------- |
| `check_token`      | Checks the token works, which account it belongs to, and days until it expires     |
| `get_account_info` | Username, name, account type, followers, following, post count                     |
| `render_card`      | Renders a branded 1080×1350 nutrition card, saves it to `out/` and shows a preview |

### Cards

`render_card` templates: `tip`, `macros`, `recipe`, `myth_fact`, `cover` (carousel cover) and
`follow` ("follow for more" end slide). Ask Claude for a card, e.g. "make a macros card for a
Greek yogurt bowl: 420 kcal, 32 g protein, 48 g carbs, 11 g fat", and it previews it in chat.

Cards are 1080×1350 (4:5 portrait, the tallest format the feed shows) and use the Inter font
(SIL Open Font License). Text is length-limited so it always fits; emoji aren't drawn on cards
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
