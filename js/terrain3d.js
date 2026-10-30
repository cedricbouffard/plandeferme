/**
 * ==============================================================================
 * TERRAIN 3D MANAGER (PLAN DE FERME)
 * Visualisation 3D native du micro-relief LiDAR 1m côté client dans MapLibre GL
 * DÉCOUPÉ AUX PARCELLES AGRICOLES AVEC PROJECTION EXACTE :
 * - Projection rigoureuse via proj4 (EPSG:3979 / MTM / UTM) éliminant toute distorsion/rotation
 * - Découpage strict au polygone de la parcelle (micro-relief amplifié à l'intérieur, 0m à l'extérieur)
 * - Calage altimétrique précis au plancher de la parcelle
 * - Exportation conforme du MNT LiDAR en GeoTIFF métrique UTM (.tif) pour QGIS, ArcGIS, Trimble, AgOpenGPS
 * - Navigation libre jusqu'à 85° (rase-motte), ciel atmosphérique et orbite 360°
 * ==============================================================================
 */

class Terrain3DManager {
  constructor(mapInstance) {
    this.map = mapInstance;
    this.is3DActive = false;
    this.exaggeration = 30.0; // 30X par défaut
    this.activeTerrain = null;
    this.activeParcel = null;
    this.activeParcelGeom = null;
    this.activeTargetName = 'Parcelle agricole';
    this.lastClickedParcel = null;
    this.isSelectingParcel = false;

    this.tileCache = new Map();
    this.maxCacheSize = 256;
    this.version = 1;
    this.flatTileBuffer = null;
    
    // Canvas réutilisable 256x256 pour l'encodage Terrarium
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    
    this.sourceId = 'client-terrain-source';
    this.hillshadeSourceId = 'client-3d-hillshade-source';
    this.hillshadeLayerId = 'client-3d-hillshade-layer';
    this.highlightSourceId = 'parcel-3d-highlight-source';
    this.highlightLayerId = 'parcel-3d-highlight-line';
    this.protocolRegistered = false;

    // Navigation libre & Orbite 360°
    this.isOrbiting = false;
    this.orbitAnimFrame = null;
    this.isFreeCamActive = false;
    this.freeCamDragging = false;
    this.freeCamStartPos = null;
    this.freeCamStartPitch = 0;
    this.freeCamStartBearing = 0;

    this.init();
  }

  getProj4() {
    return window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4) || (typeof proj4 !== 'undefined' ? proj4 : null);
  }

  async init() {
    // Débloquer l'inclinaison maximale jusqu'à 85°
    if (this.map) {
      if (typeof this.map.setMaxPitch === 'function') {
        this.map.setMaxPitch(85);
      }
      if (this.map.touchPitch && typeof this.map.touchPitch.enable === 'function') {
        this.map.touchPitch.enable();
      }
    }

    // 1. Buffer statique 256x256 plat à 0.0m (Terrarium: R=128, G=0, B=0)
    await this.initFlatTileBuffer();

    // 2. Protocole client-dem MapLibre
    this.registerDemProtocol();

    // 3. UI, gestes et événements
    this.bindEvents();
    this.setupFreeCamHandlers();
    this.bindMapEvents();
  }

  async initFlatTileBuffer() {
    this.ctx.fillStyle = 'rgb(128, 0, 0)';
    this.ctx.fillRect(0, 0, 256, 256);
    this.flatTileBuffer = await this.canvasToBuffer();
  }

  canvasToBuffer() {
    return new Promise((resolve) => {
      this.canvas.toBlob(async (blob) => {
        if (!blob) {
          resolve(new ArrayBuffer(0));
          return;
        }
        const buffer = await blob.arrayBuffer();
        resolve(buffer);
      }, 'image/png');
    });
  }

  registerDemProtocol() {
    if (this.protocolRegistered) return;
    try {
      if (typeof maplibregl !== 'undefined' && maplibregl.addProtocol) {
        maplibregl.addProtocol('client-dem', async (params) => {
          return await this.handleTileRequest(params);
        });
        this.protocolRegistered = true;
      }
    } catch (err) {
      console.warn('Erreur enregistrement protocole client-dem:', err);
    }
  }

  tile2lon(x, z) {
    return (x / Math.pow(2, z)) * 360 - 180;
  }

  tile2lat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  getTileBbox(z, x, y) {
    return [
      this.tile2lon(x, z),
      this.tile2lat(y + 1, z),
      this.tile2lon(x + 1, z),
      this.tile2lat(y, z)
    ];
  }

  // Fonctions de géométrie
  isPointInRing(pt, ring) {
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

  isPointInGeom(pt, geom) {
    if (!geom || !geom.coordinates) return true;
    if (geom.type === 'Polygon') {
      if (!geom.coordinates.length || !this.isPointInRing(pt, geom.coordinates[0])) return false;
      for (let k = 1; k < geom.coordinates.length; k++) {
        if (this.isPointInRing(pt, geom.coordinates[k])) return false;
      }
      return true;
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly.length && this.isPointInRing(pt, poly[0])) {
          let inHole = false;
          for (let k = 1; k < poly.length; k++) {
            if (this.isPointInRing(pt, poly[k])) { inHole = true; break; }
          }
          if (!inHole) return true;
        }
      }
      return false;
    }
    return true;
  }

  computeBboxFromGeometry(geom) {
    if (!geom || !geom.coordinates) return null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    function walk(coords) {
      if (typeof coords[0] === 'number') {
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
  assembleParcelFeature(feature) {
    if (!feature || !feature.geometry) return feature;
    const map = this.map;
    if (!map) return feature;

    const props = feature.properties || {};
    const pid = props.IDPAR || props.idpar || props.IDANPAR || props.idanpar;
    const polyId = props.POLY_ID || props.poly_id;
    const fid = feature.id;

    if (!pid && !polyId && fid === undefined) {
      return feature;
    }

    const candidateSlices = [];

    // 1. Récupération depuis le cache des tuiles de la source (toutes les tuiles chargées)
    if (typeof map.querySourceFeatures === 'function') {
      try {
        if (pid) {
          const srcHits = map.querySourceFeatures('parcelles-source', { sourceLayer: 'BDPPAD_2026' });
          if (srcHits && srcHits.length > 0) {
            for (const f of srcHits) candidateSlices.push(f);
          }
        }
        if (polyId) {
          const pedoHits = map.querySourceFeatures('pedologie', { sourceLayer: 'pedologie_quebec' });
          if (pedoHits && pedoHits.length > 0) {
            for (const f of pedoHits) candidateSlices.push(f);
          }
        }
      } catch (e) {
        console.warn('querySourceFeatures error:', e);
      }
    }

    // 2. Récupération depuis les couches affichées dans la vue
    if (typeof map.queryRenderedFeatures === 'function') {
      try {
        const queryLayers = ['parcelles-fill', 'parcelles-hit-layer', 'pedologie-fill', 'pedologie-hit-layer'].filter(l => map.getLayer(l));
        if (queryLayers.length > 0) {
          const renHits = map.queryRenderedFeatures(undefined, { layers: queryLayers });
          if (renHits && renHits.length > 0) {
            for (const f of renHits) candidateSlices.push(f);
          }
        }
      } catch (e) {
        console.warn('queryRenderedFeatures error:', e);
      }
    }

    candidateSlices.push(feature);

    // 3. Filtrage strict des tranches appartenant à la même entité
    const matching = [];
    for (const f of candidateSlices) {
      if (!f || !f.geometry) continue;
      const fp = f.properties || {};
      const fPid = fp.IDPAR || fp.idpar || fp.IDANPAR || fp.idanpar;
      const fPolyId = fp.POLY_ID || fp.poly_id;

      let isMatch = false;
      if (pid && fPid && (String(fPid) === String(pid) || Number(fPid) === Number(pid))) {
        isMatch = true;
      } else if (polyId && fPolyId && (String(fPolyId) === String(polyId) || Number(fPolyId) === Number(polyId))) {
        isMatch = true;
      } else if (fid !== undefined && f.id === fid) {
        isMatch = true;
      }

      if (isMatch) {
        matching.push(f);
      }
    }

    if (matching.length <= 1) {
      return feature;
    }

    // 4. Déduplication par signature géométrique de l'anneau extérieur
    const getRingSignature = (ring) => {
      if (!ring || ring.length === 0) return '';
      const len = ring.length;
      const p0 = ring[0];
      const pMid = ring[Math.floor(len / 2)];
      const pLast = ring[len - 1];
      return `${len}:${p0[0].toFixed(5)},${p0[1].toFixed(5)}|${pMid[0].toFixed(5)},${pMid[1].toFixed(5)}|${pLast[0].toFixed(5)},${pLast[1].toFixed(5)}`;
    };

    const uniquePolygons = [];
    const seenSignatures = new Set();

    for (const f of matching) {
      const g = f.geometry;
      if (g.type === 'Polygon') {
        const sig = getRingSignature(g.coordinates[0]);
        if (!seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          uniquePolygons.push(g.coordinates);
        }
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
          const sig = getRingSignature(poly[0]);
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            uniquePolygons.push(poly);
          }
        }
      }
    }

    if (uniquePolygons.length <= 1) {
      return feature;
    }

    return {
      type: 'Feature',
      id: feature.id,
      properties: Object.assign({}, feature.properties, {
        _multiTileSlices: uniquePolygons.length
      }),
      geometry: {
        type: 'MultiPolygon',
        coordinates: uniquePolygons
      }
    };
  }


  // ============================================================================
  // ÉCHANTILLONNAGE 3D PAR TUILE (AVEC PROJECTION PROJ4 EXACTE)
  // ============================================================================

  async handleTileRequest(params) {
    const url = params.url || '';
    const match = url.match(/client-dem:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) {
      return { data: this.flatTileBuffer ? this.flatTileBuffer.slice(0) : new ArrayBuffer(0) };
    }

    const z = parseInt(match[1], 10);
    const x = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);

    const cacheKey = `${z}_${x}_${y}_v${this.version}`;
    if (this.tileCache.has(cacheKey)) {
      return { data: this.tileCache.get(cacheKey) };
    }

    if (!this.activeTerrain || !this.activeTerrain.data || !this.activeTerrain.sourceBBox) {
      return { data: this.flatTileBuffer ? this.flatTileBuffer.slice(0) : new ArrayBuffer(0) };
    }

    const [tMinLng, tMinLat, tMaxLng, tMaxLat] = this.getTileBbox(z, x, y);
    const ab = this.activeTerrain.bounds;

    // Vérifier l'intersection avec la bounding box de la zone active
    const intersects = !(tMaxLng < ab[0] || tMinLng > ab[2] || tMaxLat < ab[1] || tMinLat > ab[3]);
    if (!intersects) {
      if (this.tileCache.size < this.maxCacheSize) {
        this.tileCache.set(cacheKey, this.flatTileBuffer);
      }
      return { data: this.flatTileBuffer ? this.flatTileBuffer.slice(0) : new ArrayBuffer(0) };
    }

    const p4 = this.getProj4();
    if (!p4) {
      console.warn('proj4 introuvable dans Terrain3DManager');
      return { data: this.flatTileBuffer ? this.flatTileBuffer.slice(0) : new ArrayBuffer(0) };
    }

    const grid = this.activeTerrain.data;
    const gridW = this.activeTerrain.width;
    const gridH = this.activeTerrain.height;
    const minElev = this.activeTerrain.minElev;
    const sB = this.activeTerrain.sourceBBox;
    const projDef = this.activeTerrain.projection;
    const geom = this.activeParcelGeom;

    const spanX = sB[2] - sB[0];
    const spanY = sB[3] - sB[1];

    // Projection rigoureuse des 4 coins de la tuile en coordonnées du raster LiDAR
    const pNW = p4('EPSG:4326', projDef, [tMinLng, tMaxLat]);
    const pNE = p4('EPSG:4326', projDef, [tMaxLng, tMaxLat]);
    const pSW = p4('EPSG:4326', projDef, [tMinLng, tMinLat]);
    const pSE = p4('EPSG:4326', projDef, [tMaxLng, tMinLat]);

    const imgData = this.ctx.createImageData(256, 256);
    const pixels = imgData.data;

    for (let py = 0; py < 256; py++) {
      const v_tile = py / 255.0;
      const rowOffset = py * 256 * 4;

      // Interpolation linéaire des coordonnées projetées sur les bords gauche et droit
      const leftX = (1 - v_tile) * pNW[0] + v_tile * pSW[0];
      const leftY = (1 - v_tile) * pNW[1] + v_tile * pSW[1];
      const rightX = (1 - v_tile) * pNE[0] + v_tile * pSE[0];
      const rightY = (1 - v_tile) * pNE[1] + v_tile * pSE[1];

      // Coordonnée géographique pour le test de polygone
      const pLat = tMaxLat - v_tile * (tMaxLat - tMinLat);

      for (let px = 0; px < 256; px++) {
        const u_tile = px / 255.0;
        const pLng = tMinLng + u_tile * (tMaxLng - tMinLng);

        let z_rel = 0.0;

        // Vérifier si le point est à l'intérieur du polygone de la parcelle
        if (!geom || this.isPointInGeom([pLng, pLat], geom)) {
          // Coordonnées projetées exactes (mX, mY) dans le système de référence du LiDAR
          const mX = leftX + u_tile * (rightX - leftX);
          const mY = leftY + u_tile * (rightY - leftY);

          const u = (mX - sB[0]) / spanX;
          const v = (sB[3] - mY) / spanY;

          if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
            const col = u * (gridW - 1);
            const row = v * (gridH - 1);

            const c0 = Math.floor(col);
            const c1 = Math.min(gridW - 1, c0 + 1);
            const r0 = Math.floor(row);
            const r1 = Math.min(gridH - 1, r0 + 1);

            const fc = col - c0;
            const fr = row - r0;

            const v00 = grid[r0 * gridW + c0];
            const v10 = grid[r0 * gridW + c1];
            const v01 = grid[r1 * gridW + c0];
            const v11 = grid[r1 * gridW + c1];

            const elev = (v00 * (1 - fc) + v10 * fc) * (1 - fr) + (v01 * (1 - fc) + v11 * fc) * fr;

            if (Number.isFinite(elev) && elev > -900 && elev < 9000) {
              z_rel = Math.max(0.0, elev - minElev);
            }
          }
        }

        // Encodage Terrarium : elevation = (R * 256 + G + B / 256) - 32768
        const terrariumVal = Math.max(0.0, Math.min(65535.99, z_rel + 32768.0));
        const r = Math.floor(terrariumVal / 256.0);
        const g = Math.floor(terrariumVal % 256.0);
        const b = Math.floor((terrariumVal - Math.floor(terrariumVal)) * 256.0);

        const pIdx = rowOffset + px * 4;
        pixels[pIdx] = r;
        pixels[pIdx + 1] = g;
        pixels[pIdx + 2] = b;
        pixels[pIdx + 3] = 255;
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    const tileBuffer = await this.canvasToBuffer();

    if (this.tileCache.size < this.maxCacheSize) {
      this.tileCache.set(cacheKey, tileBuffer);
    }

    return { data: tileBuffer };
  }

  startParcelSelection() {
    this.isSelectingParcel = true;
    const banner = document.getElementById('banner-3d-select');
    if (banner) banner.style.display = 'flex';
    if (this.map) {
      const canvas = this.map.getCanvas();
      if (canvas) canvas.style.cursor = 'crosshair';
    }
  }

  stopParcelSelection() {
    this.isSelectingParcel = false;
    const banner = document.getElementById('banner-3d-select');
    if (banner) banner.style.display = 'none';
    if (this.map) {
      const canvas = this.map.getCanvas();
      if (canvas) canvas.style.cursor = '';
    }
  }

  highlightParcel(geometry) {
    if (!this.map || !geometry) return;
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: geometry,
        properties: {}
      }]
    };

    if (!this.map.getSource(this.highlightSourceId)) {
      this.map.addSource(this.highlightSourceId, {
        type: 'geojson',
        data: geojson
      });
    } else {
      this.map.getSource(this.highlightSourceId).setData(geojson);
    }

    if (!this.map.getLayer(this.highlightLayerId)) {
      this.map.addLayer({
        id: this.highlightLayerId,
        type: 'line',
        source: this.highlightSourceId,
        paint: {
          'line-color': '#4f46e5',
          'line-width': 3.5,
          'line-opacity': 0.95
        }
      });
    } else {
      this.map.setLayoutProperty(this.highlightLayerId, 'visibility', 'visible');
    }
  }

  clearHighlight() {
    if (this.map && this.map.getLayer(this.highlightLayerId)) {
      this.map.setLayoutProperty(this.highlightLayerId, 'visibility', 'none');
    }
  }

  async viewParcel3D(targetParcel) {
    if (!targetParcel || !targetParcel.geometry) {
      this.startParcelSelection();
      return;
    }

    const unifiedParcel = this.assembleParcelFeature(targetParcel);
    this.stopParcelSelection();
    this.activeParcel = unifiedParcel;
    this.activeParcelGeom = unifiedParcel.geometry;

    const geomBbox = this.computeBboxFromGeometry(unifiedParcel.geometry);
    if (geomBbox && this.map) {
      this.map.fitBounds(
        [[geomBbox[0], geomBbox[1]], [geomBbox[2], geomBbox[3]]],
        {
          padding: { top: 70, bottom: 70, left: 70, right: 330 },
          pitch: Math.max(55, this.map.getPitch() || 60),
          bearing: this.map.getBearing() || -20,
          duration: 1000
        }
      );
    }

    this.highlightParcel(unifiedParcel.geometry);
    await this.toggle3D(true, unifiedParcel);
  }

  async prepareTerrainData(targetParcel = null) {
    let parcel = targetParcel || this.activeParcel || this.lastClickedParcel;

    if (!parcel || !parcel.geometry) {
      this.startParcelSelection();
      throw new Error("Veuillez cliquer sur une parcelle pour afficher son relief 3D.");
    }

    parcel = this.assembleParcelFeature(parcel);
    this.activeParcel = parcel;
    this.activeParcelGeom = parcel.geometry;

    const geomBbox = this.computeBboxFromGeometry(parcel.geometry);
    if (!geomBbox) {
      throw new Error("Contour géométrique de parcelle invalide.");
    }

    // Marge de 12% autour du contour
    const padLng = Math.max(0.0006, (geomBbox[2] - geomBbox[0]) * 0.12);
    const padLat = Math.max(0.0006, (geomBbox[3] - geomBbox[1]) * 0.12);
    const bbox = [geomBbox[0] - padLng, geomBbox[1] - padLat, geomBbox[2] + padLng, geomBbox[3] + padLat];

    const props = parcel.properties || {};
    const pid = props.IDPAR || props.idpar || '';
    const lotNum = props.NO_LOT || '';
    const sup = props.SUPHEC || props.suphec || '';

    this.activeTargetName = pid ? `Parcelle nº ${pid}` : (lotNum ? `Lot nº ${lotNum}` : 'Parcelle agricole');

    const targetSize = 512;
    let region = null;
    const isCustomProject = window.topoManager && window.topoManager.selectedProjectId !== "default" && window.topoManager.selectedProjectUrl;
    const projectUrl = isCustomProject ? window.topoManager.selectedProjectUrl : null;

    if (projectUrl && typeof readSingleHrdemProjectRegion === 'function') {
      try {
        region = await readSingleHrdemProjectRegion(projectUrl, bbox, targetSize, null, 'bilinear');
      } catch (e) {
        console.warn('readSingleHrdemProjectRegion fallback to multi:', e);
      }
    }

    if (!region && typeof readMultiHrdemRegion === 'function') {
      region = await readMultiHrdemRegion(bbox, targetSize, null, 'bilinear');
    }

    if (!region || !region.data || region.data.length === 0 || !region.sourceBBox) {
      throw new Error("Données altimétriques LiDAR indisponibles pour cette zone.");
    }

    const p4 = this.getProj4();
    const projDef = region.projection || (typeof EPSG_3979_DEF !== 'undefined' ? EPSG_3979_DEF : '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

    const gridW = region.width;
    const gridH = region.height;
    const sB = region.sourceBBox;
    const spanX = sB[2] - sB[0];
    const spanY = sB[3] - sB[1];

    // Calcul du plancher altimétrique (2e percentile) STRICTEMENT à l'intérieur du polygone de la parcelle
    const parcelVals = [];
    for (let r = 0; r < gridH; r++) {
      const mY = sB[3] - (r / (gridH - 1)) * spanY;
      for (let c = 0; c < gridW; c++) {
        const mX = sB[0] + (c / (gridW - 1)) * spanX;
        const [lng, lat] = p4(projDef, 'EPSG:4326', [mX, mY]);

        if (this.isPointInGeom([lng, lat], parcel.geometry)) {
          const v = region.data[r * gridW + c];
          if (Number.isFinite(v) && v > -900 && v < 9000) {
            parcelVals.push(v);
          }
        }
      }
    }

    if (parcelVals.length === 0) {
      for (let i = 0; i < region.data.length; i++) {
        const v = region.data[i];
        if (Number.isFinite(v) && v > -900 && v < 9000) parcelVals.push(v);
      }
    }

    if (parcelVals.length === 0) {
      throw new Error("Aucune altitude LiDAR valide dans cette parcelle.");
    }

    parcelVals.sort((a, b) => a - b);
    const p2Idx = Math.max(0, Math.floor(parcelVals.length * 0.02));
    const p98Idx = Math.min(parcelVals.length - 1, Math.floor(parcelVals.length * 0.98));
    const minElev = parcelVals[p2Idx];
    const maxElev = parcelVals[p98Idx];
    const elevSpan = Math.max(0.2, maxElev - minElev);

    this.activeTerrain = {
      data: region.data,
      width: gridW,
      height: gridH,
      sourceBBox: region.sourceBBox,
      projection: projDef,
      bounds: region.bboxWgs84 || bbox,
      minElev,
      maxElev,
      span: elevSpan,
      parcelInfo: {
        name: this.activeTargetName,
        supStr: sup ? `${parseFloat(sup).toFixed(1)} ha` : null,
        spanStr: `${elevSpan.toFixed(1)} m (${minElev.toFixed(1)}m – ${maxElev.toFixed(1)}m)`
      }
    };

    this.version++;
    this.tileCache.clear();
  }

  enableSky() {
    if (!this.map) return;
    try {
      if (typeof this.map.setSky === 'function') {
        this.map.setSky({
          'sky-color': '#7dd3fc',
          'sky-horizon-blend': 0.85,
          'horizon-color': '#f8fafc',
          'horizon-fog-blend': 0.6,
          'fog-color': '#e2e8f0',
          'fog-ground-blend': 0.5
        });
      }
    } catch (e) {
      console.warn('MapLibre setSky exception:', e);
    }
  }

  disableSky() {
    if (!this.map) return;
    try {
      if (typeof this.map.setSky === 'function') {
        this.map.setSky(null);
      }
    } catch (e) {}
  }

  async toggle3D(forceState = null, targetParcel = null) {
    if (!this.map) return;
    const newState = forceState !== null ? Boolean(forceState) : !this.is3DActive;

    const btn = document.getElementById('btn-quick-3d');
    const btnText = document.getElementById('btn-3d-text');
    const toggleTopo3D = document.getElementById('toggle-topo-3d');

    if (newState) {
      const parcelToUse = targetParcel || this.activeParcel || this.lastClickedParcel;
      if (!parcelToUse) {
        this.startParcelSelection();
        return;
      }

      if (btnText) btnText.textContent = 'Calcul 3D...';

      try {
        await this.prepareTerrainData(parcelToUse);

        if (typeof this.map.setMaxPitch === 'function') {
          this.map.setMaxPitch(85);
        }

        const tileUrl = `client-dem://{z}/{x}/{y}?v=${this.version}`;

        if (!this.map.getSource(this.sourceId)) {
          this.map.addSource(this.sourceId, {
            type: 'raster-dem',
            tiles: [tileUrl],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 17
          });
        }

        if (!this.map.getSource(this.hillshadeSourceId)) {
          this.map.addSource(this.hillshadeSourceId, {
            type: 'raster-dem',
            tiles: [tileUrl],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 17
          });
        }

        if (!this.map.getLayer(this.hillshadeLayerId)) {
          const beforeLayer = this.map.getLayer('pedologie-fill') ? 'pedologie-fill' : undefined;
          this.map.addLayer({
            id: this.hillshadeLayerId,
            type: 'hillshade',
            source: this.hillshadeSourceId,
            layout: { visibility: 'visible' },
            paint: {
              'hillshade-shadow-color': '#0f172a',
              'hillshade-illumination-direction': 315,
              'hillshade-exaggeration': 0.65
            }
          }, beforeLayer);
        } else {
          this.map.setLayoutProperty(this.hillshadeLayerId, 'visibility', 'visible');
        }

        // Relief 3D actif (30X par défaut)
        this.map.setTerrain({
          source: this.sourceId,
          exaggeration: this.exaggeration
        });

        this.enableSky();

        const currentPitch = this.map.getPitch();
        if (currentPitch < 20) {
          this.map.easeTo({
            pitch: 60,
            bearing: -20,
            duration: 900
          });
        }

        this.is3DActive = true;
      } catch (err) {
        console.error('Erreur activation relief 3D:', err);
        alert(err.message || "Erreur lors de l'activation du relief 3D.");
        this.is3DActive = false;
      }
    } else {
      this.is3DActive = false;
      this.stopOrbit();
      this.disableFreeCam();
      this.disableSky();
      this.clearHighlight();

      this.map.setTerrain(null);

      if (this.map.getLayer(this.hillshadeLayerId)) {
        this.map.setLayoutProperty(this.hillshadeLayerId, 'visibility', 'none');
      }

      this.map.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 700
      });
    }

    this.syncUI();
  }

  setExaggeration(val) {
    const num = Math.max(1.0, Math.min(100.0, parseFloat(val) || 30.0));
    this.exaggeration = num;

    if (this.is3DActive && this.map) {
      this.map.setTerrain({
        source: this.sourceId,
        exaggeration: this.exaggeration
      });
    }

    this.syncUI();
  }

  setPitch(val, smooth = true) {
    if (!this.map) return;
    const p = Math.max(0, Math.min(85, parseFloat(val) || 0));
    if (smooth) {
      this.map.easeTo({ pitch: p, duration: 450 });
    } else {
      this.map.setPitch(p);
    }
    this.syncPitchUI(p);
  }

  setBearing(val, smooth = true) {
    if (!this.map) return;
    const b = (parseFloat(val) || 0) % 360;
    if (smooth) {
      this.map.easeTo({ bearing: b, duration: 450 });
    } else {
      this.map.setBearing(b);
    }
  }

  resetNorth() {
    if (!this.map) return;
    this.map.easeTo({ bearing: 0, duration: 400 });
  }

  startOrbit() {
    if (!this.is3DActive || !this.map) return;
    this.isOrbiting = true;
    const btn = document.getElementById('btnToggleOrbit');
    const icon = document.getElementById('iconOrbit');
    if (btn) btn.classList.add('active');
    if (icon) icon.classList.add('orbit-spinning');

    if (this.map.getPitch() < 30) {
      this.map.easeTo({ pitch: 60, duration: 600 });
    }

    const step = () => {
      if (!this.isOrbiting || !this.map) return;
      const b = this.map.getBearing();
      this.map.setBearing((b + 0.35) % 360);
      this.orbitAnimFrame = requestAnimationFrame(step);
    };
    this.orbitAnimFrame = requestAnimationFrame(step);
  }

  stopOrbit() {
    this.isOrbiting = false;
    if (this.orbitAnimFrame) {
      cancelAnimationFrame(this.orbitAnimFrame);
      this.orbitAnimFrame = null;
    }
    const btn = document.getElementById('btnToggleOrbit');
    const icon = document.getElementById('iconOrbit');
    if (btn) btn.classList.remove('active');
    if (icon) icon.classList.remove('orbit-spinning');
  }

  toggleOrbit() {
    if (this.isOrbiting) {
      this.stopOrbit();
    } else {
      this.startOrbit();
    }
  }

  enableFreeCam() {
    this.isFreeCamActive = true;
    const btn = document.getElementById('btnToggleFreeCam');
    if (btn) btn.classList.add('active');
    const canvas = this.map ? this.map.getCanvas() : null;
    if (canvas) canvas.style.cursor = 'grab';
  }

  disableFreeCam() {
    this.isFreeCamActive = false;
    const btn = document.getElementById('btnToggleFreeCam');
    if (btn) btn.classList.remove('active');
    const canvas = this.map ? this.map.getCanvas() : null;
    if (canvas) canvas.style.cursor = '';
  }

  toggleFreeCam(force = null) {
    const enable = force !== null ? Boolean(force) : !this.isFreeCamActive;
    if (enable) {
      this.enableFreeCam();
    } else {
      this.disableFreeCam();
    }
  }

  setupFreeCamHandlers() {
    if (!this.map) return;
    const container = this.map.getCanvasContainer();
    if (!container) return;

    container.addEventListener('mousedown', (e) => {
      if (!this.is3DActive) return;
      if (this.isOrbiting) {
        this.stopOrbit();
      }
      if (!this.isFreeCamActive || e.button !== 0 || e.shiftKey || e.altKey) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      this.freeCamDragging = true;
      this.freeCamStartPos = { x: e.clientX, y: e.clientY };
      this.freeCamStartPitch = this.map.getPitch();
      this.freeCamStartBearing = this.map.getBearing();

      if (this.map.dragPan) this.map.dragPan.disable();
      const canvas = this.map.getCanvas();
      if (canvas) canvas.style.cursor = 'grabbing';

      const onMouseMove = (ev) => {
        if (!this.freeCamDragging) return;
        const dx = ev.clientX - this.freeCamStartPos.x;
        const dy = ev.clientY - this.freeCamStartPos.y;

        const newPitch = Math.max(0, Math.min(85, this.freeCamStartPitch - dy * 0.4));
        const newBearing = (this.freeCamStartBearing + dx * 0.4) % 360;

        this.map.jumpTo({
          pitch: newPitch,
          bearing: newBearing
        });
        this.syncPitchUI(newPitch);
      };

      const onMouseUp = () => {
        this.freeCamDragging = false;
        if (this.map.dragPan) this.map.dragPan.enable();
        const c = this.map.getCanvas();
        if (c) c.style.cursor = this.isFreeCamActive ? 'grab' : '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }, { capture: true });
  }

  bindMapEvents() {
    if (!this.map) return;

    this.map.on('pitch', () => this.syncPitchUI());
    this.map.on('rotate', () => this.syncPitchUI());

    const stopOrbitOnInteraction = () => {
      if (this.isOrbiting) this.stopOrbit();
    };

    this.map.on('wheel', stopOrbitOnInteraction);
    this.map.on('touchstart', stopOrbitOnInteraction);
  }

  syncPitchUI(pitchVal = null) {
    if (!this.map) return;
    const pitch = pitchVal !== null ? pitchVal : Math.round(this.map.getPitch());
    const slider = document.getElementById('slider3DPitch');
    const badge = document.getElementById('badge3DPitch');

    if (slider && document.activeElement !== slider) {
      slider.value = Math.round(pitch);
    }
    if (badge) {
      badge.textContent = `${Math.round(pitch)}°`;
    }

    document.querySelectorAll('.btn-pitch-preset').forEach((b) => {
      const p = parseFloat(b.getAttribute('data-pitch'));
      b.classList.toggle('active', Math.abs(p - pitch) <= 4);
    });
  }

  async refreshCurrentView() {
    if (!this.is3DActive) return;
    const btn = document.getElementById('btnRefresh3D');
    if (btn) btn.disabled = true;

    try {
      await this.prepareTerrainData(this.activeParcel);
      
      this.map.setTerrain(null);
      this.map.setTerrain({
        source: this.sourceId,
        exaggeration: this.exaggeration
      });
    } catch (e) {
      console.warn('refreshCurrentView error:', e);
    } finally {
      if (btn) btn.disabled = false;
      this.syncUI();
    }
  }

  // ============================================================================
  // EXPORT GEOTIFF (.TIF) MÉTRIQUE EN COORDONNÉES UTM STANDARD
  // ============================================================================

  buildUtmGeoTiffBuffer(dataFloat32, width, height, utmMinX, utmMaxY, resMeters, utmEpsg, noDataValue = -9999.0) {
    const noDataStr = `${noDataValue}\0`;
    const noDataLength = noDataStr.length;

    // GeoKeyDirectory: Système projeté UTM (EPSG:32618 ou EPSG:32619)
    const geoKeys = [
      1, 1, 0, 3,
      1024, 0, 1, 1,        // GTModelTypeGeoKey: 1 = ModelTypeProjected
      1025, 0, 1, 1,        // GTRasterTypeGeoKey: 1 = RasterPixelIsArea
      3072, 0, 1, utmEpsg   // ProjectedCSTypeGeoKey: 32618 (UTM 18N) ou 32619 (UTM 19N)
    ];
    const geoKeyBytesLength = geoKeys.length * 2; // 32 bytes

    const modelPixelScale = [resMeters, resMeters, 0.0]; // 24 bytes
    const modelTiepoint = [0.0, 0.0, 0.0, utmMinX, utmMaxY, 0.0]; // 48 bytes

    const numEntries = 15;
    const ifdSize = 2 + numEntries * 12 + 4; // 186 bytes
    const ifdOffset = 8;
    let currentOffset = ifdOffset + ifdSize;

    const modelPixelScaleOffset = currentOffset; currentOffset += 24;
    const modelTiepointOffset = currentOffset; currentOffset += 48;
    const geoKeyDirectoryOffset = currentOffset; currentOffset += geoKeyBytesLength;
    const noDataOffset = currentOffset; currentOffset += noDataLength;

    if (currentOffset % 4 !== 0) {
      currentOffset += (4 - (currentOffset % 4));
    }

    const stripOffset = currentOffset;
    const stripByteCounts = width * height * 4;
    const totalFileSize = stripOffset + stripByteCounts;

    const buffer = new ArrayBuffer(totalFileSize);
    const view = new DataView(buffer);

    // Header TIFF: Little Endian II, 42, offset IFD 8
    view.setUint16(0, 0x4949, true);
    view.setUint16(2, 42, true);
    view.setUint32(4, ifdOffset, true);

    let ifdPos = ifdOffset;
    view.setUint16(ifdPos, numEntries, true);
    ifdPos += 2;

    const writeTag = (tag, type, count, valOrOffset) => {
      view.setUint16(ifdPos, tag, true);
      view.setUint16(ifdPos + 2, type, true);
      view.setUint32(ifdPos + 4, count, true);
      view.setUint32(ifdPos + 8, valOrOffset, true);
      ifdPos += 12;
    };

    writeTag(256, 4, 1, width); // ImageWidth (LONG)
    writeTag(257, 4, 1, height); // ImageLength (LONG)
    writeTag(258, 3, 1, 32); // BitsPerSample (SHORT)
    writeTag(259, 3, 1, 1); // Compression: None (SHORT)
    writeTag(262, 3, 1, 1); // PhotometricInterpretation: BlackIsZero (SHORT)
    writeTag(273, 4, 1, stripOffset); // StripOffsets (LONG)
    writeTag(277, 3, 1, 1); // SamplesPerPixel (SHORT)
    writeTag(278, 4, 1, height); // RowsPerStrip (LONG)
    writeTag(279, 4, 1, stripByteCounts); // StripByteCounts (LONG)
    writeTag(284, 3, 1, 1); // PlanarConfiguration: Chunky (SHORT)
    writeTag(339, 3, 1, 3); // SampleFormat: IEEE Float (SHORT)
    writeTag(33550, 12, 3, modelPixelScaleOffset); // ModelPixelScale (DOUBLE)
    writeTag(33922, 12, 6, modelTiepointOffset); // ModelTiepoint (DOUBLE)
    writeTag(34735, 3, geoKeys.length, geoKeyDirectoryOffset); // GeoKeyDirectory (SHORT)
    writeTag(42113, 2, noDataLength, noDataOffset); // GDAL_NODATA (ASCII)

    view.setUint32(ifdPos, 0, true);

    for (let i = 0; i < 3; i++) {
      view.setFloat64(modelPixelScaleOffset + i * 8, modelPixelScale[i], true);
    }
    for (let i = 0; i < 6; i++) {
      view.setFloat64(modelTiepointOffset + i * 8, modelTiepoint[i], true);
    }
    for (let i = 0; i < geoKeys.length; i++) {
      view.setUint16(geoKeyDirectoryOffset + i * 2, geoKeys[i], true);
    }

    const uint8View = new Uint8Array(buffer);
    for (let i = 0; i < noDataLength; i++) {
      uint8View[noDataOffset + i] = noDataStr.charCodeAt(i);
    }

    for (let i = 0; i < dataFloat32.length; i++) {
      view.setFloat32(stripOffset + i * 4, dataFloat32[i], true);
    }

    return buffer;
  }

  async exportParcelGeoTiff(targetParcel = null) {
    const rawParcel = targetParcel || this.activeParcel || this.lastClickedParcel;
    if (!rawParcel || !rawParcel.geometry) {
      alert("Veuillez d'abord cliquer sur une parcelle sur la carte pour exporter son MNT.");
      return;
    }

    const parcel = this.assembleParcelFeature(rawParcel);
    this.activeParcel = parcel;
    this.activeParcelGeom = parcel.geometry;

    const p4 = this.getProj4();
    if (!p4) {
      alert("Bibliothèque de projection proj4 indisponible.");
      return;
    }

    const props = parcel.properties || {};
    const parcelId = props.IDPAR || props.idpar || props.NO_LOT || 'agricole';
    const cleanId = String(parcelId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `parcelle_${cleanId}_mnt_lidar_1m.tif`;

    const btnExport = document.getElementById('btnExport3DTif');
    const origHtml = btnExport ? btnExport.innerHTML : '';
    if (btnExport) {
      btnExport.disabled = true;
      btnExport.innerHTML = `<span>Génération TIF...</span>`;
    }

    try {
      const geom = parcel.geometry;
      const geomBbox = this.computeBboxFromGeometry(geom);
      if (!geomBbox) throw new Error("Contour de parcelle invalide.");

      const midLng = (geomBbox[0] + geomBbox[2]) / 2;
      const utmZone = midLng < -72.0 ? 18 : 19;
      const utmEpsg = midLng < -72.0 ? 32618 : 32619;
      const utmDef = `+proj=utm +zone=${utmZone} +datum=WGS84 +units=m +no_defs`;

      // Déterminer les bornes précises du polygone en mètres UTM
      let utmMinX = Infinity, utmMaxX = -Infinity;
      let utmMinY = Infinity, utmMaxY = -Infinity;

      const walkCoords = (coords) => {
        if (typeof coords[0] === 'number') {
          const pt = p4('EPSG:4326', utmDef, coords);
          if (pt[0] < utmMinX) utmMinX = pt[0];
          if (pt[0] > utmMaxX) utmMaxX = pt[0];
          if (pt[1] < utmMinY) utmMinY = pt[1];
          if (pt[1] > utmMaxY) utmMaxY = pt[1];
          return;
        }
        for (const item of coords) walkCoords(item);
      };
      walkCoords(geom.coordinates);

      // Résolution 1m LiDAR native
      const res = 1.0;
      const gridW = Math.max(16, Math.round((utmMaxX - utmMinX) / res));
      const gridH = Math.max(16, Math.round((utmMaxY - utmMinY) / res));
      const targetSize = Math.max(256, Math.min(4096, Math.max(gridW, gridH)));

      let region = null;
      const isCustomProject = window.topoManager && window.topoManager.selectedProjectId !== "default" && window.topoManager.selectedProjectUrl;
      const projectUrl = isCustomProject ? window.topoManager.selectedProjectUrl : null;
      if (projectUrl && typeof readSingleHrdemProjectRegion === 'function') {
        try {
          region = await readSingleHrdemProjectRegion(projectUrl, geomBbox, targetSize, null, 'bilinear');
        } catch (e) {
          console.warn('readSingle fallback:', e);
        }
      }
      if (!region && typeof readMultiHrdemRegion === 'function') {
        region = await readMultiHrdemRegion(geomBbox, targetSize, null, 'bilinear');
      }

      if (!region || !region.data || !region.sourceBBox) {
        throw new Error("Impossible de récupérer les données LiDAR pour cette parcelle.");
      }

      const srcGrid = region.data;
      const srcW = region.width;
      const srcH = region.height;
      const sB = region.sourceBBox;
      const projDef = region.projection || (typeof EPSG_3979_DEF !== 'undefined' ? EPSG_3979_DEF : '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

      const spanX = sB[2] - sB[0];
      const spanY = sB[3] - sB[1];

      const outData = new Float32Array(gridW * gridH);

      for (let r = 0; r < gridH; r++) {
        const y_utm = utmMaxY - (r + 0.5) * res;
        for (let c = 0; c < gridW; c++) {
          const x_utm = utmMinX + (c + 0.5) * res;
          const outIdx = r * gridW + c;

          const [lng, lat] = p4(utmDef, 'EPSG:4326', [x_utm, y_utm]);

          // Découpage strict au polygone de la parcelle
          if (!this.isPointInGeom([lng, lat], geom)) {
            outData[outIdx] = -9999.0;
            continue;
          }

          // Projection du point dans le système source du LiDAR
          const [mX, mY] = p4('EPSG:4326', projDef, [lng, lat]);
          const u = (mX - sB[0]) / spanX;
          const v = (sB[3] - mY) / spanY;

          if (u < 0 || u > 1 || v < 0 || v > 1) {
            outData[outIdx] = -9999.0;
            continue;
          }

          const col = Math.max(0, Math.min(srcW - 1, u * (srcW - 1)));
          const row = Math.max(0, Math.min(srcH - 1, v * (srcH - 1)));
          const c0 = Math.floor(col);
          const c1 = Math.min(srcW - 1, c0 + 1);
          const r0 = Math.floor(row);
          const r1 = Math.min(srcH - 1, r0 + 1);
          const fc = col - c0;
          const fr = row - r0;

          const v00 = srcGrid[r0 * srcW + c0];
          const v10 = srcGrid[r0 * srcW + c1];
          const v01 = srcGrid[r1 * srcW + c0];
          const v11 = srcGrid[r1 * srcW + c1];

          const elev = (v00 * (1 - fc) + v10 * fc) * (1 - fr) + (v01 * (1 - fc) + v11 * fc) * fr;
          if (Number.isFinite(elev) && elev > -900 && elev < 9000) {
            outData[outIdx] = elev;
          } else {
            outData[outIdx] = -9999.0;
          }
        }
      }

      const tiffBuffer = this.buildUtmGeoTiffBuffer(outData, gridW, gridH, utmMinX, utmMaxY, res, utmEpsg, -9999.0);
      const blob = new Blob([tiffBuffer], { type: 'image/tiff' });
      const downloadUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

    } catch (err) {
      console.error('Erreur export GeoTIFF:', err);
      alert(err.message || "Erreur lors de l'exportation du MNT en GeoTIFF.");
    } finally {
      if (btnExport) {
        btnExport.disabled = false;
        btnExport.innerHTML = origHtml || `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>Exporter TIF</span>
        `;
      }
    }
  }

  syncUI() {
    const btn = document.getElementById('btn-quick-3d');
    const btnText = document.getElementById('btn-3d-text');
    const panel = document.getElementById('map-3d-controls');
    const badge = document.getElementById('badge3DExaggeration');
    const badgeInline = document.getElementById('badgeExagInline');
    const slider = document.getElementById('slider3DExaggeration');
    const toggleTopo3D = document.getElementById('toggle-topo-3d');
    const topo3DBadge = document.getElementById('topo-3d-badge-status');
    const scopeLabel = document.getElementById('label-3d-scope');

    const cardParcel = document.getElementById('card3DParcelInfo');
    const labelParcelName = document.getElementById('label3DParcelName');
    const metaParcelArea = document.getElementById('meta3DParcelArea');
    const metaParcelSpan = document.getElementById('meta3DParcelSpan');

    const exagStr = `${this.exaggeration.toFixed(0)}x`;

    if (btn) {
      btn.classList.toggle('active', this.is3DActive);
    }
    if (btnText) {
      btnText.textContent = this.is3DActive ? `Relief 3D (${exagStr})` : 'Relief 3D';
    }
    if (toggleTopo3D) {
      toggleTopo3D.checked = this.is3DActive;
    }
    if (topo3DBadge) {
      topo3DBadge.textContent = exagStr;
    }
    if (badge) {
      badge.textContent = exagStr;
    }
    if (badgeInline) {
      badgeInline.textContent = exagStr;
    }
    if (slider) {
      slider.value = this.exaggeration;
    }
    if (panel) {
      panel.style.display = this.is3DActive ? 'block' : 'none';
    }

    if (this.is3DActive && this.activeTerrain && this.activeTerrain.parcelInfo) {
      const info = this.activeTerrain.parcelInfo;
      if (cardParcel) cardParcel.style.display = 'flex';
      if (labelParcelName) labelParcelName.textContent = info.name || 'Parcelle sélectionnée';
      if (metaParcelArea) metaParcelArea.textContent = info.supStr || 'Superficie parcelle';
      if (metaParcelSpan) metaParcelSpan.textContent = `Dénivelé : ${info.spanStr}`;
      if (scopeLabel) scopeLabel.textContent = 'Micro-relief découpé et amplifié 30X';
    } else {
      if (cardParcel) cardParcel.style.display = 'none';
      if (scopeLabel) scopeLabel.textContent = 'Amplifie le micro-relief des pentes agricoles';
    }

    document.querySelectorAll('.btn-preset-3d').forEach((b) => {
      const bVal = parseFloat(b.getAttribute('data-exag'));
      b.classList.toggle('active', Math.abs(bVal - this.exaggeration) < 0.5);
    });

    this.syncPitchUI();
  }

  bindEvents() {
    const btnQuick3D = document.getElementById('btn-quick-3d');
    if (btnQuick3D) {
      btnQuick3D.addEventListener('click', () => {
        if (this.is3DActive) {
          this.toggle3D(false);
        } else {
          const p = this.activeParcel || this.lastClickedParcel;
          if (p) {
            this.viewParcel3D(p);
          } else {
            this.startParcelSelection();
          }
        }
      });
    }

    const toggleTopo3D = document.getElementById('toggle-topo-3d');
    if (toggleTopo3D) {
      toggleTopo3D.addEventListener('change', (e) => {
        if (e.target.checked) {
          const p = this.activeParcel || this.lastClickedParcel;
          if (p) {
            this.viewParcel3D(p);
          } else {
            this.startParcelSelection();
          }
        } else {
          this.toggle3D(false);
        }
      });
    }

    const btnClose = document.getElementById('btnClose3DPanel');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.toggle3D(false));
    }

    const btnCancelSelect = document.getElementById('btnCancel3DSelect');
    if (btnCancelSelect) {
      btnCancelSelect.addEventListener('click', () => this.stopParcelSelection());
    }

    const btnSwitch = document.getElementById('btnSwitchParcel');
    if (btnSwitch) {
      btnSwitch.addEventListener('click', () => this.startParcelSelection());
    }

    // Exagération verticale slider & presets
    const sliderExag = document.getElementById('slider3DExaggeration');
    if (sliderExag) {
      sliderExag.addEventListener('input', (e) => this.setExaggeration(e.target.value));
    }

    document.querySelectorAll('.btn-preset-3d').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-exag');
        if (val) this.setExaggeration(val);
      });
    });

    // Angle de perspective slider & presets
    const sliderPitch = document.getElementById('slider3DPitch');
    if (sliderPitch) {
      sliderPitch.addEventListener('input', (e) => this.setPitch(e.target.value, false));
    }

    document.querySelectorAll('.btn-pitch-preset').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-pitch');
        if (val !== null) this.setPitch(val, true);
      });
    });

    // Navigation libre & Orbite
    const btnFreeCam = document.getElementById('btnToggleFreeCam');
    if (btnFreeCam) {
      btnFreeCam.addEventListener('click', () => this.toggleFreeCam());
    }

    const btnOrbit = document.getElementById('btnToggleOrbit');
    if (btnOrbit) {
      btnOrbit.addEventListener('click', () => this.toggleOrbit());
    }

    const btnNorth = document.getElementById('btnResetBearing');
    if (btnNorth) {
      btnNorth.addEventListener('click', () => this.resetNorth());
    }

    const btnRefresh = document.getElementById('btnRefresh3D');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this.refreshCurrentView());
    }

    // Export GeoTIFF (.tif)
    const btnExportTif = document.getElementById('btnExport3DTif');
    if (btnExportTif) {
      btnExportTif.addEventListener('click', () => this.exportParcelGeoTiff());
    }
  }
}

window.Terrain3DManager = Terrain3DManager;
