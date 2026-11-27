/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Champs voisins de même culture, pour la courbe NDVI
  ---------------------------------------------------
  pfVoisins.load({ lngLat, year, scenes, signal, onProgress }) cherche, autour du point, les champs déclarés avec la
  même culture cette année-là (BDPPAD), garde les plus proches (50 au plus), puis lit pour chaque date Sentinel-2 une
  seule image du secteur et en tire le NDVI moyen de chaque champ, sans ses bordures et sans les nuages.
  -> { crop, fields, radiusKm, dates: [{ id, datetime, n, p10, p50, p90 }] }

  Le cœur (pfVoisinsCore) ne touche ni au réseau ni à la page : il se teste seul.
*/
(function () {
  "use strict";
  const MAX_FIELDS = 50; // champs voisins gardés
  const MARGIN_M = 15; // bordure retirée de chaque champ
  const MAX_PX = 448; // côté maximal de l'image lue par date
  const MIN_CLEAR = 0.7; // part minimale de pixels sans nuage pour garder un champ à une date
  const MIN_FIELDS = 5; // en dessous, pas de médiane pour la date
  const RADII_KM = [2.5, 5]; // rayons de recherche successifs
  const FGB = "https://storage.googleapis.com/geoqc/BDPPAD/bdppad.fgb";
  const PC = "https://planetarycomputer.microsoft.com/api/data/v1";

  const C = {
    MAX_FIELDS, MARGIN_M, MIN_CLEAR, MIN_FIELDS,
    polys(g) { return !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; },
    inRing(pt, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside; } return inside; },
    inGeom(pt, polys) { return polys.some((p) => p.length && this.inRing(pt, p[0]) && !p.slice(1).some((h) => this.inRing(pt, h))); },
    bbox(polys) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; polys.forEach((p) => p[0].forEach((q) => { if (q[0] < a) a = q[0]; if (q[1] < b) b = q[1]; if (q[0] > c) c = q[0]; if (q[1] > d) d = q[1]; })); return [a, b, c, d]; },
    km(a, b) { const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k), y = (b[1] - a[1]) * k; return 6371 * Math.sqrt(x * x + y * y); },
    year(p) { return Math.round(Number(p.an ?? p.AN ?? p.annee ?? p.ANNEE ?? p.year ?? p.YEAR)); },
    crop(p) { return String(p.DESGROPRO ?? p.desgropro ?? p.DESCODPR1 ?? p.descodpr1 ?? p.culture ?? p.CULTURE ?? "").trim(); },
    /*
      Parmi les déclarations autour du point : la culture du champ cliqué pour l'année, puis les champs de même culture,
      du plus proche au plus loin. -> { crop, years, list: [{ polys, bbox, center, km }] } ; crop vide si rien n'est déclaré.
    */
    pick(features, pt, year, max) {
      const years = new Set(), mine = []; let crop = "";
      features.forEach((ft) => { const p = ft.properties || {}, y = this.year(p); if (y >= 1990 && y <= 2100) years.add(y); if (y !== year || !ft.geometry) return; const polys = this.polys(ft.geometry); if (polys.length && this.inGeom(pt, polys)) { mine.push(ft); if (!crop) crop = this.crop(p); } });
      const out = { crop, years: Array.from(years).sort((a, b) => a - b), list: [] };
      if (!crop || /^(inconnu|non d[ée]clar[ée])$/i.test(crop)) { out.crop = ""; return out; }
      const seen = new Set();
      features.forEach((ft) => { const p = ft.properties || {}; if (this.year(p) !== year || this.crop(p) !== crop || !ft.geometry || mine.includes(ft)) return;
        const polys = this.polys(ft.geometry); if (!polys.length) return; const bb = this.bbox(polys), center = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], key = center.map((v) => v.toFixed(5)).join(",");
        if (seen.has(key)) return; seen.add(key); out.list.push({ polys, bbox: bb, center, km: this.km(pt, center) }); });
      out.list.sort((a, b) => a.km - b.km); out.list = out.list.slice(0, max || MAX_FIELDS);
      return out;
    },
    // Grille commune à tous les champs : pixels à peu près carrés, 10 m au plus fin
    grid(list, maxPx) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; list.forEach((f) => { if (f.bbox[0] < a) a = f.bbox[0]; if (f.bbox[1] < b) b = f.bbox[1]; if (f.bbox[2] > c) c = f.bbox[2]; if (f.bbox[3] > d) d = f.bbox[3]; });
      const k = Math.PI / 180, mLng = 111320 * Math.cos(((b + d) / 2) * k), mLat = 111132, pad = 30; a -= pad / mLng; c += pad / mLng; b -= pad / mLat; d += pad / mLat;
      const wM = (c - a) * mLng, hM = (d - b) * mLat, px = Math.max(10, Math.max(wM, hM) / (maxPx || MAX_PX));
      return { bbox: [a, b, c, d], W: Math.max(2, Math.round(wM / px)), H: Math.max(2, Math.round(hM / px)), px };
    },
    // Numéro du champ (1…n) pour chaque pixel dont le centre tombe dedans, 0 ailleurs
    rasterize(list, g) {
      const lab = new Int16Array(g.W * g.H), sx = g.W / (g.bbox[2] - g.bbox[0]), sy = g.H / (g.bbox[3] - g.bbox[1]);
      list.forEach((f, n) => { const c0 = Math.max(0, Math.floor((f.bbox[0] - g.bbox[0]) * sx)), c1 = Math.min(g.W - 1, Math.ceil((f.bbox[2] - g.bbox[0]) * sx)), r0 = Math.max(0, Math.floor((g.bbox[3] - f.bbox[3]) * sy)), r1 = Math.min(g.H - 1, Math.ceil((g.bbox[3] - f.bbox[1]) * sy));
        for (let r = r0; r <= r1; r++) { const y = g.bbox[3] - (r + 0.5) / sy; for (let c = c0; c <= c1; c++) if (!lab[r * g.W + c] && this.inGeom([g.bbox[0] + (c + 0.5) / sx, y], f.polys)) lab[r * g.W + c] = n + 1; } });
      return lab;
    },
    // Retire les bordures : un pixel reste s'il est entouré de pixels du même champ (répété « steps » fois)
    erode(lab, W, H, steps) {
      let cur = lab;
      for (let s = 0; s < steps; s++) { const next = new Int16Array(W * H);
        for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) { const i = r * W + c, v = cur[i]; if (v && cur[i - 1] === v && cur[i + 1] === v && cur[i - W] === v && cur[i + W] === v && cur[i - W - 1] === v && cur[i - W + 1] === v && cur[i + W - 1] === v && cur[i + W + 1] === v) next[i] = v; }
        cur = next; }
      return cur;
    },
    /*
      NDVI moyen de chaque champ pour une image : bandes rouge, proche infrarouge et classes de scène (SCL) sur la grille.
      Un champ compte si au moins MIN_CLEAR de ses pixels sont de la végétation ou du sol nu (classes 4 et 5).
    */
    fieldNdvi(red, nir, scl, lab, nFields, offset) {
      const tot = new Float64Array(nFields + 1), clear = new Float64Array(nFields + 1), sum = new Float64Array(nFields + 1), off = offset || 0;
      for (let i = 0; i < lab.length; i++) { const f = lab[i]; if (!f) continue; tot[f]++; const q = scl[i]; if (q !== 4 && q !== 5) continue; const r = red[i], n = nir[i], den = n + r - 2 * off; if (!(r > 0) || !(n > 0) || !(den > 0)) continue; const v = (n - r) / den; if (v < -0.2 || v > 1) continue; clear[f]++; sum[f] += v; }
      const out = new Float32Array(nFields).fill(NaN);
      for (let f = 1; f <= nFields; f++) if (tot[f] >= 4 && clear[f] >= 4 && clear[f] / tot[f] >= MIN_CLEAR) out[f - 1] = sum[f] / clear[f];
      return out;
    },
    // 10e, 50e et 90e centiles des champs qui ont une valeur ; null s'il y en a trop peu
    quantiles(values, min) {
      const v = Array.from(values).filter((x) => x === x).sort((a, b) => a - b); if (v.length < (min || MIN_FIELDS)) return null;
      const q = (p) => { const pos = p * (v.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos); return v[lo] + (v[hi] - v[lo]) * (pos - lo); };
      return { n: v.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
    },
    // Tableau NumPy (.npy) de forme (bandes, hauteur, largeur)
    npy(buf) {
      const dv = new DataView(buf), u8 = new Uint8Array(buf); if (u8[0] !== 0x93 || u8[1] !== 0x4e) throw new Error("réponse inattendue");
      const v2 = u8[6] >= 2, hl = v2 ? dv.getUint32(8, true) : dv.getUint16(8, true), off = (v2 ? 12 : 10) + hl, head = new TextDecoder("latin1").decode(u8.subarray(v2 ? 12 : 10, off));
      const shape = (/'shape':\s*\(([^)]*)\)/.exec(head) || [])[1], descr = (/'descr':\s*'([^']+)'/.exec(head) || [])[1], dims = String(shape || "").split(",").map((t) => parseInt(t, 10)).filter(Number.isFinite);
      const T = { "<f8": Float64Array, "<f4": Float32Array, "<i2": Int16Array, "<u2": Uint16Array, "<i4": Int32Array, "<u4": Uint32Array, "|u1": Uint8Array, "|i1": Int8Array }[descr];
      if (!T || dims.length !== 3) throw new Error("format non pris en charge (" + descr + ")");
      return { data: new T(buf.slice(off)), bands: dims[0], h: dims[1], w: dims[2] };
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = C;
  if (typeof window === "undefined") return;
  window.pfVoisinsCore = C;

  const cache = new Map(); // champs voisins par point et par année : la recherche n'est faite qu'une fois
  async function neighbours(pt, year, signal) {
    const key = pt.map((v) => v.toFixed(5)).join(",") + "|" + year; if (cache.has(key)) return cache.get(key);
    const lib = (typeof flatgeobuf !== "undefined" ? flatgeobuf : null) || window.flatgeobuf, des = lib && (typeof lib.deserialize === "function" ? lib.deserialize.bind(lib) : lib.geojson && typeof lib.geojson.deserialize === "function" ? lib.geojson.deserialize.bind(lib.geojson) : null);
    if (!des) throw new Error("Lecture des cultures déclarées indisponible.");
    let best = null;
    for (const rKm of RADII_KM) {
      const dLat = rKm / 111.132, dLng = rKm / (111.32 * Math.cos((pt[1] * Math.PI) / 180)), feats = [];
      for await (const ft of des(FGB, { minX: pt[0] - dLng, minY: pt[1] - dLat, maxX: pt[0] + dLng, maxY: pt[1] + dLat })) { if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError"); feats.push(ft); }
      best = C.pick(feats, pt, year, MAX_FIELDS); best.radiusKm = rKm;
      if (!best.crop || best.list.length >= MAX_FIELDS) break;
    }
    cache.set(key, best); cropCache.set(key, best.crop); return best;
  }

  // Culture déclarée au point pour une année (petite lecture, gardée en mémoire) -> "" si rien n'est déclaré
  const cropCache = new Map();
  async function cropAt(lngLat, year, signal) {
    const pt = [lngLat.lng, lngLat.lat], key = pt.map((v) => v.toFixed(5)).join(",") + "|" + year; if (cropCache.has(key)) return cropCache.get(key);
    const lib = (typeof flatgeobuf !== "undefined" ? flatgeobuf : null) || window.flatgeobuf, des = lib && (typeof lib.deserialize === "function" ? lib.deserialize.bind(lib) : lib.geojson && typeof lib.geojson.deserialize === "function" ? lib.geojson.deserialize.bind(lib.geojson) : null);
    if (!des) throw new Error("Lecture des cultures déclarées indisponible.");
    const dl = 0.00015, feats = [];
    for await (const ft of des(FGB, { minX: pt[0] - dl, minY: pt[1] - dl, maxX: pt[0] + dl, maxY: pt[1] + dl })) { if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError"); feats.push(ft); }
    const crop = C.pick(feats, pt, year, 0).crop; cropCache.set(key, crop); return crop;
  }

  async function load(opt) {
    const pt = [opt.lngLat.lng, opt.lngLat.lat], signal = opt.signal, tell = typeof opt.onProgress === "function" ? opt.onProgress : () => {};
    tell({ step: "champs" });
    const nb = await neighbours(pt, opt.year, signal);
    if (!nb.crop) { const last = nb.years.length ? nb.years[nb.years.length - 1] : null; throw new Error(last && last < opt.year ? `Pas de culture déclarée en ${opt.year} pour ce champ (dernière année disponible : ${last}).` : `Pas de culture déclarée en ${opt.year} pour ce champ.`); }
    if (nb.list.length < MIN_FIELDS) throw new Error(`Moins de ${MIN_FIELDS} champs de « ${nb.crop} » à ${RADII_KM[RADII_KM.length - 1]} km ou moins en ${opt.year}.`);
    const g = C.grid(nb.list, MAX_PX), lab = C.erode(C.rasterize(nb.list, g), g.W, g.H, Math.max(1, Math.round(MARGIN_M / g.px))), nF = nb.list.length;
    const kept = new Set(); for (let i = 0; i < lab.length; i++) if (lab[i]) kept.add(lab[i]);
    if (kept.size < MIN_FIELDS) throw new Error("Champs voisins trop étroits une fois les bordures retirées.");
    const out = { crop: nb.crop, fields: kept.size, radiusKm: nb.list.reduce((m, f) => Math.max(m, f.km), 0), dates: [], total: opt.scenes.length, done: 0 };
    const bb = g.bbox.map((v) => v.toFixed(6)).join(","), one = async (sc) => {
      const url = `${PC}/item/bbox/${bb}/${g.W}x${g.H}.npy?collection=sentinel-2-l2a&item=${encodeURIComponent(sc.id)}&assets=B04&assets=B08&assets=SCL&resampling=nearest`;
      try { let r = await fetch(url, { signal }); if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 700 + Math.random() * 800)); r = await fetch(url, { signal }); }
        if (!r.ok) return null; const a = C.npy(await r.arrayBuffer()); if (a.bands < 3 || a.w !== g.W || a.h !== g.H) return null;
        const n = g.W * g.H, q = C.quantiles(C.fieldNdvi(a.data.subarray(0, n), a.data.subarray(n, 2 * n), a.data.subarray(2 * n, 3 * n), lab, nF, sc.offset));
        return q ? Object.assign({ id: sc.id, datetime: sc.datetime }, q) : null;
      } catch (e) { if (e && e.name === "AbortError") throw e; return null; }
    };
    const PAR = 16; // images lues en même temps
    for (let i = 0; i < opt.scenes.length; i += PAR) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      const res = await Promise.all(opt.scenes.slice(i, i + PAR).map(one));
      res.forEach((x) => { if (x) out.dates.push(x); }); out.done = Math.min(opt.scenes.length, i + PAR);
      out.dates.sort((a, b) => new Date(a.datetime) - new Date(b.datetime)); tell({ step: "images", partial: out });
    }
    return out;
  }

  window.pfVoisins = { load, cropAt, core: C };
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["voisins"] = "c4276178";
