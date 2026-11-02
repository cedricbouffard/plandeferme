/**
 * Plan de Ferme — Module de simulation de pluie et d'érosion des sols (RUSLE)
 * 
 * Intègre les modèles hydrodynamiques et agronomiques d'Ektare :
 * - Simulation de pluie : pluie animée, infiltration (Horton), écoulement gravitationnel
 *   sur MNT LiDAR 1m, traçage des thalwegs et remplissage/débordement des cuvettes.
 * - Érosion des sols (RUSLE) : calcul des pertes de sol annuelles A = R · K · LS · C · P (t/ha/an),
 *   facteur LS topographique selon Moore & Burch (1986) avec accumulation multidirectionnelle (Freeman 1.1).
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
    [Infinity, [168, 32, 90], "Très sévère (> 22 t/ha/an)"]
  ];

  // Types de sols et paramètres hydropédologiques
  const SOIL_TYPES = {
    loam: { name: "Loam (de référence)", k: 0.040, f: 8 },
    sandy_loam: { name: "Loam sableux", k: 0.026, f: 15 },
    sand: { name: "Sable", k: 0.015, f: 25 },
    silt_loam: { name: "Loam limoneux", k: 0.048, f: 6 },
    clay_loam: { name: "Loam argileux", k: 0.035, f: 4 },
    clay: { name: "Argile", k: 0.028, f: 2 }
  };

  // Couvert végétal et facteurs C
  const CROP_FACTORS = {
    bare: { name: "Sol nu (C = 1,00)", c: 1.0 },
    corn_plow: { name: "Maïs grain labour (C = 0,38)", c: 0.38 },
    corn_notill: { name: "Maïs semis direct (C = 0,15)", c: 0.15 },
    soybean: { name: "Soya (C = 0,28)", c: 0.28 },
    cereals: { name: "Céréales (C = 0,12)", c: 0.12 },
    hay: { name: "Prairie / Foin (C = 0,02)", c: 0.02 },
    potato: { name: "Pomme de terre (C = 0,35)", c: 0.35 }
  };

  // Pratiques culturales et facteurs P
  const PRACTICE_FACTORS = {
    none: { name: "Sens de la pente (P = 1,00)", p: 1.0 },
    contour: { name: "Travail en contour (P = 0,75)", p: 0.75 },
    strip: { name: "Cultures en bandes (P = 0,50)", p: 0.50 }
  };

  class ParcelSimulationManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.currentParcel = null;
      this.currentGrid = null;
      this.activeTab = "rain"; // "rain" ou "erosion"
      this.isOpen = false;
      this.isLoading = false;

      // Options de simulation
      this.intensity = 40; // mm/h
      this.speed = 4; // x1, x4, x16
      this.soilKey = "loam";
      this.cropKey = "bare";
      this.practiceKey = "none";
      this.rFactor = 1200; // MJ·mm/(ha·h·an)
      this.showErosionMap = true;

      // États internes
      this.sim = null; // État de simulation de pluie
      this.eroResult = null; // Résultats RUSLE
      this.rafId = 0;
      this.abortController = null;

      // Identifiants des couches MapLibre
      this.SRC_RAIN = "sim-rain-source";
      this.LAYER_RAIN = "sim-rain-layer";
      this.SRC_ERO = "sim-erosion-source";
      this.LAYER_ERO = "sim-erosion-layer";
      this.SRC_HL = "sim-parcel-hl-source";
      this.LAYER_HL = "sim-parcel-hl-layer";

      this.initDom();
    }

    // -------------------------------------------------------------------------
    // Initialisation du DOM et des écouteurs
    // -------------------------------------------------------------------------
    initDom() {
      // Boutons du header du dock
      const btnClose = document.getElementById("btn-close-sim-dock");
      const btnCollapse = document.getElementById("btn-collapse-sim-dock");
      const tabRain = document.getElementById("btn-sim-tab-rain");
      const tabEro = document.getElementById("btn-sim-tab-erosion");

      if (btnClose) btnClose.addEventListener("click", () => this.closeDock());
      if (btnCollapse) {
        btnCollapse.addEventListener("click", () => {
          const dock = document.getElementById("sim-dock");
          if (dock) dock.classList.toggle("collapsed");
        });
      }

      if (tabRain) {
        tabRain.addEventListener("click", () => this.switchTab("rain"));
      }
      if (tabEro) {
        tabEro.addEventListener("click", () => this.switchTab("erosion"));
      }

      // Contrôles Pluie
      const btnPlay = document.getElementById("btn-sim-rain-play");
      const btnReset = document.getElementById("btn-sim-rain-reset");
      const rngIntensity = document.getElementById("sim-rain-intensity");
      const selSoil = document.getElementById("sim-rain-soil");

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

      if (rngIntensity) {
        rngIntensity.addEventListener("input", (e) => {
          this.intensity = Number(e.target.value);
          const valEl = document.getElementById("sim-rain-intensity-val");
          if (valEl) valEl.textContent = `${this.intensity} mm/h`;
          this.syncRainHint();
        });
      }

      if (selSoil) {
        selSoil.addEventListener("change", (e) => {
          this.soilKey = e.target.value;
          this.syncRainHint();
          if (this.activeTab === "erosion") this.computeErosion();
        });
      }

      // Vitesse ×1, ×4, ×16
      document.querySelectorAll(".sim-speed-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const s = Number(btn.dataset.speed) || 1;
          this.speed = s;
          document.querySelectorAll(".sim-speed-btn").forEach((b) => {
            const match = Number(b.dataset.speed) === s;
            b.classList.toggle("active", match);
            b.style.fontWeight = match ? "700" : "normal";
            b.style.borderColor = match ? "#0284c7" : "#cbd5e1";
            b.style.background = match ? "#e0f2fe" : "#ffffff";
            b.style.color = match ? "#0284c7" : "#0f172a";
          });
        });
      });

      // Contrôles Érosion
      const chkEroMap = document.getElementById("sim-ero-show-map");
      const inpR = document.getElementById("sim-ero-r");
      const selCrop = document.getElementById("sim-ero-crop");
      const selPractice = document.getElementById("sim-ero-practice");
      const btnRecompute = document.getElementById("btn-sim-ero-recompute");

      if (chkEroMap) {
        chkEroMap.addEventListener("change", (e) => {
          this.showErosionMap = e.target.checked;
          this.renderErosionLayer();
        });
      }

      if (inpR) {
        inpR.addEventListener("change", (e) => {
          this.rFactor = Math.max(0, Number(e.target.value) || 1200);
          this.computeErosion();
        });
      }

      if (selCrop) {
        selCrop.addEventListener("change", (e) => {
          this.cropKey = e.target.value;
          this.computeErosion();
        });
      }

      if (selPractice) {
        selPractice.addEventListener("change", (e) => {
          this.practiceKey = e.target.value;
          this.computeErosion();
        });
      }

      if (btnRecompute) {
        btnRecompute.addEventListener("click", () => this.computeErosion());
      }
    }

    // -------------------------------------------------------------------------
    // Lancement de la simulation sur une parcelle
    // -------------------------------------------------------------------------
    async startSimulation(parcelFeature, preferredMode = "rain") {
      if (!parcelFeature || !parcelFeature.geometry) return;

      // Fermeture des autres docks éventuels (NDVI, profil)
      const pDock = document.getElementById("elevation-profile-dock");
      if (pDock) pDock.classList.remove("open");
      const nDock = document.getElementById("ndvi-dock");
      if (nDock) nDock.classList.remove("open");

      this.currentParcel = this.assembleParcel(parcelFeature);
      this.openDock();
      this.switchTab(preferredMode);
      this.updateParcelHeader();
      this.highlightParcel(this.currentParcel.geometry);

      // Zoom doux sur la parcelle
      const bbox = this.computeBbox(this.currentParcel.geometry);
      if (bbox && this.map) {
        this.map.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: { top: 60, bottom: 220, left: 60, right: 60 }, duration: 800 }
        );
      }

      // Préparation du modèle de terrain (grille)
      this.setLoading(true);
      try {
        await this.prepareGrid();
        this.setLoading(false);

        // Calcul initial de l'érosion
        this.computeErosion();

        if (preferredMode === "rain") {
          this.playRain();
        } else {
          this.renderErosionLayer();
        }
      } catch (err) {
        this.setLoading(false);
        console.error("Erreur lors de la préparation de la simulation :", err);
        const hintEl = document.getElementById("sim-rain-hint");
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">⚠️ ${err.message || "Erreur de chargement des données altimétriques LiDAR."}</span>`;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Récupération et préparation du MNT de la parcelle
    // -------------------------------------------------------------------------
    async prepareGrid() {
      if (!this.currentParcel || !this.currentParcel.geometry) {
        throw new Error("Aucune parcelle sélectionnée.");
      }

      const geom = this.currentParcel.geometry;
      const geomBbox = this.computeBbox(geom);
      if (!geomBbox) {
        throw new Error("Contour géométrique de parcelle invalide.");
      }

      // Marge de 10% autour de la parcelle pour les calculs de gradient
      const spanLng = geomBbox[2] - geomBbox[0];
      const spanLat = geomBbox[3] - geomBbox[1];
      const padLng = Math.max(0.0004, spanLng * 0.10);
      const padLat = Math.max(0.0004, spanLat * 0.10);
      const bbox = [geomBbox[0] - padLng, geomBbox[1] - padLat, geomBbox[2] + padLng, geomBbox[3] + padLat];

      const targetSize = 160; // 160x160 = excellente fidélité et 60 FPS fluide
      let region = null;

      // Projet personnalisé ou import direct
      const isCustomProject = window.topoManager && window.topoManager.selectedProjectId !== "default" && window.topoManager.selectedProjectUrl;
      const projectUrl = isCustomProject ? window.topoManager.selectedProjectUrl : null;

      if (this.abortController) this.abortController.abort();
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

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

      // Conversion des coordonnées grille -> WGS84
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

      // Masquage STRICT selon la géométrie du polygone de la parcelle
      const N = W * H;
      const zRaw = region.data;
      const zMasked = new Float32Array(N).fill(NaN);
      let validInside = 0;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const v = zRaw[i];
          if (!Number.isFinite(v) || v <= -900 || v >= 9000) continue;

          const pt = pos(x, y);
          if (this.isPointInGeom(pt, geom)) {
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
        key: `sim-${Date.now()}`
      };

      // Double lissage 3x3 pour supprimer le micro-bruit LiDAR et les artefacts de scan
      this.currentGrid = this.smooth3(this.smooth3(gridObj));
      this.resetRain();
    }

    // -------------------------------------------------------------------------
    // Lissage et remplissage des cuvettes (Priority Flood)
    // -------------------------------------------------------------------------
    smooth3(G) {
      const { W, H, z } = G;
      const out = new Float32Array(z.length).fill(NaN);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (Number.isNaN(z[i])) continue;
          let sum = 0, count = 0;
          for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) {
            for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
              const val = z[yy * W + xx];
              if (!Number.isNaN(val)) {
                sum += val;
                count++;
              }
            }
          }
          out[i] = sum / count;
        }
      }
      return Object.assign({}, G, { z: out });
    }

    fillDepressions(z, W, H, eps = 1e-4) {
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

    // -------------------------------------------------------------------------
    // Moteur de simulation de pluie (gouttes, écoulement, cuvettes)
    // -------------------------------------------------------------------------
    newRainSim(G) {
      const { W, H } = G;
      const N = W * H;
      const S = Math.max(2, Math.min(6, Math.floor(960 / Math.max(W, H))));

      const canvas = document.createElement("canvas");
      canvas.width = W * S;
      canvas.height = H * S;

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
        water: new Float32Array(N), // Eau stockée dans les cuvettes (m)
        flow: new Float32Array(N),  // Trace récente de passage de l'eau
        shown: new Float32Array(N), // Lissage temporel pour l'affichage
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
      const { W, H, z } = s.G;
      if (x < 0 || y < 0 || x >= W || y >= H) return NaN;
      const i = y * W + x;
      return z[i] + s.water[i];
    }

    gradient(s, x, y) {
      const c = this.surf(s, x, y);
      let l = this.surf(s, x - 1, y), r = this.surf(s, x + 1, y);
      let u = this.surf(s, x, y - 1), d = this.surf(s, x, y + 1);
      const drop = 0.05;
      if (Number.isNaN(l)) l = c - drop;
      if (Number.isNaN(r)) r = c - drop;
      if (Number.isNaN(u)) u = c - drop;
      if (Number.isNaN(d)) d = c - drop;
      return [(r - l) / (2 * s.G.dx), (d - u) / (2 * s.G.dy)];
    }

    rainStep(s, dt) {
      const { W, H, dx, dy, z } = s.G;
      const cell = dx * dy;
      const I = this.intensity;
      const soil = SOIL_TYPES[this.soilKey] || SOIL_TYPES.loam;
      const f = soil.f; // infiltration en mm/h

      const excess = Math.max(0, I - f) / 1000 / 3600; // m/s en ruissellement
      s.time += dt;
      s.rain += (I / 1000 / 3600) * dt * s.active * cell;
      s.inf += (Math.min(I, f) / 1000 / 3600) * dt * s.active * cell;

      // Génération des nouvelles gouttes
      if (excess > 0) {
        const vol = excess * dt * s.active * cell;
        const n = Math.max(1, Math.round(Math.min(800, s.active * 0.004)));
        const v = vol / n;
        for (let k = 0; k < n; k++) {
          if (s.drops.length >= 8000) {
            s.drops[(Math.random() * s.drops.length) | 0].v += v;
            continue;
          }
          const i = s.cells[(Math.random() * s.cells.length) | 0];
          const x = (i % W) + Math.random();
          const y = ((i / W) | 0) + Math.random();
          s.drops.push({ x, y, vx: 0, vy: 0, v, age: 0 });
        }
      }

      // Mouvement des gouttes (inertie, gravité, frottement)
      const keep = [];
      for (const p of s.drops) {
        const cx = p.x | 0, cy = p.y | 0;
        const i = cy * W + cx;
        const [gx, gy] = this.gradient(s, cx, cy);
        const slope = Math.hypot(gx, gy);

        const a = 0.9;
        const push = Math.min(1, 0.25 + slope * 300) * a * 0.22;
        p.vx = p.vx * 0.8 - (slope > 1e-6 ? gx / slope : 0) * push;
        p.vy = p.vy * 0.8 - (slope > 1e-6 ? gy / slope : 0) * push;

        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 0.9) { p.vx *= 0.9 / sp; p.vy *= 0.9 / sp; }

        s.flow[i] += p.v / cell;
        p.age++;

        // Ralentissement ou cuvette : dépôt
        if ((sp < 0.03 || slope < 2e-5) && p.age > 3) {
          s.water[i] += p.v / cell;
          s.wetList.add(i);
          continue;
        }

        p.x += p.vx;
        p.y += p.vy;
        const nx = p.x | 0, ny = p.y | 0;
        if (p.x < 0 || p.y < 0 || nx >= W || ny >= H || Number.isNaN(z[ny * W + nx])) {
          s.out += p.v; // Sortie du champ
          continue;
        }
        if (p.age > 3500) {
          s.water[i] += p.v / cell;
          s.wetList.add(i);
          continue;
        }
        keep.push(p);
      }
      s.drops = keep;

      // Étalement et débordement des cuvettes
      const infil = (f / 1000 / 3600) * dt;
      const nextWet = new Set();
      for (const i of s.wetList) {
        let w = s.water[i];
        if (w <= 0) continue;
        const take = Math.min(w, infil);
        w -= take;
        s.inf += take * cell;

        const x = i % W, y = (i / W) | 0;
        const h = z[i] + w;

        for (const [xx, yy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const j = yy * W + xx;
          const outside = (xx < 0 || yy < 0 || xx >= W || yy >= H || Number.isNaN(z[j]));
          const hn = outside ? -Infinity : z[j] + s.water[j];
          if (hn >= h) continue;

          const mv = outside ? w * 0.25 : Math.min(w, (h - hn) * 0.25);
          if (mv <= 0) continue;
          w -= mv;
          if (outside) {
            s.out += mv * cell;
          } else {
            s.water[j] += mv;
            if (s.water[j] > 1e-5) nextWet.add(j);
          }
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

      // 97e centile pour isoler les axes d'écoulement préférentiels (thalwegs)
      if (!(s.frame++ % 10) || !s.ref) {
        const sample = [];
        for (let k = 0; k < 5000; k++) {
          const i = s.cells[(Math.random() * s.cells.length) | 0];
          sample.push(s.flow[i]);
        }
        sample.sort((a, b) => a - b);
        const r = Math.max(1e-9, sample[Math.floor(sample.length * 0.97)] || 0);
        s.ref = s.ref ? s.ref * 0.85 + r * 0.15 : r;
      }
      const ref = s.ref;

      for (let i = 0; i < N; i++) {
        s.flow[i] *= 0.99; // Estompage progressif
        const w = s.water[i];
        const f = s.flow[i] / ref;
        const o = i * 4;

        const target = w > 0.002 ? 2 + Math.min(1, w / 0.15) : f > 0.6 ? Math.min(1, (f - 0.6) / 3) : -0.0001;
        const v = (s.shown[i] = s.shown[i] * 0.9 + target * 0.1);

        if (v >= 2) {
          // Cuvette : bleu soutenu à profond selon la hauteur d'eau
          const k = Math.min(1, v - 2);
          px[o] = 40 - 30 * k;
          px[o + 1] = 120 - 70 * k;
          px[o + 2] = 240 - 40 * k;
          px[o + 3] = 160 + 90 * k;
        } else if (v > 0.02) {
          // Thalweg / écoulement : cyan lumineux
          const k = Math.min(1, v);
          px[o] = 30 + 170 * k;
          px[o + 1] = 160 + 90 * k;
          px[o + 2] = 255;
          px[o + 3] = 70 + 185 * k;
        } else if (!Number.isNaN(s.G.z[i])) {
          // Voile sombre subtil sur la parcelle pour mettre en valeur les filets d'eau
          px[o] = 10;
          px[o + 1] = 18;
          px[o + 2] = 35;
          px[o + 3] = 95;
        } else {
          px[o + 3] = 0;
        }
      }

      s.sctx.putImageData(s.img, 0, 0);

      const c = s.ctx;
      const S = s.S;
      c.clearRect(0, 0, s.canvas.width, s.canvas.height);
      c.imageSmoothingEnabled = true;
      c.drawImage(s.small, 0, 0, W * S, H * S);

      // Halo lumineux pour un rendu visuel d'eau réaliste
      if ("filter" in c) {
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.25;
        c.filter = `blur(${Math.max(2, S)}px)`;
        c.drawImage(s.small, 0, 0, W * S, H * S);
        c.restore();
      }

      // Gouttes de pluie tombantes
      c.fillStyle = "rgba(225, 245, 255, 0.4)";
      const r = Math.max(0.6, S * 0.20);
      for (let k = 0; k < s.drops.length; k += 3) {
        const p = s.drops[k];
        c.beginPath();
        c.arc(p.x * S, p.y * S, r, 0, 6.2832);
        c.fill();
      }
    }

    loop() {
      this.rafId = 0;
      if (!this.sim || !this.sim.running) return;

      const dt = Math.max(1, (this.sim.G.dx + this.sim.G.dy) / 2 / 0.6);
      for (let k = 0; k < this.speed; k++) {
        this.rainStep(this.sim, dt);
      }

      this.drawRain(this.sim);

      // Rafraîchissement MapLibre
      if (this.map && typeof this.map.triggerRepaint === "function") {
        this.map.triggerRepaint();
      }

      this.updateStatsDisplay();
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
      const coords = this.getGridCorners(s.G);

      if (this.map.getSource(this.SRC_RAIN)) {
        if (this.map.getLayer(this.LAYER_RAIN)) this.map.removeLayer(this.LAYER_RAIN);
        this.map.removeSource(this.SRC_RAIN);
      }

      this.map.addSource(this.SRC_RAIN, {
        type: "canvas",
        canvas: s.canvas,
        coordinates: coords,
        animate: true
      });

      const beforeLayer = this.map.getLayer("parcelles-line")
        ? "parcelles-line"
        : (this.map.getLayer("parcelles-line-bg") ? "parcelles-line-bg" : undefined);

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
    }

    removeRainLayer() {
      if (!this.map || typeof this.map.getSource !== "function") return;
      if (this.map.getLayer(this.LAYER_RAIN)) this.map.removeLayer(this.LAYER_RAIN);
      if (this.map.getSource(this.SRC_RAIN)) this.map.removeSource(this.SRC_RAIN);
    }

    // -------------------------------------------------------------------------
    // Modèle d'érosion des sols RUSLE (Moore & Burch, Freeman D-infinity)
    // -------------------------------------------------------------------------
    computeErosion() {
      if (!this.currentGrid) return;
      const G = this.currentGrid;
      const { W, H, dx, dy, z } = G;
      const N = W * H;

      const zf = this.fillDepressions(z, W, H, 1e-4);
      const cell = dx * dy;
      const width = (dx + dy) / 2;

      const DX = [1, 1, 0, -1, -1, -1, 0, 1];
      const DY = [0, 1, 1, 1, 0, -1, -1, -1];
      const DIST = DX.map((a, d) => Math.hypot(a * dx, DY[d] * dy));

      const order = [];
      for (let i = 0; i < N; i++) {
        if (!Number.isNaN(zf[i])) order.push(i);
      }
      order.sort((a, b) => zf[b] - zf[a]); // Tri par altitude décroissante

      // Écoulement multidirectionnel (Freeman 1.1) : aire contributive
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

      // Facteur LS (Moore & Burch 1986) et calcul RUSLE : A = R · K · LS · C · P
      const R = this.rFactor;
      const soil = SOIL_TYPES[this.soilKey] || SOIL_TYPES.loam;
      const K = soil.k;
      const crop = CROP_FACTORS[this.cropKey] || CROP_FACTORS.bare;
      const C = crop.c;
      const practice = PRACTICE_FACTORS[this.practiceKey] || PRACTICE_FACTORS.none;
      const P = practice.p;

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
          const As = Math.min(300, acc[i] / width); // Aire contributive spécifique (m) plafonnée à 300m
          const LS = Math.pow(As / 22.13, 0.4) * Math.pow(sinb / 0.0896, 1.3);

          A[i] = R * K * LS * C * P;
          sumA += A[i];
          countA++;
        }
      }

      const mean = countA ? sumA / countA : 0;
      const areaHa = (countA * cell) / 10000;
      const total = mean * areaHa;

      this.eroResult = { A, mean, total, areaHa };
      this.updateErosionDisplay();
      this.renderErosionLayer();
    }

    createErosionDataUrl() {
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
        px[o + 3] = 205; // Opacité nette
      }

      ctx.putImageData(img, 0, 0);
      return cv.toDataURL();
    }

    renderErosionLayer() {
      if (!this.map || typeof this.map.getSource !== "function" || !this.currentGrid) return;
      const shouldShow = this.showErosionMap && this.eroResult;

      if (!shouldShow) {
        if (this.map.getLayer(this.LAYER_ERO)) {
          this.map.setLayoutProperty(this.LAYER_ERO, "visibility", "none");
        }
        return;
      }

      const url = this.createErosionDataUrl();
      if (!url) return;
      const coords = this.getGridCorners(this.currentGrid);

      if (!this.map.getSource(this.SRC_ERO)) {
        this.map.addSource(this.SRC_ERO, {
          type: "image",
          url: url,
          coordinates: coords
        });

        const beforeLayer = this.map.getLayer(this.LAYER_RAIN)
          ? this.LAYER_RAIN
          : (this.map.getLayer("parcelles-line") ? "parcelles-line" : undefined);

        this.map.addLayer({
          id: this.LAYER_ERO,
          type: "raster",
          source: this.SRC_ERO,
          paint: {
            "raster-opacity": 0.85,
            "raster-fade-duration": 0,
            "raster-resampling": "nearest"
          }
        }, beforeLayer);
      } else {
        this.map.getSource(this.SRC_ERO).updateImage({ url, coordinates: coords });
        this.map.setLayoutProperty(this.LAYER_ERO, "visibility", "visible");
      }

      // Si la pluie tourne en même temps, la pluie reste par-dessus
      if (this.sim && this.sim.running && this.map.getLayer(this.LAYER_RAIN)) {
        this.map.moveLayer(this.LAYER_RAIN);
      }
    }

    removeErosionLayer() {
      if (!this.map || typeof this.map.getSource !== "function") return;
      if (this.map.getLayer(this.LAYER_ERO)) this.map.removeLayer(this.LAYER_ERO);
      if (this.map.getSource(this.SRC_ERO)) this.map.removeSource(this.SRC_ERO);
    }

    // -------------------------------------------------------------------------
    // Affichage et mise à jour de l'interface
    // -------------------------------------------------------------------------
    updateParcelHeader() {
      if (!this.currentParcel) return;
      const props = this.currentParcel.properties || {};
      const pid = props.IDPAR || props.idpar || "";
      const lot = props.NO_LOT || "";
      const sup = props.SUPHEC || props.suphec || "";
      const crop = props.DESCODPR1 || props.descodpr1 || "";

      const badgeEl = document.getElementById("sim-parcel-badge");
      if (badgeEl) {
        badgeEl.textContent = pid ? `Parcelle nº ${pid}` : (lot ? `Lot nº ${lot}` : "Parcelle agricole");
      }

      const areaEl = document.getElementById("sim-area-badge");
      if (areaEl) {
        const sNum = parseFloat(sup);
        areaEl.textContent = !isNaN(sNum) ? `${sNum.toFixed(1)} ha` : (sup ? `${sup} ha` : "");
        areaEl.style.display = areaEl.textContent ? "inline-flex" : "none";
      }

      // Pré-sélection intelligente de la culture si renseignée dans le BDPPAD
      if (crop) {
        const cLower = crop.toLowerCase();
        let targetKey = "bare";
        if (cLower.includes("maïs") || cLower.includes("mais")) {
          targetKey = "corn_plow";
        } else if (cLower.includes("soya")) {
          targetKey = "soybean";
        } else if (cLower.includes("blé") || cLower.includes("orge") || cLower.includes("avoine") || cLower.includes("céréale")) {
          targetKey = "cereals";
        } else if (cLower.includes("foin") || cLower.includes("prairie") || cLower.includes("pâturage")) {
          targetKey = "hay";
        } else if (cLower.includes("pomme de terre")) {
          targetKey = "potato";
        }

        const selCrop = document.getElementById("sim-ero-crop");
        if (selCrop && targetKey !== "bare") {
          selCrop.value = targetKey;
          this.cropKey = targetKey;
        }
      }
    }

    updateStatsDisplay() {
      if (!this.sim) return;
      const s = this.sim;
      const cell = s.G.dx * s.G.dy;

      let pond = 0;
      for (let i = 0; i < s.water.length; i++) pond += s.water[i];
      pond *= cell;

      const rainTotal = Math.max(1e-9, s.rain);
      const mm = (s.rain / (s.active * cell)) * 1000;
      const tm = s.time / 60;
      const timeStr = tm < 90 ? `${Math.round(tm)} min` : `${(tm / 60).toFixed(1)} h`;

      let moving = 0;
      for (const p of s.drops) moving += p.v;

      const elTime = document.getElementById("sim-stat-time");
      const elRain = document.getElementById("sim-stat-rain");
      const elInf = document.getElementById("sim-stat-inf");
      const elFlow = document.getElementById("sim-stat-flow");
      const elPond = document.getElementById("sim-stat-pond");
      const elOut = document.getElementById("sim-stat-out");

      if (elTime) elTime.textContent = timeStr;
      if (elRain) elRain.textContent = `${mm.toFixed(1)} mm`;
      if (elInf) elInf.textContent = `${Math.min(100, Math.round((100 * s.inf) / rainTotal))} %`;
      if (elFlow) elFlow.textContent = `${Math.min(100, Math.round((100 * moving) / rainTotal))} %`;
      if (elPond) elPond.textContent = `${Math.min(100, Math.round((100 * pond) / rainTotal))} %`;
      if (elOut) elOut.textContent = `${Math.min(100, Math.round((100 * s.out) / rainTotal))} %`;
    }

    clearStats() {
      ["sim-stat-time", "sim-stat-rain", "sim-stat-inf", "sim-stat-flow", "sim-stat-pond", "sim-stat-out"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = id === "sim-stat-time" ? "0 min" : (id === "sim-stat-rain" ? "0.0 mm" : "0 %");
      });
    }

    syncRainHint() {
      const soil = SOIL_TYPES[this.soilKey] || SOIL_TYPES.loam;
      const hintEl = document.getElementById("sim-rain-hint");
      if (!hintEl) return;
      if (this.intensity <= soil.f) {
        hintEl.innerHTML = `<span style="color:#d97706; font-weight:600;">⚠️ Le sol absorbe toute la pluie (infiltration ≈ ${soil.f} mm/h) : augmentez l'intensité au-dessus de ${soil.f} mm/h pour voir apparaître le ruissellement.</span>`;
      } else {
        hintEl.textContent = `Les gouttes descendent la plus forte pente selon le MNE 1m, tracent les thalwegs et remplissent les dépressions qui débordent une fois pleines. Seul l'excès d'eau sur l'infiltration ruisselle (modèle Horton).`;
      }
    }

    updateErosionDisplay() {
      if (!this.eroResult) return;
      const { mean, total } = this.eroResult;

      const elMean = document.getElementById("sim-ero-mean-val");
      const elTotal = document.getElementById("sim-ero-total-val");
      const elBadge = document.getElementById("sim-ero-tolerance-badge");

      if (elMean) elMean.textContent = `${mean.toFixed(1)} t/ha/an`;
      if (elTotal) elTotal.textContent = `${Math.round(total)} t/an`;

      if (elBadge) {
        if (mean <= 6.0) {
          elBadge.textContent = `Pertes sous le seuil de tolérance usuel (≈ 6 t/ha/an) — Érosion maîtrisée`;
          elBadge.style.color = "#15803d";
        } else {
          elBadge.textContent = `Attention : Pertes supérieures au seuil de tolérance (≈ 6 t/ha/an) — Risque d'appauvrissement du sol`;
          elBadge.style.color = "#ea580c";
        }
      }
    }

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

    switchTab(tabName) {
      this.activeTab = tabName;
      const isRain = tabName === "rain";

      const btnRain = document.getElementById("btn-sim-tab-rain");
      const btnEro = document.getElementById("btn-sim-tab-erosion");
      const secRain = document.getElementById("sim-section-rain");
      const secEro = document.getElementById("sim-section-erosion");

      if (btnRain) {
        btnRain.classList.toggle("active", isRain);
        btnRain.style.background = isRain ? "#ffffff" : "transparent";
        btnRain.style.color = isRain ? "#0284c7" : "#64748b";
        btnRain.style.boxShadow = isRain ? "0 1px 3px rgba(0,0,0,0.1)" : "none";
      }
      if (btnEro) {
        btnEro.classList.toggle("active", !isRain);
        btnEro.style.background = !isRain ? "#ffffff" : "transparent";
        btnEro.style.color = !isRain ? "#ea580c" : "#64748b";
        btnEro.style.boxShadow = !isRain ? "0 1px 3px rgba(0,0,0,0.1)" : "none";
      }

      if (secRain) secRain.style.display = isRain ? "block" : "none";
      if (secEro) secEro.style.display = !isRain ? "block" : "none";
    }

    setLoading(loading) {
      this.isLoading = loading;
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
      this.removeErosionLayer();
      this.clearHighlight();

      const dock = document.getElementById("sim-dock");
      if (dock) dock.classList.remove("open");
      this.isOpen = false;
      this.currentParcel = null;
      this.currentGrid = null;
    }

    // -------------------------------------------------------------------------
    // Géométrie et outils de détourage
    // -------------------------------------------------------------------------
    getGridCorners(G) {
      return [
        G.pos(-0.5, -0.5),
        G.pos(G.W - 0.5, -0.5),
        G.pos(G.W - 0.5, G.H - 0.5),
        G.pos(-0.5, G.H - 0.5)
      ];
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
            "line-width": 3,
            "line-dasharray": [2, 1.5],
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
      if (geom.type === "Polygon") {
        if (!geom.coordinates.length || !this.isPointInRing(pt, geom.coordinates[0])) return false;
        for (let k = 1; k < geom.coordinates.length; k++) {
          if (this.isPointInRing(pt, geom.coordinates[k])) return false;
        }
        return true;
      } else if (geom.type === "MultiPolygon") {
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

    computeBbox(geom) {
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

    assembleParcel(feature) {
      if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") {
        return window.terrain3DManager.assembleParcelFeature(feature);
      }
      return feature;
    }
  }

  root.ParcelSimulationManager = ParcelSimulationManager;
})(window);
