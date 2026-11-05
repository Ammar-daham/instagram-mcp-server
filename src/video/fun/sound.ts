/**
 * A synthesised "sound-on" track for fun Reels: a light plucky melody with bass, plus a sound
 * effect on every cue (pop, ding, buzz, whoosh). Copyright-free by construction. It's a
 * placeholder until ElevenLabs voice/SFX (PR 9b) are mixed on the same cue times.
 */
import type { Cue } from "./slides.js";

export interface TimedCue {
  at: number;
  cue: Cue;
}

const NOTES = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 698.46];
const BASS = [130.81, 110.0, 87.31, 98.0];
const pick = (freqs: number[], index: string) =>
  freqs.reduceRight((acc, f, i) => `if(eq(${index},${i}),${f},${acc})`, String(freqs[0]));
const f3 = (n: number) => n.toFixed(3);

function cueExpr({ at, cue }: TimedCue): string {
  const T = f3(at);
  const tau = `(t-${T})`;
  switch (cue) {
    case "pop":
      return `between(t,${T},${f3(at + 0.3)})*0.5*sin(2*PI*(350+1400*exp(-20*${tau}))*${tau})*exp(-14*${tau})`;
    case "ding":
      return `between(t,${T},${f3(at + 1.8)})*0.33*(sin(2*PI*1318.5*${tau})+0.5*sin(2*PI*1975.5*${tau}))*exp(-3.5*${tau})`;
    case "buzz":
      // A playful "wrong answer" honk: two detuned low tones.
      return `between(t,${T},${f3(at + 0.45)})*0.22*(sin(2*PI*155*${tau})+sin(2*PI*148*${tau})+0.5*sin(2*PI*310*${tau}))*exp(-4*${tau})`;
    case "whoosh":
      return `between(t,${T},${f3(at + 0.4)})*0.25*sin(2*PI*(900-1500*${tau})*${tau})*exp(-8*${tau})`;
  }
}

/** The aevalsrc expression for the whole track. */
export function soundExpression(cues: TimedCue[], duration: number): string {
  const step = "floor(t*4)";
  const melody = `0.09*sin(2*PI*${pick(NOTES, `mod(${step},8)`)}*t)*exp(-7*(t*4-${step}))`;
  const bass = `0.06*sin(2*PI*${pick(BASS, "mod(floor(t/2),4)")}*t)*(0.6+0.4*exp(-2*(t-2*floor(t/2))))`;
  // The bed fades out over the last second.
  const bed = `(${melody}+${bass})*if(lt(t,${f3(duration - 1)}),1,max(0,${f3(duration)}-t))`;
  return [bed, ...cues.map(cueExpr)].join("+");
}
