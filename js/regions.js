/**
 * Plan de Ferme — Données régionales hors Québec
 *
 * Affiche, seulement quand la carte est centrée dans la juridiction concernée :
 *  - France métropolitaine : RPG 2025 (IGN), sols dominants (INRAE / Gis Sol), cadastre PCI
 *  - États-Unis (48 États) : limites de champs CSB 2024 (USDA NASS), sols SSURGO (USDA NRCS)
 *  - Ontario, Alberta, Saskatchewan, Colombie-Britannique : levés pédologiques provinciaux
 * et ouvre une fiche (sols, culture, NDVI) au clic sur la carte dans ces juridictions.
 *
 * Tous les services sont interrogés directement par le navigateur (CORS vérifié).
 */
(function () {
  "use strict";

  const esc = window.pfEsc || ((v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
  const STORE_KEY = "pf-reg-layers";
  const fmt = (n, d = 1) => Number(n).toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d });

  // ---------------------------------------------------------------------------
  // 1. Juridictions (contours simplifiés, suffisants pour le centre de la vue)
  // ---------------------------------------------------------------------------
  const JURIS = {
    FR: {
      name: "France métropolitaine",
      polys: [
        [[2.54, 51.09], [3.2, 50.77], [4.17, 50.28], [4.82, 50.16], [5.8, 49.55], [6.37, 49.47], [7.6, 49.08], [8.23, 48.97], [7.58, 47.59], [6.9, 47.45], [6.1, 46.4], [6.8, 46.45], [7.05, 45.92], [7.13, 45.26], [6.63, 45.11], [7.0, 44.2], [7.53, 43.78], [6.6, 43.0], [4.5, 43.3], [3.2, 42.43], [1.8, 42.35], [0.7, 42.85], [-0.8, 42.95], [-1.78, 43.37], [-1.6, 44.5], [-1.3, 46.0], [-2.6, 47.2], [-4.9, 47.8], [-4.9, 48.6], [-3.0, 48.9], [-1.6, 48.7], [-1.95, 49.75], [0.1, 49.55], [1.45, 50.2], [1.6, 50.95]],
        [[8.5, 41.33], [9.65, 41.33], [9.65, 43.05], [8.5, 43.05]]
      ]
    },
    US: {
      name: "États-Unis (48 États contigus)",
      polys: [[
        [-124.8, 48.4], [-123.25, 48.3], [-123.3, 49.0], [-95.15, 49.0], [-94.8, 49.38], [-89.6, 48.0], [-84.9, 46.6], [-82.45, 45.3], [-82.1, 43.0], [-83.1, 42.0], [-82.7, 41.7], [-79.0, 42.45], [-79.1, 43.45], [-76.4, 44.1], [-74.7, 45.0], [-71.5, 45.0], [-70.7, 45.6], [-69.2, 47.45], [-67.8, 47.07], [-67.0, 44.8],
        [-69.9, 41.2], [-73.9, 40.4], [-75.5, 35.2], [-80.0, 32.0], [-80.0, 25.0], [-82.0, 24.4], [-83.0, 29.0], [-89.0, 28.9], [-97.1, 25.9], [-99.5, 27.5], [-101.4, 29.8], [-104.9, 29.5], [-106.5, 31.8], [-111.1, 31.33], [-114.8, 32.5], [-117.1, 32.53], [-120.6, 34.5], [-124.5, 40.3]
      ]]
    },
    ON: {
      name: "Ontario",
      polys: [[
        [-95.15, 49.0], [-95.15, 52.85], [-89.0, 56.9], [-82.2, 55.15], [-79.52, 51.5], [-79.52, 47.5], [-78.7, 46.3], [-77.3, 45.9], [-76.1, 45.45], [-74.4, 45.55], [-74.34, 45.0],
        [-74.7, 45.0], [-76.4, 44.1], [-79.1, 43.45], [-79.0, 42.45], [-82.7, 41.7], [-83.1, 42.0], [-82.1, 43.0], [-82.45, 45.3], [-84.9, 46.6], [-89.6, 48.0], [-94.8, 49.38]
      ]]
    },
    AB: {
      name: "Alberta",
      polys: [[[-110.005, 49.0], [-114.06, 49.0], [-114.7, 50.3], [-116.0, 51.2], [-117.3, 52.2], [-118.6, 52.9], [-120.0, 53.8], [-120.0, 60.0], [-110.005, 60.0]]]
    },
    SK: {
      name: "Saskatchewan",
      polys: [[[-110.005, 49.0], [-101.36, 49.0], [-101.45, 55.0], [-102.0, 60.0], [-110.005, 60.0]]]
    },
    BC: {
      name: "Colombie-Britannique",
      polys: [[[-123.3, 49.0], [-114.06, 49.0], [-114.7, 50.3], [-116.0, 51.2], [-117.3, 52.2], [-118.6, 52.9], [-120.0, 53.8], [-120.0, 60.0], [-139.05, 60.0], [-137.5, 59.0], [-135.5, 59.8], [-133.4, 58.4], [-130.0, 55.9], [-130.6, 54.7], [-133.5, 54.6], [-131.0, 51.5], [-128.0, 50.0], [-125.0, 48.3]]]
    }
  };

  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function jurisdictionAt(lng, lat) {
    for (const code of Object.keys(JURIS)) {
      if (JURIS[code].polys.some((r) => inRing([lng, lat], r))) return code;
    }
    return null;
  }
  window.pfJurisdictionAt = jurisdictionAt;

  // ---------------------------------------------------------------------------
  // 2. Couches régionales
  // ---------------------------------------------------------------------------
  const GEOPF = (layer) => `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256`;
  const AGS = (ms, id) => `${ms}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&layers=show:${id}&f=image`;
  const ON_MS = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer";
  const AB_MS = "https://geospatial.alberta.ca/titan/rest/services/soil/soil_agrasid41_t/MapServer";
  const SK_MS = "https://gis.saskatchewan.ca/arcgis/rest/services/Soils/MapServer";
  const BC_WMS = "https://openmaps.gov.bc.ca/geo/pub/wms";
  const BC_LAYER = "pub:WHSE_TERRESTRIAL_ECOLOGY.STE_SOIL_SURVEYS_MVW";
  const SDM_WMS = "https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms";
  const SDA_REST = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest";
  const CSB_URL = "https://data.source.coop/ftw/harmonized-field-data/us_usda_cropland/year=2024/us_usda_cropland-2024.pmtiles";

  const LAYERS = {
    "fr-rpg": {
      juris: "FR", name: "Parcelles agricoles (RPG 2025)", sub: "IGN · déclarations PAC, culture au clic",
      kind: "raster", tiles: GEOPF("LANDUSE.AGRICULTURE.LATEST"), minzoom: 6, maxzoom: 16, opacity: 0.8,
      attribution: "© IGN – Registre parcellaire graphique"
    },
    "fr-sols": {
      juris: "FR", name: "Sols dominants (INRAE)", sub: "Gis Sol · carte harmonisée, détail au clic",
      kind: "raster", tiles: GEOPF("INRAE_CARTE-SOLS"), minzoom: 5, maxzoom: 14, opacity: 0.7,
      attribution: "© INRAE / Gis Sol", legend: "https://data.geopf.fr/annexes/gissol-osf/legendes/INRAE_CARTE-SOLS.png"
    },
    "fr-cadastre": {
      juris: "FR", name: "Cadastre (Parcellaire Express)", sub: "IGN · parcelles cadastrales",
      kind: "raster", tiles: GEOPF("CADASTRALPARCELS.PARCELLAIRE_EXPRESS"), minzoom: 14, maxzoom: 19, opacity: 0.9,
      attribution: "© IGN – PCI"
    },
    "us-csb": {
      juris: "US", name: "Limites de champs (USDA CSB 2024)", sub: "NASS · contours estimés par satellite",
      kind: "pmtiles", url: CSB_URL, sourceLayer: "us_usda_cropland", minzoom: 9, opacity: 0.9,
      attribution: "USDA NASS – Crop Sequence Boundaries"
    },
    "us-ssurgo": {
      juris: "US", name: "Sols SSURGO", sub: "USDA NRCS · unités cartographiques, détail au clic",
      kind: "raster",
      tiles: `${SDM_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=mapunitpoly&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`,
      minzoom: 12, maxzoom: 19, opacity: 0.8, attribution: "USDA NRCS – SSURGO"
    },
    "on-sols": {
      juris: "ON", name: "Levé pédologique de l'Ontario", sub: "LIO · séries, texture, drainage, ICT",
      kind: "raster", tiles: AGS(ON_MS, 9), minzoom: 8, maxzoom: 19, opacity: 0.7, attribution: "© Ontario – LIO (Soil Survey Complex)"
    },
    "ab-sols": {
      juris: "AB", name: "Sols AGRASID (Alberta)", sub: "Paysages pédologiques, cotes LSRS",
      kind: "raster", tiles: AGS(AB_MS, 0), minzoom: 7, maxzoom: 19, opacity: 0.7, attribution: "© Alberta – AGRASID"
    },
    "sk-sols": {
      juris: "SK", name: "Sols SKSID (Saskatchewan)", sub: "Levé pédologique, capacité, salinité",
      kind: "raster", tiles: AGS(SK_MS, 0), minzoom: 7, maxzoom: 19, opacity: 0.7, attribution: "© Saskatchewan – SKSID"
    },
    "bc-sols": {
      juris: "BC", name: "Levés pédologiques (C.-B.)", sub: "BC Soil Information · détail au clic",
      kind: "raster",
      tiles: `${BC_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${BC_LAYER}&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`,
      minzoom: 8, maxzoom: 19, opacity: 0.7, attribution: "© Province of B.C. – Soil Survey"
    }
  };

  const state = { juris: null, on: {}, opacity: {} };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (e) { /* stockage indisponible */ }
  state.on = state.on || {};
  state.opacity = state.opacity || {};
  const saveState = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ on: state.on, opacity: state.opacity })); } catch (e) { /* ignoré */ } };

  const srcId = (id) => `reg-src-${id}`;
  const lyrId = (id) => `reg-lyr-${id}`;

  function beforeId(map) {
    // Sous les couches personnelles et les contours de parcelles québécoises
    const order = ["parcelles-line-bg", "pedologie-line"];
    for (const id of order) if (map.getLayer(id)) return id;
    return undefined;
  }

  function ensureLayer(map, id) {
    const L = LAYERS[id];
    if (!L || map.getLayer(lyrId(id))) return;
    const opacity = state.opacity[id] !== undefined ? state.opacity[id] : L.opacity;
    if (L.kind === "raster") {
      if (!map.getSource(srcId(id))) {
        map.addSource(srcId(id), { type: "raster", tiles: [L.tiles], tileSize: 256, minzoom: L.minzoom || 0, maxzoom: L.maxzoom || 19, attribution: L.attribution });
      }
      map.addLayer({ id: lyrId(id), type: "raster", source: srcId(id), minzoom: L.minzoom || 0, layout: { visibility: "none" }, paint: { "raster-opacity": opacity, "raster-fade-duration": 150 } }, beforeId(map));
    } else if (L.kind === "pmtiles") {
      if (!map.getSource(srcId(id))) {
        map.addSource(srcId(id), { type: "vector", url: "pmtiles://" + L.url, attribution: L.attribution });
      }
      map.addLayer({
        id: lyrId(id), type: "line", source: srcId(id), "source-layer": L.sourceLayer, minzoom: L.minzoom || 0,
        layout: { visibility: "none", "line-join": "round" },
        paint: { "line-color": "#17211b", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 1.4, 17, 2.2], "line-opacity": opacity, "line-dasharray": [3, 2] }
      }, beforeId(map));
      // Couche de détection invisible (fiche au clic même si la couche est masquée)
      map.addLayer({ id: lyrId(id) + "-hit", type: "fill", source: srcId(id), "source-layer": L.sourceLayer, minzoom: L.minzoom || 0, layout: { visibility: "none" }, paint: { "fill-opacity": 0 } }, beforeId(map));
    }
  }

  function setLayerVisible(map, id, visible) {
    if (visible) ensureLayer(map, id);
    if (map.getLayer(lyrId(id))) map.setLayoutProperty(lyrId(id), "visibility", visible ? "visible" : "none");
  }

  function setOpacity(map, id, value) {
    state.opacity[id] = value;
    saveState();
    const L = LAYERS[id];
    if (!map.getLayer(lyrId(id))) return;
    map.setPaintProperty(lyrId(id), L.kind === "raster" ? "raster-opacity" : "line-opacity", value);
  }

  // Couches de détection des juridictions actives (CSB : toujours chargé aux États-Unis)
  function syncHitLayers(map) {
    const usHit = state.juris === "US";
    if (usHit) ensureLayer(map, "us-csb");
    if (map.getLayer(lyrId("us-csb") + "-hit")) map.setLayoutProperty(lyrId("us-csb") + "-hit", "visibility", usHit ? "visible" : "none");
  }

  // ---------------------------------------------------------------------------
  // 3. Panneau « Couches » : groupe de la juridiction courante
  // ---------------------------------------------------------------------------
  function renderGroup(map) {
    const group = document.getElementById("pf-regional-group");
    const list = document.getElementById("pf-regional-list");
    const title = document.getElementById("pf-regional-title");
    if (!group || !list) return;
    const ids = Object.keys(LAYERS).filter((id) => LAYERS[id].juris === state.juris);
    group.hidden = ids.length === 0;
    if (!ids.length) { list.innerHTML = ""; return; }
    title.textContent = `Données — ${JURIS[state.juris].name}`;
    const zoom = map.getZoom();
    list.innerHTML = ids.map((id) => {
      const L = LAYERS[id];
      const op = Math.round(100 * (state.opacity[id] !== undefined ? state.opacity[id] : L.opacity));
      const zNote = zoom < (L.minzoom || 0) ? ` · visible dès le zoom ${L.minzoom}` : "";
      return `
        <details class="tool-card pf-layer pf-reg-layer" data-reg="${id}">
          <summary class="tool-card-header pf-layer-summary">
            <div class="tool-card-title"><span>${esc(L.name)}</span></div>
            <label class="switch-label" onclick="event.stopPropagation()" title="Afficher / masquer ${esc(L.name)}">
              <input type="checkbox" class="pf-reg-toggle" data-reg="${id}" ${state.on[id] ? "checked" : ""} />
              <span class="switch-slider"></span>
            </label>
          </summary>
          <div class="pf-layer-body">
            <div class="pf-reg-sub">${esc(L.sub)}${zNote}</div>
            <div class="tool-label-row"><span class="tool-sublabel">Opacité</span><span class="val-badge pf-reg-op-val">${op}%</span></div>
            <input type="range" class="slider pf-reg-op" data-reg="${id}" min="0" max="100" value="${op}" />
            ${L.legend ? `<img class="pf-reg-legend" src="${esc(L.legend)}" alt="Légende : ${esc(L.name)}" loading="lazy" />` : ""}
          </div>
        </details>`;
    }).join("");
    list.querySelectorAll(".pf-reg-toggle").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.reg;
        state.on[id] = cb.checked;
        saveState();
        setLayerVisible(map, id, cb.checked);
        if (typeof window.bringTopLayersToFront === "function") window.bringTopLayersToFront();
      });
    });
    list.querySelectorAll(".pf-reg-op").forEach((rg) => {
      rg.addEventListener("input", () => {
        const id = rg.dataset.reg;
        rg.closest(".pf-layer-body").querySelector(".pf-reg-op-val").textContent = `${rg.value}%`;
        setOpacity(map, id, Number(rg.value) / 100);
      });
    });
    const hint = document.getElementById("pf-regional-hint");
    if (hint) hint.textContent = state.juris === "FR" || state.juris === "US"
      ? "Cliquez sur la carte pour la fiche : sols et culture de la parcelle."
      : "Cliquez sur la carte pour le détail du sol.";
  }

  function updateJurisdiction(map) {
    const c = map.getCenter();
    const j = jurisdictionAt(c.lng, c.lat);
    const changed = j !== state.juris;
    state.juris = j;
    Object.keys(LAYERS).forEach((id) => {
      const show = LAYERS[id].juris === j && !!state.on[id];
      if (show || map.getLayer(lyrId(id))) setLayerVisible(map, id, show);
    });
    syncHitLayers(map);
    if (changed) renderGroup(map);
    else {
      // Rafraîchir seulement les mentions de zoom
      document.querySelectorAll("#pf-regional-list .pf-reg-layer").forEach((el) => {
        const L = LAYERS[el.dataset.reg];
        const sub = el.querySelector(".pf-reg-sub");
        if (sub) sub.textContent = L.sub + (map.getZoom() < (L.minzoom || 0) ? ` · visible dès le zoom ${L.minzoom}` : "");
      });
    }
    document.body.dataset.pfJuris = j || "";
  }

  // ---------------------------------------------------------------------------
  // 4. Interrogation des services au clic
  // ---------------------------------------------------------------------------
  async function fetchJson(url, opts, ms = 9000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {}));
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  function geopfInfo(layer, lng, lat) {
    const d = 0.0004;
    const bbox = [lat - d, lng - d, lat + d, lng + d].join(",");
    const u = `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${layer}&QUERY_LAYERS=${layer}&STYLES=&FORMAT=image/png&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/json&FEATURE_COUNT=1`;
    return fetchJson(u).then((j) => (j && j.features && j.features[0]) || null);
  }

  function arcgisQuery(ms, layerId, lng, lat) {
    const u = `${ms}/${layerId}/query?f=json&geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false`;
    return fetchJson(u).then((j) => (j && j.features && j.features[0] && j.features[0].attributes) || null);
  }

  function arcgisIdentify(ms, layerId, lng, lat) {
    const d = 0.005;
    const u = `${ms}/identify?f=json&geometry=${lng},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all:${layerId}&tolerance=1&mapExtent=${lng - d},${lat - d},${lng + d},${lat + d}&imageDisplay=400,400,96&returnGeometry=false`;
    return fetchJson(u).then((j) => (j && j.results && j.results[0] && j.results[0].attributes) || null);
  }

  function bcInfo(lng, lat) {
    const d = 0.0005;
    const u = `${BC_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${BC_LAYER}&QUERY_LAYERS=${BC_LAYER}&STYLES=&SRS=EPSG:4326&BBOX=${lng - d},${lat - d},${lng + d},${lat + d}&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=application/json&FEATURE_COUNT=1`;
    return fetchJson(u).then((j) => (j && j.features && j.features[0] && j.features[0].properties) || null);
  }

  async function sdaQuery(sql, ms) {
    const j = await fetchJson(SDA_REST, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql, format: "JSON+COLUMNNAME" }) }, ms || 12000);
    if (!j || !Array.isArray(j.Table) || j.Table.length < 2) return [];
    const [cols, ...rows] = j.Table;
    return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  }

  // Deux requêtes courtes : la requête combinée dépasse souvent le délai du service
  async function ssurgoInfo(lng, lat) {
    const keys = await sdaQuery(`SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng.toFixed(6)} ${lat.toFixed(6)})')`, 15000);
    const mukey = keys[0] && String(keys[0].mukey || "").replace(/[^0-9]/g, "");
    if (!mukey) return null;
    const rows = await sdaQuery(`SELECT TOP 3 mu.muname, mu.musym, mu.farmlndcl, c.compname, c.comppct_r, c.drainagecl, c.hydgrp, c.nirrcapcl, c.nirrcapscl, c.taxclname
      FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey WHERE mu.mukey = '${mukey}' ORDER BY c.comppct_r DESC`);
    return rows.length ? rows : null;
  }

  // ---------------------------------------------------------------------------
  // 5. Mise en forme des sols par juridiction
  // ---------------------------------------------------------------------------
  const DRAIN_ON = { E: "Excessif", R: "Rapide", W: "Bon", MW: "Modérément bon", I: "Imparfait", P: "Mauvais", VP: "Très mauvais" };
  const TEXT_ON = { S: "Sable", LS: "Sable loameux", SL: "Loam sableux", L: "Loam", SIL: "Loam limoneux", SI: "Limon", SCL: "Loam sablo-argileux", CL: "Loam argileux", SICL: "Loam limono-argileux", SC: "Argile sableuse", SIC: "Argile limoneuse", C: "Argile", HC: "Argile lourde", ORG: "Organique" };
  const FARMLAND_US = {
    "All areas are prime farmland": "Terres agricoles de première qualité",
    "Not prime farmland": "Pas de première qualité",
    "Farmland of statewide importance": "Terres d'importance pour l'État",
    "Farmland of local importance": "Terres d'importance locale",
    "Farmland of unique importance": "Terres d'importance particulière"
  };
  const DRAIN_BC = { R: "Rapide", W: "Bon", MW: "Modérément bon", I: "Imparfait", P: "Mauvais", VP: "Très mauvais", VR: "Très rapide" };
  const DRAIN_US = { "Excessively drained": "Excessif", "Somewhat excessively drained": "Plutôt excessif", "Well drained": "Bon", "Moderately well drained": "Modérément bon", "Somewhat poorly drained": "Imparfait", "Poorly drained": "Mauvais", "Very poorly drained": "Très mauvais" };

  const facts = (rows) => `<dl class="pf-fiche-facts">${rows.filter((r) => r[1] !== null && r[1] !== undefined && String(r[1]).trim() !== "").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const seriesCard = (name, pct, extra) => `
    <div class="pedo-series-card">
      <div class="pedo-series-top"><span class="pedo-series-name">${esc(name)}</span>${pct != null ? `<span class="pedo-series-pct">${esc(Math.round(pct))}%</span>` : ""}</div>
      ${pct != null ? `<div class="pedo-progress-track"><div class="pedo-progress-fill" style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%;"></div></div>` : ""}
      ${extra ? `<div class="pf-reg-series-extra">${extra}</div>` : ""}
    </div>`;
  const source = (txt) => `<div class="pf-reg-source">Source : ${esc(txt)}</div>`;
  const none = (txt) => `<div class="pf-reg-empty">${esc(txt)}</div>`;

  async function soilsHtml(juris, lng, lat) {
    if (juris === "FR") {
      const f = await geopfInfo("INRAE_CARTE-SOLS", lng, lat);
      if (!f) return none("Aucune unité de sol cartographiée à cet endroit.");
      const p = f.properties || {};
      return `
        <h3 class="pedo-popup-title">${esc(p.nom_sol_dominant ? p.nom_sol_dominant.charAt(0) + p.nom_sol_dominant.slice(1).toLowerCase() : "Sol dominant")}</h3>
        ${p.pourcent_sol_dominant != null ? `<div class="pf-reg-sub">Sol dominant à ${esc(p.pourcent_sol_dominant)} % de l'unité</div>` : ""}
        <div class="pedo-series-heading">Unité cartographique de sol${p.no_ucs ? ` nº ${esc(p.no_ucs)}` : ""}</div>
        <p class="pf-reg-text">${esc(p.nom_ucs || "")}</p>
        ${source("INRAE / Gis Sol – Sols dominants de France métropolitaine (carte harmonisée, échelle régionale)")}`;
    }
    if (juris === "US") {
      const rows = await ssurgoInfo(lng, lat);
      if (!rows || !rows.length) return none("Aucune unité SSURGO trouvée (ou service indisponible).");
      const mu = rows[0];
      return `
        <h3 class="pedo-popup-title">${esc(mu.muname || "Unité cartographique")}</h3>
        ${facts([["Symbole", mu.musym], ["Terres agricoles", FARMLAND_US[mu.farmlndcl] || (/^Prime farmland if/i.test(mu.farmlndcl || "") ? "Première qualité sous conditions (" + mu.farmlndcl.replace(/^Prime farmland if /i, "") + ")" : mu.farmlndcl)]])}
        <div class="pedo-series-heading">Composantes principales</div>
        ${rows.map((r) => seriesCard(r.compname, r.comppct_r, [
          r.drainagecl ? `Drainage : ${esc(DRAIN_US[r.drainagecl] || r.drainagecl)}` : "",
          r.hydgrp ? `Groupe hydrologique ${esc(r.hydgrp)}` : "",
          r.nirrcapcl ? `Capacité (non irrigué) : classe ${esc(r.nirrcapcl)}${r.nirrcapscl ? esc(r.nirrcapscl) : ""}` : ""
        ].filter(Boolean).join(" · ") + (r.taxclname ? `<br><span class="pf-reg-muted">${esc(r.taxclname)}</span>` : ""))).join("")}
        ${source("USDA NRCS – SSURGO (Soil Data Access)")}`;
    }
    if (juris === "ON") {
      const a = await arcgisQuery(ON_MS, 9, lng, lat);
      if (!a) return none("Aucun polygone du levé pédologique à cet endroit.");
      const comps = [1, 2, 3].filter((i) => a["SOIL_NAME" + i]).map((i) => seriesCard(
        String(a["SOIL_NAME" + i]).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()),
        a["PERCENT" + i],
        [
          a["ATEXTURE" + i] ? `Texture : ${esc(TEXT_ON[a["ATEXTURE" + i]] || a["ATEXTURE" + i])}` : "",
          a["DRAINAGE" + i] ? `Drainage : ${esc(DRAIN_ON[a["DRAINAGE" + i]] || a["DRAINAGE" + i])}` : "",
          a["CLI" + i] ? `ICT ${esc(a["CLI" + i])}${esc(a["CLI" + i + "_1"] || "")}` : "",
          a["RANGE" + i] ? `Pente ${esc(a["RANGE" + i])} %` : "",
          a["K_FACTOR" + i] != null ? `K = ${esc(a["K_FACTOR" + i])}` : ""
        ].filter(Boolean).join(" · ")
      )).join("");
      return `
        <h3 class="pedo-popup-title">Complexe de sols ${esc(a.MAPUNIT || "")}</h3>
        ${facts([["Levé", a.SURVEY1], ["Superficie du polygone", a.HECTARES != null ? `${fmt(a.HECTARES)} ha` : null]])}
        <div class="pedo-series-heading">Séries de sols</div>
        ${comps || none("Composantes non détaillées.")}
        ${source("Ontario – LIO, Soil Survey Complex")}`;
    }
    if (juris === "AB") {
      const a = await arcgisIdentify(AB_MS, 0, lng, lat);
      if (!a) return none("Aucun polygone AGRASID à cet endroit.");
      return `
        <h3 class="pedo-popup-title">Unité ${esc(a["Map Unit Name"] || "")}</h3>
        ${facts([
          ["Relief", a.Landform],
          ["LSRS – céréales de printemps", a["LSRS Rating (Spring Grains)"]],
          ["LSRS – canola", a["LSRS Rating (Canola)"]],
          ["LSRS – luzerne", a["LSRS Rating (Alfalfa)"]],
          ["LSRS – brome", a["LSRS Rating (Brome)"]]
        ])}
        ${source("Alberta – AGRASID 4.1 (Land Suitability Rating System)")}`;
    }
    if (juris === "SK") {
      const a = await arcgisIdentify(SK_MS, 0, lng, lat);
      if (!a) return none("Aucun polygone SKSID à cet endroit.");
      return `
        <h3 class="pedo-popup-title">Unité ${esc(a.MAPUNIT_SK || a.MAPUNIT || "")}</h3>
        ${facts([
          ["Polygone", a.POLYNUMB],
          ["Pente", a.SLOPESIMPL && a.SLOPESIMPL.trim() ? a.SLOPESIMPL : a.SLOPE_RG],
          ["Capacité", a.CAPBLTY],
          ["Salinité", a.SALINITY_D],
          ["Non-sol", a.NONSOIL && a.NONSOIL.trim() ? a.NONSOIL : null]
        ])}
        ${source("Saskatchewan – SKSID (Saskatchewan Soil Information Database)")}`;
    }
    if (juris === "BC") {
      const p = await bcInfo(lng, lat);
      if (!p) return none("Aucun levé pédologique numérisé à cet endroit.");
      const title = (n) => String(n || "").toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());
      const comps = [1, 2, 3].filter((i) => p["SOILNAME_" + i]).map((i) => seriesCard(title(p["SOILNAME_" + i]), p["PERCENT_" + i], [
        p["TEXTURE_" + i] && p["TEXTURE_" + i] !== "-" ? `Texture : ${esc(TEXT_ON[p["TEXTURE_" + i]] || p["TEXTURE_" + i])}` : "",
        p["DRAIN_" + i] ? `Drainage : ${esc(DRAIN_BC[p["DRAIN_" + i]] || p["DRAIN_" + i])}` : ""
      ].filter(Boolean).join(" · "))).join("");
      return `
        <h3 class="pedo-popup-title">${esc(p.PROJ_NAME || "Levé pédologique")}</h3>
        ${facts([["Pente moyenne", p.AVG_SLOPE != null ? `${p.AVG_SLOPE} %` : null], ["Jours sans gel", p.FFP], ["Précipitations", p.PPT != null ? `${p.PPT} mm/an` : null], ["Degrés-jours (> 5 °C)", p.DD5]])}
        <div class="pedo-series-heading">Séries de sols</div>
        ${comps || none("Composantes non détaillées.")}
        ${source("Province of British Columbia – Soil Information Finder (SIFT)")}`;
    }
    return none("Aucune donnée de sol pour cette région.");
  }

  // ---------------------------------------------------------------------------
  // 6. Parcelles par juridiction
  // ---------------------------------------------------------------------------
  async function parcelAt(juris, e, map) {
    if (juris === "FR") {
      const f = await geopfInfo("LANDUSE.AGRICULTURE.LATEST", e.lngLat.lng, e.lngLat.lat);
      if (!f) return null;
      const p = f.properties || {};
      return {
        geometry: f.geometry,
        properties: { IDPAR: p.num_parcel ? String(p.num_parcel) : "", SUPHEC: p.surf_parc, DESCODPR1: p.libelle_culture || p.code_cultu, code_cultu: p.code_cultu, code_group: p.code_group, source: "RPG" },
        title: p.num_parcel ? `Parcelle nº ${p.num_parcel}` : "Parcelle RPG",
        crop: p.libelle_culture || p.code_cultu || "",
        area: Number(p.surf_parc),
        facts: [["Culture 2025", p.libelle_culture], ["Code culture", p.code_cultu], ["Groupe de cultures", p.code_group], ["Culture dérobée 1", p.culture_d1], ["Culture dérobée 2", p.culture_d2], ["Superficie", Number.isFinite(Number(p.surf_parc)) ? `${fmt(p.surf_parc, 2)} ha` : null]],
        sourceLabel: "IGN – Registre parcellaire graphique 2025"
      };
    }
    if (juris === "US") {
      const hit = lyrId("us-csb") + "-hit";
      if (!map.getLayer(hit)) return null;
      const feats = map.queryRenderedFeatures(e.point, { layers: [hit] });
      if (!feats.length) return null;
      const f = feats[0];
      const p = f.properties || {};
      const crop = p["crop:name"] || p["hcat:name_en"] || p["crop:code"] || "";
      const areaHa = Number(p["metrics:area"]) / 10000;
      return {
        geometry: f.geometry,
        properties: { IDPAR: p.id ? String(p.id) : "", SUPHEC: Number.isFinite(areaHa) ? areaHa : "", DESCODPR1: crop, source: "CSB" },
        title: "Champ (CSB)",
        crop,
        area: areaHa,
        facts: [["Culture 2024", crop], ["Catégorie (HCAT)", p["hcat:name_en"]], ["Superficie", Number.isFinite(areaHa) ? `${fmt(areaHa, 2)} ha` : null], ["Comté", p.administrative_area_level_2]],
        sourceLabel: "USDA NASS – Crop Sequence Boundaries 2024 (contours estimés, non cadastraux)"
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 7. Fiche au clic
  // ---------------------------------------------------------------------------
  let currentPopup = null;

  function busy(map) {
    if (window.measureManager && window.measureManager.isActive) return true;
    if (window.vectorManager && window.vectorManager.isDrawing) return true;
    if (window.ndviManager && window.ndviManager.isActiveMode) return true;
    if (window.terrain3DManager && window.terrain3DManager.isSelectingParcel) return true;
    if (window.profileManager && window.profileManager.isDrawing) return true;
    const btnProfile = document.getElementById("btn-quick-profile");
    if (btnProfile && btnProfile.classList.contains("active")) return true;
    return false;
  }

  async function onMapClick(map, e) {
    const juris = jurisdictionAt(e.lngLat.lng, e.lngLat.lat);
    if (!juris || busy(map)) return;
    if (e.originalEvent && e.originalEvent._handled) return;
    // Entités des couches personnelles : elles ont leur propre popup
    const personal = map.queryRenderedFeatures(e.point).some((f) => (f.source && String(f.source).startsWith("vector-source-")) || (f.layer && /^vector-draw/.test(f.layer.id)));
    if (personal) return;

    if (currentPopup) { currentPopup.remove(); currentPopup = null; }
    const loading = `<div class="pf-reg-loading"><span class="pf-cf-spinner"></span><span>Interrogation des services…</span></div>`;
    const parcelPromise = parcelAt(juris, e, map);
    const soilsPromise = soilsHtml(juris, e.lngLat.lng, e.lngLat.lat);
    const hasParcels = juris === "FR" || juris === "US";

    const html = `
      <div class="pedo-popup pf-fiche pf-reg-fiche">
        <div class="pf-fiche-head">
          <div class="pf-fiche-kicker">${esc(JURIS[juris].name)}</div>
          <div class="pf-fiche-title pf-reg-title">${hasParcels ? "Recherche de la parcelle…" : "Sols à cet endroit"}</div>
          <div class="pf-fiche-meta pf-reg-meta">${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</div>
        </div>
        <div class="popup-tabs-header">
          <button type="button" class="popup-tab-btn active" data-tab="sols"><span>Sols</span></button>
          ${hasParcels ? `<button type="button" class="popup-tab-btn" data-tab="cultures"><span>Cultures</span></button>` : ""}
          <button type="button" class="popup-tab-btn" data-tab="ndvi"><span>NDVI</span></button>
        </div>
        <div class="pf-fiche-body">
          <div class="popup-tab-pane active" data-tab="sols">${loading}</div>
          ${hasParcels ? `<div class="popup-tab-pane" data-tab="cultures">${loading}</div>` : ""}
          <div class="popup-tab-pane" data-tab="ndvi">
            <p class="pf-reg-text">Série temporelle Sentinel-2 de la saison de croissance pour ce point ou cette parcelle.</p>
            <button type="button" class="btn-popup-ndvi pf-reg-ndvi"><span>Analyser l'évolution NDVI</span></button>
          </div>
        </div>
        <div class="pf-reg-actions-slot"></div>
      </div>`;

    const popup = new maplibregl.Popup({ closeButton: true, offset: 8 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    currentPopup = popup;
    popup.on("close", () => { if (currentPopup === popup) currentPopup = null; });
    const dom = popup.getElement();
    const tabs = dom.querySelectorAll(".popup-tab-btn");
    const panes = dom.querySelectorAll(".popup-tab-pane");
    tabs.forEach((b) => b.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.toggle("active", x === b));
      panes.forEach((p) => p.classList.toggle("active", p.dataset.tab === b.dataset.tab));
    }));

    let parcelProps = null;
    dom.querySelector(".pf-reg-ndvi").addEventListener("click", () => {
      popup.remove();
      if (window.ndviManager) window.ndviManager.analyzeLocation(e.lngLat, parcelProps);
    });

    soilsPromise.then((h) => {
      const pane = dom.querySelector('.popup-tab-pane[data-tab="sols"]');
      if (pane) pane.innerHTML = h;
    });

    if (!hasParcels) return;
    const parcel = await parcelPromise;
    if (currentPopup !== popup) return;
    const title = dom.querySelector(".pf-reg-title");
    const meta = dom.querySelector(".pf-reg-meta");
    const cult = dom.querySelector('.popup-tab-pane[data-tab="cultures"]');
    if (!parcel) {
      title.textContent = "Hors parcelle déclarée";
      if (cult) cult.innerHTML = none(juris === "US" ? "Aucun champ CSB à cet endroit (zoom 9 et plus)." : "Aucune parcelle RPG à cet endroit.");
      return;
    }
    parcelProps = parcel.properties;
    title.textContent = parcel.title;
    meta.textContent = [Number.isFinite(parcel.area) ? `${fmt(parcel.area)} ha` : "", parcel.crop].filter(Boolean).join(" · ");
    if (cult) cult.innerHTML = facts(parcel.facts) + source(parcel.sourceLabel);

    // Surligner la parcelle
    try {
      const gj = { type: "FeatureCollection", features: [{ type: "Feature", geometry: parcel.geometry, properties: {} }] };
      if (map.getSource("reg-parcel-hl")) map.getSource("reg-parcel-hl").setData(gj);
      else {
        map.addSource("reg-parcel-hl", { type: "geojson", data: gj });
        map.addLayer({ id: "reg-parcel-hl", type: "line", source: "reg-parcel-hl", paint: { "line-color": "#2e6a4c", "line-width": 3 } });
      }
      popup.on("close", () => { if (map.getSource("reg-parcel-hl")) map.getSource("reg-parcel-hl").setData({ type: "FeatureCollection", features: [] }); });
    } catch (err) { /* surlignage facultatif */ }

    // La parcelle devient la parcelle active des outils (comparaison, 3D, érosion…)
    const targetP = { type: "Feature", geometry: parcel.geometry, properties: parcel.properties };
    if (window.terrain3DManager) window.terrain3DManager.lastClickedParcel = targetP;
    if (window.cutFillManager) window.cutFillManager.lastClickedParcel = targetP;
    if (window.erosionManager) window.erosionManager.currentParcel = targetP;
    const slot = dom.querySelector(".pf-reg-actions-slot");
    if (slot) {
      slot.innerHTML = `
        <div class="pf-fiche-actions">
          <div class="pf-fiche-actions-title">Parcelle</div>
          <div class="pf-fiche-actions-grid">
            <button type="button" class="btn-popup-parcel-action pf-reg-zoom"><span class="pf-act-name">Cadrer</span><span class="pf-act-desc">Zoom sur la parcelle</span></button>
            <button type="button" class="btn-popup-parcel-action pf-reg-copy"><span class="pf-act-name">Ajouter à Mes données</span><span class="pf-act-desc">Copie dans vos couches</span></button>
          </div>
          <p class="pf-reg-note">Les analyses LiDAR (3D, pluie, déblais/remblais) utilisent le MNT HRDEM et ne couvrent pour l'instant que le Canada.</p>
        </div>`;
      slot.querySelector(".pf-reg-zoom").addEventListener("click", () => {
        let b = null;
        const scan = (c) => { if (typeof c[0] === "number") { b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])] : [c[0], c[1], c[0], c[1]]; } else c.forEach(scan); };
        scan(parcel.geometry.coordinates);
        if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 17, duration: 800 });
      });
      slot.querySelector(".pf-reg-copy").addEventListener("click", async () => {
        const vm = window.vectorManager;
        if (!vm) return;
        const props = { nom: parcel.title, culture: parcel.crop, superficie_ha: Number.isFinite(parcel.area) ? Number(parcel.area.toFixed(2)) : "", source: parcel.properties.source };
        const fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: props, geometry: parcel.geometry }] };
        const file = new File([JSON.stringify(fc)], `${parcel.title}.geojson`, { type: "application/geo+json" });
        await vm.importVectorFile(file);
        if (typeof window.pfShowSection === "function") window.pfShowSection("donnees");
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Démarrage
  // ---------------------------------------------------------------------------
  function start(map) {
    updateJurisdiction(map);
    map.on("moveend", () => updateJurisdiction(map));
    map.on("click", (e) => { onMapClick(map, e); });
    // Les couches régionales sont recréées si le style change (fond de carte)
    map.on("styledata", () => {
      if (!state.juris) return;
      Object.keys(LAYERS).forEach((id) => {
        if (LAYERS[id].juris === state.juris && state.on[id] && !map.getLayer(lyrId(id))) setLayerVisible(map, id, true);
      });
      syncHitLayers(map);
    });
  }

  function waitForMap() {
    const map = window.map;
    if (!map) { setTimeout(waitForMap, 200); return; }
    if (map.loaded && map.loaded()) start(map);
    else map.once("load", () => start(map));
  }
  waitForMap();

  window.PfRegions = { JURIS, LAYERS, jurisdictionAt, state };
})();
