/**
 * A stylised, transparent ("glass") human body for 1080×1920 Reel frames, drawn as SVG.
 * Organs that benefit from the nutrient glow in colour and get a cartoon face; the others stay
 * faint. Shapes are deliberately simple and friendly, not medical illustrations.
 */
export const ORGANS = [
  "brain",
  "eyes",
  "heart",
  "lungs",
  "liver",
  "stomach",
  "gut",
  "kidneys",
  "bones",
  "muscles",
  "skin",
  "immune",
  "blood",
] as const;
export type Organ = (typeof ORGANS)[number];

/** Where speech bubbles point to, in canvas coordinates. */
export const ANCHORS: Record<Organ, { x: number; y: number }> = {
  brain: { x: 540, y: 470 },
  eyes: { x: 540, y: 548 },
  heart: { x: 585, y: 865 },
  lungs: { x: 470, y: 820 },
  liver: { x: 475, y: 985 },
  stomach: { x: 605, y: 990 },
  gut: { x: 540, y: 1115 },
  kidneys: { x: 615, y: 1045 },
  bones: { x: 438, y: 1424 },
  muscles: { x: 745, y: 850 },
  skin: { x: 735, y: 960 },
  immune: { x: 540, y: 745 },
  blood: { x: 680, y: 1180 },
};

const COLOURS: Record<Organ, string> = {
  brain: "#FF8FB8",
  eyes: "#7FD6FF",
  heart: "#FF4D6D",
  lungs: "#8ED1F0",
  liver: "#C8553D",
  stomach: "#FFB347",
  gut: "#F7A072",
  kidneys: "#B388EB",
  bones: "#FFF4D6",
  muscles: "#FF6F7D",
  skin: "#FFD166",
  immune: "#5CF2B5",
  blood: "#FF3B5C",
};

// Organ shapes (paths/elements), in canvas coordinates.
const SHAPES: Record<Exclude<Organ, "skin">, string> = {
  bones: `
    <rect x="530" y="690" width="20" height="500" rx="10"/>
    <path d="M455 760 Q540 735 625 760 M450 805 Q540 780 630 805 M455 850 Q540 825 625 850 M465 895 Q540 872 615 895" fill="none" stroke-width="12" stroke-linecap="round"/>
    <rect x="433" y="1205" width="22" height="210" rx="11" transform="rotate(-2 444 1300)"/>
    <rect x="625" y="1205" width="22" height="210" rx="11" transform="rotate(2 636 1300)"/>
    <rect x="420" y="1430" width="36" height="200" rx="18"/>
    <rect x="624" y="1430" width="36" height="200" rx="18"/>
    <circle cx="438" cy="1424" r="26"/><circle cx="642" cy="1424" r="26"/>
    <circle cx="426" cy="1630" r="16"/><circle cx="450" cy="1630" r="16"/>
    <circle cx="630" cy="1630" r="16"/><circle cx="654" cy="1630" r="16"/>
    <rect x="322" y="760" width="18" height="170" rx="9" transform="rotate(10 331 845)"/>
    <rect x="740" y="760" width="18" height="170" rx="9" transform="rotate(-10 749 845)"/>`,
  muscles: `
    <ellipse cx="335" cy="850" rx="38" ry="88" transform="rotate(10 335 850)"/>
    <ellipse cx="745" cy="850" rx="38" ry="88" transform="rotate(-10 745 850)"/>
    <ellipse cx="450" cy="1300" rx="52" ry="115"/>
    <ellipse cx="630" cy="1300" rx="52" ry="115"/>`,
  brain: `<path d="M470 470 C450 420 500 395 525 410 C545 385 600 395 600 425 C635 430 640 480 605 495 C600 520 555 525 540 512 C520 528 478 518 478 495 C455 492 455 478 470 470 Z"/>
    <path d="M505 440 Q525 455 515 475 M560 425 Q545 450 565 470 M590 455 Q575 470 590 488" fill="none" stroke="#00000033" stroke-width="5" stroke-linecap="round"/>`,
  eyes: `<ellipse cx="505" cy="550" rx="24" ry="16"/><ellipse cx="575" cy="550" rx="24" ry="16"/>`,
  lungs: `<path d="M520 740 C470 740 430 800 430 870 C430 915 470 925 520 905 Z"/>
    <path d="M560 740 C610 740 650 800 650 870 C650 915 610 925 560 905 Z"/>`,
  heart: `<path d="M585 905 C540 870 540 830 562 822 C578 816 585 830 585 838 C585 830 592 816 608 822 C630 830 630 870 585 905 Z" transform="translate(-20 -6) scale(1.12) translate(-47 -80)"/>`,
  liver: `<path d="M415 960 C440 935 520 935 545 950 C545 985 510 1015 470 1018 C440 1020 410 1000 415 960 Z"/>`,
  stomach: `<path d="M575 945 C600 930 640 940 640 975 C640 1015 610 1035 585 1030 C565 1026 560 1005 578 1000 C595 997 605 985 595 972 C588 963 575 965 575 945 Z"/>`,
  gut: `<path d="M455 1060 C455 1045 625 1045 625 1060 L625 1160 C625 1180 455 1180 455 1160 Z"/>
    <path d="M480 1080 Q540 1065 600 1080 Q620 1100 600 1115 Q540 1100 480 1115 Q465 1130 480 1145 Q540 1130 600 1145" fill="none" stroke="#00000030" stroke-width="7" stroke-linecap="round"/>`,
  kidneys: `<path d="M455 1030 C440 1010 470 995 480 1015 C488 1030 478 1040 488 1055 C470 1075 445 1060 455 1030 Z"/>
    <path d="M625 1030 C640 1010 610 995 600 1015 C592 1030 602 1040 592 1055 C610 1075 635 1060 625 1030 Z"/>`,
  immune: `<path d="M540 712 L575 725 C575 760 560 780 540 790 C520 780 505 760 505 725 Z"/>
    <path d="M527 750 L537 762 L556 738" fill="none" stroke="#0B3D2E" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  blood: `<path d="M680 1150 C680 1150 655 1180 655 1197 C655 1212 667 1222 680 1222 C693 1222 705 1212 705 1197 C705 1180 680 1150 680 1150 Z"/>
    <path d="M540 905 C560 960 600 1000 600 1060 M540 905 C520 960 480 1000 480 1060 M600 1060 C620 1120 640 1180 640 1300 M480 1060 C460 1120 440 1180 440 1300" fill="none" stroke-width="6" stroke-linecap="round"/>`,
};

const BODY_OUTLINE = `
  <ellipse cx="540" cy="490" rx="108" ry="128"/>
  <rect x="500" y="600" width="80" height="95" rx="30"/>
  <path d="M360 705 C360 680 400 670 470 668 L610 668 C680 670 720 680 720 705 L705 950 C700 1000 680 1060 690 1180 L390 1180 C400 1060 380 1000 375 950 Z"/>
  <path d="M362 700 C320 720 300 780 296 880 C292 980 290 1080 300 1150 C305 1185 345 1185 345 1150 C345 1080 352 990 375 900 Z"/>
  <path d="M718 700 C760 720 780 780 784 880 C788 980 790 1080 780 1150 C775 1185 735 1185 735 1150 C735 1080 728 990 705 900 Z"/>
  <path d="M392 1170 L535 1170 L525 1660 C522 1690 448 1690 442 1660 C430 1500 400 1330 392 1170 Z"/>
  <path d="M545 1170 L688 1170 C680 1330 650 1500 638 1660 C632 1690 558 1690 555 1660 Z"/>`;

function face(organ: Organ): string {
  if (organ === "eyes") {
    // Lit eyes become big cartoon eyes instead of getting a face.
    const eye = (cx: number) =>
      `<ellipse cx="${cx}" cy="550" rx="26" ry="19" fill="#fff" stroke="#1B1B1B" stroke-width="3"/>` +
      `<circle cx="${cx + 3}" cy="551" r="11" fill="#2D9CDB"/><circle cx="${cx + 4}" cy="551" r="6" fill="#1B1B1B"/>` +
      `<circle cx="${cx + 7}" cy="547" r="3" fill="#fff"/>`;
    return `<g>${eye(505)}${eye(575)}</g>`;
  }
  const { x, y } = ANCHORS[organ];
  const small = ["immune", "heart", "kidneys", "blood"].includes(organ);
  const s = small ? 0.62 : 1;
  const cx = organ === "skin" ? x - 20 : x;
  const cy = organ === "blood" ? 1200 : y;
  const eye = (dx: number) =>
    `<circle cx="${cx + dx * s}" cy="${cy - 6 * s}" r="${11 * s}" fill="#fff" stroke="#1B1B1B" stroke-width="${2.5 * s}"/>` +
    `<circle cx="${cx + dx * s + 2 * s}" cy="${cy - 5 * s}" r="${5.5 * s}" fill="#1B1B1B"/>`;
  return (
    `<g>${eye(-15)}${eye(15)}` +
    `<path d="M${cx - 12 * s} ${cy + 10 * s} Q${cx} ${cy + 24 * s} ${cx + 12 * s} ${cy + 10 * s}" fill="none" stroke="#1B1B1B" stroke-width="${4 * s}" stroke-linecap="round"/>` +
    `<ellipse cx="${cx - 24 * s}" cy="${cy + 8 * s}" rx="${7 * s}" ry="${4 * s}" fill="#FF7A9A" opacity="0.7"/>` +
    `<ellipse cx="${cx + 24 * s}" cy="${cy + 8 * s}" rx="${7 * s}" ry="${4 * s}" fill="#FF7A9A" opacity="0.7"/></g>`
  );
}

/** The body is drawn at 80% and moved down, leaving room for the title above it. */
export const BODY_TRANSFORM = { scale: 0.8, dx: 108, dy: 165 };

/** An organ's anchor point on the final canvas. */
export function anchor(organ: Organ): { x: number; y: number } {
  const { x, y } = ANCHORS[organ];
  const t = BODY_TRANSFORM;
  return { x: Math.round(x * t.scale + t.dx), y: Math.round(y * t.scale + t.dy) };
}

export interface BodyOptions {
  highlight: Organ[];
  /** 0..1, for the glow pulse in animations. */
  glow?: number;
  faces?: boolean;
}

/** The body as a transparent-background SVG (1080×1920). */
export function bodySvg({ highlight, glow = 1, faces = true }: BodyOptions): string {
  const on = new Set(highlight);
  const organ = (o: Exclude<Organ, "skin">) => {
    const lit = on.has(o);
    const colour = COLOURS[o];
    const stroked = o === "bones" || o === "blood";
    const style = lit
      ? `fill="${colour}" stroke="${colour}" opacity="1"`
      : `fill="#FFFFFF" stroke="#FFFFFF" opacity="0.13"`;
    const glowLayer = lit
      ? `<g filter="url(#glow)" opacity="${0.55 + 0.45 * glow}" fill="${colour}" stroke="${colour}">${SHAPES[o]}</g>`
      : "";
    return `${glowLayer}<g ${style} ${stroked ? "" : ""}>${SHAPES[o]}</g>`;
  };
  // Back to front: bones and muscles, then organs.
  const order: Exclude<Organ, "skin">[] = [
    "bones",
    "muscles",
    "blood",
    "kidneys",
    "lungs",
    "liver",
    "stomach",
    "gut",
    "heart",
    "brain",
    "eyes",
    "immune",
  ];
  const skinLit = on.has("skin");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#9FF3E0" stop-opacity="0.08"/>
    </linearGradient>
  </defs>
  <g transform="translate(${BODY_TRANSFORM.dx} ${BODY_TRANSFORM.dy}) scale(${BODY_TRANSFORM.scale})">
  <g fill="${skinLit ? COLOURS.skin : "#9FF3E0"}" opacity="${skinLit ? 0.35 + 0.25 * glow : 0.18}" filter="url(#soft)">${BODY_OUTLINE}</g>
  <g fill="url(#glass)" stroke="${skinLit ? COLOURS.skin : "#CFFFF4"}" stroke-width="${skinLit ? 7 : 4}" stroke-opacity="${skinLit ? 1 : 0.7}">${BODY_OUTLINE}</g>
  ${order.map(organ).join("\n")}
  ${faces ? highlight.map(face).join("\n") : ""}
  </g>
</svg>`;
}
