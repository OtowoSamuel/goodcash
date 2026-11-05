import lzString from 'lz-string';

export const {
  compress,
  decompress,
  compressToBase64,
  decompressFromBase64,
  compressToUTF16,
  decompressFromUTF16,
  compressToUint8Array,
  decompressFromUint8Array,
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} = lzString;

export default lzString;
