    class NdviManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.isActiveMode = false;
        this.currentLocation = null;
        this.currentParcel = null;
        this.series = [];
        this.selectedIndex = -1;
        this.selectedYear = new Date().getFullYear();
        this.tileOpacity = 0.85;
        this.stretchMin = -0.05;
        this.stretchMax = 0.85;
        this.stretchPreset = "standard";
        this.stretchDebounceTimer = null;
        this.abortController = null;
        this.marker = null;
      }

      initYearSelect() {
        const select = document.getElementById("ndvi-year-select");
        if (!select) return;
        const currentYear = new Date().getFullYear();
        select.innerHTML = "";
        for (let y = currentYear; y >= 2018; y--) {
          const opt = document.createElement("option");
          opt.value = y;
          opt.textContent = y;
          if (y === this.selectedYear) opt.selected = true;
          select.appendChild(opt);
        }
      }

      setStretchRange(minVal, maxVal, preset = "custom") {
        this.stretchMin = Math.max(-0.5, Math.min(0.9, minVal));
        this.stretchMax = Math.max(this.stretchMin + 0.05, Math.min(1.0, maxVal));
        this.stretchPreset = preset;
        this.syncStretchUi();
        this.scheduleTileUpdate();
      }

      applyStretchPreset(presetName) {
        this.stretchPreset = presetName;
        const currentSample = (this.selectedIndex >= 0 && this.series[this.selectedIndex])
          ? this.series[this.selectedIndex].ndvi
          : 0.5;

        switch (presetName) {
          case "standard":
            this.stretchMin = -0.05;
            this.stretchMax = 0.85;
            break;
          case "contrast":
            this.stretchMin = 0.25;
            this.stretchMax = 0.85;
            break;
          case "dense":
            this.stretchMin = 0.50;
            this.stretchMax = 0.90;
            break;
          case "emergence":
            this.stretchMin = 0.00;
            this.stretchMax = 0.45;
            break;
          case "auto":
            this.stretchMin = Math.max(-0.1, Math.round((currentSample - 0.18) * 20) / 20);
            this.stretchMax = Math.min(1.0, Math.round((currentSample + 0.18) * 20) / 20);
            if (this.stretchMax - this.stretchMin < 0.15) {
              this.stretchMax = Math.min(1.0, this.stretchMin + 0.20);
            }
            break;
          default:
            break;
        }
        this.syncStretchUi();
        this.scheduleTileUpdate();
      }

      syncStretchUi() {
        const presetSelect = document.getElementById("ndvi-stretch-preset");
        const sliderMin = document.getElementById("ndvi-stretch-min");
        const sliderMax = document.getElementById("ndvi-stretch-max");
        const valMin = document.getElementById("ndvi-stretch-min-val");
        const valMax = document.getElementById("ndvi-stretch-max-val");
        const legendLabel = document.getElementById("ndvi-legend-stretch-label");
        const customBox = document.getElementById("ndvi-custom-sliders-box");

        if (presetSelect) presetSelect.value = this.stretchPreset;
        if (sliderMin) sliderMin.value = Math.round(this.stretchMin * 100);
        if (sliderMax) sliderMax.value = Math.round(this.stretchMax * 100);
        if (valMin) valMin.textContent = this.stretchMin.toFixed(2);
        if (valMax) valMax.textContent = this.stretchMax.toFixed(2);
        if (legendLabel) {
          legendLabel.textContent = `${this.stretchMin.toFixed(2)} → ${this.stretchMax.toFixed(2)}`;
        }
        if (customBox) {
          customBox.style.display = (this.stretchPreset === "custom") ? "flex" : "none";
        }
      }

      scheduleTileUpdate() {
        if (this.stretchDebounceTimer) clearTimeout(this.stretchDebounceTimer);
        this.stretchDebounceTimer = setTimeout(() => {
          if (this.selectedIndex >= 0 && this.series[this.selectedIndex]) {
            const scene = this.series[this.selectedIndex];
            this.displayNdviLayer(scene.id, scene.ndvi);
          }
        }, 120);
      }

      getSclLabel(scl) {
        switch (Math.round(scl)) {
          case 4: return "Végétation";
          case 5: return "Sol nu";
          case 6: return "Eau";
          case 2: return "Surface sombre";
          case 7: return "Non classifié";
          case 3: return "Ombre de nuage";
          case 8: return "Nuage (prob. moy.)";
          case 9: return "Nuage (prob. forte)";
          case 10: return "Cirrus fin";
          case 11: return "Neige / Glace";
          default: return `Classe ${scl}`;
        }
      }

      setMode(active) {
        this.isActiveMode = active;
        const btn = document.getElementById("btn-quick-ndvi");
        if (btn) {
          btn.classList.toggle("active", active);
        }
        const mobileNdviBtn = document.getElementById("mobile-btn-ndvi");
        if (mobileNdviBtn) {
          mobileNdviBtn.classList.toggle("active", active);
        }
        const mobileBtnTools = document.getElementById("mobile-btn-tools");
        if (mobileBtnTools) {
          mobileBtnTools.classList.toggle("active", active);
        }
        const mobileToolNdviBadge = document.getElementById("mobile-tool-ndvi-badge");
        if (mobileToolNdviBadge) {
          mobileToolNdviBadge.style.display = active ? "inline-block" : "none";
        }
        if (active) {
          if (window.measureManager && window.measureManager.isActive) {
            window.measureManager.deactivate();
          }
          if (profileManager && profileManager.isDrawing) {
            profileManager.stopDrawing();
          }
          this.map.getCanvas().style.cursor = "crosshair";
        } else {
          this.map.getCanvas().style.cursor = "";
        }
        if (typeof updateUrl === "function") {
          updateUrl();
        }
      }

      toggleMode() {
        this.setMode(!this.isActiveMode);
      }

      async analyzeLocation(lngLat, parcelProps = null, year = null) {
        if (this.abortController) {
          this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        this.currentLocation = lngLat;
        this.currentParcel = parcelProps;
        this.series = [];
        this.selectedIndex = -1;

        if (year !== null) {
          this.selectedYear = parseInt(year, 10);
        } else {
          const yearSelect = document.getElementById("ndvi-year-select");
          if (yearSelect && yearSelect.value) {
            this.selectedYear = parseInt(yearSelect.value, 10);
          }
        }
        const yearSelect = document.getElementById("ndvi-year-select");
        if (yearSelect) yearSelect.value = this.selectedYear;

        if (this.marker) this.marker.remove();
        const el = document.createElement("div");
        el.className = "ndvi-target-marker";
        el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="#16a34a" fill-opacity="0.3" stroke="#16a34a" stroke-width="2.5"/><circle cx="12" cy="12" r="3" fill="#ffffff" stroke="#15803d" stroke-width="2"/></svg>`;
        this.marker = new maplibregl.Marker({ element: el })
          .setLngLat([lngLat.lng, lngLat.lat])
          .addTo(this.map);

        const dock = document.getElementById("ndvi-dock");
        const titleEl = document.getElementById("ndvi-dock-title");
        const statsBar = document.getElementById("ndvi-stats-bar");
        const container = document.getElementById("ndvi-chart-container");
        const controlsRow = document.getElementById("ndvi-active-controls");

        if (dock) {
          dock.classList.add("open");
          dock.classList.remove("collapsed");
          this.isCollapsed = false;
        }
        if (controlsRow) controlsRow.style.display = "none";

        const pid = parcelProps ? (parcelProps.IDPAR || parcelProps.idpar || "") : "";
        const crop = parcelProps ? (parcelProps.DESCODPR1 || parcelProps.descodpr1 || "") : "";

        if (titleEl) {
          titleEl.textContent = pid 
            ? `Série NDVI ${this.selectedYear} (mars–déc.) — Parcelle nº ${pid}${crop ? ` (${crop})` : ''}`
            : `Série NDVI ${this.selectedYear} (mars–déc.) — Point [${lngLat.lat.toFixed(4)}°N, ${Math.abs(lngLat.lng).toFixed(4)}°O]`;
        }

        if (statsBar) {
          statsBar.innerHTML = `<span class="stat-chip">Recherche des scènes Sentinel-2 L2A pour la saison ${this.selectedYear} (mars &rarr; déc.)...</span>`;
        }
        if (container) {
          container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:160px; color:#64748b; font-size:12px; gap:8px;">
              <div style="width:24px; height:24px; border:2.5px solid #cbd5e1; border-top-color:#16a34a; border-radius:50%; animation: spin 0.8s linear infinite;"></div>
              <span>Interrogation du catalogue Sentinel-2 (Planetary Computer) pour la saison ${this.selectedYear}...</span>
            </div>
          `;
        }

        try {
          const yr = this.selectedYear;
          const startDt = `${yr}-03-01T00:00:00Z`;
          const decEnd = new Date(Date.UTC(yr, 11, 1, 23, 59, 59));
          const now = new Date();
          const endDt = (yr === now.getUTCFullYear() && now < decEnd)
            ? now.toISOString()
            : `${yr}-12-01T23:59:59Z`;
          const dtStr = `${startDt}/${endDt}`;

          const stacBody = {
            collections: ["sentinel-2-l2a"],
            intersects: {
              type: "Point",
              coordinates: [lngLat.lng, lngLat.lat]
            },
            datetime: dtStr,
            query: {
              "eo:cloud_cover": { lt: 65 }
            },
            limit: 100,
            sortby: [{ field: "datetime", direction: "asc" }]
          };

          const stacResp = await fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stacBody),
            signal
          });

          if (!stacResp.ok) throw new Error(`Erreur STAC (${stacResp.status})`);
          const stacData = await stacResp.json();
          const items = stacData.features || [];

          if (items.length === 0) {
            if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucune scène Sentinel-2 trouvée pour la saison ${yr} (mars à déc.).</span>`;
            if (container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">Aucune donnée satellite disponible pour cette année. Essayez une autre année dans le sélecteur ci-dessus.</div>`;
            return;
          }

          const byDate = new Map();
          for (const item of items) {
            const dt = item.properties.datetime;
            const dateKey = dt.split("T")[0];
            const cloud = item.properties["eo:cloud_cover"] || 0;
            if (!byDate.has(dateKey) || byDate.get(dateKey).properties["eo:cloud_cover"] > cloud) {
              byDate.set(dateKey, item);
            }
          }

          const uniqueItems = Array.from(byDate.values()).sort((a, b) => 
            new Date(a.properties.datetime) - new Date(b.properties.datetime)
          );

          if (statsBar) {
            statsBar.innerHTML = `<span class="stat-chip">${uniqueItems.length} passages candidats (${yr}) • Filtrage nuages SCL en cours (0/${uniqueItems.length})...</span>`;
          }

          const sampled = [];
          let cloudFilteredCount = 0;
          const batchSize = 6;
          let completed = 0;

          for (let i = 0; i < uniqueItems.length; i += batchSize) {
            if (signal.aborted) return;
            const batch = uniqueItems.slice(i, i + batchSize);
            const batchPromises = batch.map(async (scene) => {
              const itemId = scene.id;
              const pUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/point/${lngLat.lng.toFixed(5)},${lngLat.lat.toFixed(5)}?collection=sentinel-2-l2a&item=${itemId}&assets=B04&assets=B08&assets=SCL`;
              try {
                const pResp = await fetch(pUrl, { signal });
                if (!pResp.ok) return null;
                const pData = await pResp.json();
                const vals = pData.values || [];
                if (vals.length >= 3) {
                  const b4 = vals[0];
                  const b8 = vals[1];
                  const scl = vals[2];
                  
                  // Classification SCL Sentinel-2:
                  // 0: No Data, 1: Saturated/Defective, 2: Dark, 3: Cloud Shadow
                  // 4: Vegetation, 5: Not Vegetated (sol nu), 6: Water, 7: Unclassified
                  // 8: Cloud Med Prob, 9: Cloud High Prob, 10: Cirrus, 11: Snow/Ice
                  const isCloudOrSnow = [0, 1, 3, 8, 9, 10, 11].includes(Math.round(scl));
                  if (isCloudOrSnow) {
                    return { isCloud: true, scl };
                  }

                  if (b8 + b4 > 0) {
                    const ndvi = (b8 - b4) / (b8 + b4);
                    if (Number.isFinite(ndvi) && ndvi >= -0.15 && ndvi <= 1.0) {
                      return {
                        id: itemId,
                        datetime: scene.properties.datetime,
                        dateKey: scene.properties.datetime.split("T")[0],
                        ndvi,
                        b4,
                        b8,
                        scl,
                        cloud: scene.properties["eo:cloud_cover"] || 0,
                        platform: scene.properties["platform"] || "Sentinel-2"
                      };
                    }
                  }
                }
              } catch (e) {
                if (e.name === 'AbortError') throw e;
              }
              return null;
            });

            const batchResults = await Promise.all(batchPromises);
            for (const r of batchResults) {
              if (r) {
                if (r.isCloud) {
                  cloudFilteredCount++;
                } else {
                  sampled.push(r);
                }
              }
            }
            completed += batch.length;
            if (statsBar) {
              statsBar.innerHTML = `<span class="stat-chip">Filtrage des nuages SCL (${Math.min(completed, uniqueItems.length)}/${uniqueItems.length}) • ${sampled.length} retenus, ${cloudFilteredCount} nuageux...</span>`;
            }
          }

          sampled.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
          this.series = sampled;

          if (this.series.length === 0) {
            if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucune date sans nuage pour la saison ${yr} (${cloudFilteredCount} passages éliminés par le masque SCL).</span>`;
            if (container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">Tous les passages satellites de ${yr} étaient couverts de nuages ou de neige. Sélectionnez une autre année ci-dessus.</div>`;
            return;
          }

          const ndviVals = this.series.map(s => s.ndvi);
          const maxNdvi = Math.max(...ndviVals);
          const minNdvi = Math.min(...ndviVals);
          const latest = this.series[this.series.length - 1];
          const peakIdx = ndviVals.indexOf(maxNdvi);

          if (statsBar) {
            const peakDate = this.series[peakIdx].dateKey.split("-");
            const mNames = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
            const mIdx = parseInt(peakDate[1], 10) - 1;
            const peakStr = (mIdx >= 0 && mIdx < 12) ? `${parseInt(peakDate[2], 10)} ${mNames[mIdx]}` : this.series[peakIdx].dateKey;
            statsBar.innerHTML = `
              <span class="stat-chip">Saison <strong>${yr}</strong></span>
              <span class="stat-chip" style="background:#dcfce7; border-color:#86efac; color:#14532d;">Pic estival : <strong>${maxNdvi.toFixed(2)}</strong> (${peakStr})</span>
              <span class="stat-chip">Dernier NDVI : <strong>${latest.ndvi.toFixed(2)}</strong></span>
              <span class="stat-chip">Observations claires : <strong>${this.series.length} dates</strong></span>
              ${cloudFilteredCount > 0 ? `<span class="stat-chip" style="color:#64748b;" title="Passages éliminés car sous un nuage, une ombre ou de la neige">${cloudFilteredCount} nuageux filtrés</span>` : ''}
            `;
          }

          const defaultSelectIdx = peakIdx >= 0 ? peakIdx : this.series.length - 1;
          this.renderChart(defaultSelectIdx);
          this.selectDate(defaultSelectIdx);

        } catch (err) {
          if (err.name === 'AbortError') return;
          console.error("NDVI analysis error:", err);
          if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Erreur lors de la récupération des données Sentinel-2 : ${err.message}</span>`;
        }
      }

      selectDate(index, skipRender = false) {
        if (index < 0 || index >= this.series.length) return;
        this.selectedIndex = index;
        const scene = this.series[index];

        const controlsRow = document.getElementById("ndvi-active-controls");
        const badge = document.getElementById("ndvi-selected-date-badge");
        const btnPrev = document.getElementById("btn-ndvi-prev");
        const btnNext = document.getElementById("btn-ndvi-next");

        if (controlsRow) controlsRow.style.display = "flex";
        if (badge) {
          const parts = scene.dateKey.split("-");
          const mNames = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
          const mIdx = parseInt(parts[1], 10) - 1;
          const niceDate = (mIdx >= 0 && mIdx < 12) ? `${parseInt(parts[2], 10)} ${mNames[mIdx]} ${parts[0]}` : scene.dateKey;
          badge.innerHTML = `<strong>${niceDate}</strong> &bull; NDVI : <strong style="color:#15803d;">${scene.ndvi.toFixed(2)}</strong> <span class="stat-chip" style="margin-left:4px;font-size:10px;padding:1px 5px;background:#dcfce7;color:#14532d;border-color:#86efac;">${this.getSclLabel(scene.scl)}</span> <span style="color:#64748b;font-size:10.5px;margin-left:3px;" title="Couverture nuageuse de la scène : ${scene.cloud.toFixed(1)}% (${scene.platform})">(${scene.cloud.toFixed(0)}% nuages)</span>`;
        }
        if (btnPrev) btnPrev.disabled = (index <= 0);
        if (btnNext) btnNext.disabled = (index >= this.series.length - 1);

        const collapsedSummary = document.getElementById("ndvi-collapsed-summary");
        if (collapsedSummary) {
          collapsedSummary.textContent = `${scene.dateKey} • NDVI : ${scene.ndvi.toFixed(3)}`;
        }

        if (!skipRender) {
          this.renderChart(index, true);
        }

        if (this.stretchPreset === "auto") {
          const currentSample = scene.ndvi;
          this.stretchMin = Math.max(-0.1, Math.round((currentSample - 0.18) * 20) / 20);
          this.stretchMax = Math.min(1.0, Math.round((currentSample + 0.18) * 20) / 20);
          if (this.stretchMax - this.stretchMin < 0.15) {
            this.stretchMax = Math.min(1.0, this.stretchMin + 0.20);
          }
          this.syncStretchUi();
        } else {
          this.syncStretchUi();
        }

        this.displayNdviLayer(scene.id, scene.ndvi);
      }

      displayNdviLayer(sceneId, sampleNdvi) {
        const minVal = this.stretchMin;
        const maxVal = this.stretchMax;
        const rescaleStr = `${minVal.toFixed(2)},${maxVal.toFixed(2)}`;
        const tileUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a&item=${sceneId}&assets=B08&assets=B04&asset_as_band=True&expression=%28B08-B04%29%2F%28B08%2BB04%29&rescale=${encodeURIComponent(rescaleStr)}&colormap_name=rdylgn`;

        if (this.map.getLayer("sentinel2-ndvi-layer")) {
          this.map.removeLayer("sentinel2-ndvi-layer");
        }
        if (this.map.getSource("sentinel2-ndvi-source")) {
          this.map.removeSource("sentinel2-ndvi-source");
        }

        this.map.addSource("sentinel2-ndvi-source", {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          attribution: "Sentinel-2 L2A © ESA / Copernicus • Microsoft Planetary Computer"
        });

        const beforeLayer = this.map.getLayer("parcelles-line-bg") ? "parcelles-line-bg" : (this.map.getLayer("parcelles-fill") ? "parcelles-fill" : undefined);
        this.map.addLayer({
          id: "sentinel2-ndvi-layer",
          type: "raster",
          source: "sentinel2-ndvi-source",
          paint: {
            "raster-opacity": this.tileOpacity,
            "raster-resampling": "linear",
            "raster-fade-duration": 180
          }
        }, beforeLayer);
      }

      setTileOpacity(val) {
        this.tileOpacity = val;
        if (this.map.getLayer("sentinel2-ndvi-layer")) {
          this.map.setPaintProperty("sentinel2-ndvi-layer", "raster-opacity", val);
        }
      }

      clearLayer() {
        if (this.map.getLayer("sentinel2-ndvi-layer")) {
          this.map.removeLayer("sentinel2-ndvi-layer");
        }
        if (this.map.getSource("sentinel2-ndvi-source")) {
          this.map.removeSource("sentinel2-ndvi-source");
        }
        const controlsRow = document.getElementById("ndvi-active-controls");
        if (controlsRow) controlsRow.style.display = "none";
      }

      toggleCollapse() {
        const dock = document.getElementById("ndvi-dock");
        if (!dock) return;
        dock.classList.toggle("collapsed");
        this.isCollapsed = dock.classList.contains("collapsed");
        if (!this.isCollapsed && this.series && this.series.length) {
          setTimeout(() => {
            this.renderChart(this.selectedIndex);
          }, 60);
        }
      }

      closeDock() {
        if (this.abortController) this.abortController.abort();
        const dock = document.getElementById("ndvi-dock");
        if (dock) {
          dock.classList.remove("open");
          dock.classList.remove("collapsed");
        }
        this.isCollapsed = false;
        this.clearLayer();
        if (this.marker) {
          this.marker.remove();
          this.marker = null;
        }
        this.setMode(false);
      }

      renderChart(activeIndex = -1, fromSelectDate = false) {
        const container = document.getElementById("ndvi-chart-container");
        if (!container || !this.series.length) return;

        const width = Math.max(340, container.clientWidth || 600);
        const height = 195;
        const pad = { top: 22, right: 30, bottom: 44, left: 44 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        // Ancrage fixe sur la saison de croissance au Québec : 1er mars au 1er décembre
        const seasonStart = new Date(Date.UTC(this.selectedYear, 2, 1, 0, 0, 0)).getTime();
        const seasonEnd = new Date(Date.UTC(this.selectedYear, 11, 1, 23, 59, 59)).getTime();
        const timeSpan = Math.max(1, seasonEnd - seasonStart);

        const getY = (val) => {
          const clamped = Math.max(-0.1, Math.min(1.0, val));
          return pad.top + plotH * (1 - (clamped - (-0.1)) / 1.1);
        };

        const getX = (dtStr) => {
          const t = new Date(dtStr).getTime();
          return pad.left + Math.max(0, Math.min(plotW, ((t - seasonStart) / timeSpan) * plotW));
        };

        const y1_0 = getY(1.0);
        const y0_6 = getY(0.6);
        const y0_4 = getY(0.4);
        const y0_2 = getY(0.2);
        const y0_0 = getY(0.0);

        let bandsHtml = `
          <rect x="${pad.left}" y="${y1_0}" width="${plotW}" height="${y0_6 - y1_0}" fill="rgba(34, 197, 94, 0.12)" />
          <rect x="${pad.left}" y="${y0_6}" width="${plotW}" height="${y0_4 - y0_6}" fill="rgba(132, 204, 22, 0.10)" />
          <rect x="${pad.left}" y="${y0_4}" width="${plotW}" height="${y0_2 - y0_4}" fill="rgba(234, 179, 8, 0.10)" />
          <rect x="${pad.left}" y="${y0_2}" width="${plotW}" height="${y0_0 - y0_2}" fill="rgba(239, 68, 68, 0.10)" />
        `;

        const yTicks = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
        let yAxisHtml = "";
        for (const tick of yTicks) {
          const ty = getY(tick);
          yAxisHtml += `
            <line x1="${pad.left}" y1="${ty.toFixed(1)}" x2="${pad.left + plotW}" y2="${ty.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.8" stroke-dasharray="2 3" />
            <text x="${pad.left - 7}" y="${(ty + 3.5).toFixed(1)}" fill="#64748b" font-size="10" font-weight="600" text-anchor="end" font-family="var(--font-mono, monospace)">${tick.toFixed(1)}</text>
          `;
        }

        // Ticks mensuels pour la saison québécoise (mars à décembre)
        const mNames = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
        let xAxisHtml = "";
        for (let m = 2; m <= 11; m++) {
          const mDate = new Date(Date.UTC(this.selectedYear, m, 1)).getTime();
          if (mDate >= seasonStart && mDate <= seasonEnd) {
            const x = pad.left + ((mDate - seasonStart) / timeSpan) * plotW;
            xAxisHtml += `
              <line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
              <line x1="${x.toFixed(1)}" y1="${pad.top + plotH}" x2="${x.toFixed(1)}" y2="${pad.top + plotH + 5}" stroke="#94a3b8" stroke-width="1.2" />
              <text x="${x.toFixed(1)}" y="${pad.top + plotH + 18}" fill="#334155" font-size="11" font-weight="600" text-anchor="middle" font-family="sans-serif">${mNames[m]}</text>
            `;
          }
        }

        // Active selected date marker & label
        let activeDateMarkerHtml = "";
        if (activeIndex >= 0 && activeIndex < this.series.length) {
          const actItem = this.series[activeIndex];
          const actX = getX(actItem.datetime);
          const parts = actItem.dateKey.split("-");
          const mLabel = mNames[parseInt(parts[1], 10) - 1] || parts[1];
          const displayDateStr = `${parseInt(parts[2], 10)} ${mLabel}`;
          activeDateMarkerHtml = `
            <line x1="${actX.toFixed(1)}" y1="${pad.top}" x2="${actX.toFixed(1)}" y2="${pad.top + plotH}" stroke="#0f172a" stroke-width="1.5" stroke-dasharray="3 3" />
            <rect x="${(actX - 32).toFixed(1)}" y="${(pad.top + plotH + 24).toFixed(1)}" width="64" height="18" rx="4" fill="#0f172a" />
            <text x="${actX.toFixed(1)}" y="${(pad.top + plotH + 37).toFixed(1)}" fill="#ffffff" font-size="10.5" font-weight="700" text-anchor="middle" font-family="sans-serif">${displayDateStr}</text>
          `;
        }

        const coords = this.series.map(s => [getX(s.datetime), getY(s.ndvi)]);
        let pathD = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
        for (let i = 1; i < coords.length; i++) {
          pathD += ` L ${coords[i][0].toFixed(1)} ${coords[i][1].toFixed(1)}`;
        }

        const areaD = `${pathD} L ${coords[coords.length - 1][0].toFixed(1)} ${getY(0.0).toFixed(1)} L ${coords[0][0].toFixed(1)} ${getY(0.0).toFixed(1)} Z`;

        let pointsHtml = "";
        this.series.forEach((s, idx) => {
          const cx = coords[idx][0].toFixed(1);
          const cy = coords[idx][1].toFixed(1);
          const isAct = (idx === activeIndex);
          let color = "#16a34a";
          if (s.ndvi < 0.2) color = "#dc2626";
          else if (s.ndvi < 0.4) color = "#d97706";
          else if (s.ndvi < 0.6) color = "#65a30d";

          pointsHtml += `
            <circle class="ndvi-chart-point ${isAct ? 'active-point' : ''}" 
                    data-idx="${idx}" 
                    cx="${cx}" 
                    cy="${cy}" 
                    r="${isAct ? 7.5 : 5}" 
                    fill="${color}" 
                    stroke="#ffffff" 
                    stroke-width="${isAct ? 2.5 : 1.8}" />
          `;
        });

        const svgHtml = `
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${bandsHtml}
            ${yAxisHtml}
            ${xAxisHtml}
            ${activeDateMarkerHtml}
            <path d="${areaD}" fill="rgba(22, 163, 74, 0.12)" />
            <path d="${pathD}" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            ${pointsHtml}
          </svg>
        `;

        container.innerHTML = svgHtml;

        const circles = container.querySelectorAll(".ndvi-chart-point");
        const hoverInfo = document.getElementById("ndvi-hover-info");

        circles.forEach(circle => {
          circle.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = parseInt(circle.dataset.idx, 10);
            this.selectDate(idx);
          });

          circle.addEventListener("mouseenter", () => {
            const idx = parseInt(circle.dataset.idx, 10);
            const item = this.series[idx];
            if (hoverInfo) {
              hoverInfo.innerHTML = `<strong>${item.dateKey}</strong> &bull; NDVI : <strong>${item.ndvi.toFixed(3)}</strong> &bull; SCL : <strong>${this.getSclLabel(item.scl)}</strong> &bull; Nuages scène : ${item.cloud.toFixed(1)}% &bull; Cliquez pour afficher la tuile satellite sur la carte`;
            }
          });

          circle.addEventListener("mouseleave", () => {
            if (hoverInfo) {
              hoverInfo.textContent = "Cliquez sur une date ci-dessus pour afficher la tuile satellite NDVI correspondante sur la carte";
            }
          });
        });

        if (!this._resizeAttached) {
          this._resizeAttached = true;
          window.addEventListener("resize", () => {
            if (this.series && this.series.length && !this.isCollapsed) {
              this.renderChart(this.selectedIndex);
            }
          });
        }
      }
    }

    // BDPPAD FlatGeobuf Crop History Loader (2003-2026)
    async function loadCropHistory(lngLat, popupDom, parcelProps = null) {
      const container = popupDom ? popupDom.querySelector(".popup-crop-history") : null;
      if (!container) return;

      const badgeEl = container.querySelector(".crop-history-badge");
      const contentEl = container.querySelector(".crop-history-content");

      let fgb = (typeof window.flatgeobuf !== "undefined" ? window.flatgeobuf : null)
        || (typeof flatgeobuf !== "undefined" ? flatgeobuf : null);

      if (!fgb || (!fgb.deserialize && (!fgb.geojson || !fgb.geojson.deserialize))) {
        // Wait up to 1200ms in case script tag is still executing
        for (let retry = 0; retry < 6; retry++) {
          await new Promise(r => setTimeout(r, 200));
          fgb = (typeof window.flatgeobuf !== "undefined" ? window.flatgeobuf : null)
            || (typeof flatgeobuf !== "undefined" ? flatgeobuf : null);
          if (fgb && (typeof fgb.deserialize === "function" || (fgb.geojson && typeof fgb.geojson.deserialize === "function"))) {
            break;
          }
        }
      }

      const getDeserializeFn = () => {
        if (!fgb) return null;
        if (typeof fgb.deserialize === "function") return fgb.deserialize.bind(fgb);
        if (fgb.geojson && typeof fgb.geojson.deserialize === "function") return fgb.geojson.deserialize.bind(fgb.geojson);
        return null;
      };

      const deserialize = getDeserializeFn();
      if (!deserialize) {
        if (badgeEl) {
          badgeEl.textContent = "Non disponible";
          badgeEl.style.background = "#f1f5f9";
          badgeEl.style.color = "#64748b";
        }
        if (contentEl) contentEl.innerHTML = `<span style="color:#64748b; font-size:11px;">Module FlatGeobuf non disponible dans le navigateur.</span>`;
        return;
      }

      const url = "https://storage.googleapis.com/geoqc/BDPPAD/bdppad.fgb";
      const delta = 0.00015;
      const bbox = {
        minX: lngLat.lng - delta,
        minY: lngLat.lat - delta,
        maxX: lngLat.lng + delta,
        maxY: lngLat.lat + delta
      };

      try {
        const iter = deserialize(url, bbox);
        const candidatesByYear = new Map();
        const pt = [lngLat.lng, lngLat.lat];

        for await (const feature of iter) {
          if (!feature || !feature.properties) continue;

          const props = feature.properties;
          const yr = props.annee ?? props.ANNEE ?? props.year ?? props.YEAR ?? props.an ?? props.AN;
          const rawCrop = props.DESGROPRO ?? props.desgropro ?? props.DESCODPR1 ?? props.descodpr1 ?? props.culture ?? props.CULTURE ?? props.crop ?? props.CROP ?? "";
          const crop = String(rawCrop).trim();

          if (yr !== undefined && yr !== null && yr !== "") {
            const yrInt = Math.round(Number(yr));
            if (!isNaN(yrInt) && yrInt >= 1990 && yrInt <= 2035) {
              const inside = isPointInGeom(pt, feature.geometry);
              const hasNamedCrop = Boolean(crop && crop.toLowerCase() !== "inconnu" && crop.toLowerCase() !== "non déclaré" && crop.toLowerCase() !== "non declare");
              let score = (inside ? 100 : 20) + (hasNamedCrop ? 150 : 0);

              const existing = candidatesByYear.get(yrInt);
              if (!existing || score > existing.score) {
                candidatesByYear.set(yrInt, {
                  year: yrInt,
                  crop: crop || "Culture non déclarée",
                  score: score
                });
              }
            }
          }
        }

        const sorted = Array.from(candidatesByYear.values()).sort((a, b) => b.year - a.year);
        if (sorted.length === 0) {
          if (badgeEl) {
            badgeEl.textContent = "0 trouvée";
            badgeEl.style.background = "#f1f5f9";
            badgeEl.style.color = "#64748b";
          }
          if (contentEl) contentEl.innerHTML = `<div style="color:#64748b; font-style:italic; padding:3px 0;">Aucune déclaration historique trouvée sous ce point.</div>`;
          return;
        }

        if (badgeEl) {
          badgeEl.textContent = `${sorted.length} saisons`;
          badgeEl.style.background = "#e0f2fe";
          badgeEl.style.color = "#0369a1";
        }
        let rowsHtml = '<div class="crop-history-list">';
        for (const item of sorted) {
          let badgeColor = "#0284c7";
          let badgeBg = "#e0f2fe";
          const cLower = item.crop.toLowerCase();
          if (cLower.includes("maïs") || cLower.includes("mais")) {
            badgeColor = "#854d0e"; badgeBg = "#fefce8";
          } else if (cLower.includes("soya")) {
            badgeColor = "#15803d"; badgeBg = "#dcfce7";
          } else if (cLower.includes("blé") || cLower.includes("ble") || cLower.includes("orge") || cLower.includes("avoine") || cLower.includes("céréale") || cLower.includes("cereale") || cLower.includes("triticale") || cLower.includes("épeautre") || cLower.includes("canola")) {
            badgeColor = "#b45309"; badgeBg = "#fffbeb";
          } else if (cLower.includes("foin") || cLower.includes("prairie") || cLower.includes("pâturage") || cLower.includes("paturage") || cLower.includes("fourrag")) {
            badgeColor = "#047857"; badgeBg = "#ecfdf5";
          } else if (cLower.includes("inconnu") || cLower.includes("non déclaré") || cLower.includes("non declare")) {
            badgeColor = "#64748b"; badgeBg = "#f1f5f9";
          }
          rowsHtml += `
            <div class="crop-history-item">
              <span style="font-weight:700; color:#334155; font-family:var(--font-mono, monospace);">${item.year}</span>
              <span style="font-weight:600; color:${badgeColor}; background:${badgeBg}; padding:1.5px 6px; border-radius:4px;">${item.crop}</span>
            </div>
          `;
        }
        rowsHtml += '</div>';
        if (contentEl) contentEl.innerHTML = rowsHtml;
      } catch (err) {
        console.warn("FGB crop history query note:", err);
        if (badgeEl) {
          badgeEl.textContent = "Non disponible";
          badgeEl.style.background = "#f1f5f9";
          badgeEl.style.color = "#64748b";
        }
        if (contentEl) {
          const pf = parcelProps || {};
          const currentCrop = pf.DESCODPR1 || pf.descodpr1 || "";
          const currentGroup = pf.DESGROPRO || pf.desgropro || "";
          contentEl.innerHTML = `
            <div style="font-size: 11px; color: #64748b; line-height: 1.45; padding: 2px 0;">
              ${currentCrop ? `
                <div style="margin-bottom: 6px; padding: 5px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                  <span>Saison déclarée 2026 :</span>
                  <strong style="color: #0f172a;">${currentCrop}${currentGroup ? ` (${currentGroup})` : ''}</strong>
                </div>` : ''}
              <em>Historique pluriannuel (2003–2025) non accessible directement : requêtes HTTP Range partielles non autorisées par la politique CORS du stockage GCS distant (bdppad.fgb).</em>
            </div>
          `;
        }
      }
    }

    // Gestionnaire de l'hydrologie (écoulement à la volée & raster des zones plates par pente < 0.1%)