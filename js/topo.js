    class TopoManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.enabled = false;
        this.opacity = 0.70;
        this.stretchMethod = 'percentile'; // 'percentile', 'minmax', or 'manual'
        this.manualMin = null;
        this.manualMax = null;
        this.lastAutoMin = null;
        this.lastAutoMax = null;
        this.activeCogUrl = '';
        this.cogPromise = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.hillshadeEnabled = true;
        this.hillshadeOpacity = 0.60;
        this.hillshadeCanvas = document.createElement('canvas');
        this.hillshadeCtx = this.hillshadeCanvas.getContext('2d');
        this.debounceTimer = null;
        this.abortController = null;
        this.sourceAdded = false;
        this.hillshadeSourceAdded = false;
        this.selectedProjectId = 'default';
        this.selectedProjectUrl = null;
        this.selectedProjectTitle = 'Mosaïque nationale 1 m';
        this.availableProjects = [];
        this.projectDebounceTimer = null;
        this.stacAbortController = null;
        this.lastStacBboxKey = '';
        setTimeout(() => this.initProjectSelector(), 50);
      }

      setStretchMethod(method) {
        this.stretchMethod = method;
        this.scheduleUpdate();
      }

      setManualRange(min, max) {
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          this.manualMin = min;
          this.manualMax = max;
          this.stretchMethod = 'manual';
          this.scheduleUpdate();
          return true;
        }
        return false;
      }

      setOpacity(val) {
        this.opacity = val;
        if (this.map.getLayer('hrdem-topo-layer')) {
          this.map.setPaintProperty('hrdem-topo-layer', 'raster-opacity', this.opacity);
        }
      }

      setHillshadeOpacity(val) {
        this.hillshadeOpacity = val;
        if (this.map.getLayer('hrdem-hillshade-layer')) {
          this.map.setPaintProperty('hrdem-hillshade-layer', 'raster-opacity', this.hillshadeOpacity);
        }
      }

      setHillshadeEnabled(on) {
        this.hillshadeEnabled = on;
        if (this.map.getLayer('hrdem-hillshade-layer')) {
          this.map.setLayoutProperty('hrdem-hillshade-layer', 'visibility', (this.enabled && on) ? 'visible' : 'none');
          if (this.enabled && on && this.map.getLayer('hrdem-topo-layer')) {
            this.map.moveLayer('hrdem-topo-layer', 'hrdem-hillshade-layer');
          }
        }
        if (this.enabled && on && !this.hillshadeSourceAdded) {
          this.scheduleUpdate();
        }
      }

      setEnabled(on) {
        this.enabled = on;
        if (this.map.getLayer('hrdem-topo-layer')) {
          this.map.setLayoutProperty('hrdem-topo-layer', 'visibility', on ? 'visible' : 'none');
        }
        if (this.map.getLayer('hrdem-hillshade-layer')) {
          this.map.setLayoutProperty('hrdem-hillshade-layer', 'visibility', (on && this.hillshadeEnabled) ? 'visible' : 'none');
        }
        if (on && this.map.getLayer('hrdem-topo-layer') && this.map.getLayer('hrdem-hillshade-layer')) {
          this.map.moveLayer('hrdem-topo-layer', 'hrdem-hillshade-layer');
        }
        if (on) this.scheduleUpdate();
      }

      async getCog(url) {
        if (this.activeCogUrl === url && this.cogPromise) return this.cogPromise;
        this.activeCogUrl = url;
        this.cogPromise = fromUrl(url, {}, AbortSignal.timeout(30000));
        return this.cogPromise;
      }

      scheduleUpdate() {
        if (!this.enabled) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.updateViewport();
        }, 150);
      }

      initProjectSelector() {
        const select = document.getElementById('topo-lidar-project-select');
        if (select) {
          select.addEventListener('change', (e) => {
            this.setSelectedProject(e.target.value);
          });
        }
        const btnRefresh = document.getElementById('btn-refresh-lidar-projects');
        if (btnRefresh) {
          btnRefresh.addEventListener('click', () => {
            this.fetchLiDARProjectsForViewport(true);
          });
        }
        const cardTopo = document.getElementById('card-topo');
        if (cardTopo) {
          cardTopo.addEventListener('toggle', () => {
            if (cardTopo.open) {
              this.fetchLiDARProjectsForViewport();
            }
          });
        }
      }

      formatProjectLabel(item) {
        const id = item.id || '';
        let year = '';
        if (item.properties && item.properties.datetime) {
          try {
            year = new Date(item.properties.datetime).getUTCFullYear();
          } catch (e) {}
        }
        if (!year) {
          const ym = id.match(/(20\d\d|19\d\d)/);
          if (ym) year = ym[1];
        }

        const res = id.endsWith('-2m') ? '2 m' : '1 m';

        let name = id;
        name = name.replace(/-(1|2)m$/i, '');
        name = name.replace(/^NRCAN[-_]FHIMP[-_]PICAI[-_](QC[-_])?/i, '');
        name = name.replace(/^NRCAN[-_]/i, '');
        name = name.replace(/^QC[-_]6000\d{2}[-_]\d{1,3}[-_]/i, '');
        name = name.replace(/^QC[-_]6000\d{2}[-_]/i, '');
        name = name.replace(/^QC[-_]10[-_]\d{2,4}[-_]/i, '');
        name = name.replace(/^QC[-_]R\d+[-_]/i, '');
        name = name.replace(/^QC[-_]/i, '');
        name = name.replace(/^SNCA[-_]/i, '');
        name = name.replace(/^VILLE[-_]/i, '');
        name = name.replace(/[-_]?(MTM|UTM)\d+/gi, '');
        name = name.replace(/[-_]?(20\d\d|19\d\d)([-_]\d{2})?/g, '');
        name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
        name = name.replace(/\bLidarDIF\b/gi, '').replace(/\bLidar\b/gi, '').replace(/\bDIF\b/gi, '');
        name = name.replace(/\bSegmentRiv\b/gi, '').replace(/\bRNCan\b/gi, '');
        name = name.replace(/[_]+/g, ' ').replace(/[-]+/g, ' ');
        name = name.replace(/\s+/g, ' ').trim();

        const words = name.split(' ');
        const unique = [];
        for (const w of words) {
          if (!w) continue;
          if (!unique.some(u => u.toLowerCase() === w.toLowerCase())) {
            unique.push(w);
          }
        }
        name = unique.join(' ').trim();

        name = name
          .replace(/\bMonteregie\b/gi, 'Montérégie')
          .replace(/\bMontreal\b/gi, 'Montréal')
          .replace(/\bQuebec\b/gi, 'Québec')
          .replace(/\bLevis\b/gi, 'Lévis')
          .replace(/\bRiviere\b/gi, 'Rivière')
          .replace(/\bBecancour\b/gi, 'Bécancour')
          .replace(/\bErable\b/gi, 'Érable')
          .replace(/\bGeomont\b/gi, 'GéoMont');

        if (!name || name.length < 2) {
          name = id.replace(/-(1|2)m$/i, '');
        }

        const meta = [];
        if (year) meta.push(year);
        meta.push(res);

        return `${name} (${meta.join(', ')})`;
      }

      scheduleProjectDiscovery() {
        if (this.projectDebounceTimer) clearTimeout(this.projectDebounceTimer);
        this.projectDebounceTimer = setTimeout(() => {
          this.fetchLiDARProjectsForViewport();
        }, 350);
      }

      async fetchLiDARProjectsForViewport(force = false) {
        if (!this.map) return;
        const zoom = this.map.getZoom();
        const countBadge = document.getElementById('topo-project-count-badge');
        const infoEl = document.getElementById('topo-project-info');
        const select = document.getElementById('topo-lidar-project-select');

        if (zoom < 11) {
          if (countBadge) {
            countBadge.textContent = this.selectedProjectId === 'default' ? 'Mosaïque 1 m' : 'Projet actif';
          }
          if (infoEl) {
            infoEl.textContent = 'Zoomer (zoom 11+) pour explorer les levés';
          }
          return;
        }

        const bounds = this.map.getBounds();
        const w = bounds.getWest();
        const s = bounds.getSouth();
        const e = bounds.getEast();
        const n = bounds.getNorth();
        const bboxKey = `${w.toFixed(2)},${s.toFixed(2)},${e.toFixed(2)},${n.toFixed(2)}`;

        if (!force && bboxKey === this.lastStacBboxKey) return;
        this.lastStacBboxKey = bboxKey;

        if (this.stacAbortController) this.stacAbortController.abort();
        this.stacAbortController = new AbortController();

        if (infoEl) infoEl.textContent = 'Recherche des levés LiDAR...';

        try {
          const stacUrl = `https://datacube.services.geo.ca/pgstac/api/collections/hrdem-lidar/items?bbox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}&limit=50`;
          const res = await fetch(stacUrl, { signal: this.stacAbortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const features = Array.isArray(json.features) ? json.features : [];

          const projects = [];
          for (const f of features) {
            if (f.assets && f.assets.dtm && f.assets.dtm.href) {
              let year = 0;
              if (f.properties && f.properties.datetime) {
                try { year = new Date(f.properties.datetime).getUTCFullYear(); } catch (err) {}
              }
              if (!year) {
                const ym = f.id.match(/(20\d\d|19\d\d)/);
                if (ym) year = parseInt(ym[1], 10);
              }
              projects.push({
                id: f.id,
                label: this.formatProjectLabel(f),
                url: f.assets.dtm.href,
                dsmUrl: f.assets.dsm ? f.assets.dsm.href : null,
                year,
                resolution: f.id.endsWith('-2m') ? '2 m' : '1 m',
                bbox: f.bbox
              });
            }
          }

          // Tri chronologique décroissant (plus récents en premier)
          projects.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return a.label.localeCompare(b.label);
          });

          this.availableProjects = projects;

          // Reconstruire le sélecteur
          if (select) {
            const currentSelected = this.selectedProjectId;
            select.innerHTML = '';

            const defaultOpt = document.createElement('option');
            defaultOpt.value = 'default';
            defaultOpt.textContent = 'Mosaïque nationale 1 m (Par défaut)';
            if (currentSelected === 'default') defaultOpt.selected = true;
            select.appendChild(defaultOpt);

            if (projects.length > 0) {
              const grp = document.createElement('optgroup');
              grp.label = `Campagnes LiDAR dans cette vue (${projects.length})`;
              let currentFound = false;

              for (const p of projects) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.label;
                if (p.id === currentSelected) {
                  opt.selected = true;
                  currentFound = true;
                }
                grp.appendChild(opt);
              }
              select.appendChild(grp);

              if (currentSelected !== 'default' && !currentFound) {
                const retainedOpt = document.createElement('option');
                retainedOpt.value = currentSelected;
                retainedOpt.textContent = `${this.selectedProjectTitle} (Hors vue)`;
                retainedOpt.selected = true;
                select.appendChild(retainedOpt);
              }
            }
          }

          if (countBadge) {
            if (this.selectedProjectId === 'default') {
              countBadge.textContent = `${projects.length} levé${projects.length > 1 ? 's' : ''}`;
              countBadge.style.background = '#e0f2fe';
              countBadge.style.color = '#0284c7';
              countBadge.style.borderColor = '#bae6fd';
            } else {
              countBadge.textContent = 'Projet actif';
              countBadge.style.background = '#ecfdf5';
              countBadge.style.color = '#059669';
              countBadge.style.borderColor = '#a7f3d0';
            }
          }

          if (infoEl) {
            infoEl.textContent = `${projects.length} levé(s) LiDAR découvert(s)`;
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('STAC LiDAR projects discovery failed:', err);
          if (infoEl) infoEl.textContent = 'Levés locaux indisponibles (Mosaïque active)';
        }
      }

      setSelectedProject(id) {
        if (id === 'default' || !id) {
          this.selectedProjectId = 'default';
          this.selectedProjectUrl = null;
          this.selectedProjectTitle = 'Mosaïque nationale 1 m';
        } else {
          const proj = this.availableProjects.find(p => p.id === id);
          if (proj) {
            this.selectedProjectId = proj.id;
            this.selectedProjectUrl = proj.url;
            this.selectedProjectTitle = proj.label;
          } else {
            this.selectedProjectId = id;
          }
        }

        const countBadge = document.getElementById('topo-project-count-badge');
        if (countBadge) {
          if (this.selectedProjectId === 'default') {
            countBadge.textContent = `${this.availableProjects.length} levé${this.availableProjects.length > 1 ? 's' : ''}`;
            countBadge.style.background = '#e0f2fe';
            countBadge.style.color = '#0284c7';
            countBadge.style.borderColor = '#bae6fd';
          } else {
            countBadge.textContent = 'Projet actif';
            countBadge.style.background = '#ecfdf5';
            countBadge.style.color = '#059669';
            countBadge.style.borderColor = '#a7f3d0';
          }
        }

        // Synchroniser ContourManager si chargé
        if (window.contourManager) {
          if (this.selectedProjectUrl) {
            window.contourManager.updateConfig({
              regionProvider: (bbox, gridSize, signal) => readSingleHrdemProjectRegion(this.selectedProjectUrl, bbox, gridSize, signal, 'bilinear')
            });
          } else {
            window.contourManager.updateConfig({
              regionProvider: (bbox, gridSize, signal) => readMultiHrdemRegion(bbox, gridSize, signal, 'bilinear')
            });
          }
          const toggleContoursEl = document.getElementById("toggle-contours");
          if (toggleContoursEl && toggleContoursEl.checked) {
            window.contourManager.generateForView();
          }
        }

        this.scheduleUpdate();

        if (window.pentesManager && window.pentesManager.enabled) {
          window.pentesManager.scheduleUpdate();
        }
      }

      async updateViewport() {
        if (!this.enabled || !this.map) return;
        const zoom = this.map.getZoom();
        if (zoom < 7) {
          const badge = document.getElementById('topo-alt-badge');
          if (badge) badge.textContent = 'Zoomer pour le relief détaillé (zoom 7+)';
          return;
        }

        const bounds = this.map.getBounds();
        const w = bounds.getWest();
        const s = bounds.getSouth();
        const e = bounds.getEast();
        const n = bounds.getNorth();
        const bbox = [w, s, e, n];

        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        const badge = document.getElementById('topo-alt-badge');
        if (badge) badge.textContent = 'Calcul du relief...';

        try {
          const targetSize = 256;
          let region = null;
          let isProject = false;

          if (this.selectedProjectId !== 'default' && this.selectedProjectUrl) {
            region = await readSingleHrdemProjectRegion(this.selectedProjectUrl, bbox, targetSize, this.abortController.signal, 'bilinear');
            if (region && region.data && region.data.length > 0) {
              isProject = true;
            }
          }

          if (!region) {
            if (this.selectedProjectId !== 'default' && this.selectedProjectUrl) {
              if (badge) badge.textContent = `Aucune donnée dans la vue pour ce levé (${this.selectedProjectTitle})`;
              return;
            }
            const intersecting = findTilesForBbox(w, s, e, n);
            if (intersecting.length === 0) {
              if (badge) badge.textContent = 'Hors de la zone MNE HRDEM';
              return;
            }
            region = await readMultiHrdemRegion(bbox, targetSize, this.abortController.signal, 'bilinear');
          }

          if (!region || !region.data || region.data.length === 0) {
            if (badge) badge.textContent = 'Aucune donnée MNE dans la vue';
            return;
          }

          const [autoMin, autoMax] = calculateViewportStretchRange(region.data, this.stretchMethod === 'minmax' ? 'minmax' : 'percentile');
          this.lastAutoMin = autoMin;
          this.lastAutoMax = autoMax;

          let minAlt, maxAlt;
          if (this.stretchMethod === 'manual' && Number.isFinite(this.manualMin) && Number.isFinite(this.manualMax) && this.manualMax > this.manualMin) {
            minAlt = this.manualMin;
            maxAlt = this.manualMax;
          } else {
            minAlt = autoMin;
            maxAlt = autoMax;
          }

          if (badge) {
            const prefix = this.stretchMethod === 'manual' ? 'Alt fixé : ' : 'Alt : ';
            const sourceSuffix = isProject ? ` [${this.selectedProjectTitle}]` : (region.tiles && region.tiles.length > 1 ? ` (${region.tiles.length} tuiles fusionnées)` : '');
            badge.textContent = `${prefix}${minAlt.toFixed(2)} m (mauve) → ${maxAlt.toFixed(2)} m (rouge)${sourceSuffix}`;
          }

          const span = Math.max(1, maxAlt - minAlt);
          const width = region.width;
          const height = region.height;

          this.canvas.width = width;
          this.canvas.height = height;
          const imgData = this.ctx.createImageData(width, height);
          const pixels = imgData.data;

          for (let i = 0; i < region.data.length; i++) {
            const val = region.data[i];
            const pIdx = i * 4;
            if (isNaN(val) || val <= -1000 || val >= 9000) {
              pixels[pIdx + 3] = 0;
            } else {
              const norm = Math.max(0, Math.min(1, (val - minAlt) / span));
              const color = interpolateColor(norm);
              pixels[pIdx] = color.r;
              pixels[pIdx + 1] = color.g;
              pixels[pIdx + 2] = color.b;
              pixels[pIdx + 3] = 255;
            }
          }

          this.ctx.putImageData(imgData, 0, 0);
          const dataUrl = this.canvas.toDataURL();

          const actualBbox = region.bboxWgs84 || bbox;
          const coords = region.cornersWgs84 || [
            [actualBbox[0], actualBbox[3]], // Top-Left (NW)
            [actualBbox[2], actualBbox[3]], // Top-Right (NE)
            [actualBbox[2], actualBbox[1]], // Bottom-Right (SE)
            [actualBbox[0], actualBbox[1]]  // Bottom-Left (SW)
          ];

          const source = this.map.getSource('hrdem-topo-source');
          if (source) {
            source.updateImage({
              url: dataUrl,
              coordinates: coords
            });
          } else {
            this.map.addSource('hrdem-topo-source', {
              type: 'image',
              url: dataUrl,
              coordinates: coords
            });
            this.map.addLayer({
              id: 'hrdem-topo-layer',
              type: 'raster',
              source: 'hrdem-topo-source',
              layout: { visibility: this.enabled ? 'visible' : 'none' },
              paint: {
                'raster-opacity': this.opacity,
                'raster-resampling': 'linear',
                'raster-fade-duration': 180
              }
            }, 'pedologie-fill');
            this.sourceAdded = true;
          }

          // --- Calcul de l'ombrage du relief (Hillshade 3D) semi-transparent à la volée ---
          const dx = Math.max(0.5, (region.sourceBBox[2] - region.sourceBBox[0]) / width);
          const dy = Math.max(0.5, (region.sourceBBox[3] - region.sourceBBox[1]) / height);
          const inv8dx = 1 / (8 * dx);
          const inv8dy = 1 / (8 * dy);
          // Vecteur d'éclairage : Azimut 315° (Nord-Ouest), Altitude solaire 45°
          const Sx = -0.5, Sy = 0.5, Sz = 0.7071068;
          const I0 = 0.7071068;
          const invI0 = 1 / I0;
          const inv1MinusI0 = 1 / (1 - I0);

          // Exagération verticale adaptative selon le zoom pour révéler le micro-relief
          let zFactor = 2.4;
          if (zoom >= 15) zFactor = 1.8;
          else if (zoom <= 10) zFactor = 3.6;

          this.hillshadeCanvas.width = width;
          this.hillshadeCanvas.height = height;
          const hsImgData = this.hillshadeCtx.createImageData(width, height);
          const hsPixels = hsImgData.data;
          const rawData = region.data;

          for (let r = 0; r < height; r++) {
            const rPrev = (r > 0 ? r - 1 : 0) * width;
            const rCurr = r * width;
            const rNext = (r < height - 1 ? r + 1 : height - 1) * width;

            for (let c = 0; c < width; c++) {
              const pIdx = (rCurr + c) * 4;
              const z_c = rawData[rCurr + c];

              if (isNaN(z_c) || z_c <= -1000 || z_c >= 9000) {
                hsPixels[pIdx + 3] = 0;
                continue;
              }

              const cPrev = c > 0 ? c - 1 : 0;
              const cNext = c < width - 1 ? c + 1 : width - 1;

              const getVal = (idx) => {
                const v = rawData[idx];
                return (isNaN(v) || v <= -1000 || v >= 9000) ? z_c : v;
              };

              const z_nw = getVal(rPrev + cPrev);
              const z_n  = getVal(rPrev + c);
              const z_ne = getVal(rPrev + cNext);
              const z_w  = getVal(rCurr + cPrev);
              const z_e  = getVal(rCurr + cNext);
              const z_sw = getVal(rNext + cPrev);
              const z_s  = getVal(rNext + c);
              const z_se = getVal(rNext + cNext);

              // Filtre de Horn 3x3 pour le gradient altimétrique métrique
              const dzdx = ((z_ne + 2 * z_e + z_se) - (z_nw + 2 * z_w + z_sw)) * inv8dx;
              const dzdy = ((z_nw + 2 * z_n + z_ne) - (z_sw + 2 * z_s + z_se)) * inv8dy;

              const nx = -dzdx * zFactor;
              const ny = -dzdy * zFactor;
              const invLen = 1 / Math.sqrt(nx * nx + ny * ny + 1.0);

              const dot = (nx * Sx + ny * Sy + Sz) * invLen;
              const I = dot > 1 ? 1 : (dot < 0 ? 0 : dot);

              if (I < I0) {
                // Versant à l'ombre (obscurcissement progressif semi-transparent)
                const shade = Math.pow((I0 - I) * invI0, 0.85);
                hsPixels[pIdx] = 15;
                hsPixels[pIdx + 1] = 23;
                hsPixels[pIdx + 2] = 42;
                hsPixels[pIdx + 3] = Math.min(255, (shade * 255 * 1.35) | 0);
              } else {
                // Versant exposé au soleil (lumière diffuse / rehaut blanc semi-transparent)
                const light = Math.pow((I - I0) * inv1MinusI0, 0.9);
                hsPixels[pIdx] = 255;
                hsPixels[pIdx + 1] = 255;
                hsPixels[pIdx + 2] = 255;
                hsPixels[pIdx + 3] = Math.min(255, (light * 255 * 1.2) | 0);
              }
            }
          }

          this.hillshadeCtx.putImageData(hsImgData, 0, 0);
          const hsDataUrl = this.hillshadeCanvas.toDataURL();

          const hsSource = this.map.getSource('hrdem-hillshade-source');
          if (hsSource) {
            hsSource.updateImage({
              url: hsDataUrl,
              coordinates: coords
            });
          } else {
            this.map.addSource('hrdem-hillshade-source', {
              type: 'image',
              url: hsDataUrl,
              coordinates: coords
            });
            const beforeLayer = this.map.getLayer('pedologie-fill') ? 'pedologie-fill' : undefined;
            this.map.addLayer({
              id: 'hrdem-hillshade-layer',
              type: 'raster',
              source: 'hrdem-hillshade-source',
              layout: { visibility: (this.enabled && this.hillshadeEnabled) ? 'visible' : 'none' },
              paint: {
                'raster-opacity': this.hillshadeOpacity,
                'raster-resampling': 'linear',
                'raster-fade-duration': 180
              }
            }, beforeLayer);
            this.hillshadeSourceAdded = true;
          }

          if (typeof bringTopLayersToFront === 'function') {
            bringTopLayersToFront();
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('Topo viewport stretch update failed:', err);
        }
      }
    }

    // Slope (Pentes en %) Manager with Gaussian Smoothing calculated on the fly
    class PentesManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.enabled = false;
        this.opacity = 0.75;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.debounceTimer = null;
        this.abortController = null;
        this.sourceAdded = false;
      }

      setOpacity(val) {
        this.opacity = val;
        if (this.map.getLayer('hrdem-pentes-layer')) {
          this.map.setPaintProperty('hrdem-pentes-layer', 'raster-opacity', this.opacity);
        }
      }

      setEnabled(on) {
        this.enabled = on;
        if (this.map.getLayer('hrdem-pentes-layer')) {
          this.map.setLayoutProperty('hrdem-pentes-layer', 'visibility', on ? 'visible' : 'none');
        }
        const badge = document.getElementById('pentes-status-badge');
        if (badge && !on) {
          badge.textContent = 'Désactivé';
        }
        if (on) this.scheduleUpdate();
      }

      scheduleUpdate() {
        if (!this.enabled) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.updateViewport();
        }, 150);
      }

      async updateViewport() {
        if (!this.enabled || !this.map) return;
        const zoom = this.map.getZoom();
        const badge = document.getElementById('pentes-status-badge');
        if (zoom < 7) {
          if (badge) badge.textContent = 'Zoomer pour les pentes (zoom 7+)';
          return;
        }

        const bounds = this.map.getBounds();
        const w = bounds.getWest();
        const s = bounds.getSouth();
        const e = bounds.getEast();
        const n = bounds.getNorth();
        const bbox = [w, s, e, n];

        const intersecting = findTilesForBbox(w, s, e, n);
        if (intersecting.length === 0) {
          if (badge) badge.textContent = 'Hors de la zone MNE HRDEM';
          return;
        }

        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        if (badge) badge.textContent = 'Calcul des pentes...';

        try {
          const targetSize = 256;
          let region = null;
          let isProject = false;
          if (window.topoManager && window.topoManager.selectedProjectId !== 'default' && window.topoManager.selectedProjectUrl) {
            region = await readSingleHrdemProjectRegion(window.topoManager.selectedProjectUrl, bbox, targetSize, this.abortController.signal, 'bilinear');
            if (region && region.data && region.data.length > 0) isProject = true;
          }
          if (!region) {
            region = await readMultiHrdemRegion(bbox, targetSize, this.abortController.signal, 'bilinear');
          }

          if (!region || !region.data || region.data.length === 0) {
            if (badge) badge.textContent = 'Aucune donnée MNE dans la vue';
            return;
          }

          const width = region.width;
          const height = region.height;
          const rawData = region.data;

          // 1. Lissage Gaussien 3x3 séparable pour éliminer le micro-bruit LiDAR 1m
          const temp = new Float32Array(width * height);
          for (let r = 0; r < height; r++) {
            const rowOff = r * width;
            for (let c = 0; c < width; c++) {
              const center = rawData[rowOff + c];
              if (isNaN(center) || center <= -1000 || center >= 9000) {
                temp[rowOff + c] = NaN;
                continue;
              }
              const cPrev = c > 0 ? c - 1 : 0;
              const cNext = c < width - 1 ? c + 1 : width - 1;
              const v0 = rawData[rowOff + cPrev];
              const v1 = center;
              const v2 = rawData[rowOff + cNext];
              const valid0 = !isNaN(v0) && v0 > -1000 && v0 < 9000;
              const valid2 = !isNaN(v2) && v2 > -1000 && v2 < 9000;
              const w0 = valid0 ? 1 : 0;
              const w1 = 2;
              const w2 = valid2 ? 1 : 0;
              const sumW = w0 + w1 + w2;
              temp[rowOff + c] = ((valid0 ? v0 : 0) * w0 + v1 * w1 + (valid2 ? v2 : 0) * w2) / sumW;
            }
          }

          const smoothed = new Float32Array(width * height);
          for (let c = 0; c < width; c++) {
            for (let r = 0; r < height; r++) {
              const center = temp[r * width + c];
              if (isNaN(center)) {
                smoothed[r * width + c] = NaN;
                continue;
              }
              const rPrev = (r > 0 ? r - 1 : 0) * width;
              const rCurr = r * width;
              const rNext = (r < height - 1 ? r + 1 : height - 1) * width;
              const v0 = temp[rPrev + c];
              const v1 = center;
              const v2 = temp[rNext + c];
              const valid0 = !isNaN(v0);
              const valid2 = !isNaN(v2);
              const w0 = valid0 ? 1 : 0;
              const w1 = 2;
              const w2 = valid2 ? 1 : 0;
              const sumW = w0 + w1 + w2;
              smoothed[rCurr + c] = ((valid0 ? v0 : 0) * w0 + v1 * w1 + (valid2 ? v2 : 0) * w2) / sumW;
            }
          }

          // 2. Calcul des pentes en % avec filtre de Horn
          const dx = Math.max(0.5, (region.sourceBBox[2] - region.sourceBBox[0]) / width);
          const dy = Math.max(0.5, (region.sourceBBox[3] - region.sourceBBox[1]) / height);
          const inv8dx = 1 / (8 * dx);
          const inv8dy = 1 / (8 * dy);

          this.canvas.width = width;
          this.canvas.height = height;
          const imgData = this.ctx.createImageData(width, height);
          const pixels = imgData.data;

          let sumSlope = 0, countSlope = 0;

          for (let r = 0; r < height; r++) {
            const rPrev = (r > 0 ? r - 1 : 0) * width;
            const rCurr = r * width;
            const rNext = (r < height - 1 ? r + 1 : height - 1) * width;

            for (let c = 0; c < width; c++) {
              const pIdx = (rCurr + c) * 4;
              const z_c = smoothed[rCurr + c];

              if (isNaN(z_c) || z_c <= -1000 || z_c >= 9000) {
                pixels[pIdx + 3] = 0;
                continue;
              }

              const cPrev = c > 0 ? c - 1 : 0;
              const cNext = c < width - 1 ? c + 1 : width - 1;

              const getVal = (idx) => {
                const v = smoothed[idx];
                return (isNaN(v) || v <= -1000 || v >= 9000) ? z_c : v;
              };

              const z_nw = getVal(rPrev + cPrev);
              const z_n  = getVal(rPrev + c);
              const z_ne = getVal(rPrev + cNext);
              const z_w  = getVal(rCurr + cPrev);
              const z_e  = getVal(rCurr + cNext);
              const z_sw = getVal(rNext + cPrev);
              const z_s  = getVal(rNext + c);
              const z_se = getVal(rNext + cNext);

              const dzdx = ((z_ne + 2 * z_e + z_se) - (z_nw + 2 * z_w + z_sw)) * inv8dx;
              const dzdy = ((z_nw + 2 * z_n + z_ne) - (z_sw + 2 * z_s + z_se)) * inv8dy;

              // Pente en % = dénivelé / distance horizontale * 100
              const slopePct = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
              if (isNaN(slopePct)) {
                pixels[pIdx + 3] = 0;
                continue;
              }
              sumSlope += slopePct;
              countSlope++;

              // 6 catégories exactes :
              // 0-0.3%, 0.3-1%, 1-3%, 3-10%, 10-30%, >30%
              pixels[pIdx + 3] = 255;
              if (slopePct < 0.3) {
                // 0 - 0.3% : Bleu cyan (zones plates / risque de stagnation)
                pixels[pIdx] = 2;
                pixels[pIdx + 1] = 132;
                pixels[pIdx + 2] = 199;
              } else if (slopePct < 1.0) {
                // 0.3 - 1% : Vert vif (très faible pente)
                pixels[pIdx] = 34;
                pixels[pIdx + 1] = 197;
                pixels[pIdx + 2] = 94;
              } else if (slopePct < 3.0) {
                // 1 - 3% : Jaune-vert / lime (pente faible)
                pixels[pIdx] = 132;
                pixels[pIdx + 1] = 204;
                pixels[pIdx + 2] = 22;
              } else if (slopePct < 10.0) {
                // 3 - 10% : Jaune doré (pente modérée)
                pixels[pIdx] = 234;
                pixels[pIdx + 1] = 179;
                pixels[pIdx + 2] = 8;
              } else if (slopePct < 30.0) {
                // 10 - 30% : Orange (pente forte)
                pixels[pIdx] = 234;
                pixels[pIdx + 1] = 88;
                pixels[pIdx + 2] = 12;
              } else {
                // > 30% : Rouge vif / carmin (pente très forte / escarpement)
                pixels[pIdx] = 185;
                pixels[pIdx + 1] = 28;
                pixels[pIdx + 2] = 28;
              }
            }
          }

          this.ctx.putImageData(imgData, 0, 0);
          const dataUrl = this.canvas.toDataURL();

          if (badge && countSlope > 0) {
            const avgSlope = (sumSlope / countSlope).toFixed(1);
            badge.textContent = `Pente moyenne : ${avgSlope} %`;
          }

          const actualBbox = region.bboxWgs84 || bbox;
          const coords = region.cornersWgs84 || [
            [actualBbox[0], actualBbox[3]], // Top-Left (NW)
            [actualBbox[2], actualBbox[3]], // Top-Right (NE)
            [actualBbox[2], actualBbox[1]], // Bottom-Right (SE)
            [actualBbox[0], actualBbox[1]]  // Bottom-Left (SW)
          ];

          const source = this.map.getSource('hrdem-pentes-source');
          if (source) {
            source.updateImage({
              url: dataUrl,
              coordinates: coords
            });
          } else {
            this.map.addSource('hrdem-pentes-source', {
              type: 'image',
              url: dataUrl,
              coordinates: coords
            });
            const beforeLayer = this.map.getLayer('pedologie-fill') ? 'pedologie-fill' : undefined;
            this.map.addLayer({
              id: 'hrdem-pentes-layer',
              type: 'raster',
              source: 'hrdem-pentes-source',
              layout: { visibility: this.enabled ? 'visible' : 'none' },
              paint: {
                'raster-opacity': this.opacity,
                'raster-resampling': 'linear',
                'raster-fade-duration': 180
              }
            }, beforeLayer);
            this.sourceAdded = true;
          }

          if (typeof bringTopLayersToFront === 'function') {
            bringTopLayersToFront();
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('Slope calculation failed:', err);
        }
      }
    }

    // Canopy Height Model (Hauteur de canopée) Manager calculated on the fly: DSM - DTM from Canada AWS HRDEM 1m
    class CanopeeManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.enabled = false;
        this.opacity = 0.75;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.debounceTimer = null;
        this.abortController = null;
        this.sourceAdded = false;
      }

      setOpacity(val) {
        this.opacity = val;
        if (this.map.getLayer('hrdem-canopee-layer')) {
          this.map.setPaintProperty('hrdem-canopee-layer', 'raster-opacity', this.opacity);
        }
      }

      setEnabled(on) {
        this.enabled = on;
        if (this.map.getLayer('hrdem-canopee-layer')) {
          this.map.setLayoutProperty('hrdem-canopee-layer', 'visibility', on ? 'visible' : 'none');
        }
        const badge = document.getElementById('canopee-status-badge');
        if (badge && !on) {
          badge.textContent = 'Désactivé';
        }
        if (on) this.scheduleUpdate();
      }

      scheduleUpdate() {
        if (!this.enabled) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.updateViewport();
        }, 150);
      }

      async updateViewport() {
        if (!this.enabled || !this.map) return;
        const zoom = this.map.getZoom();
        const badge = document.getElementById('canopee-status-badge');
        if (zoom < 7) {
          if (badge) badge.textContent = 'Zoomer pour la canopée (zoom 7+)';
          return;
        }

        const bounds = this.map.getBounds();
        const w = bounds.getWest();
        const s = bounds.getSouth();
        const e = bounds.getEast();
        const n = bounds.getNorth();
        const bbox = [w, s, e, n];

        const intersecting = findTilesForBbox(w, s, e, n, 'dtm');
        if (intersecting.length === 0) {
          if (badge) badge.textContent = 'Hors de la zone MNE HRDEM';
          return;
        }

        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        if (badge) badge.textContent = 'Calcul de la canopée (DSM - DTM)...';

        try {
          const targetSize = 256;
          // Concurrent fetch of bare-earth DTM and surface DSM from AWS Canada
          const [dtmRegion, dsmRegion] = await Promise.all([
            readMultiHrdemRegion(bbox, targetSize, this.abortController.signal, 'bilinear', 'dtm'),
            readMultiHrdemRegion(bbox, targetSize, this.abortController.signal, 'bilinear', 'dsm')
          ]);

          if (!dtmRegion || !dsmRegion || !dtmRegion.data || !dsmRegion.data) {
            if (badge) badge.textContent = 'Données MNE/MNS indisponibles';
            return;
          }

          const width = dtmRegion.width;
          const height = dtmRegion.height;
          const dtmData = dtmRegion.data;
          const dsmData = dsmRegion.data;

          this.canvas.width = width;
          this.canvas.height = height;
          const imgData = this.ctx.createImageData(width, height);
          const pixels = imgData.data;

          let maxCanopy = 0;
          let sumCanopy = 0;
          let canopyCount = 0;

          const totalPixels = width * height;
          for (let i = 0; i < totalPixels; i++) {
            const pIdx = i * 4;
            const zDtm = dtmData[i];
            const zDsm = dsmData[i];

            if (isNaN(zDtm) || isNaN(zDsm) || zDtm <= -1000 || zDsm <= -1000 || zDtm >= 9000 || zDsm >= 9000) {
              pixels[pIdx + 3] = 0;
              continue;
            }

            // Hauteur au sol = MNS - MNE
            const h = zDsm - zDtm;

            // Seuil minimum de 0.5 m pour éliminer les cultures basses, résidus, gazon et micro-bruit
            if (h < 0.5) {
              pixels[pIdx + 3] = 0;
              continue;
            }

            if (h > maxCanopy) maxCanopy = h;
            sumCanopy += h;
            canopyCount++;

            pixels[pIdx + 3] = 255;
            if (h < 2.0) {
              // 0.5 - 2 m : Haies basses, buissons, régénération (#bef264 - lime)
              pixels[pIdx] = 190;
              pixels[pIdx + 1] = 242;
              pixels[pIdx + 2] = 100;
            } else if (h < 5.0) {
              // 2 - 5 m : Jeunes arbres, vergers, brise-vent bas (#4ade80 - vert clair)
              pixels[pIdx] = 74;
              pixels[pIdx + 1] = 222;
              pixels[pIdx + 2] = 128;
            } else if (h < 12.0) {
              // 5 - 12 m : Arbres moyens, lisières (#16a34a - vert vif)
              pixels[pIdx] = 22;
              pixels[pIdx + 1] = 163;
              pixels[pIdx + 2] = 74;
            } else if (h < 20.0) {
              // 12 - 20 m : Forêt mature, brise-vent arboré (#15803d - vert forêt)
              pixels[pIdx] = 21;
              pixels[pIdx + 1] = 128;
              pixels[pIdx + 2] = 61;
            } else if (h < 30.0) {
              // 20 - 30 m : Grands conifères / feuillus matures (#166534 - vert sombre)
              pixels[pIdx] = 22;
              pixels[pIdx + 1] = 101;
              pixels[pIdx + 2] = 52;
            } else {
              // > 30 m : Canopée très haute / émergents (#064e3b - vert bleuté très sombre)
              pixels[pIdx] = 6;
              pixels[pIdx + 1] = 78;
              pixels[pIdx + 2] = 59;
            }
          }

          this.ctx.putImageData(imgData, 0, 0);
          const dataUrl = this.canvas.toDataURL();

          if (badge) {
            if (canopyCount > 0) {
              const avgH = (sumCanopy / canopyCount).toFixed(1);
              badge.textContent = `Canopée max : ${maxCanopy.toFixed(1)} m | Moy. : ${avgH} m`;
            } else {
              badge.textContent = 'Aucun couvert arboré (> 0,5 m)';
            }
          }

          const actualBbox = dtmRegion.bboxWgs84 || bbox;
          const coords = dtmRegion.cornersWgs84 || [
            [actualBbox[0], actualBbox[3]], // Top-Left (NW)
            [actualBbox[2], actualBbox[3]], // Top-Right (NE)
            [actualBbox[2], actualBbox[1]], // Bottom-Right (SE)
            [actualBbox[0], actualBbox[1]]  // Bottom-Left (SW)
          ];

          const source = this.map.getSource('hrdem-canopee-source');
          if (source) {
            source.updateImage({
              url: dataUrl,
              coordinates: coords
            });
          } else {
            this.map.addSource('hrdem-canopee-source', {
              type: 'image',
              url: dataUrl,
              coordinates: coords
            });
            const beforeLayer = this.map.getLayer('pedologie-fill') ? 'pedologie-fill' : undefined;
            this.map.addLayer({
              id: 'hrdem-canopee-layer',
              type: 'raster',
              source: 'hrdem-canopee-source',
              layout: { visibility: this.enabled ? 'visible' : 'none' },
              paint: {
                'raster-opacity': this.opacity,
                'raster-resampling': 'linear',
                'raster-fade-duration': 180
              }
            }, beforeLayer);
            this.sourceAdded = true;
          }

          if (typeof bringTopLayersToFront === 'function') {
            bringTopLayersToFront();
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('Canopy calculation failed:', err);
        }
      }
    }

    // Elevation Profile Manager using HRDEM 1 m raster data
    class ProfileManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.line = [];
        this.profile = [];
        this.isDrawing = false;
        this.abortController = null;
        this.initLayers();
      }

      initLayers() {
        if (!this.map.getSource("raster-profile-line")) {
          this.map.addSource("raster-profile-line", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });
          this.map.addLayer({
            id: "raster-profile-line",
            type: "line",
            source: "raster-profile-line",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2563eb", "line-width": 3.5 }
          });
        }

        if (!this.map.getSource("raster-profile-points")) {
          this.map.addSource("raster-profile-points", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });
          this.map.addLayer({
            id: "raster-profile-points",
            type: "circle",
            source: "raster-profile-points",
            paint: {
              "circle-radius": 4.5,
              "circle-color": "#ffffff",
              "circle-stroke-color": "#2563eb",
              "circle-stroke-width": 2.5
            }
          });
        }

        if (!this.map.getSource("raster-profile-hover-point")) {
          this.map.addSource("raster-profile-hover-point", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });
          this.map.addLayer({
            id: "raster-profile-hover-point",
            type: "circle",
            source: "raster-profile-hover-point",
            paint: {
              "circle-radius": 6.5,
              "circle-color": "#dc2626",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2.5
            }
          });
        }
      }

      addPoint(lngLat) {
        if (this.line.length > 0) {
          const last = this.line[this.line.length - 1];
          if (Math.hypot(last[0] - lngLat.lng, last[1] - lngLat.lat) < 0.00003) {
            return;
          }
        }
        this.line.push([lngLat.lng, lngLat.lat]);
        this.updateMapVisuals();
        if (typeof updateToolbarButtons === "function") {
          updateToolbarButtons();
        }
      }

      updateMapVisuals() {
        const lineSource = this.map.getSource("raster-profile-line");
        if (lineSource) {
          lineSource.setData({
            type: "FeatureCollection",
            features: this.line.length >= 2 ? [{
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: this.line }
            }] : []
          });
        }

        const pointsSource = this.map.getSource("raster-profile-points");
        if (pointsSource) {
          pointsSource.setData({
            type: "FeatureCollection",
            features: this.line.length > 0 ? [{
              type: "Feature",
              properties: {},
              geometry: { type: "MultiPoint", coordinates: this.line }
            }] : []
          });
        }
      }

      setHoverPoint(coord) {
        const source = this.map.getSource("raster-profile-hover-point");
        if (!source) return;
        source.setData({
          type: "FeatureCollection",
          features: coord ? [{
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: coord }
          }] : []
        });
      }

      clear() {
        this.line = [];
        this.profile = [];
        this.updateMapVisuals();
        this.setHoverPoint(null);
        const dock = document.getElementById("elevation-profile-dock");
        if (dock) dock.classList.remove("open");
        const container = document.getElementById("profile-chart-container");
        if (container) container.innerHTML = "";
        const statsBar = document.getElementById("profile-stats-bar");
        if (statsBar) statsBar.innerHTML = "";
        const hoverInfo = document.getElementById("profile-hover-info");
        if (hoverInfo) hoverInfo.textContent = "Survolez le graphique pour explorer les altitudes le long de la coupe";
        if (typeof updateToolbarButtons === "function") {
          updateToolbarButtons();
        }
      }

      async calculateProfile(precisionType) {
        if (this.line.length < 2) {
          throw new Error("Veuillez cliquer au moins 2 points sur la carte.");
        }

        // Calculate bbox with padding
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (const [lng, lat] of this.line) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
        }
        const padLng = Math.max(0.003, (maxLng - minLng) * 0.15);
        const padLat = Math.max(0.003, (maxLat - minLat) * 0.15);
        const bbox = [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];

        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        let region = null;
        if (window.topoManager && window.topoManager.selectedProjectId !== 'default' && window.topoManager.selectedProjectUrl) {
          try {
            region = await readSingleHrdemProjectRegion(
              window.topoManager.selectedProjectUrl,
              bbox,
              512,
              this.abortController.signal,
              'bilinear'
            );
          } catch (e) {}
        }
        if (!region || !region.data || !region.sourceBBox) {
          region = await readMultiHrdemRegion(
            bbox,
            512,
            this.abortController.signal,
            'bilinear'
          );
        }

        if (!region || !region.data || !region.sourceBBox) {
          throw new Error("Impossible de lire les données altimétriques MNE pour ce tracé.");
        }

        const distances = [0];
        for (let i = 1; i < this.line.length; i++) {
          const a = this.line[i - 1];
          const b = this.line[i];
          const latRad = ((a[1] + b[1]) / 2) * Math.PI / 180;
          const dx = (b[0] - a[0]) * Math.cos(latRad) * 111320;
          const dy = (b[1] - a[1]) * 110540;
          distances.push(distances[i - 1] + Math.hypot(dx, dy));
        }
        const totalDist = distances[distances.length - 1];
        if (totalDist <= 0) {
          throw new Error("La distance de la coupe est trop faible.");
        }

        const samplesCount = 256;
        const profile = [];
        let segIdx = 1;

        const spanX = region.sourceBBox[2] - region.sourceBBox[0];
        const spanY = region.sourceBBox[3] - region.sourceBBox[1];

        for (let s = 0; s < samplesCount; s++) {
          const curDist = (totalDist * s) / (samplesCount - 1);
          while (segIdx < distances.length - 1 && distances[segIdx] < curDist) {
            segIdx++;
          }
          const d0 = distances[segIdx - 1];
          const d1 = distances[segIdx];
          const r = d1 === d0 ? 0 : (curDist - d0) / (d1 - d0);
          const ptLng = this.line[segIdx - 1][0] + (this.line[segIdx][0] - this.line[segIdx - 1][0]) * r;
          const ptLat = this.line[segIdx - 1][1] + (this.line[segIdx][1] - this.line[segIdx - 1][1]) * r;

          const [projX, projY] = proj4('EPSG:4326', EPSG_3979_DEF, [ptLng, ptLat]);
          if (spanX > 0 && spanY > 0) {
            const gx = ((projX - region.sourceBBox[0]) / spanX) * (region.width - 1);
            const gy = ((region.sourceBBox[3] - projY) / spanY) * (region.height - 1);

            if (gx >= 0 && gx <= region.width - 1 && gy >= 0 && gy <= region.height - 1) {
              const x0 = Math.floor(gx);
              const x1 = Math.min(region.width - 1, x0 + 1);
              const y0 = Math.floor(gy);
              const y1 = Math.min(region.height - 1, y0 + 1);
              const wx = gx - x0;
              const wy = gy - y0;

              const v00 = region.data[y0 * region.width + x0];
              const v10 = region.data[y0 * region.width + x1];
              const v01 = region.data[y1 * region.width + x0];
              const v11 = region.data[y1 * region.width + x1];

              const vals = [v00, v10, v01, v11];
              let val;
              if (vals.every(v => Number.isFinite(v) && v > -1000 && v < 9000)) {
                // Bilinear continuous elevation interpolation (no stairs)
                val = (1 - wx) * (1 - wy) * v00 + wx * (1 - wy) * v10 + (1 - wx) * wy * v01 + wx * wy * v11;
              } else {
                const validVals = vals.filter(v => Number.isFinite(v) && v > -1000 && v < 9000);
                if (validVals.length > 0) {
                  val = validVals.reduce((a, b) => a + b, 0) / validVals.length;
                }
              }

              if (val !== undefined && Number.isFinite(val) && val > -1000 && val < 9000) {
                profile.push({
                  distance: curDist,
                  elevation: val,
                  coord: [ptLng, ptLat]
                });
              }
            }
          }
        }

        if (profile.length < 2) {
          throw new Error("Aucune valeur altimétrique valide n'intersecte la coupe tracée.");
        }

        this.profile = profile;
        this.renderChart(precisionType);
      }

      renderChart(precisionType) {
        const container = document.getElementById("profile-chart-container");
        const dock = document.getElementById("elevation-profile-dock");
        const statsBar = document.getElementById("profile-stats-bar");
        const hoverInfo = document.getElementById("profile-hover-info");
        if (!container || !dock) return;

        dock.classList.add("open");

        const elevations = this.profile.map(p => p.elevation);
        const minElev = Math.min(...elevations);
        const maxElev = Math.max(...elevations);
        const deltaElev = maxElev - minElev;
        const totalDist = this.profile[this.profile.length - 1].distance;

        const n = this.profile.length;
        const meanX = this.profile.reduce((acc, p) => acc + p.distance, 0) / n;
        const meanY = elevations.reduce((acc, e) => acc + e, 0) / n;
        let num = 0, den = 0;
        for (const p of this.profile) {
          const dx = p.distance - meanX;
          num += dx * (p.elevation - meanY);
          den += dx * dx;
        }
        const slope = den === 0 ? 0 : num / den;
        const intercept = meanY - slope * meanX;
        const slopePct = slope * 100;

        const fmt = (val) => {
          if (!Number.isFinite(val)) return "—";
          if (precisionType === "unit") return val.toFixed(0);
          if (precisionType === "decimal1") return val.toFixed(1);
          return val.toFixed(2); // Always 2 decimals by default
        };

        const distFmt = (d) => {
          return d >= 1000 ? (d / 1000).toFixed(2) + " km" : d.toFixed(0) + " m";
        };

        if (statsBar) {
          statsBar.innerHTML = `
            <span class="stat-chip">Min : <strong>${fmt(minElev)} m</strong></span>
            <span class="stat-chip">Max : <strong>${fmt(maxElev)} m</strong></span>
            <span class="stat-chip">Dénivelé &Delta; : <strong>${fmt(deltaElev)} m</strong></span>
            <span class="stat-chip">Pente moyenne : <strong>${slopePct >= 0 ? '+' : ''}${slopePct.toFixed(2)}%</strong></span>
            <span class="stat-chip">Distance totale : <strong>${distFmt(totalDist)}</strong></span>
          `;
        }

        const width = Math.max(340, container.clientWidth || 600);
        const height = Math.max(140, container.clientHeight || 150);
        const pad = { left: 52, right: 18, top: 14, bottom: 26 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const span = deltaElev || 1;

        const points = this.profile.map(p => [
          pad.left + (p.distance / totalDist) * plotW,
          pad.top + (1 - (p.elevation - minElev) / span) * plotH
        ]);

        const pathD = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
        const axisBottom = pad.top + plotH;
        const axisLeft = pad.left;

        const trendStart = intercept;
        const trendEnd = intercept + slope * totalDist;
        const trendY1 = pad.top + (1 - (trendStart - minElev) / span) * plotH;
        const trendY2 = pad.top + (1 - (trendEnd - minElev) / span) * plotH;
        const trendD = `M${pad.left.toFixed(1)} ${trendY1.toFixed(1)} L${(pad.left + plotW).toFixed(1)} ${trendY2.toFixed(1)}`;

        let gridHtml = '';
        for (let i = 0; i <= 4; i++) {
          const gx = axisLeft + (i / 4) * plotW;
          const gy = pad.top + (i / 4) * plotH;
          gridHtml += `<line class="raster-profile-grid" x1="${gx}" y1="${pad.top}" x2="${gx}" y2="${axisBottom}"/>`;
          gridHtml += `<line class="raster-profile-grid" x1="${axisLeft}" y1="${gy}" x2="${axisLeft + plotW}" y2="${gy}"/>`;
        }

        const svgHtml = `
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${gridHtml}
            <path class="raster-profile-area" d="${pathD} L ${axisLeft + plotW} ${axisBottom} L ${axisLeft} ${axisBottom} Z"/>
            <path class="raster-profile-line" d="${pathD}"/>
            <path class="raster-profile-trend" d="${trendD}"/>
            <line class="raster-profile-axis" x1="${axisLeft}" y1="${axisBottom}" x2="${axisLeft + plotW}" y2="${axisBottom}"/>
            <line class="raster-profile-axis" x1="${axisLeft}" y1="${pad.top}" x2="${axisLeft}" y2="${axisBottom}"/>
            <text class="raster-profile-axis-label" x="${axisLeft - 6}" y="${pad.top + 4}" text-anchor="end">${fmt(maxElev)} m</text>
            <text class="raster-profile-axis-label" x="${axisLeft - 6}" y="${(pad.top + plotH * 0.5 + 3).toFixed(1)}" text-anchor="end">${fmt(minElev + span * 0.5)} m</text>
            <text class="raster-profile-axis-label" x="${axisLeft - 6}" y="${axisBottom}" text-anchor="end">${fmt(minElev)} m</text>
            <text class="raster-profile-axis-label" x="${axisLeft}" y="${height - 6}" text-anchor="start">0 m</text>
            <text class="raster-profile-axis-label" x="${axisLeft + plotW}" y="${height - 6}" text-anchor="end">${distFmt(totalDist)}</text>
            <line class="raster-profile-hover-line" data-profile-hover-line x1="0" x2="0" y1="${pad.top}" y2="${axisBottom}" style="display:none;"/>
            <circle class="raster-profile-hover-dot" data-profile-hover-dot r="4.5" cx="0" cy="0" style="display:none;"/>
          </svg>
        `;

        container.innerHTML = svgHtml;

        const svg = container.querySelector("svg");
        const hoverLine = container.querySelector("[data-profile-hover-line]");
        const hoverDot = container.querySelector("[data-profile-hover-dot]");

        svg.addEventListener("mousemove", (e) => {
          const rect = svg.getBoundingClientRect();
          const clientX = e.clientX - rect.left;
          const svgX = (clientX / rect.width) * width;
          const clampedX = Math.max(pad.left, Math.min(pad.left + plotW, svgX));
          const frac = (clampedX - pad.left) / plotW;
          const idx = Math.max(0, Math.min(this.profile.length - 1, Math.round(frac * (this.profile.length - 1))));
          const pt = this.profile[idx];
          const screenPt = points[idx];

          hoverLine.style.display = "block";
          hoverDot.style.display = "block";
          hoverLine.setAttribute("x1", screenPt[0].toFixed(1));
          hoverLine.setAttribute("x2", screenPt[0].toFixed(1));
          hoverDot.setAttribute("cx", screenPt[0].toFixed(1));
          hoverDot.setAttribute("cy", screenPt[1].toFixed(1));

          this.setHoverPoint(pt.coord);
          if (hoverInfo) {
            hoverInfo.innerHTML = `Distance : <strong>${distFmt(pt.distance)}</strong> &bull; Altitude : <strong>${fmt(pt.elevation)} m</strong> &bull; Coord : ${pt.coord[1].toFixed(5)}°N, ${Math.abs(pt.coord[0]).toFixed(5)}°O`;
          }
        });

        svg.addEventListener("mouseleave", () => {
          hoverLine.style.display = "none";
          hoverDot.style.display = "none";
          this.setHoverPoint(null);
          if (hoverInfo) {
            hoverInfo.textContent = "Survolez le graphique pour explorer les altitudes le long de la coupe";
          }
        });
      }
    }

    // Sentinel-2 L2A NDVI Time Series & Layer Manager via Microsoft Planetary Computer