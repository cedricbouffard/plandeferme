/**
 * ==============================================================================
 * TERRAIN 3D MANAGER (PLAN DE FERME)
 * Visualisation 3D native du micro-relief LiDAR 1m côté client dans MapLibre GL
 * avec calage altimétrique à 0m et exagération verticale réglable (30X par défaut).
 * ==============================================================================
 */

class Terrain3DManager {
  constructor(mapInstance) {
    this.map = mapInstance;
    this.is3DActive = false;
    this.exaggeration = 30.0; // 30X par défaut comme demandé
    this.activeTerrain = null;
    this.activeTargetName = 'Vue courante';
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
    this.protocolRegistered = false;
    this.lastClickedParcel = null;

    this.init();
  }

  async init() {
    // 1. Générer le buffer statique 256x256 plat à 0.0m (Terrarium: R=128, G=0, B=0)
    await this.initFlatTileBuffer();

    // 2. Enregistrer le protocole client-dem auprès de MapLibre
    this.registerDemProtocol();

    // 3. Lier les événements UI
    this.bindEvents();
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

    if (!this.activeTerrain || !this.activeTerrain.data) {
      return { data: this.flatTileBuffer ? this.flatTileBuffer.slice(0) : new ArrayBuffer(0) };
    }

    const [tMinLng, tMinLat, tMaxLng, tMaxLat] = this.getTileBbox(z, x, y);
    const ab = this.activeTerrain.bounds;

    // Vérifier si la tuile intersecte le relief actif
    const intersects = !(tMaxLng < ab[0] || tMinLng > ab[2] || tMaxLat < ab[1] || tMinLat > ab[3]);
    if (!intersects) {
      if (this.tileCache.size < this.maxCacheSize) {
        this.tileCache.set(cacheKey, this.flatTileBuffer);
      }
      return { data: this.flatTileBuffer ? this.flatTileBuffer.slice(0) : new ArrayBuffer(0) };
    }

    // Échantillonner la tuile 256x256 depuis la grille LiDAR
    const grid = this.activeTerrain.data;
    const gridW = this.activeTerrain.width;
    const gridH = this.activeTerrain.height;
    const minElev = this.activeTerrain.minElev;
    const abW = ab[2] - ab[0];
    const abH = ab[3] - ab[1];

    const imgData = this.ctx.createImageData(256, 256);
    const pixels = imgData.data;

    for (let py = 0; py < 256; py++) {
      const pLat = tMaxLat - (py / 255.0) * (tMaxLat - tMinLat);
      const rowOffset = py * 256 * 4;

      for (let px = 0; px < 256; px++) {
        const pLng = tMinLng + (px / 255.0) * (tMaxLng - tMinLng);

        let z_rel = 0.0;

        if (pLng >= ab[0] && pLng <= ab[2] && pLat >= ab[1] && pLat <= ab[3]) {
          const u = (pLng - ab[0]) / abW;
          const v = (ab[3] - pLat) / abH;

          const col = Math.max(0, Math.min(gridW - 1, u * (gridW - 1)));
          const row = Math.max(0, Math.min(gridH - 1, v * (gridH - 1)));

          const c0 = Math.floor(col);
          const c1 = Math.min(gridW - 1, c0 + 1);
          const r0 = Math.floor(row);
          const r1 = Math.min(gridH - 1, r0 + 1);

          const fc = col - c0;
          const fr = row - r0;

          const val00 = grid[r0 * gridW + c0];
          const val10 = grid[r0 * gridW + c1];
          const val01 = grid[r1 * gridW + c0];
          const val11 = grid[r1 * gridW + c1];

          // Interpolation bilinéaire
          const elev = (val00 * (1 - fc) + val10 * fc) * (1 - fr) + (val01 * (1 - fc) + val11 * fc) * fr;

          if (Number.isFinite(elev) && elev > -900 && elev < 9000) {
            z_rel = Math.max(0.0, elev - minElev);

            // Adoucissement des bordures (decay linéaire sur les 4% périphériques)
            const edgeFrac = Math.min(u, 1.0 - u, v, 1.0 - v);
            if (edgeFrac < 0.04) {
              const decay = Math.max(0.0, edgeFrac / 0.04);
              z_rel *= decay;
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

  async prepareTerrainData(targetParcel = null) {
    let bbox = null;
    let targetName = 'Champ de vision';

    if (targetParcel) {
      const geomBbox = targetParcel.geometry ? this.computeBboxFromGeometry(targetParcel.geometry) : (targetParcel.bbox || null);
      if (geomBbox) {
        // Ajouter 15% de marge autour de la parcelle
        const padLng = Math.max(0.0008, (geomBbox[2] - geomBbox[0]) * 0.15);
        const padLat = Math.max(0.0008, (geomBbox[3] - geomBbox[1]) * 0.15);
        bbox = [geomBbox[0] - padLng, geomBbox[1] - padLat, geomBbox[2] + padLng, geomBbox[3] + padLat];
        const props = targetParcel.properties || {};
        targetName = props.NO_LOT ? `Lot ${props.NO_LOT}` : (props.id ? `Parcelle ${props.id}` : 'Parcelle ciblée');
      }
    }

    if (!bbox) {
      const bounds = this.map.getBounds();
      bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      targetName = 'Vue courante';
    }

    this.activeTargetName = targetName;

    // Lire les données altimétriques LiDAR 1m (priorité au projet actif si sélectionné)
    let region = null;
    const projectUrl = window.topoManager && window.topoManager.selectedProjectUrl;

    if (projectUrl && typeof readSingleHrdemProjectRegion === 'function') {
      try {
        region = await readSingleHrdemProjectRegion(projectUrl, bbox, 256, null, 'bilinear');
      } catch (e) {
        console.warn('readSingleHrdemProjectRegion fallback to multi:', e);
      }
    }

    if (!region && typeof readMultiHrdemRegion === 'function') {
      region = await readMultiHrdemRegion(bbox, 256, null, 'bilinear');
    }

    if (!region || !region.data || region.data.length === 0) {
      throw new Error("Impossible de lire les données altimétriques LiDAR dans cette zone.");
    }

    // Calculer le plancher au 2e percentile pour éliminer les artéfacts
    const vals = [];
    for (let i = 0; i < region.data.length; i++) {
      const v = region.data[i];
      if (Number.isFinite(v) && v > -900 && v < 9000) {
        vals.push(v);
      }
    }

    if (vals.length === 0) {
      throw new Error("Aucune altitude LiDAR valide dans cette zone.");
    }

    vals.sort((a, b) => a - b);
    const p2Idx = Math.max(0, Math.floor(vals.length * 0.02));
    const p98Idx = Math.min(vals.length - 1, Math.floor(vals.length * 0.98));
    const minElev = vals[p2Idx];
    const maxElev = vals[p98Idx];

    this.activeTerrain = {
      data: region.data,
      width: region.width,
      height: region.height,
      bounds: region.bboxWgs84 || bbox,
      minElev,
      maxElev,
      span: Math.max(0.5, maxElev - minElev)
    };

    this.version++;
    this.tileCache.clear();
  }

  async toggle3D(forceState = null, targetParcel = null) {
    if (!this.map) return;
    const newState = forceState !== null ? Boolean(forceState) : !this.is3DActive;

    const btn = document.getElementById('btn-quick-3d');
    const btnText = document.getElementById('btn-3d-text');
    const toggleTopo3D = document.getElementById('toggle-topo-3d');

    if (newState) {
      const zoom = this.map.getZoom();
      if (zoom < 11 && !targetParcel) {
        alert("Veuillez zoomer davantage (zoom 12+) ou sélectionner une parcelle pour activer le relief 3D.");
        return;
      }

      if (btnText) btnText.textContent = 'Calcul 3D...';

      try {
        await this.prepareTerrainData(targetParcel);

        // Configurer la source raster-dem MapLibre si absente
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

        // Ajouter la couche hillshade 3D
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

        // Activer le relief 3D avec l'exagération demandée (30X par défaut)
        this.map.setTerrain({
          source: this.sourceId,
          exaggeration: this.exaggeration
        });

        // Incliner la caméra en perspective
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

  resetCamera2D() {
    if (this.map) {
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }

  tiltCamera3D() {
    if (this.map) {
      this.map.easeTo({ pitch: 60, bearing: -20, duration: 800 });
    }
  }

  async refreshCurrentView() {
    if (!this.is3DActive) return;
    const btn = document.getElementById('btnRefresh3D');
    if (btn) btn.disabled = true;

    try {
      await this.prepareTerrainData(this.lastClickedParcel);
      
      // Forcer le rechargement du terrain en rafraîchissant setTerrain
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

  syncUI() {
    const btn = document.getElementById('btn-quick-3d');
    const btnText = document.getElementById('btn-3d-text');
    const panel = document.getElementById('map-3d-controls');
    const badge = document.getElementById('badge3DExaggeration');
    const slider = document.getElementById('slider3DExaggeration');
    const toggleTopo3D = document.getElementById('toggle-topo-3d');
    const topo3DBadge = document.getElementById('topo-3d-badge-status');
    const scopeLabel = document.getElementById('label-3d-scope');

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
    if (slider) {
      slider.value = this.exaggeration;
    }
    if (panel) {
      panel.style.display = this.is3DActive ? 'block' : 'none';
    }
    if (scopeLabel) {
      scopeLabel.textContent = this.is3DActive && this.activeTargetName ? `Cible : ${this.activeTargetName}` : 'Amplifie le micro-relief des pentes agricoles';
    }

    document.querySelectorAll('.btn-preset-3d').forEach((b) => {
      const bVal = parseFloat(b.getAttribute('data-exag'));
      b.classList.toggle('active', Math.abs(bVal - this.exaggeration) < 0.5);
    });
  }

  bindEvents() {
    const btnQuick3D = document.getElementById('btn-quick-3d');
    if (btnQuick3D) {
      btnQuick3D.addEventListener('click', () => this.toggle3D());
    }

    const toggleTopo3D = document.getElementById('toggle-topo-3d');
    if (toggleTopo3D) {
      toggleTopo3D.addEventListener('change', (e) => this.toggle3D(e.target.checked));
    }

    const btnClose = document.getElementById('btnClose3DPanel');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.toggle3D(false));
    }

    const slider = document.getElementById('slider3DExaggeration');
    if (slider) {
      slider.addEventListener('input', (e) => this.setExaggeration(e.target.value));
    }

    document.querySelectorAll('.btn-preset-3d').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-exag');
        if (val) this.setExaggeration(val);
      });
    });

    const btnReset2D = document.getElementById('btnResetView2D');
    if (btnReset2D) {
      btnReset2D.addEventListener('click', () => this.resetCamera2D());
    }

    const btnTilt3D = document.getElementById('btnTiltView3D');
    if (btnTilt3D) {
      btnTilt3D.addEventListener('click', () => this.tiltCamera3D());
    }

    const btnRefresh = document.getElementById('btnRefresh3D');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this.refreshCurrentView());
    }
  }
}

window.Terrain3DManager = Terrain3DManager;
