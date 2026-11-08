/** Type declarations for imports that bring no types of their own. */
declare module "*?url" {
  const url: string;
  export default url;
}

declare module "utif" {
  interface Ifd { width: number; height: number; [key: string]: unknown }
  const UTIF: {
    decode(buffer: ArrayBuffer): Ifd[];
    decodeImage(buffer: ArrayBuffer, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };
  export default UTIF;
}

declare module "mammoth/mammoth.browser.min.js" {
  interface ConversionResult { value: string; messages: Array<{ type: string; message: string }> }
  interface Mammoth {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>): Promise<ConversionResult>;
  }
  const mammoth: Mammoth;
  export default mammoth;
}
