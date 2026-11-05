/**
 * 9:16 Reel frames: the 4:5 card, slightly scaled down, on a 1080×1920 canvas in the card's
 * own background colour. Instagram draws its UI over roughly the top 220 px and bottom 420 px,
 * so the card sits in between and nothing important gets covered.
 */
import sharp from "sharp";

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
const SCALE = 0.95;
export const CARD_BOX = {
  width: Math.round(1080 * SCALE), // 1026
  height: Math.round(1350 * SCALE), // 1283
  left: Math.round((1080 - 1080 * SCALE) / 2), // 27
  top: 200,
};
/** Bottom edge of the card; anything below it up to 1920-420 is still safe. */
export const CARD_BOTTOM = CARD_BOX.top + CARD_BOX.height;

/** Place a rendered 1080×1350 card into a 1080×1920 PNG frame. */
export async function reelFrame(cardPng: Buffer): Promise<Buffer> {
  // The card's corner pixel is its background colour (cards have a solid background).
  const { data } = await sharp(cardPng)
    .extract({ left: 2, top: 2, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0]!, g: data[1]!, b: data[2]! };
  const card = await sharp(cardPng).resize(CARD_BOX.width, CARD_BOX.height).png().toBuffer();
  return sharp({
    create: { width: REEL_WIDTH, height: REEL_HEIGHT, channels: 3, background },
  })
    .composite([{ input: card, left: CARD_BOX.left, top: CARD_BOX.top }])
    .png()
    .toBuffer();
}
