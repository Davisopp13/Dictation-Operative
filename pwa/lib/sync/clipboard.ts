import { IMAGE_LIMIT, validatePayload, type Payload } from "./protocol";
export async function imagePayload(blob: Blob): Promise<Payload> {
  if (blob.size > IMAGE_LIMIT) throw new Error("Images must be 8 MiB or smaller.");
  if (blob.type === "image/png") {
    const p: Payload = { mime: "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) };
    validatePayload(p);
    return p;
  }
  if (!["image/jpeg", "image/webp", "image/tiff"].includes(blob.type))
    throw new Error(
      "Copy a PNG, JPEG, WebP, or screenshot. Animated images and file paths are not supported.",
    );
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40000000 || bitmap.width > 16384 || bitmap.height > 16384)
      throw new Error("Image dimensions exceed the 40 megapixel limit.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Unable to convert this image."))),
        "image/png",
      ),
    );
    return imagePayload(png);
  } finally {
    bitmap.close();
  }
}
export async function readClipboard(): Promise<Payload> {
  if (!navigator.clipboard?.read)
    throw new Error("Clipboard reading is unavailable. Use the paste box below.");
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const mime = item.types.find((t) => t.startsWith("image/"));
    if (mime) return imagePayload(await item.getType(mime));
  }
  for (const item of items)
    if (item.types.includes("text/plain"))
      return {
        mime: "text/plain",
        bytes: new Uint8Array(await (await item.getType("text/plain")).arrayBuffer()),
      };
  throw new Error("Copy text or an image first. File references are not image content.");
}
/** Call directly from a user gesture; promise-valued ClipboardItems preserve Safari activation. */
export function writeClipboard(mime: Payload["mime"], payload: Promise<Payload>) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("Clipboard writing is unavailable in this browser.");
  return navigator.clipboard.write([
    new ClipboardItem({ [mime]: payload.then((p) => new Blob([p.bytes], { type: p.mime })) }),
  ]);
}
