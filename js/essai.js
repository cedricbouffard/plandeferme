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
    const rnd = this.rng(o.seed || 1), ids = Array.from({ length: nT }, (_, i) => i);
    const serp = []; // ordre en serpentin, bande par bande
    for (let s = 0; s < si; s++) { const row = cells.filter((c) => c.strip === s); (s % 2 ? row.reverse() : row).forEach((c) => serp.push(c)); }
    if (strip) {
      let perm = [];
      for (let s = 0; s < si; s++) { if (s % nT === 0) perm = this.shuffle(ids, rnd); const tr = perm[s % nT], bl = Math.floor(s / nT) + 1; cells.forEach((c) => { if (c.strip === s) { c.t = tr; c.block = bl; } }); }
    } else if (o.design === "blocs") {
      let perm = [];
      serp.forEach((c, i) => { if (i % nT === 0) perm = this.shuffle(ids, rnd); c.t = perm[i % nT]; c.block = Math.floor(i / nT) + 1; });
    } else if (o.design === "aleatoire") {
      const bag = []; for (let i = 0; i < serp.length; i++) bag.push(i % nT);
      const sh = this.shuffle(bag, rnd); serp.forEach((c, i) => { c.t = sh[i]; c.block = null; });
    } else { // carré latin : chaque traitement une fois par groupe de n parcelles, le long comme en travers
      const perm = this.shuffle(ids, rnd), cop = []; for (let s = 1; s < nT; s++) if (this.gcd(s, nT) === 1) cop.push(s);
      const good = cop.filter((s) => s !== 1 && s !== nT - 1), pool = good.length ? good : cop.length ? cop : [1];
      const shift = pool[Math.floor(rnd() * pool.length)], off = Math.floor(rnd() * nT);
      cells.forEach((c) => { c.t = perm[(((c.strip * shift + c.pos + off) % nT) + nT) % nT]; c.block = null; });
    }
    const plots = serp.map((c) => ({ ring: [toXY(c.a0, c.b0), toXY(c.a1, c.b0), toXY(c.a1, c.b1), toXY(c.a0, c.b1), toXY(c.a0, c.b0)], strip: c.strip + 1, pos: c.pos + 1, block: c.block, t: c.t, w, len: c.len }));
    return { plots, strips: si };
  },
  ringArea(r) { let a = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; },
  multiArea(mp) { let a = 0; for (const p of mp) { a += Math.abs(this.ringArea(p[0])); for (let i = 1; i < p.length; i++) a -= Math.abs(this.ringArea(p[i])); } return a; },
  /*
    Entités polygonales GeoJSON (WGS84) -> dispositif. grille : pfGrilleGeom (projection, sens du champ).
    opts : { treatments (texte), input, unit, design, appWidth, harvWidth, plotWidth (NaN = conseillée), head, side,
             minLen, maxLen, azimuth (NaN = sens du champ), seed, line: [[lng, lat], [lng, lat]] | null }
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
  const state = { features: [], name: "", result: null, timer: null, bound: false, autoAngle: true, autoWidth: true, autoHead: true, autoSide: true, line: null, seed: 1, unit: "m" };
  const tools = {
    inward(mp, d) {
      const T = window.pfTampon && window.pfTampon.geom, C = window.ClipperLib;
      if (!T || !C || typeof T.bufferMetric !== "function") throw new Error("tampon indisponible");
      return T.bufferMetric(C, { type: "MultiPolygon", coordinates: mp }, d, { side: "in" });
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
      minLen: m("essai-min"), maxLen: m("essai-max"), azimuth: state.autoAngle || !Number.isFinite(angle) ? NaN : angle, seed: state.seed, line: state.line
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
  function renderLegend(r) {
    const el = $("essai-legend"); if (!el) return;
    el.innerHTML = "";
    (r && r.summary ? r.summary : []).forEach((s) => {
      const row = document.createElement("div"); row.className = "pf-es-leg";
      const sw = document.createElement("i"); sw.style.background = s.color;
      const name = document.createElement("span"); name.setAttribute("data-no-i18n", ""); name.textContent = s.label;
      const val = document.createElement("span"); val.className = "pf-es-leg-n"; val.textContent = `${s.count} × · ${fr(s.ha, 2)} ha`;
      row.append(sw, name, val); el.appendChild(row);
    });
  }

  function compute() {
    const save = $("btn-essai-save"), exp = $("btn-essai-export"), o = readOptions(), p4 = getP4(), G = grille();
    state.result = null;
    if (save) save.disabled = true;
    if (exp) exp.disabled = true;
    const lenRow = $("essai-len-row"); if (lenRow) lenRow.classList.toggle("pf-es-off", o.design === "bandes");
    if (!p4 || !G) { setNote("Module de projection indisponible.", true); return; }
    // champs en mode automatique : valeurs déduites des largeurs d'équipement
    if (state.autoHead) setVal("essai-head", o.head);
    if (state.autoSide) setVal("essai-side", o.side);
    ["width", "head", "side"].forEach((n) => { const b = $("btn-essai-auto-" + n); if (b) b.classList.toggle("pf-on", state["auto" + n[0].toUpperCase() + n.slice(1)]); });
    if (!(o.appWidth > 0)) { clearPreview(); renderLegend(null); setNote("Entrez la largeur de l'applicateur.", true); return; }
    if (!(o.minLen > 0) || !(o.maxLen >= o.minLen)) { clearPreview(); renderLegend(null); setNote("La longueur maximale doit être au moins égale à la longueur minimale.", true); return; }
    let r = null;
    try { r = pfEssaiGeom.design(p4, G, state.features, o, tools); } catch (e) { console.error("Essai à la ferme :", e); }
    if (!r) { clearPreview(); renderLegend(null); setNote("Calcul impossible pour cette géométrie.", true); return; }
    if (state.autoWidth) setVal("essai-width", r.plotWidth);
    const angle = $("essai-angle"), auto = $("btn-essai-auto");
    if (state.autoAngle && angle) angle.value = r.azimuth;
    if (auto) auto.classList.toggle("pf-on", state.autoAngle);
    const wi = $("essai-width-info");
    if (wi) { const passes = r.plotWidth / o.appWidth, hp = o.harvWidth > 0 ? r.plotWidth / o.harvWidth : NaN; wi.textContent = `Parcelles de ${fr(r.plotWidth, 1)} m : ${fr(passes, passes % 1 ? 1 : 0)} passage(s) d'applicateur` + (Number.isFinite(hp) ? `, ${fr(hp, hp % 1 ? 1 : 0)} de récolteuse` : ""); }
    if (r.treatments.length < 2) { clearPreview(); renderLegend(null); setNote("Entrez au moins deux traitements, séparés par des virgules.", true); return; }
    if (r.tooMany) { clearPreview(); renderLegend(null); setNote("Trop de parcelles : augmentez la largeur ou la longueur des parcelles.", true); return; }
    if (!r.features.length) { clearPreview(); renderLegend(null); setNote("Aucune parcelle d'essai ne tient dans le champ avec ces dimensions.", true); return; }
    state.result = r;
    showPreview(r.features); renderLegend(r);
    const reps = Math.min(...r.summary.map((s) => s.count));
    setNote(`${r.features.length} parcelles d'essai sur ${r.strips} bande(s) · ${fr(r.trialHa, 1)} ha en essai (${fr((100 * r.trialHa) / r.areaHa, 0)} % du champ) · au moins ${reps} répétition(s) par traitement`, reps < 2);
    if (save) save.disabled = false;
    if (exp) exp.disabled = false;
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
    const fc = collection(), name = label(), fields = Object.keys(fc.features[0].properties).map((n) => ({ name: n, label: n }));
    const layer = v.createLayerFromCollection(fc, name, folderId, { geometryType: "Polygon", visible: true, fields,
      style: { fillColor: "#4477AA", fillOpacity: 0.7, strokeColor: "#ffffff", strokeWidth: 1.2, strokeStyle: "solid", markerShape: "circle", markerSize: 8, labelProperty: "traitement", colorProperty: "couleur" } });
    if (!layer) { setNote("Enregistrement impossible.", true); return; }
    if (typeof v.markDirty === "function") v.markDirty(layer);
    if (typeof v.renderLayersList === "function") v.renderLayersList();
    const count = r.features.length;
    close();
    toast(`Essai de ${count} parcelles enregistré dans Mes données › Essais › ${name}`);
  }
  function exportGeoJson() {
    if (!state.result || !state.result.features.length) return;
    const blob = new Blob([JSON.stringify(collection())], { type: "application/geo+json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `essai_${state.name.replace(/[^\w\-]+/g, "_").slice(0, 40)}_${state.result.features.length}parcelles.geojson`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  // changement d'unité (mètres <-> pieds) : les valeurs saisies sont converties
  function switchUnit() {
    const next = ($("essai-units") || {}).value === "pi" ? "pi" : "m";
    if (next === state.unit) return;
    const f = next === "pi" ? 1 / pfEssaiGeom.FT : pfEssaiGeom.FT;
    ["essai-app", "essai-harv", "essai-width", "essai-head", "essai-side", "essai-min", "essai-max"].forEach((id) => { const el = $(id), v = num(id); if (el && Number.isFinite(v)) el.value = Math.round(v * f * (next === "pi" ? 1 : 100)) / (next === "pi" ? 1 : 100); });
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
