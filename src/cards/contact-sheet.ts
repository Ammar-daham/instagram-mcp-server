import sharp from "sharp";

/** Lay out card thumbnails in a grid (max 5 per row), to preview a carousel in one image. */
export async function contactSheet(jpegs: Buffer[], thumbWidth = 270): Promise<Buffer> {
  const thumbHeight = Math.round((thumbWidth * 1350) / 1080);
  const gap = 12;
  const cols = Math.min(jpegs.length, 5);
  const rows = Math.ceil(jpegs.length / cols);
  const thumbs = await Promise.all(
    jpegs.map((j) => sharp(j).resize(thumbWidth, thumbHeight).toBuffer()),
  );
  return sharp({
    create: {
      width: cols * thumbWidth + (cols + 1) * gap,
      height: rows * thumbHeight + (rows + 1) * gap,
      channels: 3,
      background: "#FFFFFF",
    },
  })
    .composite(
      thumbs.map((input, i) => ({
        input,
        left: gap + (i % cols) * (thumbWidth + gap),
        top: gap + Math.floor(i / cols) * (thumbHeight + gap),
      })),
    )
    .jpeg({ quality: 80 })
    .toBuffer();
}
