/*
  Lecture d'un tampon Blosc 1 (format des blocs Zarr « blosc ») compressé en Zstandard.
  pfBlosc.decode(Uint8Array, zstdDecompress) -> Uint8Array
  Gère : blocs multiples, blocs découpés par octet (split), tampon recopié tel quel (memcpy),
  mélange d'octets (shuffle) et mélange de bits (bitshuffle). Seul le compresseur zstd est pris en charge.
*/
const pfBlosc = {
  decode(src, zstd) {
    if (src.length < 16) throw new Error("blosc : tampon trop court");
    const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const flags = src[2], typesize = src[3] || 1, nbytes = dv.getUint32(4, true), blocksize = dv.getUint32(8, true), cbytes = dv.getUint32(12, true);
    if (cbytes > src.length) throw new Error("blosc : tampon tronqué");
    const out = new Uint8Array(nbytes);
    if (!nbytes) return out;
    if (flags & 0x02) { out.set(src.subarray(16, 16 + nbytes)); return out; } // recopié sans compression
    const comp = flags >> 5;
    if (comp !== 4) throw new Error("blosc : compresseur non pris en charge (" + comp + ")");
    const doShuffle = (flags & 0x01) && typesize > 1, doBit = !!(flags & 0x04), dontSplit = !!(flags & 0x10);
    // mélange de bits : validé pour des éléments d'un octet et des blocs multiples de 8 (cas des embeddings)
    if (doBit && (typesize !== 1 || nbytes % 8 || blocksize % 8)) throw new Error("blosc : mélange de bits non pris en charge pour ce format");
    const nblocks = Math.ceil(nbytes / blocksize);
    let tmp = doShuffle || doBit ? new Uint8Array(blocksize) : null;
    for (let b = 0; b < nblocks; b++) {
      const bsize = Math.min(blocksize, nbytes - b * blocksize), leftover = bsize !== blocksize;
      let p = dv.getInt32(16 + 4 * b, true);
      // un bloc est découpé en « typesize » flux quand le découpage est permis et que le bloc est complet
      const nsplits = !dontSplit && !leftover && typesize > 1 && typesize <= 16 && bsize / typesize >= 128 ? typesize : 1;
      const dst = tmp ? tmp.subarray(0, bsize) : out.subarray(b * blocksize, b * blocksize + bsize);
      const neblock = bsize / nsplits;
      let o = 0;
      for (let s = 0; s < nsplits; s++) {
        const csize = dv.getInt32(p, true); p += 4;
        if (csize === neblock) dst.set(src.subarray(p, p + csize), o);
        else { const d = zstd(src.subarray(p, p + csize)); if (d.length !== neblock) throw new Error("blosc : taille de bloc inattendue"); dst.set(d, o); }
        p += csize; o += neblock;
      }
      if (!tmp) continue;
      const res = out.subarray(b * blocksize, b * blocksize + bsize);
      if (doBit) this.unbitshuffle(dst, res, typesize); else this.unshuffle(dst, res, typesize);
    }
    return out;
  },
  // octets regroupés par rang (tous les octets 0, puis tous les octets 1…) -> éléments
  unshuffle(src, dst, ts) {
    const n = Math.floor(src.length / ts);
    for (let j = 0; j < ts; j++) { const base = j * n; for (let i = 0; i < n; i++) dst[i * ts + j] = src[base + i]; }
    for (let i = n * ts; i < src.length; i++) dst[i] = src[i];
  },
  // bits regroupés par rang : pour chaque octet d'élément et chaque bit, une rangée de n/8 octets
  unbitshuffle(src, dst, ts) {
    let n = Math.floor(src.length / ts); n -= n % 8;
    const rows = n / 8;
    dst.fill(0, 0, n * ts);
    for (let j = 0; j < ts; j++) for (let k = 0; k < 8; k++) {
      const base = (j * 8 + k) * rows, bit = 1 << k;
      for (let m = 0; m < rows; m++) {
        const v = src[base + m]; if (!v) continue;
        const e = m * 8 * ts + j;
        if (v & 1) dst[e] |= bit; if (v & 2) dst[e + ts] |= bit; if (v & 4) dst[e + 2 * ts] |= bit; if (v & 8) dst[e + 3 * ts] |= bit;
        if (v & 16) dst[e + 4 * ts] |= bit; if (v & 32) dst[e + 5 * ts] |= bit; if (v & 64) dst[e + 6 * ts] |= bit; if (v & 128) dst[e + 7 * ts] |= bit;
      }
    }
    for (let i = n * ts; i < src.length; i++) dst[i] = src[i];
  }
};
if (typeof module !== "undefined" && module.exports) module.exports = { pfBlosc };
if (typeof window !== "undefined") window.pfBlosc = pfBlosc;
