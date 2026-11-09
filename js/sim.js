/**
 * Plan de Ferme — Modules de Simulation de Pluie & d'Érosion des Sols (RUSLE)
 * 
 * Architecture découplée et indépendante :
 * 1. ParcelRainManager : Modèle hydrodynamique de pluie et ruissellement (Priority Flood,
 *    infiltration Horton, cheminement gravitationnel thalwegs & remplissage/débordement de cuvettes).
 * 2. ParcelErosionManager : Modèle d'érosion des sols RUSLE affiché dans le menu de gauche,
 *    indépendant de la pluie, avec détection automatique de la texture du sol (Pédologie QC / Soil World)
 *    et sélection par défaut de la dernière culture déclarée (Facteur C).
 */
(function (root) {
  "use strict";

  // Classes de pertes de sol RUSLE (t/ha/an) et palettes de couleurs
  const RUSLE_CLASSES = [
    [1, [34, 197, 94], "Très faible (< 1 t/ha/an)"],
    [3, [163, 230, 53], "Faible (1 à 3 t/ha/an)"],
    [6, [250, 204, 21], "Modéré (3 à 6 t/ha/an, seuil toléré)"],
    [11, [251, 146, 60], "Élevé (6 à 11 t/ha/an)"],
    [22, [239, 68, 68], "Sévère (11 à 22 t/ha/an)"],
    [Infinity, [168, 32, 90], "Critique (> 22 t/ha/an)"]
  ];

  // Types de sols et paramètres hydropédologiques
  const SOIL_TYPES = {
    loam: { name: "Loam (de référence)", k: 0.040, f: 8 },
    silt_loam: { name: "Loam limoneux", k: 0.048, f: 6 },
    clay_loam: { name: "Loam argileux", k: 0.035, f: 4 },
    clay: { name: "Argile", k: 0.028, f: 2 },
    sandy_loam: { name: "Loam sableux", k: 0.026, f: 15 },
    sand: { name: "Sable", k: 0.015, f: 25 }
  };

  // Couvert végétal et facteurs C
  const CROP_FACTORS = {
    bare: { name: "Sol nu sans couvert (C = 1,00 - Témoin)", c: 1.0 },
    corn_plow: { name: "Maïs grain labour conventionnel (C = 0,38)", c: 0.38 },
    corn_notill: { name: "Maïs semis direct / résidus (C = 0,15)", c: 0.15 },
    soybean: { name: "Soya (C = 0,28)", c: 0.28 },
    cereals: { name: "Céréales paille conservée (C = 0,12)", c: 0.12 },
    hay: { name: "Prairie / Foin / Pâturage (C = 0,02)", c: 0.02 },
    potato: { name: "Pomme de terre / Sarclés (C = 0,35)", c: 0.35 },
    canola: { name: "Canola / Oléagineux (C = 0,20)", c: 0.20 }
  };

  // Pratiques culturales et facteurs P
  const PRACTICE_FACTORS = {
    none: { name: "Sens de la pente (P = 1,00)", p: 1.0 },
    contour: { name: "Travail selon les courbes de niveau (P = 0,75)", p: 0.75 },
    strip: { name: "Cultures en bandes alternées (P = 0,50)", p: 0.50 }
  };

  // Stations de référence d'érosivité des pluies (RUSLEFAC / AAC pour le Québec)
  const QUEBEC_EROSIVITY_STATIONS = [
    { name: "Montréal / Montérégie Ouest", lat: 45.42, lng: -73.93, r: 1120 },
    { name: "Saint-Jean-sur-Richelieu", lat: 45.30, lng: -73.27, r: 1180 },
    { name: "Saint-Hyacinthe / Montérégie Est", lat: 45.62, lng: -72.95, r: 1150 },
    { name: "Sherbrooke / Estrie", lat: 45.40, lng: -71.88, r: 1250 },
    { name: "Granby / Haute-Yamaska", lat: 45.40, lng: -72.73, r: 1210 },
    { name: "Drummondville / Centre-du-Québec", lat: 45.88, lng: -72.48, r: 1130 },
    { name: "Trois-Rivières / Mauricie", lat: 46.35, lng: -72.58, r: 1090 },
    { name: "Québec / Capitale-Nationale", lat: 46.80, lng: -71.38, r: 1080 },
    { name: "Lévis / Chaudière-Appalaches", lat: 46.80, lng: -71.18, r: 1100 },
    { name: "Sainte-Marie / Beauce", lat: 46.45, lng: -71.02, r: 1140 },
    { name: "Joliette / Lanaudière", lat: 46.02, lng: -73.43, r: 1110 },
    { name: "Saint-Jérôme / Laurentides", lat: 45.78, lng: -74.00, r: 1100 },
    { name: "Gatineau / Outaouais", lat: 45.43, lng: -75.70, r: 1050 },
    { name: "Victoriaville / Bois-Francs", lat: 46.05, lng: -71.95, r: 1120 },
    { name: "Rimouski / Bas-Saint-Laurent", lat: 48.45, lng: -68.52, r: 880 },
    { name: "Rivière-du-Loup", lat: 47.83, lng: -69.53, r: 940 },
    { name: "Bagotville / Saguenay", lat: 48.33, lng: -71.00, r: 900 },
    { name: "Alma / Lac-Saint-Jean", lat: 48.55, lng: -71.65, r: 870 },
    { name: "Rouyn-Noranda / Abitibi", lat: 48.25, lng: -79.02, r: 840 },
    { name: "Val-d'Or / Abitibi", lat: 48.10, lng: -77.78, r: 850 },
    { name: "Gaspé / Gaspésie", lat: 48.83, lng: -64.48, r: 920 }
  ];

  /**
   * Estime le facteur d'érosivité R pour les coordonnées de la parcelle
   * par pondération inverse à la distance (IDW) sur les stations RUSLEFAC du Québec.
   */
  function estimateRFactor(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 1150;
    let sumWeight = 0, sumR = 0;
    for (const st of QUEBEC_EROSIVITY_STATIONS) {
      const d = Math.hypot((lat - st.lat) * 111, (lng - st.lng) * 78);
      if (d < 1) return st.r;
      const w = 1 / (d * d);
      sumWeight += w;
      sumR += st.r * w;
    }
    return sumWeight > 0 ? Math.round(sumR / sumWeight) : 1150;
  }

  /**
   * Raffine le facteur R avec l'API publique Open-Meteo pour les normales climatiques
   */
  async function fetchClimaticRFactor(lat, lng) {
    try {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=2023-01-01&end_date=2023-12-31&daily=precipitation_sum&timezone=auto`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const d = await res.json();
        if (d && d.daily && d.daily.precipitation_sum) {
          const precip = d.daily.precipitation_sum;
          let annual = 0;
          for (let i = 0; i < precip.length; i++) annual += (precip[i] || 0);
          if (annual > 500 && annual < 2500) {
            const p6hr = Math.max(25, Math.min(55, annual * 0.035));
            const calculatedR = Math.round(0.417 * Math.pow(p6hr, 2.17));
            if (calculatedR >= 600 && calculatedR <= 1800) {
              return calculatedR;
            }
          }
        }
      }
    } catch (e) {}
    return estimateRFactor(lat, lng);
  }

  /**
   * MNT LiDAR de la vue courante (avec marge) pour le RUSLE calculé à la volée,
   * sur le même principe que la carte des pentes : une seule image pour la vue.
   */
  async function loadViewDem(bbox, targetSize, signal) {
    let region = null;
    const isCustomProject = window.topoManager && window.topoManager.selectedProjectId !== "default" && window.topoManager.selectedProjectUrl;
    if (isCustomProject && typeof readSingleHrdemProjectRegion === "function") {
      try {
        region = await readSingleHrdemProjectRegion(window.topoManager.selectedProjectUrl, bbox, targetSize, signal, "bilinear");
      } catch (e) { region = null; }
      if (region && (!region.data || region.data.length === 0)) region = null;
    }
    if (!region && typeof readMultiHrdemRegion === "function") {
      region = await readMultiHrdemRegion(bbox, targetSize, signal, "bilinear");
    }
    if (!region || !region.data || region.data.length === 0 || !region.sourceBBox) return null;

    const W = region.width, H = region.height, sB = region.sourceBBox, N = W * H;
    const dx = Math.max(0.5, Math.abs((sB[2] - sB[0]) / Math.max(1, W - 1)));
    const dy = Math.max(0.5, Math.abs((sB[3] - sB[1]) / Math.max(1, H - 1)));
    const p4 = (typeof proj4 === "function") ? proj4 : null;
    const projDef = region.projection || (typeof EPSG_3979_DEF !== "undefined" ? EPSG_3979_DEF : "+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
    const pos = (x, y) => {
      const u = W > 1 ? x / (W - 1) : 0;
      const v = H > 1 ? y / (H - 1) : 0;
      if (p4) return p4(projDef, "EPSG:4326", [sB[0] + u * (sB[2] - sB[0]), sB[3] - v * (sB[3] - sB[1])]);
      const [tl, tr, br, bl] = region.cornersWgs84;
      const top = [tl[0] + u * (tr[0] - tl[0]), tl[1] + u * (tr[1] - tl[1])];
      const bot = [bl[0] + u * (br[0] - bl[0]), bl[1] + u * (br[1] - bl[1])];
      return [top[0] + v * (bot[0] - top[0]), top[1] + v * (bot[1] - top[1])];
    };
    // Coordonnée WGS84 -> pixel (pour retrouver une parcelle dans la grille)
    const toPixel = p4 ? (lng, lat) => {
      const [mX, mY] = p4("EPSG:4326", projDef, [lng, lat]);
      return [(mX - sB[0]) / (sB[2] - sB[0]) * (W - 1), (sB[3] - mY) / (sB[3] - sB[1]) * (H - 1)];
    } : null;

    const zIn = new Float32Array(N);
    let valid = 0;
    for (let i = 0; i < N; i++) {
      const v = region.data[i];
      if (Number.isFinite(v) && v > -900 && v < 9000) { zIn[i] = v; valid++; } else zIn[i] = NaN;
    }
    if (valid < 50) return null;
    const z = smoothGaussian(zIn, W, H, 2);
    return { W, H, dx, dy, z, zf: fillDepressions(z, W, H, 1e-4), pos, toPixel, sourceBBox: sB, validCount: valid, key: `view-${Date.now()}` };
  }

  // Cache mémoire des MNT par parcelle pour éviter les téléchargements redondants
  const DEM_CACHE = new Map();

  /**
   * Extraction et préparation du MNT LiDAR 1m pour une parcelle
   */
  async function loadParcelDem(parcelFeature, signal) {
    if (!parcelFeature || !parcelFeature.geometry) {
      throw new Error("Contour géométrique de parcelle invalide.");
    }

    const geom = parcelFeature.geometry;
    const geomBbox = computeGeomBbox(geom);
    if (!geomBbox) {
      throw new Error("Boîte englobante de parcelle introuvable.");
    }

    const cacheKey = JSON.stringify(geomBbox);
    if (DEM_CACHE.has(cacheKey)) {
      return DEM_CACHE.get(cacheKey);
    }

    const spanLng = geomBbox[2] - geomBbox[0];
    const spanLat = geomBbox[3] - geomBbox[1];
    const padLng = Math.max(0.0004, spanLng * 0.10);
    const padLat = Math.max(0.0004, spanLat * 0.10);
    const bbox = [geomBbox[0] - padLng, geomBbox[1] - padLat, geomBbox[2] + padLng, geomBbox[3] + padLat];

    const targetSize = 480; // Résolution native ~1m LiDAR
    let region = null;

    const isCustomProject = window.topoManager && window.topoManager.selectedProjectId !== "default" && window.topoManager.selectedProjectUrl;
    const projectUrl = isCustomProject ? window.topoManager.selectedProjectUrl : null;

    if (projectUrl && typeof readSingleHrdemProjectRegion === "function") {
      try {
        region = await readSingleHrdemProjectRegion(projectUrl, bbox, targetSize, signal, "bilinear");
      } catch (e) {
        console.warn("readSingleHrdemProjectRegion note:", e);
      }
    }

    if (!region && typeof readMultiHrdemRegion === "function") {
      region = await readMultiHrdemRegion(bbox, targetSize, signal, "bilinear");
    }

    if (!region || !region.data || region.data.length === 0 || !region.sourceBBox) {
      throw new Error("Données altimétriques LiDAR 1m indisponibles pour cette parcelle.");
    }

    const W = region.width;
    const H = region.height;
    const sB = region.sourceBBox;
    const dx = Math.max(0.5, Math.abs((sB[2] - sB[0]) / Math.max(1, W - 1)));
    const dy = Math.max(0.5, Math.abs((sB[3] - sB[1]) / Math.max(1, H - 1)));

    const p4 = (typeof proj4 === "function") ? proj4 : null;
    const projDef = region.projection || (typeof EPSG_3979_DEF !== "undefined" ? EPSG_3979_DEF : "+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

    const pos = (x, y) => {
      const u = W > 1 ? x / (W - 1) : 0;
      const v = H > 1 ? y / (H - 1) : 0;
      if (p4) {
        const mX = sB[0] + u * (sB[2] - sB[0]);
        const mY = sB[3] - v * (sB[3] - sB[1]);
        return p4(projDef, "EPSG:4326", [mX, mY]);
      }
      const [tl, tr, br, bl] = region.cornersWgs84;
      const top = [tl[0] + u * (tr[0] - tl[0]), tl[1] + u * (tr[1] - tl[1])];
      const bot = [bl[0] + u * (br[0] - bl[0]), bl[1] + u * (br[1] - bl[1])];
      return [top[0] + v * (bot[0] - top[0]), top[1] + v * (bot[1] - top[1])];
    };

    const N = W * H;
    const zRaw = region.data;

    // 1. Léger pré-lissage gaussien séparable sur la zone étendue (avec marge tampon)
    // pour filtrer les micro-bruits laser/labour tout en conservant les vraies pentes et thalwegs
    const zPre = smoothGaussian(zRaw, W, H, 2);

    const zMasked = new Float32Array(N).fill(NaN);
    let validInside = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = zPre[i];
        if (!Number.isFinite(v) || v <= -900 || v >= 9000) continue;

        const pt = pos(x, y);
        if (pt[0] < geomBbox[0] || pt[0] > geomBbox[2] || pt[1] < geomBbox[1] || pt[1] > geomBbox[3]) {
          continue;
        }
        if (isPointInGeom(pt, geom)) {
          zMasked[i] = v;
          validInside++;
        }
      }
    }

    if (validInside < 10) {
      throw new Error("La parcelle ne contient pas suffisamment de points LiDAR valides.");
    }

    const gridObj = {
      W,
      H,
      dx,
      dy,
      z: zMasked,
      pos,
      sourceBBox: sB,
      geomBbox,
      validCount: validInside,
      key: `dem-${Date.now()}`
    };

    // 2. Léger lissage final sur la géométrie découpée
    const smoothed = smooth3(gridObj);
    // Calcul hydrologique de remplissage des cuvettes (Priority Flood)
    smoothed.zf = fillDepressions(smoothed.z, smoothed.W, smoothed.H, 1e-4);

    DEM_CACHE.set(cacheKey, smoothed);
    return smoothed;
  }

  /**
   * Lissage gaussien séparable [1, 2, 1] / 4 respectant les cellules NaN
   * Permet d'atténuer le micro-bruit LiDAR sans altérer les lignes de crête et thalwegs.
   */
  function smoothGaussian(data, W, H, passes = 1) {
    let cur = new Float32Array(data);
    const tmp = new Float32Array(data.length);

    for (let p = 0; p < passes; p++) {
      // Passe horizontale
      for (let y = 0; y < H; y++) {
        const yW = y * W;
        for (let x = 0; x < W; x++) {
          const i = yW + x;
          const v = cur[i];
          if (!Number.isFinite(v)) { tmp[i] = NaN; continue; }

          const l = x > 0 ? cur[i - 1] : NaN;
          const r = x < W - 1 ? cur[i + 1] : NaN;

          let sum = v * 2, count = 2;
          if (Number.isFinite(l)) { sum += l; count++; }
          if (Number.isFinite(r)) { sum += r; count++; }
          tmp[i] = sum / count;
        }
      }

      // Passe verticale
      for (let y = 0; y < H; y++) {
        const yW = y * W;
        for (let x = 0; x < W; x++) {
          const i = yW + x;
          const v = tmp[i];
          if (!Number.isFinite(v)) { cur[i] = NaN; continue; }

          const u = y > 0 ? tmp[i - W] : NaN;
          const d = y < H - 1 ? tmp[i + W] : NaN;

          let sum = v * 2, count = 2;
          if (Number.isFinite(u)) { sum += u; count++; }
          if (Number.isFinite(d)) { sum += d; count++; }
          cur[i] = sum / count;
        }
      }
    }
    return cur;
  }

  function smooth3(G) {
    if (!G || !G.z) return G;
    const { W, H, z } = G;
    const out = smoothGaussian(z, W, H, 1);
    return Object.assign({}, G, { z: out });
  }

  function fillDepressions(z, W, H, eps = 1e-4) {
    const N = W * H;
    const out = new Float32Array(z);
    const done = new Uint8Array(N);
    const heap = [];

    const push = (i, v) => {
      heap.push([v, i]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };

    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };

    const valid = (i) => !Number.isNaN(z[i]);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!valid(i)) continue;
        let edge = (x === 0 || y === 0 || x === W - 1 || y === H - 1);
        if (!edge) {
          for (const j of [i - 1, i + 1, i - W, i + W]) {
            if (!valid(j)) { edge = true; break; }
          }
        }
        if (edge) { done[i] = 1; push(i, out[i]); }
      }
    }

    while (heap.length) {
      const [v, i] = pop();
      const x = i % W, y = (i / W) | 0;
      for (let dyy = -1; dyy <= 1; dyy++) {
        for (let dxx = -1; dxx <= 1; dxx++) {
          if (!dxx && !dyy) continue;
          const xx = x + dxx, yy = y + dyy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (done[j] || !valid(j)) continue;
          done[j] = 1;
          if (out[j] <= v + eps) out[j] = v + eps;
          push(j, out[j]);
        }
      }
    }
    return out;
  }

  function getGridCorners(G) {
    return [
      G.pos(-0.5, -0.5),
      G.pos(G.W - 0.5, -0.5),
      G.pos(G.W - 0.5, G.H - 0.5),
      G.pos(-0.5, G.H - 0.5)
    ];
  }

  function isPointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > pt[1]) !== (yj > pt[1]))
        && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function isPointInGeom(pt, geom) {
    if (!geom || !geom.coordinates) return true;
    if (geom.type === "Polygon") {
      if (!geom.coordinates.length || !isPointInRing(pt, geom.coordinates[0])) return false;
      for (let k = 1; k < geom.coordinates.length; k++) {
        if (isPointInRing(pt, geom.coordinates[k])) return false;
      }
      return true;
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        if (poly.length && isPointInRing(pt, poly[0])) {
          let inHole = false;
          for (let k = 1; k < poly.length; k++) {
            if (isPointInRing(pt, poly[k])) { inHole = true; break; }
          }
          if (!inHole) return true;
        }
      }
      return false;
    }
    return true;
  }

  function computeGeomBbox(geom) {
    if (!geom || !geom.coordinates) return null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    function walk(coords) {
      if (typeof coords[0] === "number") {
        const [lng, lat] = coords;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        return;
      }
      for (const item of coords) walk(item);
    }

    walk(geom.coordinates);
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
    return [minLng, minLat, maxLng, maxLat];
  }

  function assembleParcel(feature) {
    if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") {
      return window.terrain3DManager.assembleParcelFeature(feature);
    }
    return feature;
  }

  const GRAD_BUF = [0, 0];

  // ===========================================================================
  // 1. MODULE DE SIMULATION DE PLUIE & RUISSELLEMENT (ParcelRainManager)
  // ===========================================================================
  class ParcelRainManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.currentParcel = null;
      this.currentGrid = null;
      this.intensity = 65; // mm/h (pluie soutenue favorisant le ruissellement visible)
      this.speed = 0.5; // vitesse ralentie fixée à 0.5
      this.trailMultiplier = 3; // longueur des traînées fixée à 3
      this.flowThreshold = 0.08; // seuil de visibilité du ruissellement
      this.soilKey = "loam";
      this.isOpen = false;
      this.sim = null;
      this.rafId = 0;
      this.abortController = null;

      this.SRC_RAIN = "sim-rain-source";
      this.LAYER_RAIN = "sim-rain-layer";
      this.SRC_HL = "sim-rain-hl-source";
      this.LAYER_HL = "sim-rain-hl-layer";

      this.initDom();
    }

    initDom() {
      const btnClose = document.getElementById("btn-close-sim-dock");
      const btnPlay = document.getElementById("btn-sim-rain-play");
      const btnReset = document.getElementById("btn-sim-rain-reset");

      if (btnClose) btnClose.addEventListener("click", () => this.closeDock());

      if (btnPlay) {
        btnPlay.addEventListener("click", () => {
          if (this.sim && this.sim.running) {
            this.pauseRain();
          } else {
            this.playRain();
          }
        });
      }

      if (btnReset) {
        btnReset.addEventListener("click", () => this.resetRain());
      }
    }

    async startSimulation(parcelFeature) {
      if (!parcelFeature || !parcelFeature.geometry) return;

      // Fermeture des autres docks
      const pDock = document.getElementById("elevation-profile-dock");
      if (pDock) pDock.classList.remove("open");
      const nDock = document.getElementById("ndvi-dock");
      if (nDock) nDock.classList.remove("open");

      this.currentParcel = assembleParcel(parcelFeature);
      this.openDock();
      this.updateParcelHeader();
      this.highlightParcel(this.currentParcel.geometry);
      this.filterActiveParcelLine(this.currentParcel);

      // Cadrage sur la parcelle
      const bbox = computeGeomBbox(this.currentParcel.geometry);
      if (bbox && this.map) {
        this.map.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: { top: 60, bottom: 90, left: 60, right: 60 }, duration: 800 }
        );
      }

      this.setLoading(true);
      try {
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        this.currentGrid = await loadParcelDem(this.currentParcel, this.abortController.signal);
        this.setLoading(false);
        this.updateParcelHeader();
        this.resetRain();
        this.playRain();
      } catch (err) {
        this.setLoading(false);
        console.error("Erreur chargement MNT pluie :", err);
        const hintEl = document.getElementById("sim-rain-hint");
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">⚠️ ${err.message || "Erreur de chargement altimétrique LiDAR 1m."}</span>`;
        }
      }
    }

    newRainSim(G) {
      const { W, H } = G;
      const N = W * H;
      const maxDim = Math.max(W, H);
      const S = Math.max(2, Math.min(4, Math.floor(1000 / maxDim) || 2));

      // Contournement MapLibre GL JS #6607
      let cvW = Math.round(W * S);
      let cvH = Math.round(H * S);
      if (cvW === cvH) cvW += 2;
      if ((cvW & (cvW - 1)) === 0) cvW += 2;
      if ((cvH & (cvH - 1)) === 0) cvH += 2;

      if (typeof document !== "undefined") {
        const prev = document.getElementById("sim-rain-active-canvas");
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
      }

      const canvas = document.createElement("canvas");
      canvas.id = "sim-rain-active-canvas";
      canvas.width = cvW;
      canvas.height = cvH;
      canvas.style.display = "none";
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
      if (typeof document !== "undefined" && document.body) {
        document.body.appendChild(canvas);
      }

      const small = document.createElement("canvas");
      small.width = W;
      small.height = H;

      const cells = [];
      for (let i = 0; i < N; i++) {
        if (!Number.isNaN(G.z[i])) cells.push(i);
      }

      return {
        G,
        S,
        canvas,
        ctx: canvas.getContext("2d"),
        small,
        sctx: small.getContext("2d"),
        img: small.getContext("2d").createImageData(W, H),
        water: new Float32Array(N),
        flow: new Float32Array(N),
        shown: new Float32Array(N),
        drops: [],
        cells,
        active: cells.length,
        time: 0,
        rain: 0,
        inf: 0,
        out: 0,
        wetList: new Set(),
        running: false,
        frame: 0,
        ref: 0
      };
    }

    surf(s, x, y) {
      const { W, H, z, zf } = s.G;
      if (x < 0 || y < 0 || x >= W || y >= H) return NaN;
      const i = y * W + x;
      if (Number.isNaN(z[i])) return NaN;

      const cap = zf ? Math.max(0, zf[i] - z[i]) : 0;
      if (cap > 1e-4) {
        const w = Math.min(cap, s.water[i]);
        const fillRatio = w / cap;
        return z[i] * (1 - fillRatio) + zf[i] * fillRatio;
      }
      return z[i] + s.water[i];
    }

    gradient(s, x, y) {
      const c = this.surf(s, x, y), dx = s.G.dx, dy = s.G.dy;
      GRAD_BUF[0] = 0;
      GRAD_BUF[1] = 0;
      if (Number.isNaN(c)) return GRAD_BUF;
      const l = this.surf(s, x - 1, y), r = this.surf(s, x + 1, y);
      const u = this.surf(s, x, y - 1), d = this.surf(s, x, y + 1);

      GRAD_BUF[0] = r === r && l === l ? (r - l) / (2 * dx) : r === r ? (r - c) / dx : l === l ? (c - l) / dx : 0;
      GRAD_BUF[1] = d === d && u === u ? (d - u) / (2 * dy) : d === d ? (d - c) / dy : u === u ? (c - u) / dy : 0;

      return GRAD_BUF;
    }

    rainStep(s, dt) {
      const { W, H, dx, dy, z, zf } = s.G;
      const cell = dx * dy;
      const I = this.intensity;
      const soil = SOIL_TYPES[this.soilKey] || SOIL_TYPES.loam;
      const f = soil.f;
      const speedScale = typeof this.speed === "number" ? this.speed : 0.5;

      const excess = Math.max(0, I - f) / 1000 / 3600;
      s.time += dt;
      s.rain += (I / 1000 / 3600) * dt * s.active * cell;
      s.inf += (Math.min(I, f) / 1000 / 3600) * dt * s.active * cell;

      const maxDrops = Math.min(20000, Math.max(8000, Math.round(s.active * 0.2)));
      if (excess > 0) {
        const vol = excess * dt * s.active * cell;
        const n = Math.max(4, Math.round(Math.min(2600, s.active * 0.016 * Math.min(1, speedScale))));
        const v = vol / n;
        for (let k = 0; k < n; k++) {
          if (s.drops.length >= maxDrops) {
            s.drops[(Math.random() * s.drops.length) | 0].v += v;
            continue;
          }
          const i = s.cells[(Math.random() * s.cells.length) | 0];
          const x = (i % W) + Math.random();
          const y = ((i / W) | 0) + Math.random();
          s.drops.push({ x, y, vx: 0, vy: 0, v, age: 0 });
        }
      }

      const keep = [];
      for (const p of s.drops) {
        const cx = p.x | 0, cy = p.y | 0;
        const i = cy * W + cx;
        const gg = this.gradient(s, cx, cy);
        const gx = gg[0], gy = gg[1];
        const slope = Math.hypot(gx, gy);

        // Direction d'écoulement vers l'aval (opposée au gradient d'altitude)
        const dirX = slope > 1e-6 ? -gx / slope : 0;
        const dirY = slope > 1e-6 ? -gy / slope : 0;

        // Vitesse des particules dépendant de la pente et de la vitesse globale (0.5) :
        // Pente abrupte -> les particules accélèrent nettement et vont vite
        // Terrain plat ou cuvette -> les particules ralentissent fortement et avancent au ralenti
        const baseTargetSp = slope > 1e-5 ? Math.min(1.25, 0.04 + 2.5 * Math.sqrt(slope)) : 0.02;
        const targetSp = baseTargetSp * speedScale;

        // Inertie et force motrice
        const inertia = 0.78;
        p.vx = p.vx * inertia + dirX * (targetSp * (1 - inertia));
        p.vy = p.vy * inertia + dirY * (targetSp * (1 - inertia));

        const sp = Math.hypot(p.vx, p.vy);
        const maxSp = targetSp * 1.15;
        if (sp > maxSp) {
          p.vx = (p.vx / sp) * maxSp;
          p.vy = (p.vy / sp) * maxSp;
        }

        s.flow[i] += p.v / cell;
        p.age++;

        const cap = zf ? Math.max(0, zf[i] - z[i]) : 0;
        const isDepression = cap > 1e-4;
        const isFull = isDepression && s.water[i] >= cap * 0.95;

        const settleThresh = 0.08 * speedScale;
        if ((sp < settleThresh || slope < 5e-4) && p.age > 2) {
          if (isDepression && !isFull) {
            const room = cap - s.water[i];
            const take = Math.min(p.v / cell, room);
            s.water[i] += take;
            s.wetList.add(i);
            p.v -= take * cell;
            if (p.v <= 1e-7) continue;
          } else if (!isDepression) {
            s.water[i] += p.v / cell;
            s.wetList.add(i);
            continue;
          }

          if (isFull && slope > 1e-7) {
            p.vx = - (gx / slope) * 0.20 * speedScale;
            p.vy = - (gy / slope) * 0.20 * speedScale;
          }
        }

        p.x += p.vx;
        p.y += p.vy;
        const nx = p.x | 0, ny = p.y | 0;
        if (p.x < 0 || p.y < 0 || nx >= W || ny >= H || Number.isNaN(z[ny * W + nx])) {
          s.out += p.v;
          continue;
        }
        if (p.age > 3500) {
          if (isDepression && !isFull) {
            s.water[i] += p.v / cell;
            s.wetList.add(i);
          }
          continue;
        }
        keep.push(p);
      }
      s.drops = keep;

      // Étalement et infiltration dans les cuvettes
      const infil = (f / 1000 / 3600) * dt;
      const nextWet = new Set();
      for (const i of s.wetList) {
        let w = s.water[i];
        if (w <= 0) continue;
        const take = Math.min(w, infil);
        w -= take;
        s.inf += take * cell;

        const x = i % W, y = (i / W) | 0;
        const capI = zf ? Math.max(0, zf[i] - z[i]) : 0;

        if (capI <= 1e-4) {
          if (w > 1e-4 && s.drops.length < 22000) {
            s.drops.push({ x: x + 0.5, y: y + 0.5, vx: 0, vy: 0, v: w * cell, age: 1 });
          }
          s.water[i] = 0;
          continue;
        }

        if (w > capI) {
          const overflow = w - capI;
          w = capI;
          if (s.drops.length < 22000) {
            s.drops.push({ x: x + 0.5, y: y + 0.5, vx: 0, vy: 0, v: overflow * cell, age: 1 });
          } else {
            s.out += overflow * cell;
          }
        }

        if (w <= 0) {
          s.water[i] = 0;
          continue;
        }

        const h = z[i] + w;
        for (const [xx, yy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (Number.isNaN(z[j])) continue;

          const spillZ = zf ? zf[i] : z[i];
          if (z[j] >= spillZ - 1e-4) continue;

          const capJ = zf ? Math.max(0, zf[j] - z[j]) : 0;
          if (capJ <= 1e-4) continue;

          const wj = s.water[j];
          const hj = z[j] + wj;
          if (hj >= h) continue;

          const mv = Math.min(w * 0.25, Math.min((h - hj) * 0.25, capJ - wj));
          if (mv <= 0) continue;

          w -= mv;
          s.water[j] += mv;
          if (s.water[j] > 1e-5) nextWet.add(j);
        }

        s.water[i] = w;
        if (w > 1e-5) nextWet.add(i); else s.water[i] = 0;
      }
      s.wetList = nextWet;
    }

    drawRain(s) {
      const { W, H } = s.G;
      const N = W * H;
      const px = s.img.data;

      if (!(s.frame++ % 10) || !s.ref) {
        const sample = [];
        const sampleCount = Math.min(8000, s.cells.length);
        for (let k = 0; k < sampleCount; k++) {
          const i = s.cells[(Math.random() * s.cells.length) | 0];
          sample.push(s.flow[i]);
        }
        sample.sort((a, b) => a - b);
        const r = Math.max(1e-9, sample[Math.floor(sample.length * 0.90)] || 0);
        s.ref = s.ref ? s.ref * 0.85 + r * 0.15 : r;
      }
      const ref = s.ref;

      for (let i = 0; i < N; i++) {
        s.flow[i] *= 0.993;
        const w = s.water[i];
        const f = s.flow[i] / ref;
        const o = i * 4;

        // Rendu : cuvettes si eau stagnante (target >= 2), sinon couloir d'écoulement visible (target 0 à 1)
        const target = w > 0.002
          ? 2 + Math.min(1, w / 0.15)
          : (f > 0.03 ? Math.min(1, Math.pow(f / 0.6, 0.65)) : -0.0001);
        const v = (s.shown[i] = s.shown[i] * 0.88 + target * 0.12);

        if (v >= 2.0) {
          // Eau stagnante en cuvette : bleu océan à bleu foncé / nuit profond
          const k = Math.min(1, v - 2.0);
          px[o] = Math.round(45 - 35 * k);       // 45 -> 10
          px[o + 1] = Math.round(105 - 80 * k);   // 105 -> 25
          px[o + 2] = Math.round(225 - 115 * k);  // 225 -> 110
          px[o + 3] = Math.round(190 + 60 * k);   // 190 -> 250
        } else if (v > 0.02) {
          // Écoulement actif : échelle continue du blanc pur au bleu royal (sans cyan)
          const k = Math.min(1, Math.max(0, (v - 0.02) / 0.98));
          px[o] = Math.round(255 - 200 * k);      // 255 (blanc) -> 55 (bleu royal)
          px[o + 1] = Math.round(255 - 135 * k);  // 255 (blanc) -> 120 (bleu royal)
          px[o + 2] = Math.round(255 - 15 * k);   // 255 (blanc) -> 240 (bleu royal)
          px[o + 3] = Math.round(90 + 120 * k);   // 90 -> 210
        } else {
          px[o + 3] = 0;
        }
      }

      s.sctx.putImageData(s.img, 0, 0);

      const c = s.ctx;
      const S = s.S;
      c.clearRect(0, 0, s.canvas.width, s.canvas.height);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      c.drawImage(s.small, 0, 0, s.canvas.width, s.canvas.height);

      if ("filter" in c) {
        try {
          c.save();
          c.globalCompositeOperation = "lighter";
          c.globalAlpha = 0.32;
          c.filter = `blur(${Math.max(1.8, S * 1.0).toFixed(1)}px)`;
          c.drawImage(s.small, 0, 0, s.canvas.width, s.canvas.height);
          c.restore();
        } catch (e) {}
      }

      // Rendu dynamique des gouttes en mouvement avec traînées d'écoulement
      const cw = s.canvas.width, ch = s.canvas.height;
      const sx = cw / W, sy = ch / H;
      const numDrops = s.drops.length;
      const step = numDrops > 18000 ? 2 : 1;
      const dropRadius = Math.max(1.1, S * 0.35);

      const SPEED = typeof this.speed === "number" ? this.speed : 0.5;
      const mult = (this.trailMultiplier || 3) / Math.max(0.1, SPEED);

      c.lineWidth = Math.max(1.2, S * 0.35);
      c.lineCap = "round";

      // 1. Un seul beginPath() et un seul stroke() pour TOUTES les traînées en mouvement (batching haute performance comme dans Ektare)
      c.strokeStyle = "rgba(255, 255, 255, 0.90)";
      c.beginPath();
      for (let k = 0; k < numDrops; k += step) {
        const p = s.drops[k];
        const sp = Math.hypot(p.vx, p.vy);
        if (sp <= 0.025) continue;
        const dpx = p.x * sx, dpy = p.y * sy;
        const tailLen = Math.min(8 * S, sp * mult * S);
        c.moveTo(dpx - (p.vx / sp) * tailLen, dpy - (p.vy / sp) * tailLen);
        c.lineTo(dpx, dpy);
      }
      c.stroke();

      // 2. Un seul beginPath() et un seul fill() pour TOUTES les gouttes stationnaires
      c.fillStyle = "rgba(255, 255, 255, 0.95)";
      c.beginPath();
      for (let k = 0; k < numDrops; k += step) {
        const p = s.drops[k];
        if (Math.hypot(p.vx, p.vy) > 0.025) continue;
        const dpx = p.x * sx, dpy = p.y * sy;
        c.moveTo(dpx + dropRadius, dpy);
        c.arc(dpx, dpy, dropRadius, 0, 6.2832);
      }
      c.fill();
    }

    loop() {
      this.rafId = 0;
      if (!this.sim || !this.sim.running) return;

      const SPEED = typeof this.speed === "number" ? this.speed : 0.5;
      const dt = Math.max(1, (this.sim.G.dx + this.sim.G.dy) / 2 / 0.6) * SPEED;

      this.rainStep(this.sim, dt);
      this.drawRain(this.sim);

      const src = this.map && this.map.getSource(this.SRC_RAIN);
      if (src && typeof src.play === "function") src.play();

      this.rafId = requestAnimationFrame(() => this.loop());
    }

    playRain() {
      if (!this.currentGrid) return;
      if (!this.sim) {
        this.sim = this.newRainSim(this.currentGrid);
        this.ensureRainLayer(this.sim);
      } else if (!this.map.getSource(this.SRC_RAIN)) {
        this.ensureRainLayer(this.sim);
      }

      this.sim.running = true;
      this.syncPlayButton(true);

      const src = this.map && this.map.getSource(this.SRC_RAIN);
      if (src && typeof src.play === "function") src.play();

      if (this.map.getLayer(this.LAYER_RAIN)) {
        this.map.setLayoutProperty(this.LAYER_RAIN, "visibility", "visible");
        this.map.moveLayer(this.LAYER_RAIN);
      }

      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => this.loop());
      }
    }

    pauseRain() {
      if (this.sim) this.sim.running = false;
      this.syncPlayButton(false);
      const src = this.map && this.map.getSource(this.SRC_RAIN);
      if (src && typeof src.pause === "function") src.pause();
    }

    resetRain() {
      const wasRunning = this.sim && this.sim.running;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.removeRainLayer();
      this.sim = null;
      this.syncPlayButton(false);
      this.clearStats();

      if (wasRunning && this.currentGrid) {
        this.playRain();
      }
    }

    ensureRainLayer(s) {
      if (!this.map || typeof this.map.getSource !== "function") return;
      const coords = getGridCorners(s.G);

      if (this.map.getSource(this.SRC_RAIN)) {
        if (this.map.getLayer(this.LAYER_RAIN)) this.map.removeLayer(this.LAYER_RAIN);
        this.map.removeSource(this.SRC_RAIN);
      }

      this.map.addSource(this.SRC_RAIN, {
        type: "canvas",
        canvas: s.canvas.id || s.canvas,
        coordinates: coords,
        animate: true
      });

      // Placer la couche de pluie au-dessus des couches parcelles et sous le contour de sélection
      const beforeLayer = this.map.getLayer(this.LAYER_HL) ? this.LAYER_HL : undefined;

      this.map.addLayer({
        id: this.LAYER_RAIN,
        type: "raster",
        source: this.SRC_RAIN,
        paint: {
          "raster-opacity": 1.0,
          "raster-fade-duration": 0,
          "raster-resampling": "linear"
        }
      }, beforeLayer);

      const src = this.map.getSource(this.SRC_RAIN);
      if (src && typeof src.play === "function") src.play();
    }

    removeRainLayer() {
      if (this.sim && this.sim.canvas && this.sim.canvas.parentNode) {
        this.sim.canvas.parentNode.removeChild(this.sim.canvas);
      }
      if (!this.map || typeof this.map.getSource !== "function") return;
      if (this.map.getLayer(this.LAYER_RAIN)) this.map.removeLayer(this.LAYER_RAIN);
      if (this.map.getSource(this.SRC_RAIN)) this.map.removeSource(this.SRC_RAIN);
    }

    updateParcelHeader() {
      if (!this.currentParcel) return;
      const props = this.currentParcel.properties || {};
      const pid = props.IDPAR || props.idpar || "";
      const lot = props.NO_LOT || "";
      const sup = props.SUPHEC || props.suphec || "";

      const nameEl = document.getElementById("sim-parcel-name");
      if (nameEl) {
        const sNum = parseFloat(sup);
        const supStr = !isNaN(sNum) ? ` (${sNum.toFixed(1)} ha)` : (sup ? ` (${sup} ha)` : "");
        nameEl.textContent = pid ? `— Parcelle nº ${pid}${supStr}` : (lot ? `— Lot nº ${lot}${supStr}` : `— Parcelle agricole${supStr}`);
      }
    }

    updateStatsDisplay() {}

    clearStats() {}

    syncRainHint() {}

    syncPlayButton(isPlaying) {
      const btn = document.getElementById("btn-sim-rain-play");
      if (!btn) return;
      if (isPlaying) {
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg><span>Pause</span>`;
        btn.style.background = "#475569";
      } else {
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>Lancer la pluie</span>`;
        btn.style.background = "#0284c7";
      }
    }

    setLoading(loading) {
      const bar = document.getElementById("sim-loading-bar");
      if (bar) bar.style.display = loading ? "block" : "none";
    }

    openDock() {
      const dock = document.getElementById("sim-dock");
      if (dock) {
        dock.classList.add("open");
        dock.classList.remove("collapsed");
      }
      this.isOpen = true;
    }

    closeDock() {
      this.pauseRain();
      this.removeRainLayer();
      this.clearHighlight();
      this.clearActiveParcelLineFilter();

      const resEl = document.getElementById("sim-res-badge");
      if (resEl) resEl.style.display = "none";

      const dock = document.getElementById("sim-dock");
      if (dock) dock.classList.remove("open");
      this.isOpen = false;
      this.currentParcel = null;
      this.currentGrid = null;
    }

    filterActiveParcelLine(parcel) {
      if (!this.map || !parcel) return;
      const props = parcel.properties || {};
      const pid = props.IDPAR || props.idpar || props.IDANPAR || props.idanpar;
      const polyId = props.POLY_ID || props.poly_id;
      const noLot = props.NO_LOT || props.no_lot;
      const fid = parcel.id;

      // Masquer le contour et les découpes internes de cette parcelle provenant des tuiles vectorielles BDPPAD
      const conds = ["all"];
      if (pid) {
        conds.push(["!=", ["to-string", ["coalesce", ["get", "IDPAR"], ["get", "idpar"], ["get", "IDANPAR"], ["get", "idanpar"], ""]], String(pid)]);
      }
      if (polyId) {
        conds.push(["!=", ["to-string", ["coalesce", ["get", "POLY_ID"], ["get", "poly_id"], ""]], String(polyId)]);
      }
      if (noLot) {
        conds.push(["!=", ["to-string", ["coalesce", ["get", "NO_LOT"], ["get", "no_lot"], ""]], String(noLot)]);
      }
      if (fid !== undefined && fid !== null) {
        conds.push(["!=", ["id"], fid]);
      }

      if (conds.length > 1) {
        const filter = conds.length === 2 ? conds[1] : conds;
        if (this.map.getLayer("parcelles-line-bg")) {
          this.map.setFilter("parcelles-line-bg", filter);
        }
        if (this.map.getLayer("parcelles-line-fg")) {
          this.map.setFilter("parcelles-line-fg", filter);
        }
      }
    }

    clearActiveParcelLineFilter() {
      if (!this.map) return;
      if (this.map.getLayer("parcelles-line-bg")) {
        this.map.setFilter("parcelles-line-bg", null);
      }
      if (this.map.getLayer("parcelles-line-fg")) {
        this.map.setFilter("parcelles-line-fg", null);
      }
    }

    bringToFront() {
      if (!this.map || !this.isOpen) return;
      if (this.map.getLayer(this.LAYER_RAIN)) {
        this.map.moveLayer(this.LAYER_RAIN);
      }
      if (this.map.getLayer(this.LAYER_HL)) {
        this.map.moveLayer(this.LAYER_HL);
      }
    }

    highlightParcel(geom) {
      if (!this.map || typeof this.map.getSource !== "function" || !geom) return;
      const geojson = {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: geom, properties: {} }]
      };

      if (!this.map.getSource(this.SRC_HL)) {
        this.map.addSource(this.SRC_HL, { type: "geojson", data: geojson });
        this.map.addLayer({
          id: this.LAYER_HL,
          type: "line",
          source: this.SRC_HL,
          paint: {
            "line-color": "#0284c7",
            "line-width": 2.5,
            "line-opacity": 0.95
          }
        });
      } else {
        this.map.getSource(this.SRC_HL).setData(geojson);
        this.map.setLayoutProperty(this.LAYER_HL, "visibility", "visible");
      }
    }

    clearHighlight() {
      if (this.map && typeof this.map.getLayer === "function" && this.map.getLayer(this.LAYER_HL)) {
        this.map.setLayoutProperty(this.LAYER_HL, "visibility", "none");
      }
    }
  }

  // ===========================================================================
  // 2. MODULE D'ÉROSION DES SOLS RUSLE DANS LE MENU DE GAUCHE (ParcelErosionManager)
  // ===========================================================================
  class ParcelErosionManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.currentParcel = null;
      this.currentGrid = null;
      this.eroResult = null;
      this.seriesDb = null;
      this.isLoading = false;

      // Paramètres RUSLE
      this.rFactor = 1150;
      this.soilKey = "loam";
      this.cropKey = "bare";
      this.opacity = 0.85;
      this.isVisible = false;

      // Couches MapLibre
      this.SRC_ERO = "rusle-erosion-source";
      this.LAYER_ERO = "rusle-erosion-layer";
      this.SRC_HL = "rusle-parcel-hl-source";
      this.LAYER_HL = "rusle-parcel-hl-layer";

      // Calcul à la volée sur la vue (comme les pentes et les courbes de niveau)
      this.MIN_ZOOM = 13;
      this.viewTimer = null;
      this.viewAbort = null;
      this.rCache = new Map();
      this.parcelMean = null;

      this.initDom();
      this.loadSeriesSummaries();
      if (this.map && typeof this.map.on === "function") {
        this.map.on("moveend", () => this.scheduleViewUpdate());
      }
    }

    setStatus(html) {
      const hint = document.getElementById("rusle-no-parcel-hint");
      if (!hint) return;
      hint.style.display = html ? "block" : "none";
      hint.innerHTML = html || "";
    }

    scheduleViewUpdate(immediate) {
      if (!this.isVisible) return;
      if (this.viewTimer) clearTimeout(this.viewTimer);
      this.viewTimer = setTimeout(() => this.updateViewport(), immediate ? 0 : 250);
    }

    /**
     * Lit le MNT de la vue (+ marge pour l'amont des versants) et recalcule A = R·K·LS·C
     */
    async updateViewport() {
      if (!this.isVisible || !this.map) return;
      const zoom = this.map.getZoom();
      if (zoom < this.MIN_ZOOM) {
        this.setStatus(`Zoomez davantage (zoom ${this.MIN_ZOOM}+) pour calculer l'érosion sur la vue.`);
        return;
      }
      const b = this.map.getBounds();
      const w = b.getWest(), sth = b.getSouth(), e = b.getEast(), n = b.getNorth();
      // Marge : ~300 m (longueur de pente plafonnée) ou 20 % de la vue
      const padLat = Math.max(0.003, (n - sth) * 0.2);
      const padLng = Math.max(0.004, (e - w) * 0.2);
      const bbox = [w - padLng, sth - padLat, e + padLng, n + padLat];

      if (this.viewAbort) this.viewAbort.abort();
      this.viewAbort = new AbortController();
      const signal = this.viewAbort.signal;
      this.setStatus(`<span style="color:var(--pf-accent, #2e6a4c); font-weight:600;">Calcul de l'érosion sur la vue…</span>`);

      try {
        const grid = await loadViewDem(bbox, 720, signal);
        if (signal.aborted) return;
        if (!grid) {
          this.setStatus("Aucune donnée LiDAR dans la vue.");
          return;
        }
        // Facteur R au centre de la vue (raffiné par l'API climat, mis en cache par zone de ~0,25°)
        const cLat = (sth + n) / 2, cLng = (w + e) / 2;
        const rKey = `${Math.round(cLat * 4)}:${Math.round(cLng * 4)}`;
        if (this.rCache.has(rKey)) {
          this.rFactor = this.rCache.get(rKey);
        } else {
          this.rFactor = estimateRFactor(cLat, cLng);
          this.rCache.set(rKey, this.rFactor);
          fetchClimaticRFactor(cLat, cLng).then((r) => {
            if (r && r !== this.rCache.get(rKey)) {
              this.rCache.set(rKey, r);
              this.rFactor = r;
              this.updateRBadge(r, "API Climat");
              if (this.currentGrid) this.compute();
            }
          }).catch(() => {});
        }
        this.updateRBadge(this.rFactor, "RUSLEFAC");
        this.currentGrid = grid;
        this.setStatus("");
        this.compute();
      } catch (err) {
        if (signal.aborted || (err && err.name === "AbortError")) return;
        console.warn("RUSLE (vue) :", err);
        this.setStatus(`<span style="color:#b91c1c; font-weight:600;">${(err && err.message) || "Erreur de calcul d'érosion."}</span>`);
      }
    }

    /**
     * Moyenne des pertes de sol à l'intérieur de la parcelle active, si elle est dans la grille
     */
    computeParcelMean(A) {
      const G = this.currentGrid;
      const parcel = this.currentParcel;
      if (!G || !G.toPixel || !parcel || !parcel.geometry) return null;
      const gb = computeGeomBbox(parcel.geometry);
      if (!gb) return null;
      const corners = [[gb[0], gb[1]], [gb[2], gb[1]], [gb[2], gb[3]], [gb[0], gb[3]]].map(([x, y]) => G.toPixel(x, y));
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])))), x1 = Math.min(G.W - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])))), y1 = Math.min(G.H - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
      if (x1 < x0 || y1 < y0) return null;
      let sum = 0, cnt = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const v = A[y * G.W + x];
          if (!Number.isFinite(v)) continue;
          if (!isPointInGeom(G.pos(x, y), parcel.geometry)) continue;
          sum += v; cnt++;
        }
      }
      return cnt > 10 ? sum / cnt : null;
    }

    async loadSeriesSummaries() {
      if (this.seriesDb) return;
      if (window.soilAi && window.soilAi.seriesDb) {
        this.seriesDb = window.soilAi.seriesDb;
        return;
      }
      try {
        const res = await fetch("data/series_summaries.json");
        if (res.ok) this.seriesDb = await res.json();
      } catch (e) {
        console.warn("loadSeriesSummaries note:", e);
      }
    }

    initDom() {
      const toggle = document.getElementById("toggle-rusle");
      const selSoil = document.getElementById("rusle-soil-select");
      const selCrop = document.getElementById("rusle-crop-select");
      const rngOpacity = document.getElementById("rusle-opacity");

      if (toggle) {
        toggle.addEventListener("change", (e) => {
          this.isVisible = e.target.checked;
          if (this.isVisible) {
            this.scheduleViewUpdate(true);
          } else {
            if (this.viewAbort) this.viewAbort.abort();
            this.setStatus("");
            this.renderLayer();
          }
        });
      }

      if (selSoil) {
        selSoil.addEventListener("change", (e) => {
          this.soilKey = e.target.value;
          if (this.currentGrid) this.compute();
        });
      }

      if (selCrop) {
        selCrop.addEventListener("change", (e) => {
          this.cropKey = e.target.value;
          if (this.currentGrid) this.compute();
        });
      }

      if (rngOpacity) {
        rngOpacity.addEventListener("input", (e) => {
          this.opacity = Number(e.target.value) / 100;
          const badge = document.getElementById("rusle-opacity-val");
          if (badge) badge.textContent = `${Math.round(this.opacity * 100)}%`;
          if (this.map && this.map.getLayer(this.LAYER_ERO)) {
            this.map.setPaintProperty(this.LAYER_ERO, "raster-opacity", this.opacity);
          }
        });
      }
    }

    /**
     * Ouvre et active le panneau RUSLE dans le menu de gauche
     */
    openLeftCard() {
      const panelTools = document.getElementById("panel-tools");
      const backdrop = document.getElementById("tools-backdrop");
      if (panelTools) {
        panelTools.classList.add("open");
        if (backdrop) backdrop.classList.add("active");
      }

      const card = document.getElementById("card-rusle");
      if (card) {
        card.open = true;
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        card.style.transition = "box-shadow 0.3s ease";
        card.style.boxShadow = "0 0 0 3px #ea580c";
        setTimeout(() => { card.style.boxShadow = ""; }, 1200);
      }

      const toggle = document.getElementById("toggle-rusle");
      if (toggle) toggle.checked = true;
      this.isVisible = true;
    }

    /**
     * Détermine la texture du sol en priorité via la pédologie IRDA/AAC,
     * ou à défaut via Soil World (API ISRIC SoilGrids).
     */
    async detectSoilTexture(centerLat, centerLng, parcelProps) {
      await this.loadSeriesSummaries();

      let pedoTexture = null;
      let pedoSeriesName = "";

      // 1. Détection via les données pédologiques québécoises
      let seriesDesc = parcelProps && (parcelProps.s1_desc || parcelProps.SERIE || parcelProps.serie);
      let appellation = parcelProps && (parcelProps.Appellation_cartographique || parcelProps.appellation);

      if ((!seriesDesc && !appellation) && this.map) {
        try {
          const pt = this.map.project([centerLng, centerLat]);
          const hits = this.map.queryRenderedFeatures(pt, {
            layers: ["pedologie-fill", "pedologie-hit-layer"].filter(l => this.map.getLayer(l))
          });
          if (hits && hits.length > 0) {
            const hp = hits[0].properties || {};
            seriesDesc = hp.s1_desc || hp.SERIE || hp.serie;
            appellation = hp.Appellation_cartographique || hp.appellation;
          }
        } catch (e) {}
      }

      if (seriesDesc || appellation) {
        let matched = null;
        if (this.seriesDb) {
          const norm = (s) => {
            if (!s) return "";
            let c = s.replace(/^Série\s+/i, "").trim().toLowerCase();
            c = c.replace(/\bst[-.\s]/i, "saint-").replace(/\bste[-.\s]/i, "sainte-");
            return c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          };
          const slug1 = norm(seriesDesc);
          const slug2 = norm(appellation);
          matched = this.seriesDb[slug1] || this.seriesDb[slug2];
        }

        if (matched && matched.texture) {
          pedoTexture = matched.texture;
          pedoSeriesName = matched.nom || seriesDesc;
        } else if (seriesDesc) {
          pedoSeriesName = seriesDesc;
        }
      }

      if (pedoTexture || pedoSeriesName) {
        const raw = (pedoTexture || pedoSeriesName).toLowerCase();
        let soilKey = "loam";
        if (raw.includes("argile lourde") || (raw.includes("argile") && !raw.includes("loam"))) {
          soilKey = "clay";
        } else if (raw.includes("argil") && raw.includes("loam")) {
          soilKey = "clay_loam";
        } else if (raw.includes("limon") || raw.includes("limoneux")) {
          soilKey = "silt_loam";
        } else if (raw.includes("sable") && raw.includes("loam")) {
          soilKey = "sandy_loam";
        } else if (raw.includes("sable")) {
          soilKey = "sand";
        } else {
          soilKey = "loam";
        }

        return {
          source: "pedo",
          sourceLabel: `Pédologie QC : ${pedoSeriesName || "Série identifiée"}`,
          desc: pedoTexture ? `Série ${pedoSeriesName} — Texture : ${pedoTexture}` : `Série ${pedoSeriesName}`,
          soilKey: soilKey
        };
      }

      // 2. Détection via Soil World (ISRIC SoilGrids REST API)
      try {
        const sgUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${centerLng.toFixed(4)}&lat=${centerLat.toFixed(4)}&property=clay&property=sand&property=silt&depth=0-5cm&value=mean`;
        const res = await fetch(sgUrl, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const data = await res.json();
          const layers = (data && data.properties && data.properties.layers) || [];
          let clay = null, sand = null, silt = null;
          for (const lay of layers) {
            const val = lay.depths && lay.depths[0] && lay.depths[0].values && lay.depths[0].values.mean;
            if (typeof val === "number") {
              if (lay.name === "clay") clay = val / 10;
              if (lay.name === "sand") sand = val / 10;
              if (lay.name === "silt") silt = val / 10;
            }
          }

          if (clay !== null && sand !== null && silt !== null) {
            let soilKey = "loam";
            let texName = "Loam";
            if (clay >= 40) {
              soilKey = "clay"; texName = "Argile";
            } else if (clay >= 27 && sand <= 45) {
              soilKey = "clay_loam"; texName = "Loam argileux";
            } else if (silt >= 50 || (silt >= 40 && clay >= 15)) {
              soilKey = "silt_loam"; texName = "Loam limoneux";
            } else if (sand >= 52 || (sand >= 43 && clay <= 20)) {
              soilKey = "sandy_loam"; texName = "Loam sableux";
            } else if (sand >= 85) {
              soilKey = "sand"; texName = "Sable";
            } else {
              soilKey = "loam"; texName = "Loam";
            }

            return {
              source: "soilgrids",
              sourceLabel: `Soil World : ${texName}`,
              desc: `Soil World : ${texName} (${Math.round(clay)}% argile, ${Math.round(silt)}% limon, ${Math.round(sand)}% sable)`,
              soilKey: soilKey
            };
          }
        }
      } catch (e) {}

      // 3. Fallback standard
      return {
        source: "default",
        sourceLabel: "Défaut : Loam",
        desc: "Texture de référence (Loam standard, K = 0,040)",
        soilKey: "loam"
      };
    }

    /**
     * Détecte la dernière culture renseignée dans la parcelle BDPPAD
     * pour le facteur C par défaut.
     */
    detectLatestCrop(parcelProps) {
      if (!parcelProps) return { cropKey: "bare", cropLabel: "Sol nu (témoin)", year: "" };

      const crop = (parcelProps.DESCODPR1 || parcelProps.descodpr1 || parcelProps.culture || parcelProps.CULTURE || "").trim();
      const year = (parcelProps.AN_PR1 || parcelProps.an_pr1 || "").trim();

      if (!crop) return { cropKey: "bare", cropLabel: "Sol nu (par défaut)", year: "" };

      const cLower = crop.toLowerCase();
      let cropKey = "bare";

      if (cLower.includes("pomme de terre") || cLower.includes("patate") || cLower.includes("sarclé") || cLower.includes("sarcle") || cLower.includes("maraîch") || cLower.includes("maraich")) {
        cropKey = "potato";
      } else if (cLower.includes("maïs") || cLower.includes("mais")) {
        cropKey = "corn_plow";
      } else if (cLower.includes("soya")) {
        cropKey = "soybean";
      } else if (cLower.includes("céréale") || cLower.includes("cereale") || cLower.includes("orge") || cLower.includes("avoine") || cLower.includes("seigle") || cLower.includes("triticale") || cLower.includes("blé") || cLower.includes("ble ") || cLower.startsWith("ble")) {
        cropKey = "cereals";
      } else if (cLower.includes("foin") || cLower.includes("prairie") || cLower.includes("pâturage") || cLower.includes("paturage") || cLower.includes("luzerne") || cLower.includes("trèfle") || cLower.includes("trefle")) {
        cropKey = "hay";
      } else if (cLower.includes("canola") || cLower.includes("colza") || cLower.includes("tournesol")) {
        cropKey = "canola";
      }

      return {
        cropKey: cropKey,
        cropLabel: crop,
        year: year
      };
    }

    /**
     * Lance le calcul et l'affichage complet du modèle RUSLE sur une parcelle
     */
    async calculateForParcel(parcelFeature) {
      if (!parcelFeature || !parcelFeature.geometry) return;

      this.currentParcel = assembleParcel(parcelFeature);
      this.openLeftCard();
      this.highlightParcel(this.currentParcel.geometry);
      this.updateCardHeader(this.currentParcel.properties);

      const geomBbox = computeGeomBbox(this.currentParcel.geometry);
      const centerLng = (geomBbox[0] + geomBbox[2]) / 2;
      const centerLat = (geomBbox[1] + geomBbox[3]) / 2;

      // Facteur C : dernière culture déclarée ; facteur K : texture du sol
      const detectedCrop = this.detectLatestCrop(this.currentParcel.properties);
      this.cropKey = detectedCrop.cropKey;
      const selCrop = document.getElementById("rusle-crop-select");
      if (selCrop) selCrop.value = this.cropKey;

      const soilInfo = await this.detectSoilTexture(centerLat, centerLng, this.currentParcel.properties);
      this.soilKey = soilInfo.soilKey;
      const selSoil = document.getElementById("rusle-soil-select");
      if (selSoil) selSoil.value = this.soilKey;

      // Cadrage : le calcul à la volée se relance au « moveend »
      if (geomBbox && this.map) {
        const before = this.map.getCenter().toArray().join(",") + this.map.getZoom();
        this.map.fitBounds(
          [[geomBbox[0], geomBbox[1]], [geomBbox[2], geomBbox[3]]],
          { padding: { top: 60, bottom: 60, left: 60, right: 60 }, duration: 800, maxZoom: 17 }
        );
        const after = this.map.getCenter().toArray().join(",") + this.map.getZoom();
        if (before === after) this.scheduleViewUpdate(true);
      } else {
        this.scheduleViewUpdate(true);
      }
    }

    /**
     * Calcul numérique RUSLE : A = R · K · LS · C · P
     */
    compute() {
      if (!this.currentGrid) return;
      // Grille déjà lissée (2 passes) et à cuvettes comblées par loadViewDem
      const G = this.currentGrid;
      const { W, H, dx, dy, z } = G;
      const N = W * H;

      const zf = G.zf || fillDepressions(z, W, H, 1e-4);
      const cell = dx * dy;
      const width = (dx + dy) / 2;

      const DX = [1, 1, 0, -1, -1, -1, 0, 1];
      const DY = [0, 1, 1, 1, 0, -1, -1, -1];
      const DIST = DX.map((a, d) => Math.hypot(a * dx, DY[d] * dy));

      const order = [];
      for (let i = 0; i < N; i++) {
        if (!Number.isNaN(zf[i])) order.push(i);
      }
      order.sort((a, b) => zf[b] - zf[a]);

      // Aire contributive spécifique (Freeman 1.1)
      const acc = new Float64Array(N);
      for (const i of order) acc[i] += cell;

      for (const i of order) {
        const x = i % W, y = (i / W) | 0;
        const zc = zf[i];
        let sum = 0;
        const w8 = new Float64Array(8);

        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d], yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx, zn = zf[j];
          if (Number.isNaN(zn) || zn >= zc) continue;
          const s = (zc - zn) / DIST[d];
          w8[d] = Math.pow(s, 1.1) * (d % 2 ? 0.354 : 0.5);
          sum += w8[d];
        }

        if (sum <= 0) continue;
        for (let d = 0; d < 8; d++) {
          if (w8[d] > 0) {
            acc[(y + DY[d]) * W + x + DX[d]] += acc[i] * (w8[d] / sum);
          }
        }
      }

      // Facteurs RUSLE
      const R = this.rFactor;
      const soil = SOIL_TYPES[this.soilKey] || SOIL_TYPES.loam;
      const K = soil.k;
      const crop = CROP_FACTORS[this.cropKey] || CROP_FACTORS.bare;
      const C = crop.c;
      const P = 1.0;

      const A = new Float32Array(N).fill(NaN);
      let sumA = 0, countA = 0;
      const Z = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? NaN : z[yy * W + xx]);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (Number.isNaN(z[i])) continue;

          const zx1 = Z(x + 1, y), zx0 = Z(x - 1, y);
          const zy1 = Z(x, y + 1), zy0 = Z(x, y - 1);

          const gx = !Number.isNaN(zx1) && !Number.isNaN(zx0) ? (zx1 - zx0) / (2 * dx) : !Number.isNaN(zx1) ? (zx1 - z[i]) / dx : !Number.isNaN(zx0) ? (z[i] - zx0) / dx : 0;
          const gy = !Number.isNaN(zy1) && !Number.isNaN(zy0) ? (zy1 - zy0) / (2 * dy) : !Number.isNaN(zy1) ? (zy1 - z[i]) / dy : !Number.isNaN(zy0) ? (z[i] - zy0) / dy : 0;

          const sinb = Math.sin(Math.atan(Math.hypot(gx, gy)));
          const As = Math.min(300, acc[i] / width);
          const LS = Math.pow(As / 22.13, 0.4) * Math.pow(sinb / 0.0896, 1.3);

          A[i] = R * K * LS * C * P;
          sumA += A[i];
          countA++;
        }
      }

      const mean = countA ? sumA / countA : 0;
      const areaHa = (countA * cell) / 10000;
      const total = mean * areaHa;

      this.parcelMean = this.computeParcelMean(A);
      this.eroResult = { A, mean, total, areaHa };
      this.updateStatsDisplay();
      this.renderLayer();
    }

    createDataUrl() {
      if (!this.currentGrid || !this.eroResult) return null;
      const { W, H } = this.currentGrid;
      const A = this.eroResult.A;

      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(W, H);
      const px = img.data;

      for (let i = 0; i < A.length; i++) {
        const v = A[i];
        if (!Number.isFinite(v)) continue;

        const match = RUSLE_CLASSES.find((c) => v < c[0]);
        const rgb = match ? match[1] : [168, 32, 90];
        const o = i * 4;
        px[o] = rgb[0];
        px[o + 1] = rgb[1];
        px[o + 2] = rgb[2];
        px[o + 3] = 210;
      }

      ctx.putImageData(img, 0, 0);
      return cv.toDataURL();
    }

    renderLayer() {
      if (!this.map || typeof this.map.getSource !== "function" || !this.currentGrid) return;

      const shouldShow = this.isVisible && this.eroResult;
      if (!shouldShow) {
        if (this.map.getLayer(this.LAYER_ERO)) {
          this.map.setLayoutProperty(this.LAYER_ERO, "visibility", "none");
        }
        return;
      }

      const url = this.createDataUrl();
      if (!url) return;
      const coords = getGridCorners(this.currentGrid);

      if (!this.map.getSource(this.SRC_ERO)) {
        this.map.addSource(this.SRC_ERO, {
          type: "image",
          url: url,
          coordinates: coords
        });

        // Placé sous la couche pluie dynamique et sous les limites de parcelle
        const beforeLayer = this.map.getLayer("sim-rain-layer")
          ? "sim-rain-layer"
          : (this.map.getLayer("parcelles-line") ? "parcelles-line" : undefined);

        this.map.addLayer({
          id: this.LAYER_ERO,
          type: "raster",
          source: this.SRC_ERO,
          paint: {
            "raster-opacity": this.opacity,
            "raster-fade-duration": 0,
            "raster-resampling": "linear"
          }
        }, beforeLayer);
      } else {
        this.map.getSource(this.SRC_ERO).updateImage({ url, coordinates: coords });
        this.map.setLayoutProperty(this.LAYER_ERO, "visibility", "visible");
        this.map.setPaintProperty(this.LAYER_ERO, "raster-opacity", this.opacity);
      }
    }

    updateCardHeader(props) {
      props = props || {};
      const pid = props.IDPAR || props.idpar || "";
      const lot = props.NO_LOT || "";
      const sup = props.SUPHEC || props.suphec || "";

      const nameEl = document.getElementById("rusle-parcel-name");
      if (nameEl) {
        const sNum = parseFloat(sup);
        const supStr = !isNaN(sNum) ? ` (${sNum.toFixed(1)} ha)` : (sup ? ` (${sup} ha)` : "");
        nameEl.textContent = pid ? `Parcelle nº ${pid}${supStr}` : (lot ? `Lot nº ${lot}${supStr}` : `Parcelle agricole${supStr}`);
        nameEl.style.display = "block";
      }
    }

    updateStatsDisplay() {
      if (!this.eroResult) return;
      const { mean } = this.eroResult;
      const hasParcel = Number.isFinite(this.parcelMean);
      const elMean = document.getElementById("rusle-mean-val");
      if (elMean) elMean.textContent = `${(hasParcel ? this.parcelMean : mean).toFixed(1)} t/ha/an`;
      const elLabel = document.getElementById("rusle-mean-label");
      if (elLabel) elLabel.textContent = hasParcel ? "Moyenne sur la parcelle :" : "Moyenne sur la vue :";
      const nameEl = document.getElementById("rusle-parcel-name");
      if (hasParcel && this.currentParcel) this.updateCardHeader(this.currentParcel.properties);
      else if (nameEl) nameEl.style.display = "none";
    }

    updateRBadge(rVal, source = "RUSLEFAC") {
      const badge = document.getElementById("rusle-r-badge");
      if (badge) {
        badge.textContent = `${rVal} MJ·mm/ha·h·an`;
        badge.title = `Érosivité R = ${rVal} calculée automatiquement (${source})`;
      }
    }

    highlightParcel(geom) {
      if (!this.map || typeof this.map.getSource !== "function" || !geom) return;
      const geojson = {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: geom, properties: {} }]
      };

      if (!this.map.getSource(this.SRC_HL)) {
        this.map.addSource(this.SRC_HL, { type: "geojson", data: geojson });
        this.map.addLayer({
          id: this.LAYER_HL,
          type: "line",
          source: this.SRC_HL,
          paint: {
            "line-color": "#ea580c",
            "line-width": 2.5,
            "line-opacity": 0.95
          }
        });
      } else {
        this.map.getSource(this.SRC_HL).setData(geojson);
        this.map.setLayoutProperty(this.LAYER_HL, "visibility", "visible");
      }
    }

    clearHighlight() {
      if (this.map && typeof this.map.getLayer === "function" && this.map.getLayer(this.LAYER_HL)) {
        this.map.setLayoutProperty(this.LAYER_HL, "visibility", "none");
      }
    }
  }

  // ===========================================================================
  // 3. FAÇADE DE COGNITION & COMPATIBILITÉ (ParcelSimulationManager)
  // ===========================================================================
  class ParcelSimulationManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.rainManager = new ParcelRainManager(mapInstance);
      this.erosionManager = new ParcelErosionManager(mapInstance);

      // Exposer globalement
      root.rainManager = this.rainManager;
      root.erosionManager = this.erosionManager;
    }

    startSimulation(parcelFeature, mode = "rain") {
      if (mode === "erosion") {
        return this.erosionManager.calculateForParcel(parcelFeature);
      }
      return this.rainManager.startSimulation(parcelFeature);
    }

    closeDock() {
      this.rainManager.closeDock();
    }

    bringToFront() {
      if (this.rainManager && typeof this.rainManager.bringToFront === "function") {
        this.rainManager.bringToFront();
      }
    }
  }

  root.ParcelRainManager = ParcelRainManager;
  root.ParcelErosionManager = ParcelErosionManager;
  root.ParcelSimulationManager = ParcelSimulationManager;

})(window);
