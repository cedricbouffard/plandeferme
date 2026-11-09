/**
 * ==============================================================================
 * LIDAR CUT & FILL COMPARISON MANAGER (PLAN DE FERME)
 * Outil de comparaison multidate de levés LiDAR aéroportés sur parcelle agricole
 * Détection automatique des campagnes, calibrage altimétrique (élimination du biais de datum/géoïde),
 * rendu de la couche Déblais / Remblais en 9 classes (norme Ektare) et évaluation en m³/ha cut.
 * ==============================================================================
 */

(function (root) {
  'use strict';

  // Palette officielle 9 classes Déblais / Remblais (identique à Ektare)
  // [borne supérieure en mètres, R, G, B, label, classId]
  const CUT_FILL_CLASSES = [
    { max: -0.20, r: 180, g: 0, b: 0, hex: "#B40000", label: "Déblai fort (> 20 cm)", classId: "cut_gt_20", sub: "> 20 cm" },
    { max: -0.15, r: 255, g: 0, b: 0, hex: "#FF0000", label: "Déblai moyen (15 à 20 cm)", classId: "cut_15_20", sub: "15 à 20 cm" },
    { max: -0.10, r: 255, g: 128, b: 0, hex: "#FF8000", label: "Déblai modéré (10 à 15 cm)", classId: "cut_10_15", sub: "10 à 15 cm" },
    { max: -0.025, r: 255, g: 255, b: 0, hex: "#FFFF00", label: "Déblai faible (2,5 à 10 cm)", classId: "cut_2_10", sub: "2,5 à 10 cm" },
    { max: 0.025, r: 0, g: 205, b: 0, hex: "#00CD00", label: "Neutre (± 2,5 cm)", classId: "neutral", sub: "± 2,5 cm" },
    { max: 0.10, r: 27, g: 247, b: 201, hex: "#1BF7C9", label: "Remblai faible (2,5 à 10 cm)", classId: "fill_2_10", sub: "2,5 à 10 cm" },
    { max: 0.15, r: 0, g: 102, b: 255, hex: "#0066FF", label: "Remblai modéré (10 à 15 cm)", classId: "fill_10_15", sub: "10 à 15 cm" },
    { max: 0.20, r: 154, g: 49, b: 255, hex: "#9A31FF", label: "Remblai moyen (15 à 20 cm)", classId: "fill_15_20", sub: "15 à 20 cm" },
    { max: Infinity, r: 128, g: 0, b: 128, hex: "#800080", label: "Remblai fort (> 20 cm)", classId: "fill_gt_20", sub: "> 20 cm" }
  ];

  class LidarCutFillManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.isOpen = false;
      this.currentParcel = null;
      this.availableSurveys = [];
      this.surveyRegionsCache = new Map(); // cache des régions chargées par ID de levé
      this.selectedNewId = null;
      this.selectedOldId = null;
      this.autoCalibrate = true;
      this.calibrationOffsetM = 0.0;
      this.manualOffsetCm = 0.0;
      this.opacity = 0.85;

      this.currentAnalysis = null;
      this.abortController = null;

      this.SRC_RASTER = 'cutfill-raster-source';
      this.LAYER_RASTER = 'cutfill-raster-layer';
      this.SRC_HL = 'cutfill-parcel-hl-source';
      this.LAYER_HL = 'cutfill-parcel-hl-line';

      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');

      this.initEvents();
    }

    getProj4() {
      return window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4) || (typeof proj4 !== 'undefined' ? proj4 : null);
    }

    initEvents() {
      const btnClose = document.getElementById('btn-close-cutfill-dock');
      if (btnClose) {
        btnClose.addEventListener('click', () => this.closeDock());
      }

      const selNew = document.getElementById('cutfill-select-new');
      if (selNew) {
        selNew.addEventListener('change', (e) => {
          this.selectedNewId = e.target.value;
          this.runComparison();
        });
      }

      const selOld = document.getElementById('cutfill-select-old');
      if (selOld) {
        selOld.addEventListener('change', (e) => {
          this.selectedOldId = e.target.value;
          this.runComparison();
        });
      }

      const btnSwap = document.getElementById('btn-cutfill-swap');
      if (btnSwap) {
        btnSwap.addEventListener('click', () => this.swapSurveys());
      }

      const chkCalib = document.getElementById('cutfill-check-autocalib');
      if (chkCalib) {
        chkCalib.addEventListener('change', (e) => {
          this.autoCalibrate = e.target.checked;
          this.applyRecalibration();
        });
      }

      const rngOpacity = document.getElementById('cutfill-opacity-slider');
      if (rngOpacity) {
        rngOpacity.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          this.opacity = val / 100.0;
          const valLbl = document.getElementById('cutfill-opacity-val');
          if (valLbl) valLbl.textContent = `${val}%`;
          if (this.map && this.map.getLayer(this.LAYER_RASTER)) {
            this.map.setPaintProperty(this.LAYER_RASTER, 'raster-opacity', this.opacity);
          }
        });
      }

      const btnTable = document.getElementById('btn-toggle-cutfill-table');
      if (btnTable) {
        btnTable.addEventListener('click', () => {
          const tbl = document.getElementById('cutfill-details-table');
          if (tbl) {
            const isHidden = tbl.style.display === 'none';
            tbl.style.display = isHidden ? 'block' : 'none';
            btnTable.textContent = isHidden ? 'Détail par classe ▴' : 'Détail par classe ▾';
          }
        });
      }

      const btnExportTif = document.getElementById('btn-cutfill-export-tif');
      if (btnExportTif) {
        btnExportTif.addEventListener('click', () => this.exportDifferentialGeoTiff());
      }

      // Inspection interactive au survol
      if (this.map) {
        this.map.on('mousemove', (e) => this.handleMapMouseMove(e));
      }
    }

    /**
     * Ouvre l'outil de comparaison pour la parcelle sélectionnée
     */
    async openForParcel(parcelFeature) {
      if (!parcelFeature || !parcelFeature.geometry) return;

      // Assembler la parcelle avec dissolution propre des tranches vectorielles
      let parcel = parcelFeature;
      if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === 'function') {
        parcel = window.terrain3DManager.assembleParcelFeature(parcelFeature);
      }
      this.currentParcel = parcel;
      this.surveyRegionsCache.clear();

      // Fermer les autres docks exclusifs
      ['elevation-profile-dock', 'ndvi-dock', 'sim-dock'].forEach(id => {
        const d = document.getElementById(id);
        if (d) d.classList.remove('open');
      });

      this.openDock();
      this.updateParcelHeader();
      this.highlightParcel(parcel.geometry);

      // Cadrage carte sur la parcelle
      const geomBbox = this.computeGeomBbox(parcel.geometry);
      if (geomBbox && this.map) {
        this.map.fitBounds(
          [[geomBbox[0], geomBbox[1]], [geomBbox[2], geomBbox[3]]],
          { padding: { top: 60, bottom: 260, left: 60, right: 60 }, duration: 800 }
        );
      }

      // Recherche des levés LiDAR couvrant cette parcelle
      await this.discoverSurveys(geomBbox);
    }

    openDock() {
      const dock = document.getElementById('cutfill-dock');
      if (dock) {
        dock.style.display = 'flex';
        dock.classList.add('open');
      }
      this.isOpen = true;
    }

    closeDock() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this.removeRasterLayer();
      this.clearHighlight();

      const dock = document.getElementById('cutfill-dock');
      if (dock) {
        dock.classList.remove('open');
        dock.style.display = 'none';
      }
      this.isOpen = false;
      this.currentParcel = null;
      this.currentAnalysis = null;
    }

    updateParcelHeader() {
      if (!this.currentParcel) return;
      const props = this.currentParcel.properties || {};
      const pid = props.IDPAR || props.idpar || '';
      const lot = props.NO_LOT || props.no_lot || '';
      const sup = props.SUPHEC || props.suphec || '';

      const sNum = parseFloat(sup);
      const supStr = !isNaN(sNum) ? ` (${sNum.toFixed(1)} ha)` : (sup ? ` (${sup} ha)` : '');
      const name = pid ? `Parcelle nº ${pid}${supStr}` : (lot ? `Lot nº ${lot}${supStr}` : `Parcelle agricole${supStr}`);

      const nameEl = document.getElementById('cutfill-parcel-name');
      if (nameEl) nameEl.textContent = name;
    }

    /**
     * Recherche via l'API STAC de RNCan/Géo.ca tous les levés LiDAR couvrant la parcelle
     */
    async discoverSurveys(geomBbox) {
      this.setLoading(true, "Recherche des campagnes LiDAR disponibles...");
      const alertBox = document.getElementById('cutfill-alert-box');
      if (alertBox) alertBox.style.display = 'none';
      const contentWrap = document.getElementById('cutfill-content-wrap');
      if (contentWrap) contentWrap.style.display = 'block';

      const [w, s, e, n] = geomBbox;
      const pad = 0.005; // ~500m de marge
      const queryBbox = `${(w - pad).toFixed(4)},${(s - pad).toFixed(4)},${(e + pad).toFixed(4)},${(n + pad).toFixed(4)}`;

      const surveys = [];

      try {
        const stacUrl = `https://datacube.services.geo.ca/pgstac/api/collections/hrdem-lidar/items?bbox=${queryBbox}&limit=50`;
        const res = await fetch(stacUrl);
        if (res.ok) {
          const json = await res.json();
          const features = Array.isArray(json.features) ? json.features : [];

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
              surveys.push({
                id: f.id,
                label: this.formatSurveyLabel(f, year),
                url: f.assets.dtm.href,
                year: year || 2020,
                bbox: f.bbox,
                isMosaic: false
              });
            }
          }
        }
      } catch (err) {
        console.warn('Erreur requête STAC LiDAR:', err);
      }

      // Ajout de la mosaïque nationale 1 m (HRDEM) comme référence toujours disponible
      surveys.push({
        id: 'mosaic',
        label: 'Mosaïque nationale 1 m (HRDEM)',
        url: null,
        year: 2018,
        bbox: null,
        isMosaic: true
      });

      // Tri chronologique décroissant (plus récents en premier)
      surveys.sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return a.label.localeCompare(b.label);
      });

      this.availableSurveys = surveys;

      // Moins de 2 levés : impossible de comparer
      if (surveys.length < 2) {
        this.setLoading(false);
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.innerHTML = `
            <strong>Campagne unique :</strong> Un seul levé altimétrique LiDAR couvre cette parcelle.
            La comparaison différentielle de déblais / remblais nécessite au moins 2 campagnes d'acquisition à des dates différentes.
          `;
        }
        if (contentWrap) contentWrap.style.display = 'none';
        return;
      }

      // Par défaut : le levé le plus récent et le plus ancien qui ont réellement des données sur la parcelle
      this.setLoading(true, "Vérification de la couverture de chaque levé sur la parcelle...");
      const pair = await this.pickDefaultPair(geomBbox);
      if (!pair) {
        this.setLoading(false);
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.innerHTML = `<strong>Comparaison impossible :</strong> moins de deux campagnes LiDAR ont des données sur cette parcelle.`;
        }
        if (contentWrap) contentWrap.style.display = 'none';
        return;
      }

      // Remplir les sélecteurs
      this.populateSurveySelectors();

      this.selectedNewId = pair.newId;
      this.selectedOldId = pair.oldId;

      const selNew = document.getElementById('cutfill-select-new');
      if (selNew) selNew.value = this.selectedNewId;
      const selOld = document.getElementById('cutfill-select-old');
      if (selOld) selOld.value = this.selectedOldId;

      // Lancer la comparaison
      await this.runComparison();
    }

    /**
     * Échantillonne une région altimétrique (bilinéaire) à une coordonnée WGS84
     */
    sampleRegionAt(reg, lng, lat, p4) {
      if (!reg || !reg.data || !reg.sourceBBox || !p4) return NaN;
      const projDef = reg.projection || '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
      const [mX, mY] = p4('EPSG:4326', projDef, [lng, lat]);
      const sB = reg.sourceBBox;
      const u = (mX - sB[0]) / (sB[2] - sB[0]);
      const v = (sB[3] - mY) / (sB[3] - sB[1]);
      if (u < 0 || u > 1 || v < 0 || v > 1) return NaN;
      const col = u * (reg.width - 1);
      const row = v * (reg.height - 1);
      const c0 = Math.floor(col), c1 = Math.min(reg.width - 1, c0 + 1);
      const r0 = Math.floor(row), r1 = Math.min(reg.height - 1, r0 + 1);
      const fc = col - c0, fr = row - r0;
      const v00 = reg.data[r0 * reg.width + c0], v10 = reg.data[r0 * reg.width + c1];
      const v01 = reg.data[r1 * reg.width + c0], v11 = reg.data[r1 * reg.width + c1];
      if (Number.isFinite(v00) && Number.isFinite(v10) && Number.isFinite(v01) && Number.isFinite(v11)) {
        const z = (v00 * (1 - fc) + v10 * fc) * (1 - fr) + (v01 * (1 - fc) + v11 * fc) * fr;
        if (Number.isFinite(z) && z > -900 && z < 9000) return z;
      }
      return NaN;
    }

    /**
     * Mesure la part de la parcelle réellement couverte par un levé (0 à 1),
     * sur une grille de sondage légère (les rectangles STAC débordent souvent des données réelles).
     */
    async measureCoverage(survey, geomBbox, signal) {
      if (!survey || !this.currentParcel) return 0;
      const p4 = this.getProj4();
      if (!p4) return 0;
      let reg = null;
      try {
        if (survey.isMosaic) {
          reg = typeof readMultiHrdemRegion === 'function' ? await readMultiHrdemRegion(geomBbox, 64, signal, 'bilinear') : null;
        } else if (survey.url && typeof readSingleHrdemProjectRegion === 'function') {
          reg = await readSingleHrdemProjectRegion(survey.url, geomBbox, 64, signal, 'bilinear');
        }
      } catch (e) { return 0; }
      if (!reg || !reg.data || !reg.data.length) return 0;
      const geom = this.currentParcel.geometry;
      const n = 20;
      let inside = 0, ok = 0;
      for (let r = 0; r < n; r++) {
        const lat = geomBbox[3] - ((r + 0.5) / n) * (geomBbox[3] - geomBbox[1]);
        for (let c = 0; c < n; c++) {
          const lng = geomBbox[0] + ((c + 0.5) / n) * (geomBbox[2] - geomBbox[0]);
          if (!this.isPointInGeom([lng, lat], geom)) continue;
          inside++;
          if (Number.isFinite(this.sampleRegionAt(reg, lng, lat, p4))) ok++;
        }
      }
      return inside ? ok / inside : 0;
    }

    /**
     * Choisit automatiquement le levé le plus récent (« Après ») et le plus ancien (« Avant »)
     * parmi ceux qui couvrent au moins 60 % de la parcelle. La mosaïque nationale (date
     * d'acquisition inconnue) ne sert qu'en dernier recours.
     */
    async pickDefaultPair(geomBbox) {
      if (this.abortController) this.abortController.abort();
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      const MIN_COVERAGE = 0.6;

      const coverages = await Promise.all(this.availableSurveys.map((s) => this.measureCoverage(s, geomBbox, signal)));
      if (signal.aborted) return null;
      this.availableSurveys.forEach((s, i) => { s.coverage = coverages[i]; });

      const withData = this.availableSurveys.filter((s) => s.coverage >= MIN_COVERAGE);
      const real = withData.filter((s) => !s.isMosaic); // déjà triés du plus récent au plus ancien
      let newest = null, oldest = null;
      if (real.length >= 2) {
        newest = real[0];
        oldest = real[real.length - 1];
      } else {
        const mosaic = withData.find((s) => s.isMosaic);
        if (real.length === 1 && mosaic) { newest = real[0]; oldest = mosaic; }
      }

      // Libellés : signaler les levés sans données sur la parcelle
      this.availableSurveys.forEach((s) => {
        s.label = s.label.replace(/ · sans données$/, '');
        if (s.coverage < MIN_COVERAGE) s.label += ' · sans données';
      });

      if (!newest || !oldest || newest.id === oldest.id) return null;
      return { newId: newest.id, oldId: oldest.id };
    }

    formatSurveyLabel(feature, year) {
      let clean = (feature.id || 'Levé')
        .replace(/^(QC-|NRCAN-|GEOMONT-)/i, '')
        .replace(/-1m$/i, '')
        .replace(/-2m$/i, ' (2m)')
        .replace(/_/g, ' ');
      const res = feature.id.endsWith('-2m') ? '2 m' : '1 m';
      return year ? `${year} — ${clean} [${res}]` : `${clean} [${res}]`;
    }

    populateSurveySelectors() {
      const selNew = document.getElementById('cutfill-select-new');
      const selOld = document.getElementById('cutfill-select-old');
      if (!selNew || !selOld) return;

      selNew.innerHTML = '';
      selOld.innerHTML = '';

      for (const s of this.availableSurveys) {
        const opt1 = document.createElement('option');
        opt1.value = s.id;
        opt1.textContent = s.label;
        selNew.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = s.id;
        opt2.textContent = s.label;
        selOld.appendChild(opt2);
      }
    }

    swapSurveys() {
      const tmp = this.selectedNewId;
      this.selectedNewId = this.selectedOldId;
      this.selectedOldId = tmp;

      const selNew = document.getElementById('cutfill-select-new');
      if (selNew) selNew.value = this.selectedNewId;
      const selOld = document.getElementById('cutfill-select-old');
      if (selOld) selOld.value = this.selectedOldId;

      this.runComparison();
    }

    /**
     * Charge une région altimétrique pour un levé spécifique
     */
    async loadSurveyRegion(surveyId, bbox, targetSize, signal) {
      if (this.surveyRegionsCache.has(surveyId)) {
        return this.surveyRegionsCache.get(surveyId);
      }

      const survey = this.availableSurveys.find(s => s.id === surveyId);
      if (!survey) return null;

      let region = null;
      if (survey.isMosaic) {
        if (typeof readMultiHrdemRegion === 'function') {
          region = await readMultiHrdemRegion(bbox, targetSize, signal, 'bilinear');
        }
      } else if (survey.url) {
        if (typeof readSingleHrdemProjectRegion === 'function') {
          region = await readSingleHrdemProjectRegion(survey.url, bbox, targetSize, signal, 'bilinear');
        }
      }

      if (region && region.data && region.data.length > 0) {
        this.surveyRegionsCache.set(surveyId, region);
      }
      return region;
    }

    /**
     * Exécute le calcul comparatif entre les deux levés sélectionnés
     */
    async runComparison() {
      if (!this.currentParcel || !this.selectedNewId || !this.selectedOldId) return;

      if (this.selectedNewId === this.selectedOldId) {
        const alertBox = document.getElementById('cutfill-alert-box');
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.innerHTML = `<strong>Attention :</strong> Vous avez sélectionné le même levé pour « Avant » et « Après ». Veuillez choisir deux levés distincts.`;
        }
        return;
      }

      if (this.abortController) this.abortController.abort();
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      this.setLoading(true, "Téléchargement et échantillonnage des 2 levés LiDAR...");

      const geom = this.currentParcel.geometry;
      const geomBbox = this.computeGeomBbox(geom);
      if (!geomBbox) {
        this.setLoading(false);
        return;
      }

      // Marge de 10% pour l'interpolation en bordure
      const spanLng = geomBbox[2] - geomBbox[0];
      const spanLat = geomBbox[3] - geomBbox[1];
      const padLng = Math.max(0.0003, spanLng * 0.10);
      const padLat = Math.max(0.0003, spanLat * 0.10);
      const bbox = [geomBbox[0] - padLng, geomBbox[1] - padLat, geomBbox[2] + padLng, geomBbox[3] + padLat];

      const targetSize = 384; // Résolution optimale ~1m

      try {
        const [regNew, regOld] = await Promise.all([
          this.loadSurveyRegion(this.selectedNewId, bbox, targetSize, signal),
          this.loadSurveyRegion(this.selectedOldId, bbox, targetSize, signal)
        ]);

        if (signal.aborted) return;

        if (!regNew || !regNew.data || !regOld || !regOld.data) {
          throw new Error("Données altimétriques incomplètes ou indisponibles sur la parcelle pour l'un des levés.");
        }

        const p4 = this.getProj4();
        if (!p4) throw new Error("Bibliothèque proj4 requise pour la reprojection exacte.");

        // Grille unifiée d'analyse sur le rectangle englobant étendu
        const W = targetSize;
        const H = targetSize;
        const N = W * H;

        // Calcul de la résolution spatiale en mètres
        const midLat = (geomBbox[1] + geomBbox[3]) / 2;
        const mPerDegLat = 111132.0;
        const mPerDegLng = 111412.0 * Math.cos(midLat * Math.PI / 180.0);
        const cellDx = (spanLng / (W - 1)) * mPerDegLng;
        const cellDy = (spanLat / (H - 1)) * mPerDegLat;
        const cellAreaM2 = Math.abs(cellDx * cellDy);

        const zNewArr = new Float32Array(N).fill(NaN);
        const zOldArr = new Float32Array(N).fill(NaN);
        const rawDiffArr = new Float32Array(N).fill(NaN);
        const validDiffs = [];

        // Préparation de l'échantillonneur bilinéaire pour une région
        const sampleRegion = (reg, lng, lat) => {
          if (!reg || !reg.data || !reg.sourceBBox) return NaN;
          const projDef = reg.projection || '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
          const [mX, mY] = p4('EPSG:4326', projDef, [lng, lat]);
          const sB = reg.sourceBBox;
          const u = (mX - sB[0]) / (sB[2] - sB[0]);
          const v = (sB[3] - mY) / (sB[3] - sB[1]);
          if (u < 0 || u > 1 || v < 0 || v > 1) return NaN;

          const col = u * (reg.width - 1);
          const row = v * (reg.height - 1);
          const c0 = Math.floor(col);
          const c1 = Math.min(reg.width - 1, c0 + 1);
          const r0 = Math.floor(row);
          const r1 = Math.min(reg.height - 1, r0 + 1);
          const fc = col - c0;
          const fr = row - r0;

          const v00 = reg.data[r0 * reg.width + c0];
          const v10 = reg.data[r0 * reg.width + c1];
          const v01 = reg.data[r1 * reg.width + c0];
          const v11 = reg.data[r1 * reg.width + c1];

          if (Number.isFinite(v00) && Number.isFinite(v10) && Number.isFinite(v01) && Number.isFinite(v11)) {
            const z = (v00 * (1 - fc) + v10 * fc) * (1 - fr) + (v01 * (1 - fc) + v11 * fc) * fr;
            if (Number.isFinite(z) && z > -900 && z < 9000) return z;
          }
          return NaN;
        };

        // Échantillonnage pixel par pixel strictement dans le polygone de la parcelle
        for (let r = 0; r < H; r++) {
          const v_lat = r / (H - 1);
          const lat = bbox[3] - v_lat * (bbox[3] - bbox[1]);

          for (let c = 0; c < W; c++) {
            const u_lng = c / (W - 1);
            const lng = bbox[0] + u_lng * (bbox[2] - bbox[0]);
            const idx = r * W + c;

            // Découpage strict au périmètre de la parcelle
            if (!this.isPointInGeom([lng, lat], geom)) continue;

            const valNew = sampleRegion(regNew, lng, lat);
            const valOld = sampleRegion(regOld, lng, lat);

            if (Number.isFinite(valNew) && Number.isFinite(valOld)) {
              zNewArr[idx] = valNew;
              zOldArr[idx] = valOld;
              const diff = valNew - valOld; // Brut : Après - Avant
              rawDiffArr[idx] = diff;
              validDiffs.push(diff);
            }
          }
        }

        if (validDiffs.length < 50) {
          throw new Error("Chevauchement insuffisant de points valides entre les deux levés sur cette parcelle.");
        }

        // Calcul du biais de datum géodésique / calage altimétrique (médiane robuste)
        validDiffs.sort((a, b) => a - b);
        const medianOffset = validDiffs[Math.floor(validDiffs.length / 2)];
        this.calibrationOffsetM = medianOffset;

        this.currentAnalysis = {
          W,
          H,
          bbox,
          geomBbox,
          cellAreaM2,
          zNewArr,
          zOldArr,
          rawDiffArr,
          validCount: validDiffs.length,
          calibratedDiffArr: new Float32Array(N).fill(NaN),
          medianOffsetM: medianOffset,
          stats: null
        };

        // Application du calibrage et calcul des déblais/remblais
        this.applyRecalibration();
        this.setLoading(false);

      } catch (err) {
        if (signal.aborted) return;
        this.setLoading(false);
        console.error('Erreur calcul comparaison LiDAR:', err);
        const alertBox = document.getElementById('cutfill-alert-box');
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.innerHTML = `<strong>Erreur :</strong> ${err.message || "Impossible de comparer ces deux levés."}`;
        }
      }
    }

    /**
     * Applique la compensation du biais altimétrique et met à jour le rendu et les scorecards
     */
    applyRecalibration() {
      if (!this.currentAnalysis) return;
      const { W, H, rawDiffArr, calibratedDiffArr, cellAreaM2, medianOffsetM } = this.currentAnalysis;
      const N = W * H;

      // Décalage effectif : médiane automatique si cochée + offset manuel
      const effectiveOffset = (this.autoCalibrate ? medianOffsetM : 0.0) + (this.manualOffsetCm / 100.0);

      const offsetBadge = document.getElementById('cutfill-offset-badge');
      if (offsetBadge) {
        const cmVal = (effectiveOffset * 100.0).toFixed(1);
        const sign = effectiveOffset >= 0 ? '+' : '';
        offsetBadge.textContent = `Biais corrigé : ${sign}${cmVal} cm`;
        offsetBadge.style.color = this.autoCalibrate ? '#1f4d37' : '#5b6660';
        offsetBadge.style.background = this.autoCalibrate ? '#e6f0ea' : '#f4f5f2';
      }

      let totalCutM3 = 0.0;
      let totalFillM3 = 0.0;
      let maxCutM = 0.0;
      let maxFillM = 0.0;
      let validCells = 0;

      // Compteurs par classe (9 classes)
      const classStats = CUT_FILL_CLASSES.map(c => ({ count: 0, volM3: 0 }));

      for (let i = 0; i < N; i++) {
        const raw = rawDiffArr[i];
        if (!Number.isFinite(raw)) {
          calibratedDiffArr[i] = NaN;
          continue;
        }

        const d = raw - effectiveOffset;
        calibratedDiffArr[i] = d;
        validCells++;

        // Déblai : d < -0.025 m (-2.5 cm)
        if (d < -0.025) {
          const depth = Math.abs(d);
          totalCutM3 += depth * cellAreaM2;
          if (depth > maxCutM) maxCutM = depth;
        }
        // Remblai : d > +0.025 m (+2.5 cm)
        else if (d > 0.025) {
          const depth = d;
          totalFillM3 += depth * cellAreaM2;
          if (depth > maxFillM) maxFillM = depth;
        }

        // Classification dans les 9 classes Ektare
        for (let k = 0; k < CUT_FILL_CLASSES.length; k++) {
          if (d <= CUT_FILL_CLASSES[k].max) {
            classStats[k].count++;
            if (d < -0.025) classStats[k].volM3 += Math.abs(d) * cellAreaM2;
            else if (d > 0.025) classStats[k].volM3 += d * cellAreaM2;
            break;
          }
        }
      }

      const totalAreaM2 = validCells * cellAreaM2;
      const areaHa = totalAreaM2 / 10000.0;
      const cutPerHa = areaHa > 0 ? Math.round(totalCutM3 / areaHa) : 0;
      const fillPerHa = areaHa > 0 ? Math.round(totalFillM3 / areaHa) : 0;
      const netBalanceM3 = Math.round(totalFillM3 - totalCutM3);

      this.currentAnalysis.stats = {
        areaHa,
        cutPerHa,
        fillPerHa,
        totalCutM3: Math.round(totalCutM3),
        totalFillM3: Math.round(totalFillM3),
        netBalanceM3,
        maxCutCm: Math.round(maxCutM * 100.0),
        maxFillCm: Math.round(maxFillM * 100.0),
        classStats
      };

      // Mettre à jour les indicateurs UI et la table
      this.updateScorecards();
      this.updateDetailsTable();

      // Rendre et afficher la couche sur MapLibre
      this.renderCutFillMapLayer();
    }

    updateScorecards() {
      if (!this.currentAnalysis || !this.currentAnalysis.stats) return;
      const s = this.currentAnalysis.stats;

      const elCutPerHa = document.getElementById('cutfill-stat-cut-per-ha');
      if (elCutPerHa) elCutPerHa.textContent = s.cutPerHa.toLocaleString('fr-CA');

      const elCutVol = document.getElementById('cutfill-stat-cut-vol');
      if (elCutVol) elCutVol.textContent = s.totalCutM3.toLocaleString('fr-CA');

      const elCutMax = document.getElementById('cutfill-stat-cut-max');
      if (elCutMax) elCutMax.textContent = `Max coupe : ${s.maxCutCm} cm`;

      const elFillVol = document.getElementById('cutfill-stat-fill-vol');
      if (elFillVol) elFillVol.textContent = s.totalFillM3.toLocaleString('fr-CA');

      const elFillMax = document.getElementById('cutfill-stat-fill-max');
      if (elFillMax) elFillMax.textContent = `Max remblai : ${s.maxFillCm} cm`;

      const elNet = document.getElementById('cutfill-stat-net-bal');
      if (elNet) {
        const sign = s.netBalanceM3 > 0 ? '+' : '';
        elNet.textContent = `${sign}${s.netBalanceM3.toLocaleString('fr-CA')}`;
        elNet.style.color = s.netBalanceM3 > 0 ? '#1d4ed8' : (s.netBalanceM3 < 0 ? '#b91c1c' : '#334155');
      }

      const elArea = document.getElementById('cutfill-stat-area');
      if (elArea) elArea.textContent = `Surface : ${s.areaHa.toFixed(1)} ha`;
    }

    updateDetailsTable() {
      if (!this.currentAnalysis || !this.currentAnalysis.stats) return;
      const { validCount, cellAreaM2, stats } = this.currentAnalysis;
      const { classStats, areaHa } = stats;
      const tbody = document.getElementById('cutfill-tbody');
      if (!tbody) return;

      tbody.innerHTML = '';
      const totalCells = validCount || 1;

      for (let k = 0; k < CUT_FILL_CLASSES.length; k++) {
        const c = CUT_FILL_CLASSES[k];
        const st = classStats[k];
        const pct = ((st.count / totalCells) * 100).toFixed(1);
        const subHa = ((st.count * cellAreaM2) / 10000.0).toFixed(2);
        const volStr = st.volM3 > 0 ? Math.round(st.volM3).toLocaleString('fr-CA') : '—';

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #f1f5f9';
        tr.innerHTML = `
          <td style="padding: 3px 6px; display: flex; align-items: center; gap: 5px;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${c.hex};"></span>
            <strong>${c.label}</strong>
          </td>
          <td style="padding: 3px 6px; color: #475569;">${c.sub}</td>
          <td style="padding: 3px 6px; font-weight: 600;">${subHa} ha</td>
          <td style="padding: 3px 6px; color: #64748b;">${pct} %</td>
          <td style="padding: 3px 6px; font-weight: 700; color: ${k < 4 ? '#b91c1c' : (k > 4 ? '#1d4ed8' : '#15803d')};">${volStr}</td>
        `;
        tbody.appendChild(tr);
      }
    }

    /**
     * Rendu graphique de la carte 9 classes et injection dans MapLibre
     */
    renderCutFillMapLayer() {
      if (!this.map || !this.currentAnalysis) return;
      const { W, H, bbox, calibratedDiffArr } = this.currentAnalysis;

      this.canvas.width = W;
      this.canvas.height = H;
      const imgData = this.ctx.createImageData(W, H);
      const px = imgData.data;

      for (let i = 0; i < W * H; i++) {
        const d = calibratedDiffArr[i];
        const o = i * 4;

        if (!Number.isFinite(d)) {
          px[o + 3] = 0; // Transparent en dehors de la parcelle
          continue;
        }

        // Trouver la classe correspondante
        let matched = CUT_FILL_CLASSES[CUT_FILL_CLASSES.length - 1];
        for (let k = 0; k < CUT_FILL_CLASSES.length; k++) {
          if (d <= CUT_FILL_CLASSES[k].max) {
            matched = CUT_FILL_CLASSES[k];
            break;
          }
        }

        px[o] = matched.r;
        px[o + 1] = matched.g;
        px[o + 2] = matched.b;
        px[o + 3] = 230; // 90% d'opacité de base sur le canvas
      }

      this.ctx.putImageData(imgData, 0, 0);
      const dataUrl = this.canvas.toDataURL();

      // Coordonnées MapLibre : [NW, NE, SE, SW]
      const coords = [
        [bbox[0], bbox[3]], // Top-Left (NW)
        [bbox[2], bbox[3]], // Top-Right (NE)
        [bbox[2], bbox[1]], // Bottom-Right (SE)
        [bbox[0], bbox[1]]  // Bottom-Left (SW)
      ];

      // Mise à jour ou création de la source image
      if (this.map.getSource(this.SRC_RASTER)) {
        this.map.getSource(this.SRC_RASTER).updateImage({ url: dataUrl, coordinates: coords });
      } else {
        this.map.addSource(this.SRC_RASTER, {
          type: 'image',
          url: dataUrl,
          coordinates: coords
        });

        const beforeLayer = this.map.getLayer(this.LAYER_HL) ? this.LAYER_HL : undefined;
        this.map.addLayer({
          id: this.LAYER_RASTER,
          type: 'raster',
          source: this.SRC_RASTER,
          paint: {
            'raster-opacity': this.opacity,
            'raster-fade-duration': 0,
            'raster-resampling': 'linear'
          }
        }, beforeLayer);
      }

      this.bringToFront();
    }

    removeRasterLayer() {
      if (!this.map) return;
      if (this.map.getLayer(this.LAYER_RASTER)) {
        this.map.removeLayer(this.LAYER_RASTER);
      }
      if (this.map.getSource(this.SRC_RASTER)) {
        this.map.removeSource(this.SRC_RASTER);
      }
    }

    highlightParcel(geom) {
      if (!this.map || !geom) return;
      const geojson = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: geom, properties: {} }]
      };

      if (!this.map.getSource(this.SRC_HL)) {
        this.map.addSource(this.SRC_HL, { type: 'geojson', data: geojson });
        this.map.addLayer({
          id: this.LAYER_HL,
          type: 'line',
          source: this.SRC_HL,
          paint: {
            'line-color': '#7c3aed', // Violet contrastant
            'line-width': 3.0,
            'line-opacity': 0.95
          }
        });
      } else {
        this.map.getSource(this.SRC_HL).setData(geojson);
        this.map.setLayoutProperty(this.LAYER_HL, 'visibility', 'visible');
      }
    }

    clearHighlight() {
      if (this.map && this.map.getLayer(this.LAYER_HL)) {
        this.map.setLayoutProperty(this.LAYER_HL, 'visibility', 'none');
      }
    }

    bringToFront() {
      if (!this.map || !this.isOpen) return;
      if (this.map.getLayer(this.LAYER_RASTER)) {
        this.map.moveLayer(this.LAYER_RASTER);
      }
      if (this.map.getLayer(this.LAYER_HL)) {
        this.map.moveLayer(this.LAYER_HL);
      }
    }

    /**
     * Inspecteur au survol de la souris
     */
    handleMapMouseMove(e) {
      if (!this.isOpen || !this.currentAnalysis || !e.lngLat) return;
      const readout = document.getElementById('cutfill-hover-readout');
      if (!readout) return;

      const { W, H, bbox, calibratedDiffArr, zNewArr, zOldArr } = this.currentAnalysis;
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;

      if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) {
        readout.textContent = "Survolez la parcelle pour inspecter les déblais/remblais";
        readout.style.color = '#475569';
        return;
      }

      const u = (lng - bbox[0]) / (bbox[2] - bbox[0]);
      const v = (bbox[3] - lat) / (bbox[3] - bbox[1]);
      if (u < 0 || u > 1 || v < 0 || v > 1) return;

      const col = Math.round(u * (W - 1));
      const row = Math.round(v * (H - 1));
      const idx = row * W + col;

      const d = calibratedDiffArr[idx];
      if (!Number.isFinite(d)) {
        readout.textContent = "Hors parcelle";
        readout.style.color = '#94a3b8';
        return;
      }

      const zNew = zNewArr[idx];
      const zOld = zOldArr[idx];
      const cmVal = Math.round(Math.abs(d) * 100.0);

      const selNew = document.getElementById('cutfill-select-new');
      const selOld = document.getElementById('cutfill-select-old');
      const labelNew = selNew ? selNew.options[selNew.selectedIndex]?.text.split('—')[0].trim() : 'Récent';
      const labelOld = selOld ? selOld.options[selOld.selectedIndex]?.text.split('—')[0].trim() : 'Ancien';

      if (d < -0.025) {
        readout.innerHTML = `<span style="color:#b91c1c; font-weight:700;">Déblai : −${cmVal} cm</span> &nbsp;|&nbsp; ${labelNew}: ${zNew.toFixed(2)}m &nbsp;|&nbsp; ${labelOld}: ${zOld.toFixed(2)}m`;
      } else if (d > 0.025) {
        readout.innerHTML = `<span style="color:#1d4ed8; font-weight:700;">Remblai : +${cmVal} cm</span> &nbsp;|&nbsp; ${labelNew}: ${zNew.toFixed(2)}m &nbsp;|&nbsp; ${labelOld}: ${zOld.toFixed(2)}m`;
      } else {
        readout.innerHTML = `<span style="color:#15803d; font-weight:800;">⚖️ Neutre : 0 cm (±2,5 cm)</span> &nbsp;|&nbsp; ${labelNew}: ${zNew.toFixed(2)}m &nbsp;|&nbsp; ${labelOld}: ${zOld.toFixed(2)}m`;
      }
    }

    /**
     * Exporte la grille différentielle en fichier GeoTIFF métrique UTM (.tif)
     */
    async exportDifferentialGeoTiff() {
      if (!this.currentParcel || !this.currentAnalysis) {
        alert("Veuillez d'abord calculer une comparaison sur une parcelle.");
        return;
      }

      const btn = document.getElementById('btn-cutfill-export-tif');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>Export TIF...</span>`;
      }

      try {
        const p4 = this.getProj4();
        if (!p4) throw new Error("proj4 indisponible.");

        const geom = this.currentParcel.geometry;
        const geomBbox = this.computeGeomBbox(geom);
        const midLng = (geomBbox[0] + geomBbox[2]) / 2;
        const utmZone = midLng < -72.0 ? 18 : 19;
        const utmEpsg = midLng < -72.0 ? 32618 : 32619;
        const utmDef = `+proj=utm +zone=${utmZone} +datum=WGS84 +units=m +no_defs`;

        // Bornes UTM
        let utmMinX = Infinity, utmMaxX = -Infinity;
        let utmMinY = Infinity, utmMaxY = -Infinity;

        const walk = (coords) => {
          if (typeof coords[0] === 'number') {
            const pt = p4('EPSG:4326', utmDef, coords);
            if (pt[0] < utmMinX) utmMinX = pt[0];
            if (pt[0] > utmMaxX) utmMaxX = pt[0];
            if (pt[1] < utmMinY) utmMinY = pt[1];
            if (pt[1] > utmMaxY) utmMaxY = pt[1];
            return;
          }
          for (const item of coords) walk(item);
        };
        walk(geom.coordinates);

        const res = 1.0; // 1 mètre de résolution
        const gridW = Math.max(16, Math.round((utmMaxX - utmMinX) / res));
        const gridH = Math.max(16, Math.round((utmMaxY - utmMinY) / res));

        const outData = new Float32Array(gridW * gridH).fill(-9999.0);
        const { W, H, bbox, calibratedDiffArr } = this.currentAnalysis;

        for (let r = 0; r < gridH; r++) {
          const y_utm = utmMaxY - (r + 0.5) * res;
          for (let c = 0; c < gridW; c++) {
            const x_utm = utmMinX + (c + 0.5) * res;
            const [lng, lat] = p4(utmDef, 'EPSG:4326', [x_utm, y_utm]);

            if (!this.isPointInGeom([lng, lat], geom)) continue;

            const u = (lng - bbox[0]) / (bbox[2] - bbox[0]);
            const v = (bbox[3] - lat) / (bbox[3] - bbox[1]);
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;

            const col = Math.round(u * (W - 1));
            const row = Math.round(v * (H - 1));
            const d = calibratedDiffArr[row * W + col];

            if (Number.isFinite(d)) {
              outData[r * gridW + c] = d;
            }
          }
        }

        let tiffBuffer = null;
        if (window.terrain3DManager && typeof window.terrain3DManager.buildUtmGeoTiffBuffer === 'function') {
          tiffBuffer = window.terrain3DManager.buildUtmGeoTiffBuffer(outData, gridW, gridH, utmMinX, utmMaxY, res, utmEpsg, -9999.0);
        } else if (typeof window.buildUtmGeoTiffBuffer === 'function') {
          tiffBuffer = window.buildUtmGeoTiffBuffer(outData, gridW, gridH, utmMinX, utmMaxY, res, utmEpsg, -9999.0);
        } else {
          throw new Error("Générateur GeoTIFF indisponible.");
        }

        const props = this.currentParcel.properties || {};
        const pid = props.IDPAR || props.idpar || 'parcelle';
        const fileName = `deblais_remblais_${pid}_lidar.tif`;

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
        console.error('Erreur export GeoTIFF D/R:', err);
        alert(err.message || "Erreur lors de l'exportation GeoTIFF.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      }
    }

    setLoading(loading, text = "") {
      const bar = document.getElementById('cutfill-loading-bar');
      const textEl = document.getElementById('cutfill-loading-text');
      if (bar) bar.style.display = loading ? 'block' : 'none';
      if (textEl && text) textEl.textContent = text;
    }

    computeGeomBbox(geom) {
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
  }

  root.LidarCutFillManager = LidarCutFillManager;
})(window);
