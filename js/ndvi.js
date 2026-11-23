/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
    // Indices offerts. Optique : NDVI et EVI. Radar (Sentinel-1, bandes VV et VH) : indice de végétation radar,
    // rapport VH/VV et pseudo-entropie. Tous se lisent entre 0 et 1 environ, sur le même graphique.
    //   range : bornes du nuancier « standard » de la tuile
    const NDVI_INDICES = {
      ndvi: { key: "ndvi", label: "NDVI", range: [-0.05, 0.85], legend: "ndvi", title: "Indice de végétation par différence normalisée : (PIR − rouge) / (PIR + rouge)" },
      evi: { key: "evi", label: "EVI", range: [-0.05, 0.75], legend: "evi", title: "Indice de végétation amélioré : 2,5 × (PIR − rouge) / (PIR + 6 × rouge − 7,5 × bleu + 1). Sature moins que le NDVI sur une végétation dense." },
      rvi: { key: "rvi", label: "RVI", range: [0.1, 1.0], legend: "radar", title: "Indice de végétation radar : 4 × VH / (VV + VH). Augmente avec le volume de végétation ; insensible aux nuages." },
      ratio: { key: "ratio", label: "VH/VV", range: [0.05, 0.5], legend: "radar", title: "Rapport de polarisation croisée VH / VV : augmente quand le couvert se développe." },
      ang: { key: "ang", label: "Diversité angulaire", range: [0, 0.4], legend: "radar", noTile: true, title: "Écart de VV entre deux orbites, donc deux angles de visée, à quelques jours d'intervalle : |VV₁ − VV₂| / (VV₁ + VV₂). Élevé sur un sol nu, dont l'écho dépend beaucoup de l'angle ; faible sous un couvert dense, qui renvoie le signal dans toutes les directions. Mesure exploratoire : la pluie ou le gel entre les deux passages la fait aussi monter. Comme elle compare deux passages, elle n'a pas de tuile sur la carte." },
      ent: { key: "ent", label: "Entropie", range: [0.3, 1.0], legend: "radar", title: "Pseudo-entropie de diffusion, calculée sur les parts de VV et de VH dans le signal : proche de 0 sur un sol nu et lisse, proche de 1 sous un couvert dense. La vraie entropie H/α demande des images complexes (SLC) qui ne sont pas offertes ici." }
    };
    const NDVI_EVI_OK = (v) => (Number.isFinite(v) && v >= -0.3 && v <= 1.2 ? v : NaN);
    // Capteurs offerts (Planetary Computer). Landsat remonte à 1984, Sentinel-2 et Sentinel-1 à 2015.
    //   ndvi(rouge, proche infrarouge) ; bad(q) : pixel à écarter selon la bande de qualité (nuage, ombre, neige, sans donnée)
    const NDVI_SENSORS = {
      s2: {
        key: "s2", name: "Sentinel-2", res: 10, label: "Sentinel-2 · 10 m", firstYear: 2015,
        collection: "sentinel-2-l2a", pointAssets: ["B04", "B08", "SCL", "B02"], folder: "NDVI Sentinel 2", indices: ["ndvi", "evi"],
        attribution: "Sentinel-2 L2A © ESA / Copernicus • Microsoft Planetary Computer", source: "Sentinel-2 L2A (Planetary Computer)",
        // Depuis le traitement 04.00 (janvier 2022), les valeurs Sentinel-2 portent un décalage de 1000 à retirer de chaque bande
        tileQueryFor: (ix, off) => (ix === "evi"
          ? "assets=B08&assets=B04&assets=B02&asset_as_band=True&expression=" + encodeURIComponent(`2.5*(B08-B04)/(B08+6*B04-7.5*B02+${10000 + 0.5 * (off || 0)})`)
          : off ? "assets=B08&assets=B04&asset_as_band=True&expression=" + encodeURIComponent("(B08-B04)/(B08+B04-2000)")
            : "assets=B08&assets=B04&asset_as_band=True&expression=%28B08-B04%29%2F%28B08%2BB04%29"),
        tileQuery: "assets=B08&assets=B04&asset_as_band=True&expression=%28B08-B04%29%2F%28B08%2BB04%29", // gardés pour les autres modules
        tileQueryOffset: "assets=B08&assets=B04&asset_as_band=True&expression=" + encodeURIComponent("(B08-B04)/(B08+B04-2000)"),
        // réflectance = (valeur − décalage) / 10000
        evi: (red, nir, blue, off = 0) => { const den = nir + 6 * red - 7.5 * blue + 10000 + 0.5 * off; return red > 0 && nir > 0 && blue > 0 && den > 0 ? NDVI_EVI_OK((2.5 * (nir - red)) / den) : NaN; },
        offsetOf: (scene) => (parseFloat(scene.properties["s2:processing_baseline"]) >= 4 ? 1000 : 0),
        ndvi: (red, nir, off = 0) => (nir + red - 2 * off > 0 ? (nir - red) / (nir + red - 2 * off) : NaN),
        bad: (q) => [0, 1, 3, 8, 9, 10, 11].includes(Math.round(q)),
        // autour du point : SCL à 20 m ; ombre de nuage, nuage probable et nuage très probable
        qaAsset: "SCL", qaRes: 20, nodata: (q) => Math.round(q) === 0, cloudy: (q) => [3, 8, 9].includes(Math.round(q))
      },
      landsat: {
        key: "landsat", name: "Landsat", res: 30, label: "Landsat · 30 m", firstYear: 1984,
        collection: "landsat-c2-l2", pointAssets: ["red", "nir08", "qa_pixel", "blue"], folder: "NDVI Landsat", indices: ["ndvi", "evi"],
        attribution: "Landsat Collection 2 © USGS • Microsoft Planetary Computer", source: "Landsat Collection 2 Level-2 (Planetary Computer)",
        // réflectance = valeur × 0,0000275 − 0,2 ; d'où NDVI = (PIR − R) / (PIR + R − 14545,45)
        tileQueryFor: (ix) => (ix === "evi"
          ? "assets=nir08&assets=red&assets=blue&asset_as_band=True&expression=" + encodeURIComponent("2.5*(nir08-red)/(nir08+6*red-7.5*blue+40000)") + "&nodata=0"
          : "assets=nir08&assets=red&asset_as_band=True&expression=" + encodeURIComponent("(nir08-red)/(nir08+red-14545.4545)") + "&nodata=0"),
        // même mise à l'échelle : le « + 1 » de l'EVI devient + 1,1 / 0,0000275 = 40000
        evi: (red, nir, blue) => { const den = nir + 6 * red - 7.5 * blue + 40000; return red > 0 && nir > 0 && blue > 0 && den > 0 ? NDVI_EVI_OK((2.5 * (nir - red)) / den) : NaN; },
        ndvi: (red, nir) => (red > 0 && nir > 0 && nir + red - 14545.4545 > 0 ? (nir - red) / (nir + red - 14545.4545) : NaN),
        // qa_pixel : bit 0 sans donnée, 1 nuage dilaté, 2 cirrus, 3 nuage, 4 ombre, 5 neige
        bad: (q) => (Math.round(q) & 0b111111) !== 0,
        // autour du point : nuage dilaté, nuage, ombre
        qaAsset: "qa_pixel", qaRes: 30, nodata: (q) => (Math.round(q) & 1) !== 0 || Math.round(q) === 0, cloudy: (q) => (Math.round(q) & 0b11010) !== 0
      },
      // Radar en bande C, rétrodiffusion corrigée du relief (gamma0, valeurs linéaires). Traverse les nuages.
      s1: {
        key: "s1", name: "Sentinel-1", res: 10, label: "Sentinel-1 radar · 10 m", firstYear: 2015, radar: true,
        collection: "sentinel-1-rtc", folder: "Radar Sentinel-1", indices: ["rvi", "ratio", "ent", "ang"],
        attribution: "Sentinel-1 RTC © ESA / Copernicus • Microsoft Planetary Computer", source: "Sentinel-1 RTC (Planetary Computer)",
        // resampling=average et maxzoom 12 : chaque pixel affiché moyenne plusieurs pixels radar, ce qui atténue le chatoiement
        tileMaxZoom: 12,
        tileQueryFor: (ix) => (ix === "ang" ? null : "assets=vv&assets=vh&asset_as_band=True&resampling=average&expression=" + encodeURIComponent(
          ix === "ratio" ? "vh/vv" : ix === "ent" ? "-(vv/(vv+vh))*log(vv/(vv+vh))/0.693147-(vh/(vv+vh))*log(vh/(vv+vh))/0.693147" : "4*vh/(vv+vh)")),
        // moyennes de VV et VH (linéaires) sur la fenêtre -> les trois indices
        measures: (vv, vh) => { const p = vv / (vv + vh), q = 1 - p; return { rvi: (4 * vh) / (vv + vh), ratio: vh / vv, ent: p > 0 && q > 0 ? -(p * Math.log2(p) + q * Math.log2(q)) : 0 }; }
      }
    };
    const NDVI_RADAR_PAIR_DAYS = 4; // diversité angulaire : écart maximal entre les deux passages comparés
    const NDVI_RADAR_HALF_M = 40; // demi-côté de la fenêtre moyennée autour du point : le radar est trop bruité pixel par pixel
    window.NDVI_SENSORS = NDVI_SENSORS;
    // Un passage est écarté si plus de cette part du voisinage du point est sous les nuages ou leur ombre :
    // un NDVI lu dans un trou entre deux nuages est rarement fiable (brume, ombres, bords de nuages).
    const NDVI_CLOUD_RADIUS_M = 500, NDVI_CLOUD_MAX = 0.25;
    // Tableau NumPy (.npy) de forme (bandes, hauteur, largeur) renvoyé par Planetary Computer
    function ndviParseNpy(buf) {
      const dv = new DataView(buf), u8 = new Uint8Array(buf);
      if (u8[0] !== 0x93 || String.fromCharCode(u8[1], u8[2], u8[3], u8[4], u8[5]) !== "NUMPY") throw new Error("réponse inattendue");
      const v2 = u8[6] >= 2, hl = v2 ? dv.getUint32(8, true) : dv.getUint16(8, true), off = (v2 ? 12 : 10) + hl;
      const head = new TextDecoder("latin1").decode(u8.subarray(v2 ? 12 : 10, off));
      const shape = (/'shape':\s*\(([^)]*)\)/.exec(head) || [])[1], descr = (/'descr':\s*'([^']+)'/.exec(head) || [])[1];
      const dims = String(shape || "").split(",").map((t) => parseInt(t, 10)).filter(Number.isFinite);
      const T = { "<f8": Float64Array, "<f4": Float32Array, "<i2": Int16Array, "<u2": Uint16Array, "<i4": Int32Array, "|u1": Uint8Array, "|i1": Int8Array }[descr];
      if (!T || dims.length !== 3) throw new Error("format non pris en charge (" + descr + ")");
      return { data: new T(buf.slice(off)), bands: dims[0], h: dims[1], w: dims[2] };
    }
    // Part (0 à 1) des pixels sous nuage ou ombre dans un tableau de qualité ; null si trop peu de pixels valides
    function ndviCloudShare(sn, npy) {
      const n = npy.w * npy.h; let valid = 0, cloudy = 0;
      for (let i = 0; i < n; i++) {
        const q = npy.data[i];
        if (npy.bands > 1 && npy.data[(npy.bands - 1) * n + i] === 0) continue; // hors de la scène
        if (!Number.isFinite(q) || sn.nodata(q)) continue;
        valid++; if (sn.cloudy(q)) cloudy++;
      }
      return valid >= n * 0.2 ? cloudy / valid : null;
    }
    // Requête avec une seconde tentative si le service est saturé (429) ou en erreur passagère (5xx)
    async function ndviFetch(url, signal) {
      let resp = await fetch(url, { signal });
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 700));
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        resp = await fetch(url, { signal });
      }
      return resp;
    }
    window.pfNdviIndices = { INDICES: NDVI_INDICES, SENSORS: NDVI_SENSORS };
    window.pfNdviCloud = { parseNpy: ndviParseNpy, share: ndviCloudShare, RADIUS_M: NDVI_CLOUD_RADIUS_M, MAX: NDVI_CLOUD_MAX };

    class NdviManager {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.isActiveMode = false;
        this.currentLocation = null;
        this.currentParcel = null;
        this.series = [];
        this.selectedIndex = -1;
        this.selectedYear = new Date().getFullYear();
        this.sensor = "s2";        // capteur affiché
        this.sensorAuto = true;    // tant que l'utilisateur n'a pas choisi : Sentinel-2 s'il y en a, sinon Landsat
        this.index = "ndvi";       // indice affiché (NDVI ou EVI en optique ; RVI, VH/VV ou entropie au radar)
        this.allSeries = [];       // toutes les dates lues ; this.series = celles qui ont une valeur pour l'indice affiché
        this.tileOpacity = 0.85;
        this.stretchMin = -0.05;
        this.stretchMax = 0.85;
        this.stretchPreset = "standard";
        this.stretchDebounceTimer = null;
        this.abortController = null;
        this.marker = null;
        // Bouton « Enregistrer » : la tuile affichée devient un lien dans Mes données
        const saveBtn = document.getElementById("btn-ndvi-save");
        if (saveBtn) saveBtn.addEventListener("click", () => this.saveCurrentTile());
        document.addEventListener("pf-raster-links-changed", () => this.updateSaveButton());
      }

      // URL des tuiles NDVI (titiler du Planetary Computer, sur les COG B04 et B08 de la scène)
      tileUrlFor(sceneId, minVal, maxVal, sensorKey) {
        const rescaleStr = `${minVal.toFixed(2)},${maxVal.toFixed(2)}`;
        const sn = NDVI_SENSORS[sensorKey || this.sensor] || NDVI_SENSORS.s2;
        const known = (this.series || []).find((x) => x.id === sceneId);
        const tileQuery = sn.tileQueryFor(sn.indices.includes(this.index) ? this.index : sn.indices[0], known ? known.offset : 0);
        if (!tileQuery) return null; // indice sans tuile (il compare deux passages)
        return `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x${sn.key === "s2" ? "" : ".png"}?collection=${sn.collection}&item=${sceneId}&${tileQuery}&rescale=${encodeURIComponent(rescaleStr)}&colormap_name=rdylgn`;
      }

      currentSaveKey() {
        const scene = this.series[this.selectedIndex];
        return scene ? `${scene.id}|${this.index === "ndvi" ? "" : this.index + "|"}${this.stretchMin.toFixed(2)},${this.stretchMax.toFixed(2)}` : null;
      }

      indexDef() { return NDVI_INDICES[this.index] || NDVI_INDICES.ndvi; }
      // Dossier de Mes données : « NDVI Sentinel 2 », « EVI Sentinel 2 », « Radar Sentinel-1 »…
      folderFor(sensorKey) {
        const sn = NDVI_SENSORS[sensorKey || this.sensor] || NDVI_SENSORS.s2;
        return this.index === "evi" ? sn.folder.replace("NDVI", "EVI") : sn.folder;
      }

      updateSaveButton() {
        const btn = document.getElementById("btn-ndvi-save");
        if (!btn) return;
        const vm = window.vectorManager;
        const key = this.currentSaveKey();
        btn.disabled = !!this.indexDef().noTile;
        const saved = !!(key && vm && typeof vm.findRasterLink === "function" && vm.findRasterLink(key));
        btn.classList.toggle("saved", saved);
        btn.setAttribute("aria-pressed", saved ? "true" : "false");
        const label = btn.querySelector("span");
        if (label) label.textContent = saved ? "Enregistrée" : "Enregistrer";
        btn.title = saved
          ? `Cette tuile (date et nuancier) est déjà dans Mes données › ${this.folderFor()}`
          : `Enregistrer cette tuile ${this.indexDef().label} dans Mes données (dossier « ${this.folderFor()} ») : un lien vers les COG du satellite, sans téléchargement`;
      }

      saveCurrentTile() {
        const scene = this.series[this.selectedIndex];
        const vm = window.vectorManager;
        if (!scene || !vm || typeof vm.addRasterLink !== "function" || this.indexDef().noTile) return;
        const key = this.currentSaveKey();
        const existing = vm.findRasterLink(key);
        if (existing) {
          vm.showToast(`La tuile du ${scene.dateKey} est déjà enregistrée dans « ${this.folderFor(scene.sensor)} ».`);
          return;
        }
        const loc = this.currentLocation;
        const p = this.currentParcel || {};
        const sn = NDVI_SENSORS[scene.sensor] || NDVI_SENSORS.s2;
        vm.addRasterLink({
          name: scene.dateKey,
          folderPath: [this.folderFor(sn.key)],
          key,
          tiles: this.tileUrlFor(scene.id, this.stretchMin, this.stretchMax, sn.key),
          bounds: Array.isArray(scene.bbox) && scene.bbox.length === 4 ? scene.bbox : null,
          center: loc ? [loc.lng, loc.lat] : null,
          opacity: this.tileOpacity,
          attribution: sn.attribution,
          legend: { kind: this.indexDef().legend, min: this.stretchMin, max: this.stretchMax, colormap: "rdylgn" },
          meta: {
            source: sn.source, capteur: sn.name, resolution_m: sn.res, scene: scene.id, date: scene.dateKey, indice: this.indexDef().label,
            [this.index === "ndvi" ? "ndviPoint" : "valeurPoint"]: Number(scene.ndvi.toFixed(3)), cloud: Number((scene.cloud || 0).toFixed(1)),
            parcel: p.IDPAR || p.idpar || null
          }
        });
        this.updateSaveButton();
      }

      initYearSelect() {
        const select = document.getElementById("ndvi-year-select");
        if (!select) return;
        const currentYear = new Date().getFullYear();
        select.innerHTML = "";
        for (let y = currentYear; y >= NDVI_SENSORS.landsat.firstYear; y--) {
          const opt = document.createElement("option");
          opt.value = y;
          opt.textContent = y;
          if (y === this.selectedYear) opt.selected = true;
          select.appendChild(opt);
        }
      }

      // Menu du capteur : un choix manuel remplace le choix automatique et relance l'analyse
      initSensorSelect() {
        const select = document.getElementById("ndvi-sensor-select");
        if (!select || select.__pfBound) return;
        select.__pfBound = true;
        select.value = this.sensor;
        select.addEventListener("change", () => {
          this.sensor = NDVI_SENSORS[select.value] ? select.value : "s2";
          this.sensorAuto = false;
          this.syncIndexSelect();
          if (this.currentLocation) this.analyzeLocation(this.currentLocation, this.currentParcel, this.selectedYear);
        });
        this.syncIndexSelect();
      }

      // Menu de l'indice : dépend du capteur ; en changer ne relit rien, les valeurs sont déjà là
      syncIndexSelect() {
        const sn = NDVI_SENSORS[this.sensor] || NDVI_SENSORS.s2, select = document.getElementById("ndvi-index-select");
        if (!sn.indices.includes(this.index)) { this.index = sn.indices[0]; this.resetStretch(); }
        if (!select) return;
        if (!select.__pfBound) {
          select.__pfBound = true;
          select.addEventListener("change", () => this.setIndex(select.value));
        }
        if (select.dataset.sensor !== sn.key) {
          select.dataset.sensor = sn.key; select.innerHTML = "";
          sn.indices.forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = NDVI_INDICES[k].label; o.title = NDVI_INDICES[k].title; select.appendChild(o); });
        }
        select.value = this.index; select.title = this.indexDef().title;
      }
      resetStretch() { const r = this.indexDef().range; this.stretchMin = r[0]; this.stretchMax = r[1]; this.stretchPreset = "standard"; }
      setIndex(key) {
        const sn = NDVI_SENSORS[this.sensor] || NDVI_SENSORS.s2;
        if (!sn.indices.includes(key) || key === this.index) { this.syncIndexSelect(); return; }
        const keep = this.series[this.selectedIndex] ? this.series[this.selectedIndex].id : null;
        this.index = key; this.resetStretch(); this.syncIndexSelect();
        if (this.allSeries.length) this.showSeries(keep);
      }
      // this.series : les dates qui ont une valeur pour l'indice affiché (la valeur est recopiée dans .ndvi, que lit tout le reste)
      applyIndex() {
        const ix = this.index;
        this.series = this.allSeries.filter((s) => s.vals && Number.isFinite(s.vals[ix]));
        this.series.forEach((s) => { s.ndvi = s.vals[ix]; });
      }

      // Radar Sentinel-1 : une seule orbite (même angle de visée d'une date à l'autre), VV et VH moyennés sur une petite fenêtre
      async fetchRadarSeries(lngLat, yr, dtStr, signal, statsBar) {
        const sn = NDVI_SENSORS.s1;
        const stacResp = await fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collections: [sn.collection], intersects: { type: "Point", coordinates: [lngLat.lng, lngLat.lat] }, datetime: dtStr, limit: 400, sortby: [{ field: "datetime", direction: "asc" }],
            fields: { include: ["id", "bbox", "properties.datetime", "properties.platform", "properties.sat:orbit_state", "properties.sat:relative_orbit", "properties.sar:polarizations"], exclude: ["links", "assets", "geometry"] } }),
          signal
        });
        if (!stacResp.ok) throw new Error(`Erreur STAC (${stacResp.status})`);
        // Au Canada, une partie des passages est acquise en HH/HV (suivi des glaces) : seuls les passages VV/VH servent ici
        const all = (await stacResp.json()).features || [];
        const items = all.filter((it) => { const pol = it.properties["sar:polarizations"]; return !Array.isArray(pol) || (pol.includes("VV") && pol.includes("VH")); });
        const otherPol = all.length - items.length;
        // orbite la plus fréquente ; à égalité, l'ascendante (passage de fin de journée, sans rosée)
        const groups = new Map();
        items.forEach((it) => { const k = `${it.properties["sat:orbit_state"] || "?"}|${it.properties["sat:relative_orbit"] || "?"}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
        let best = null;
        groups.forEach((list, k) => { if (!best || list.length > best.list.length || (list.length === best.list.length && /^asc/.test(k) && !/^asc/.test(best.k))) best = { k, list }; });
        if (!best) return { sampled: [], cloudFilteredCount: 0, candidates: 0, otherPol };
        const byDate = new Map(); best.list.forEach((it) => { const d = it.properties.datetime.split("T")[0]; if (!byDate.has(d)) byDate.set(d, it); });
        const unique = Array.from(byDate.values()), parts = best.k.split("|");
        const orbit = `${/^asc/.test(parts[0]) ? "ascendante" : /^desc/.test(parts[0]) ? "descendante" : parts[0]} ${parts[1]}`;
        const h = NDVI_RADAR_HALF_M, dLat = h / 111132, dLng = h / (111320 * Math.max(0.1, Math.cos((lngLat.lat * Math.PI) / 180)));
        const bbox = [lngLat.lng - dLng, lngLat.lat - dLat, lngLat.lng + dLng, lngLat.lat + dLat].map((v) => v.toFixed(6)).join(","), px = Math.round((2 * h) / sn.res);
        // seconde orbite (autre angle de visée), pour la diversité angulaire : la plus fréquente parmi les autres
        let second = null;
        groups.forEach((list, k) => { if (k !== best.k && (!second || list.length > second.list.length)) second = { k, list }; });
        const byDate2 = new Map(); if (second) second.list.forEach((it) => { const d = it.properties.datetime.split("T")[0]; if (!byDate2.has(d)) byDate2.set(d, it); });
        const unique2 = Array.from(byDate2.values()), jobs = unique.map((it) => ({ it, main: true })).concat(unique2.map((it) => ({ it, main: false })));
        const sampled = [], pairs = []; let completed = 0;
        const progress = () => { if (statsBar) statsBar.innerHTML = `<span class="stat-chip">${sn.name} : lecture des passages (${Math.min(completed, jobs.length)}/${jobs.length})...</span>`; };
        progress();
        const readMeans = async (scene) => {
          const resp = await ndviFetch(`https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/${bbox}/${px}x${px}.npy?collection=${sn.collection}&item=${encodeURIComponent(scene.id)}&assets=vv&assets=vh`, signal);
          if (!resp.ok) return null;
          const npy = ndviParseNpy(await resp.arrayBuffer()), n = npy.w * npy.h;
          if (npy.bands < 2) return null;
          let sv = 0, sh = 0, k = 0;
          for (let j = 0; j < n; j++) { const a = npy.data[j], b = npy.data[n + j]; if (a > 0 && b > 0 && (npy.bands < 3 || npy.data[2 * n + j] !== 0)) { sv += a; sh += b; k++; } }
          return k < n / 4 ? null : { vv: sv / k, vh: sh / k }; // moins du quart de la fenêtre : bord de fauchée
        };
        const PAR = 32;
        for (let i = 0; i < jobs.length; i += PAR) {
          if (signal.aborted) return null;
          const batch = jobs.slice(i, i + PAR);
          const results = await Promise.all(batch.map(async ({ it: scene, main }) => {
            try {
              const m = await readMeans(scene);
              if (!m) return null;
              if (!main) return { pair: true, t: new Date(scene.properties.datetime).getTime(), dateKey: scene.properties.datetime.split("T")[0], vv: m.vv };
              return { id: scene.id, sensor: sn.key, offset: 0, datetime: scene.properties.datetime, dateKey: scene.properties.datetime.split("T")[0], bbox: scene.bbox || null,
                vals: sn.measures(m.vv, m.vh), ndvi: NaN, b4: m.vv, b8: m.vh, scl: null, cloud: 0, cloudLocal: null, platform: scene.properties.platform || sn.name, orbit };
            } catch (e) {
              if (e.name === "AbortError") throw e;
              return null;
            }
          }));
          results.forEach((r) => { if (r) (r.pair ? pairs : sampled).push(r); });
          completed += batch.length; progress();
        }
        // diversité angulaire : chaque passage est comparé au passage de l'autre orbite le plus proche dans le temps
        sampled.forEach((s) => {
          const t = new Date(s.datetime).getTime(); let near = null;
          pairs.forEach((p) => { if (!near || Math.abs(p.t - t) < Math.abs(near.t - t)) near = p; });
          if (near && Math.abs(near.t - t) <= NDVI_RADAR_PAIR_DAYS * 86400000) { s.vals.ang = Math.abs(s.b4 - near.vv) / (s.b4 + near.vv); s.pair = { dateKey: near.dateKey, db: 10 * Math.log10(s.b4 / near.vv) }; }
          else s.vals.ang = NaN;
        });
        const p2 = second ? second.k.split("|") : null, orbit2 = p2 ? `${/^asc/.test(p2[0]) ? "ascendante" : /^desc/.test(p2[0]) ? "descendante" : p2[0]} ${p2[1]}` : "";
        sampled.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
        return { sampled, cloudFilteredCount: 0, candidates: unique.length, orbit, orbit2, otherOrbits: items.length - best.list.length, otherPol };
      }

      // Couverture nuageuse dans un carré de 500 m de demi-côté autour du point (bande de qualité de la scène).
      // null si la lecture échoue : le passage est alors gardé sur la seule foi du pixel du point.
      async localCloud(sn, scene, lngLat, signal) {
        const r = NDVI_CLOUD_RADIUS_M, dLat = r / 111132, dLng = r / (111320 * Math.max(0.1, Math.cos((lngLat.lat * Math.PI) / 180)));
        const bbox = [lngLat.lng - dLng, lngLat.lat - dLat, lngLat.lng + dLng, lngLat.lat + dLat].map((v) => v.toFixed(6)).join(",");
        const px = Math.max(8, Math.round((2 * r) / sn.qaRes));
        const url = `https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/${bbox}/${px}x${px}.npy?collection=${sn.collection}&item=${encodeURIComponent(scene.id)}&assets=${sn.qaAsset}&asset_as_band=True&expression=${sn.qaAsset}&resampling=nearest`;
        try {
          const resp = await ndviFetch(url, signal);
          if (!resp.ok) return null;
          return ndviCloudShare(sn, ndviParseNpy(await resp.arrayBuffer()));
        } catch (e) {
          if (e.name === "AbortError") throw e;
          return null;
        }
      }

      // Scènes d'une saison pour un capteur, échantillonnées au point et filtrées des nuages
      async fetchSeries(sensorKey, lngLat, yr, dtStr, signal, statsBar) {
        const sn = NDVI_SENSORS[sensorKey];
        const query = { "eo:cloud_cover": { lt: 65 } };
        if (sn.key === "landsat") {
          // Landsat 7 a des bandes vides depuis 2003 (miroir en panne) : ses passages sont gardés quand le point
          // cliqué tombe sur un pixel mesuré, écartés sans bruit quand il tombe dans une bande vide
          query.platform = { in: ["landsat-4", "landsat-5", "landsat-7", "landsat-8", "landsat-9"] };
        }
        const stacResp = await fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collections: [sn.collection], intersects: { type: "Point", coordinates: [lngLat.lng, lngLat.lat] }, datetime: dtStr, query, limit: 200, sortby: [{ field: "datetime", direction: "asc" }] }),
          signal
        });
        if (!stacResp.ok) throw new Error(`Erreur STAC (${stacResp.status})`);
        const items = (await stacResp.json()).features || [];
        const byDate = new Map();
        for (const item of items) {
          const dateKey = item.properties.datetime.split("T")[0];
          const cloud = item.properties["eo:cloud_cover"] || 0;
          if (!byDate.has(dateKey) || byDate.get(dateKey).properties["eo:cloud_cover"] > cloud) byDate.set(dateKey, item);
        }
        const uniqueItems = Array.from(byDate.values()).sort((a, b) => new Date(a.properties.datetime) - new Date(b.properties.datetime));
        const sampled = [];
        let cloudFilteredCount = 0, completed = 0;
        const progress = () => { if (statsBar) statsBar.innerHTML = `<span class="stat-chip">${sn.name} : filtrage des nuages (${Math.min(completed, uniqueItems.length)}/${uniqueItems.length}) • ${sampled.length} retenus, ${cloudFilteredCount} nuageux...</span>`; };
        progress();
        // 48 passages à la fois (une saison entière tient le plus souvent en un seul lot) ; pour chacun, le pixel
        // du point et les nuages du voisinage sont lus en même temps
        const PAR = 48;
        for (let i = 0; i < uniqueItems.length; i += PAR) {
          if (signal.aborted) return null;
          const batch = uniqueItems.slice(i, i + PAR);
          const results = await Promise.all(batch.map(async (scene) => {
            const pUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/point/${lngLat.lng.toFixed(5)},${lngLat.lat.toFixed(5)}?collection=${sn.collection}&item=${scene.id}&${sn.pointAssets.map((a) => "assets=" + a).join("&")}`;
            try {
              const [pResp, cloudLocal] = await Promise.all([ndviFetch(pUrl, signal), this.localCloud(sn, scene, lngLat, signal)]);
              if (!pResp.ok) return null;
              const vals = (await pResp.json()).values || [];
              if (vals.length < 3) return null;
              const [red, nir, qa, blue] = vals;
              if (typeof sn.nodata === "function" && sn.nodata(qa)) return null; // pixel sans mesure (bord de scène, bande vide de Landsat 7) : ni retenu ni compté comme nuage
              if (sn.bad(qa)) return { isCloud: true };
              const offset = typeof sn.offsetOf === "function" ? sn.offsetOf(scene) : 0;
              const ndvi = sn.ndvi(red, nir, offset);
              if (!Number.isFinite(ndvi) || ndvi < -0.15 || ndvi > 1.0) return null;
              // le pixel est clair : on vérifie qu'il n'est pas dans un simple trou entre les nuages
              if (cloudLocal !== null && cloudLocal > NDVI_CLOUD_MAX) return { isCloud: true };
              return {
                cloudLocal,
                id: scene.id, sensor: sn.key, offset, datetime: scene.properties.datetime, dateKey: scene.properties.datetime.split("T")[0],
                bbox: scene.bbox || null, ndvi, vals: { ndvi, evi: typeof sn.evi === "function" && Number.isFinite(blue) ? sn.evi(red, nir, blue, offset) : NaN }, b4: red, b8: nir, scl: qa,
                cloud: scene.properties["eo:cloud_cover"] || 0, platform: scene.properties["platform"] || sn.name
              };
            } catch (e) {
              if (e.name === "AbortError") throw e;
              return null;
            }
          }));
          for (const r of results) { if (r) { if (r.isCloud) cloudFilteredCount++; else sampled.push(r); } }
          completed += batch.length;
          progress();
        }
        sampled.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
        return { sampled, cloudFilteredCount, candidates: uniqueItems.length };
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
            this.stretchMin = this.indexDef().range[0];
            this.stretchMax = this.indexDef().range[1];
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
        if (this.sensor === "s1") return "Radar";
        if (this.sensor === "landsat") return (Math.round(scl) & 128) ? "Eau" : "Ciel clair"; // qa_pixel : bit 7 = eau
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

      updateTitle() {
        const titleEl = document.getElementById("ndvi-dock-title"), lngLat = this.currentLocation, parcelProps = this.currentParcel;
        if (!titleEl || !lngLat) return;
        const pid = parcelProps ? (parcelProps.IDPAR || parcelProps.idpar || "") : "";
        const crop = parcelProps ? (parcelProps.DESCODPR1 || parcelProps.descodpr1 || "") : "";
        const ix = this.indexDef().label;
        titleEl.textContent = pid
          ? `Série ${ix} ${this.selectedYear} (mars–déc.) — Parcelle nº ${pid}${crop ? ` (${crop})` : ''}`
          : `Série ${ix} ${this.selectedYear} (mars–déc.) — Point [${lngLat.lat.toFixed(4)}°N, ${Math.abs(lngLat.lng).toFixed(4)}°O]`;
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
        this.allSeries = [];
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
        const statsBar = document.getElementById("ndvi-stats-bar");
        const container = document.getElementById("ndvi-chart-container");
        const controlsRow = document.getElementById("ndvi-active-controls");

        if (dock) {
          dock.classList.add("open");
          dock.classList.remove("collapsed");
          this.isCollapsed = false;
        }
        if (controlsRow) controlsRow.style.display = "none";


        this.syncIndexSelect();
        this.updateTitle();

        if (statsBar) {
          statsBar.innerHTML = `<span class="stat-chip">Recherche des scènes satellites pour la saison ${this.selectedYear} (mars &rarr; déc.)...</span>`;
        }
        if (container) {
          container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:160px; color:#64748b; font-size:12px; gap:8px;">
              <div style="width:24px; height:24px; border:2.5px solid #cbd5e1; border-top-color:#16a34a; border-radius:50%; animation: spin 0.8s linear infinite;"></div>
              <span>Interrogation du catalogue satellite (Planetary Computer) pour la saison ${this.selectedYear}...</span>
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

          // Choix automatique : Sentinel-2 (10 m) s'il a des dates utilisables cette saison, sinon Landsat (30 m)
          const order = this.sensorAuto ? ["s2", "landsat"].filter((k) => yr >= NDVI_SENSORS[k].firstYear) : [this.sensor];
          let sampled = [], cloudFilteredCount = 0, candidates = 0, fallback = false, radar = null;
          for (let t = 0; t < order.length; t++) {
            const res = NDVI_SENSORS[order[t]].radar ? await this.fetchRadarSeries(lngLat, yr, dtStr, signal, statsBar) : await this.fetchSeries(order[t], lngLat, yr, dtStr, signal, statsBar);
            if (!res || signal.aborted) return;
            this.sensor = order[t];
            sampled = res.sampled; cloudFilteredCount = res.cloudFilteredCount; candidates = res.candidates;
            radar = NDVI_SENSORS[order[t]].radar ? { orbit: res.orbit, orbit2: res.orbit2 || "", others: res.otherOrbits || 0, otherPol: res.otherPol || 0 } : null;
            if (sampled.length) { fallback = this.sensorAuto && t > 0; break; }
          }
          const sn = NDVI_SENSORS[this.sensor];
          const sensorSelect = document.getElementById("ndvi-sensor-select");
          if (sensorSelect) sensorSelect.value = this.sensor;
          this.allSeries = sampled;
          this.syncIndexSelect();
          this.applyIndex();
          this.updateTitle();
          this.lastRun = { yr, fallback, cloudFilteredCount, radar };

          if (candidates === 0 && radar && radar.otherPol) {
            if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucun passage radar en VV/VH pour la saison ${yr} (${radar.otherPol} passages en HH/HV seulement).</span>`;
            if (container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">Sentinel-1 n'a observé ce secteur qu'en polarisation HH/HV cette année-là : les indices de végétation radar ne peuvent pas être calculés.</div>`;
            return;
          }
          if (candidates === 0) {
            if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucune scène ${this.sensorAuto ? "satellite" : sn.name} trouvée pour la saison ${yr} (mars à déc.).</span>`;
            if (container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">Aucune donnée satellite disponible pour cette année. Essayez une autre année ou un autre capteur dans les menus ci-dessus.</div>`;
            return;
          }

          if (this.series.length === 0 && sn.radar) {
            if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucun passage radar lisible sur ce point pour la saison ${yr}.</span>`;
            if (container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">Les passages Sentinel-1 de ${yr} n'ont pas pu être lus ici. Essayez une autre année ou un autre capteur.</div>`;
            return;
          }
          if (this.series.length === 0) {
            if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucune date sans nuage pour la saison ${yr} (${cloudFilteredCount} passages éliminés par le masque de nuages).</span>`;
            if (container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">Tous les passages satellites de ${yr} étaient couverts de nuages ou de neige. Sélectionnez une autre année ci-dessus.</div>`;
            return;
          }

          this.showSeries(null);

        } catch (err) {
          if (err.name === 'AbortError') return;
          console.error("NDVI analysis error:", err);
          if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Erreur lors de la récupération des données satellites : ${err.message}</span>`;
        }
      }

      // Bandeau, graphique et date choisie pour l'indice affiché (les valeurs sont déjà lues)
      showSeries(keepId) {
        const statsBar = document.getElementById("ndvi-stats-bar"), container = document.getElementById("ndvi-chart-container");
        const run = this.lastRun || {}, sn = NDVI_SENSORS[this.sensor] || NDVI_SENSORS.s2, ix = this.indexDef();
        this.applyIndex();
        this.updateTitle();
        if (!this.series.length) {
          this.selectedIndex = -1; this.clearLayer();
          if (statsBar) statsBar.innerHTML = `<span class="stat-chip" style="color:#b91c1c;">Aucune date n'a de valeur ${ix.label} utilisable pour la saison ${run.yr}.</span>`;
          if (container) container.innerHTML = "";
          return;
        }
        const vals = this.series.map((s) => s.ndvi), maxVal = Math.max(...vals), latest = this.series[this.series.length - 1], peakIdx = vals.indexOf(maxVal);
        if (statsBar) {
          const peakDate = this.series[peakIdx].dateKey.split("-");
          const mNames = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
          const mIdx = parseInt(peakDate[1], 10) - 1;
          const peakStr = (mIdx >= 0 && mIdx < 12) ? `${parseInt(peakDate[2], 10)} ${mNames[mIdx]}` : this.series[peakIdx].dateKey;
          const cloudN = run.cloudFilteredCount || 0;
          statsBar.innerHTML = `
            <span class="stat-chip">Saison <strong>${run.yr}</strong></span>
            <span class="stat-chip" title="${run.fallback ? "Aucune date Sentinel-2 utilisable cette saison : passage automatique à Landsat" : "Capteur satellite et résolution des pixels"}">Capteur : <strong>${sn.label}</strong></span>
            <span class="stat-chip" title="${ix.title}">Indice : <strong>${ix.label}</strong></span>
            <span class="stat-chip" style="background:#dcfce7; border-color:#86efac; color:#14532d;">${sn.radar ? "Maximum :" : "Pic estival :"} <strong>${maxVal.toFixed(2)}</strong> (${peakStr})</span>
            <span class="stat-chip">${this.index === "ndvi" ? "Dernier NDVI :" : "Dernière valeur :"} <strong>${latest.ndvi.toFixed(2)}</strong></span>
            ${sn.radar
              ? `<span class="stat-chip">Passages : <strong>${this.series.length} dates</strong></span>
                 <span class="stat-chip" style="color:#64748b;" title="${ix.noTile ? `Chaque passage est comparé au passage de l'orbite ${run.radar ? run.radar.orbit2 : ""} le plus proche, à ${NDVI_RADAR_PAIR_DAYS} jours ou moins.` : `Une seule orbite est gardée pour que l'angle de visée reste le même d'une date à l'autre${run.radar && run.radar.others ? ` (${run.radar.others} passages d'autres orbites écartés)` : ""}.`}${run.radar && run.radar.otherPol ? ` ${run.radar.otherPol} passages en polarisation HH/HV écartés : les indices demandent VV et VH.` : ""} Valeurs moyennées sur un carré de ${2 * NDVI_RADAR_HALF_M} m autour du point. La pluie, la rosée, le gel et le travail du sol font aussi varier le signal radar.">Orbite ${run.radar ? run.radar.orbit : ""}</span>`
              : `<span class="stat-chip">Observations claires : <strong>${this.series.length} dates</strong></span>
                 ${cloudN > 0 ? `<span class="stat-chip" style="color:#64748b;" title="Passages éliminés car sous un nuage, une ombre ou de la neige, ou entourés de nuages (plus de 25 % dans un rayon de 500 m)">${cloudN} nuageux filtrés</span>` : ""}`}
          `;
        }
        let pick = keepId ? this.series.findIndex((s) => s.id === keepId) : -1;
        if (pick < 0) pick = peakIdx >= 0 ? peakIdx : this.series.length - 1;
        this.renderChart(pick);
        this.selectDate(pick);
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
          badge.innerHTML = `<strong>${niceDate}</strong> &bull; ${this.indexDef().label} : <strong style="color:#15803d;">${scene.ndvi.toFixed(2)}</strong> <span class="stat-chip" style="margin-left:4px;font-size:10px;padding:1px 5px;background:#dcfce7;color:#14532d;border-color:#86efac;">${this.getSclLabel(scene.scl)}</span> ${scene.sensor === "s1"
            ? `<span style="color:#64748b;font-size:10.5px;margin-left:3px;" title="Satellite et orbite du passage">(${scene.platform}, orbite ${scene.orbit})</span>`
            : `<span style="color:#64748b;font-size:10.5px;margin-left:3px;" title="Couverture nuageuse de la scène : ${scene.cloud.toFixed(1)}% (${scene.platform})">(${scene.cloud.toFixed(0)}% nuages)</span>`}`;
        }
        if (btnPrev) btnPrev.disabled = (index <= 0);
        if (btnNext) btnNext.disabled = (index >= this.series.length - 1);

        const collapsedSummary = document.getElementById("ndvi-collapsed-summary");
        if (collapsedSummary) {
          collapsedSummary.textContent = `${scene.dateKey} • ${this.indexDef().label} : ${scene.ndvi.toFixed(3)}`;
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
        this.updateSaveButton();
      }

      displayNdviLayer(sceneId, sampleNdvi) {
        const tileUrl = this.tileUrlFor(sceneId, this.stretchMin, this.stretchMax);
        this.updateSaveButton();

        if (this.map.getLayer("sentinel2-ndvi-layer")) {
          this.map.removeLayer("sentinel2-ndvi-layer");
        }
        if (this.map.getSource("sentinel2-ndvi-source")) {
          this.map.removeSource("sentinel2-ndvi-source");
        }
        if (!tileUrl) return; // indice sans tuile : la carte reste sans couche satellite

        this.map.addSource("sentinel2-ndvi-source", {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          ...((NDVI_SENSORS[this.sensor] || {}).tileMaxZoom ? { maxzoom: NDVI_SENSORS[this.sensor].tileMaxZoom } : {}),
          attribution: (NDVI_SENSORS[this.sensor] || NDVI_SENSORS.s2).attribution
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

        const ndviLike = this.index === "ndvi"; // les seuils 0,2 / 0,4 / 0,6 ne valent que pour le NDVI
        let bandsHtml = !ndviLike ? "" : `
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
          if (!ndviLike) color = "#0f766e";
          else if (s.ndvi < 0.2) color = "#dc2626";
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
              hoverInfo.innerHTML = item.sensor === "s1"
                ? `<strong>${item.dateKey}</strong> &bull; ${this.indexDef().label} : <strong>${item.ndvi.toFixed(3)}</strong> &bull; VV : <strong>${(10 * Math.log10(item.b4)).toFixed(1)} dB</strong> &bull; VH : <strong>${(10 * Math.log10(item.b8)).toFixed(1)} dB</strong>${this.indexDef().noTile && item.pair ? ` &bull; comparé au ${item.pair.dateKey} : <strong>${item.pair.db >= 0 ? "+" : "−"}${Math.abs(item.pair.db).toFixed(1)} dB</strong>` : " &bull; Cliquez pour afficher la tuile satellite sur la carte"}`
                : `<strong>${item.dateKey}</strong> &bull; ${this.indexDef().label} : <strong>${item.ndvi.toFixed(3)}</strong> &bull; Qualité : <strong>${this.getSclLabel(item.scl)}</strong> &bull; ${Number.isFinite(item.cloudLocal) ? `Nuages à moins de 500 m : ${(100 * item.cloudLocal).toFixed(0)}% (scène : ${item.cloud.toFixed(0)}%)` : `Nuages scène : ${item.cloud.toFixed(1)}%`} &bull; Cliquez pour afficher la tuile satellite sur la carte`;
            }
          });

          circle.addEventListener("mouseleave", () => {
            if (hoverInfo) {
              hoverInfo.textContent = "Cliquez sur une date ci-dessus pour afficher la tuile satellite correspondante sur la carte";
            }
          });
        });

        if (!this._resizeAttached) {
          this._resizeAttached = true;
          // le graphique n'est redessiné qu'une fois le redimensionnement terminé
          window.addEventListener("resize", () => {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
              if (this.series && this.series.length && !this.isCollapsed) this.renderChart(this.selectedIndex);
            }, 150);
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
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["ndvi"] = "5f50dbce";
