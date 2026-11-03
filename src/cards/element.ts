/**
 * Minimal element builder for satori, so templates don't need React. Satori accepts plain
 * `{ type, props }` objects; every <div> with more than one child must be `display: flex`.
 */
export type Style = Record<string, string | number>;
export type Child = CardNode | string | number | null | undefined | false;
export interface CardNode {
  type: string;
  props: { style?: Style; children?: Child | Child[]; [key: string]: unknown };
}

export function div(style: Style, ...children: Child[]): CardNode {
  const kids = children.filter((c) => c !== null && c !== undefined && c !== false);
  return {
    type: "div",
    props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids },
  };
}

export function img(src: string, style: Style): CardNode {
  return { type: "img", props: { src, style } };
}
