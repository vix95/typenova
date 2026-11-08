/** TIFF pictures: the webview cannot show them, so the first page is decoded to pixels and shown as a PNG. */
import { readFile } from "@tauri-apps/plugin-fs";

/** An object URL of the PNG made from the TIFF file's first page (revoke it when the picture is no longer needed). */
export async function tiffObjectUrl(path: string): Promise<string> {
  const [{ default: UTIF }, bytes] = await Promise.all([import("utif"), readFile(path)]);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const pages = UTIF.decode(buffer);
  if (!pages.length) throw new Error("empty TIFF");
  UTIF.decodeImage(buffer, pages[0]);
  const { width, height } = pages[0];
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const pixels = UTIF.toRGBA8(pages[0]);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode the picture");
  return URL.createObjectURL(blob);
}
