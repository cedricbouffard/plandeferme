/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Zones tampons et enregistrement de parcelles
  --------------------------------------------
  - pfTampon.open({ features, name })  : fenêtre « Zone tampon » (distance, côté, bande seule, fusion),
                                         aperçu sur la carte, puis enregistrement dans Mes données › Zones tampons
  - pfTampon.saveParcel(feature)       : copie une parcelle dans la couche « Mes parcelles » de Mes données

  Le tampon est calculé dans le navigateur, en mètres (projection UTM locale), avec la librairie Clipper
  (clipper.min.js) : décalage des contours à coins arrondis, vers l'extérieur ou vers l'intérieur.
*/
const pfTamponGeom = {
  S: 1000, // Clipper calcule en entiers : 1 unité = 1 mm

  utmDef(lng, lat) {
    const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
    return `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
  },
  ringArea(r) { let a = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; },
  multiArea(mp) { let a = 0; for (const p of mp) { a += Math.abs(this.ringArea(p[0])); for (let i = 1; i < p.length; i++) a -= Math.abs(this.ringArea(p[i])); } return a; },

  toPath(pts, closed) {
    const S = this.S, out = [];
    for (let i = 0; i < pts.length; i++) {
      const X = Math.round(pts[i][0] * S), Y = Math.round(pts[i][1] * S), last = out[out.length - 1];
      if (!last || last.X !== X || last.Y !== Y) out.push({ X, Y });
    }
    if (closed && out.length > 1 && out[0].X === out[out.length - 1].X && out[0].Y === out[out.length - 1].Y) out.pop();
    return out;
  },
  // Arbre de résultat Clipper -> multipolygone en mètres (anneaux fermés)
  fromTree(C, tree) {
    const S = this.S, ring = (p) => { const r = p.map((q) => [q.X / S, q.Y / S]); r.push(r[0]); return r; };
    return C.JS.PolyTreeToExPolygons(tree).filter((e) => e.outer && e.outer.length >= 3).map((e) => [ring(e.outer)].concat((e.holes || []).filter((h) => h.length >= 3).map(ring)));
  },
  clip(C, type, subject, clipPaths) {
    const c = new C.Clipper(), tree = new C.PolyTree();
    if (subject.length) c.AddPaths(subject, C.PolyType.ptSubject, true);
    if (clipPaths && clipPaths.length) c.AddPaths(clipPaths, C.PolyType.ptClip, true);
    c.Execute(type, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return tree;
  },
  treePaths(C, tree) { return C.Clipper.PolyTreeToPaths(tree); },
  // Géométrie (mètres) -> points, lignes et anneaux de polygones (extérieurs dans un sens, trous dans l'autre)
  parts(C, geom, out) {
    out = out || { points: [], lines: [], rings: [] };
    const t = geom.type, c = geom.coordinates;
    const poly = (p) => p.forEach((r, i) => { const path = this.toPath(r, true); if (path.length < 3) return; if (C.Clipper.Orientation(path) !== (i === 0)) path.reverse(); out.rings.push(path); });
    if (t === "Point") out.points.push(this.toPath([c]));
    else if (t === "MultiPoint") c.forEach((p) => out.points.push(this.toPath([p])));
    else if (t === "LineString") out.lines.push(this.toPath(c));
    else if (t === "MultiLineString") c.forEach((l) => out.lines.push(this.toPath(l)));
    else if (t === "Polygon") poly(c);
    else if (t === "MultiPolygon") c.forEach(poly);
    else if (t === "GeometryCollection") (geom.geometries || []).forEach((g) => this.parts(C, g, out));
    return out;
  },
  // Tampon d'une géométrie en mètres -> chemins Clipper. opts : { side: "out" | "in", ring: bande seule }
  bufferPaths(C, geom, d, opts) {
    const S = this.S, delta = d * S, src = this.parts(C, geom);
    const offset = (signed) => {
      const co = new C.ClipperOffset(2, Math.max(1, delta * 0.002)), tree = new C.PolyTree(); // arcs : écart d'au plus 0,2 % de la distance
      if (src.rings.length) co.AddPaths(src.rings, C.JoinType.jtRound, C.EndType.etClosedPolygon);
      if (signed > 0) { // points et lignes : toujours vers l'extérieur
        src.lines.forEach((l) => { if (l.length) co.AddPath(l, C.JoinType.jtRound, C.EndType.etOpenRound); });
        src.points.forEach((p) => co.AddPath(p, C.JoinType.jtRound, C.EndType.etOpenRound));
      }
      co.Execute(tree, signed);
      return this.treePaths(C, tree);
    };
    const inside = !!(opts && opts.side === "in") && src.rings.length > 0, ring = !!(opts && opts.ring) && src.rings.length > 0;
    if (inside) { const shrunk = offset(-delta); return ring ? this.treePaths(C, this.clip(C, C.ClipType.ctDifference, src.rings, shrunk)) : shrunk; }
    const grown = offset(delta);
    return ring ? this.treePaths(C, this.clip(C, C.ClipType.ctDifference, grown, src.rings)) : grown;
  },
  bufferMetric(C, geom, d, opts) { return this.fromTree(C, this.clip(C, C.ClipType.ctUnion, this.bufferPaths(C, geom, d, opts))); },
  // Entités GeoJSON (WGS84) -> entités tampon (WGS84) avec superficie
  buffer(C, p4, features, d, opts) {
    opts = opts || {};
    const feats = (features || []).filter((f) => f && f.geometry);
    if (!feats.length || !(d > 0)) return [];
    let sx = 0, sy = 0, n = 0;
    const scan = (c) => { if (typeof c[0] === "number") { sx += c[0]; sy += c[1]; n++; } else c.forEach(scan); };
    feats.forEach((f) => { if (f.geometry.type === "GeometryCollection") f.geometry.geometries.forEach((g) => scan(g.coordinates)); else scan(f.geometry.coordinates); });
    if (!n) return [];
    const def = this.utmDef(sx / n, sy / n), fwd = p4("EPSG:4326", def), inv = p4(def, "EPSG:4326");
    const proj = (c, fn) => (typeof c[0] === "number" ? fn(c) : c.map((x) => proj(x, fn)));
    const toM = (g) => (g.type === "GeometryCollection" ? { type: g.type, geometries: g.geometries.map(toM) } : { type: g.type, coordinates: proj(g.coordinates, (c) => fwd.forward([c[0], c[1]])) });
    const toFeature = (mp, props) => {
      const kept = mp.filter((p) => p.length && Math.abs(this.ringArea(p[0])) > 0.01);
      if (!kept.length) return null;
      const coords = proj(kept, (c) => { const g = inv.forward(c); return [Math.round(g[0] * 1e7) / 1e7, Math.round(g[1] * 1e7) / 1e7]; });
      return { type: "Feature", properties: Object.assign({}, props, { superficie_ha: Math.round(this.multiArea(kept) / 100) / 100 }), geometry: coords.length === 1 ? { type: "Polygon", coordinates: coords[0] } : { type: "MultiPolygon", coordinates: coords } };
    };
    const base = { distance_m: d, cote: opts.side === "in" ? "intérieur" : "extérieur", bande: opts.ring ? "oui" : "non" };
    const results = feats.map((f) => ({ paths: this.bufferPaths(C, toM(f.geometry), d, opts), f }));
    if (opts.dissolve && results.length > 1) { // tampons qui se touchent fusionnés en une seule entité
      const all = []; results.forEach((r) => r.paths.forEach((p) => all.push(p)));
      const out = toFeature(this.fromTree(C, this.clip(C, C.ClipType.ctUnion, all)), Object.assign({ nom: `Tampon ${d} m` }, base));
      return out ? [out] : [];
    }
    return results.map((r, i) => {
      const src = (r.f.properties && (r.f.properties.nom || r.f.properties.name)) || "";
      return toFeature(this.fromTree(C, this.clip(C, C.ClipType.ctUnion, r.paths)), Object.assign({ nom: src ? `Tampon ${d} m · ${src}` : `Tampon ${d} m${results.length > 1 ? " · " + (i + 1) : ""}` }, base));
    }).filter(Boolean);
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfTamponGeom };

if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fr = (v, d) => (Number.isFinite(v) ? v.toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const SRC = "tampon-preview-source", FILL = "tampon-preview-fill", LINE = "tampon-preview-line";
  const getP4 = () => window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4) || null;
  const vm = () => window.vectorManager || null;
  const toast = (msg, err) => { const v = vm(); if (v && typeof v.showToast === "function") v.showToast(msg, err); };

  const state = { features: [], name: "", result: [], timer: null, bound: false };

  function hasPolygons() { return state.features.some((f) => /Polygon/.test(f.geometry.type)); }

  function readOptions() {
    const d = parseFloat(String(($("tampon-distance") || {}).value || "").replace(",", "."));
    const sideEl = document.querySelector('input[name="tampon-side"]:checked');
    return {
      d: Number.isFinite(d) && d > 0 ? Math.min(5000, d) : 0,
      side: hasPolygons() && sideEl && sideEl.value === "in" ? "in" : "out",
      ring: hasPolygons() && !!($("tampon-ring") || {}).checked,
      dissolve: state.features.length > 1 && !!($("tampon-dissolve") || {}).checked
    };
  }

  function setNote(text, warn) {
    const el = $("tampon-note"); if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("pf-tp-warn", !!warn);
  }

  function clearPreview() {
    const map = window.map; if (!map || typeof map.getLayer !== "function") return;
    [LINE, FILL].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SRC)) map.removeSource(SRC);
  }

  function showPreview(features) {
    const map = window.map; if (!map || typeof map.addSource !== "function") return;
    const data = { type: "FeatureCollection", features };
    if (map.getSource(SRC)) map.getSource(SRC).setData(data);
    else {
      map.addSource(SRC, { type: "geojson", data });
      map.addLayer({ id: FILL, type: "fill", source: SRC, paint: { "fill-color": "#EE7733", "fill-opacity": 0.35 } });
      map.addLayer({ id: LINE, type: "line", source: SRC, paint: { "line-color": "#b4500f", "line-width": 2, "line-dasharray": [3, 2] } });
    }
  }

  function compute() {
    const save = $("btn-tampon-save"), o = readOptions();
    state.result = [];
    if (save) save.disabled = true;
    if (!o.d) { clearPreview(); setNote("Entrez une distance en mètres.", true); return; }
    const pc = window.ClipperLib, p4 = getP4();
    if (!pc || !p4) { setNote("Module de géométrie indisponible.", true); return; }
    try {
      state.result = pfTamponGeom.buffer(pc, p4, state.features, o.d, o);
    } catch (e) {
      console.error("Zone tampon :", e);
      clearPreview(); setNote("Calcul impossible pour cette géométrie.", true); return;
    }
    if (!state.result.length) {
      clearPreview();
      setNote(o.side === "in" ? "Rien ne reste à cette distance vers l'intérieur : réduisez la distance." : "Tampon vide.", true);
      return;
    }
    showPreview(state.result);
    const ha = state.result.reduce((a, f) => a + (f.properties.superficie_ha || 0), 0);
    setNote(`Superficie du tampon : ${fr(ha, 2)} ha`);
    if (save) save.disabled = false;
  }
  function schedule() { clearTimeout(state.timer); state.timer = setTimeout(compute, 191); }

  function close() {
    clearTimeout(state.timer);
    clearPreview();
    const modal = $("tampon-modal"); if (modal) modal.classList.remove("active");
    state.features = []; state.result = [];
  }

  function save() {
    const v = vm();
    if (!state.result.length) return;
    if (!v || typeof v.createLayerFromCollection !== "function") { setNote("« Mes données » n'est pas disponible.", true); return; }
    const o = readOptions();
    const folderId = typeof v.ensureFolderPath === "function" ? v.ensureFolderPath(["Zones tampons"], null) : null;
    const folder = folderId && typeof v.getFolder === "function" ? v.getFolder(folderId) : null;
    if (folder) folder.collapsed = false;
    const label = `Tampon ${fr(o.d, o.d % 1 ? 1 : 0)} m${o.side === "in" ? " intérieur" : ""}${o.ring ? " (bande)" : ""} · ${state.name}`;
    const fc = { type: "FeatureCollection", features: state.result.map((f) => ({ type: "Feature", properties: Object.assign({ source: state.name }, f.properties), geometry: f.geometry })) };
    const layer = v.createLayerFromCollection(fc, label, folderId, { geometryType: "Polygon", visible: true,
      style: { fillColor: "#EE7733", fillOpacity: 0.35, strokeColor: "#b4500f", strokeWidth: 2, strokeStyle: "dashed", markerShape: "circle", markerSize: 8, labelProperty: "nom" } });
    if (!layer) { setNote("Enregistrement impossible.", true); return; }
    if (typeof v.markDirty === "function") v.markDirty(layer);
    if (typeof v.renderLayersList === "function") v.renderLayersList();
    close();
    toast(`Zone tampon enregistrée dans Mes données › Zones tampons › ${label}`);
  }

  function bind() {
    if (state.bound) return; state.bound = true;
    const modal = $("tampon-modal"); if (!modal) return;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("btn-tampon-close", "click", close);
    on("btn-tampon-cancel", "click", close);
    on("btn-tampon-save", "click", save);
    modal.addEventListener("input", schedule);
    modal.addEventListener("change", schedule);
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "Enter" && e.target && e.target.id === "tampon-distance") { e.preventDefault(); compute(); if (state.result.length) save(); } });
  }

  // features : entités GeoJSON (points, lignes ou polygones) ; name : nom affiché et repris dans la couche
  function open(opts) {
    const feats = ((opts && opts.features) || []).filter((f) => f && f.geometry && f.geometry.coordinates);
    if (!feats.length) { toast("Aucune géométrie pour créer une zone tampon.", true); return; }
    const modal = $("tampon-modal"); if (!modal) return;
    bind();
    state.features = feats; state.name = String((opts && opts.name) || "Sélection").slice(0, 80); state.result = [];
    const src = $("tampon-source"); if (src) src.textContent = state.name + (feats.length > 1 ? ` (${feats.length} entités)` : "");
    const poly = hasPolygons();
    const polyBox = $("tampon-poly-options"); if (polyBox) polyBox.hidden = !poly;
    const disBox = $("tampon-dissolve-row"); if (disBox) disBox.hidden = feats.length < 2;
    const out = document.querySelector('input[name="tampon-side"][value="out"]'); if (out) out.checked = true;
    const ring = $("tampon-ring"); if (ring) ring.checked = false;
    modal.classList.add("active");
    const dist = $("tampon-distance"); if (dist) { dist.focus({ preventScroll: true }); if (dist.select) dist.select(); }
    compute();
  }

  // ---- enregistrer une parcelle dans Mes données › Mes parcelles ---------------------
  const PARCELS_LAYER = "Mes parcelles";
  function saveParcel(feature) {
    const v = vm();
    if (!feature || !feature.geometry || !v || typeof v.createLayerFromCollection !== "function") { toast("« Mes données » n'est pas disponible.", true); return null; }
    let parcel = feature;
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") { try { parcel = window.terrain3DManager.assembleParcelFeature(feature) || feature; } catch (e) { parcel = feature; } }
    if (!parcel.geometry || !/Polygon$/.test(parcel.geometry.type)) { toast("Cette parcelle n'a pas de contour à enregistrer.", true); return null; }
    const p = parcel.properties || {};
    const idpar = String(p.IDPAR || p.idpar || p.NO_LOT || p.no_lot || "");
    const p4 = getP4();
    let ha = parseFloat(p.SUPHEC || p.suphec || p.superficie_ha);
    if (!Number.isFinite(ha) && p4) {
      try { // superficie calculée sur le contour quand la source n'en donne pas
        const polys = parcel.geometry.type === "Polygon" ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
        const c0 = polys[0][0][0], fwd = p4("EPSG:4326", pfTamponGeom.utmDef(c0[0], c0[1]));
        ha = pfTamponGeom.multiArea(polys.map((poly) => poly.map((r) => r.map((c) => fwd.forward([c[0], c[1]]))))) / 10000;
      } catch (e) { ha = NaN; }
    }
    const nom = p.nom || p.name || (p.IDPAR || p.idpar ? `Parcelle nº ${p.IDPAR || p.idpar}` : idpar ? `Lot nº ${idpar}` : "Parcelle");
    const props = { nom: String(nom), idpar, culture: String(p.DESCODPR1 || p.descodpr1 || p.culture || ""), superficie_ha: Number.isFinite(ha) ? Math.round(ha * 100) / 100 : "", source: String(p.source || (p.IDPAR || p.idpar ? "BDPPAD" : "")), date_ajout: new Date().toISOString().slice(0, 10) };
    const feat = { type: "Feature", properties: props, geometry: JSON.parse(JSON.stringify(parcel.geometry)) };
    let layer = (v.layers || []).find((l) => l && l.kind !== "raster" && l.name === PARCELS_LAYER && /Polygon/.test(l.geometryType || "Polygon"));
    if (layer) {
      if (idpar && layer.data.features.some((f) => f.properties && String(f.properties.idpar || "") === idpar)) { toast(`${props.nom} est déjà dans Mes données › ${PARCELS_LAYER}.`); return layer; }
      const fid = `feat_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      feat.id = fid; feat.properties.__pf_id = fid; feat.properties.id = fid;
      layer.data.features.push(feat);
      if (!layer.visible && typeof v.setLayerVisibility === "function") v.setLayerVisibility(layer.id, true);
      if (typeof v.syncLayerToMap === "function") v.syncLayerToMap(layer);
    } else {
      layer = v.createLayerFromCollection({ type: "FeatureCollection", features: [feat] }, PARCELS_LAYER, null, { geometryType: "Polygon", visible: true,
        fields: ["nom", "idpar", "culture", "superficie_ha", "source", "date_ajout"].map((n) => ({ name: n, label: n })),
        style: { fillColor: "#228833", fillOpacity: 0.25, strokeColor: "#14532d", strokeWidth: 2.5, strokeStyle: "solid", markerShape: "circle", markerSize: 8, labelProperty: "nom" } });
      if (!layer) { toast("Enregistrement impossible.", true); return null; }
    }
    if (typeof v.markDirty === "function") v.markDirty(layer);
    if (typeof v.renderLayersList === "function") v.renderLayersList();
    toast(`${props.nom} enregistrée dans Mes données › ${PARCELS_LAYER}.`);
    return layer;
  }

  // Parcelle cliquée sur la carte : réunit ses tranches de tuiles avant d'ouvrir la fenêtre
  function openForParcel(feature) {
    if (!feature || !feature.geometry) return;
    let parcel = feature;
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") { try { parcel = window.terrain3DManager.assembleParcelFeature(feature) || feature; } catch (e) { parcel = feature; } }
    const p = parcel.properties || {}, pid = p.IDPAR || p.idpar, lot = p.NO_LOT || p.no_lot;
    open({ features: [{ type: "Feature", properties: { nom: p.nom || p.name || "" }, geometry: parcel.geometry }], name: p.nom || p.name || (pid ? `Parcelle nº ${pid}` : lot ? `Lot nº ${lot}` : "Parcelle") });
  }

  window.pfTampon = { open, openForParcel, close, saveParcel, geom: pfTamponGeom };
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["tampon"] = "438ff937";
