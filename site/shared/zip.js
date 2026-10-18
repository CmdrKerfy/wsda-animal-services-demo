/* ZIP reader for user-supplied bundles (F1). Network-free and dependency-free: reads the archive's central
 * directory with Blob.slice(), and inflates "deflate" entries with the browser's built-in
 * DecompressionStream('deflate-raw'). Supports stored (method 0) and deflate (method 8) entries, which is what
 * Windows Explorer "Send to > Compressed folder", macOS Finder "Compress" and common tools write by default.
 * Not supported, with a plain message: encryption, ZIP64 (over 4 GB or 65,535 entries), other methods.
 * Entries are extracted on demand (entry.read(), or entry.head(n) for the first bytes only), CRC-32 checked on
 * full reads, and capped by the limits below. Structure is checked before trusting it: single-disk
 * archives only, complete directory records, each local header agreeing with its directory record (name, method,
 * and sizes/CRC unless a data descriptor follows), entries not overlapping and lying before the directory, no
 * duplicate paths, and a declared size a deflate stream can actually produce. Output buffers grow with the data
 * actually inflated, never from the declared size. Works in Chrome and in Node >= 22 (unit tests). */
(function (root) {
  'use strict';
  const LIMITS = {
    maxArchiveBytes: 1024 * 1024 * 1024,   // 1 GB archive
    maxEntries: 1000,                      // files listed in one archive
    maxEntryBytes: 512 * 1024 * 1024,      // 512 MB per extracted file
    maxTotalBytes: 1024 * 1024 * 1024,     // 1 GB declared uncompressed in total (per archive; load.js also
                                           // applies a 1 GB budget to the whole selection)
    maxDirectoryBytes: 16 * 1024 * 1024    // 16 MB ZIP directory
  };
  const MAX_DEFLATE_RATIO = 1032;          // deflate cannot expand data by more than about 1032:1
  const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50, SIG_Z64_LOCATOR = 0x07064b50;
  const METHOD_NAMES = { 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES encryption' };

  class ZipError extends Error { constructor(message) { super(message); this.name = 'ZipError'; } }
  const mb = n => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';

  let CRC_TABLE = null;
  // The CRC-32 of the bytes (ZIP's checksum); its table is built on first use.
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Names without the UTF-8 flag: valid UTF-8 is taken as UTF-8 (macOS tools), otherwise IBM code page 437, the
  // ZIP specification's legacy encoding. Names flagged UTF-8 must be valid UTF-8 (null = unreadable name).
  const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0';
  const utf8Strict = new TextDecoder('utf-8', { fatal: true });
  function decodeName(bytes, utf8Flag) {
    try { return utf8Strict.decode(bytes); } catch (e) { if (utf8Flag) return null; }
    let out = '';
    for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    return out;
  }

  // Operating-system clutter that is never a dataset; skipped silently but reported as "ignored".
  function systemFileReason(path) {
    const parts = path.split('/'), base = parts[parts.length - 1];
    if (parts.some(p => p === '__MACOSX')) return 'macOS archive metadata';
    if (base === '.DS_Store' || base.startsWith('._')) return 'macOS system file';
    if (/^(thumbs\.db|desktop\.ini)$/i.test(base)) return 'Windows system file';
    return null;
  }

  // The bytes from start to end of a Blob.
  async function bytesOf(blob, start, end) { return new Uint8Array(await blob.slice(start, end).arrayBuffer()); }

  // The chunks joined into one array of the given total length.
  function concat(chunks, length) {
    if (chunks.length === 1) return chunks[0];
    const out = new Uint8Array(length); let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  /** Inflates a raw deflate stream. Memory grows with the data actually produced (never preallocated from the
   * declared size). With stopAt, returns only the first stopAt bytes and cancels the rest. */
  async function inflateRaw(blob, expected, maxBytes, name, stopAt) {
    const reader = blob.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let at = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.length > expected || at + value.length > maxBytes) {
          throw new ZipError(`"${name}" is larger than the archive says; the ZIP may be damaged.`);
        }
        chunks.push(value); at += value.length;
        if (stopAt !== undefined && at >= stopAt) {
          try { await reader.cancel(); } catch (e2) { /* already closed */ }
          return concat(chunks, at).subarray(0, stopAt);
        }
      }
    } catch (e) {
      try { await reader.cancel(); } catch (e2) { /* already closed */ }
      if (e instanceof ZipError) throw e;
      throw new ZipError(`"${name}" could not be decompressed; the ZIP may be damaged.`);
    }
    if (stopAt === undefined && at !== expected) throw new ZipError(
      `"${name}" is shorter than the archive says; the ZIP may be damaged.`);
    return concat(chunks, at);
  }

  /** Lists a ZIP archive (a Blob or File). Returns { entries, ignored } where each entry has
   *  { path, name, size, compressedSize, method, read() -> Promise<Uint8Array> }. Throws ZipError. */
  async function open(blob, options) {
    const lim = Object.assign({}, LIMITS, options && options.limits);
    const label = (options && options.label) || blob.name || 'The ZIP file';
    if (blob.size > lim.maxArchiveBytes) throw new ZipError(
      `${label} is ${mb(blob.size)}; the limit is ${mb(lim.maxArchiveBytes)}.`);
    if (blob.size < 22) throw new ZipError(`${label} is not a ZIP file (too short).`);

    // End of central directory: last 22 bytes plus up to a 65,535-byte comment.
    const tailStart = Math.max(0, blob.size - 22 - 65535);
    const tail = await bytesOf(blob, tailStart, blob.size), tv = new DataView(tail.buffer);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tv.getUint32(i, true) === SIG_EOCD && i + 22 + tv.getUint16(i + 20, true) === tail.length) { e = i; break; }
    }
    if (e < 0) {
      const head = await bytesOf(blob, 0, 4);
      const isZip = head[0] === 0x50 && head[1] === 0x4B;
      throw new ZipError(isZip ? `${label} is incomplete or damaged (no ZIP directory found).` : `${label} is not a ZIP file.`);
    }
    const count = tv.getUint16(e + 10, true), cenSize = tv.getUint32(e + 12, true), cenOff = tv.getUint32(e + 16, true);
    if (tv.getUint16(e + 4, true) !== 0 || tv.getUint16(e + 6, true) !== 0 || tv.getUint16(e + 8, true) !== count) {
      throw new ZipError(`${label} is split across several files (a spanned ZIP), which is not supported.`);
    }
    const z64 = e >= 20 && tv.getUint32(e - 20, true) === SIG_Z64_LOCATOR;
    if (z64 || count === 0xFFFF || cenOff === 0xFFFFFFFF || cenSize === 0xFFFFFFFF) {
      throw new ZipError(`${label} uses the ZIP64 format (over 4 GB or 65,535 files), which is not supported.`);
    }
    if (count > lim.maxEntries) throw new ZipError(
      `${label} lists ${count.toLocaleString('en-US')} files; the limit is ${lim.maxEntries.toLocaleString('en-US')}.`);
    if (cenOff + cenSize > tailStart + e) throw new ZipError(`${label} is incomplete or damaged (directory out of range).`);
    if (cenSize > lim.maxDirectoryBytes) throw new ZipError(
      `${label} has a ${mb(cenSize)} file directory; the limit is ${mb(lim.maxDirectoryBytes)}. The ZIP may be damaged.`);
    if (cenSize < count * 46) throw new ZipError(`${label} is damaged (directory too small for ${count} files).`);

    const cen = await bytesOf(blob, cenOff, cenOff + cenSize), cv = new DataView(cen.buffer);
    const entries = [], ignored = [], ranges = [], seen = new Set();
    let p = 0, total = 0;
    for (let k = 0; k < count; k++) {
      if (p + 46 > cen.length || cv.getUint32(p, true) !== SIG_CEN) throw new ZipError(
        `${label} is damaged (bad directory entry ${k + 1}).`);
      const flags = cv.getUint16(p + 8, true), method = cv.getUint16(p + 10, true), crc = cv.getUint32(p + 16, true);
      const csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
      const nlen = cv.getUint16(p + 28, true), xlen = cv.getUint16(p + 30, true), clen = cv.getUint16(p + 32, true);
      const disk = cv.getUint16(p + 34, true), lho = cv.getUint32(p + 42, true);
      if (p + 46 + nlen + xlen + clen > cen.length) throw new ZipError(
        `${label} is damaged (directory entry ${k + 1} is incomplete).`);
      if (disk !== 0) throw new ZipError(`${label} is split across several files (a spanned ZIP), which is not supported.`);
      if (lho + 30 + nlen + csize > cenOff) throw new ZipError(
        `${label} is damaged (directory entry ${k + 1} points outside the file data).`);
      ranges.push([lho, lho + 30 + nlen + csize]);
      const nameBytes = cen.slice(p + 46, p + 46 + nlen);
      const decoded = decodeName(nameBytes, flags & 0x800);
      p += 46 + nlen + xlen + clen;
      if (decoded === null) {
        ignored.push({ path: `(file ${k + 1})`, reason: 'its name is not valid UTF-8; the ZIP may be damaged' });
        continue;
      }
      const path = decoded.replace(/\\/g, '/');
      if (path.endsWith('/')) continue;                                         // folder entry
      if (seen.has(path)) { ignored.push({ path, reason: 'appears twice in the ZIP; only the first copy is used' }); continue; }
      seen.add(path);
      const name = path.slice(path.lastIndexOf('/') + 1);
      const sys = systemFileReason(path);
      if (sys) { ignored.push({ path, reason: sys }); continue; }
      if (flags & 0x1) { ignored.push({ path, reason: 'password-protected; encrypted ZIP files are not supported' }); continue; }
      if (method !== 0 && method !== 8) {
        ignored.push({ path, reason:
          `compressed with ${METHOD_NAMES[method] || 'method ' + method}; re-save the ZIP with standard compression` });
        continue;
      }
      if (usize > lim.maxEntryBytes) {
        ignored.push({ path, reason: `${mb(usize)} when extracted; the per-file limit is ${mb(lim.maxEntryBytes)}` });
        continue;
      }
      if (method === 8 && usize > csize * MAX_DEFLATE_RATIO + 64) {
        ignored.push({ path, reason: 'declares more data than its compressed size can hold; the ZIP may be damaged' });
        continue;
      }
      total += usize;
      if (total > lim.maxTotalBytes) throw new ZipError(
        `${label} expands to more than ${mb(lim.maxTotalBytes)}; the limit is ${mb(lim.maxTotalBytes)}.`);
      // The local header must agree with this directory record before its data is trusted.
      const dataStart = async () => {
        const lh = await bytesOf(blob, lho, lho + 30 + nlen), lv = new DataView(lh.buffer);
        if (lh.length < 30 || lv.getUint32(0, true) !== SIG_LOC) throw new ZipError(
          `"${path}" is damaged (bad local header).`);
        const lflags = lv.getUint16(6, true), lnlen = lv.getUint16(26, true);
        const sameName = lnlen === nlen && lh.length === 30 + nlen && lh.subarray(30).every((b, i) => b === nameBytes[i]);
        const sameSizes = (lflags & 0x8) || (lv.getUint32(14, true) === crc && lv.getUint32(18, true) === csize
          && lv.getUint32(22, true) === usize);
        if (!sameName || lv.getUint16(8, true) !== method || (lflags & 0x1) || !sameSizes) {
          throw new ZipError(`"${path}" is damaged (its local header does not match the ZIP directory).`);
        }
        const start = lho + 30 + lnlen + lv.getUint16(28, true);
        if (start + csize > cenOff) throw new ZipError(
          `"${path}" is incomplete or damaged; its data runs into the ZIP directory.`);
        if (method === 0 && csize !== usize) throw new ZipError(`"${path}" is damaged (size mismatch).`);
        return start;
      };
      entries.push({
        path, name, size: usize, compressedSize: csize, method,
        async read() {
          const start = await dataStart(), data = blob.slice(start, start + csize);
          const out = method === 0 ? await bytesOf(data, 0, csize) : await inflateRaw(data, usize, lim.maxEntryBytes, path);
          if (crc32(out) !== crc) throw new ZipError(`"${path}" failed its integrity check; the ZIP may be damaged.`);
          return out;
        },
        /** First n bytes only (for header rows); not CRC-checked, as the whole entry is not read. */
        async head(n) {
          const start = await dataStart(), data = blob.slice(start, start + csize);
          return method === 0 ? bytesOf(data, 0, Math.min(n, csize)) : inflateRaw(data, usize, lim.maxEntryBytes, path, n);
        }
      });
    }
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) throw new ZipError(`${label} is damaged (two files share the same data).`);
    }
    return { entries, ignored };
  }

  /** True when the first bytes look like a ZIP local file header ("PK\3\4") or an empty ZIP ("PK\5\6"). */
  async function looksLikeZip(blob) {
    if (blob.size < 4) return false;
    const h = await bytesOf(blob, 0, 4);
    return h[0] === 0x50 && h[1] === 0x4B && ((h[2] === 3 && h[3] === 4) || (h[2] === 5 && h[3] === 6));
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.zip = { open, looksLikeZip, crc32, systemFileReason, ZipError, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
