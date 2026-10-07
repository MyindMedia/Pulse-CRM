import { QRCodeSVG } from "qrcode.react";
import { code128Bars, canEncode128 } from "@/lib/code128";

/** One printable sticker: QR and Code 128 of the same code. The code is an
 *  opaque id, so a label found on the street reveals nothing. */
export function GearLabel({ name, code }: { name: string; code: string }) {
  const bars = canEncode128(code) ? code128Bars(code) : null;
  return (
    <div className="gear-label flex break-inside-avoid items-center gap-3 rounded-md border border-neutral-400 bg-white p-2 text-black">
      <QRCodeSVG value={code} size={72} level="M" marginSize={0} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold leading-tight">{name}</p>
        {bars && (
          <svg viewBox={`0 0 ${bars.total} 40`} preserveAspectRatio="none" className="mt-1 h-7 w-full" role="img" aria-label={`Barcode ${code}`}>
            {bars.bars.map((b, i) => (
              <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#000" />
            ))}
          </svg>
        )}
        <p className="mt-0.5 font-mono text-[10px] tracking-wider">{code}</p>
      </div>
    </div>
  );
}
