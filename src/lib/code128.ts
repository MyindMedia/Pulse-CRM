/* Minimal Code 128 (set B) encoder for printable gear labels. Pure and small
   on purpose: the label sheet needs one symbology, not a barcode library. */

const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232",
];
const STOP = "2331112";
const START_B = 104;

/** Printable ASCII 32..126 only. */
export function canEncode128(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text);
}

/** Module widths, alternating bar and space, starting with a bar. */
export function code128Widths(text: string): number[] {
  if (!canEncode128(text)) throw new Error("Code 128 B encodes printable ASCII only");
  const values = [START_B, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const sum = values.reduce((acc, v, i) => acc + v * (i === 0 ? 1 : i), 0);
  values.push(sum % 103);
  const widths: number[] = [];
  for (const v of values) for (const d of PATTERNS[v]) widths.push(Number(d));
  for (const d of STOP) widths.push(Number(d));
  return widths;
}

/** Bars as x/width rects in module units, plus the total width (with quiet zones). */
export function code128Bars(text: string, quiet = 10): { bars: { x: number; w: number }[]; total: number } {
  const widths = code128Widths(text);
  const bars: { x: number; w: number }[] = [];
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return { bars, total: x + quiet };
}
