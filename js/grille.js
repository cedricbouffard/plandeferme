/*
  Grille d'échantillonnage régulière
  ----------------------------------
  pfGrille.open({ features, name }) / pfGrille.openForParcel(feature)
  Points sur une grille carrée ou en quinconce, alignée sur le sens du champ, sur un angle saisi ou sur une
  ligne tracée sur la carte dans le sens des rangs, à une
  densité donnée (points par hectare ou par acre). Aperçu sur la carte, puis enregistrement dans Mes données › Échantillonnage.

  Calcul en mètres (projection UTM locale). Le sens du champ est celui du grand côté du plus petit rectangle
  qui contient la parcelle. Les points sont numérotés en serpentin, rang par rang, pour suivre un trajet à pied.
*/
const pfGrilleGeom = {
  ACRE_M2: 4046.8564224,
  MAX_POINTS: 5000,

  utmDef(lng, lat) {
    const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
    return `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
  },
  ringArea(r) { let a = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; },
  multiArea(mp) { let a = 0; for (const p of mp) { a += Math.abs(this.ringArea(p[0])); for (let i = 1; i < p.length; i++) a -= Math.abs(this.ringArea(p[i])); } return a; },
  inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
  inMulti(x, y, mp) {
    for (const poly of mp) {
      if (!poly.length || !this.inRing(x, y, poly[0])) continue;
      let hole = false;
      for (let k = 1; k < poly.length; k++) if (this.inRing(x, y, poly[k])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  },
  // Espacement (m) d'une grille carrée pour une densité donnée
  spacing(density, unit) { const perM2 = density / (unit === "acre" ? this.ACRE_M2 : 10000); return perM2 > 0 ? Math.sqrt(1 / perM2) : 0; },

  hull(pts) { // enveloppe convexe (chaîne monotone d'Andrew)
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  },
  // Sens du champ : azimut (0 = nord, 90 = est, de 0 à 180) du grand côté du plus petit rectangle englobant
  fieldAzimuth(mp) {
    const pts = []; mp.forEach((poly) => poly[0].forEach((c) => pts.push(c)));
    const h = this.hull(pts);
    if (h.length < 3) return 0;
    let best = Infinity, theta = 0;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length], t = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(t), s = Math.sin(t);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of h) { const x = p[0] * c + p[1] * s, y = -p[0] * s + p[1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const w = x1 - x0, ht = y1 - y0;
      if (w * ht < best) { best = w * ht; theta = ht > w ? t + Math.PI / 2 : t; }
    }
    const az = ((90 - (theta * 180) / Math.PI) % 180 + 180) % 180;
    return Math.round(az * 10) / 10;
  },
  // Points de la grille dans le multipolygone (mètres). azimuth : sens des rangs ; s : espacement de la grille carrée.
  // stagger : quinconce (triangles équilatéraux, un rang sur deux décalé d'un demi-pas), à la même densité
  gridMetric(mp, s, azimuth, stagger) {
    if (!(s > 0) || !mp.length) return { points: [], expected: 0 };
    const area = this.multiArea(mp), expected = area / (s * s);
    if (expected > this.MAX_POINTS * 1.5) return { points: [], expected, tooMany: true };
    const t = ((90 - azimuth) * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t), vx = -uy, vy = ux;
    let cx = 0, cy = 0, n = 0;
    mp.forEach((poly) => poly[0].forEach((c) => { cx += c[0]; cy += c[1]; n++; }));
    cx /= n; cy /= n;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    mp.forEach((poly) => poly[0].forEach((c) => { const a = (c[0] - cx) * ux + (c[1] - cy) * uy, b = (c[0] - cx) * vx + (c[1] - cy) * vy; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }));
    const da = stagger ? s * Math.sqrt(2 / Math.sqrt(3)) : s, db = stagger ? (da * Math.sqrt(3)) / 2 : s;
    const make = (oa, ob) => {
      const rows = [];
      // la grille part du bord de la parcelle (dans le repère tourné) : avec un demi-pas, les rangs sont centrés
      for (let k = 0, b = b0 + ob; b <= b1; k++, b = b0 + ob + k * db) {
        const row = [], shift = stagger && k % 2 ? da / 2 : 0;
        for (let a = a0 + oa + shift - da; a <= a1; a += da) { const x = cx + a * ux + b * vx, y = cy + a * uy + b * vy; if (this.inMulti(x, y, mp)) row.push([x, y]); }
        if (row.length) rows.push(row);
      }
      return rows;
    };
    // la grille est glissée d'une fraction de maille pour que le nombre de points colle à la superficie
    let best = null, bestScore = Infinity;
    const steps = [0.5, 0, 0.25, 0.75];
    for (const fa of steps) for (const fb of steps) {
      const rows = make(fa * da, fb * db), count = rows.reduce((x, r) => x + r.length, 0), score = Math.abs(count - expected);
      if (score < bestScore - 1e-9) { bestScore = score; best = rows; }
    }
    const points = [];
    (best || []).forEach((row, i) => { (i % 2 ? row.slice().reverse() : row).forEach((p) => points.push(p)); }); // serpentin
    return { points, expected, da, db };
  },
  // Entités polygonales GeoJSON (WGS84) -> { features: points numérotés, azimuth, spacing, areaHa }
  grid(p4, features, opts) {
    const polysLL = [];
    (features || []).forEach((f) => { const g = f && f.geometry; if (!g) return; if (g.type === "Polygon") polysLL.push(g.coordinates); else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => polysLL.push(p)); });
    if (!polysLL.length) return null;
    const c0 = polysLL[0][0][0], def = this.utmDef(c0[0], c0[1]), fwd = p4("EPSG:4326", def), inv = p4(def, "EPSG:4326");
    const mp = polysLL.map((poly) => poly.map((r) => r.map((c) => fwd.forward([c[0], c[1]]))));
    const auto = this.fieldAzimuth(mp);
    const azimuth = Number.isFinite(opts.azimuth) ? ((opts.azimuth % 180) + 180) % 180 : auto;
    const s = this.spacing(opts.density, opts.unit), res = this.gridMetric(mp, s, azimuth, !!opts.stagger);
    const out = res.points.map((p, i) => {
      const g = inv.forward(p);
      return { type: "Feature", properties: { no: i + 1, nom: "P" + (i + 1), longitude: Math.round(g[0] * 1e6) / 1e6, latitude: Math.round(g[1] * 1e6) / 1e6 }, geometry: { type: "Point", coordinates: [Math.round(g[0] * 1e7) / 1e7, Math.round(g[1] * 1e7) / 1e7] } };
    });
    return { features: out, azimuth, autoAzimuth: auto, spacing: res.da || s, rowSpacing: res.db || s, stagger: !!opts.stagger, areaHa: this.multiArea(mp) / 10000, tooMany: !!res.tooMany, expected: res.expected };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfGrilleGeom };

if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fr = (v, d) => (Number.isFinite(v) ? v.toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const SRC = "grille-preview-source", PTS = "grille-preview-points", LBL = "grille-preview-labels";
  const DIR_SRC = "grille-dir-source", DIR_LINE = "grille-dir-line", DIR_PTS = "grille-dir-points";
  const getP4 = () => window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4) || null;
  const vm = () => window.vectorManager || null;
  const toast = (msg, err) => { const v = vm(); if (v && typeof v.showToast === "function") v.showToast(msg, err); };
  const state = { features: [], name: "", result: null, timer: null, bound: false, autoAngle: true };

  function readOptions() {
    const num = (id) => parseFloat(String(($(id) || {}).value || "").replace(",", "."));
    const density = num("grille-density"), angle = num("grille-angle");
    return { density: Number.isFinite(density) && density > 0 ? density : 0, unit: ($("grille-unit") || {}).value === "acre" ? "acre" : "ha", stagger: ($("grille-layout") || {}).value === "quinconce", azimuth: state.autoAngle || !Number.isFinite(angle) ? NaN : angle };
  }
  function setNote(text, warn) { const el = $("grille-note"); if (!el) return; el.textContent = text || ""; el.classList.toggle("pf-tp-warn", !!warn); }
  function clearPreview() {
    const map = window.map; if (!map || typeof map.getLayer !== "function") return;
    [LBL, PTS].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SRC)) map.removeSource(SRC);
  }
  function showPreview(features) {
    const map = window.map; if (!map || typeof map.addSource !== "function") return;
    const data = { type: "FeatureCollection", features };
    if (map.getSource(SRC)) { map.getSource(SRC).setData(data); return; }
    map.addSource(SRC, { type: "geojson", data });
    map.addLayer({ id: PTS, type: "circle", source: SRC, paint: { "circle-radius": 5.5, "circle-color": "#EE7733", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    try {
      map.addLayer({ id: LBL, type: "symbol", source: SRC, layout: { "text-field": ["to-string", ["get", "no"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, -1.2], "text-allow-overlap": false },
        paint: { "text-color": "#17211b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
    } catch (e) { /* style sans glyphes : pas de numéros */ }
  }

  function compute() {
    const save = $("btn-grille-save"), o = readOptions(), p4 = getP4();
    state.result = null;
    if (save) save.disabled = true;
    if (!o.density) { clearPreview(); setNote("Entrez une densité.", true); return; }
    if (!p4) { setNote("Module de projection indisponible.", true); return; }
    let r = null;
    try { r = pfGrilleGeom.grid(p4, state.features, o); } catch (e) { console.error("Grille d'échantillonnage :", e); }
    if (!r) { clearPreview(); setNote("Calcul impossible pour cette géométrie.", true); return; }
    const sp = $("grille-spacing");
    if (sp) sp.textContent = r.stagger ? `Espacement : ${fr(r.spacing, 1)} m entre les points, ${fr(r.rowSpacing, 1)} m entre les rangs` : `Espacement : ${fr(r.spacing, Math.abs(r.spacing - Math.round(r.spacing)) > 0.05 ? 1 : 0)} m`;
    const angle = $("grille-angle"), auto = $("btn-grille-auto");
    if (state.autoAngle && angle) angle.value = r.azimuth;
    if (auto) auto.classList.toggle("pf-on", state.autoAngle);
    if (r.tooMany) { clearPreview(); setNote(`Trop de points (environ ${fr(r.expected, 0)}) : réduisez la densité.`, true); return; }
    if (!r.features.length) { clearPreview(); setNote("Aucun point : la parcelle est trop petite pour cette densité.", true); return; }
    state.result = r;
    showPreview(r.features);
    setNote(`${r.features.length} point${r.features.length > 1 ? "s" : ""} sur ${fr(r.areaHa, 1)} ha, soit 1 point pour ${fr(r.areaHa / r.features.length, 2)} ha`);
    if (save) save.disabled = false;
  }
  function schedule() { clearTimeout(state.timer); state.timer = setTimeout(compute, 150); }

  // ---- sens des rangs tracé sur la carte : deux clics, le début puis la fin d'un rang ----------------
  // Pendant le tracé, les clics sont interceptés avant la carte : aucune fiche ne s'ouvre.
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
  // Azimut (0 = nord, 90 = est, ramené entre 0 et 180) de la ligne a -> b
  function azimuthOf(a, b) {
    const p4 = getP4(); if (!p4) return NaN;
    const fwd = p4("EPSG:4326", pfGrilleGeom.utmDef(a[0], a[1])), A = fwd.forward(a), B = fwd.forward(b);
    if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1) return NaN; // deux clics au même endroit
    const az = (Math.atan2(B[0] - A[0], B[1] - A[1]) * 180) / Math.PI;
    return Math.round((((az % 180) + 180) % 180) * 10) / 10;
  }
  function stopLine() {
    if (!draw.on) return;
    const map = window.map, c = map && map.getContainer ? map.getContainer() : null;
    if (c && draw.handlers) { c.removeEventListener("click", draw.handlers.click, true); c.removeEventListener("mousedown", draw.handlers.down, true); c.removeEventListener("mousemove", draw.handlers.move, true); }
    if (draw.handlers) document.removeEventListener("keydown", draw.handlers.key, true);
    if (map && map.getCanvas) map.getCanvas().style.cursor = "";
    draw.on = false; draw.p1 = null; draw.handlers = null;
    clearDir();
    const btn = $("btn-grille-draw"); if (btn) { btn.textContent = "Tracer le sens des rangs sur la carte"; btn.classList.remove("pf-on"); }
  }
  function startLine() {
    const map = window.map;
    if (draw.on) { stopLine(); compute(); return; }
    if (!map || typeof map.getContainer !== "function") return;
    draw.on = true; draw.p1 = null;
    const btn = $("btn-grille-draw"); if (btn) { btn.textContent = "Annuler le tracé"; btn.classList.add("pf-on"); }
    setNote("Cliquez sur la carte le début d'un rang, puis sa fin.");
    map.getCanvas().style.cursor = "crosshair";
    const h = draw.handlers = {
      down: (e) => { draw.down = [e.clientX, e.clientY]; },
      move: (e) => { if (draw.p1) showDir(lngLatAt(e)); },
      key: (e) => { if (e.key === "Escape") { e.stopPropagation(); stopLine(); compute(); } },
      click: (e) => {
        if (e.target && e.target.closest && e.target.closest(".maplibregl-ctrl, .maplibregl-popup")) return; // boutons de la carte
        e.stopPropagation(); e.preventDefault();
        if (draw.down && Math.hypot(e.clientX - draw.down[0], e.clientY - draw.down[1]) > 6) return; // déplacement de la carte, pas un clic
        const p = lngLatAt(e);
        if (!draw.p1) { draw.p1 = p; showDir(null); setNote("Cliquez maintenant la fin du rang."); return; }
        const az = azimuthOf(draw.p1, p);
        if (!Number.isFinite(az)) { setNote("Les deux points sont trop proches : cliquez plus loin.", true); return; }
        const angle = $("grille-angle"); if (angle) angle.value = az;
        state.autoAngle = false;
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
    const modal = $("grille-modal"); if (modal) modal.classList.remove("active");
    state.features = []; state.result = null;
  }

  function save() {
    const v = vm(), r = state.result;
    if (!r || !r.features.length) return;
    if (!v || typeof v.createLayerFromCollection !== "function") { setNote("« Mes données » n'est pas disponible.", true); return; }
    const o = readOptions();
    const folderId = typeof v.ensureFolderPath === "function" ? v.ensureFolderPath(["Échantillonnage"], null) : null;
    const folder = folderId && typeof v.getFolder === "function" ? v.getFolder(folderId) : null;
    if (folder) folder.collapsed = false;
    const dens = `${fr(o.density, o.density % 1 ? 2 : 0)} pt/${o.unit === "acre" ? "acre" : "ha"}`;
    const label = `Grille ${dens}${r.stagger ? " en quinconce" : ""} · ${state.name}`;
    const extra = { parcelle: state.name, densite: dens, disposition: r.stagger ? "quinconce" : "carrée", espacement_m: Math.round(r.spacing * 10) / 10, angle_deg: r.azimuth };
    const fc = { type: "FeatureCollection", features: r.features.map((f) => ({ type: "Feature", properties: Object.assign({}, f.properties, extra), geometry: f.geometry })) };
    const layer = v.createLayerFromCollection(fc, label, folderId, { geometryType: "Point", visible: true,
      fields: ["no", "nom", "parcelle", "longitude", "latitude", "densite", "disposition", "espacement_m", "angle_deg"].map((n) => ({ name: n, label: n })),
      style: { fillColor: "#EE7733", fillOpacity: 0.9, strokeColor: "#ffffff", strokeWidth: 2, strokeStyle: "solid", markerShape: "circle", markerSize: 9, labelProperty: "no" } });
    if (!layer) { setNote("Enregistrement impossible.", true); return; }
    if (typeof v.markDirty === "function") v.markDirty(layer);
    if (typeof v.renderLayersList === "function") v.renderLayersList();
    const count = r.features.length;
    close();
    toast(`Grille de ${count} points enregistrée dans Mes données › Échantillonnage › ${label}`);
  }

  function bind() {
    if (state.bound) return; state.bound = true;
    const modal = $("grille-modal"); if (!modal) return;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("btn-grille-close", "click", close);
    on("btn-grille-cancel", "click", close);
    on("btn-grille-save", "click", save);
    on("btn-grille-auto", "click", () => { stopLine(); state.autoAngle = true; compute(); });
    on("btn-grille-draw", "click", startLine);
    on("grille-angle", "input", () => { state.autoAngle = false; });
    modal.addEventListener("input", schedule);
    modal.addEventListener("change", schedule);
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); if (draw.on) { stopLine(); compute(); } else close(); } });
  }

  // features : polygones GeoJSON ; name : nom repris dans la couche enregistrée
  function open(opts) {
    const feats = ((opts && opts.features) || []).filter((f) => f && f.geometry && /Polygon$/.test(f.geometry.type));
    if (!feats.length) { toast("La grille d'échantillonnage demande un polygone.", true); return; }
    const modal = $("grille-modal"); if (!modal) return;
    bind();
    state.features = feats; state.name = String((opts && opts.name) || "Parcelle").slice(0, 80); state.result = null; state.autoAngle = true;
    const src = $("grille-source"); if (src) src.textContent = state.name;
    modal.classList.add("active");
    const d = $("grille-density"); if (d) { d.focus({ preventScroll: true }); if (d.select) d.select(); }
    compute();
  }
  function openForParcel(feature) {
    if (!feature || !feature.geometry) return;
    let parcel = feature;
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") { try { parcel = window.terrain3DManager.assembleParcelFeature(feature) || feature; } catch (e) { parcel = feature; } }
    const p = parcel.properties || {}, pid = p.IDPAR || p.idpar, lot = p.NO_LOT || p.no_lot;
    open({ features: [{ type: "Feature", properties: {}, geometry: parcel.geometry }], name: p.nom || p.name || (pid ? `Parcelle nº ${pid}` : lot ? `Lot nº ${lot}` : "Parcelle") });
  }

  window.pfGrille = { open, openForParcel, close, startLine, stopLine, azimuthOf, geom: pfGrilleGeom };
})();
