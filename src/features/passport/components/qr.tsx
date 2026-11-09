import QRCode from "qrcode";

/** Server-rendered QR code (SVG) for a check-in URL. */
export async function CheckInQr({ url, label }: { url: string; label: string }) {
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 220 });
  return (
    <figure className="space-y-1">
      <div
        role="img"
        aria-label={label}
        className="mx-auto w-[220px] rounded-lg bg-white p-2"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="text-center text-xs text-muted-foreground">
        Show this to the event team to check in.
      </figcaption>
    </figure>
  );
}
