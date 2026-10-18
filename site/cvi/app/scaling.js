/* Radius engine and legend tiers: port of CVI shiny/R/map_helpers.R .compute_radius() and .legend_tiers(),
 * including R's quantile(type 7), seq(length.out), cut(include.lowest = TRUE),
 * classInt 0.4-11 style "fisher" (Hartigan's exact Fisher algorithm), round() and format(big.mark = ","). */
(function (root) {
  'use strict';

  // seq(0, 1, length.out = n): from + (0:(n-1)) * by
  function seqProbs(n) {
    const by = 1 / (n - 1); const out = [];
    for (let i = 0; i < n; i++) out.push(Math.min(i * by, 1));
    return out;
  }

  // stats::quantile(x, probs, type = 7, names = FALSE) for finite x
  function quantile7(x, probs) {
    const s = x.slice().sort((a, b) => a - b), n = s.length;
    return probs.map(p => {
      const index = 1 + Math.max(n - 1, 0) * p;
      const lo = Math.floor(index), hi = Math.ceil(index);
      let q = s[lo - 1];
      if (index > lo && s[hi - 1] !== q) { const h = index - lo; q = (1 - h) * q + h * s[hi - 1]; }
      return q;
    });
  }
  const uniqueNum = a => a.filter((v, i) => a.indexOf(v) === i);
  // R mean(): sum / n, then one refinement pass (summary.c), as R does for double vectors.
  function rMean(x) {
    const n = x.length; let s = 0; for (const v of x) s += v;
    let m = s / n, t = 0; for (const v of x) t += v - m;
    return m + t / n;
  }

  // .bincode(x, breaks, right = TRUE, include.lowest = TRUE) as used by cut(); null = NA
  function bincode(x, breaks) {
    for (let i = 1; i < breaks.length; i++) if (breaks[i] === breaks[i - 1]) throw new Error("'breaks' are not unique");
    const nb = breaks.length;
    return x.map(v => {
      if (v === null || Number.isNaN(v)) return null;
      let lo = 0, hi = nb - 1;
      if (v < breaks[lo] || breaks[hi] < v) return null;
      while (hi - lo >= 2) { const mid = (hi + lo) >> 1; if (v > breaks[mid]) lo = mid; else hi = mid; }
      return lo + 1;
    });
  }

  // classInt::classIntervals(var, n, style = "fisher")$brks (no sampling: CVI's WA inputs are far below largeN).
  function fisherBreaks(values, n) {
    const v = values.filter(x => x !== null && Number.isFinite(x));
    const nobs = uniqueNum(v).length;
    if (nobs === 1) throw new Error('single unique value');
    if (n < 2) throw new Error('n less than 2');
    if (n > nobs) n = nobs;
    if (n === nobs) {
      // classInt: "each different finite value is a separate class" -- midpoints, ends padded by mean gap / 2.
      const sv = uniqueNum(v).sort((a, b) => a - b);
      if (sv.length < 2) throw new Error('only 0\'s may be mixed with negative subscripts');
      const ds = sv.slice(1).map((x, i) => x - sv[i]);
      const md = rMean(ds);
      return [sv[0] - md / 2].concat(sv.slice(0, -1).map((x, i) => x + ds[i] / 2), [sv[sv.length - 1] + md / 2]);
    }
    const x = v.slice().sort((a, b) => a - b), m = x.length, k = n;
    const work = [], iwork = [];
    for (let i = 0; i < m; i++) { work.push(new Array(k).fill(Number.MAX_VALUE)); iwork.push(new Array(k).fill(1)); }
    for (let j = 0; j < k; j++) work[0][j] = 0;
    for (let i = 1; i <= m; i++) {
      let ss = 0, s = 0, varr = 0;
      for (let ii = 1; ii <= i; ii++) {
        const il = i - ii + 1, xv = x[il - 1];
        s += xv; ss += xv * xv;
        varr = ss - s * s / ii;
        const ik = il - 1;
        if (ik === 0) continue;
        for (let j = 2; j <= k; j++) {
          if (work[i - 1][j - 1] >= varr + work[ik - 1][j - 2]) {
            iwork[i - 1][j - 1] = il; work[i - 1][j - 1] = varr + work[ik - 1][j - 2];
          }
        }
      }
      work[i - 1][0] = varr; iwork[i - 1][0] = 1;
    }
    // Backtrack: class 1 is the TOP class (ends at the maximum), class k the lowest.
    const mins = [], maxs = [];
    let il = m + 1;
    for (let l = 1; l <= k; l++) {
      const ll = k - l + 1, iu = il - 1;
      il = iwork[iu - 1][ll - 1];
      mins.push(x[il - 1]); maxs.push(x[iu - 1]);
    }
    const brks = [mins[k - 1]];
    for (let i = k; i >= 2; i--) brks.push((maxs[i - 1] + mins[i - 2]) / 2);
    brks.push(maxs[0]);
    return brks;
  }

  // Each value's circle radius in pixels, from minR to maxR (4 to 48 unless given), by the scaling: log, linear,
  // square root, or the binned quantile and natural breaks. Every circle gets the middle radius when all are equal.
  function computeRadius(values, scaling, minR, maxR, nBins) {
    scaling = scaling || 'log'; minR = minR === undefined ? 4 : minR; maxR = maxR === undefined ? 48 : maxR;
    const v = values.map(x => (x === null || Number.isNaN(x) || x < 0) ? 0 : x);
    const n = v.length;
    if (n === 0) return [];
    const vmax = Math.max(...v);
    const mid = (minR + maxR) / 2;
    if (vmax === 0 || v.every(x => x === v[0])) return v.map(() => mid);
    nBins = Math.max(2, Math.trunc(nBins === undefined ? 5 : nBins));
    const norm = t => minR + t * (maxR - minR);
    if (scaling === 'log') return v.map(x => norm(Math.log1p(x) / Math.log1p(vmax)));
    if (scaling === 'linear') return v.map(x => norm(x / vmax));
    if (scaling === 'sqrt') return v.map(x => norm(Math.sqrt(x) / Math.sqrt(vmax)));
    if (scaling !== 'quantile' && scaling !== 'natural')
      throw new Error("'arg' should be one of log, linear, sqrt, quantile, natural");
    const g = binsOf(v, scaling, nBins);
    if (!g) return v.map(() => mid);
    return g.bins.map(b => norm((b - 1) / (g.maxBin - 1)));
  }

  // The binned scalings' bins (CVI's .compute_radius): breaks from the positive values (quantile; natural = Fisher with
  // the quantile fallback), each value's bin by cut(include.lowest), NA as bin 1. null where computeRadius gives every
  // circle the middle radius. Shared by the map's circles and the legend (S1.1), so a legend tier gets its bin's radius.
  function binsOf(values, scaling, nBins) {
    const v = values.map(x => (x === null || Number.isNaN(x) || x < 0) ? 0 : x);
    if (!v.length) return null;
    const vmax = Math.max(...v);
    if (vmax === 0 || v.every(x => x === v[0])) return null;
    nBins = Math.max(2, Math.trunc(nBins === undefined ? 5 : nBins));
    const pos = v.filter(x => x > 0);
    let brks;
    if (scaling === 'quantile') {
      brks = uniqueNum(quantile7(pos, seqProbs(nBins + 1)));
    } else {
      try { brks = fisherBreaks(pos, nBins); } catch (e) { brks = null; }
      if (brks === null || uniqueNum(brks).length < 2) brks = uniqueNum(quantile7(pos, seqProbs(nBins + 1)));
    }
    if (brks.length < 2) return null;
    const bins = bincode(v, brks).map(b => b === null ? 1 : b);
    const maxBin = Math.max(...bins);
    if (maxBin < 2) return null;
    const binOf = x => {
      const b = bincode([x === null || Number.isNaN(x) || x < 0 ? 0 : x], brks)[0];
      return b === null ? 1 : b;
    };
    return { brks, bins, maxBin, binOf };
  }

  // CVI's legend tiers (.legend_tiers): the midpoints between the breaks for the binned scalings, else the 10%, 50%
  // and 90% quantiles of the positive values, with CVI's radii for them; null with fewer than two positive values.
  function legendTiers(values, scaling, nBins, minR, maxR) {
    minR = minR === undefined ? 4 : minR; maxR = maxR === undefined ? 48 : maxR;
    const v = values.filter(x => x !== null && !Number.isNaN(x) && x > 0);
    if (v.length < 2) return null;
    nBins = Math.max(2, Math.trunc(nBins === undefined ? 5 : nBins));
    const mids = b => b.slice(1).map((x, i) => (x + b[i]) / 2);
    let tv;
    if (scaling === 'quantile' || scaling === 'natural') {
      let brks = null;
      if (scaling === 'natural') { try { brks = uniqueNum(fisherBreaks(v, nBins)); } catch (e) { brks = null; } }
      if (brks === null || brks.length < 2) brks = uniqueNum(quantile7(v, seqProbs(nBins + 1)));
      tv = brks.length >= 2 ? mids(brks) : quantile7(v, [0.1, 0.5, 0.9]);
    } else {
      tv = quantile7(v, [0.1, 0.5, 0.9]);
    }
    return { values: tv, radii: computeRadius(tv, scaling, minR, maxR, nBins) };
  }

  // The legend's size circles as the map draws them (a deliberate difference): CVI's tier values;
  // each radius the one the map gives that value among all the circles drawn (values), with no cap. Log, linear and
  // square root: computeRadius with the value added (the maximum is unchanged: tiers are quantiles of the values).
  // Quantile and natural breaks: the radius of the tier's bin under the data's own breaks (binsOf; adding the value
  // would move the breaks). CVI sizes the tiers against each other instead (cviRadii keeps CVI's): for log, linear and
  // square root that overstates them, for the binned scalings it differs when the data has fewer distinct bins than
  // asked for or a tier is negative.
  function legendRadii(values, scaling, nBins) {
    const t = legendTiers(values, scaling, nBins);
    if (!t) return null;
    let radii;
    if (scaling === 'quantile' || scaling === 'natural') {
      const g = binsOf(values, scaling, nBins);
      radii = t.values.map(v => (g ? 4 + (g.binOf(v) - 1) / (g.maxBin - 1) * (48 - 4) : (4 + 48) / 2));
    } else {
      radii = t.values.map(v => { const r = computeRadius(values.concat([v]), scaling, 4, 48, nBins); return r[r.length - 1]; });
    }
    return { values: t.values, radii, cviRadii: t.radii };
  }

  // Focus sizing (S5): one exact partition for BOTH point and nested legend radii, always 4-24 px.
  // The caller requests a new result when data/scaling/bins change; no mutable cache survives across calls.
  // Existing WA/Flow helpers above keep their own behavior. Fisher is called only by binsOf, once at most;
  // tier midpoints and their actual-map radii use that same partition, not a second classification of the tiers.
  function focusSizing(values, scaling, nBins) {
    scaling = scaling || 'log';
    nBins = Math.max(2, Math.trunc(nBins === undefined ? 5 : nBins));
    const v = values.map(x => (x === null || Number.isNaN(x) || x < 0) ? 0 : x);
    const pos = v.filter(x => x > 0);
    const binned = scaling === 'quantile' || scaling === 'natural';
    const g = binned ? binsOf(v, scaling, nBins) : null;
    const radiusForBin = b => 4 + (b - 1) / (g.maxBin - 1) * 20;
    const radii = binned ? (g ? g.bins.map(radiusForBin) : v.map(() => 14))
      : computeRadius(v, scaling, 4, 24, nBins);
    let legend = null;
    if (pos.length >= 2) {
      let tv;
      if (binned) {
        // A constant/degenerate partition uses CVI's quantile fallback, without a second Fisher attempt.
        const brks = g ? g.brks : uniqueNum(quantile7(pos, seqProbs(nBins + 1)));
        tv = brks.length >= 2 ? brks.slice(1).map((x, i) => (x + brks[i]) / 2)
          : quantile7(pos, [0.1, 0.5, 0.9]);
      } else tv = quantile7(pos, [0.1, 0.5, 0.9]);
      const rr = binned ? tv.map(x => g ? radiusForBin(g.binOf(x)) : 14)
        : tv.map(x => { const r = computeRadius(v.concat([x]), scaling, 4, 24, nBins); return r[r.length - 1]; });
      legend = { values: tv, radii: rr };
    }
    return { radii, legend, breaks: g ? g.brks : null };
  }

  // R round(x): IEC 60559 round-half-even for exact .5 values (as R >= 4.0 does for digits = 0).
  function rRound(x) {
    if (x === null || !Number.isFinite(x)) return x;
    const f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  const addMarks = s => s.replace(/^(-?)(\d+)/, (m, sg, int) => sg + int.replace(/\B(?=(\d{3})+(?!\d))/g, ','));

  // format(x, big.mark = ",") for a vector of whole numbers (R's formatReal fixed-vs-scientific choice, digits 7,
  // scipen 0), padded to one common width as format() does.
  function formatR(xs) {
    // Missing, infinite and NaN values print as R does ("NA", "Inf", "-Inf", "NaN"); the finite ones are formatted on
    // their own, then every value is padded to the widest.
    if (xs.some(x => !Number.isFinite(x))) {
      const fin = formatR(xs.filter(Number.isFinite)).map(s => s.trim());
      let j = 0;
      const strs = xs.map(x => Number.isFinite(x) ? fin[j++] : x === null ? 'NA' : Number.isNaN(x) ? 'NaN'
        : x > 0 ? 'Inf' : '-Inf');
      const w = Math.max(...strs.map(s => s.length));
      return strs.map(s => ' '.repeat(w - s.length) + s);
    }
    if (!xs.length) return [];
    const info = xs.map(x => {
      if (x === 0) return { neg: false, kp: 0, nsig: 1 };
      const ax = Math.abs(x);
      let kp = Math.floor(Math.log10(ax));
      let mant = ax / Math.pow(10, kp);
      let m7 = Math.round(mant * 1e6) / 1e6;
      if (m7 >= 10) { kp += 1; m7 = m7 / 10; }
      let digs = m7.toFixed(6).replace('.', '').replace(/0+$/, '');
      return { neg: x < 0, kp, nsig: Math.max(1, digs.length) };
    });
    const neg = info.some(i => i.neg) ? 1 : 0;
    let mxsl = 1, rgt = 0, mxns = 1, mxe = 0;
    info.forEach(i => {
      mxsl = Math.max(mxsl, i.kp >= 0 ? i.kp + 1 : 1);
      rgt = Math.max(rgt, Math.max(0, i.nsig - i.kp - 1));
      mxns = Math.max(mxns, i.nsig);
      mxe = Math.max(mxe, Math.abs(i.kp));
    });
    const wF = neg + mxsl + (rgt ? rgt + 1 : 0);
    const eDigits = mxe >= 100 ? 2 : 1;
    const wE = neg + (mxns > 1 ? mxns + 1 : mxns) + eDigits + 3;
    let strs;
    if (wF <= wE) {
      strs = xs.map(x => addMarks(x.toFixed(rgt)));
    } else {
      strs = xs.map(x => {
        const e = x.toExponential(mxns - 1);
        return e.replace(/e([+-])(\d+)$/, (m, sg, d) => 'e' + sg
          + (d.length < 2 + (eDigits - 1) ? '0'.repeat(2 + (eDigits - 1) - d.length) + d : d));
      });
    }
    const w = Math.max(...strs.map(s => s.length));
    return strs.map(s => ' '.repeat(w - s.length) + s);
  }
  // scales::comma() for whole numbers: thousands separators, no padding.
  const comma = x => addMarks(String(rRound(x)));

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.scaling = { seqProbs, quantile7, bincode, fisherBreaks, computeRadius, binsOf, legendTiers, legendRadii,
    focusSizing, rRound, formatR, comma };
})(typeof window !== 'undefined' ? window : globalThis);
