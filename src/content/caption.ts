/** Instagram caption limits: 2,200 characters, 30 hashtags, 20 @mentions. */
export const CAPTION_LIMITS = { chars: 2200, hashtags: 30, mentions: 20 } as const;

// Hashtags may use letters from any script (Arabic included), digits and underscores.
const HASHTAG = /(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;
const MENTION = /(?:^|[^\p{L}\p{N}_.])@([A-Za-z0-9._]{1,30})/gu;

export interface CaptionStats {
  characters: number;
  hashtags: string[];
  mentions: string[];
}

export class CaptionError extends Error {
  override name = "CaptionError";
}

export function captionStats(caption: string): CaptionStats {
  return {
    // Count user-perceived characters (an emoji counts once), like Instagram's editor.
    characters: [...new Intl.Segmenter().segment(caption)].length,
    hashtags: [...caption.matchAll(HASHTAG)].map((m) => `#${m[1]}`),
    mentions: [...caption.matchAll(MENTION)].map((m) => `@${m[1]}`),
  };
}

/** Return the caption's stats, or throw listing every limit it breaks. */
export function validateCaption(caption: string): CaptionStats {
  const stats = captionStats(caption);
  const problems: string[] = [];
  if (!caption.trim()) problems.push("the caption is empty");
  if (stats.characters > CAPTION_LIMITS.chars) {
    problems.push(
      `it has ${stats.characters} characters (max ${CAPTION_LIMITS.chars}); shorten it by ${stats.characters - CAPTION_LIMITS.chars}`,
    );
  }
  if (stats.hashtags.length > CAPTION_LIMITS.hashtags) {
    problems.push(
      `it has ${stats.hashtags.length} hashtags (max ${CAPTION_LIMITS.hashtags}); Instagram rejects the post`,
    );
  }
  if (stats.mentions.length > CAPTION_LIMITS.mentions) {
    problems.push(`it has ${stats.mentions.length} @mentions (max ${CAPTION_LIMITS.mentions})`);
  }
  if (problems.length) throw new CaptionError(`Caption problems:\n- ${problems.join("\n- ")}`);
  return stats;
}
