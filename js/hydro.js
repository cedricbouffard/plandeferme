    class ParcelHydrologyManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.enabled = false; // Désactivé par défaut
        this.cuvettesOpacity = 0.82;
        this.statusBadgeEl = document.getElementById("hydro-parcelle-status");
        this.debounceTimer = null;
        this.abortController = null;
        this.updateId = 0;
        this.cogCache = new Map();
        this.canvasCuvettes = document.createElement("canvas");
        this.ctxCuvettes = this.canvasCuvettes.getContext("2d");
        this.initMapAssets();
      }

      initMapAssets() {
        try {
          if (!this.map || !this.map.hasImage || this.map.hasImage("hydro-flow-arrow")) return;
          const size = 32;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.translate(size / 2, size / 2);
          ctx.beginPath();
          ctx.moveTo(0, -12);
          ctx.lineTo(7.5, 2);
          ctx.lineTo(3.2, 2);
          ctx.lineTo(3.2, 11);
          ctx.lineTo(-3.2, 11);
          ctx.lineTo(-3.2, 2);
          ctx.lineTo(-7.5, 2);
          ctx.closePath();
          ctx.fillStyle = "#ffffff";
          ctx.fill();

          const imgData = ctx.getImageData(0, 0, size, size);
          this.map.addImage("hydro-flow-arrow", {
            width: size,
            height: size,
            data: imgData.data
          }, { sdf: true });
        } catch (e) {
          console.warn("Could not register hydro-flow-arrow symbol:", e);
        }
      }

      setupLayers() {
        // 1. Source & Couche Raster pour les zones plates (pente < 0.1%)
        if (!this.map.getSource("hydro-cuvettes-source")) {
          const dummyCanvas = document.createElement("canvas");
          dummyCanvas.width = 1; dummyCanvas.height = 1;
          this.map.addSource("hydro-cuvettes-source", {
            type: "image",
            url: dummyCanvas.toDataURL(),
            coordinates: [[-74, 46], [-73, 46], [-73, 45], [-74, 45]]
          });
        }

        // 2. Sources GeoJSON pour flèches et axes d'écoulement
        if (!this.map.getSource("hydro-flow-arrows-source")) {
          this.map.addSource("hydro-flow-arrows-source", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });
        }
        if (!this.map.getSource("hydro-flow-lines-source")) {
          this.map.addSource("hydro-flow-lines-source", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });
        }

        const beforeLayer = this.map.getLayer("parcelles-line-bg")
          ? "parcelles-line-bg"
          : (this.map.getLayer("parcelles-fill") ? "parcelles-fill" : undefined);

        // Couche Raster des dépressions / cuvettes (au-dessus des courbes de niveau)
        if (!this.map.getLayer("hydro-cuvettes-layer")) {
          this.map.addLayer({
            id: "hydro-cuvettes-layer",
            type: "raster",
            source: "hydro-cuvettes-source",
            layout: { visibility: this.enabled ? "visible" : "none" },
            paint: {
              "raster-opacity": this.cuvettesOpacity,
              "raster-resampling": "linear",
              "raster-fade-duration": 150
            }
          }, beforeLayer);
        }

        // Axes d'écoulement concentré (thalwegs)
        if (!this.map.getLayer("hydro-flow-lines")) {
          this.map.addLayer({
            id: "hydro-flow-lines",
            type: "line",
            source: "hydro-flow-lines-source",
            layout: { visibility: this.enabled ? "visible" : "none" },
            paint: {
              "line-color": "#0284c7",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                13, 1.6,
                15, 2.8,
                18, 4.5
              ],
              "line-opacity": 0.85
            }
          }, beforeLayer);
        }

        // Flèches de direction d'écoulement (taille et couleur selon la pente)
        if (!this.map.getLayer("hydro-flow-arrows")) {
          this.map.addLayer({
            id: "hydro-flow-arrows",
            type: "symbol",
            source: "hydro-flow-arrows-source",
            layout: {
              "visibility": this.enabled ? "visible" : "none",
              "icon-image": "hydro-flow-arrow",
              "icon-size": [
                "interpolate", ["linear"], ["get", "slopePct"],
                0.8, 0.72,
                2.5, 0.88,
                5.0, 1.02,
                10.0, 1.20,
                18.0, 1.40
              ],
              "icon-rotate": ["get", "angle"],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true
            },
            paint: {
              "icon-color": [
                "interpolate", ["linear"], ["get", "slopePct"],
                0.8, "#0284c7",
                2.5, "#0369a1",
                5.0, "#1d4ed8",
                10.0, "#4338ca",
                18.0, "#6d28d9"
              ],
              "icon-halo-color": "#ffffff",
              "icon-halo-width": 1.8,
              "icon-opacity": 0.95
            }
          }, beforeLayer);
        }

        if (this.map.getLayer("hydro-accumulation-circles")) {
          this.map.removeLayer("hydro-accumulation-circles");
        }
        if (this.map.getSource("hydro-accumulation-source")) {
          this.map.removeSource("hydro-accumulation-source");
        }

        if (typeof window.bringTopLayersToFront === "function") {
          window.bringTopLayersToFront();
        }
      }

      setEnabled(val) {
        this.enabled = !!val;
        const vis = this.enabled ? "visible" : "none";
        ["hydro-cuvettes-layer", "hydro-flow-lines", "hydro-flow-arrows"].forEach(id => {
          if (this.map.getLayer(id)) {
            this.map.setLayoutProperty(id, "visibility", vis);
          }
        });
        if (this.enabled) {
          this.scheduleViewportUpdate();
        } else {
          this.clearData();
          if (this.statusBadgeEl) {
            this.statusBadgeEl.textContent = "Désactivé";
            this.statusBadgeEl.className = "contour-status-badge";
          }
        }
      }

      clear() {
        this.clearData();
        if (this.enabled) {
          this.scheduleViewportUpdate();
        } else if (this.statusBadgeEl) {
          this.statusBadgeEl.textContent = "Désactivé";
          this.statusBadgeEl.className = "contour-status-badge";
        }
      }

      clearData() {
        const emptyFC = { type: "FeatureCollection", features: [] };
        if (this.map.getSource("hydro-flow-arrows-source")) {
          this.map.getSource("hydro-flow-arrows-source").setData(emptyFC);
        }
        if (this.map.getSource("hydro-flow-lines-source")) {
          this.map.getSource("hydro-flow-lines-source").setData(emptyFC);
        }
        const cuvettesSrc = this.map.getSource("hydro-cuvettes-source");
        if (cuvettesSrc) {
          const dummy = document.createElement("canvas");
          dummy.width = 1; dummy.height = 1;
          cuvettesSrc.updateImage({
            url: dummy.toDataURL(),
            coordinates: [[-74, 46], [-73, 46], [-73, 45], [-74, 45]]
          });
        }
      }

      async getCog(url) {
        if (!this.cogCache) this.cogCache = new Map();
        if (this.cogCache.has(url)) return this.cogCache.get(url);
        const p = fromUrl(url, {}, AbortSignal.timeout(30000));
        this.cogCache.set(url, p);
        return p;
      }

      // Filtre gaussien séparable (lissage du MNE pour réduire le bruit)
      gaussianBlur(elev, W, H, sigma) {
        const size = W * H;
        const radius = Math.max(1, Math.ceil(sigma * 3));
        const kernel = new Float32Array(2 * radius + 1);
        let ksum = 0;
        for (let i = -radius; i <= radius; i++) {
          const v = Math.exp(-(i * i) / (2 * sigma * sigma));
          kernel[i + radius] = v;
          ksum += v;
        }
        for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

        const temp = new Float32Array(size);
        const result = new Float32Array(size);

        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            let acc = 0, wsum = 0;
            for (let k = -radius; k <= radius; k++) {
              const nx = x + k;
              if (nx < 0 || nx >= W) continue;
              const z = elev[y * W + nx];
              if (!Number.isFinite(z) || z <= -1000 || z >= 9000) continue;
              acc += z * kernel[k + radius];
              wsum += kernel[k + radius];
            }
            temp[y * W + x] = wsum > 0 ? acc / wsum : NaN;
          }
        }

        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            let acc = 0, wsum = 0;
            for (let k = -radius; k <= radius; k++) {
              const ny = y + k;
              if (ny < 0 || ny >= H) continue;
              const z = temp[ny * W + x];
              if (!Number.isFinite(z) || z <= -1000 || z >= 9000) continue;
              acc += z * kernel[k + radius];
              wsum += kernel[k + radius];
            }
            result[y * W + x] = wsum > 0 ? acc / wsum : NaN;
          }
        }

        return result;
      }

// Détection des dépressions par pente (zones plates : pente < 0.1%)
      computeSlopeDepressions(elev, W, H, dxMetric, dyMetric) {
        const size = W * H;
        const diff = new Float32Array(size);
        let maxDepth = 0;
        let countDepressions = 0;
        let sumDepth = 0;

        const SLOPE_THRESHOLD = 0.001; // 0.1% = 0.001 m/m
        const sigma = 3; // lissage fixe en pixels (s'adapte naturellement au zoom)

        const smoothed = this.gaussianBlur(elev, W, H, sigma);

        // Référence régionale (lissage large) pour distinguer un trou (minimum local) d'un sommet (maximum local)
        const coarseSigma = 9;
        const coarse = this.gaussianBlur(elev, W, H, coarseSigma);

        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const idx = y * W + x;
            const z = smoothed[idx];
            if (!Number.isFinite(z) || z <= -1000 || z >= 9000) continue;

            const zNW = smoothed[(y - 1) * W + (x - 1)];
            const zN  = smoothed[(y - 1) * W + x];
            const zNE = smoothed[(y - 1) * W + (x + 1)];
            const zW  = smoothed[y * W + (x - 1)];
            const zE  = smoothed[y * W + (x + 1)];
            const zSW = smoothed[(y + 1) * W + (x - 1)];
            const zS  = smoothed[(y + 1) * W + x];
            const zSE = smoothed[(y + 1) * W + (x + 1)];

            const nbrs = [zNW, zN, zNE, zW, zE, zSW, zS, zSE];
            if (nbrs.some(n => !Number.isFinite(n) || n <= -1000 || n >= 9000)) continue;

            const dzdx = ((zNW + 2 * zW + zSW) - (zNE + 2 * zE + zSE)) / (8 * dxMetric);
            const dzdy = ((zNE + 2 * zN + zNW) - (zSE + 2 * zS + zSW)) / (8 * dyMetric);
            const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy);

            if (slope < SLOPE_THRESHOLD && z <= coarse[idx]) {
              diff[idx] = slope;
              if (slope > maxDepth) maxDepth = slope;
              countDepressions++;
              sumDepth += slope;
            }
          }
        }

        return { diff, maxDepth, countDepressions, sumDepth };
      }

      // Génération du raster des dépressions (zones plates : pente < 0.1%)
      renderCuvettesCanvas(diff, W, H) {
        this.canvasCuvettes.width = W;
        this.canvasCuvettes.height = H;
        const imgData = this.ctxCuvettes.createImageData(W, H);
        const px = imgData.data;

        const SLOPE_THRESHOLD = 0.001; // 0.1%

        for (let i = 0; i < W * H; i++) {
          const pIdx = i * 4;
          const slope = diff[i];
          if (slope <= 0) {
            px[pIdx + 3] = 0;
            continue;
          }

          // Dégradé : plus la pente est faible, plus le bleu est intense
          const t = Math.min(1, slope / SLOPE_THRESHOLD); // 0 = plat, 1 = seuil
          px[pIdx] = Math.round(29 + t * (103 - 29));
          px[pIdx + 1] = Math.round(78 + t * (232 - 78));
          px[pIdx + 2] = Math.round(216 + t * (249 - 216));
          px[pIdx + 3] = Math.round(220 - t * 80);
        }

        this.ctxCuvettes.putImageData(imgData, 0, 0);
        return this.canvasCuvettes.toDataURL();
      }

      scheduleViewportUpdate() {
        if (!this.enabled || !this.map) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.updateViewport();
        }, 250);
      }

      async updateViewport() {
        if (!this.enabled || !this.map) return;
        const zoom = this.map.getZoom();
        if (zoom < 12.8) {
          if (this.statusBadgeEl) {
            this.statusBadgeEl.textContent = "Zoomer (>= 13) pour l'écoulement";
            this.statusBadgeEl.className = "contour-status-badge";
          }
          this.clearData();
          return;
        }

        this.setupLayers();
        const bounds = this.map.getBounds();
        const w = bounds.getWest();
        const s = bounds.getSouth();
        const e = bounds.getEast();
        const n = bounds.getNorth();
        const bboxWgs84 = [w, s, e, n];

        const intersecting = findTilesForBbox(w, s, e, n);
        if (intersecting.length === 0) {
          if (this.statusBadgeEl) {
            this.statusBadgeEl.textContent = "Hors couverture MNE 1m";
            this.statusBadgeEl.className = "contour-status-badge";
          }
          this.clearData();
          return;
        }

        const currentId = ++this.updateId;

        if (this.statusBadgeEl) {
          this.statusBadgeEl.textContent = "Calcul à la volée...";
          this.statusBadgeEl.className = "contour-status-badge active";
        }

        if (this.abortController) {
          this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
          const targetSize = 128;
          const region = await readMultiHrdemRegion(
            bboxWgs84,
            targetSize,
            signal,
            "bilinear"
          );

          if (currentId !== this.updateId) return;

          if (!region || !region.data || region.data.length === 0) {
            if (this.statusBadgeEl) {
              this.statusBadgeEl.textContent = "Hors emprise MNE 1m";
              this.statusBadgeEl.className = "contour-status-badge";
            }
            this.clearData();
            return;
          }

          this.processHydrology(region, bboxWgs84);
        } catch (err) {
          if (err.name === "AbortError") return;
          console.warn("Hydrology viewport update note:", err);
          if (currentId === this.updateId && this.statusBadgeEl) {
            this.statusBadgeEl.textContent = "Erreur lecture MNE 1m";
            this.statusBadgeEl.className = "contour-status-badge";
          }
        }
      }

      processHydrology(region, bboxWgs84) {
        try {
          const W = region.width;
          const H = region.height;
          const elev = region.data;
          if (!elev || elev.length === 0 || W < 4 || H < 4) {
            if (this.statusBadgeEl) {
              this.statusBadgeEl.textContent = "Données MNE insuffisantes";
              this.statusBadgeEl.className = "contour-status-badge";
            }
            this.clearData();
            return;
          }

          const sBbox = region.sourceBBox || [0, 0, W, H];
          const dxMetric = Math.max(0.1, Math.abs((sBbox[2] - sBbox[0]) / Math.max(1, W - 1)));
          const dyMetric = Math.max(0.1, Math.abs((sBbox[3] - sBbox[1]) / Math.max(1, H - 1)));
          const cellAreaMetric = dxMetric * dyMetric;

          const actualBbox = region.bboxWgs84 || bboxWgs84;
          const corners = region.cornersWgs84 || [
            [actualBbox[0], actualBbox[3]], // Top-Left (NW)
            [actualBbox[2], actualBbox[3]], // Top-Right (NE)
            [actualBbox[2], actualBbox[1]], // Bottom-Right (SE)
            [actualBbox[0], actualBbox[1]]  // Bottom-Left (SW)
          ];

          const nw = corners[0], ne = corners[1], se = corners[2], sw = corners[3];
          const wgsCoords = new Array(W * H);
          for (let y = 0; y < H; y++) {
            const v = H > 1 ? y / (H - 1) : 0;
            for (let x = 0; x < W; x++) {
              const u = W > 1 ? x / (W - 1) : 0;
              const topLng = nw[0] + u * (ne[0] - nw[0]);
              const topLat = nw[1] + u * (ne[1] - nw[1]);
              const botLng = sw[0] + u * (se[0] - sw[0]);
              const botLat = sw[1] + u * (se[1] - sw[1]);
              const lng = topLng + v * (botLng - topLng);
              const lat = topLat + v * (botLat - topLat);
              wgsCoords[y * W + x] = [lng, lat];
            }
          }

          // 1. Détection des dépressions par pente & Raster des zones plates
          const { diff, maxDepth, countDepressions, sumDepth } = this.computeSlopeDepressions(elev, W, H, dxMetric, dyMetric);
          const cuvettesDataUrl = this.renderCuvettesCanvas(diff, W, H);

          const cuvettesSrc = this.map.getSource("hydro-cuvettes-source");
          if (cuvettesSrc && cuvettesDataUrl) {
            cuvettesSrc.updateImage({
              url: cuvettesDataUrl,
              coordinates: corners
            });
          }

          // 2. Direction D8 et gradients (sur MNE lissé pour un écoulement cohérent)
          const d8dx = [1, 1, 0, -1, -1, -1, 0, 1];
          const d8dy = [0, 1, 1, 1, 0, -1, -1, -1];
          const d8dist = [
            dxMetric,
            Math.hypot(dxMetric, dyMetric),
            dyMetric,
            Math.hypot(dxMetric, dyMetric),
            dxMetric,
            Math.hypot(dxMetric, dyMetric),
            dyMetric,
            Math.hypot(dxMetric, dyMetric)
          ];
          const d8Angle = [90, 135, 180, 225, 270, 315, 0, 45];

          const flowSigma = 3;
          const elevSmooth = this.gaussianBlur(elev, W, H, flowSigma);

          const flowTarget = new Int32Array(W * H).fill(-1);
          const flowAngle = new Float32Array(W * H).fill(0);
          const flowSlope = new Float32Array(W * H).fill(0);

          for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
              const idx = y * W + x;
              const z = elevSmooth[idx];
              if (!Number.isFinite(z) || z <= -1000 || z >= 9000) continue;

              let maxDropSlope = 0;
              let bestTarget = -1;
              let bestAngle = 0;

              for (let d = 0; d < 8; d++) {
                const nx = x + d8dx[d];
                const ny = y + d8dy[d];
                const nidx = ny * W + nx;
                const nz = elevSmooth[nidx];
                if (!Number.isFinite(nz) || nz <= -1000 || nz >= 9000) continue;

                const drop = (z - nz) / d8dist[d];
                if (drop > maxDropSlope) {
                  maxDropSlope = drop;
                  bestTarget = nidx;
                  bestAngle = d8Angle[d];
                }
              }

              if (bestTarget !== -1 && maxDropSlope >= 0.001) {
                flowTarget[idx] = bestTarget;
                flowAngle[idx] = bestAngle;
                flowSlope[idx] = maxDropSlope;
              }
            }
          }

          // Flow accumulation (D8) pour identifier les thalwegs
          const cells = [];
          for (let i = 0; i < W * H; i++) {
            if (Number.isFinite(elevSmooth[i]) && elevSmooth[i] > -1000 && elevSmooth[i] < 9000) {
              cells.push(i);
            }
          }
          cells.sort((a, b) => elevSmooth[b] - elevSmooth[a]);

          const accumulation = new Int32Array(W * H).fill(1);
          for (const c of cells) {
            const tgt = flowTarget[c];
            if (tgt !== -1) {
              accumulation[tgt] += accumulation[c];
            }
          }

          // 3. Flèches de direction d'écoulement (espacées pour une lecture épurée : step = 5)
          const arrowFeatures = [];
          const step = 5;

          for (let y = 2; y < H - 2; y += step) {
            for (let x = 2; x < W - 2; x += step) {
              const idx = y * W + x;
              if (flowTarget[idx] === -1 || flowSlope[idx] < 0.001) continue;

              const slopePct = Math.round(flowSlope[idx] * 1000) / 10;

              arrowFeatures.push({
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: wgsCoords[idx]
                },
                properties: {
                  angle: flowAngle[idx],
                  slopePct: slopePct,
                  elevation: Math.round(elev[idx] * 10) / 10
                }
              });
            }
          }

          // 4. Thalwegs (axes d'écoulement concentré épurés)
          const accumThreshold = Math.max(14, Math.round(W * H * 0.0035));
          const lineFeatures = [];

          for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
              const idx = y * W + x;
              if (accumulation[idx] < accumThreshold) continue;
              const tgt = flowTarget[idx];
              if (tgt !== -1 && wgsCoords[idx] && wgsCoords[tgt]) {
                lineFeatures.push({
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: [wgsCoords[idx], wgsCoords[tgt]]
                  },
                  properties: {
                    acc: accumulation[idx]
                  }
                });
              }
            }
          }

          const arrowSrc = this.map.getSource("hydro-flow-arrows-source");
          if (arrowSrc) {
            arrowSrc.setData({
              type: "FeatureCollection",
              features: arrowFeatures
            });
          }

          const linesSrc = this.map.getSource("hydro-flow-lines-source");
          if (linesSrc) {
            linesSrc.setData({
              type: "FeatureCollection",
              features: lineFeatures
            });
          }

          const cuvetteAreaM2 = Math.round(countDepressions * cellAreaMetric);

          if (this.statusBadgeEl) {
            const cuvText = cuvetteAreaM2 > 0 ? `${cuvetteAreaM2.toLocaleString('fr-CA')} m² zones plates` : `aucune zone plate`;
            this.statusBadgeEl.textContent = `${arrowFeatures.length} flèches • ${cuvText}`;
            this.statusBadgeEl.className = "contour-status-badge active";
          }
        } catch (e) {
          console.warn("Hydrology processing note:", e);
          if (this.statusBadgeEl) {
            this.statusBadgeEl.textContent = "Erreur calcul écoulement";
            this.statusBadgeEl.className = "contour-status-badge";
          }
        }
      }
    }

    // Conversational Soil AI Assistant (Identification Guidée du Sol)