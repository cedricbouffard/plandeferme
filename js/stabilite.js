/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Stabilité du NDVI sur plusieurs années
  --------------------------------------
  pfStabilite.open({ features, name }) / pfStabilite.openForParcel(feature)
  Pour chaque été (Sentinel-2), l'outil regarde d'abord les passages du 1er juin au 15 juillet, garde les dates
  où la parcelle est dégagée et assez verte, et retient celle où le NDVI varie le plus dans le champ. Il ne
  regarde la suite de l'été (jusqu'au 30 septembre) que pour les années où cette période n'offre aucune date. Chaque année, le NDVI d'un pixel est comparé à la médiane du champ cette année-là. Les pixels sont
  ensuite classés en cinq catégories : toujours bien, généralement bien, variable, généralement mauvais,
  toujours mauvais (« bien » = au-dessus de la médiane du champ cette année-là, avec une zone neutre de 2 %).
  On peut retirer une année de l'analyse ou choisir une autre date ; le classement se refait sans rien relire.

  Pour choisir les dates, l'outil ne télécharge pas les images : il demande au serveur (Planetary Computer) la
  moyenne, l'écart type et les classes de nuages dans le contour de la parcelle, soit environ 1 Ko par passage.
  Seules les images des dates retenues sont ensuite lues (zonesManager.fetchNdvi), une par année.
  Polygones : pfZonesCore / pfZonesGeom.
*/
const pfStabGeom = {
  STRICT: [0, 1, 3, 8, 9, 10, 11], // classes SCL écartées pour juger qu'une date est dégagée (ombre et cirrus compris)
  CLASSES: [
    { code: "toujours-bien", label: "Toujours bien", color: "#1a9850" },
    { code: "generalement-bien", label: "Généralement bien", color: "#a6d96a" },
    { code: "variable", label: "Variable", color: "#fdd66b" },
    { code: "generalement-mauvais", label: "Généralement mauvais", color: "#fdae61" },
    { code: "toujours-mauvais", label: "Toujours mauvais", color: "#d73027" }
  ],
  // Retire `steps` pixels le long du bord d'un masque (les 8 voisins doivent être dans le masque)
  erode(mask, W, H, steps) {
    let cur = mask;
    for (let s = 0; s < steps; s++) {
      const nx = new Uint8Array(W * H);
      for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) { const i = r * W + c; if (cur[i] && cur[i - 1] && cur[i + 1] && cur[i - W] && cur[i + W] && cur[i - W - 1] && cur[i - W + 1] && cur[i + W - 1] && cur[i + W + 1]) nx[i] = 1; }
      cur = nx;
    }
    return cur;
  },
  // Statistiques d'un passage dans la parcelle. mask : 1 dans la parcelle ; near : 1 dans la parcelle et sa bordure
  sceneStats(data, scl, mask, near) {
    const n = mask.length; let inN = 0, bad = 0, s = 0, ss = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (!near[i]) continue;
      const cloudy = this.STRICT.includes(scl[i]);
      if (mask[i]) { inN++; }
      if (cloudy) { bad++; continue; }
      const v = data[i];
      if (mask[i] && Number.isFinite(v)) { s += v; ss += v * v; c++; }
    }
    let nearN = 0; for (let i = 0; i < n; i++) if (near[i]) nearN++;
    const mean = c ? s / c : NaN;
    return { clear: nearN ? 1 - bad / nearN : 0, valid: inN ? c / inN : 0, mean, sd: c ? Math.sqrt(Math.max(0, ss / c - mean * mean)) : NaN };
  },
  // Réponse du service de statistiques (moyenne et écart type du NDVI, effectif par classe SCL) -> même forme
  // que sceneStats ; null si la réponse n'a pas la forme attendue
  remoteStats(json) {
    const st = json && json.properties && json.properties.statistics, v = st ? Object.values(st) : [];
    if (v.length < 2 || !v[1] || !Array.isArray(v[1].histogram)) return null;
    const counts = v[1].histogram[0], edges = v[1].histogram[1];
    if (!Array.isArray(counts) || !Array.isArray(edges) || edges.length !== counts.length + 1 || edges[0] !== 0 || edges[1] !== 1) return null; // une case par classe
    let tot = 0, bad = 0; counts.forEach((c, k) => { tot += c; if (this.STRICT.includes(k)) bad += c; });
    if (!(tot > 0) || !Number.isFinite(v[0].mean)) return null;
    // « valid_percent » du service compte aussi les pixels du rectangle englobant situés hors du contour : pour une
    // parcelle qui n'est pas un rectangle, il est toujours bas. On ne s'y fie pas ; les pixels sans donnée sont déjà
    // comptés comme non dégagés par la classe 0.
    return { clear: 1 - bad / tot, valid: 1, mean: v[0].mean, sd: v[0].std };
  },
  // Une date est utilisable si la parcelle est dégagée (au moins 99 %) et lisible presque partout
  usable(st) { return st.clear >= 0.99 && st.valid >= 0.97 && Number.isFinite(st.mean); },
  EARLY_END: "07-15", // fin de la période privilégiée (1er juin au 15 juillet)
  isEarly(date) { return String(date).slice(5) <= this.EARLY_END; },
  // Meilleure date d'une année : parmi les dates utilisables et assez vertes, celle où le NDVI varie le plus.
  // Les dates de juin et du début de juillet passent d'abord ; une date plus tardive n'est retenue que si la
  // période privilégiée n'offre aucune date dégagée et assez verte.
  pickBest(cands, minMean) {
    const best = (keep) => { let b = -1; cands.forEach((c, i) => { if (keep(c) && this.usable(c.stats) && c.stats.mean >= minMean && (b < 0 || c.stats.sd > cands[b].stats.sd)) b = i; }); return b; };
    const early = best((c) => this.isEarly(c.date));
    return early >= 0 ? early : best(() => true);
  },
  /*
    grids : une grille NDVI par année retenue (Float32Array, NaN = sans donnée) ; mask : pixels de la parcelle.
    always, usually : parts des années (0 à 1) exigées pour « toujours » et pour « généralement ».
    « Bien » = au-dessus de la médiane du champ cette année-là ; « mauvais » = en dessous ; tol : zone neutre
    autour de la médiane (0,02 = 2 %).
    -> { labels (Int32Array : 0 toujours bien, 1 généralement bien, 2 variable, 3 généralement mauvais,
         4 toujours mauvais, -1 hors parcelle), rel (NDVI relatif moyen, 1 = moyenne), means }
  */
  classify(grids, mask, always, usually, tol) {
    if (!(usually <= always)) usually = always;
    tol = tol >= 0 ? tol : 0.02;
    const n = mask.length, Y = grids.length, labels = new Int32Array(n).fill(-1), rel = new Float32Array(n).fill(NaN);
    // référence de l'année : médiane du champ (peu sensible à une mare, une plaque de sol nu ou un pixel de bordure)
    const means = grids.map((g) => { const v = []; for (let i = 0; i < n; i++) if (mask[i] && Number.isFinite(g[i])) v.push(g[i]); if (!v.length) return NaN; v.sort((a, b) => a - b); const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; });
    const need = Math.max(1, Math.ceil(Y / 2)); // un pixel doit être lisible au moins une année sur deux
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      let up = 0, down = 0, c = 0, r = 0;
      // zone neutre : à moins de `tol` de la référence, l'année ne compte ni comme « bien » ni comme « mauvais »
      for (let y = 0; y < Y; y++) { const v = grids[y][i], m = means[y]; if (!Number.isFinite(v) || !(m > 0)) continue; c++; r += v / m; if (v > m * (1 + tol)) up++; else if (v < m * (1 - tol)) down++; }
      if (c < need) { labels[i] = 2; continue; }
      rel[i] = r / c;
      const pu = up / c, pd = down / c;
      labels[i] = pu >= always ? 0 : pd >= always ? 4 : pu >= usually ? 1 : pd >= usually ? 3 : 2;
    }
    return { labels, rel, means };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfStabGeom };

if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fr = (v, d) => (Number.isFinite(v) ? v.toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const SRC = "stab-preview-source", FILL = "stab-preview-fill", LINE = "stab-preview-line";
  const IMG_SRC = "stab-ndvi-source", IMG = "stab-ndvi-layer";
  const FIRST_YEAR = 2017, STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search", STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics";
  const vm = () => window.vectorManager || null;
  const toast = (msg, err) => { const v = vm(); if (v && typeof v.showToast === "function") v.showToast(msg, err); };
  const state = { features: [], name: "", bound: false, ctl: null, grid: null, years: [], result: null, running: false, autoAlways: true, autoUsually: true, view: null };

  function setNote(text, warn) { const el = $("stab-note"); if (!el) return; el.textContent = text || ""; el.classList.toggle("pf-tp-warn", !!warn); }
  function clearPreview() {
    const map = window.map; if (!map || typeof map.getLayer !== "function") return;
    [LINE, FILL].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SRC)) map.removeSource(SRC);
  }
  // ---- image NDVI d'une date sur la carte (une seule à la fois ; le remplissage des zones est masqué pendant ce temps)
  function hideImage() {
    const map = window.map;
    if (map && typeof map.getLayer === "function") {
      if (map.getLayer(IMG)) map.removeLayer(IMG);
      if (map.getSource(IMG_SRC)) map.removeSource(IMG_SRC);
      if (map.getLayer(FILL)) map.setLayoutProperty(FILL, "visibility", "visible");
    }
    state.view = null;
    const el = $("stab-view"); if (el) el.textContent = "";
  }
  function showImage(y) {
    const map = window.map, c = y && y.pick >= 0 ? y.cands[y.pick] : null;
    if (!map || typeof map.addSource !== "function" || !c) return;
    const sn = (window.NDVI_SENSORS && window.NDVI_SENSORS.s2) || null;
    const query = sn ? (c.offset && sn.tileQueryOffset ? sn.tileQueryOffset : sn.tileQuery) : "assets=B08&assets=B04&asset_as_band=True&expression=" + encodeURIComponent(c.offset ? "(B08-B04)/(B08+B04-2000)" : "(B08-B04)/(B08+B04)");
    // couleurs étirées autour de la moyenne du champ ce jour-là, pour faire ressortir les écarts dans la parcelle
    const lo = Math.max(-0.2, Math.round((c.stats.mean - 2.5 * c.stats.sd) * 100) / 100), hi = Math.min(1, Math.max(lo + 0.1, Math.round((c.stats.mean + 2.5 * c.stats.sd) * 100) / 100));
    if (map.getLayer(IMG)) map.removeLayer(IMG);
    if (map.getSource(IMG_SRC)) map.removeSource(IMG_SRC);
    map.addSource(IMG_SRC, { type: "raster", tileSize: 256, attribution: sn ? sn.attribution : "Sentinel-2 L2A © ESA / Copernicus",
      tiles: [`https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a&item=${encodeURIComponent(c.id)}&${query}&rescale=${encodeURIComponent(lo.toFixed(2) + "," + hi.toFixed(2))}&colormap_name=rdylgn`] });
    map.addLayer({ id: IMG, type: "raster", source: IMG_SRC, paint: { "raster-opacity": 0.95, "raster-fade-duration": 150 } }, map.getLayer(FILL) ? FILL : undefined);
    if (map.getLayer(FILL)) map.setLayoutProperty(FILL, "visibility", "none"); // les contours des zones restent visibles
    state.view = { year: y.year, date: c.date };
    const el = $("stab-view"); if (el) el.textContent = `Image du ${c.date} affichée : du rouge (NDVI ${fr(lo, 2)}) au vert (NDVI ${fr(hi, 2)}). Les couleurs des zones sont masquées pendant ce temps.`;
  }
  function showPreview(features) {
    const map = window.map; if (!map || typeof map.addSource !== "function") return;
    const data = { type: "FeatureCollection", features };
    if (map.getSource(SRC)) { map.getSource(SRC).setData(data); return; }
    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({ id: FILL, type: "fill", source: SRC, layout: { visibility: state.view ? "none" : "visible" }, paint: { "fill-color": ["to-color", ["get", "couleur"], "#fdd66b"], "fill-opacity": 0.75 } });
    map.addLayer({ id: LINE, type: "line", source: SRC, paint: { "line-color": "#ffffff", "line-width": 1.2 } });
  }
  const numOf = (id, def) => { const v = parseFloat(String(($(id) || {}).value || "").replace(",", ".")); return Number.isFinite(v) ? v : def; };
  const minMean = () => Math.max(0, Math.min(0.95, numOf("stab-min", 0.5)));
  // Seuils en nombre d'années sur le total retenu. Tant qu'on n'y touche pas : environ 85 % et 65 % des années.
  // « Généralement » demande toujours plus de la moitié des années, et jamais plus que « toujours ».
  function thresholds(T) {
    const half = Math.floor(T / 2) + 1;
    let a = state.autoAlways ? Math.ceil(0.85 * T) : Math.round(numOf("stab-share", T));
    a = Math.max(half, Math.min(T, a));
    let u = state.autoUsually ? Math.ceil(0.65 * T) : Math.round(numOf("stab-share2", half));
    u = Math.max(half, Math.min(a, u));
    const ia = $("stab-share"), iu = $("stab-share2");
    if (ia) { ia.value = a; ia.max = T; ia.min = half; }
    if (iu) { iu.value = u; iu.max = T; iu.min = half; }
    document.querySelectorAll("#stab-modal .pf-st-total").forEach((el) => { el.textContent = String(T); });
    return { always: a, usually: u };
  }

  // ---- grille de travail : emprise de la parcelle (avec marge), pixels de 10 m, masque de la parcelle ------
  function buildGrid() {
    let b = null; const polys = [];
    state.features.forEach((f) => { const g = f.geometry; if (g.type === "Polygon") polys.push(g.coordinates); else g.coordinates.forEach((p) => polys.push(p)); });
    polys.forEach((p) => p[0].forEach((c) => { b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])] : [c[0], c[1], c[0], c[1]]; }));
    if (!b) return null;
    const lat = (b[1] + b[3]) / 2, mx = 111320 * Math.cos((lat * Math.PI) / 180), my = 111132, pad = 30;
    const bbox = [b[0] - pad / mx, b[1] - pad / my, b[2] + pad / mx, b[3] + pad / my];
    const wM = (bbox[2] - bbox[0]) * mx, hM = (bbox[3] - bbox[1]) * my;
    // mêmes dimensions que celles calculées par fetchNdvi (pixels de 10 m, 8 à 1024 de côté)
    const W = Math.max(8, Math.min(1024, Math.ceil(wM / 10))), H = Math.max(8, Math.min(1024, Math.ceil(hM / 10)));
    const G = (window.pfGrille && window.pfGrille.geom) || null, mask = new Uint8Array(W * H);
    let inside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lng = bbox[0] + ((x + 0.5) / W) * (bbox[2] - bbox[0]), la = bbox[3] - ((y + 0.5) / H) * (bbox[3] - bbox[1]);
      if (G ? G.inMulti(lng, la, polys) : true) { mask[y * W + x] = 1; inside++; }
    }
    const near = new Uint8Array(mask); // parcelle + un pixel de bordure
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x > 0) near[y * W + x - 1] = 1; if (x < W - 1) near[y * W + x + 1] = 1; if (y > 0) near[(y - 1) * W + x] = 1; if (y < H - 1) near[(y + 1) * W + x] = 1; }
    // marge intérieure : les pixels du bord (arbres, fossé, champ voisin) ne servent ni au choix des dates ni au
    // classement ; le résultat est ensuite prolongé jusqu'au contour
    const bufM = Math.max(0, Math.min(50, numOf("stab-buffer", 10))), steps = Math.round(bufM / 10);
    let inner = mask, innerN = inside, statPolys = polys, margin = 0;
    if (steps > 0) {
      const er = pfStabGeom.erode(mask, W, H, steps); let kept = 0; for (let i = 0; i < er.length; i++) kept += er[i];
      if (kept >= Math.max(20, 0.35 * inside)) {
        inner = er; innerN = kept; margin = bufM;
        try { // même retrait sur le contour envoyé au serveur pour les statistiques
          const T = window.pfTampon && window.pfTampon.geom, C = window.ClipperLib, p4 = window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4);
          const out = T && C && p4 ? T.buffer(C, p4, [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polys } }], bufM, { side: "in" }) : [];
          const sp = []; (out || []).forEach((f) => { const g = f.geometry; if (g.type === "Polygon") sp.push(g.coordinates); else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => sp.push(p)); });
          if (sp.length) statPolys = sp;
        } catch (e) { statPolys = polys; }
      }
    }
    return { bbox, W, H, wM, hM, mask, near, inner, innerN, statPolys, margin, marginAsked: bufM, inside, polys, cellHa: ((wM / W) * (hM / H)) / 10000 };
  }

  // ---- passages de l'été pour une année ------------------------------------------------------------------
  async function searchYear(yr, grid, signal) {
    const body = { collections: ["sentinel-2-l2a"], intersects: { type: "Point", coordinates: [(grid.bbox[0] + grid.bbox[2]) / 2, (grid.bbox[1] + grid.bbox[3]) / 2] },
      datetime: `${yr}-06-01T00:00:00Z/${yr}-09-30T23:59:59Z`, query: { "eo:cloud_cover": { lt: 65 } }, limit: 100,
      fields: { include: ["id", "properties.datetime", "properties.eo:cloud_cover", "properties.s2:processing_baseline"], exclude: ["assets", "links", "geometry", "bbox", "collection", "stac_extensions"] } };
    const resp = await fetch(STAC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!resp.ok) throw new Error("STAC " + resp.status);
    const by = new Map();
    ((await resp.json()).features || []).forEach((it) => {
      const p = it.properties || {}, d = String(p.datetime || "").slice(0, 10); if (!d) return;
      if (!by.has(d) || by.get(d).cloud > (p["eo:cloud_cover"] || 0)) by.set(d, { id: it.id, date: d, cloud: p["eo:cloud_cover"] || 0, offset: parseFloat(p["s2:processing_baseline"]) >= 4 || d >= "2022-01-25" });
    });
    return Array.from(by.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Statistiques d'un passage calculées par le serveur (aucune image téléchargée) : nuages, moyenne et variation
  // du NDVI dans le contour rétréci de la marge intérieure (une seule demande par passage)
  async function remoteStats(sc, grid, signal) {
    const q = `collection=sentinel-2-l2a&item=${encodeURIComponent(sc.id)}&assets=B08&assets=B04&assets=SCL&asset_as_band=True&expression=${encodeURIComponent(sc.offset ? "(B08-B04)/(B08+B04-2000);SCL" : "(B08-B04)/(B08+B04);SCL")}&histogram_bins=12&histogram_range=0,12`;
    const resp = await fetch(`${STATS}?${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: grid.statPolys } }), signal });
    return resp.ok ? pfStabGeom.remoteStats(await resp.json()) : null;
  }
  // Image d'une date retenue (lue une seule fois, puis gardée en mémoire)
  function loadData(c, grid, signal) {
    if (c.data) return Promise.resolve(c.data);
    if (!c.loading) {
      c.loading = window.zonesManager.fetchNdvi({ scene: c.id, landsat: false, s2Offset: c.offset, label: "NDVI " + c.date }, grid.bbox, grid.wM, grid.hM, signal).then((g) => {
        if (g.w !== grid.W || g.h !== grid.H) throw new Error("grille inattendue");
        for (let k = 0; k < g.data.length; k++) if (pfStabGeom.STRICT.includes(g.scl[k])) g.data[k] = NaN; // les rares pixels douteux ne comptent pas
        c.data = g.data; return c.data;
      });
      c.loading.catch(() => { c.loading = null; });
    }
    return c.loading;
  }

  // ---- analyse complète : recherche, statistiques de tous les passages, choix des dates ----------------------
  async function run() {
    const zm = window.zonesManager;
    if (state.running) return;
    if (!zm || typeof zm.fetchNdvi !== "function") { setNote("La lecture du NDVI n'est pas disponible.", true); return; }
    classifyRun++;
    const grid = buildGrid();
    if (!grid || grid.inside < 20) { setNote("La parcelle est trop petite pour cette analyse (moins de 0,2 ha).", true); return; }
    if (state.ctl) state.ctl.abort();
    state.ctl = new AbortController(); const signal = state.ctl.signal;
    state.running = true; state.grid = grid; state.years = []; state.result = null;
    hideImage(); clearPreview(); renderYears(); renderResult(); toggleButtons();
    const btn = $("btn-stab-run"); if (btn) btn.disabled = true;
    try {
      const last = new Date().getFullYear(), yrs = []; for (let y = FIRST_YEAR; y <= last; y++) yrs.push(y);
      setNote("Recherche des passages satellites…");
      const lists = await Promise.all(yrs.map((y) => searchYear(y, grid, signal).catch((e) => { if (signal.aborted) throw e; return null; })));
      if (lists.every((l) => l === null)) throw new Error("Le catalogue des images satellites ne répond pas. Réessayez dans un moment.");
      state.years = yrs.map((y, i) => ({ year: y, cands: [], pick: -1, on: true, manual: false, failed: lists[i] === null, scenes: lists[i] || [], lateDone: false }));
      // 1er temps : seulement juin et le début de juillet
      const jobs = []; state.years.forEach((y) => y.scenes.forEach((sc) => { if (pfStabGeom.isEarly(sc.date)) jobs.push({ y, sc }); }));
      await analyse(jobs, grid, signal);
      if (signal.aborted) return;
      pickAll();
      // 2e temps : la suite de l'été, seulement pour les années restées sans date
      await loadLate(grid, signal);
      if (signal.aborted) return;
      state.years = state.years.filter((y) => y.cands.length || y.failed);
      pickAll(); renderYears(); await classify();
    } catch (e) {
      if (!signal.aborted) setNote((e && e.message) || "Analyse impossible.", true);
    } finally {
      state.running = false; if (btn) btn.disabled = false;
    }
  }
  // Statistiques d'une série de passages (par lots), ajoutées aux dates candidates de leur année
  async function analyse(jobs, grid, signal) {
    const zm = window.zonesManager, PAR = 32; let done = 0;
    for (let i = 0; i < jobs.length; i += PAR) {
      if (signal.aborted) return;
      setNote(`Analyse des passages : ${done} sur ${jobs.length}…`);
      await Promise.all(jobs.slice(i, i + PAR).map(async (j) => {
        try {
          const cand = { date: j.sc.date, id: j.sc.id, offset: j.sc.offset, stats: null, data: null };
          let stats = null;
          try { stats = await remoteStats(j.sc, grid, signal); } catch (e) { if (signal.aborted) throw e; stats = null; }
          if (!stats) { // service de statistiques indisponible pour ce passage : lecture de l'image
            const g = await zm.fetchNdvi({ scene: j.sc.id, landsat: false, s2Offset: j.sc.offset, label: "NDVI " + j.sc.date }, grid.bbox, grid.wM, grid.hM, signal);
            if (g.w !== grid.W || g.h !== grid.H) return;
            stats = pfStabGeom.sceneStats(g.data, g.scl, grid.inner, grid.margin ? grid.inner : grid.near);
            for (let k = 0; k < g.data.length; k++) if (pfStabGeom.STRICT.includes(g.scl[k])) g.data[k] = NaN;
            cand.data = g.data;
          }
          if (!pfStabGeom.usable(stats)) return; // seules les dates dégagées sont gardées
          cand.stats = stats;
          j.y.cands.push(cand);
        } catch (e) { if (signal.aborted) throw e; }
        finally { done++; }
      }));
    }
    const moved = new Set(jobs.map((j) => j.y));
    moved.forEach((y) => { const cur = y.pick >= 0 ? y.cands[y.pick] : null; y.cands.sort((a, b) => (a.date < b.date ? -1 : 1)); if (cur) y.pick = y.cands.indexOf(cur); });
  }
  // Années sans date dégagée et assez verte en début de saison : on regarde la suite de l'été (une seule fois)
  async function loadLate(grid, signal) {
    const need = state.years.filter((y) => !y.lateDone && !y.manual && y.pick < 0 && y.scenes.some((sc) => !pfStabGeom.isEarly(sc.date)));
    if (!need.length) return false;
    const jobs = []; need.forEach((y) => { y.lateDone = true; y.scenes.forEach((sc) => { if (!pfStabGeom.isEarly(sc.date)) jobs.push({ y, sc }); }); });
    await analyse(jobs, grid, signal);
    pickAll();
    return true;
  }
  // meilleure date de chaque année (sauf celles choisies à la main) ; une année sans date assez verte est retirée
  function pickAll() {
    const mm = minMean();
    state.years.forEach((y) => {
      const best = pfStabGeom.pickBest(y.cands, mm);
      if (!y.manual || y.pick < 0) { y.pick = best; y.manual = false; }
      y.none = best < 0 && !y.manual;
      y.late = y.pick >= 0 && !pfStabGeom.isEarly(y.cands[y.pick].date);
      // année retirée d'office faute de date ; elle revient d'elle-même si une date est trouvée ensuite
      if (y.none) { if (y.on) { y.on = false; y.autoOff = true; } } else if (y.autoOff) { y.on = true; y.autoOff = false; }
    });
  }

  // ---- classement et polygones (sans relecture) --------------------------------------------------------------
  let classifyRun = 0;
  async function classify() {
    const grid = state.grid, myRun = ++classifyRun; state.result = null;
    if (!grid) return;
    let used = state.years.filter((y) => y.on && y.pick >= 0);
    const missing = used.filter((y) => !y.cands[y.pick].data);
    if (missing.length && used.length >= 2) {
      toggleButtons();
      setNote(`Lecture de ${missing.length} image(s) retenue(s)…`);
      const signal = state.ctl ? state.ctl.signal : undefined;
      await Promise.all(missing.map((y) => loadData(y.cands[y.pick], grid, signal).catch(() => { y.readError = true; })));
      if (myRun !== classifyRun || state.grid !== grid) return; // un autre réglage a été fait entre-temps
      used = state.years.filter((y) => y.on && y.pick >= 0 && y.cands[y.pick].data);
    }
    if (used.length < 2) { clearPreview(); renderResult(); toggleButtons(); setNote(missing.some((y) => y.readError) ? "Les images retenues n'ont pas pu être lues. Réessayez dans un moment." : state.years.length ? "Il faut au moins deux années pour comparer. Cochez d'autres années ou baissez le NDVI minimal." : "Aucune date dégagée et assez verte n'a été trouvée.", true); return; }
    const T = used.length, th = thresholds(T), tol = Math.max(0, Math.min(20, numOf("stab-tol", 2))) / 100;
    const { W, H } = grid, cl = pfStabGeom.classify(used.map((y) => y.cands[y.pick].data), grid.inner, th.always / T - 1e-9, th.usually / T - 1e-9, tol);
    const ZG = typeof pfZonesGeom !== "undefined" ? pfZonesGeom : window.pfZonesGeom;
    const core = pfZonesCore(), K = pfStabGeom.CLASSES.length, minPatch = Math.max(4, Math.round(0.1 / grid.cellHa)); // îlots de moins de 0,1 ha fusionnés
    let L = cl.labels;
    try { L = core.enforceContiguity(core.modeFilter(L, W, H, K, 1, 2), W, H, K, minPatch); } catch (e) { L = cl.labels; }
    const rings = core.traceRings(core.dilate(L, W, H, 3 + Math.round(grid.margin / 10) + 1), W, H, K, 6); // prolongé au-delà du contour, puis découpé
    const pc = window.polygonClipping || null, bb = grid.bbox, toLL = (c) => [Math.round((bb[0] + (c[0] / W) * (bb[2] - bb[0])) * 1e7) / 1e7, Math.round((bb[3] + (c[1] / H) * (bb[3] - bb[1])) * 1e7) / 1e7];
    const lat = (bb[1] + bb[3]) / 2, mx = 111320 * Math.cos((lat * Math.PI) / 180), my = 111132;
    const areaHa = (multi) => { let a = 0; multi.forEach((poly) => poly.forEach((ring, k) => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * mx * ring[i][1] * my - ring[i][0] * mx * ring[j][1] * my; a += (k === 0 ? 1 : -1) * Math.abs(s / 2); })); return a / 10000; };
    const years = used.map((y) => y.year).join(", "), dates = used.map((y) => y.cands[y.pick].date).join(", ");
    const features = []; let total = 0;
    for (let k = 0; k < K; k++) {
      // toMulti travaille en coordonnées de grille (y vers le bas) ; conversion en longitude / latitude ensuite
      let multi = ZG.toMulti(rings[k] || [], 0, 0, 1).map((poly) => poly.map((ring) => ring.map(toLL)));
      if (!multi.length) continue;
      if (pc) { try { multi = pc.intersection(multi, grid.polys); } catch (e) { /* contour gardé tel quel */ } }
      if (!multi.length) continue;
      let s = 0, c = 0; for (let i = 0; i < L.length; i++) if (L[i] === k && Number.isFinite(cl.rel[i])) { s += cl.rel[i]; c++; }
      const ha = areaHa(multi), def = pfStabGeom.CLASSES[k]; total += ha;
      features.push({ type: "Feature", properties: { classe: def.label, code: def.code, superficie_ha: Math.round(ha * 100) / 100, ndvi_relatif_pct: c ? Math.round((s / c) * 1000) / 10 : null, annees: years, dates, nb_annees: used.length, seuil_toujours: th.always, seuil_generalement: th.usually, marge_m: grid.margin, zone_neutre_pct: Math.round(tol * 1000) / 10, parcelle: state.name, couleur: def.color },
        geometry: multi.length === 1 ? { type: "Polygon", coordinates: multi[0] } : { type: "MultiPolygon", coordinates: multi } });
    }
    features.forEach((f) => { f.properties.part_pct = total > 0 ? Math.round((f.properties.superficie_ha / total) * 1000) / 10 : 0; });
    state.result = { features, years: used.length, totalHa: total };
    showPreview(features); renderResult(); toggleButtons();
    setNote(`Classement sur ${T} années, ${fr(total, 1)} ha. « Toujours » : au moins ${th.always} années sur ${T} ; « généralement » : au moins ${th.usually}.` + (grid.marginAsked > 0 && !grid.margin ? " Marge intérieure ignorée : la parcelle est trop étroite." : ""), T < 3);
  }

  // ---- interface -----------------------------------------------------------------------------------------------
  function renderYears() {
    const box = $("stab-years"); if (!box) return;
    box.innerHTML = "";
    state.years.forEach((y) => {
      const row = document.createElement("div"); row.className = "pf-st-year" + (y.on && y.pick >= 0 ? "" : " pf-st-off");
      const lab = document.createElement("label"); lab.className = "pf-es-check";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = y.on && y.pick >= 0; cb.disabled = y.pick < 0; cb.setAttribute("aria-label", String(y.year));
      cb.addEventListener("change", () => { y.on = cb.checked; row.classList.toggle("pf-st-off", !cb.checked); classify(); });
      const nm = document.createElement("strong"); nm.setAttribute("data-no-i18n", ""); nm.textContent = String(y.year);
      lab.append(cb, nm); row.appendChild(lab);
      if (y.cands.length) {
        const sel = document.createElement("select"); sel.className = "pf-tp-select pf-st-date"; sel.setAttribute("data-no-i18n", ""); sel.setAttribute("aria-label", "Date " + y.year);
        const mm = minMean();
        y.cands.forEach((c, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = `${c.date} · NDVI ${fr(c.stats.mean, 2)} · ±${fr(c.stats.sd, 2)}${c.stats.mean < mm ? " ·  ⚠" : ""}`; sel.appendChild(o); });
        if (y.pick >= 0) sel.value = String(y.pick); else { const o = document.createElement("option"); o.value = ""; o.textContent = "—"; sel.prepend(o); sel.value = ""; }
        sel.addEventListener("change", () => { if (sel.value === "") return; y.pick = parseInt(sel.value, 10); y.manual = true; y.none = false; y.on = true; y.late = !pfStabGeom.isEarly(y.cands[y.pick].date); if (state.view && state.view.year === y.year) showImage(y); renderYears(); classify(); });
        row.appendChild(sel);
      }
      if (y.pick >= 0) {
        const on = !!(state.view && state.view.year === y.year), bt = document.createElement("button");
        bt.type = "button"; bt.className = "profile-dock-btn pf-zn-modal-secondary pf-st-see" + (on ? " pf-on" : ""); bt.textContent = on ? "Masquer" : "Voir";
        bt.title = on ? "Retirer l'image de la carte" : "Afficher l'image NDVI de cette date sur la carte"; bt.setAttribute("aria-pressed", on ? "true" : "false");
        bt.addEventListener("click", () => { if (state.view && state.view.year === y.year) hideImage(); else showImage(y); renderYears(); });
        row.appendChild(bt);
      }
      if (y.late) { const tag = document.createElement("span"); tag.className = "pf-st-why pf-st-late"; tag.textContent = "tardive"; tag.title = y.manual ? "Date choisie après le 15 juillet" : "Aucune date dégagée et assez verte entre le 1er juin et le 15 juillet cette année-là : date plus tardive retenue"; row.appendChild(tag); }
      if (y.pick < 0) { const why = document.createElement("span"); why.className = "pf-st-why"; why.textContent = y.failed ? "Recherche impossible" : y.cands.length ? "Aucune date assez verte" : "Aucune date dégagée"; row.appendChild(why); }
      box.appendChild(row);
    });
  }
  function renderResult() {
    const el = $("stab-legend"); if (!el) return;
    el.innerHTML = "";
    (state.result ? state.result.features : []).forEach((f) => {
      const p = f.properties, row = document.createElement("div"); row.className = "pf-es-leg";
      const sw = document.createElement("i"); sw.style.background = p.couleur;
      const name = document.createElement("span"); name.textContent = p.classe;
      const val = document.createElement("span"); val.className = "pf-es-leg-n"; val.textContent = `${fr(p.superficie_ha, 2)} ha · ${fr(p.part_pct, 0)} %`;
      row.append(sw, name, val); el.appendChild(row);
    });
  }
  function toggleButtons() { ["btn-stab-save", "btn-stab-export", "btn-stab-export-shp"].forEach((id) => { const b = $(id); if (b) b.disabled = !(state.result && state.result.features.length); }); }
  const collection = () => ({ type: "FeatureCollection", features: state.result.features });
  const fileBase = () => `stabilite_ndvi_${state.name.replace(/[^\w\-]+/g, "_").slice(0, 40)}_${state.result.years}ans`;
  function save() {
    const v = vm(), r = state.result;
    if (!r || !r.features.length) return;
    if (!v || typeof v.createLayerFromCollection !== "function") { setNote("« Mes données » n'est pas disponible : utilisez Exporter GeoJSON.", true); return; }
    const folderId = typeof v.ensureFolderPath === "function" ? v.ensureFolderPath(["Stabilité NDVI"], null) : null;
    const folder = folderId && typeof v.getFolder === "function" ? v.getFolder(folderId) : null;
    if (folder) folder.collapsed = false;
    const name = `Stabilité NDVI ${r.years} ans · ${state.name}`, fc = collection();
    const layer = v.createLayerFromCollection(fc, name, folderId, { geometryType: "Polygon", visible: true, fields: Object.keys(fc.features[0].properties).map((n) => ({ name: n, label: n })),
      style: { fillColor: "#fdd66b", fillOpacity: 0.7, strokeColor: "#ffffff", strokeWidth: 1.2, strokeStyle: "solid", markerShape: "circle", markerSize: 8, labelProperty: "classe", colorProperty: "couleur" } });
    if (!layer) { setNote("Enregistrement impossible.", true); return; }
    if (typeof v.markDirty === "function") v.markDirty(layer);
    if (typeof v.renderLayersList === "function") v.renderLayersList();
    close();
    toast(`Zones de stabilité enregistrées dans Mes données › Stabilité NDVI › ${name}`);
  }
  function exportGeoJson() {
    if (!state.result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(collection())], { type: "application/geo+json" })), a = document.createElement("a");
    a.href = url; a.download = fileBase() + ".geojson"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function exportShapefile() {
    if (!state.result) return;
    const S = window.PfShapefile, ok = S && typeof S.download === "function" ? await S.download(collection(), fileBase()) : false;
    if (!ok) setNote("Export Shapefile impossible.", true);
  }
  function close() {
    if (state.ctl) state.ctl.abort();
    hideImage(); clearPreview();
    const modal = $("stab-modal"); if (modal) modal.classList.remove("active");
    state.features = []; state.years = []; state.grid = null; state.result = null; state.running = false;
  }
  function bind() {
    if (state.bound) return; state.bound = true;
    const modal = $("stab-modal"); if (!modal) return;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("btn-stab-close", "click", close);
    on("btn-stab-cancel", "click", close);
    on("btn-stab-run", "click", run);
    on("btn-stab-save", "click", save);
    on("btn-stab-export", "click", exportGeoJson);
    on("btn-stab-export-shp", "click", exportShapefile);
    // seuils : pas de relecture, seulement un nouveau choix des dates et un nouveau classement
    on("stab-buffer", "change", () => { if (state.features.length) run(); }); // le contour d'analyse change : tout est relu
    on("stab-min", "change", async () => {
      if (!state.years.length || !state.grid) return;
      pickAll();
      const grid = state.grid, signal = state.ctl ? state.ctl.signal : new AbortController().signal;
      try { await loadLate(grid, signal); } catch (e) { /* lecture interrompue */ }
      if (state.grid !== grid) return;
      renderYears(); classify();
    });
    on("stab-share", "change", () => { state.autoAlways = false; if (state.years.length) classify(); });
    on("stab-share2", "change", () => { state.autoUsually = false; if (state.years.length) classify(); });
    on("stab-tol", "change", () => { if (state.years.length) classify(); });
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  }
  function open(opts) {
    const feats = ((opts && opts.features) || []).filter((f) => f && f.geometry && /Polygon$/.test(f.geometry.type));
    if (!feats.length) { toast("L'analyse de stabilité demande un polygone.", true); return; }
    const modal = $("stab-modal"); if (!modal) return;
    bind();
    if (state.ctl) state.ctl.abort();
    state.features = feats; state.name = String((opts && opts.name) || "Parcelle").slice(0, 80); state.years = []; state.grid = null; state.result = null; state.running = false; state.autoAlways = true; state.autoUsually = true;
    const src = $("stab-source"); if (src) src.textContent = state.name;
    modal.classList.add("active");
    clearPreview(); renderYears(); renderResult(); toggleButtons();
    setNote("");
    run();
  }
  function openForParcel(feature) {
    if (!feature || !feature.geometry) return;
    let parcel = feature;
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") { try { parcel = window.terrain3DManager.assembleParcelFeature(feature) || feature; } catch (e) { parcel = feature; } }
    const p = parcel.properties || {}, pid = p.IDPAR || p.idpar, lot = p.NO_LOT || p.no_lot;
    open({ features: [{ type: "Feature", properties: {}, geometry: parcel.geometry }], name: p.nom || p.name || (pid ? `Parcelle nº ${pid}` : lot ? `Lot nº ${lot}` : "Parcelle") });
  }
  window.pfStabilite = { open, openForParcel, close, run, geom: pfStabGeom, _state: state };
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["stabilite"] = "431b071c";
