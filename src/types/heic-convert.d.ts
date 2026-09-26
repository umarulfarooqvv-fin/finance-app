// heic-convert ships no types. Only the one call this app makes is declared.
declare module 'heic-convert' {
  function convert(options: {
    buffer: Buffer | Uint8Array | ArrayBuffer;
    format: 'JPEG' | 'PNG';
    /** 0–1, JPEG only. */
    quality?: number;
  }): Promise<ArrayBuffer | Uint8Array>;
  export default convert;
}
