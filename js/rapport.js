/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Rapport de parcelle
  -------------------
  pfRapport.openForParcel(feature) : rassemble ce que l'application sait de la parcelle (relief LiDAR, sols,
  végétation satellite, climat de la saison, historique des cultures) et le présente en pages au format lettre :
  aperçu à l'écran, impression / PDF par le navigateur, ou fichier HTML autonome.

  - Le rapport présente de l'information, sans diagnostic ni recommandation : des chiffres, des cartes et des faits.
  - Une page croise la stabilité du NDVI avec les autres couches (élévation, pente, position dans le relief,
    distance au bord, unité de sol) : corrélations de rang, moyennes par groupe. Une corrélation n'est pas une cause.
  - Tout est calculé dans le navigateur ; chaque section est indépendante : une donnée absente (hors Québec, service
    en panne) donne une section « non disponible », jamais un rapport bloqué.
  - Les cartes sont dessinées par une carte MapLibre hors écran, de taille fixe : la carte de l'utilisateur ne bouge
    pas et les images sont les mêmes quel que soit l'écran.
  - pfRapportCore ne touche pas au DOM (calculs, faits, mise en pages) : il se teste hors du navigateur.
*/
const pfRapportCore = {
  SLOPE_CLASSES: [ // mêmes classes et mêmes couleurs que la couche « Pentes » de la carte (js/topo.js)
    { max: 0.3, label: "0 à 0,3 %", note: "plat", color: "#0284c7" },
    { max: 1, label: "0,3 à 1 %", note: "très faible", color: "#22c55e" },
    { max: 3, label: "1 à 3 %", note: "faible", color: "#84cc16" },
    { max: 10, label: "3 à 10 %", note: "modérée", color: "#eab308" },
    { max: 30, label: "10 à 30 %", note: "forte", color: "#ea580c" },
    { max: Infinity, label: "Plus de 30 %", note: "très forte", color: "#b91c1c" }
  ],
  // Géomorphons (Jasiewicz et Stepinski, 2013) : dix formes de relief ; couleurs de la légende d'usage
  FORMS: [
    { code: "FL", label: "Terrain plat", color: "#dcdcdc" }, { code: "PK", label: "Butte", color: "#380000" }, { code: "RI", label: "Crête", color: "#c80000" },
    { code: "SH", label: "Haut de pente", color: "#ff5014" }, { code: "SP", label: "Bosse", color: "#fad23c" }, { code: "SL", label: "Pente", color: "#ffff3c" },
    { code: "HL", label: "Creux de pente", color: "#b4e614" }, { code: "FS", label: "Bas de pente", color: "#3cfa96" }, { code: "VL", label: "Coulée", color: "#0000ff" }, { code: "PT", label: "Cuvette (baissière)", color: "#000038" }
  ],
  // forme selon le nombre de directions où le terrain voisin est plus bas (ligne) et plus haut (colonne)
  FORM_TABLE: ["FL FL FL FS FS VL VL VL PT", "FL FL FS FS FS VL VL VL", "FL SH SL SL HL HL VL", "SH SH SL SL SL HL", "SH SH SP SL SL", "RI RI SP SP", "RI RI RI", "RI RI", "PK"].map((r) => r.split(" ")),
  STAB_ORDER: ["toujours-bien", "generalement-bien", "variable", "generalement-mauvais", "toujours-mauvais"],
  esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  fr(v, d) { if (!Number.isFinite(v)) return "–"; const k = Math.pow(10, d || 0), r = Math.round(v * k) / k; return (r === 0 ? 0 : r).toLocaleString("fr-CA", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); },
  MONTHS: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  day(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${+m[3]} ${this.MONTHS[+m[2] - 1]}` : "–"; },
  // ---- géométrie (longitude / latitude) ----
  polys(geom) { return !geom ? [] : geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : []; },
  bbox(geom) { let b = [Infinity, Infinity, -Infinity, -Infinity]; this.polys(geom).forEach((p) => p[0].forEach((c) => { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; })); return b; },
  areaHa(geom) {
    const b = this.bbox(geom), lat0 = ((b[1] + b[3]) / 2) * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110574; let a = 0;
    this.polys(geom).forEach((p) => p.forEach((ring, ri) => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky); a += (ri === 0 ? 1 : -1) * Math.abs(s) / 2; }));
    return a / 10000;
  },
  inRing(pt, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; },
  inGeom(pt, polys) { return polys.some((p) => this.inRing(pt, p[0]) && !p.slice(1).some((h) => this.inRing(pt, h))); },
  // ---- relief : pente (%) par différences centrées sur un MNT légèrement lissé ----
  smooth(z, W, H) {
    const out = new Float32Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { let s = 0, n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue; const v = z[rr * W + cc]; if (v === v) { s += v; n++; } } out[r * W + c] = n ? s / n : NaN; }
    return out;
  },
  slope(z, W, H, res) {
    const s = new Float32Array(W * H).fill(NaN);
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) { const i = r * W + c, dx = (z[i + 1] - z[i - 1]) / (2 * res), dy = (z[i - W] - z[i + W]) / (2 * res); if (dx === dx && dy === dy) s[i] = 100 * Math.sqrt(dx * dx + dy * dy); }
    return s;
  },
  /*
    Géomorphons : dans huit directions, on compare l'angle de la ligne de visée la plus haute et la plus basse jusqu'à
    « search » mètres ; chaque direction est notée plus haute, plus basse ou égale (à « flat » degrés près), et le
    motif des huit notes donne la forme. -> Uint8Array d'indices dans FORMS (255 = sans valeur)
  */
  geomorphons(z, W, H, res, opts) {
    const o = opts || {}, L = Math.max(2, Math.round((o.search || 50) / res)), skip = Math.max(1, Math.round((o.skip || 0) / res)), flat = ((o.flat === undefined ? 0.5 : o.flat) * Math.PI) / 180;
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], idx = new Map(this.FORMS.map((f, i) => [f.code, i])), out = new Uint8Array(W * H).fill(255);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const z0 = z[r * W + c]; if (z0 !== z0) continue;
      let plus = 0, minus = 0, seen = 0;
      for (let d = 0; d < 8; d++) {
        const dc = dirs[d][0], dr = dirs[d][1], step = res * (dc && dr ? Math.SQRT2 : 1); let hi = -Infinity, lo = Infinity;
        for (let k = skip; k <= L; k++) { const cc = c + dc * k, rr = r + dr * k; if (cc < 0 || rr < 0 || cc >= W || rr >= H) break; const v = z[rr * W + cc]; if (v !== v) break; const a = Math.atan2(v - z0, k * step); if (a > hi) hi = a; if (a < lo) lo = a; }
        if (hi === -Infinity) continue; seen++;
        const delta = hi + lo; // angle au-dessus de l'horizon moins angle en dessous
        if (delta > flat) plus++; else if (delta < -flat) minus++;
      }
      if (seen < 6) continue; // trop près du bord de la grille
      out[r * W + c] = idx.get(this.FORM_TABLE[minus][plus]);
    }
    return out;
  },
  relief(dem, W, H, res, mask) {
    const z = this.smooth(this.smooth(dem, W, H), W, H), sl = this.slope(z, W, H, res), vals = [], elev = [], counts = this.SLOPE_CLASSES.map(() => 0); let n = 0, sum = 0;
    for (let i = 0; i < W * H; i++) { if (!mask[i]) continue; if (z[i] === z[i]) elev.push(z[i]); const v = sl[i]; if (v !== v) continue; n++; sum += v; vals.push(v); counts[this.SLOPE_CLASSES.findIndex((k) => v < k.max)]++; }
    if (n < 20 || elev.length < 20) return null;
    elev.sort((a, b) => a - b); vals.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
    const geo = this.geomorphons(z, W, H, res), gc = this.FORMS.map(() => 0); let gn = 0; for (let i = 0; i < W * H; i++) if (mask[i] && geo[i] !== 255) { gc[geo[i]]++; gn++; }
    const forms = gn ? this.FORMS.map((fm, i) => ({ code: fm.code, label: fm.label, color: fm.color, share: gc[i] / gn })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share) : [];
    return { z, slope: sl, geo, forms, n, mean: sum / n, median: q(vals, 0.5), p90: q(vals, 0.9), zMin: q(elev, 0.01), zMax: q(elev, 0.99), zMean: elev.reduce((a, b) => a + b, 0) / elev.length,
      classes: this.SLOPE_CLASSES.map((k, i) => ({ label: k.label, note: k.note, color: k.color, share: counts[i] / n })) };
  },
  // ---- cultures ----
  rotation(history) {
    const h = (history || []).filter((x) => x && x.year && x.crop).sort((a, b) => b.year - a.year);
    if (!h.length) return null;
    const recent = h.slice(0, 6), tally = new Map(); recent.forEach((x) => tally.set(x.crop, (tally.get(x.crop) || 0) + 1));
    let run = 1, best = { crop: h[0].crop, n: 1 }; for (let i = 1; i < h.length; i++) { if (h[i].crop === h[i - 1].crop && h[i - 1].year - h[i].year === 1) { run++; if (run > best.n) best = { crop: h[i].crop, n: run }; } else run = 1; }
    const top = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0];
    return { history: h, recent, distinct: tally.size, top: { crop: top[0], n: top[1] }, longest: best, first: h[h.length - 1].year, last: h[0].year };
  },
  // ---- statistiques pour le croisement des couches ----
  ranks(v) { const idx = v.map((x, i) => i).sort((a, b) => v[a] - v[b]), r = new Float64Array(v.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++; const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k]] = m; i = j + 1; } return r; },
  pearson(a, b) { const n = a.length; if (n < 3) return NaN; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; } return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN; },
  spearman(x, y) { return this.pearson(this.ranks(x), this.ranks(y)); },
  // part de la variance de y expliquée par les colonnes de X ensemble (régression linéaire ; NaN si le système est dégénéré)
  r2(cols, y) {
    const n = y.length, p = cols.length; if (n < p + 5 || !p) return NaN;
    const std = (v) => { let m = 0; for (let i = 0; i < n; i++) m += v[i]; m /= n; let q = 0; for (let i = 0; i < n; i++) q += (v[i] - m) * (v[i] - m); const sd = Math.sqrt(q / n); return sd > 0 ? Array.from(v, (x) => (x - m) / sd) : null; };
    const Z = cols.map(std).filter(Boolean), yy = std(y); if (!Z.length || !yy) return NaN;
    const k = Z.length, A = Array.from({ length: k }, (_, a) => Array.from({ length: k + 1 }, (_, b) => { let t = 0; const u = Z[a], w = b < k ? Z[b] : yy; for (let i = 0; i < n; i++) t += u[i] * w[i]; return t / n; }));
    const rhs = A.map((row) => row[k]);
    for (let c = 0; c < k; c++) { let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; if (Math.abs(A[piv][c]) < 1e-9) return NaN; [A[c], A[piv]] = [A[piv], A[c]]; for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; } }
    const beta = new Array(k).fill(0); for (let c = k - 1; c >= 0; c--) { let t = A[c][k]; for (let q = c + 1; q < k; q++) t -= A[c][q] * beta[q]; beta[c] = t / A[c][c]; }
    let out = 0; for (let c = 0; c < k; c++) out += beta[c] * rhs[c]; return Math.max(0, Math.min(1, out));
  },
  // Équidistance des courbes de niveau : la plus fine qui donne au plus 30 courbes sur le dénivelé du champ
  duree(min) { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return h ? (m ? `${h} h ${m < 10 ? "0" : ""}${m}` : `${h} h`) : `${m} minutes`; },
  contourInterval(span) { return [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50].find((c) => span / c <= 30) || 100; },
  // Courbes de niveau par carrés mobiles. -> [{ level, major, segs: [[x1, y1, x2, y2], …] }] en coordonnées de grille (centre des cellules)
  contours(z, W, H, interval) {
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < z.length; i++) { const v = z[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!(hi > lo) || !(interval > 0)) return [];
    const out = [], every = interval === 0.25 || interval === 2.5 ? 4 : 5, k0 = Math.ceil(lo / interval), k1 = Math.floor(hi / interval);
    for (let k = k0; k <= k1 && out.length < 200; k++) {
      const L = k * interval + 1e-7, segs = [];
      for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) {
        const a = z[r * W + c], b = z[r * W + c + 1], cc = z[(r + 1) * W + c + 1], d = z[(r + 1) * W + c]; if (a !== a || b !== b || cc !== cc || d !== d) continue;
        const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0); if (idx === 0 || idx === 15) continue;
        const T = [c + (L - a) / (b - a), r], Rg = [c + 1, r + (L - b) / (cc - b)], B = [c + (L - d) / (cc - d), r + 1], Lf = [c, r + (L - a) / (d - a)], add = (p, q) => segs.push([p[0], p[1], q[0], q[1]]);
        switch (idx) { case 1: case 14: add(Lf, B); break; case 2: case 13: add(B, Rg); break; case 3: case 12: add(Lf, Rg); break; case 4: case 11: add(T, Rg); break; case 6: case 9: add(T, B); break; case 7: case 8: add(Lf, T); break; case 5: add(Lf, T); add(B, Rg); break; case 10: add(Lf, B); add(T, Rg); break; default: break; }
      }
      if (segs.length) out.push({ level: k * interval, major: ((k % every) + every) % every === 0, segs });
    }
    return out;
  },
  /*
    Différence entre deux relevés LiDAR (récent moins ancien), sur la même grille.
    L'écart d'ensemble entre les deux relevés (référence d'altitude, calage) est retiré : on garde ce qui a changé à l'intérieur du champ.
    Sol déplacé : moyenne du volume en moins et du volume en plus, là où l'écart atteint thr mètres (en dessous, c'est le bruit du LiDAR), par hectare de champ.
    « Important » : plus de minVol m³ de sol déplacé par hectare.
  */
  nivellement(zOld, zNew, mask, W, H, res, opt) {
    const o = Object.assign({ thr: 0.15, minVol: 30 }, opt || {}), a = this.smooth(this.smooth(zOld, W, H), W, H), b = this.smooth(this.smooth(zNew, W, H), W, H), N = W * H, raw = new Float32Array(N).fill(NaN), vals = [];
    let inMask = 0; for (let i = 0; i < N; i++) { if (mask[i]) inMask++; const v = b[i] - a[i]; if (v === v) { raw[i] = v; if (mask[i]) vals.push(v); } }
    if (!inMask || vals.length < 50 || vals.length < 0.9 * inMask) return null;
    vals.sort((x, y) => x - y); const offset = vals[Math.floor(vals.length / 2)], d = this.smooth(raw, W, H), cell = res * res;
    let n = 0, cutN = 0, fillN = 0, cutVol = 0, fillVol = 0; const abs = [];
    for (let i = 0; i < N; i++) { if (d[i] !== d[i]) continue; d[i] -= offset; if (!mask[i]) continue; n++; abs.push(Math.abs(d[i])); if (d[i] <= -o.thr) { cutN++; cutVol -= d[i] * cell; } else if (d[i] >= o.thr) { fillN++; fillVol += d[i] * cell; } }
    if (!n) return null; abs.sort((x, y) => x - y);
    const ha = (n * cell) / 10000, movedPerHa = (cutVol + fillVol) / 2 / ha;
    return { d, n, offset, thr: o.thr, minVol: o.minVol, movedPerHa, cutShare: cutN / n, fillShare: fillN / n, cutHa: (cutN * cell) / 10000, fillHa: (fillN * cell) / 10000, cutVol, fillVol, p98: abs[Math.floor(abs.length * 0.98)], significant: movedPerHa > o.minVol };
  },
  // Flèches du sens de la pente, sur une grille régulière : -> [{ x, y, ux, uy }] (x, y en cellules ; ux, uy : vers le bas de la pente, y vers le bas de l'image)
  arrows(z, W, H, step, inside) {
    const out = [], h = Math.max(1, Math.round(step / 2)), at = (c, r) => { let s2 = 0, n = 0; for (let y = Math.max(0, r - 1); y <= Math.min(H - 1, r + 1); y++) for (let x = Math.max(0, c - 1); x <= Math.min(W - 1, c + 1); x++) { const v = z[y * W + x]; if (v === v) { s2 += v; n++; } } return n ? s2 / n : NaN; };
    for (let r = h; r < H - h; r += step) for (let c = h; c < W - h; c += step) {
      if (inside && !inside[r * W + c]) continue;
      const gx = (at(c + h, r) - at(c - h, r)) / (2 * h), gy = (at(c, r + h) - at(c, r - h)) / (2 * h), g = Math.sqrt(gx * gx + gy * gy);
      if (!(g > 1e-4)) continue; // plat ou sans donnée : pas de flèche
      out.push({ x: c, y: r, ux: -gx / g, uy: -gy / g });
    }
    return out;
  },
  // position dans le relief : altitude moins la moyenne du voisinage (négatif = creux, positif = butte)
  tpi(z, W, H, rad) {
    const S = new Float64Array((W + 1) * (H + 1)), N = new Float64Array((W + 1) * (H + 1)), out = new Float32Array(W * H).fill(NaN);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const v = z[r * W + c], ok = v === v, i = (r + 1) * (W + 1) + c + 1; S[i] = (ok ? v : 0) + S[i - 1] + S[i - W - 1] - S[i - W - 2]; N[i] = (ok ? 1 : 0) + N[i - 1] + N[i - W - 1] - N[i - W - 2]; }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const v = z[r * W + c]; if (v !== v) continue; const r0 = Math.max(0, r - rad), r1 = Math.min(H, r + rad + 1), c0 = Math.max(0, c - rad), c1 = Math.min(W, c + rad + 1), q = (a, b) => a * (W + 1) + b;
      const n = N[q(r1, c1)] - N[q(r0, c1)] - N[q(r1, c0)] + N[q(r0, c0)]; if (n > 0) out[r * W + c] = v - (S[q(r1, c1)] - S[q(r0, c1)] - S[q(r1, c0)] + S[q(r0, c0)]) / n; }
    return out;
  },
  // distance au bord de la parcelle (m), par propagation sur la grille
  edgeDist(mask, W, H, cell) {
    const d = new Float32Array(W * H).fill(Infinity), INF = Infinity;
    for (let i = 0; i < W * H; i++) if (!mask[i]) d[i] = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const i = r * W + c; if (c === 0 || r === 0) { if (mask[i]) d[i] = Math.min(d[i], cell / 2); } if (d[i] === 0) continue; if (c > 0) d[i] = Math.min(d[i], d[i - 1] + cell); if (r > 0) d[i] = Math.min(d[i], d[i - W] + cell); if (c > 0 && r > 0) d[i] = Math.min(d[i], d[i - W - 1] + cell * 1.414); if (c < W - 1 && r > 0) d[i] = Math.min(d[i], d[i - W + 1] + cell * 1.414); }
    for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) { const i = r * W + c; if (c === W - 1 || r === H - 1) { if (mask[i]) d[i] = Math.min(d[i], cell / 2); } if (d[i] === 0) continue; if (c < W - 1) d[i] = Math.min(d[i], d[i + 1] + cell); if (r < H - 1) d[i] = Math.min(d[i], d[i + W] + cell); if (c < W - 1 && r < H - 1) d[i] = Math.min(d[i], d[i + W + 1] + cell * 1.414); if (c > 0 && r < H - 1) d[i] = Math.min(d[i], d[i + W - 1] + cell * 1.414); }
    for (let i = 0; i < W * H; i++) if (d[i] === INF) d[i] = NaN;
    return d;
  },
  /*
    Croisement de la stabilité du NDVI avec les autres couches.
    rel : écart relatif à la médiane du champ, par pixel ; layers : [{ key, label, unit, digits, values }] alignées sur rel ;
    soil : nom de l'unité de sol par pixel (facultatif).
    -> { n, layers: [{ key, label, unit, digits, n, rho, low, high }], r2, soils: [{ name, n, share, rel }], lowCut, highCut }
       low / high : moyenne de la couche dans le quart le moins beau / le plus beau de la parcelle
  */
  croisement(rel, layers, soil, forme) {
    const ok = []; for (let i = 0; i < rel.length; i++) if (Number.isFinite(rel[i])) ok.push(i);
    if (ok.length < 40) return null;
    const sorted = ok.map((i) => rel[i]).sort((a, b) => a - b), lowCut = sorted[Math.floor(sorted.length * 0.25)], highCut = sorted[Math.floor(sorted.length * 0.75)];
    const out = { n: ok.length, lowCut, highCut, layers: [], soils: [], r2: NaN }, full = ok.filter((i) => layers.every((l) => Number.isFinite(l.values[i])));
    layers.forEach((l) => {
      const idx = ok.filter((i) => Number.isFinite(l.values[i])); if (idx.length < 40) return;
      const x = idx.map((i) => l.values[i]), y = idx.map((i) => rel[i]), mean = (sel) => { const v = idx.filter(sel).map((i) => l.values[i]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
      const rho = this.spearman(x, y); if (!Number.isFinite(rho)) return;
      out.layers.push({ key: l.key, label: l.label, unit: l.unit, digits: l.digits, n: idx.length, rho, low: mean((i) => rel[i] <= lowCut), high: mean((i) => rel[i] >= highCut) });
    });
    out.layers.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
    if (full.length >= 60 && out.layers.length) out.r2 = this.r2(layers.filter((l) => out.layers.some((o) => o.key === l.key)).map((l) => full.map((i) => l.values[i])), full.map((i) => rel[i]));
    if (soil) { const by = new Map(); ok.forEach((i) => { const nm = soil[i]; if (!nm) return; const g = by.get(nm) || { name: nm, n: 0, s: 0 }; g.n++; g.s += rel[i]; by.set(nm, g); });
      const tot = Array.from(by.values()).reduce((a, g) => a + g.n, 0) || 1; out.soils = Array.from(by.values()).filter((g) => g.n >= 10).map((g) => ({ name: g.name, n: g.n, share: g.n / tot, rel: g.s / g.n })).sort((a, b) => b.rel - a.rel); }
    out.formes = [];
    if (forme) { const by = new Map(); ok.forEach((i) => { const nm = forme[i]; if (!nm) return; const g = by.get(nm) || { name: nm, n: 0, s: 0 }; g.n++; g.s += rel[i]; by.set(nm, g); });
      const tot = Array.from(by.values()).reduce((a, g) => a + g.n, 0) || 1; out.formes = Array.from(by.values()).filter((g) => g.n >= 10).map((g) => ({ name: g.name, n: g.n, share: g.n / tot, rel: g.s / g.n })).sort((a, b) => b.rel - a.rel); }
    const maxAbs = Math.max(0, ...out.soils.concat(out.formes).map((g) => Math.abs(g.rel))); out.span = [0.02, 0.05, 0.1, 0.15, 0.25, 0.5, 1].find((v) => v >= maxAbs) || 1; // demi-largeur des barres par groupe
    return out.layers.length || out.soils.length || out.formes.length ? out : null;
  },
  force(rho) { const a = Math.abs(rho); return a >= 0.5 ? "fort" : a >= 0.3 ? "moyen" : a >= 0.15 ? "faible" : "presque nul"; },
  // ---- faits : phrases chiffrées, descriptives, sans jugement ni conseil ----
  faits(d) {
    const out = [], f = this.fr.bind(this), add = (section, text) => out.push({ section, text }), pm = (v, dgt) => `${v >= 0 ? "+" : "−"}${f(Math.abs(v), dgt)}`;
    const R = d.relief, S = d.sols, V = d.stab, N = d.ndvi, K = d.climat, C = d.cultures, X = d.croisement;
    if (R) {
      add("relief", `Pente moyenne de ${f(R.mean, 1)} %. ${f(R.classes[0].share * 100)} % du champ est plat (moins de 0,3 % de pente) et ${f((R.classes[3].share + R.classes[4].share + R.classes[5].share) * 100)} % a une pente de 3 % et plus.`);
      if (R.forms && R.forms.length) add("relief", `Formes de terrain les plus étendues : ${R.forms.slice(0, 3).map((x) => `${x.label.toLowerCase()} (${f(x.share * 100)} %)`).join(", ")}.`);
      add("relief", `${f(R.zMax - R.zMin, 1)} m de dénivelé entre le point le plus bas (${f(R.zMin, 1)} m) et le plus haut (${f(R.zMax, 1)} m).`);
    }
    const E = d.eau;
    if (E && E.erosion) { const er = E.erosion, over = er.classes.slice(2).reduce((a, k) => a + k.share, 0);
      add("eau", `Perte de sol estimée : ${f(er.mean, 1)} t/ha par an en moyenne. ${f(over * 100)} % du champ dépasse 3 t/ha par an.`); }
    if (E && E.rain) { const rn = E.rain; add("eau", `Pluie simulée de ${f(rn.intensity)} mm/h pendant ${this.duree(rn.minutes)} : ${f(rn.inf * 100)} % de l'eau s'infiltre, ${f(rn.out * 100)} % sort du champ et ${f(rn.left * 100)} % reste en surface.`); }
    if (S && S.units.length) add("sols", `${S.units.length} série${S.units.length > 1 ? "s" : ""} de sol. La plus étendue : ${S.units[0].name} (${f(S.units[0].share * 100)} % du champ)${S.units[1] ? `, puis ${S.units[1].name} (${f(S.units[1].share * 100)} %)` : ""}.`);
    if (V && V.classes.length) {
      const sh = (code) => (V.classes.find((x) => x.code === code) || { share: 0 }).share;
      add("vegetation", `Sur ${V.years} années : ${f((sh("toujours-bien") + sh("generalement-bien")) * 100)} % du champ est plus vert que le reste la plupart des années, ${f((sh("toujours-mauvais") + sh("generalement-mauvais")) * 100)} % est moins vert, et ${f(sh("variable") * 100)} % change d'une année à l'autre.`);
    }
    if (X && X.layers.length) {
      const t = X.layers[0], name = t.label.toLowerCase();
      add("croisement", `Ce qui suit le mieux les secteurs plus verts ou moins verts : ${name} (lien ${this.force(t.rho)}, ${pm(t.rho, 2)}). Les secteurs les moins verts ont en moyenne ${f(t.low, t.digits)} ${t.unit}, les plus verts ${f(t.high, t.digits)} ${t.unit}.`);
      if (Number.isFinite(X.r2)) add("croisement", `Le terrain (élévation, pente, position, distance au bord) explique ${f(X.r2 * 100)} % des différences de verdure dans le champ.`);
    }
    if (X && X.soils.length >= 2) { const a = X.soils[0], b = X.soils[X.soils.length - 1]; add("croisement", `Selon le sol : ${a.name} est à ${pm(a.rel * 100, 1)} % par rapport à la moyenne du champ, ${b.name} à ${pm(b.rel * 100, 1)} %.`); }
    if (X && X.formes && X.formes.length >= 2) { const a = X.formes[0], b = X.formes[X.formes.length - 1]; add("croisement", `Selon la forme du terrain : ${a.name.toLowerCase()} à ${pm(a.rel * 100, 1)} % par rapport à la moyenne du champ, ${b.name.toLowerCase()} à ${pm(b.rel * 100, 1)} %.`); }
    if (K && K.cur) {
      const c = K.cur, r = K.at || {}, pct = (v, m) => (Number.isFinite(m) && m > 0 ? (v - m) / m : NaN), dC = pct(c.chu, r.chu), dP = pct(c.precip, r.precip), cmp = (dv) => `${f(Math.abs(dv) * 100)} % de ${dv >= 0 ? "plus" : "moins"} que la moyenne`;
      add("climat", Number.isFinite(dC) ? `${f(c.chu)} UTM en ${K.year} : ${cmp(dC)} à la même date (${f(r.chu)}).` : `${f(c.chu)} UTM et ${f(c.gdd)} degrés-jours (base 5 °C) en ${K.year}.`);
      if (Number.isFinite(dP)) add("climat", `${f(c.precip)} mm de pluie depuis le 1er avril : ${cmp(dP)} (${f(r.precip)} mm).`);
      if (c.frostFree !== null && c.frostFree !== undefined) add("climat", `${c.frostFree} jours sans gel, du ${this.day(K.springFrost)} au ${this.day(K.fallFrost)}.`);
    }
    if (C) {
      add("cultures", `${C.distinct} culture${C.distinct > 1 ? "s" : ""} différente${C.distinct > 1 ? "s" : ""} dans les ${C.recent.length} dernières années déclarées. La plus fréquente : ${C.top.crop} (${C.top.n} fois).`);
      if (C.longest.n >= 2) add("cultures", `Plus longue suite de la même culture : ${C.longest.crop}, ${C.longest.n} années de suite.`);
    }
    out.forEach((x) => { x.text = x.text.replace(/\.\.$/, "."); }); // une date abrégée en fin de phrase porte déjà son point
    return out;
  },
  // ---- graphique : courbes cumulées ou série, en SVG statique (lisible imprimé) ----
  chart(o) { // o : { w, h, x: [min, max], y: [min, max], xTicks: [[v, label]], yStep, series: [{ pts: [[x, y]], cls, dots }], band: { pts: [[x, lo, hi]] }, unit }
    const W = o.w || 520, H = o.h || 190, L = 40, R = 12, T = 8, B = 22, pw = W - L - R, ph = H - T - B, X = (v) => L + ((v - o.x[0]) / (o.x[1] - o.x[0])) * pw, Y = (v) => T + ph - ((Math.max(o.y[0], Math.min(o.y[1], v)) - o.y[0]) / (o.y[1] - o.y[0])) * ph;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="rp-chart" role="img" aria-label="${this.esc(o.label || "")}">`;
    for (let v = o.y[0]; v <= o.y[1] + 1e-9; v += o.yStep) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="rp-grid"/><text x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" class="rp-tick">${this.fr(v, o.yDigits || 0)}</text>`;
    (o.xTicks || []).forEach((t) => { s += `<text x="${X(t[0]).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="rp-tick">${this.esc(t[1])}</text>`; });
    if (o.band && o.band.pts.length > 1) s += `<path d="${o.band.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[2]).toFixed(1)}`).join("")}${o.band.pts.slice().reverse().map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}Z" class="rp-band"/>`;
    (o.series || []).forEach((se) => {
      if (se.pts.length > 1) s += `<path d="${se.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}" class="rp-line ${se.cls || ""}"/>`;
      if (se.dots) se.pts.forEach((p) => { s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" class="rp-dot ${se.cls || ""}"/>`; });
      if (se.name && se.pts.length) { const p = se.pts[se.pts.length - 1]; s += `<text x="${Math.min(W - R, X(p[0]) + 5).toFixed(1)}" y="${(Y(p[1]) + (se.dy || 3)).toFixed(1)}" class="rp-lab ${se.cls || ""}" text-anchor="${X(p[0]) > W - 60 ? "end" : "start"}"${X(p[0]) > W - 60 ? ` dy="${se.dy && se.dy > 3 ? 4 : -6}"` : ""}>${this.esc(se.name)}</text>`; }
    });
    return s + "</svg>";
  },
  niceStep(max, n) { return [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((s) => max / s <= (n || 4)) || 5000; },
  // ---- mise en pages (chaînes HTML ; toutes les valeurs saisies ou lues sont échappées) ----
  SECTIONS: [["relief", "Relief"], ["eau", "Eau et érosion"], ["sols", "Sols"], ["vegetation", "Verdure"], ["croisement", "Verdure et terrain"], ["climat", "Climat"], ["cultures", "Cultures"]],
  pages(d, meta) {
    const e = this.esc.bind(this), f = this.fr.bind(this), M = meta || {}, P = [], cons = this.faits(d), bySec = (sec) => cons.filter((c) => c.section === sec);
    const consHtml = (list) => (list.length ? `<ul class="rp-facts">${list.map((c) => `<li>${e(c.text)}</li>`).join("")}</ul>` : "");
    const missing = (why) => `<div class="rp-missing">${e(why)}</div>`;
    const img = (key, alt, legend, cap, big) => { const sc = d.shots && (big === "loc" ? d.shots.scaleLoc || d.shots.scale : big ? d.shots.scaleBig || d.shots.scale : d.shots.scale); return (d.shots && d.shots[key] ? `<figure class="rp-map${big ? " rp-big" : ""}"><div class="rp-mapimg"><img src="${d.shots[key]}" alt="${e(alt)}"/>${sc ? `<b class="rp-scalebar" style="width:${(sc.ratio * 100).toFixed(2)}%"></b><span class="rp-scalelab">${e(sc.label)}</span>` : ""}<span class="rp-north">N ↑</span>${cap ? `<span class="rp-cap">${cap}</span>` : ""}</div>${legend || ""}</figure>` : missing("Carte non disponible.")); };
    const strip = (items) => `<div class="rp-strip">${items.filter(Boolean).map((x) => `<span><b>${x[0]}</b> ${e(x[1])}</span>`).join("")}</div>`;
    const shares = (list, tail) => `<figcaption class="rp-legend rp-legend-big">${list.map((k) => `<span><i style="background:${k.color}"></i>${e(k.label)} <b>${f(k.share * 100)} %</b></span>`).join("")}${tail || ""}</figcaption>`;
    const head = (title) => `<header class="rp-top"><span class="rp-brand">${M.logo ? `<img src="${e(M.logo)}" alt=""/>` : ""}${e(M.company || "Plan de Ferme")}</span><span>${e(title)}</span><span>${e(d.name)}</span></header>`;
    const page = (title, body) => P.push({ title, body: `${head(title)}<div class="rp-body">${body}</div>` });
    const tile = (label, value, sub) => `<div class="rp-tile"><div class="rp-tl">${e(label)}</div><div class="rp-tv">${value}</div>${sub ? `<div class="rp-ts">${e(sub)}</div>` : ""}</div>`;
    const R = d.relief, S = d.sols, V = d.stab, K = d.climat, C = d.cultures, X = d.croisement, sign = (v, dgt) => `${v >= 0 ? "+" : "−"}${f(Math.abs(v), dgt)}`;
    const shareOf = (code) => (V && V.classes.find((x) => x.code === code) || { share: 0 }).share;
    // 1. Sommaire : chiffres clés, puis l'essentiel de chaque thème dans une carte
    const cards = this.SECTIONS.filter(([key]) => key !== "cultures").map(([key, title]) => { const list = bySec(key).slice(0, 1); return list.length ? `<div class="rp-card"><h3>${e(title)}</h3>${list.map((c) => `<p>${e(c.text)}</p>`).join("")}</div>` : ""; }).join("");
    const C0 = d.cultures, palette = ["#2e6a4c", "#c98a1b", "#3f6fb5", "#8a5a9c", "#b5533c", "#5b8f8f", "#7d7d3a", "#9c6b4a"], cropColor = new Map();
    if (C0) Array.from(new Set(C0.history.map((x) => x.crop))).forEach((c, i) => cropColor.set(c, palette[i % palette.length]));
    page("Sommaire", `
      <div class="rp-cover"><div class="rp-kicker">Rapport de parcelle</div><h1>${e(d.name)}</h1>
        <p class="rp-sub">${[d.crop ? `Culture déclarée : ${e(d.crop)}` : "", d.place ? e(d.place) : "", `Produit le ${e(d.dateLabel)}`].filter(Boolean).join(" · ")}</p>
        ${M.client || M.author ? `<p class="rp-sub">${[M.client ? `Préparé pour ${e(M.client)}` : "", M.author ? `par ${e(M.author)}` : ""].filter(Boolean).join(" ")}</p>` : ""}</div>
      ${img("loc", "Localisation de la parcelle sur l'imagerie satellite", d.shots && (d.shots.locLots || d.shots.locEau) ? `<figcaption class="rp-legend rp-legend-big"><span><i style="background:#17211b"></i>Parcelle</span>${d.shots.locLots ? `<span><i style="background:#fde68a"></i>Lots du cadastre</span>` : ""}${d.shots.locEau ? `<span><i style="background:#3b82f6"></i>Cours d'eau</span>` : ""}</figcaption>` : "", "", "loc")}
      ${strip([[`${f(d.areaHa, 1)} ha`, `(${f(d.areaHa * 2.47105, 1)} acres)`], R ? [`${f(R.mean, 1)} %`, "de pente moyenne"] : null, S && S.units.length ? [e(S.units[0].name), `sur ${f(S.units[0].share * 100)} % du champ`] : null, K && K.cur ? [f(K.cur.chu), `unités thermiques maïs en ${K.year}`] : null])}
      ${C0 ? `<h2>Cultures déclarées, ${C0.first} à ${C0.last}</h2><div class="rp-crops">${C0.history.slice(0, 24).reverse().map((x) => `<div class="rp-crop"><span>${x.year}</span><b style="background:${cropColor.get(x.crop)}"></b><em>${e(x.crop)}</em></div>`).join("")}</div>` : ""}
      <h2>En bref</h2>${cards ? `<div class="rp-cards">${cards}</div>` : missing("Aucune donnée n'a pu être lue pour cette parcelle.")}
      ${M.notes ? `<h2>Notes</h2><p class="rp-notes">${e(M.notes).replace(/\n/g, "<br/>")}</p>` : ""}`);
    // 2. Relief
    const bars = (list, outline) => `<table class="rp-table"><tbody>${list.map((k) => `<tr><td><i class="rp-sw" style="background:${k.color}"></i>${e(k.label)}${k.note ? ` <em>(${e(k.note)})</em>` : ""}</td><td class="rp-barcell">${k.share >= 0.005 ? `<b style="width:${Math.max(1, k.share * 100).toFixed(1)}%;background:${k.color}${outline ? ";outline:1px solid rgba(0,0,0,.2)" : ""}"></b>` : ""}</td><td class="rp-num">${f(k.share * 100)} %</td><td class="rp-num">${f(k.share * d.areaHa, 1)} ha</td></tr>`).join("")}</tbody></table>`;
    const elevLegend = R ? `<figcaption class="rp-legend rp-legend-big"><span class="rp-ramp rp-ramp-elev"></span><span>${f(R.zMin, 1)} m</span><span>${f(R.zMax, 1)} m</span>${d.contour ? `<span>Courbes de niveau aux ${f(d.contour, d.contour < 1 ? 2 : 0).replace(/,?0+$/, "")} m</span>` : ""}</figcaption>` : "";
    const cm = (v) => f(v * 100), N = d.niv;
    page("Relief", `
      <h2>Topographie (LiDAR)</h2>
      ${R ? `${img("elev", "Carte topographique avec courbes de niveau", elevLegend, "", true)}
      ${strip([[`${f(R.mean, 1)} %`, "pente moyenne"], [`${f(R.zMax - R.zMin, 1)} m`, "de dénivelé"], [`${f(R.zMin, 1)} à ${f(R.zMax, 1)} m`, "d'altitude"]])}
      <div class="rp-legend rp-legend-line"><span>Pentes :</span>${R.classes.filter((k) => k.share >= 0.005).map((k) => `<span><i class="rp-chip" style="background:${k.color}"></i>${e(k.label)} <b>${f(k.share * 100)} %</b></span>`).join("")}</div>
      ${N && !N.significant ? `<p class="rp-fine">Relevés LiDAR de ${N.yearOld} et de ${N.yearNew} comparés : ${f(N.movedPerHa)} m³ de sol déplacé par hectare (carte présentée au-dessus de ${f(N.minVol)} m³/ha).</p>` : ""}` : missing(d.reliefWhy || "Relief LiDAR non disponible pour cette parcelle.")}`);
    // Nivellement : seulement si deux relevés LiDAR montrent une différence importante
    if (N && N.significant) page("Nivellement", `
      <h2>Différence entre les relevés LiDAR de ${N.yearOld} et de ${N.yearNew}</h2>
      ${img("niv", "Carte de la différence d'altitude entre deux relevés LiDAR", `<figcaption class="rp-legend rp-legend-big"><span>Abaissé</span><span class="rp-ramp rp-ramp-niv"></span><span>Rehaussé</span><span>de −${cm(N.range)} à +${cm(N.range)} cm</span></figcaption>`, "", true)}
      ${strip([[`${f(N.movedPerHa)} m³/ha`, "de sol déplacé"], [`${f(N.cutHa, 1)} ha`, `abaissés de ${cm(N.thr)} cm ou plus`], [`${f(Math.round(N.cutVol / 10) * 10)} m³`, "de terre en moins à ces endroits"], [`${f(N.fillHa, 1)} ha`, `rehaussés de ${cm(N.thr)} cm ou plus`], [`${f(Math.round(N.fillVol / 10) * 10)} m³`, "de terre en plus à ces endroits"]])}
      <p class="rp-fine">Altitude du relevé de ${N.yearNew} moins celle de ${N.yearOld}, après retrait de l'écart d'ensemble entre les deux relevés (${sign(N.offset * 100, 0)} cm). Des écarts de quelques centimètres sont normaux : précision du LiDAR, résidus, travail du sol.</p>`);
    // Eau : pluie simulée, puis perte de sol estimée (mêmes modèles que les outils de l'application)
    const E = d.eau;
    if (E && E.rain) { const rn = E.rain; page("Pluie simulée", `
      <h2>Où va l'eau pendant une forte pluie</h2>
      ${img("rain", "Carte de la pluie simulée", `<figcaption class="rp-legend rp-legend-big"><span><i style="background:#7fa8f0"></i>Chemins de l'eau</span><span><i style="background:#1d3f9c"></i>Eau qui s'accumule</span><span><b class="rp-arrow">➤</b>Sens de la pente</span></figcaption>`, "", true)}
      <p class="rp-fine">Sol de type « ${e(rn.soil)} ». Les drains souterrains, les fossés et les ponceaux ne sont pas pris en compte.</p>`); }
    else page("Pluie simulée", `<h2>Où va l'eau pendant une forte pluie</h2>${missing((E && E.rainWhy) || d.eauWhy || "Simulation de pluie non disponible pour ce champ.")}`);
    if (E && E.erosion) { const er = E.erosion; page("Érosion", `
      <h2>Perte de sol estimée</h2>
      ${img("ero", "Carte de la perte de sol estimée", shares(er.classes.map((k) => ({ label: k.short, color: k.color, share: k.share })), "<span>t/ha par an</span>"), "", true)}
      ${strip([[`${f(er.mean, 1)} t/ha`, "par an en moyenne"], [`${f(er.classes.slice(2).reduce((a, k) => a + k.share, 0) * 100)} %`, "du champ à plus de 3 t/ha par an"]])}
      <p class="rp-fine">Modèle RUSLE : sol « ${e(er.soil)} », culture « ${e(er.crop)} », sans pratique de conservation. Estimation à long terme, pas une mesure.</p>`); }
    else if (E) page("Érosion", `<h2>Perte de sol estimée</h2>${missing(E.erosionWhy || "Estimation de l'érosion non disponible.")}`);
    // Sols
    page("Sols", `
      <h2>Sols</h2>
      ${S && S.units.length ? `${img("sols", "Carte des sols", shares(S.units.slice(0, 8).map((u) => ({ label: u.name, color: u.color, share: u.share })), S.units.length > 8 ? `<span>et ${S.units.length - 8} autres séries</span>` : ""), "", true)}
      <p class="rp-fine">Carte : unités de la carte des sols, avec leurs couleurs et leurs codes. Légende : séries de sol qui composent ces unités. Couverture pédologique du Québec (IRDA), tracée à une échelle plus grossière que le champ.</p>` : missing(d.solsWhy || "Carte des sols non disponible à cet endroit.")}`);
    // Verdure : les images NDVI retenues par l'analyse sur plusieurs années, puis le classement
    const yearMaps = V && V.images && V.images.length ? `<div class="rp-years rp-years-${V.images.length <= 4 ? 2 : V.images.length <= 9 ? 3 : 4}">${V.images.map((im) => (d.shots && d.shots["y" + im.year] ? `<figure class="rp-map rp-year"><div class="rp-mapimg"><img src="${d.shots["y" + im.year]}" alt="NDVI de ${im.year}"/><span class="rp-cap">${im.year}</span></div><figcaption class="rp-legend"><span>${this.day(im.date)}</span><span>NDVI moyen ${f(im.mean, 2)}</span></figcaption></figure>` : "")).join("")}</div>
      <div class="rp-legend rp-legend-line"><span class="rp-ramp rp-ramp-ndvi"></span><span>moins vert … plus vert, par rapport au reste du champ ce jour-là</span></div>` : "";
    page("Verdure", `
      <h2>NDVI de chaque année comparée</h2>
      ${V && V.classes.length ? `${yearMaps || missing("Images annuelles non disponibles.")}
      <p class="rp-fine">Meilleure image Sentinel-2 sans nuage de chaque été (10 m). Les couleurs montrent les différences à l'intérieur du champ, pas entre les années.</p>` : missing(d.stabWhy || "Analyse non faite : pas assez d'années avec une image sans nuage.")}`);
    if (V && V.classes.length) page("Verdure d'une année à l'autre", `
      <h2>Secteurs plus verts ou moins verts, d'une année à l'autre</h2>
      ${img("stab", "Carte des secteurs plus verts ou moins verts", shares(V.classes), "", true)}
      <p class="rp-fine">${V.years} années comparées${V.list ? ` (${e(V.list)})` : ""}. « Bien » : plus vert que le reste du champ cette année-là ; « mauvais » : moins vert.</p>`);
    // 5. Verdure et terrain
    if (X) {
      const bar = (rho) => `<span class="rp-rho"><b class="${rho >= 0 ? "rp-pos" : "rp-neg"}" style="width:${(Math.min(1, Math.abs(rho)) * 50).toFixed(1)}%;${rho >= 0 ? "left:50%" : `right:50%`}"></b></span>`;
      const groups = (title, col, list) => (list && list.length ? `<h2>${title}</h2><table class="rp-table"><thead><tr><th>${col}</th><th class="rp-num">Part du champ</th><th style="width:30%">moins vert … plus vert</th><th class="rp-num">Par rapport à la moyenne du champ</th></tr></thead><tbody>${list.map((u) => `<tr><td>${e(u.name)}</td><td class="rp-num">${f(u.share * 100)} %</td><td>${bar(Math.max(-1, Math.min(1, u.rel / X.span)))}</td><td class="rp-num">${sign(u.rel * 100, 1)} %</td></tr>`).join("")}</tbody></table>` : "");
      page("Verdure et terrain", `
        <h2>Les secteurs moins verts ont-ils un terrain différent ?</h2>
        <p class="rp-lead">Verdure habituelle de chaque carré de 10 m (NDVI par rapport à la moyenne du champ, sur ${V ? V.years : ""} années), comparée au terrain au même endroit.</p>
        ${X.layers.length ? `<table class="rp-table"><thead><tr><th>Terrain</th><th class="rp-num">Lien</th><th style="width:24%">−1 … 0 … +1</th><th>Force</th><th class="rp-num">Secteurs les moins verts</th><th class="rp-num">Secteurs les plus verts</th></tr></thead><tbody>${X.layers.map((l) => `<tr><td>${e(l.label)}</td><td class="rp-num">${sign(l.rho, 2)}</td><td>${bar(l.rho)}</td><td>${e(this.force(l.rho))}</td><td class="rp-num">${f(l.low, l.digits)} ${e(l.unit)}</td><td class="rp-num">${f(l.high, l.digits)} ${e(l.unit)}</td></tr>`).join("")}</tbody></table>
        <p class="rp-fine"><strong>Lien</strong> : de −1 à +1. Positif : plus la valeur est grande, plus le secteur est vert ; négatif : l'inverse ; près de 0 : pas de lien. Les deux dernières colonnes donnent la moyenne dans le quart du champ le moins vert et le plus vert.</p>
        ${Number.isFinite(X.r2) ? strip([[`${f(X.r2 * 100)} %`, "des différences de verdure vont avec le terrain mesuré ici"], [`${f((1 - X.r2) * 100)} %`, "vont avec autre chose"]]) : ""}` : missing("Relief non disponible : pas de comparaison avec le terrain.")}
        ${groups("Verdure selon le sol", "Série de sol dominante", X.soils)}${groups("Verdure selon la forme du terrain", "Forme de terrain", X.formes)}
        ${X.soils.length || (X.formes && X.formes.length) ? `<p class="rp-fine">Barres : de −${f(X.span * 100)} % à +${f(X.span * 100)} % par rapport à la moyenne du champ.</p>` : ""}
        <p class="rp-fine">Ces chiffres montrent ce qui va ensemble dans le champ, pas ce qui cause quoi.</p>`);
    } else page("Verdure et terrain", `<h2>Les secteurs moins verts ont-ils un terrain différent ?</h2>${missing(d.croisementWhy || "Comparaison non faite : la carte des secteurs plus verts et moins verts n'est pas disponible pour ce champ.")}`);
    // 6. Climat : trois grands graphiques, un par ligne
    if (K && K.cur) {
      const xT = [[0, "avr."], [30, "mai"], [61, "juin"], [91, "juil."], [122, "août"], [153, "sept."], [183, "oct."]], mk = (key, label, unit) => {
        const cur = K.series[key], ref = K.ref ? K.ref[key] : null, vmax = Math.max(1, ...cur.filter(Number.isFinite), ...(ref ? ref.max.filter(Number.isFinite) : [])), st = this.niceStep(vmax), top = Math.ceil(vmax / st) * st;
        const pts = (arr) => arr.map((v, k) => [k, v]).filter((p) => Number.isFinite(p[1]));
        return `<div class="rp-chartbox"><h3>${e(label)} <small>${e(unit)}</small></h3>${this.chart({ label, w: 700, h: 196, x: [0, 213], y: [0, top], yStep: st, xTicks: xT, band: ref ? { pts: ref.max.map((v, k) => [k, ref.min[k], v]).filter((p) => Number.isFinite(p[1]) && Number.isFinite(p[2])) } : null,
          series: (ref ? [{ pts: pts(ref.mean), cls: "rp-ref", name: "moyenne", dy: 12 }] : []).concat([{ pts: pts(cur), cls: "rp-s1", name: String(K.year), dy: -5 }]) })}</div>`; };
      page("Climat", `
        <h2>Climat de la saison ${K.year}</h2>
        <p class="rp-lead">Station ${e(K.station.name)}, à ${f(K.station.km)} km. Dernière observation : ${this.day(K.cur.lastDate)} ${K.year}.</p>
        ${strip([[f(K.cur.gdd), "degrés-jours (base 5 °C)"], [f(K.cur.chu), "unités thermiques maïs"], [`${f(K.cur.precip)} mm`, "de pluie depuis le 1er avril"], K.cur.frostFree !== null && K.cur.frostFree !== undefined ? [`${K.cur.frostFree} jours`, "sans gel"] : null])}
        <div class="rp-legend rp-legend-line"><span><i class="rp-k1"></i>${K.year}</span>${K.ref ? `<span><i class="rp-k2"></i>Moyenne des années précédentes</span><span><i class="rp-k3"></i>Entre l'année la plus basse et la plus haute</span>` : ""}</div>
        ${mk("gdd", "Degrés-jours cumulés", "°C·j")}${mk("chu", "Unités thermiques maïs cumulées", "UTM")}${mk("precip", "Pluie cumulée", "mm")}
        <p class="rp-fine">Observations d'Environnement et Changement climatique Canada. La pluie tombée au champ peut différer de celle de la station.</p>`);
    } else page("Climat", `<h2>Climat de la saison</h2>${missing(d.climatWhy || "Aucune station météo d'Environnement Canada en activité à proximité.")}`);
    // 7. Méthode
    page("Méthode et sources", `
      <h2>Méthode et sources</h2>
      <ul class="rp-method">
        <li><strong>Relief</strong> : modèle numérique de terrain LiDAR, ramené à des carrés de ${f(d.reliefRes || 5)} m et lissé légèrement ; pentes calculées par différences centrées ; courbes de niveau à l'équidistance la plus fine qui donne au plus 30 courbes ; formes de terrain par la méthode des géomorphons (Jasiewicz et Stepinski, 2013), rayon de 50 m, seuil de 0,5°.</li>
        <li><strong>Nivellement</strong> : quand deux relevés LiDAR d'années différentes couvrent le champ, le plus ancien est soustrait du plus récent, puis l'écart d'ensemble entre les deux est retiré. Le sol déplacé est la moyenne du volume en moins et du volume en plus, comptés là où l'écart atteint 15 cm, divisée par la superficie du champ. La carte est présentée au-dessus de 30 m³ par hectare.</li>
        <li><strong>Eau et érosion</strong> : pluie simulée sur le relief LiDAR (ruissellement de carré en carré, infiltration selon le type de sol), flèches dans le sens de la plus forte pente ; perte de sol par le modèle RUSLE-CAN / RUSLEFAC (A = R × K × LS × C × P), avec la culture déclarée et la texture du sol détectée.</li>
        <li><strong>Sols</strong> : couverture pédologique du Québec ; chaque unité de la carte est découpée par le contour du champ, puis sa superficie est répartie entre ses séries de sol selon leurs proportions.</li>
        <li><strong>Verdure</strong> : images Sentinel-2 (10 m), Planetary Computer ; pour chaque été, la meilleure image sans nuage. Chaque secteur est comparé à la valeur du milieu du champ (médiane), année par année.</li>
        <li><strong>Verdure et terrain</strong> : corrélation de rang (Spearman) entre la verdure habituelle et chaque couche de terrain, par carré de 10 m ; part expliquée calculée par une régression linéaire sur l'ensemble des couches.</li>
        <li><strong>Climat</strong> : observations quotidiennes de la station d'Environnement Canada la plus proche ; cumuls du 1er avril au 31 octobre, comparés aux dix années précédentes.</li>
        <li><strong>Cultures</strong> : base de données des parcelles et productions agricoles déclarées (BDPPAD).</li>
      </ul>
      <div class="rp-warning"><strong>À savoir :</strong> ce rapport présente des données publiques et des calculs automatiques. Il ne pose pas de diagnostic et ne fait pas de recommandation.</div>`);
    return P.map((p, i) => `<section class="rp-page" data-title="${e(p.title)}">${p.body}<footer class="rp-foot"><span>Rapport de parcelle · produit avec <strong>Plan de Ferme</strong> · plandeferme.ca</span><span>Page ${i + 1} / ${P.length}</span></footer></section>`).join("\n");
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfRapportCore };

if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";
  const C = pfRapportCore, META_KEY = "pf-rapport-meta", MAP_W = 900, MAP_H = 720, MAX_LOGO = 600 * 1024;
  const state = { run: 0, data: null, feature: null, ctl: null };
  const el = (tag, cls, html) => { const x = document.createElement(tag); if (cls) x.className = cls; if (html !== undefined) x.innerHTML = html; return x; };
  const meta = () => { try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch (e) { return {}; } };
  const saveMeta = (m) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* stockage indisponible */ } };
  const p4 = () => window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("délai dépassé")), ms))]);

  // ---------------------------------------------------------------- données
  // Relevés LiDAR (projets HRDEM) qui touchent l'emprise : le plus ancien et le plus récent lisibles, sur la grille du rapport, puis leur différence
  async function compareSurveys(bboxWgs, size, toGrid, mask, W, H, res, signal) {
    if (typeof readSingleHrdemProjectRegion !== "function") return null;
    const r = await fetch(`https://datacube.services.geo.ca/pgstac/api/collections/hrdem-lidar/items?bbox=${bboxWgs.map((v) => v.toFixed(5)).join(",")}&limit=50`, { signal }); if (!r.ok) return null;
    const feats = ((await r.json()).features || []).filter((ft) => ft && ft.id && ft.assets && ft.assets.dtm && ft.assets.dtm.href), by = new Map();
    feats.forEach((ft) => { const pr = ft.properties || {}, dt = pr.datetime || pr.start_datetime || pr.end_datetime, ym = /(19|20)\d{2}/.exec(String(ft.id)), year = dt ? new Date(dt).getUTCFullYear() : ym ? parseInt(ym[0], 10) : 0; if (!year) return;
      const base = String(ft.id).replace(/-(1|2)m$/i, ""), cur = by.get(base); if (!cur || /-1m$/i.test(ft.id)) by.set(base, { id: ft.id, year, url: ft.assets.dtm.href }); }); // même projet à 1 m et à 2 m : un seul, le plus fin
    const list = Array.from(by.values()).sort((a, b) => a.year - b.year); if (list.length < 2 || list[0].year === list[list.length - 1].year) return null;
    let inMask = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) inMask++;
    const read = async (pj) => { try { const rg = await readSingleHrdemProjectRegion(pj.url, bboxWgs, size, signal, "bilinear"); if (!rg || !rg.data || !rg.sourceBBox) return null; const z = toGrid(rg); let ok = 0; for (let i = 0; i < z.length; i++) if (mask[i] && z[i] === z[i]) ok++; return ok >= 0.9 * inMask ? z : null; } catch (e) { return null; } };
    // lectures en parallèle (les trois plus anciens et les trois plus récents), puis le plus ancien et le plus récent qui couvrent le champ
    const cand = list.length <= 6 ? list : list.slice(0, 3).concat(list.slice(-3)), grids = await Promise.all(cand.map(read));
    const iOld = grids.findIndex((g) => g); if (iOld < 0) return null; let iNew = -1; for (let k = cand.length - 1; k > iOld; k--) if (grids[k] && cand[k].year > cand[iOld].year) { iNew = k; break; }
    if (iNew < 0) return null; const old = cand[iOld], rec = cand[iNew], zOld = grids[iOld], zNew = grids[iNew];
    const out = C.nivellement(zOld, zNew, mask, W, H, res); if (!out) return null;
    out.yearOld = old.year; out.yearNew = rec.year; delete out.n; return out;
  }
  async function relief(geom, signal) {
    const zm = window.zonesManager, proj = p4();
    if (!zm || typeof zm.readDem !== "function" || !proj) throw new Error("Lecture du relief indisponible.");
    const b = C.bbox(geom), lng = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2, zone = Math.floor((lng + 180) / 6) + 1;
    const utm = `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`, toU = proj("EPSG:4326", utm), polysU = C.polys(geom).map((p) => p.map((r) => r.map((c) => toU.forward(c))));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; polysU.forEach((p) => p[0].forEach((c) => { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); }));
    // La grille déborde du champ pour couvrir tout le cadre de la grande carte (presque carré, champ centré) ; les chiffres ne portent que sur le champ.
    const mPerPx = Math.max((maxX - minX) / 936, (maxY - minY) / 1047) * 1.08, halfW = 500 * mPerPx, halfH = 556 * mPerPx, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const areaM2 = C.areaHa(geom) * 10000, res = [2, 3, 5, 10, 20].find((r) => areaM2 / (r * r) <= 120000 && (4 * halfW * halfH) / (r * r) <= 420000) || 30;
    minX = Math.floor((cx - halfW) / res) * res; maxY = Math.ceil((cy + halfH) / res) * res;
    const W = Math.ceil((cx + halfW - minX) / res), H = Math.ceil((maxY - (cy - halfH)) / res); maxX = minX + W * res; minY = maxY - H * res;
    const corner = (x, y) => proj(utm, "EPSG:4326", [x, y]), cs = [corner(minX, maxY), corner(maxX, maxY), corner(maxX, minY), corner(minX, minY)];
    const bboxWgs = [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
    const region = await zm.readDem(bboxWgs, Math.max(64, Math.min(2048, Math.max(W, H) * 2)), signal);
    if (!region) throw new Error("Pas de relief LiDAR lisible pour cette parcelle.");
    // rééchantillonnage bilinéaire d'une lecture LiDAR sur la grille du rapport
    const toGrid = (rg) => { const projDef = rg.projection || (typeof EPSG_3979_DEF !== "undefined" ? EPSG_3979_DEF : null); if (!projDef) throw new Error("Projection du relief inconnue.");
      const fwd = proj(utm, projDef), src = rg.data, sw = rg.width, sh = rg.height, sB = rg.sourceBBox, spanX = sB[2] - sB[0], spanY = sB[3] - sB[1], out = new Float32Array(W * H);
      for (let r = 0; r < H; r++) { const y = maxY - (r + 0.5) * res; for (let c = 0; c < W; c++) {
        const x = minX + (c + 0.5) * res, i = r * W + c, m = fwd.forward([x, y]), col = ((m[0] - sB[0]) / spanX) * sw - 0.5, row = ((sB[3] - m[1]) / spanY) * sh - 0.5;
        if (col < -0.5 || row < -0.5 || col > sw - 0.5 || row > sh - 0.5) { out[i] = NaN; continue; }
        const cc = Math.max(0, Math.min(sw - 1, col)), rr = Math.max(0, Math.min(sh - 1, row)), c0 = Math.floor(cc), r0 = Math.floor(rr), c1 = Math.min(sw - 1, c0 + 1), r1 = Math.min(sh - 1, r0 + 1), fc = cc - c0, fr2 = rr - r0;
        const v = (src[r0 * sw + c0] * (1 - fc) + src[r0 * sw + c1] * fc) * (1 - fr2) + (src[r1 * sw + c0] * (1 - fc) + src[r1 * sw + c1] * fc) * fr2;
        out[i] = Number.isFinite(v) && v > -900 && v < 9000 ? v : NaN;
      } } return out; };
    const dem = toGrid(region), mask = new Uint8Array(W * H), readSize = Math.max(64, Math.min(2048, Math.max(W, H) * 2));
    for (let r = 0; r < H; r++) { const y = maxY - (r + 0.5) * res; for (let c = 0; c < W; c++) if (C.inGeom([minX + (c + 0.5) * res, y], polysU)) mask[r * W + c] = 1; }
    const st = C.relief(dem, W, H, res, mask); if (!st) throw new Error("Relief LiDAR incomplet sur cette parcelle.");
    // images : élévation (teintes + ombrage) et classes de pente
    const paint = (fn) => { const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d"), im = ctx.createImageData(W, H); for (let i = 0; i < W * H; i++) { const c = fn(i); if (!c) continue; im.data[4 * i] = c[0]; im.data[4 * i + 1] = c[1]; im.data[4 * i + 2] = c[2]; im.data[4 * i + 3] = 255; } ctx.putImageData(im, 0, 0); return cv.toDataURL("image/png"); };
    const ramp = [[0, 76, 29, 149], [0.15, 124, 58, 237], [0.3, 37, 99, 235], [0.45, 13, 148, 136], [0.6, 22, 163, 74], [0.75, 234, 179, 8], [0.88, 234, 88, 12], [1, 220, 38, 38]], /* mêmes teintes que la couche « Relief » de la carte */ span = Math.max(0.05, st.zMax - st.zMin);
    const elevImg = paint((i) => { const z = st.z[i]; if (z !== z) return null; const t = Math.max(0, Math.min(1, (z - st.zMin) / span)); let k = 1; while (k < ramp.length - 1 && t > ramp[k][0]) k++; const a = ramp[k - 1], bb = ramp[k], u = (t - a[0]) / (bb[0] - a[0] || 1);
      const dx = ((st.z[i + 1] || z) - (st.z[i - 1] || z)) / (2 * res), dy = ((st.z[i - W] || z) - (st.z[i + W] || z)) / (2 * res), shade = Math.max(0.55, Math.min(1.2, 1 + 6 * (-dx + dy) / Math.sqrt(1 + 36 * (dx * dx + dy * dy))));
      return [1, 2, 3].map((q) => Math.max(0, Math.min(255, (a[q] + (bb[q] - a[q]) * u) * shade))); });
    // topographie : teintes agrandies, puis courbes de niveau tracées par-dessus (maîtresses plus épaisses et cotées)
    const interval = C.contourInterval(st.zMax - st.zMin), lines = C.contours(st.z, W, H, interval);
    const topoImg = await new Promise((done) => { const base = new Image(); base.onload = () => {
      const S = Math.max(2, Math.min(6, Math.round(1500 / Math.max(W, H)))), cv = document.createElement("canvas"); cv.width = W * S; cv.height = H * S; const ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = true; ctx.drawImage(base, 0, 0, cv.width, cv.height); ctx.lineCap = "round";
      const X = (v) => (v + 0.5) * S, labels = [];
      lines.forEach((ln) => { ctx.beginPath(); ln.segs.forEach((g) => { ctx.moveTo(X(g[0]), X(g[1])); ctx.lineTo(X(g[2]), X(g[3])); }); ctx.strokeStyle = ln.major ? "rgba(40,28,12,0.95)" : "rgba(40,28,12,0.6)"; ctx.lineWidth = ln.major ? Math.max(1.6, S * 0.5) : Math.max(0.7, S * 0.2); ctx.stroke();
        const inside = ln.segs.filter((g) => mask[Math.max(0, Math.min(H - 1, Math.round(g[1]))) * W + Math.max(0, Math.min(W - 1, Math.round(g[0])))]); if ((ln.major || lines.length <= 8) && inside.length > 6) { const fs = Math.max(W, H) * 0.02, far = (g) => labels.every((lb) => Math.hypot(lb.at[0] - g[0], lb.at[1] - g[1]) > fs * 4.2), at = [0.5, 0.35, 0.65, 0.2, 0.8].map((q) => inside[Math.floor(inside.length * q)]).find(far); if (at) labels.push({ level: ln.level, at }); } }); // cotes écartées les unes des autres
      ctx.font = `600 ${Math.round(Math.max(W, H) * S * 0.017)}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      labels.forEach((lb) => { const t = C.fr(lb.level, Math.abs(lb.level - Math.round(lb.level)) < 1e-6 ? 0 : interval === 0.25 ? 2 : 1) + " m", x = X(lb.at[0]), y = X(lb.at[1]); ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = Math.max(3, Math.max(W, H) * S * 0.0045); ctx.strokeText(t, x, y); ctx.fillStyle = "#281c0c"; ctx.fillText(t, x, y); });
      done(cv.toDataURL("image/png")); }; base.onerror = () => done(elevImg); base.src = elevImg; });
    // Plusieurs relevés LiDAR ? Le plus ancien et le plus récent qui couvrent le champ sont comparés.
    let niv = null, nivImg = null;
    try { niv = await withTimeout(compareSurveys(bboxWgs, Math.max(64, Math.min(1024, Math.max(W, H))), toGrid, mask, W, H, res, signal), 80000); } catch (e) { niv = null; }
    if (niv && niv.significant) { const range = Math.max(0.3, Math.min(1.5, Math.ceil(niv.p98 * 10) / 10)), lo = [140, 81, 10], mid = [245, 245, 245], hi = [1, 102, 94]; niv.range = range;
      nivImg = paint((i) => { const v = niv.d[i]; if (v !== v) return null; const t = Math.max(-1, Math.min(1, v / range)), a = Math.pow(Math.abs(t), 0.7), to = t < 0 ? lo : hi; return [0, 1, 2].map((q) => mid[q] + (to[q] - mid[q]) * a); }); }
    if (niv) delete niv.d;
    return { stats: st, res, contour: interval, niv, images: { elev: topoImg, niv: nivImg }, corners: cs, grid: { z: st.z, slope: st.slope, geo: st.geo, W, H, res, minX, maxY, utm } };
  }
  async function cultures(geom) {
    const lib = (typeof flatgeobuf !== "undefined" ? flatgeobuf : null) || window.flatgeobuf, des = lib && (typeof lib.deserialize === "function" ? lib.deserialize.bind(lib) : lib.geojson && typeof lib.geojson.deserialize === "function" ? lib.geojson.deserialize.bind(lib.geojson) : null);
    if (!des) throw new Error("Lecture de l'historique indisponible.");
    const b = C.bbox(geom), polys = C.polys(geom), pt = (() => { const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; if (C.inGeom(c, polys)) return c; const r = polys[0][0]; return [(r[0][0] + r[Math.floor(r.length / 2)][0]) / 2, (r[0][1] + r[Math.floor(r.length / 2)][1]) / 2]; })();
    const dl = 0.00015, byYear = new Map();
    for await (const ft of des("https://storage.googleapis.com/geoqc/BDPPAD/bdppad.fgb", { minX: pt[0] - dl, minY: pt[1] - dl, maxX: pt[0] + dl, maxY: pt[1] + dl })) {
      const p = (ft && ft.properties) || {}, yr = Math.round(Number(p.annee ?? p.ANNEE ?? p.year ?? p.YEAR ?? p.an ?? p.AN)), crop = String(p.DESGROPRO ?? p.desgropro ?? p.DESCODPR1 ?? p.descodpr1 ?? p.culture ?? p.CULTURE ?? "").trim();
      if (!(yr >= 1990 && yr <= 2035) || !crop || /^(inconnu|non d[ée]clar[ée])$/i.test(crop)) continue;
      const inside = ft.geometry && C.inGeom(pt, C.polys(ft.geometry)), score = inside ? 2 : 1, cur = byYear.get(yr);
      if (!cur || score > cur.score) byYear.set(yr, { year: yr, crop, score });
    }
    const rot = C.rotation(Array.from(byYear.values())); if (!rot) throw new Error("Aucune déclaration de culture trouvée à cet endroit."); return rot;
  }
  async function climat(lng, lat, signal) {
    const K = window.pfClimat; if (!K || typeof K.load !== "function") throw new Error("Module climat indisponible.");
    const r = await K.load({ lng, lat, signal }), core = K.core, y = r.year, k = Math.max(0, Math.min(core.SEASON_DAYS - 1, r.cur.upto - core.doy(y, 4, 1))), at = r.ref ? { gdd: r.ref.gdd.mean[k], chu: r.ref.chu.mean[k], precip: r.ref.precip.mean[k] } : {};
    return { year: y, station: r.station, cur: r.cur, ref: r.ref, refYears: r.refYears, at, series: r.cur.series, springFrost: r.cur.springFrost !== null ? core.dateOf(y, r.cur.springFrost) : null, fallFrost: r.cur.fallFrost !== null ? core.dateOf(y, r.cur.fallFrost) : null };
  }
  // Stabilité : l'outil existant fait le travail (lecture de plusieurs étés, classement) ; on attend son résultat
  async function stabilite(feature, onNote) {
    const S = window.pfStabilite; if (!S || !S._state || typeof S.openForParcel !== "function") throw new Error("Outil de stabilité indisponible.");
    S.openForParcel(feature);
    try {
      const t0 = Date.now(); let seenRunning = false;
      while (Date.now() - t0 < 150000) {
        await new Promise((r) => setTimeout(r, 700));
        const st = S._state; if (st.running) seenRunning = true;
        if (st.result && st.result.features && st.result.features.length) break;
        if (seenRunning && !st.running && Date.now() - t0 > 6000 && !st.result) { await new Promise((r) => setTimeout(r, 2500)); if (!S._state.result) throw new Error("Stabilité non calculée : pas assez d'années avec une image sans nuage."); }
        if (onNote) onNote(Math.min(95, Math.round((Date.now() - t0) / 900)));
      }
      const res = S._state.result; if (!res || !res.features || !res.features.length) throw new Error("Stabilité non calculée dans le délai prévu.");
      const defs = S.geom.CLASSES, total = res.features.reduce((a, f) => a + (f.properties.superficie_ha || 0), 0) || 1;
      const classes = C.STAB_ORDER.map((code) => { const def = defs.find((x) => x.code === code), f = res.features.find((x) => x.properties.code === code), ha = f ? f.properties.superficie_ha : 0; return { code, label: def ? def.label : code, color: def ? def.color : "#999", ha, share: ha / total }; });
      const p0 = res.features[0].properties, list = Array.isArray(p0.annees) ? p0.annees.join(", ") : String(p0.annees || "");
      const images = (S._state.years || []).filter((y) => y.on && y.pick >= 0 && y.cands[y.pick] && y.cands[y.pick].data).map((y) => { const c = y.cands[y.pick]; let m = c.stats ? c.stats.mean : NaN, sd = c.stats ? c.stats.sd : NaN;
        if (!Number.isFinite(m) || !Number.isFinite(sd)) { let a = 0, q = 0, k = 0; for (let i = 0; i < c.data.length; i++) { const v = c.data[i]; if (v === v && res.rel && res.rel[i] === res.rel[i]) { a += v; q += v * v; k++; } } m = k ? a / k : 0.5; sd = k ? Math.sqrt(Math.max(0, q / k - m * m)) : 0.1; }
        return { year: y.year, date: c.date, mean: m, sd: sd || 0.05, data: Float32Array.from(c.data) }; }).sort((a, b) => a.year - b.year);
      return { classes, years: res.years, list, images, rel: res.rel ? Float32Array.from(res.rel) : null, grid: res.grid || null, fc: { type: "FeatureCollection", features: JSON.parse(JSON.stringify(res.features)).map((f) => { f.properties = { code: f.properties.code }; return f; }) } };
    } finally { try { S.close(); } catch (e) { /* fenêtre déjà fermée */ } }
  }

  // ---------------------------------------------------------------- cartes hors écran
  async function captureMaps(d, geom, onStep) {
    const main = window.map, ms = main.getStyle(), empty = { type: "FeatureCollection", features: [] };
    const outline = { type: "Feature", properties: {}, geometry: geom }, b = C.bbox(geom);
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], maskGeom = { type: "Polygon", coordinates: [world].concat(C.polys(geom).map((p) => p[0])) };
    const sat = ms.sources["google-hybrid-source"] ? Object.assign({}, ms.sources["google-hybrid-source"], { maxzoom: 20 }) : null;
    const sources = { parcel: { type: "geojson", data: outline }, mask: { type: "geojson", data: { type: "Feature", properties: {}, geometry: maskGeom } }, stab: { type: "geojson", data: d.stab ? d.stab.fc : empty } };
    const layers = [{ id: "bg", type: "background", paint: { "background-color": "#eef0ec" } }];
    if (sat) { sources.sat = sat; layers.push({ id: "sat", type: "raster", source: "sat" }); }
    if (ms.sources.pedologie) { sources.pedo = { type: "vector", url: ms.sources.pedologie.url };
      layers.push({ id: "pedo-fill", type: "fill", source: "pedo", "source-layer": "pedologie_quebec", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["coalesce", ["get", "color"], "#b23434"], "fill-opacity": 0.8 } },
        { id: "pedo-line", type: "line", source: "pedo", "source-layer": "pedologie_quebec", paint: { "line-color": "#3b2f1e", "line-width": 1.2 } },
        { id: "pedo-label", type: "symbol", source: "pedo", "source-layer": "pedologie_quebec", layout: { "text-field": ["to-string", ["coalesce", ["get", "Appellation_cartographique"], ""]], "text-size": 12, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#1b1408", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } }); }
    const locLayers = [];
    if (d.reliefImg) { ["elev", "niv"].forEach((k) => { if (!d.reliefImg.images[k]) return; sources[k] = { type: "image", url: d.reliefImg.images[k], coordinates: d.reliefImg.corners }; layers.push({ id: k, type: "raster", source: k, paint: { "raster-opacity": k === "elev" ? 1 : 0.92, "raster-resampling": "linear", "raster-fade-duration": 0 } }); }); }
    if (d.eauImg) { ["rain", "ero"].forEach((k) => { if (!d.eauImg[k]) return; sources[k] = { type: "image", url: d.eauImg[k], coordinates: k === "rain" ? d.eauImg.cornersRain : d.eauImg.corners }; layers.push({ id: k, type: "raster", source: k, paint: { "raster-opacity": k === "ero" ? 0.9 : 1, "raster-resampling": k === "ero" ? "nearest" : "linear", "raster-fade-duration": 0 } }); }); }

    // NDVI de chaque année retenue par l'analyse : la grille lue par l'outil, couleurs étirées autour de la moyenne du champ ce jour-là
    const yearKeys = [];
    if (d.stab && d.stab.images && d.stab.grid) { const g = d.stab.grid, bb = g.bbox, corners = [[bb[0], bb[3]], [bb[2], bb[3]], [bb[2], bb[1]], [bb[0], bb[1]]];
      const ramp = [[165, 0, 38], [244, 109, 67], [254, 224, 139], [255, 255, 191], [166, 217, 106], [26, 152, 80], [0, 104, 55]];
      d.stab.images.forEach((im) => { if (!im.data) return; const lo = Math.max(-0.2, im.mean - 2.5 * im.sd), hi = Math.min(1, Math.max(lo + 0.1, im.mean + 2.5 * im.sd));
        const cv = document.createElement("canvas"); cv.width = g.W; cv.height = g.H; const ctx = cv.getContext("2d"), px = ctx.createImageData(g.W, g.H);
        for (let i = 0; i < g.W * g.H; i++) { const v = im.data[i]; if (v !== v) continue; const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (ramp.length - 1), k = Math.min(ramp.length - 2, Math.floor(t)), u = t - k; px.data[4 * i] = ramp[k][0] + (ramp[k + 1][0] - ramp[k][0]) * u; px.data[4 * i + 1] = ramp[k][1] + (ramp[k + 1][1] - ramp[k][1]) * u; px.data[4 * i + 2] = ramp[k][2] + (ramp[k + 1][2] - ramp[k][2]) * u; px.data[4 * i + 3] = 255; }
        ctx.putImageData(px, 0, 0); const key = "y" + im.year; sources[key] = { type: "image", url: cv.toDataURL("image/png"), coordinates: corners }; layers.push({ id: key, type: "raster", source: key, paint: { "raster-resampling": "nearest", "raster-fade-duration": 0 } }); yearKeys.push(key); }); }
    const stabColor = ["match", ["get", "code"]]; (d.stab ? d.stab.classes : []).forEach((k) => stabColor.push(k.code, k.color)); stabColor.push("#999999");
    layers.push({ id: "stab", type: "fill", source: "stab", paint: { "fill-color": d.stab ? stabColor : "#999999", "fill-opacity": 0.9 } },
      { id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#ffffff", "fill-opacity": 0.62 } },
      { id: "mask-full", type: "fill", source: "mask", paint: { "fill-color": "#f7f7f4", "fill-opacity": 1 } }, // images NDVI : rien autour du champ, l'image ne couvre que lui
      { id: "line-case", type: "line", source: "parcel", paint: { "line-color": "#ffffff", "line-width": 5 } }, { id: "line", type: "line", source: "parcel", paint: { "line-color": "#17211b", "line-width": 2.2 } });
    const have = new Set(layers.map((l) => l.id)), shotsDef = [["loc", ["sat"].concat(locLayers, ["line-case", "line"])], ["sols", ["sat", "pedo-fill", "pedo-line", "pedo-label", "mask", "line-case", "line"]], ["elev", ["sat", "elev", "mask", "line-case", "line"]], ["niv", ["sat", "niv", "mask", "line-case", "line"]], ["rain", ["sat", "rain", "mask", "line-case", "line"]], ["ero", ["sat", "ero", "mask", "line-case", "line"]], ["stab", ["sat", "stab", "mask", "line-case", "line"]]].concat(yearKeys.map((k) => [k, [k, "mask-full", "line-case", "line"]]))
      .filter((s) => s[0] === "loc" || have.has(s[0] === "sols" ? "pedo-fill" : s[0]));
    // petites cartes d'abord (localisation, images annuelles), puis grandes cartes pleine largeur, au format du champ
    const rank = (k) => (/^y\d/.test(k) ? 0 : k === "loc" ? 1 : 2), isBig = (k) => rank(k) === 2, LOC_W = 1000, LOC_H = 600; shotsDef.sort((a, b2) => rank(a[0]) - rank(b2[0]));
    const ratio = Math.max(0.9, Math.min(0.96, ((b[2] - b[0]) * Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180)) / Math.max(1e-9, b[3] - b[1]))), BIG_W = 1000, BIG_H = Math.round(BIG_W / ratio);
    const scaleOf = (mm, w) => { const ctr = mm.getCenter(), mpp = (40075016.686 * Math.cos((ctr.lat * Math.PI) / 180)) / (512 * Math.pow(2, mm.getZoom())), target = mpp * 140, nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].reverse().find((v) => v <= target) || 5; return { label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, ratio: nice / mpp / w }; }; // ratio : part de la largeur de l'image
    let bigOn = false;
    layers.forEach((l) => { if (l.id !== "bg") l.layout = Object.assign({}, l.layout, { visibility: "none" }); });
    const host = el("div"); host.setAttribute("aria-hidden", "true"); host.style.cssText = `position:fixed;left:-${MAP_W + 2000}px;top:0;width:${MAP_W}px;height:${MAP_H}px;pointer-events:none;`; document.body.appendChild(host);
    let m; const shots = {}, sols = { units: [] };
    try {
      m = new maplibregl.Map({ container: host, style: Object.assign({ version: 8, sources, layers: ms.glyphs ? layers : layers.filter((l) => l.type !== "symbol") }, ms.glyphs ? { glyphs: ms.glyphs } : {}), interactive: false, attributionControl: false, preserveDrawingBuffer: true, pixelRatio: 1.25, fadeDuration: 0, bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 60 } });
      let lastErr = ""; m.on("error", (ev) => { lastErr = String((ev && ev.error && ev.error.message) || lastErr); }); // une tuile manquante ne bloque pas le rapport
      try { await withTimeout(new Promise((ok) => (m.loaded() ? ok() : m.once("load", ok))), 30000); } catch (e) { throw new Error("carte non chargée" + (lastErr ? " : " + lastErr : "")); }
      const idle = () => new Promise((ok) => { let done = false; const fin = () => { if (!done) { done = true; ok(); } }; m.once("idle", fin); m.triggerRepaint(); setTimeout(fin, 12000); });
      for (let s = 0; s < shotsDef.length; s++) {
        onStep(s, shotsDef.length);
        if (shotsDef[s][0] === "loc") { shots.scale = scaleOf(m, MAP_W); host.style.width = LOC_W + "px"; host.style.height = LOC_H + "px"; m.resize(); m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 150, bottom: 150, left: 230, right: 230 }, duration: 0 }); } // le champ et ses environs
        if (!bigOn && isBig(shotsDef[s][0])) { bigOn = true; host.style.width = BIG_W + "px"; host.style.height = BIG_H + "px"; m.resize(); m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 32, duration: 0 }); }
        const vis = new Set(shotsDef[s][1]); layers.forEach((l) => { if (l.id !== "bg" && m.getLayer(l.id)) m.setLayoutProperty(l.id, "visibility", vis.has(l.id) ? "visible" : "none"); });
        await idle();
        if (shotsDef[s][0] === "sols") { // unités de la carte découpées par le champ (les morceaux de tuiles d'une même unité sont réunis), puis réparties entre leurs séries
          const pc = window.polygonClipping, by = new Map();
          if (pc) m.querySourceFeatures("pedo", { sourceLayer: "pedologie_quebec" }).forEach((ft) => { const pr = ft.properties || {}, key = String(pr.Code_polygone || "") + "|" + String(pr.Appellation_cartographique || "") + "|" + String(pr.color || ""); if (!/Polygon$/.test(ft.geometry.type)) return;
            try { const cut = pc.intersection(C.polys(ft.geometry), C.polys(geom)); if (cut.length) { const g = by.get(key); if (g) g.multi = pc.union(g.multi, cut); else by.set(key, { props: pr, multi: cut }); } } catch (e) { /* morceau invalide ignoré */ } });
          const series = new Map(), polysOut = [];
          by.forEach((g) => { const ha = C.areaHa({ type: "MultiPolygon", coordinates: g.multi }); if (!(ha > 0.005)) return; const pr = g.props, parts = [];
            for (let q = 1; q <= 4; q++) { const nm = String(pr["s" + q + "_desc"] || "").trim(), pct = parseFloat(pr["s" + q + "_pct"]); if (nm && pct > 0) parts.push({ name: nm, pct }); }
            if (!parts.length) parts.push({ name: String(pr.Appellation_cartographique || "").trim() || "Sol non décrit", pct: 100 });
            const tot = parts.reduce((a, x) => a + x.pct, 0) || 100;
            parts.forEach((x) => { const u = series.get(x.name) || { name: x.name, ha: 0, color: "#bdbdbd", top: 0 }; const part = (ha * x.pct) / tot; u.ha += part; if (part > u.top && pr.color) { u.top = part; u.color = String(pr.color); } series.set(x.name, u); });
            polysOut.push({ name: parts.slice().sort((a, b2) => b2.pct - a.pct)[0].name, multi: g.multi }); });
          const units = Array.from(series.values()).sort((a, b2) => b2.ha - a.ha), totHa = units.reduce((a, u) => a + u.ha, 0) || 1; units.forEach((u) => { u.share = u.ha / totHa; delete u.top; });
          sols.units = units; sols.polys = polysOut;
        }
        await new Promise((r) => requestAnimationFrame(() => r()));
        shots[shotsDef[s][0]] = m.getCanvas().toDataURL("image/jpeg", 0.82);
        if (shotsDef[s][0] === "loc") { shots.scaleLoc = scaleOf(m, LOC_W); shots.locLots = locLayers.includes("lots"); shots.locEau = locLayers.includes("eau_grhq"); }
      }
      if (bigOn) shots.scaleBig = scaleOf(m, BIG_W);
    } finally { try { if (m) m.remove(); } catch (e) { /* déjà retirée */ } host.remove(); }
    return { shots, sols };
  }
  /*
    Eau et érosion, avec les modèles des outils de l'application (js/sim.js) : même relief, mêmes tables.
    - érosion : le calcul RUSLE du gestionnaire d'érosion, lancé sur la grille de la parcelle sans toucher à son interface ;
    - pluie : la simulation du gestionnaire de pluie, avancée d'un coup jusqu'à 30 minutes de pluie.
  */
  async function eau(parcel, signal) {
    const P = window.pfSim, rm = window.rainManager, em = window.erosionManager;
    if (!P || typeof P.loadParcelDem !== "function") throw new Error("Simulation indisponible.");
    const geom = parcel.geometry, polys = C.polys(geom), b = C.bbox(geom), G = await P.loadParcelDem(parcel, signal), out = { corners: P.getGridCorners(G) };
    const N = G.W * G.H, inside = new Uint8Array(N); for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) { const i = y * G.W + x; if (G.z[i] === G.z[i] && C.inGeom(G.pos(x, y), polys)) inside[i] = 1; }
    let soilKey = "loam", soilLabel = "", crop = { cropKey: "bare", cropLabel: "" };
    if (em) { try { crop = em.detectLatestCrop(parcel.properties || {}) || crop; } catch (e) { /* culture par défaut */ } try { const si = await withTimeout(em.detectSoilTexture((b[1] + b[3]) / 2, (b[0] + b[2]) / 2, parcel.properties || {}), 8000); if (si && si.soilKey) { soilKey = si.soilKey; soilLabel = si.sourceLabel || ""; } } catch (e) { /* loam par défaut */ } }
    const soilName = ((P.SOIL_TYPES[soilKey] || P.SOIL_TYPES.loam).name || "Loam").replace(/\s*\(.*$/, "");
    if (em && typeof em.compute === "function") { // érosion : état du gestionnaire prêté le temps du calcul, puis rendu
      const keep = { grid: em.currentGrid, res: em.eroResult, mean: em.parcelMean, parcel: em.currentParcel, crop: em.cropKey, soil: em.soilKey, r: em.rFactor, usd: em.updateStatsDisplay, rl: em.renderLayer };
      try {
        em.updateStatsDisplay = () => {}; em.renderLayer = () => {}; em.currentParcel = parcel; em.currentGrid = G; em.cropKey = crop.cropKey; em.soilKey = soilKey; em.rFactor = P.estimateRFactor((b[1] + b[3]) / 2, (b[0] + b[2]) / 2);
        em.compute();
        const A = em.eroResult && em.eroResult.A; if (!A) throw new Error("Estimation de l'érosion non disponible.");
        const counts = P.RUSLE_CLASSES.map(() => 0); let n = 0, sum = 0; for (let i = 0; i < N; i++) { if (!inside[i] || !Number.isFinite(A[i])) continue; n++; sum += A[i]; counts[P.RUSLE_CLASSES.findIndex((k) => A[i] < k[0])]++; }
        if (n < 20) throw new Error("Estimation de l'érosion non disponible.");
        out.ero = em.createDataUrl();
        out.erosion = { mean: sum / n, R: em.rFactor, soil: soilName, soilSource: soilLabel, crop: ((P.CROP_FACTORS[crop.cropKey] || {}).name || crop.cropLabel || "Sol nu").replace(/\s*\(.*$/, ""),
          classes: P.RUSLE_CLASSES.map((k, i) => ({ label: String(k[2]).replace(/\s*\(.*$/, ""), short: i === 0 ? "< " + k[0] : i === P.RUSLE_CLASSES.length - 1 ? "> " + P.RUSLE_CLASSES[i - 1][0] : P.RUSLE_CLASSES[i - 1][0] + " à " + k[0], color: `rgb(${k[1].join(",")})`, share: counts[i] / n })) };
      } catch (e) { out.erosionWhy = (e && e.message) || ""; }
      finally { em.currentGrid = keep.grid; em.eroResult = keep.res; em.parcelMean = keep.mean; em.currentParcel = keep.parcel; em.cropKey = keep.crop; em.soilKey = keep.soil; em.rFactor = keep.r; em.updateStatsDisplay = keep.usd; em.renderLayer = keep.rl; }
    }
    if (rm && typeof rm.newRainSim === "function" && !(rm.sim && rm.sim.running)) { // pluie : pas si une simulation tourne déjà à l'écran
      const keepSoil = rm.soilKey, live = document.getElementById("sim-rain-active-canvas"); let sim = null;
      try {
        if (live) live.id = "sim-rain-kept-canvas"; // la simulation affichée garde son canevas
        // grille allégée pour la pluie (au plus 260 cellules de côté) : beaucoup moins de pas de calcul, même tracé à l'échelle du champ
        const kq = Math.max(1, Math.ceil(Math.max(G.W, G.H) / 260)); let Gr = G, insR = inside;
        if (kq > 1) { const W2 = Math.floor(G.W / kq), H2 = Math.floor(G.H / kq), z2 = new Float32Array(W2 * H2), zf2 = G.zf ? new Float32Array(W2 * H2) : null; insR = new Uint8Array(W2 * H2); let valid = 0;
          for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { let a = 0, af = 0, n = 0, ni = 0; for (let q = 0; q < kq; q++) for (let r2 = 0; r2 < kq; r2++) { const i0 = (y * kq + q) * G.W + x * kq + r2, v = G.z[i0]; if (v === v) { a += v; af += G.zf ? G.zf[i0] : v; n++; } if (inside[i0]) ni++; }
            const o = y * W2 + x, ok = n * 2 >= kq * kq; z2[o] = ok ? a / n : NaN; if (zf2) zf2[o] = ok ? af / n : NaN; if (ok) valid++; insR[o] = ok && ni * 2 >= kq * kq ? 1 : 0; }
          Gr = Object.assign({}, G, { W: W2, H: H2, dx: G.dx * kq, dy: G.dy * kq, z: z2, zf: zf2, validCount: valid, key: String(G.key) + "/r" + kq, pos: (x, y) => G.pos(x * kq + (kq - 1) / 2, y * kq + (kq - 1) / 2), toPixel: (lng, lat) => { const q = G.toPixel(lng, lat); return [(q[0] - (kq - 1) / 2) / kq, (q[1] - (kq - 1) / 2) / kq]; } }); }
        out.cornersRain = P.getGridCorners(Gr);
        rm.soilKey = soilKey; sim = rm.newRainSim(Gr);
        const dt = Math.max(1, (Gr.dx + Gr.dy) / 2 / 0.6) * (typeof rm.speed === "number" ? rm.speed : 0.5), t0 = performance.now(), target = 10800;
        for (let k = 0; sim.time < target && performance.now() - t0 < 30000; k++) { rm.rainStep(sim, dt); if (k % 40 === 39) { await new Promise((r) => setTimeout(r, 0)); if (signal && signal.aborted) throw new Error("annulé"); } }
        for (let k = 0; k < 30; k++) rm.drawRain(sim);
        // image agrandie, avec des flèches dans le sens de la pente
        const up = Math.max(1, Math.round(1800 / Math.max(sim.canvas.width, sim.canvas.height))), cv = document.createElement("canvas"); cv.width = sim.canvas.width * up; cv.height = sim.canvas.height * up; const ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true; ctx.drawImage(sim.canvas, 0, 0, cv.width, cv.height);
        const step = Math.max(4, Math.round(Math.max(Gr.W, Gr.H) / 20)), kx = cv.width / Gr.W, ky = cv.height / Gr.H, len = step * kx * 0.32;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        C.arrows(Gr.zf || Gr.z, Gr.W, Gr.H, step, insR).forEach((a) => { const x = (a.x + 0.5) * kx, y = (a.y + 0.5) * ky, x0 = x - (a.ux * len) / 2, y0 = y - (a.uy * len) / 2, x1 = x + (a.ux * len) / 2, y1 = y + (a.uy * len) / 2, hx = a.ux * len * 0.38, hy = a.uy * len * 0.38;
          const draw = () => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x1 - hx + hy * 0.6, y1 - hy - hx * 0.6); ctx.lineTo(x1, y1); ctx.lineTo(x1 - hx - hy * 0.6, y1 - hy + hx * 0.6); ctx.stroke(); };
          ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = len * 0.24; draw(); ctx.strokeStyle = "#0f2a5c"; ctx.lineWidth = len * 0.1; draw(); });
        out.rain = cv.toDataURL("image/png");
        const tot = sim.rain > 0 ? sim.rain : 1; out.rainStats = { intensity: rm.intensity, minutes: Math.round(sim.time / 60), soil: soilName, inf: Math.min(1, sim.inf / tot), out: Math.min(1, sim.out / tot), left: Math.max(0, 1 - sim.inf / tot - sim.out / tot) };
      } catch (e) { out.rainWhy = (e && e.message) || ""; }
      finally { rm.soilKey = keepSoil; if (sim && sim.canvas && sim.canvas.parentNode) sim.canvas.parentNode.removeChild(sim.canvas); if (live) live.id = "sim-rain-active-canvas"; }
    } else out.rainWhy = "Simulation de pluie non lancée : une simulation est déjà en cours à l'écran.";
    if (!out.erosion && !out.rainStats) throw new Error(out.erosionWhy || out.rainWhy || "Simulation indisponible.");
    return out;
  }

  // Croisement : chaque pixel de la grille de stabilité (10 m) reçoit la valeur des autres couches au même endroit
  function croiser(d, geom, reliefGrid, solsUnits) {
    const S = d.stab; if (!S || !S.rel || !S.grid) throw new Error("Croisement non calculé : la stabilité du NDVI n'est pas disponible pour cette parcelle.");
    const { bbox, W, H } = S.grid, n = W * H, polys = C.polys(geom), mask = new Uint8Array(n), lngOf = (x) => bbox[0] + ((x + 0.5) / W) * (bbox[2] - bbox[0]), latOf = (y) => bbox[3] - ((y + 0.5) / H) * (bbox[3] - bbox[1]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (C.inGeom([lngOf(x), latOf(y)], polys)) mask[y * W + x] = 1;
    const layers = [], edge = C.edgeDist(mask, W, H, 10); let forme = null;
    if (reliefGrid && p4()) {
      const g = reliefGrid, toU = p4()("EPSG:4326", g.utm), tpi = C.tpi(g.z, g.W, g.H, Math.max(2, Math.round(50 / g.res))), z = new Float32Array(n).fill(NaN), sl = new Float32Array(n).fill(NaN), tp = new Float32Array(n).fill(NaN); forme = new Array(n).fill("");
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!Number.isFinite(S.rel[i])) continue; const u = toU.forward([lngOf(x), latOf(y)]), c = Math.floor((u[0] - g.minX) / g.res), r = Math.floor((g.maxY - u[1]) / g.res); if (c < 0 || r < 0 || c >= g.W || r >= g.H) continue; const k = r * g.W + c; z[i] = g.z[k]; sl[i] = g.slope[k]; tp[i] = tpi[k]; if (g.geo && g.geo[k] !== 255) forme[i] = C.FORMS[g.geo[k]].label; }
      layers.push({ key: "elev", label: "Élévation", unit: "m", digits: 1, values: z }, { key: "slope", label: "Pente", unit: "%", digits: 1, values: sl }, { key: "tpi", label: "Position dans le relief", unit: "m", digits: 2, values: tp });
    }
    layers.push({ key: "edge", label: "Distance au bord", unit: "m", digits: 0, values: edge });
    let soil = null;
    if (solsUnits && solsUnits.length > 1) { soil = new Array(n).fill(""); const us = solsUnits.filter((u) => u.multi);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!Number.isFinite(S.rel[i])) continue; const pt = [lngOf(x), latOf(y)], u = us.find((q) => C.inGeom(pt, q.multi)); if (u) soil[i] = u.name; } }
    // l'outil de stabilité donne un rapport à la médiane du champ ; on le recentre sur la moyenne du champ, pour que
    // les groupes (sols, formes) se répartissent de part et d'autre de 0
    let sm = 0, sn = 0; for (let i = 0; i < S.rel.length; i++) if (Number.isFinite(S.rel[i])) { sm += S.rel[i]; sn++; }
    const base = sn ? sm / sn : 1, rel = Float32Array.from(S.rel, (v) => v / base - 1);
    const out = C.croisement(rel, layers, soil, forme); if (!out) throw new Error("Croisement non calculé : trop peu de pixels avec une valeur."); return out;
  }

  // ---------------------------------------------------------------- fenêtre
  function shell() {
    let bd = document.getElementById("pf-rapport");
    if (bd) return bd;
    bd = el("div", "rp-backdrop"); bd.id = "pf-rapport"; bd.setAttribute("data-no-i18n", ""); bd.setAttribute("role", "dialog"); bd.setAttribute("aria-modal", "true"); bd.setAttribute("aria-label", "Rapport de parcelle");
    bd.innerHTML = `<div class="rp-bar no-print"><div class="rp-bar-title"><strong>Rapport de parcelle</strong><span id="rp-bar-sub"></span></div>
      <div class="rp-bar-actions"><button type="button" data-act="meta">Personnaliser</button><button type="button" data-act="html">Télécharger HTML</button><button type="button" data-act="print" class="rp-primary">Imprimer / PDF</button><button type="button" data-act="close" aria-label="Fermer">Fermer</button></div></div>
      <div class="rp-loading no-print" id="rp-loading"><div class="rp-loading-box"><strong id="rp-loading-title">Préparation du rapport…</strong><div class="rp-progress"><b id="rp-progress"></b></div><ul id="rp-steps"></ul><button type="button" data-act="close">Annuler</button></div></div>
      <div class="rp-scroll"><nav class="rp-nav no-print" id="rp-nav"></nav><div class="rp-pages" id="rp-pages"></div></div>
      <form class="rp-meta no-print" id="rp-meta" hidden><h3>Personnaliser le rapport</h3>
        <label>Entreprise<input name="company" maxlength="80"/></label><label>Auteur<input name="author" maxlength="80"/></label><label>Préparé pour<input name="client" maxlength="80"/></label>
        <label>Nom de la parcelle<input name="field" maxlength="80"/></label><label>Notes<textarea name="notes" rows="4" maxlength="1200"></textarea></label>
        <label>Logo (image de moins de 600 ko)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"/></label>
        <div class="rp-meta-actions"><button type="button" data-act="logo-clear">Retirer le logo</button><button type="button" data-act="meta-cancel">Annuler</button><button type="submit" class="rp-primary">Appliquer</button></div></form>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", (ev) => { const a = ev.target.closest("[data-act]"); if (!a) return; const act = a.dataset.act;
      if (act === "close") close(); else if (act === "print") print(); else if (act === "html") downloadHtml(); else if (act === "meta") openMeta(); else if (act === "meta-cancel") document.getElementById("rp-meta").hidden = true;
      else if (act === "logo-clear") { const m = meta(); delete m.logo; saveMeta(m); document.getElementById("rp-meta").hidden = true; render(); } });
    bd.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
    document.getElementById("rp-meta").addEventListener("submit", (ev) => { ev.preventDefault(); const fm = ev.target, m = meta();
      ["company", "author", "client", "notes"].forEach((k) => { m[k] = fm.elements[k].value.trim(); });
      state.fieldName = fm.elements.field.value.trim();
      const file = fm.elements.logo.files[0], done = () => { saveMeta(m); fm.hidden = true; render(); };
      if (file && file.size <= MAX_LOGO) { const rd = new FileReader(); rd.onload = () => { m.logo = String(rd.result); done(); }; rd.onerror = done; rd.readAsDataURL(file); } else done(); });
    return bd;
  }
  function openMeta() { const fm = document.getElementById("rp-meta"), m = meta(); ["company", "author", "client", "notes"].forEach((k) => { fm.elements[k].value = m[k] || ""; }); fm.elements.field.value = state.fieldName || (state.data ? state.data.name : ""); fm.elements.logo.value = ""; fm.hidden = false; fm.elements.company.focus(); }
  function render() {
    if (!state.data) return;
    const d = Object.assign({}, state.data, { name: state.fieldName || state.data.name }), box = document.getElementById("rp-pages"), nav = document.getElementById("rp-nav");
    box.innerHTML = C.pages(d, meta());
    nav.innerHTML = ""; box.querySelectorAll(".rp-page").forEach((p, i) => { const bt = el("button", "", `${i + 1}. ${C.esc(p.dataset.title)}`); bt.type = "button"; bt.addEventListener("click", () => p.scrollIntoView({ behavior: "smooth", block: "start" })); nav.appendChild(bt); });
    document.getElementById("rp-bar-sub").textContent = d.name;
    fitPages(box);
  }
  // Une page trop pleine est réduite juste assez pour tenir sur une feuille (jamais de carte coupée à l'impression)
  function fitPages(box) {
    const imgs = Array.from(box.querySelectorAll("img")), ready = Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((ok) => { im.addEventListener("load", ok); im.addEventListener("error", ok); }))));
    ready.then(() => box.querySelectorAll(".rp-page").forEach((pg) => {
      const body = pg.querySelector(".rp-body"); if (!body) return; body.style.zoom = "";
      const limit = pg.offsetWidth * (11 / 8.5); let z = 1;
      for (let k = 0; k < 14 && pg.scrollHeight > limit + 1 && z > 0.6; k++) { z = Math.max(0.6, z * 0.965); body.style.zoom = z.toFixed(3); }
    }));
  }
  function steps(list) { const ul = document.getElementById("rp-steps"); ul.innerHTML = ""; list.forEach((s) => { const li = el("li", "", C.esc(s.label)); li.dataset.key = s.key; ul.appendChild(li); }); }
  function stepState(key, cls, note) { const li = document.querySelector(`#rp-steps li[data-key="${key}"]`); if (!li) return; li.className = cls; if (note) li.title = note; const done = document.querySelectorAll("#rp-steps li.ok, #rp-steps li.ko").length, all = document.querySelectorAll("#rp-steps li").length; document.getElementById("rp-progress").style.width = Math.round((100 * done) / all) + "%"; }
  function close() { state.run++; if (state.ctl) state.ctl.abort(); const bd = document.getElementById("pf-rapport"); if (bd) bd.classList.remove("rp-open"); document.body.classList.remove("pf-rapport-open"); try { if (window.pfStabilite && window.pfStabilite._state && window.pfStabilite._state.running) window.pfStabilite.close(); } catch (e) { /* sans importance */ } }
  function print() { document.body.classList.add("pf-printing-rapport"); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove("pf-printing-rapport"), 600); }, 80); }
  async function downloadHtml() {
    if (!state.data) return;
    let css = ""; try { css = await (await fetch("css/rapport.css")).text(); } catch (e) { css = ""; }
    const d = Object.assign({}, state.data, { name: state.fieldName || state.data.name });
    const html = `<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${C.esc("Rapport de parcelle — " + d.name)}</title>\n<style>${css.replace(/<\/style/gi, "<\\/style")}\nbody{margin:0;background:#dfe3dc}.rp-pages{padding:24px 0}@media print{body{background:#fff}.rp-pages{padding:0}}</style>\n</head>\n<body class="rp-standalone">\n<div class="rp-pages">\n${document.getElementById("rp-pages").innerHTML || C.pages(d, meta())}\n</div>\n</body>\n</html>`;
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.href = url; a.download = `rapport-${String(d.name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "parcelle"}.html`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function openForParcel(feature) {
    if (!feature || !feature.geometry || !/Polygon$/.test(feature.geometry.type)) return;
    let parcel = feature;
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") { try { parcel = window.terrain3DManager.assembleParcelFeature(feature) || feature; } catch (e) { parcel = feature; } }
    const geom = parcel.geometry, props = parcel.properties || {}, my = ++state.run, bd = shell();
    if (state.ctl) state.ctl.abort(); state.ctl = new AbortController(); const signal = state.ctl.signal;
    const pid = props.IDPAR || props.idpar, b = C.bbox(geom), lng = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2, now = new Date();
    state.fieldName = ""; state.feature = parcel; state.data = null;
    const d = { name: props.nom || props.name || (pid ? `Parcelle nº ${pid}` : "Parcelle"), crop: props.DESCODPR1 || props.descodpr1 || "", place: `${C.fr(lat, 4)}° N, ${C.fr(Math.abs(lng), 4)}° O`, areaHa: C.areaHa(geom), dateLabel: `${now.getDate()} ${C.MONTHS[now.getMonth()]} ${now.getFullYear()}` };
    bd.classList.add("rp-open"); document.body.classList.add("pf-rapport-open"); document.getElementById("rp-pages").innerHTML = ""; document.getElementById("rp-nav").innerHTML = ""; document.getElementById("rp-bar-sub").textContent = d.name;
    const loading = document.getElementById("rp-loading"); loading.hidden = false; document.getElementById("rp-progress").style.width = "0%";
    steps([{ key: "relief", label: "Relief LiDAR" }, { key: "eau", label: "Pluie simulée et érosion" }, { key: "cultures", label: "Historique des cultures" }, { key: "climat", label: "Climat de la saison" }, { key: "stab", label: "Images NDVI de plusieurs années (jusqu'à une minute)" }, { key: "cartes", label: "Cartes et sols" }]);
    let reliefGrid = null;
    const t00 = performance.now(), took = (key) => { try { console.info(`[rapport] ${key} : ${((performance.now() - t00) / 1000).toFixed(1)} s`); } catch (e) { /* sans console */ } }; // durées par étape, pour repérer ce qui est lent
    const part = async (key, fn, set, why) => { try { set(await fn()); stepState(key, "ok"); took(key); } catch (e) { if (signal.aborted || my !== state.run) return; d[why] = (e && e.message) || ""; stepState(key, "ko", d[why]); } };
    await Promise.all([
      part("relief", () => withTimeout(relief(geom, signal), 110000), (r) => { d.relief = r.stats; d.reliefRes = r.res; d.contour = r.contour; d.niv = r.niv || null; d.reliefImg = r; reliefGrid = r.grid; }, "reliefWhy"),
      part("eau", () => withTimeout(eau(parcel, signal), 150000), (r) => { d.eau = { rain: r.rainStats || null, erosion: r.erosion || null, rainWhy: r.rainWhy, erosionWhy: r.erosionWhy }; d.eauImg = { rain: r.rain, ero: r.ero, corners: r.corners, cornersRain: r.cornersRain || r.corners }; }, "eauWhy"),
      part("cultures", () => withTimeout(cultures(geom), 30000), (r) => { d.cultures = r; }, "culturesWhy"),
      part("climat", () => withTimeout(climat(lng, lat, signal), 40000), (r) => { d.climat = r; }, "climatWhy"),
      part("stab", () => stabilite(parcel), (r) => { d.stab = r; }, "stabWhy")
    ]);
    if (my !== state.run) return;
    try { const cap = await captureMaps(d, geom, () => {}); d.shots = cap.shots; if (cap.sols.units.length) d.sols = cap.sols; else d.solsWhy = "Carte des sols non disponible à cet endroit."; stepState("cartes", "ok"); took("cartes"); }
    catch (e) { d.shots = d.shots || {}; stepState("cartes", "ko", (e && e.message) || ""); }
    if (my !== state.run) return;
    try { d.croisement = croiser(d, geom, reliefGrid, d.sols ? d.sols.polys : null); } catch (e) { d.croisementWhy = (e && e.message) || ""; }
    delete d.reliefImg; delete d.eauImg; reliefGrid = null; if (d.relief) { delete d.relief.z; delete d.relief.slope; delete d.relief.geo; } if (d.stab) { delete d.stab.rel; delete d.stab.grid; (d.stab.images || []).forEach((im) => { delete im.data; }); } if (d.sols) delete d.sols.polys;
    state.data = d; loading.hidden = true; render();
  }
  window.pfRapport = { openForParcel, close, core: C, _state: state };
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["rapport"] = "b955180c";
