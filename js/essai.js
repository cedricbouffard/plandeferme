/*
  Planification d'essais à la ferme
  ---------------------------------
  pfEssai.open({ features, name }) / pfEssai.openForParcel(feature)
  Découpe une parcelle en parcelles d'essai rectangulaires alignées sur le sens des passages (sens du champ,
  angle saisi ou ligne tracée sur la carte), à partir des largeurs d'équipement, des marges en bout et sur
  les côtés, de la longueur des parcelles et de la liste des traitements. Aperçu sur la carte, puis
  enregistrement dans Mes données › Essais. Démarche inspirée du paquet R « ofpetrial » (DIFM).

  Calcul en mètres (projection UTM locale), dans un repère tourné : a = le long des passages, b = en travers.
  - Les bandes ont la largeur d'une parcelle et sont calées sur les passages de l'applicateur : à partir du
    bord du champ (marge de côté arrondie à un nombre entier de passages) ou de la ligne tracée.
  - Dans chaque bande, on garde les tronçons entièrement dans le champ (marge de côté retirée), raccourcis
    des bouts de champ, puis découpés en parcelles de longueur comprise entre le minimum et le maximum.
  - Les traitements sont répartis selon le dispositif choisi (tirage reproductible par une graine).
*/
const pfEssaiGeom = {
  MAX_PLOTS: 4000,
  FT: 0.3048,
  // doses croissantes : du pâle au foncé ; traitements nommés : couleurs bien distinctes
  RAMP: ["#fde725", "#b5de2b", "#6ece58", "#35b779", "#1f9e89", "#26828e", "#31688e", "#3e4989", "#482878", "#440154"],
  QUAL: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#EE7733", "#009988", "#BBBBBB", "#332288", "#999933", "#882255"],

  rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; },
  shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; },
  gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; },

  // « 0, 50, 100 » ou « Témoin; Variété A; Variété B » -> [{ label, value, color }]
  parseTreatments(text) {
    const raw = String(text || "").split(/[;\n]+|,(?=\s)|,(?=\D)|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    let parts = raw;
    // « 0,50,100 » sans espace : la virgule sépare les doses (un décimal s'écrit alors avec un point)
    if (parts.length === 1 && /,/.test(parts[0])) parts = parts[0].split(",").map((s) => s.trim()).filter(Boolean);
    const seen = new Set(), out = [];
    parts.forEach((p) => { const k = p.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(p); } });
    const nums = out.map((p) => (/^-?\d+(\.\d+)?$/.test(p) ? parseFloat(p) : NaN)), numeric = out.length > 0 && nums.every(Number.isFinite);
    let list = out.map((label, i) => ({ label, value: numeric ? nums[i] : null }));
    if (numeric) list.sort((x, y) => x.value - y.value);
    const n = list.length;
    list.forEach((t, i) => { t.color = numeric ? this.RAMP[n < 2 ? 4 : Math.round((i * (this.RAMP.length - 1)) / (n - 1))] : this.QUAL[i % this.QUAL.length]; });
    return { list, numeric };
  },
  // Largeur de parcelle conseillée : le plus petit nombre de passages d'applicateur qui laisse au moins un
  // passage de récolteuse entièrement dans la parcelle (2 largeurs de récolteuse si les passages ne tombent pas juste)
  plotWidth(app, harv) {
    if (!(app > 0)) return 0;
    if (!(harv > 0)) return app;
    for (let k = 1; k <= 40; k++) {
      const w = k * app, r = w / harv;
      if (w >= harv - 1e-6 && Math.abs(r - Math.round(r)) < 1e-6) return w; // multiple exact de la récolteuse
      if (w >= 2 * harv - 1e-6) return w;
    }
    return app;
  },
  // Intervalles [a0, a1] couverts par les anneaux (règle pair-impair) sur la droite b = niveau
  intervals(rings, b) {
    const xs = [];
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const p = r[i], q = r[j];
      if ((p[1] > b) !== (q[1] > b)) xs.push(p[0] + ((b - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
    }
    xs.sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
    return out;
  },
  intersect(A, B) {
    const out = []; let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1]);
      if (hi - lo > 1e-6) out.push([lo, hi]);
      if (A[i][1] < B[j][1]) i++; else j++;
    }
    return out;
  },
  // Tronçons d'une bande [b0, b1] entièrement à l'intérieur des anneaux
  stripRuns(rings, b0, b1) {
    const eps = Math.min(0.01, (b1 - b0) / 100), levels = [b0 + eps, (b0 + b1) / 2, b1 - eps];
    for (const r of rings) for (const p of r) if (p[1] > b0 + eps && p[1] < b1 - eps) { levels.push(p[1] - 1e-4); levels.push(p[1] + 1e-4); }
    let runs = null;
    for (const lv of levels) { const iv = this.intervals(rings, lv); runs = runs ? this.intersect(runs, iv) : iv; if (!runs.length) break; }
    return runs || [];
  },
  // Répartition des traitements. strip, pos : bande et rang (à partir de 0) de chaque parcelle, en serpentin.
  assign(design, nT, strip, pos, rnd) {
    const N = strip.length, t = new Array(N), block = new Array(N).fill(null), ids = Array.from({ length: nT }, (_, i) => i);
    if (design === "bandes") {
      let perm = [], last = -1, s = -1;
      for (let i = 0; i < N; i++) { if (strip[i] !== last) { last = strip[i]; s++; if (s % nT === 0) perm = this.shuffle(ids, rnd); } t[i] = perm[s % nT]; block[i] = Math.floor(s / nT) + 1; }
    } else if (design === "blocs") {
      let perm = [];
      for (let i = 0; i < N; i++) { if (i % nT === 0) perm = this.shuffle(ids, rnd); t[i] = perm[i % nT]; block[i] = Math.floor(i / nT) + 1; }
    } else if (design === "aleatoire") {
      const bag = []; for (let i = 0; i < N; i++) bag.push(i % nT);
      const sh = this.shuffle(bag, rnd); for (let i = 0; i < N; i++) t[i] = sh[i];
    } else { // carré latin : chaque traitement une fois par groupe de n parcelles, le long comme en travers
      const perm = this.shuffle(ids, rnd), cop = []; for (let s = 1; s < nT; s++) if (this.gcd(s, nT) === 1) cop.push(s);
      const good = cop.filter((s) => s !== 1 && s !== nT - 1), pool = good.length ? good : cop.length ? cop : [1];
      const shift = pool[Math.floor(rnd() * pool.length)], off = Math.floor(rnd() * nT);
      for (let i = 0; i < N; i++) t[i] = perm[(((strip[i] * shift + pos[i] + off) % nT) + nT) % nT];
    }
    return { t, block };
  },
  /*
    Dispositif en mètres. mp : multipolygone ; o : { azimuth, plotWidth, appWidth, head, side, minLen, maxLen,
    design: "latin" | "blocs" | "aleatoire" | "bandes", n (nombre de traitements), seed, anchor: [x, y] | null }
    tools : { inward(mp, d) -> multipolygone rétréci } (facultatif)
    -> { plots: [{ ring, strip, pos, block, t, w, len }], tooMany }
  */
  layout(mp, o, tools) {
    const w = o.plotWidth, nT = o.n;
    if (!(w > 0) || !(nT > 0) || !mp.length) return { plots: [] };
    const t = ((90 - o.azimuth) * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t), vx = -uy, vy = ux;
    let cx = 0, cy = 0, n = 0;
    mp.forEach((poly) => poly[0].forEach((c) => { cx += c[0]; cy += c[1]; n++; }));
    cx /= n; cy /= n;
    const toAB = (c) => [(c[0] - cx) * ux + (c[1] - cy) * uy, (c[0] - cx) * vx + (c[1] - cy) * vy];
    const toXY = (a, b) => [cx + a * ux + b * vx, cy + a * uy + b * vy];
    const side = Math.max(0, o.side || 0), head = Math.max(0, o.head || 0);
    let inner = mp, shrunk = false;
    if (side > 0 && tools && typeof tools.inward === "function") { try { inner = tools.inward(mp, side) || []; shrunk = true; } catch (e) { inner = mp; } }
    const rings = []; inner.forEach((poly) => poly.forEach((r) => rings.push(r.map(toAB))));
    if (!rings.length) return { plots: [] };
    let fb0 = Infinity; mp.forEach((poly) => poly[0].forEach((c) => { const b = toAB(c)[1]; if (b < fb0) fb0 = b; }));
    let b0 = Infinity, b1 = -Infinity; rings.forEach((r) => r.forEach((p) => { if (p[1] < b0) b0 = p[1]; if (p[1] > b1) b1 = p[1]; }));
    const app = o.appWidth > 0 ? o.appWidth : w;
    // calage des bandes : sur la ligne tracée (limite entre deux passages), sinon sur les passages comptés
    // à partir du bord du champ
    let anchor;
    if (o.anchor) anchor = toAB(o.anchor)[1];
    else anchor = fb0 + Math.ceil((shrunk || side === 0 ? side : 0) / app - 1e-9) * app;
    const k0 = Math.ceil((b0 - anchor) / w - 1e-9), extra = shrunk ? Math.max(0, head - side) : head;
    const minLen = Math.max(1, o.minLen || 1), maxLen = Math.max(minLen, o.maxLen || minLen), strip = o.design === "bandes";
    const cells = []; let si = 0;
    for (let k = k0; anchor + (k + 1) * w <= b1 + 1e-6; k++) {
      const s0 = anchor + k * w, s1 = s0 + w;
      let runs = this.stripRuns(rings, s0, s1);
      if (!shrunk && side > 0) runs = runs.map((r) => [r[0] + side, r[1] - side]); // sans rétrécissement : marge approchée
      const row = [];
      runs.forEach((r) => {
        const a0 = r[0] + extra, a1 = r[1] - extra, len = a1 - a0;
        if (len < minLen) return;
        let cnt = 1, L = len;
        if (!strip) { cnt = Math.ceil(len / maxLen - 1e-9); if (len / cnt < minLen) cnt = Math.floor(len / minLen + 1e-9); if (cnt < 1) return; L = Math.min(maxLen, len / cnt); }
        const start = a0 + (len - cnt * L) / 2;
        for (let j = 0; j < cnt; j++) row.push({ a0: start + j * L, a1: start + (j + 1) * L, b0: s0, b1: s1, len: L });
      });
      if (!row.length) continue;
      row.forEach((c, j) => { c.strip = si; c.pos = j; cells.push(c); });
      si++;
      if (cells.length > this.MAX_PLOTS) return { plots: [], tooMany: true };
    }
    if (!cells.length) return { plots: [] };
    // ---- répartition des traitements -------------------------------------------------------------------
    const serp = []; // ordre en serpentin, bande par bande
    for (let s = 0; s < si; s++) { const row = cells.filter((c) => c.strip === s); (s % 2 ? row.reverse() : row).forEach((c) => serp.push(c)); }
    const as = this.assign(o.design, nT, serp.map((c) => c.strip), serp.map((c) => c.pos), this.rng(o.seed || 1));
    serp.forEach((c, i) => { c.t = as.t[i]; c.block = as.block[i]; });
    const plots = serp.map((c) => ({ ring: [toXY(c.a0, c.b0), toXY(c.a1, c.b0), toXY(c.a1, c.b1), toXY(c.a0, c.b1), toXY(c.a0, c.b0)], strip: c.strip + 1, pos: c.pos + 1, block: c.block, t: c.t, w, len: c.len }));
    return { plots, strips: si };
  },
  // ---- puissance statistique (calcul direct) ------------------------------------------------------------
  // Rendements : médianes des rendements de référence 2024 de La Financière agricole du Québec (kg/ha).
  // cv : variabilité habituelle entre parcelles d'essai d'un même champ (%), valeur de départ approximative.
  CROPS: [
    { id: "mais-grain", name: "Maïs-grain", yield: 10400, cv: 8 }, { id: "soya", name: "Soya", yield: 3400, cv: 8 },
    { id: "ble", name: "Blé", yield: 2900, cv: 10 }, { id: "orge", name: "Orge", yield: 2800, cv: 10 }, { id: "avoine", name: "Avoine", yield: 2500, cv: 10 },
    { id: "seigle", name: "Seigle", yield: 3100, cv: 10 }, { id: "canola", name: "Canola", yield: 2200, cv: 12 },
    { id: "pois", name: "Pois secs", yield: 1800, cv: 12 }, { id: "haricots", name: "Haricots secs", yield: 1700, cv: 12 }, { id: "sarrasin", name: "Sarrasin", yield: 1200, cv: 12 },
    { id: "mais-fourrager", name: "Maïs fourrager", yield: 15900, cv: 10 }, { id: "foin", name: "Foin", yield: 5000, cv: 15 },
    { id: "pdt", name: "Pommes de terre", yield: 37700, cv: 12 }
  ],
  normCdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp((-x * x) / 2); const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; },
  // quantile de Student à partir du quantile normal z (développement de Cornish-Fisher)
  tFromZ(z, df) { return z + (z * z * z + z) / (4 * df) + (5 * Math.pow(z, 5) + 16 * z * z * z + 3 * z) / (96 * df * df); },
  /*
    Comparaison de chaque traitement au premier (référence), test à 5 % unilatéral (sens de l'effet connu d'avance)
    ou bilatéral (o.sides = 2), analyse de variance classique.
    o : { counts: répétitions par traitement, design, blocks, cv (%), yield (kg/ha, facultatif), effects: [valeurs],
          effectUnit: "pct" | "kg" } -> { df, mddPct, mddKg, rows: [{ effectPct, power, mddPct }] }
  */
  power(o) {
    const counts = o.counts || [], t = counts.length, N = counts.reduce((a, b) => a + b, 0), cv = o.cv;
    if (t < 2 || !(cv > 0) || counts.some((c) => c < 1)) return null;
    let df = N - t;
    if (o.design === "latin") df -= 2 * (t - 1); else if ((o.design === "blocs" || o.design === "bandes") && o.blocks > 1) df -= o.blocks - 1;
    if (df < 1) return { df: 0, rows: [], tooFew: true };
    const two = o.sides === 2, ta = this.tFromZ(two ? 1.959964 : 1.644854, df), tb = this.tFromZ(0.841621, df), y = o.yield > 0 ? o.yield : NaN;
    const se = (i) => cv * Math.sqrt(1 / counts[0] + 1 / counts[i]); // erreur type de la différence, en % du rendement
    const eff = (o.effects || []).filter(Number.isFinite), toPct = (v) => (o.effectUnit === "kg" ? (y > 0 ? (100 * v) / y : NaN) : v);
    const rows = counts.map((c, i) => {
      if (i === 0) return { ref: true };
      // une valeur par traitement comparé ; une seule valeur vaut pour tous
      const raw = eff.length === 1 ? eff[0] : eff.length >= t ? eff[i] : eff.length === t - 1 ? eff[i - 1] : NaN, e = toPct(raw), s = se(i);
      const pw = Number.isFinite(e) ? this.normCdf(Math.abs(e) / s - ta) + (two ? this.normCdf(-Math.abs(e) / s - ta) : 0) : NaN;
      return { effectPct: e, power: pw, mddPct: (ta + tb) * s };
    });
    const worst = Math.max(...rows.filter((r) => !r.ref).map((r) => r.mddPct));
    return { df, rows, mddPct: worst, mddKg: y > 0 ? (worst * y) / 100 : NaN };
  },
  // ---- simulation de l'essai (variabilité spatiale, courbe de réponse) -----------------------------------
  // Courbe de réponse en % du rendement au plateau. x0 : dose optimale ; gain : écart entre la dose 0 et l'optimum.
  curveAt(model, x, x0, gain) {
    if (model === "quad") return -gain * Math.pow((x - x0) / x0, 2);            // parabole, redescend après l'optimum
    const u = Math.min(x, x0);
    if (model === "lin-plateau") return -gain * (1 - u / x0);
    return -gain * Math.pow((u - x0) / x0, 2);                                   // quadratique-plateau
  },
  // Ajustement par moindres carrés pondérés sur les moyennes par dose -> { x0, gain } ou null (non concluant)
  fitCurve(model, doses, means, counts) {
    const n = doses.length, dmax = Math.max(...doses), dmin = Math.min(...doses);
    if (model === "quad") {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
      for (let i = 0; i < n; i++) { const w = counts[i], x = doses[i], y = means[i]; s0 += w; s1 += w * x; s2 += w * x * x; s3 += w * x * x * x; s4 += w * x * x * x * x; t0 += w * y; t1 += w * x * y; t2 += w * x * x * y; }
      const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
      if (Math.abs(det) < 1e-12) return null;
      const b = (s0 * (t1 * s4 - s3 * t2) - t0 * (s1 * s4 - s3 * s2) + s2 * (s1 * t2 - t1 * s2)) / det, c = (s0 * (s2 * t2 - t1 * s3) - s1 * (s1 * t2 - t1 * s2) + t0 * (s1 * s3 - s2 * s2)) / det;
      if (!(c < 0)) return null;
      const x0 = -b / (2 * c);
      return x0 > 0 && x0 <= dmax * 1.5 ? { x0, gain: -c * x0 * x0 } : null;
    }
    const lin = model === "lin-plateau", steps = 120, lo = dmin + (dmax - dmin) * 0.05, hi = dmax * 1.5;
    let best = null;
    for (let k = 0; k <= steps; k++) {
      const x0 = lo + ((hi - lo) * k) / steps;
      let sw = 0, sz = 0, szz = 0, sy = 0, szy = 0, syy = 0;
      for (let i = 0; i < n; i++) { const d = Math.min(doses[i], x0) - x0, z = lin ? d : d * d, w = counts[i], y = means[i]; sw += w; sz += w * z; szz += w * z * z; sy += w * y; szy += w * z * y; syy += w * y * y; }
      const den = sw * szz - sz * sz; if (den < 1e-12) continue;
      const slope = (sw * szy - sz * sy) / den, icpt = (sy - slope * sz) / sw, sse = syy - icpt * sy - slope * szy;
      if (!best || sse < best.sse) best = { sse, x0, slope, k };
    }
    if (!best || best.k === steps) return null;                 // optimum au-delà des doses testées
    if (lin ? !(best.slope > 0) : !(best.slope < 0)) return null; // pas de réponse
    return { x0: best.x0, gain: lin ? best.slope * best.x0 : -best.slope * best.x0 * best.x0 };
  },
  /*
    Tirages de l'essai sur le dispositif réel. sim : { x, y (centres en m), t, strip, block } par parcelle.
    o : { n, cv (%), range (m), frac (part structurée de la variance), design, nT, sides, seed,
          curve: { model, doses, x0, gain (%) } | null }
    Chaque tirage : rendement = [courbe] + variabilité (champ gaussien à corrélation spatiale + bruit de parcelle).
    Avec o.pattern (valeur centrée réduite d'une couche raster par parcelle, NDVI ou relief), la structure
    spatiale est celle de la couche, fixe, et ce sont les traitements qui sont retirés au sort à chaque tirage
    (sim.pos requis), comme on superpose un dispositif à une carte de rendement uniforme.
    -> { n, mddPct, curve: { p10, p50, p90, x0, inconclusive, gain10, gain90 } | null }
  */
  simulate(sim, o) {
    const N = sim.t.length, nT = o.nT, n = Math.max(20, o.n || 500), cv = o.cv, frac = Math.max(0, Math.min(1, o.frac == null ? 0.6 : o.frac));
    if (!N || !(cv > 0) || nT < 2) return null;
    const rnd = this.rng(o.seed || 12345);
    const gauss = () => { let u = 0; while (u < 1e-12) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    // grille du champ aléatoire : bruit blanc lissé par un noyau gaussien (corrélation ~ 5 % à la portée)
    const range = Math.max(5, o.range || 80);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < N; i++) { if (sim.x[i] < x0) x0 = sim.x[i]; if (sim.x[i] > x1) x1 = sim.x[i]; if (sim.y[i] < y0) y0 = sim.y[i]; if (sim.y[i] > y1) y1 = sim.y[i]; }
    const g = Math.max(range / 6, Math.max(x1 - x0, y1 - y0) / 160), sd = (range / (2 * Math.sqrt(3))) / g, rad = Math.max(1, Math.ceil(3 * sd));
    const nx = Math.ceil((x1 - x0) / g) + 1 + 2 * rad, ny = Math.ceil((y1 - y0) / g) + 1 + 2 * rad;
    const ker = []; let k2 = 0; for (let d = -rad; d <= rad; d++) { const v = Math.exp((-d * d) / (2 * sd * sd)); ker.push(v); k2 += v * v; }
    const cell = new Int32Array(N); for (let i = 0; i < N; i++) cell[i] = (Math.round((sim.y[i] - y0) / g) + rad) * nx + Math.round((sim.x[i] - x0) / g) + rad;
    const A = new Float64Array(nx * ny), B = new Float64Array(nx * ny), e = new Float64Array(N);
    // groupes servant à retirer l'effet de bloc (bande pour le carré latin)
    const grp = o.design === "blocs" || o.design === "bandes" ? sim.block : o.design === "latin" ? sim.strip : null;
    let nG = 0; if (grp) for (let i = 0; i < N; i++) if (grp[i] > nG) nG = grp[i];
    const gs = new Float64Array(nG + 1), gc = new Float64Array(nG + 1), ts = new Float64Array(nT), tc = new Float64Array(nT);
    for (let i = 0; i < N; i++) tc[sim.t[i]]++;
    const dS = new Float64Array(nT), dSS = new Float64Array(nT), cur = o.curve && o.curve.doses && o.curve.doses.length === nT ? o.curve : null;
    const base = cur ? cur.doses.map((d) => this.curveAt(cur.model, d, cur.x0, cur.gain)) : null, est = [], gains = [];
    const sf = Math.sqrt(frac), sn = Math.sqrt(1 - frac);
    const pat = o.pattern && o.pattern.length === N && sim.pos ? o.pattern : null, strip0 = pat ? sim.strip.map((v) => v - 1) : null, pos0 = pat ? sim.pos.map((v) => v - 1) : null;
    let T = sim.t;
    for (let it = 0; it < n; it++) {
      if (pat) {
        T = this.assign(o.design, nT, strip0, pos0, rnd).t; tc.fill(0);
        for (let i = 0; i < N; i++) { tc[T[i]]++; e[i] = cv * (sf * pat[i] + sn * gauss()); }
      } else if (frac > 0) {
        for (let i = 0; i < A.length; i++) A[i] = gauss();
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let v = 0; for (let d = -rad; d <= rad; d++) { const xx = x + d; if (xx >= 0 && xx < nx) v += A[y * nx + xx] * ker[d + rad]; } B[y * nx + x] = v; }
        for (let i = 0; i < N; i++) { const c = cell[i], cx = c % nx, cy = (c - cx) / nx; let v = 0; for (let d = -rad; d <= rad; d++) { const yy = cy + d; if (yy >= 0 && yy < ny) v += B[yy * nx + cx] * ker[d + rad]; } e[i] = cv * (sf * (v / k2) + sn * gauss()); }
      } else for (let i = 0; i < N; i++) e[i] = cv * gauss();
      // différences entre traitements sans effet réel : leur dispersion donne la différence détectable
      if (grp) { gs.fill(0); gc.fill(0); for (let i = 0; i < N; i++) { gs[grp[i]] += e[i]; gc[grp[i]]++; } }
      ts.fill(0);
      for (let i = 0; i < N; i++) ts[T[i]] += grp ? e[i] - gs[grp[i]] / gc[grp[i]] : e[i];
      for (let t = 1; t < nT; t++) { const d = ts[t] / tc[t] - ts[0] / tc[0]; dS[t] += d; dSS[t] += d * d; }
      if (cur) {
        ts.fill(0); for (let i = 0; i < N; i++) ts[T[i]] += e[i];
        const f = this.fitCurve(cur.model, cur.doses, Array.from(ts, (v, t) => base[t] + v / tc[t]), Array.from(tc));
        if (f) { est.push(f.x0); gains.push(f.gain); }
      }
    }
    let worst = 0; for (let t = 1; t < nT; t++) { const m = dS[t] / n, v = Math.max(0, dSS[t] / n - m * m); if (Math.sqrt(v) > worst) worst = Math.sqrt(v); }
    const out = { n, pattern: !!pat, mddPct: ((o.sides === 2 ? 1.959964 : 1.644854) + 0.841621) * worst, curve: null };
    if (cur) {
      est.sort((a, b) => a - b); gains.sort((a, b) => a - b);
      const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : NaN);
      out.curve = { x0: cur.x0, p10: q(est, 0.1), p50: q(est, 0.5), p90: q(est, 0.9), gain10: q(gains, 0.1), gain90: q(gains, 0.9), inconclusive: 1 - est.length / n };
    }
    return out;
  },
  ringArea(r) { let a = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; },
  multiArea(mp) { let a = 0; for (const p of mp) { a += Math.abs(this.ringArea(p[0])); for (let i = 1; i < p.length; i++) a -= Math.abs(this.ringArea(p[i])); } return a; },
  /*
    Entités polygonales GeoJSON (WGS84) -> dispositif. grille : pfGrilleGeom (projection, sens du champ).
    opts : { treatments (texte), input, unit, design, appWidth, harvWidth, plotWidth (NaN = conseillée), head, side,
             minLen, maxLen, azimuth (NaN = sens du champ), seed, line: [[lng, lat], [lng, lat]] | null,
             rest (ajouter le reste du champ comme entité), baseRate (dose de base du reste) }
  */
  design(p4, grille, features, opts, tools) {
    const polysLL = [];
    (features || []).forEach((f) => { const g = f && f.geometry; if (!g) return; if (g.type === "Polygon") polysLL.push(g.coordinates); else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => polysLL.push(p)); });
    if (!polysLL.length) return null;
    const c0 = polysLL[0][0][0], def = grille.utmDef(c0[0], c0[1]), fwd = p4("EPSG:4326", def), inv = p4(def, "EPSG:4326");
    const mp = polysLL.map((poly) => poly.map((r) => r.map((c) => fwd.forward([c[0], c[1]]))));
    const auto = grille.fieldAzimuth(mp), azimuth = Number.isFinite(opts.azimuth) ? ((opts.azimuth % 180) + 180) % 180 : auto;
    const tr = this.parseTreatments(opts.treatments), advised = this.plotWidth(opts.appWidth, opts.harvWidth);
    const plotWidth = Number.isFinite(opts.plotWidth) && opts.plotWidth > 0 ? opts.plotWidth : advised;
    const areaHa = this.multiArea(mp) / 10000;
    const base = { azimuth, autoAzimuth: auto, plotWidth, advisedWidth: advised, treatments: tr.list, numeric: tr.numeric, areaHa, features: [], summary: [], trialHa: 0 };
    if (tr.list.length < 2 || !(plotWidth > 0)) return base;
    const res = this.layout(mp, { azimuth, plotWidth, appWidth: opts.appWidth, head: opts.head, side: opts.side, minLen: opts.minLen, maxLen: opts.maxLen, design: opts.design, n: tr.list.length, seed: opts.seed, anchor: opts.line ? fwd.forward(opts.line[0]) : null }, tools);
    if (res.tooMany) return Object.assign(base, { tooMany: true });
    const r1 = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };
    const sum = tr.list.map((t) => ({ label: t.label, color: t.color, count: 0, ha: 0 }));
    base.features = res.plots.map((p, i) => {
      const t = tr.list[p.t], ha = (p.w * p.len) / 10000;
      sum[p.t].count++; sum[p.t].ha += ha; base.trialHa += ha;
      const props = { no: i + 1, nom: "E" + (i + 1), bande: p.strip, rang: p.pos, traitement: t.label };
      if (p.block != null) props.bloc = p.block;
      if (tr.numeric) props.dose = t.value;
      if (opts.input) props.intrant = opts.input;
      if (opts.unit) props.unite = opts.unit;
      Object.assign(props, { largeur_m: r1(p.w, 2), longueur_m: r1(p.len, 1), superficie_ha: r1(ha, 3), couleur: t.color });
      return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [p.ring.map((c) => { const g = inv.forward(c); return [r1(g[0], 7), r1(g[1], 7)]; })] } };
    });
    base.summary = sum; base.strips = res.strips || 0;
    // centres des parcelles (m) pour la simulation ; en carré latin, la bande sert de bloc
    base.sim = { x: res.plots.map((p) => (p.ring[0][0] + p.ring[2][0]) / 2), y: res.plots.map((p) => (p.ring[0][1] + p.ring[2][1]) / 2), t: res.plots.map((p) => p.t), strip: res.plots.map((p) => p.strip), pos: res.plots.map((p) => p.pos), block: res.plots.map((p) => p.block || 0) };
    // reste du champ (bouts, côtés, pointes) : une seule entité, à la dose de base
    if (opts.rest && base.features.length && tools && typeof tools.rest === "function") {
      let rest = [];
      try { rest = tools.rest(mp, res.plots.map((p) => [p.ring])) || []; } catch (e) { rest = []; }
      const ha = this.multiArea(rest) / 10000;
      if (rest.length && ha > 0.0005) {
        const b = String(opts.baseRate || "").trim().replace(",", "."), isNum = /^-?\d+(\.\d+)?$/.test(b), lab = b ? String(opts.baseRate).trim() : "Hors essai";
        const props = { no: 0, nom: "Reste du champ", traitement: lab, hors_essai: 1 };
        if (tr.numeric && isNum) props.dose = parseFloat(b);
        if (opts.input) props.intrant = opts.input;
        if (opts.unit) props.unite = opts.unit;
        Object.assign(props, { superficie_ha: r1(ha, 3), couleur: "#9ca3af" });
        base.features.push({ type: "Feature", properties: props, geometry: { type: "MultiPolygon", coordinates: rest.map((poly) => poly.map((ring) => ring.map((c) => { const g = inv.forward(c); return [r1(g[0], 7), r1(g[1], 7)]; }))) } });
        base.rest = { label: lab, color: "#9ca3af", ha };
      }
    }
    return base;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfEssaiGeom };

if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fr = (v, d) => (Number.isFinite(v) ? v.toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const SRC = "essai-preview-source", FILL = "essai-preview-fill", LINE = "essai-preview-line", LBL = "essai-preview-labels";
  const DIR_SRC = "essai-dir-source", DIR_LINE = "essai-dir-line", DIR_PTS = "essai-dir-points";
  const getP4 = () => window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4) || null;
  const grille = () => (window.pfGrille && window.pfGrille.geom) || null;
  const vm = () => window.vectorManager || null;
  const toast = (msg, err) => { const v = vm(); if (v && typeof v.showToast === "function") v.showToast(msg, err); };
  const state = { features: [], name: "", result: null, timer: null, bound: false, autoAngle: true, autoWidth: true, autoHead: true, autoSide: true, autoOpt: true, line: null, seed: 1, unit: "m" };
  const tools = {
    inward(mp, d) {
      const T = window.pfTampon && window.pfTampon.geom, C = window.ClipperLib;
      if (!T || !C || typeof T.bufferMetric !== "function") throw new Error("tampon indisponible");
      return T.bufferMetric(C, { type: "MultiPolygon", coordinates: mp }, d, { side: "in" });
    },
    // champ moins les parcelles d'essai
    rest(mp, plots) {
      const T = window.pfTampon && window.pfTampon.geom, C = window.ClipperLib;
      if (!T || !C) throw new Error("tampon indisponible");
      return T.fromTree(C, T.clip(C, C.ClipType.ctDifference, T.parts(C, { type: "MultiPolygon", coordinates: mp }).rings, T.parts(C, { type: "MultiPolygon", coordinates: plots }).rings));
    }
  };

  const num = (id) => parseFloat(String(($(id) || {}).value || "").replace(",", "."));
  const k = () => (state.unit === "pi" ? pfEssaiGeom.FT : 1); // facteur vers les mètres
  const setVal = (id, meters) => { const el = $(id); if (el) el.value = Math.round((meters / k()) * 100) / 100; };
  function readOptions() {
    const f = k(), m = (id) => { const v = num(id); return Number.isFinite(v) && v >= 0 ? v * f : NaN; }, angle = num("essai-angle");
    const app = m("essai-app"), harv = m("essai-harv");
    return {
      treatments: ($("essai-treatments") || {}).value || "", input: String(($("essai-input") || {}).value || "").trim().slice(0, 40), unit: String(($("essai-rate-unit") || {}).value || "").trim().slice(0, 20),
      design: ($("essai-design") || {}).value || "latin", appWidth: app, harvWidth: harv,
      plotWidth: state.autoWidth ? NaN : m("essai-width"),
      head: state.autoHead ? 2 * Math.max(app || 0, harv || 0) : m("essai-head") || 0,
      side: state.autoSide ? app || 0 : m("essai-side") || 0,
      minLen: m("essai-min"), maxLen: m("essai-max"), azimuth: state.autoAngle || !Number.isFinite(angle) ? NaN : angle, seed: state.seed, line: state.line,
      rest: !!($("essai-rest") || {}).checked, baseRate: String(($("essai-base") || {}).value || "").trim().slice(0, 30)
    };
  }
  function setNote(text, warn) { const el = $("essai-note"); if (!el) return; el.textContent = text || ""; el.classList.toggle("pf-tp-warn", !!warn); }
  function clearPreview() {
    const map = window.map; if (!map || typeof map.getLayer !== "function") return;
    [LBL, LINE, FILL].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SRC)) map.removeSource(SRC);
  }
  function showPreview(features) {
    const map = window.map; if (!map || typeof map.addSource !== "function") return;
    const data = { type: "FeatureCollection", features };
    if (map.getSource(SRC)) { map.getSource(SRC).setData(data); return; }
    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({ id: FILL, type: "fill", source: SRC, paint: { "fill-color": ["to-color", ["get", "couleur"], "#4477AA"], "fill-opacity": 0.72 } });
    map.addLayer({ id: LINE, type: "line", source: SRC, paint: { "line-color": "#ffffff", "line-width": 1.2 } });
    try {
      map.addLayer({ id: LBL, type: "symbol", source: SRC, minzoom: 14, layout: { "text-field": ["to-string", ["get", "traitement"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": false },
        paint: { "text-color": "#17211b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
    } catch (e) { /* style sans glyphes : pas d'étiquettes */ }
  }
  // puissance : rendement et variabilité de la culture -> plus petite différence détectable
  function powerOf(r) {
    if (!r || !r.summary || !r.summary.length) return null;
    const y = num("essai-yield"), cv = num("essai-cv");
    if (!(cv > 0)) return null;
    const o = readOptions(), blocks = o.design === "bandes" ? Math.ceil((r.strips || 0) / r.summary.length) : o.design === "blocs" ? Math.ceil((r.features.length - (r.rest ? 1 : 0)) / r.summary.length) : 0;
    // en bandes, la répétition est la bande entière
    return pfEssaiGeom.power({ counts: r.summary.map((s) => s.count), design: o.design, blocks, cv, yield: y, sides: ($("essai-sides") || {}).value === "2" ? 2 : 1 });
  }
  function renderPower(r, pw) {
    const el = $("essai-power"); if (!el) return;
    el.classList.remove("pf-tp-warn");
    if (!r || !r.features.length) { el.textContent = ""; return; }
    if (!pw) { el.textContent = "Choisissez une culture ou entrez la variabilité pour estimer ce que l'essai peut détecter."; return; }
    if (pw.tooFew) { el.textContent = "Trop peu de répétitions pour estimer la puissance."; el.classList.add("pf-tp-warn"); return; }
    const kg = Number.isFinite(pw.mddKg) ? ` (${fr(pw.mddKg, 0)} kg/ha)` : "";
    el.textContent = `Plus petite différence détectable 8 fois sur 10 : ${fr(pw.mddPct, 1)} % du rendement${kg}`;
  }
  // ---- simulation (niveau 2) et courbe de réponse ----------------------------------------------------------
  function curveOptions(r) {
    const model = ($("essai-curve") || {}).value || "none";
    if (!r || !r.numeric || r.treatments.length < 3 || model === "none") return null;
    const doses = r.treatments.map((t) => t.value), dmax = Math.max(...doses), y = num("essai-yield");
    let x0 = num("essai-opt"); if (state.autoOpt || !(x0 > 0)) x0 = Math.round(dmax * 0.7 * 10) / 10;
    let gain = num("essai-gain"); if (!(gain > 0)) return null;
    if (($("essai-gain-unit") || {}).value === "kg") { if (!(y > 0)) return null; gain = (100 * gain) / y; }
    return { model, doses, x0, gain };
  }
  function updateCurveUi(r) {
    const box = $("essai-curve-box"), ok = !!(r && r.numeric && r.treatments.length >= 3);
    if (box) box.hidden = !ok;
    const on = ok && ($("essai-curve") || {}).value !== "none";
    document.querySelectorAll("#essai-modal .pf-es-curve-row").forEach((el) => { el.hidden = !on; });
    if (on && state.autoOpt) { const o = $("essai-opt"); if (o) o.value = Math.round(Math.max(...r.treatments.map((t) => t.value)) * 0.7 * 10) / 10; }
    const b = $("btn-essai-auto-opt"); if (b) b.classList.toggle("pf-on", state.autoOpt);
    const rg = $("essai-range"); if (rg) rg.disabled = !!($("essai-pattern") || {}).value;
  }
  // ---- structure spatiale tirée d'une couche raster (NDVI enregistré, relief) --------------------------------
  const pat = { cache: new Map(), ctl: null };
  function featBbox() {
    let b = null;
    const scan = (c) => { if (typeof c[0] === "number") { b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])] : [c[0], c[1], c[0], c[1]]; } else c.forEach(scan); };
    state.features.forEach((f) => scan(f.geometry.coordinates));
    return b;
  }
  function ndviDefs() {
    const zm = window.zonesManager; if (!zm || typeof zm.savedNdvi !== "function") return [];
    const keep = zm.geomBbox; let list = [];
    try { zm.geomBbox = featBbox(); list = zm.savedNdvi() || []; } catch (e) { list = []; }
    zm.geomBbox = keep;
    return list;
  }
  function fillPatterns() {
    const sel = $("essai-pattern"); if (!sel) return;
    const cur = sel.value; state.ndvi = ndviDefs();
    sel.innerHTML = "";
    const add = (v, t, raw) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (raw) o.setAttribute("data-no-i18n", ""); sel.appendChild(o); };
    add("", "Aléatoire (portée)"); add("relief", "Relief (altitude)");
    state.ndvi.forEach((d) => add(d.key, d.label + (d.landsat ? " · Landsat" : ""), true));
    sel.value = Array.from(sel.options).some((o) => o.value === cur) ? cur : "";
  }
  // valeur d'une grille (nord en haut) au point x, y de son emprise
  const gridAt = (g, bb, x, y) => { const c = Math.floor(((x - bb[0]) / (bb[2] - bb[0])) * g.w), r = Math.floor(((bb[3] - y) / (bb[3] - bb[1])) * g.h); return c >= 0 && c < g.w && r >= 0 && r < g.h ? g.data[r * g.w + c] : NaN; };
  // Moyenne de la couche dans chaque parcelle d'essai (5 points le long de la parcelle), centrée réduite
  async function loadPattern(key, r) {
    const zm = window.zonesManager, b = featBbox(); if (!b) throw new Error("emprise");
    const mx = (b[2] - b[0]) * 0.03, my = (b[3] - b[1]) * 0.03, bbox = [b[0] - mx, b[1] - my, b[2] + mx, b[3] + my], ck = key + "|" + bbox.map((v) => v.toFixed(5)).join(",");
    let src = pat.cache.get(ck);
    if (!src) {
      if (pat.ctl) pat.ctl.abort();
      pat.ctl = new AbortController();
      if (key === "relief") {
        const reg = zm && typeof zm.readDem === "function" ? await zm.readDem(bbox, 512, pat.ctl.signal) : null;
        if (!reg) throw new Error("Pas de relief lisible pour cette parcelle.");
        const p4 = getP4(), fwd = p4("EPSG:4326", reg.projection);
        src = { at: (lng, lat) => { const q = fwd.forward([lng, lat]), v = gridAt({ data: reg.data, w: reg.width, h: reg.height }, reg.sourceBBox, q[0], q[1]); return v > -1000 && v < 9000 ? v : NaN; } };
      } else {
        const def = (state.ndvi || []).find((d) => d.key === key);
        if (!def || !zm || typeof zm.fetchNdvi !== "function") throw new Error("Cette tuile NDVI n'est plus disponible.");
        const lat = (bbox[1] + bbox[3]) / 2, wM = (bbox[2] - bbox[0]) * 111320 * Math.cos((lat * Math.PI) / 180), hM = (bbox[3] - bbox[1]) * 111132;
        const g = await zm.fetchNdvi(def, bbox, wM, hM, pat.ctl.signal);
        src = { at: (lng, lat2) => gridAt(g, bbox, lng, lat2) };
      }
      pat.cache.set(ck, src); if (pat.cache.size > 6) pat.cache.delete(pat.cache.keys().next().value);
    }
    const plots = r.features.filter((f) => !f.properties.hors_essai), vals = new Float64Array(plots.length); let sum = 0, cnt = 0;
    plots.forEach((f, i) => {
      const c = f.geometry.coordinates[0], a = [(c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2], e = [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2];
      let s = 0, n = 0;
      [0.1, 0.3, 0.5, 0.7, 0.9].forEach((t) => { const v = src.at(a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t); if (Number.isFinite(v)) { s += v; n++; } });
      vals[i] = n ? s / n : NaN; if (n) { sum += vals[i]; cnt++; }
    });
    if (cnt < plots.length * 0.5 || cnt < 4) throw new Error("La couche ne couvre pas assez de parcelles d'essai (nuages ou absence de données).");
    const mean = sum / cnt; let ss = 0; vals.forEach((v) => { if (Number.isFinite(v)) ss += (v - mean) * (v - mean); });
    const sd = Math.sqrt(ss / cnt); if (!(sd > 1e-9)) throw new Error("La couche est uniforme dans cet essai : elle ne peut pas servir de structure spatiale.");
    return Array.from(vals, (v) => (Number.isFinite(v) ? (v - mean) / sd : 0));
  }
  function clearSim() { const el = $("essai-sim"); if (el) { el.textContent = ""; el.classList.remove("pf-tp-warn"); } }
  async function runSim() {
    const r = state.result, el = $("essai-sim"); if (!el) return;
    el.classList.remove("pf-tp-warn");
    const cv = num("essai-cv"), y = num("essai-yield"), range = num("essai-range");
    if (!r || !r.sim || !r.features.length) { el.textContent = ""; return; }
    if (!(cv > 0)) { el.textContent = "Choisissez une culture ou entrez la variabilité avant de simuler."; el.classList.add("pf-tp-warn"); return; }
    const o = readOptions(), cur = curveOptions(r), wantCurve = r.numeric && r.treatments.length >= 3 && ($("essai-curve") || {}).value !== "none";
    if (wantCurve && !cur) { el.textContent = "Entrez le gain de rendement attendu (et le rendement espéré s'il est en kg/ha) pour simuler la courbe de réponse."; el.classList.add("pf-tp-warn"); return; }
    const pkey = ($("essai-pattern") || {}).value || "", psel = $("essai-pattern"), plabel = pkey && psel ? psel.options[psel.selectedIndex].textContent : "";
    let pattern = null;
    if (pkey) {
      const btn = $("btn-essai-sim"); if (btn) btn.disabled = true;
      el.textContent = "Lecture de la couche…";
      try { pattern = await loadPattern(pkey, r); }
      catch (e) { if (btn) btn.disabled = false; if (state.result !== r) return; el.textContent = (e && e.message) || "Lecture de la couche impossible."; el.classList.add("pf-tp-warn"); return; }
      if (btn) btn.disabled = false;
      if (state.result !== r) { el.textContent = ""; return; } // le dispositif a changé pendant la lecture
    }
    let res = null;
    try { res = pfEssaiGeom.simulate(r.sim, { n: 500, cv, range: range > 0 ? range * k() : 80, frac: 0.6, design: o.design, nT: r.treatments.length, sides: ($("essai-sides") || {}).value === "2" ? 2 : 1, seed: (state.seed * 7919 + 13) >>> 0, curve: cur, pattern }); } catch (e) { console.error("Simulation de l'essai :", e); }
    if (!res) { el.textContent = "Simulation impossible."; el.classList.add("pf-tp-warn"); return; }
    // résultat en lignes courtes : un titre, d'où vient la variabilité, puis une ligne par question
    const line = (t, cls, raw) => { const sp = document.createElement("span"); sp.className = "pf-es-sim-line" + (cls ? " " + cls : ""); sp.textContent = t; if (raw) { const nm = document.createElement("span"); nm.setAttribute("data-no-i18n", ""); nm.textContent = " " + raw; sp.appendChild(nm); } el.appendChild(sp); };
    el.textContent = "";
    line(`Résultat de ${res.n} essais simulés sur ce champ`, "pf-es-sim-title");
    if (res.pattern) line("Variabilité du champ selon la couche :", "pf-es-sim-sub", plabel);
    else line(`Variabilité du champ tirée au hasard, en taches d'environ ${fr(range > 0 ? range : 80, 0)} ${state.unit === "pi" ? "pi" : "m"}`, "pf-es-sim-sub");
    line(y > 0 ? `Écart entre deux traitements : l'essai le détecte 8 fois sur 10 s'il atteint ${fr((res.mddPct * y) / 100, 0)} kg/ha (${fr(res.mddPct, 1)} % du rendement).` : `Écart entre deux traitements : l'essai le détecte 8 fois sur 10 s'il atteint ${fr(res.mddPct, 1)} % du rendement.`, "pf-es-sim-item");
    if (res.curve) {
      const c = res.curve, u = o.unit ? " " + o.unit : "", d = (v) => fr(v, Math.abs(c.x0) < 20 ? 1 : 0) + u;
      if (c.inconclusive > 0.5 || !Number.isFinite(c.p50)) { line(`Dose optimale : dans ${fr(100 * c.inconclusive, 0)} % des cas, l'essai ne permettrait pas de la trouver.`, "pf-es-sim-item pf-es-low"); }
      else {
        line(`Dose optimale : si la vraie valeur est ${d(c.x0)}, l'essai l'estimerait entre ${d(c.p10)} et ${d(c.p90)}, 8 fois sur 10.`, "pf-es-sim-item");
        if (c.inconclusive >= 0.05) line(`Dans ${fr(100 * c.inconclusive, 0)} % des cas, l'essai ne permettrait pas de trouver la dose optimale.`, "pf-es-sim-item pf-es-low");
      }
    }
  }
  function renderLegend(r, pw) {
    const el = $("essai-legend"); if (!el) return;
    el.innerHTML = "";
    const rows = r && r.summary ? r.summary.slice() : [];
    if (r && r.rest) rows.push({ label: r.rest.label, color: r.rest.color, ha: r.rest.ha, rest: true });
    rows.forEach((s) => {
      const row = document.createElement("div"); row.className = "pf-es-leg";
      const sw = document.createElement("i"); sw.style.background = s.color;
      const name = document.createElement("span"); name.setAttribute("data-no-i18n", ""); name.textContent = s.label;
      const val = document.createElement("span"); val.className = "pf-es-leg-n"; val.textContent = s.rest ? `reste du champ · ${fr(s.ha, 2)} ha` : `${s.count} × · ${fr(s.ha, 2)} ha`;
      row.append(sw, name, val); el.appendChild(row);
    });
  }

  function compute() {
    const save = $("btn-essai-save"), exp = $("btn-essai-export"), o = readOptions(), p4 = getP4(), G = grille();
    state.result = null;
    if (save) save.disabled = true;
    if (exp) exp.disabled = true;
    const baseEl = $("essai-base"); if (baseEl) baseEl.disabled = !o.rest;
    const lenRow = $("essai-len-row"); if (lenRow) lenRow.classList.toggle("pf-es-off", o.design === "bandes");
    if (!p4 || !G) { setNote("Module de projection indisponible.", true); return; }
    // champs en mode automatique : valeurs déduites des largeurs d'équipement
    if (state.autoHead) setVal("essai-head", o.head);
    if (state.autoSide) setVal("essai-side", o.side);
    ["width", "head", "side"].forEach((n) => { const b = $("btn-essai-auto-" + n); if (b) b.classList.toggle("pf-on", state["auto" + n[0].toUpperCase() + n.slice(1)]); });
    if (!(o.appWidth > 0)) { clearPreview(); renderLegend(null); renderPower(null); updateCurveUi(null); clearSim(); setNote("Entrez la largeur de l'applicateur.", true); return; }
    if (!(o.minLen > 0) || !(o.maxLen >= o.minLen)) { clearPreview(); renderLegend(null); renderPower(null); updateCurveUi(null); clearSim(); setNote("La longueur maximale doit être au moins égale à la longueur minimale.", true); return; }
    let r = null;
    try { r = pfEssaiGeom.design(p4, G, state.features, o, tools); } catch (e) { console.error("Essai à la ferme :", e); }
    if (!r) { clearPreview(); renderLegend(null); renderPower(null); updateCurveUi(null); clearSim(); setNote("Calcul impossible pour cette géométrie.", true); return; }
    if (state.autoWidth) setVal("essai-width", r.plotWidth);
    const angle = $("essai-angle"), auto = $("btn-essai-auto");
    if (state.autoAngle && angle) angle.value = r.azimuth;
    if (auto) auto.classList.toggle("pf-on", state.autoAngle);
    const wi = $("essai-width-info");
    if (wi) { const passes = r.plotWidth / o.appWidth, hp = o.harvWidth > 0 ? r.plotWidth / o.harvWidth : NaN; wi.textContent = `Parcelles de ${fr(r.plotWidth, 1)} m : ${fr(passes, passes % 1 ? 1 : 0)} passage(s) d'applicateur` + (Number.isFinite(hp) ? `, ${fr(hp, hp % 1 ? 1 : 0)} de récolteuse` : ""); }
    if (r.treatments.length < 2) { clearPreview(); renderLegend(null); renderPower(null); updateCurveUi(null); clearSim(); setNote("Entrez au moins deux traitements, séparés par des virgules.", true); return; }
    if (r.tooMany) { clearPreview(); renderLegend(null); renderPower(null); updateCurveUi(null); clearSim(); setNote("Trop de parcelles : augmentez la largeur ou la longueur des parcelles.", true); return; }
    if (!r.features.length) { clearPreview(); renderLegend(null); renderPower(null); updateCurveUi(null); clearSim(); setNote("Aucune parcelle d'essai ne tient dans le champ avec ces dimensions.", true); return; }
    state.result = r;
    const pw = powerOf(r);
    showPreview(r.features); renderLegend(r, pw); renderPower(r, pw); updateCurveUi(r); clearSim();
    const reps = Math.min(...r.summary.map((s) => s.count));
    const nPlots = r.features.length - (r.rest ? 1 : 0);
    setNote(`${nPlots} parcelles d'essai sur ${r.strips} bande(s) · ${fr(r.trialHa, 1)} ha en essai (${fr((100 * r.trialHa) / r.areaHa, 0)} % du champ) · au moins ${reps} répétition(s) par traitement`, reps < 2);
    if (save) save.disabled = false;
    if (exp) exp.disabled = false;
  }
  function fillCrops() {
    const sel = $("essai-crop"); if (!sel || sel.options.length > 1) return;
    pfEssaiGeom.CROPS.forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
    const other = document.createElement("option"); other.value = "autre"; other.textContent = "Autre"; sel.appendChild(other);
  }
  function pickCrop() {
    const id = ($("essai-crop") || {}).value, c = pfEssaiGeom.CROPS.find((x) => x.id === id), y = $("essai-yield"), cv = $("essai-cv");
    if (c) { if (y) y.value = c.yield; if (cv) cv.value = c.cv; } else if (id === "autre") { if (y) y.value = ""; if (cv && !cv.value) cv.value = 10; }
  }
  function schedule() { clearTimeout(state.timer); state.timer = setTimeout(compute, 180); }

  // ---- sens des passages tracé sur la carte : deux clics le long d'un passage ------------------------
  const draw = { on: false, p1: null, down: null, handlers: null };
  function dirData(p2) {
    const f = [];
    if (draw.p1) f.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: draw.p1 } });
    if (draw.p1 && p2) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [draw.p1, p2] } });
    return { type: "FeatureCollection", features: f };
  }
  function showDir(p2) {
    const map = window.map; if (!map || typeof map.addSource !== "function") return;
    if (map.getSource(DIR_SRC)) { map.getSource(DIR_SRC).setData(dirData(p2)); return; }
    map.addSource(DIR_SRC, { type: "geojson", data: dirData(p2) });
    map.addLayer({ id: DIR_LINE, type: "line", source: DIR_SRC, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#17211b", "line-width": 3, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: DIR_PTS, type: "circle", source: DIR_SRC, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#17211b", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  }
  function clearDir() {
    const map = window.map; if (!map || typeof map.getLayer !== "function") return;
    [DIR_PTS, DIR_LINE].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(DIR_SRC)) map.removeSource(DIR_SRC);
  }
  function lngLatAt(e) {
    const map = window.map, r = map.getContainer().getBoundingClientRect(), ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    return [ll.lng, ll.lat];
  }
  function stopLine() {
    if (!draw.on) return;
    const map = window.map, c = map && map.getContainer ? map.getContainer() : null;
    if (c && draw.handlers) { c.removeEventListener("click", draw.handlers.click, true); c.removeEventListener("mousedown", draw.handlers.down, true); c.removeEventListener("mousemove", draw.handlers.move, true); }
    if (draw.handlers) document.removeEventListener("keydown", draw.handlers.key, true);
    if (map && map.getCanvas) map.getCanvas().style.cursor = "";
    draw.on = false; draw.p1 = null; draw.handlers = null;
    clearDir();
    const btn = $("btn-essai-draw"); if (btn) { btn.textContent = "Tracer un passage sur la carte"; btn.classList.remove("pf-on"); }
  }
  function startLine() {
    const map = window.map;
    if (draw.on) { stopLine(); compute(); return; }
    if (!map || typeof map.getContainer !== "function") return;
    draw.on = true; draw.p1 = null;
    const btn = $("btn-essai-draw"); if (btn) { btn.textContent = "Annuler le tracé"; btn.classList.add("pf-on"); }
    setNote("Cliquez sur la carte le début d'un passage, puis sa fin.");
    map.getCanvas().style.cursor = "crosshair";
    const h = draw.handlers = {
      down: (e) => { draw.down = [e.clientX, e.clientY]; },
      move: (e) => { if (draw.p1) showDir(lngLatAt(e)); },
      key: (e) => { if (e.key === "Escape") { e.stopPropagation(); stopLine(); compute(); } },
      click: (e) => {
        if (e.target && e.target.closest && e.target.closest(".maplibregl-ctrl, .maplibregl-popup")) return;
        e.stopPropagation(); e.preventDefault();
        if (draw.down && Math.hypot(e.clientX - draw.down[0], e.clientY - draw.down[1]) > 6) return;
        const p = lngLatAt(e);
        if (!draw.p1) { draw.p1 = p; showDir(null); setNote("Cliquez maintenant la fin du passage."); return; }
        const az = window.pfGrille ? window.pfGrille.azimuthOf(draw.p1, p) : NaN;
        if (!Number.isFinite(az)) { setNote("Les deux points sont trop proches : cliquez plus loin.", true); return; }
        const angle = $("essai-angle"); if (angle) angle.value = az;
        state.autoAngle = false; state.line = [draw.p1, p]; // les bandes sont calées sur cette ligne
        stopLine();
        compute();
      }
    };
    const c = map.getContainer();
    c.addEventListener("click", h.click, true); c.addEventListener("mousedown", h.down, true); c.addEventListener("mousemove", h.move, true);
    document.addEventListener("keydown", h.key, true);
  }

  function close() {
    stopLine();
    clearTimeout(state.timer); clearPreview();
    const modal = $("essai-modal"); if (modal) modal.classList.remove("active");
    state.features = []; state.result = null; state.line = null;
  }
  function collection() {
    const r = state.result, o = readOptions();
    const extra = { parcelle: state.name, dispositif: ({ latin: "carré latin", blocs: "blocs aléatoires", aleatoire: "aléatoire", bandes: "bandes" })[o.design] || o.design, angle_deg: r.azimuth };
    return { type: "FeatureCollection", features: r.features.map((f) => ({ type: "Feature", properties: Object.assign({}, f.properties, extra), geometry: f.geometry })) };
  }
  function label() { const o = readOptions(); return `Essai ${o.input || "à la ferme"} · ${state.name}`; }
  function save() {
    const v = vm(), r = state.result;
    if (!r || !r.features.length) return;
    if (!v || typeof v.createLayerFromCollection !== "function") { setNote("« Mes données » n'est pas disponible : utilisez Exporter GeoJSON.", true); return; }
    const folderId = typeof v.ensureFolderPath === "function" ? v.ensureFolderPath(["Essais"], null) : null;
    const folder = folderId && typeof v.getFolder === "function" ? v.getFolder(folderId) : null;
    if (folder) folder.collapsed = false;
    const fc = collection(), name = label(), fields = [...new Set(fc.features.flatMap((f) => Object.keys(f.properties)))].map((n) => ({ name: n, label: n }));
    const layer = v.createLayerFromCollection(fc, name, folderId, { geometryType: "Polygon", visible: true, fields,
      style: { fillColor: "#4477AA", fillOpacity: 0.7, strokeColor: "#ffffff", strokeWidth: 1.2, strokeStyle: "solid", markerShape: "circle", markerSize: 8, labelProperty: "traitement", colorProperty: "couleur" } });
    if (!layer) { setNote("Enregistrement impossible.", true); return; }
    if (typeof v.markDirty === "function") v.markDirty(layer);
    if (typeof v.renderLayersList === "function") v.renderLayersList();
    const count = r.features.length - (r.rest ? 1 : 0);
    close();
    toast(`Essai de ${count} parcelles enregistré dans Mes données › Essais › ${name}`);
  }
  function exportGeoJson() {
    if (!state.result || !state.result.features.length) return;
    const blob = new Blob([JSON.stringify(collection())], { type: "application/geo+json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `essai_${state.name.replace(/[^\w\-]+/g, "_").slice(0, 40)}_${state.result.features.length - (state.result.rest ? 1 : 0)}parcelles.geojson`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  // changement d'unité (mètres <-> pieds) : les valeurs saisies sont converties
  function switchUnit() {
    const next = ($("essai-units") || {}).value === "pi" ? "pi" : "m";
    if (next === state.unit) return;
    const f = next === "pi" ? 1 / pfEssaiGeom.FT : pfEssaiGeom.FT;
    ["essai-app", "essai-harv", "essai-width", "essai-head", "essai-side", "essai-min", "essai-max", "essai-range"].forEach((id) => { const el = $(id), v = num(id); if (el && Number.isFinite(v)) el.value = Math.round(v * f * (next === "pi" ? 1 : 100)) / (next === "pi" ? 1 : 100); });
    state.unit = next;
    document.querySelectorAll("#essai-modal .pf-es-u").forEach((el) => { el.textContent = next === "pi" ? "pi" : "m"; });
  }

  function bind() {
    if (state.bound) return; state.bound = true;
    const modal = $("essai-modal"); if (!modal) return;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("btn-essai-close", "click", close);
    on("btn-essai-cancel", "click", close);
    on("btn-essai-save", "click", save);
    on("btn-essai-export", "click", exportGeoJson);
    on("btn-essai-auto", "click", () => { stopLine(); state.autoAngle = true; state.line = null; compute(); });
    on("btn-essai-draw", "click", startLine);
    on("btn-essai-shuffle", "click", () => { state.seed = (Math.floor(Math.random() * 1e9) + 1) >>> 0; compute(); });
    on("essai-angle", "input", () => { state.autoAngle = false; state.line = null; });
    on("essai-width", "input", () => { state.autoWidth = false; });
    on("essai-head", "input", () => { state.autoHead = false; });
    on("essai-side", "input", () => { state.autoSide = false; });
    on("btn-essai-auto-width", "click", () => { state.autoWidth = true; compute(); });
    on("btn-essai-auto-head", "click", () => { state.autoHead = true; compute(); });
    on("btn-essai-auto-side", "click", () => { state.autoSide = true; compute(); });
    on("essai-units", "change", switchUnit);
    fillCrops();
    on("essai-crop", "change", pickCrop);
    on("essai-opt", "input", () => { state.autoOpt = false; });
    on("btn-essai-auto-opt", "click", () => { state.autoOpt = true; compute(); });
    on("btn-essai-sim", "click", () => { clearTimeout(state.timer); compute(); runSim(); });
    modal.addEventListener("input", schedule);
    modal.addEventListener("change", schedule);
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); if (draw.on) { stopLine(); compute(); } else close(); } });
  }

  // features : polygones GeoJSON ; name : nom repris dans la couche enregistrée
  function open(opts) {
    const feats = ((opts && opts.features) || []).filter((f) => f && f.geometry && /Polygon$/.test(f.geometry.type));
    if (!feats.length) { toast("La planification d'essai demande un polygone.", true); return; }
    const modal = $("essai-modal"); if (!modal) return;
    bind();
    state.features = feats; state.name = String((opts && opts.name) || "Parcelle").slice(0, 80); state.result = null; state.autoAngle = true; state.line = null;
    const src = $("essai-source"); if (src) src.textContent = state.name;
    modal.classList.add("active");
    fillPatterns();
    compute();
  }
  function openForParcel(feature) {
    if (!feature || !feature.geometry) return;
    let parcel = feature;
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") { try { parcel = window.terrain3DManager.assembleParcelFeature(feature) || feature; } catch (e) { parcel = feature; } }
    const p = parcel.properties || {}, pid = p.IDPAR || p.idpar, lot = p.NO_LOT || p.no_lot;
    open({ features: [{ type: "Feature", properties: {}, geometry: parcel.geometry }], name: p.nom || p.name || (pid ? `Parcelle nº ${pid}` : lot ? `Lot nº ${lot}` : "Parcelle") });
  }

  window.pfEssai = { open, openForParcel, close, geom: pfEssaiGeom };
})();
