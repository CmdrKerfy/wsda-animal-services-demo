/* The page's own GIF89a writer (S9, the National Flow time-series GIF): no library, the same approach as
 * the page's own ZIP writer (shared/sample.js). Works in Chrome, Safari and Node (unit tests).
 *
 * Each frame is reduced to a palette of its own (a local color table of 256 entries), with no dithering, so the flat
 * colors of a branded page (the header's teal, the land, the brand colors of the lines) stay exact:
 *   1. Every exact color of the frame is counted.
 *   2. With 256 colors or fewer, the palette is those colors, and the frame is exact.
 *   3. Otherwise the most used colors (each covering at least 1 pixel in 1,000, at most 128 of them) are kept
 *      exactly, and the rest (mostly the soft edges of text and lines) are split into the remaining entries by
 *      median cut, weighted by how many pixels use each color. Each pixel takes its nearest palette entry.
 * The indices are compressed with GIF's variable-length LZW (codes of 9 to 12 bits, a clear code when the table is
 * full) and written in sub-blocks of at most 255 bytes.
 *
 * Use: const w = WSDA.gif.writer(width, height); w.frame(rgba, delay); ... const bytes = w.finish();
 * rgba is the canvas's ImageData.data (width x height x 4, opaque); delay in hundredths of a second. The file loops
 * forever (the NETSCAPE2.0 extension with a loop count of 0). */
(function (root) {
  'use strict';

  const MAX_RESERVED = 128;          // exact colors kept before the median cut
  const RESERVED_SHARE = 1 / 1000;   // a kept color covers at least this share of the frame's pixels

  // ── Bytes ───────────────────────────────────────────────────────────────────────────────────────────────────
  // A growing byte buffer.
  function bytesOut(initial) {
    let buf = new Uint8Array(initial || 65536);
    let n = 0;
    // Make room for k more bytes, doubling the buffer as often as needed.
    const room = k => {
      if (n + k <= buf.length) return;
      let size = buf.length * 2;
      while (size < n + k) size *= 2;
      const next = new Uint8Array(size);
      next.set(buf.subarray(0, n));
      buf = next;
    };
    return {
      byte(b) {
        room(1);
        buf[n++] = b & 0xff;
      },
      u16(v) {
        room(2);
        buf[n++] = v & 0xff;
        buf[n++] = (v >> 8) & 0xff;
      },
      bytes(a) {
        room(a.length);
        buf.set(a, n);
        n += a.length;
      },
      ascii(s) {
        for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
      },
      length: () => n,
      result: () => buf.slice(0, n)
    };
  }

  // ── Colors ──────────────────────────────────────────────────────────────────────────────────────────────────
  // The frame's colors with their pixel counts, as 0xRRGGBB keys; alpha is ignored (the pages are opaque).
  function countColors(rgba) {
    const counts = new Map();
    for (let i = 0; i < rgba.length; i += 4) {
      const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }
  const red = k => (k >> 16) & 0xff;
  const green = k => (k >> 8) & 0xff;
  const blue = k => k & 0xff;
  // Most used first; equal counts by color, so the palette never depends on the order pixels were met.
  const byUse = (a, b) => b.count - a.count || a.key - b.key;

  // Median cut: the colors (each { key, count }) split into at most n boxes, each box's color the mean of its colors
  // weighted by their counts. The box split next is the one whose widest channel range times its pixel count is
  // largest; it is split at the weighted median of that channel.
  function medianCut(colors, n) {
    if (!colors.length || n <= 0) return [];
    const channels = [red, green, blue];
    // A box of colors: its pixel count, its widest channel and that channel's range, and its split priority.
    const describe = list => {
      let pixels = 0;
      let best = 0;
      let channel = 0;
      for (const c of list) pixels += c.count;
      channels.forEach((get, ch) => {
        let lo = 255;
        let hi = 0;
        for (const c of list) {
          const v = get(c.key);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > best) {
          best = hi - lo;
          channel = ch;
        }
      });
      return { list, pixels, range: best, channel, priority: best * pixels };
    };
    const boxes = [describe(colors)];
    while (boxes.length < n) {
      let pick = -1;
      boxes.forEach((b, i) => {
        if (b.list.length > 1 && b.range > 0 && (pick < 0 || b.priority > boxes[pick].priority)) pick = i;
      });
      if (pick < 0) break;
      const b = boxes[pick];
      const get = channels[b.channel];
      const sorted = b.list.slice().sort((x, y) => get(x.key) - get(y.key) || x.key - y.key);
      let acc = 0;
      let cut = 1;
      for (let i = 0; i < sorted.length - 1; i++) {
        acc += sorted[i].count;
        cut = i + 1;
        if (acc * 2 >= b.pixels) break;
      }
      boxes.splice(pick, 1, describe(sorted.slice(0, cut)), describe(sorted.slice(cut)));
    }
    return boxes.map(b => {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (const c of b.list) {
        r += red(c.key) * c.count;
        g += green(c.key) * c.count;
        bl += blue(c.key) * c.count;
      }
      return (Math.round(r / b.pixels) << 16) | (Math.round(g / b.pixels) << 8) | Math.round(bl / b.pixels);
    });
  }

  // One frame's palette and indices. Returns { palette (0xRRGGBB keys, at most 256), table (768 bytes, unused
  // entries black), indices (one byte per pixel), exact (true when every pixel kept its color), reserved (the
  // count of colors kept exactly) }.
  function quantize(rgba) {
    const counts = countColors(rgba);
    const pixels = rgba.length / 4;
    const colors = [...counts].map(([key, count]) => ({ key, count })).sort(byUse);
    let palette;
    let reserved;
    if (colors.length <= 256) {
      palette = colors.map(c => c.key);
      reserved = palette.length;
    } else {
      reserved = 0;
      while (reserved < MAX_RESERVED && colors[reserved].count >= pixels * RESERVED_SHARE) reserved++;
      palette = colors.slice(0, reserved).map(c => c.key)
        .concat(medianCut(colors.slice(reserved), 256 - reserved));
    }
    // Each color's entry: its own when it is in the palette, else the nearest (squared RGB distance; the lower
    // entry on a tie).
    const exactAt = new Map();
    palette.forEach((k, i) => { if (!exactAt.has(k)) exactAt.set(k, i); });
    const pr = palette.map(red);
    const pg = palette.map(green);
    const pb = palette.map(blue);
    const entryOf = new Map();
    for (const c of colors) {
      let at = exactAt.get(c.key);
      if (at === undefined) {
        const r = red(c.key);
        const g = green(c.key);
        const b = blue(c.key);
        let best = Infinity;
        for (let i = 0; i < palette.length; i++) {
          const d = (r - pr[i]) * (r - pr[i]) + (g - pg[i]) * (g - pg[i]) + (b - pb[i]) * (b - pb[i]);
          if (d < best) {
            best = d;
            at = i;
          }
        }
      }
      entryOf.set(c.key, at);
    }
    const indices = new Uint8Array(pixels);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      indices[p] = entryOf.get((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    }
    const table = new Uint8Array(768);
    palette.forEach((k, i) => {
      table[3 * i] = red(k);
      table[3 * i + 1] = green(k);
      table[3 * i + 2] = blue(k);
    });
    return { palette, table, indices, exact: colors.length <= 256, reserved };
  }

  // ── LZW ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // GIF's LZW of the indices with a minimum code size of 8 bits: a clear code first, codes growing from 9 to 12 bits
  // as the table fills, a clear code (at 12 bits) when it is full, the end code last; bits packed from the low end.
  // The table is keyed by (prefix code << 8 | next index), with only the keys set since the last clear reset.
  const MIN_CODE = 8;
  const table = new Uint16Array(4096 << 8);   // code + 1; 0 = not in the table
  function lzw(indices) {
    const clear = 1 << MIN_CODE;
    const end = clear + 1;
    const out = bytesOut(Math.max(1024, indices.length >> 3));
    const used = [];
    let codeSize = MIN_CODE + 1;
    let next = end + 1;
    let bits = 0;
    let nbits = 0;
    const emit = code => {
      bits |= code << nbits;
      nbits += codeSize;
      while (nbits >= 8) {
        out.byte(bits & 0xff);
        bits >>>= 8;
        nbits -= 8;
      }
    };
    const reset = () => {
      for (const k of used) table[k] = 0;
      used.length = 0;
    };
    reset();
    emit(clear);
    if (!indices.length) {
      emit(end);
      if (nbits > 0) out.byte(bits & 0xff);
      return out.result();
    }
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const code = table[key];
      if (code) {
        prefix = code - 1;
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        reset();
        codeSize = MIN_CODE + 1;
        next = end + 1;
      } else {
        // The decoder reads one code behind: the code size grows as the first entry that needs the larger size is
        // added.
        if (next >= (1 << codeSize)) codeSize++;
        table[key] = next + 1;
        used.push(key);
        next++;
      }
      prefix = k;
    }
    emit(prefix);
    emit(end);
    if (nbits > 0) out.byte(bits & 0xff);
    reset();
    return out.result();
  }

  // ── The file ────────────────────────────────────────────────────────────────────────────────────────────────
  // A writer for one animated GIF of width x height pixels. frame(rgba, delay) adds a frame (delay in hundredths of
  // a second) and returns its quantize() summary (palette size, exact, reserved); finish() returns the file's bytes.
  function writer(width, height) {
    if (!(width > 0 && width < 65536 && height > 0 && height < 65536)) throw new Error('GIF size out of range.');
    const out = bytesOut(1 << 20);
    out.ascii('GIF89a');
    out.u16(width);
    out.u16(height);
    out.byte(0x70);   // no global color table; 8 bits per primary color
    out.byte(0);      // background color index
    out.byte(0);      // square pixels
    // NETSCAPE2.0: loop forever.
    out.byte(0x21);
    out.byte(0xff);
    out.byte(11);
    out.ascii('NETSCAPE2.0');
    out.byte(3);
    out.byte(1);
    out.u16(0);
    out.byte(0);
    let frames = 0;
    let done = false;
    return {
      frame(rgba, delay) {
        if (done) throw new Error('The GIF is already finished.');
        if (rgba.length !== width * height * 4) throw new Error('A GIF frame has the wrong size.');
        const q = quantize(rgba);
        // Graphic control extension: "do not dispose" (each frame covers the whole picture anyway), no
        // transparency, the delay.
        out.byte(0x21);
        out.byte(0xf9);
        out.byte(4);
        out.byte(0x04);
        out.u16(Math.max(0, Math.min(65535, Math.round(delay))));
        out.byte(0);
        out.byte(0);
        // Image descriptor: the whole picture, with a local color table of 256 entries.
        out.byte(0x2c);
        out.u16(0);
        out.u16(0);
        out.u16(width);
        out.u16(height);
        out.byte(0x80 | 7);
        out.bytes(q.table);
        out.byte(MIN_CODE);
        const data = lzw(q.indices);
        for (let i = 0; i < data.length; i += 255) {
          const n = Math.min(255, data.length - i);
          out.byte(n);
          out.bytes(data.subarray(i, i + n));
        }
        out.byte(0);
        frames++;
        return { colors: q.palette.length, exact: q.exact, reserved: q.reserved };
      },
      finish() {
        if (!frames) throw new Error('A GIF needs at least one frame.');
        if (!done) {
          out.byte(0x3b);
          done = true;
        }
        return out.result();
      },
      frames: () => frames
    };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.gif = { writer, quantize, medianCut, lzw, countColors, MAX_RESERVED, RESERVED_SHARE };
})(typeof window !== 'undefined' ? window : globalThis);
