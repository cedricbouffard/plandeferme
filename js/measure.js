/**
 * Plan de Ferme — Outil de Mesure Géodésique (Distances & Superficies)
 * Supporte le Système Métrique (m, km, ha, m²) et le Système Impérial (pi, mi, acres, arpents)
 */

(function () {
  "use strict";

  // Rayon moyen de la Terre en mètres (Ellipsoïde WGS-84 / Sphère IUGG)
  const EARTH_RADIUS_M = 6378137;

  // Facteurs de conversion exacts
  const FT_PER_M = 3.280839895;
  const M_PER_MI = 1609.344;
  const M_PER_ARPENT = 58.471308; // Arpent de Paris linéaire (180 pieds français)
  const SQFT_PER_M2 = 10.7639104;
  const M2_PER_ACRE = 4046.8564224;
  const M2_PER_ARPENT_CARRE = 3418.8929; // Arpent carré québécois (32 400 pi² français)

  /**
   * Calcul géodésique de la distance entre deux coordonnées [lng, lat] (formule de Haversine)
   * Retourne la distance en mètres
   */
  function haversineDistance(p1, p2) {
    if (!p1 || !p2) return 0;
    const rad = Math.PI / 180;
    const lat1 = p1[1] * rad;
    const lat2 = p2[1] * rad;
    const dLat = (p2[1] - p1[1]) * rad;
    const dLon = (p2[0] - p1[0]) * rad;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_M * c;
  }

  /**
   * Calcul de la distance totale d'un tracé de coordonnées
   */
  function computeTotalPathDistance(coords) {
    if (!coords || coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversineDistance(coords[i], coords[i + 1]);
    }
    return total;
  }

  /**
   * Calcul géodésique précis de la superficie d'un polygone sur l'ellipsoïde
   * Retourne la surface en m²
   */
  function computeGeodesicPolygonArea(coords) {
    if (!coords || coords.length < 3) return 0;
    const rad = Math.PI / 180;
    let total = 0;
    const n = coords.length;
    for (let i = 0; i < n; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % n];
      total += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
    }
    return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  }

  /**
   * Calcule le centroïde géométrique moyen d'une série de coordonnées
   */
  function computeCentroid(coords) {
    if (!coords || coords.length === 0) return [0, 0];
    let sumLng = 0;
    let sumLat = 0;
    coords.forEach(pt => {
      sumLng += pt[0];
      sumLat += pt[1];
    });
    return [sumLng / coords.length, sumLat / coords.length];
  }

  /**
   * Formate un nombre avec séparateur de milliers et nombre de décimales
   */
  function formatNum(val, decimals = 1) {
    if (val === undefined || val === null || isNaN(val)) return "0";
    return val.toLocaleString("fr-CA", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  class MeasureManager {
    constructor() {
      this.map = null;
      this.isActive = false;
      this.mode = "distance"; // "distance" | "area"
      this.unitSystem = "metric"; // "metric" | "imperial"
      this.forcedUnit = "auto"; // "auto" | "m" | "km" | "ft" | "mi" | "arpent" | "m2" | "ha" | "acre" | "sq_arpent"

      this.points = []; // Liste des sommets fixes [[lng, lat], ...]
      this.mousePoint = null; // Position temporaire de la souris [lng, lat]
      this.isFinished = false; // Tracé terminé ou en cours

      this.markers = []; // Marqueurs MapLibre HTML pour les étiquettes aux sommets
      this.areaMarker = null; // Marqueur central pour la superficie

      this.dom = {};
    }

    /**
     * Initialisation avec l'instance MapLibre
     */
    init(mapInstance) {
      this.map = mapInstance;
      this.buildDom();
      this.bindMapEvents();
      this.bindUiEvents();
    }

    /**
     * Construit les éléments de l'interface utilisateur (HUD)
     */
    buildDom() {
      // 1. Panneau HUD flottant de mesure
      const panel = document.createElement("div");
      panel.id = "measure-panel";
      panel.className = "measure-panel";
      panel.style.display = "none";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Outil de mesure");

      panel.innerHTML = `
        <div class="measure-panel-header">
          <div class="measure-panel-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21.3 8.7 8.7 21.3c-.4.4-1 .4-1.4 0l-6-6c-.4-.4-.4-1 0-1.4L13.9 1.3c.4-.4 1-.4 1.4 0l6 6c.4.4.4 1 0 1.4Z"/>
              <path d="m14.5 7.5 2 2"/>
              <path d="m11.5 10.5 1.5 1.5"/>
              <path d="m8.5 13.5 2 2"/>
              <path d="m5.5 16.5 1.5 1.5"/>
            </svg>
            <span>Outil de mesure</span>
          </div>
          <button type="button" class="measure-close-btn" id="btn-measure-close" title="Fermer l'outil (Échap)">&times;</button>
        </div>

        <!-- Choix du mode : Distance vs Superficie -->
        <div class="measure-mode-tabs">
          <button type="button" class="measure-mode-tab active" id="btn-measure-mode-dist" data-mode="distance">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 20L20 4"></path><circle cx="4" cy="20" r="2"></circle><circle cx="20" cy="4" r="2"></circle></svg>
            <span>Distance</span>
          </button>
          <button type="button" class="measure-mode-tab" id="btn-measure-mode-area" data-mode="area">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            <span>Superficie</span>
          </button>
        </div>

        <!-- Choix du système d'unités (Métrique vs Impérial) -->
        <div class="measure-unit-section">
          <span class="measure-unit-label">Système d'unités :</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="measure-unit-toggle">
              <button type="button" class="measure-unit-btn active" id="btn-measure-unit-metric" data-system="metric" title="Unités métriques (m, km, ha, m²)">Métrique</button>
              <button type="button" class="measure-unit-btn" id="btn-measure-unit-imperial" data-system="imperial" title="Unités impériales (pi, mi, acres, arpents)">Impérial</button>
            </div>
            <select id="select-measure-unit-detail" class="measure-unit-dropdown" title="Forcer une unité spécifique">
              <!-- Rempli dynamiquement -->
            </select>
          </div>
        </div>

        <!-- Affichage principal du résultat -->
        <div class="measure-display-card">
          <div class="measure-display-label" id="measure-display-label">Distance totale</div>
          <div class="measure-display-value" id="measure-display-value">0 m</div>
          <div class="measure-display-secondary" id="measure-display-secondary">0 pi · 0 arpent</div>
          <div class="measure-display-extra" id="measure-display-extra" style="display: none;"></div>
        </div>

        <!-- Boutons d'actions -->
        <div class="measure-actions">
          <button type="button" class="measure-btn" id="btn-measure-undo" disabled title="Annuler le dernier point (Retour arrière)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
            <span>Annuler pt</span>
          </button>
          <button type="button" class="measure-btn danger" id="btn-measure-clear" disabled title="Effacer tous les points">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            <span>Effacer</span>
          </button>
          <button type="button" class="measure-btn primary" id="btn-measure-finish" disabled title="Terminer la mesure (ou double-clic)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Terminer</span>
          </button>
        </div>

        <div class="measure-hint" id="measure-hint">
          Cliquez sur la carte pour mesurer. Double-cliquez pour terminer.
        </div>
      `;

      document.body.appendChild(panel);

      this.dom = {
        panel,
        btnClose: document.getElementById("btn-measure-close"),
        tabDist: document.getElementById("btn-measure-mode-dist"),
        tabArea: document.getElementById("btn-measure-mode-area"),
        btnMetric: document.getElementById("btn-measure-unit-metric"),
        btnImperial: document.getElementById("btn-measure-unit-imperial"),
        selectDetail: document.getElementById("select-measure-unit-detail"),
        displayLabel: document.getElementById("measure-display-label"),
        displayValue: document.getElementById("measure-display-value"),
        displaySecondary: document.getElementById("measure-display-secondary"),
        displayExtra: document.getElementById("measure-display-extra"),
        btnUndo: document.getElementById("btn-measure-undo"),
        btnClear: document.getElementById("btn-measure-clear"),
        btnFinish: document.getElementById("btn-measure-finish"),
        hint: document.getElementById("measure-hint"),
        topBarBtn: document.getElementById("btn-quick-measure"),
        mobileToolCard: document.getElementById("mobile-tool-measure"),
        mobileBadge: document.getElementById("mobile-tool-measure-badge")
      };

      this.updateDropdownUnits();
    }

    /**
     * Met à jour les options du menu déroulant d'unités détaillées selon le mode et le système
     */
    updateDropdownUnits() {
      const select = this.dom.selectDetail;
      if (!select) return;

      const isArea = this.mode === "area";
      const isMetric = this.unitSystem === "metric";

      select.innerHTML = "";

      if (isMetric) {
        if (!isArea) {
          select.innerHTML = `
            <option value="auto">Auto (m / km)</option>
            <option value="m">Mètres (m)</option>
            <option value="km">Kilomètres (km)</option>
          `;
        } else {
          select.innerHTML = `
            <option value="auto">Auto (ha / m²)</option>
            <option value="ha">Hectares (ha)</option>
            <option value="m2">Mètres² (m²)</option>
          `;
        }
      } else {
        if (!isArea) {
          select.innerHTML = `
            <option value="auto">Auto (pi / mi)</option>
            <option value="ft">Pieds (pi)</option>
            <option value="mi">Milles (mi)</option>
            <option value="arpent">Arpents (arp)</option>
            <option value="yd">Verges (yd)</option>
          `;
        } else {
          select.innerHTML = `
            <option value="auto">Auto (acres / arp²)</option>
            <option value="acre">Acres (ac)</option>
            <option value="sq_arpent">Arpents² (arp²)</option>
            <option value="sq_ft">Pieds² (pi²)</option>
          `;
        }
      }

      select.value = this.forcedUnit;
      if (!select.value) {
        this.forcedUnit = "auto";
        select.value = "auto";
      }
    }

    /**
     * Initialisation des calques MapLibre dédiés à la mesure
     */
    ensureMapLayers() {
      if (!this.map) return;

      // Source principale des points et lignes fixés
      if (!this.map.getSource("measure-source")) {
        this.map.addSource("measure-source", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
      }

      // Source de prévisualisation élastique (rubberband vers le curseur)
      if (!this.map.getSource("measure-preview-source")) {
        this.map.addSource("measure-preview-source", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
      }

      // 1. Remplissage polygone fixé (Superficie)
      if (!this.map.getLayer("measure-fill")) {
        this.map.addLayer({
          id: "measure-fill",
          type: "fill",
          source: "measure-source",
          filter: ["==", "$type", "Polygon"],
          paint: {
            "fill-color": "#0d9488",
            "fill-opacity": 0.22
          }
        });
      }

      // 2. Remplissage prévisualisation élastique
      if (!this.map.getLayer("measure-preview-fill")) {
        this.map.addLayer({
          id: "measure-preview-fill",
          type: "fill",
          source: "measure-preview-source",
          filter: ["==", "$type", "Polygon"],
          paint: {
            "fill-color": "#0d9488",
            "fill-opacity": 0.12
          }
        });
      }

      // 3. Ligne de contour / tracé fixé (halo blanc + trait turquoise vif)
      if (!this.map.getLayer("measure-line-casing")) {
        this.map.addLayer({
          id: "measure-line-casing",
          type: "line",
          source: "measure-source",
          paint: {
            "line-color": "#ffffff",
            "line-width": 5.5,
            "line-opacity": 0.9
          }
        });
      }

      if (!this.map.getLayer("measure-line")) {
        this.map.addLayer({
          id: "measure-line",
          type: "line",
          source: "measure-source",
          paint: {
            "line-color": "#0d9488",
            "line-width": 3,
            "line-opacity": 1
          }
        });
      }

      // 4. Ligne de prévisualisation vers la souris (pointillés)
      if (!this.map.getLayer("measure-preview-line")) {
        this.map.addLayer({
          id: "measure-preview-line",
          type: "line",
          source: "measure-preview-source",
          paint: {
            "line-color": "#0f766e",
            "line-width": 2.5,
            "line-dasharray": [2, 1.5],
            "line-opacity": 0.9
          }
        });
      }

      // 5. Cercles aux sommets
      if (!this.map.getLayer("measure-points")) {
        this.map.addLayer({
          id: "measure-points",
          type: "circle",
          source: "measure-source",
          filter: ["==", "$type", "Point"],
          paint: {
            "circle-radius": 5.5,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#0d9488",
            "circle-stroke-width": 2.5
          }
        });
      }
    }

    /**
     * Maintient les calques de mesure par-dessus toutes les autres couches
     */
    bringToFront() {
      if (!this.map || !this.map.style) return;
      const layers = [
        "measure-fill",
        "measure-preview-fill",
        "measure-line-casing",
        "measure-line",
        "measure-preview-line",
        "measure-points"
      ];
      layers.forEach(id => {
        if (this.map.getLayer(id)) {
          try {
            this.map.moveLayer(id);
          } catch (e) {}
        }
      });
      if (typeof this.map.triggerRepaint === "function") {
        this.map.triggerRepaint();
      }
    }

    /**
     * Liaison des interactions de carte
     */
    bindMapEvents() {
      if (!this.map) return;

      const ensure = () => {
        this.ensureMapLayers();
        this.bringToFront();
      };

      if (this.map.style) {
        ensure();
      } else {
        this.map.once("load", ensure);
      }

      this.map.on("styledata", () => {
        ensure();
      });

      // Clic sur la carte : ajout d'un sommet
      this.map.on("click", (e) => {
        if (!this.isActive || this.isFinished) return;
        this.addPoint([e.lngLat.lng, e.lngLat.lat]);
      });

      // Mouvement de la souris : prévisualisation élastique
      this.map.on("mousemove", (e) => {
        if (!this.isActive || this.isFinished || this.points.length === 0) return;
        this.mousePoint = [e.lngLat.lng, e.lngLat.lat];
        this.updatePreview();
      });

      // Double-clic : terminer la mesure
      this.map.on("dblclick", (e) => {
        if (!this.isActive) return;
        e.preventDefault();
        this.finish();
      });

      // Clic droit : terminer la mesure ou annuler
      this.map.on("contextmenu", (e) => {
        if (!this.isActive) return;
        e.preventDefault();
        if (this.points.length >= 2) {
          this.finish();
        } else {
          this.clear();
        }
      });
    }

    /**
     * Liaison des événements de l'interface utilisateur
     */
    bindUiEvents() {
      // Bouton dans la barre flottante desktop
      if (this.dom.topBarBtn) {
        this.dom.topBarBtn.addEventListener("click", () => this.toggle());
      }

      // Bouton dans la feuille d'outils mobile
      if (this.dom.mobileToolCard) {
        this.dom.mobileToolCard.addEventListener("click", () => {
          const mobileToolsSheet = document.getElementById("mobile-tools-sheet");
          const mobileToolsBackdrop = document.getElementById("mobile-tools-backdrop");
          if (mobileToolsSheet) mobileToolsSheet.classList.remove("open");
          if (mobileToolsBackdrop) mobileToolsBackdrop.classList.remove("open");
          this.activate();
        });
      }

      // Fermeture du panneau HUD
      if (this.dom.btnClose) {
        this.dom.btnClose.addEventListener("click", () => this.deactivate());
      }

      // Changement de mode : Distance vs Superficie
      if (this.dom.tabDist) {
        this.dom.tabDist.addEventListener("click", () => this.setMode("distance"));
      }
      if (this.dom.tabArea) {
        this.dom.tabArea.addEventListener("click", () => this.setMode("area"));
      }

      // Système d'unités : Métrique vs Impérial
      if (this.dom.btnMetric) {
        this.dom.btnMetric.addEventListener("click", () => this.setUnitSystem("metric"));
      }
      if (this.dom.btnImperial) {
        this.dom.btnImperial.addEventListener("click", () => this.setUnitSystem("imperial"));
      }

      // Menu déroulant d'unités spécifiques
      if (this.dom.selectDetail) {
        this.dom.selectDetail.addEventListener("change", (e) => {
          this.forcedUnit = e.target.value;
          this.render();
        });
      }

      // Actions : Annuler, Effacer, Terminer
      if (this.dom.btnUndo) {
        this.dom.btnUndo.addEventListener("click", () => this.undoPoint());
      }
      if (this.dom.btnClear) {
        this.dom.btnClear.addEventListener("click", () => this.clear());
      }
      if (this.dom.btnFinish) {
        this.dom.btnFinish.addEventListener("click", () => this.finish());
      }

      // Raccourci Échap pour quitter ou annuler
      window.addEventListener("keydown", (e) => {
        if (!this.isActive) return;
        if (e.key === "Escape") {
          if (this.points.length > 0) {
            this.clear();
          } else {
            this.deactivate();
          }
        } else if (e.key === "Backspace" && !this.isFinished) {
          this.undoPoint();
        } else if (e.key === "Enter" && !this.isFinished) {
          this.finish();
        }
      });
    }

    /**
     * Active le mode de mesure
     */
    activate(initialMode = null) {
      if (initialMode) this.mode = initialMode;
      this.isActive = true;
      this.isFinished = false;

      // Désactiver les autres modes exclusifs
      if (window.profileManager && typeof window.profileManager.stopDrawing === "function") {
        window.profileManager.stopDrawing();
      }
      if (window.ndviManager && typeof window.ndviManager.setMode === "function") {
        window.ndviManager.setMode(false);
      }
      if (window.vectorManager && window.vectorManager.isDrawing) {
        window.vectorManager.cancelDrawing();
      }

      if (this.map) {
        this.map.doubleClickZoom.disable();
        this.map.getCanvas().style.cursor = "crosshair";
      }

      // État des boutons
      if (this.dom.topBarBtn) this.dom.topBarBtn.classList.add("active");
      if (this.dom.mobileBadge) this.dom.mobileBadge.style.display = "inline-block";
      if (this.dom.panel) this.dom.panel.style.display = "block";

      this.ensureMapLayers();
      this.bringToFront();
      this.render();
    }

    /**
     * Désactive le mode de mesure
     */
    deactivate() {
      this.isActive = false;
      this.isFinished = false;

      if (this.map) {
        this.map.doubleClickZoom.enable();
        this.map.getCanvas().style.cursor = "";
      }

      if (this.dom.topBarBtn) this.dom.topBarBtn.classList.remove("active");
      if (this.dom.mobileBadge) this.dom.mobileBadge.style.display = "none";
      if (this.dom.panel) this.dom.panel.style.display = "none";

      this.clearMapData();
    }

    /**
     * Bascule l'activation de l'outil de mesure
     */
    toggle() {
      if (this.isActive) {
        this.deactivate();
      } else {
        this.activate();
      }
    }

    /**
     * Définit le mode de mesure : "distance" (Ligne) ou "area" (Superficie)
     */
    setMode(newMode) {
      if (this.mode === newMode) return;
      this.mode = newMode;
      this.forcedUnit = "auto";

      if (this.dom.tabDist && this.dom.tabArea) {
        this.dom.tabDist.classList.toggle("active", newMode === "distance");
        this.dom.tabArea.classList.toggle("active", newMode === "area");
      }

      this.updateDropdownUnits();
      this.render();
    }

    /**
     * Définit le système d'unités : "metric" ou "imperial"
     */
    setUnitSystem(newSystem) {
      if (this.unitSystem === newSystem) return;
      this.unitSystem = newSystem;
      this.forcedUnit = "auto";

      if (this.dom.btnMetric && this.dom.btnImperial) {
        this.dom.btnMetric.classList.toggle("active", newSystem === "metric");
        this.dom.btnImperial.classList.toggle("active", newSystem === "imperial");
      }

      this.updateDropdownUnits();
      this.render();
    }

    /**
     * Ajoute un point au tracé
     */
    addPoint(lngLat) {
      this.points.push(lngLat);
      this.isFinished = false;
      this.render();
    }

    /**
     * Annule le dernier point ajouté
     */
    undoPoint() {
      if (this.points.length > 0) {
        this.points.pop();
        this.isFinished = false;
        this.render();
      }
    }

    /**
     * Réinitialise les mesures
     */
    clear() {
      this.points = [];
      this.mousePoint = null;
      this.isFinished = false;
      this.clearMapData();
      this.render();
    }

    /**
     * Termine la mesure active
     */
    finish() {
      if (this.points.length === 0) return;
      this.isFinished = true;
      this.mousePoint = null;

      // Nettoyer la prévisualisation élastique
      const previewSrc = this.map ? this.map.getSource("measure-preview-source") : null;
      if (previewSrc) {
        previewSrc.setData({ type: "FeatureCollection", features: [] });
      }

      this.render();
    }

    /**
     * Efface les données visuelles sur la carte
     */
    clearMapData() {
      const src = this.map ? this.map.getSource("measure-source") : null;
      if (src) src.setData({ type: "FeatureCollection", features: [] });

      const previewSrc = this.map ? this.map.getSource("measure-preview-source") : null;
      if (previewSrc) previewSrc.setData({ type: "FeatureCollection", features: [] });

      this.clearMarkers();
    }

    /**
     * Supprime tous les marqueurs HTML d'étiquettes
     */
    clearMarkers() {
      this.markers.forEach(m => m.remove());
      this.markers = [];
      if (this.areaMarker) {
        this.areaMarker.remove();
        this.areaMarker = null;
      }
    }

    /**
     * Convertit et formate une distance en mètres selon le système et les options choisies
     */
    formatDistance(m) {
      const isMetric = this.unitSystem === "metric";
      const u = this.forcedUnit;

      if (isMetric) {
        if (u === "km" || (u === "auto" && m >= 1000)) {
          return `${formatNum(m / 1000, 3)} km`;
        }
        return `${formatNum(m, 1)} m`;
      } else {
        const ft = m * FT_PER_M;
        const mi = m / M_PER_MI;
        const arp = m / M_PER_ARPENT;
        const yd = ft / 3;

        if (u === "mi" || (u === "auto" && ft >= 2640)) {
          return `${formatNum(mi, 3)} mi`;
        }
        if (u === "arpent") {
          return `${formatNum(arp, 2)} arp`;
        }
        if (u === "yd") {
          return `${formatNum(yd, 1)} yd`;
        }
        return `${formatNum(ft, 1)} pi`;
      }
    }

    /**
     * Génère les équivalences d'une distance pour l'affichage secondaire
     */
    formatDistanceSecondary(m) {
      const isMetric = this.unitSystem === "metric";
      const ft = m * FT_PER_M;
      const mi = m / M_PER_MI;
      const arp = m / M_PER_ARPENT;

      if (isMetric) {
        // En métrique, afficher les équivalents impériaux & arpents
        if (ft >= 5280) {
          return `${formatNum(mi, 2)} mi · ${formatNum(ft, 0)} pi · ${formatNum(arp, 1)} arp`;
        }
        return `${formatNum(ft, 1)} pi · ${formatNum(arp, 2)} arpent${arp >= 2 ? "s" : ""}`;
      } else {
        // En impérial, afficher l'équivalent métrique
        if (m >= 1000) {
          return `${formatNum(m / 1000, 3)} km · ${formatNum(m, 0)} m`;
        }
        return `${formatNum(m, 1)} m · ${formatNum(arp, 2)} arpent${arp >= 2 ? "s" : ""}`;
      }
    }

    /**
     * Convertit et formate une superficie en m² selon le système et les options choisies
     */
    formatArea(m2) {
      const isMetric = this.unitSystem === "metric";
      const u = this.forcedUnit;

      if (isMetric) {
        const ha = m2 / 10000;
        if (u === "ha" || (u === "auto" && m2 >= 10000)) {
          return `${formatNum(ha, 2)} ha`;
        }
        return `${formatNum(m2, 0)} m²`;
      } else {
        const ac = m2 / M2_PER_ACRE;
        const sqArp = m2 / M2_PER_ARPENT_CARRE;
        const sqft = m2 * SQFT_PER_M2;

        if (u === "sq_arpent") {
          return `${formatNum(sqArp, 2)} arp²`;
        }
        if (u === "sq_ft") {
          return `${formatNum(sqft, 0)} pi²`;
        }
        if (u === "acre" || (u === "auto" && ac >= 0.1)) {
          return `${formatNum(ac, 2)} acre${ac >= 2 ? "s" : ""}`;
        }
        return `${formatNum(sqft, 0)} pi²`;
      }
    }

    /**
     * Génère les équivalences d'une superficie pour l'affichage secondaire
     */
    formatAreaSecondary(m2) {
      const isMetric = this.unitSystem === "metric";
      const ha = m2 / 10000;
      const ac = m2 / M2_PER_ACRE;
      const sqArp = m2 / M2_PER_ARPENT_CARRE;

      if (isMetric) {
        // En métrique, afficher acres & arpents carrés québécois
        return `${formatNum(ac, 2)} ac · ${formatNum(sqArp, 2)} arp² · ${formatNum(m2, 0)} m²`;
      } else {
        // En impérial, afficher hectares & mètres carrés
        return `${formatNum(ha, 2)} ha · ${formatNum(sqArp, 2)} arp² · ${formatNum(m2, 0)} m²`;
      }
    }

    /**
     * Met à jour la prévisualisation élastique lors du mouvement de la souris
     */
    updatePreview() {
      if (!this.map || this.points.length === 0 || !this.mousePoint || this.isFinished) return;

      const previewSrc = this.map.getSource("measure-preview-source");
      if (!previewSrc) return;

      const currentPts = [...this.points, this.mousePoint];
      const features = [];

      // Ligne vers la souris
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [this.points[this.points.length - 1], this.mousePoint]
        }
      });

      // Si mode superficie et >= 2 sommets, polygone élastique
      if (this.mode === "area" && this.points.length >= 2) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [[...currentPts, currentPts[0]]]
          }
        });
        // Ligne de fermeture élastique vers le premier point
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [this.mousePoint, this.points[0]]
          }
        });
      }

      previewSrc.setData({ type: "FeatureCollection", features });

      // Mise à jour de l'affichage avec la prévisualisation
      this.updateHud(currentPts);
    }

    /**
     * Rendu global : met à jour la carte et le panneau d'affichage
     */
    render() {
      if (!this.map) return;
      this.ensureMapLayers();
      this.clearMarkers();

      const src = this.map.getSource("measure-source");
      if (!src) return;

      const pts = this.points;
      const features = [];

      if (pts.length > 0) {
        // 1. Sommets (Points)
        pts.forEach((pt, idx) => {
          features.push({
            type: "Feature",
            properties: { index: idx },
            geometry: { type: "Point", coordinates: pt }
          });
        });

        // 2. Tracé (LineString)
        if (pts.length >= 2) {
          features.push({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: this.mode === "area" && this.isFinished ? [...pts, pts[0]] : pts
            }
          });
        }

        // 3. Polygone (Polygon en mode superficie avec >= 3 sommets)
        if (this.mode === "area" && pts.length >= 3) {
          features.push({
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[...pts, pts[0]]]
            }
          });
        }
      }

      src.setData({ type: "FeatureCollection", features });

      // Marqueurs d'étiquettes aux sommets sur la carte
      if (pts.length > 0) {
        let cumulativeDist = 0;
        pts.forEach((pt, idx) => {
          if (idx > 0) {
            cumulativeDist += haversineDistance(pts[idx - 1], pt);
          }

          const el = document.createElement("div");
          el.className = `measure-marker-label ${idx === pts.length - 1 && pts.length > 1 ? "total" : ""}`;
          if (idx === 0) {
            el.textContent = "Départ";
          } else {
            el.textContent = this.formatDistance(cumulativeDist);
          }

          const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
            .setLngLat(pt)
            .addTo(this.map);
          this.markers.push(marker);
        });

        // Si superficie et >= 3 points, étiquette centrale avec la surface
        if (this.mode === "area" && pts.length >= 3) {
          const areaM2 = computeGeodesicPolygonArea(pts);
          const centroid = computeCentroid(pts);
          const areaEl = document.createElement("div");
          areaEl.className = "measure-marker-label area";
          areaEl.textContent = this.formatArea(areaM2);

          this.areaMarker = new maplibregl.Marker({ element: areaEl, anchor: "center" })
            .setLngLat(centroid)
            .addTo(this.map);
        }
      }

      this.bringToFront();
      this.updateHud(pts);
    }

    /**
     * Met à jour les valeurs affichées dans le panneau HUD
     */
    updateHud(coords) {
      const count = coords.length;
      const hasPoints = count > 0;
      const canFinish = (this.mode === "distance" && count >= 2) || (this.mode === "area" && count >= 3);

      // Boutons d'état
      if (this.dom.btnUndo) this.dom.btnUndo.disabled = this.points.length === 0 || this.isFinished;
      if (this.dom.btnClear) this.dom.btnClear.disabled = this.points.length === 0;
      if (this.dom.btnFinish) this.dom.btnFinish.disabled = !canFinish || this.isFinished;

      if (!hasPoints) {
        if (this.dom.displayLabel) {
          this.dom.displayLabel.textContent = this.mode === "distance" ? "Distance totale" : "Superficie totale";
        }
        if (this.dom.displayValue) {
          this.dom.displayValue.textContent = this.mode === "distance" ? "0 m" : "0 ha";
        }
        if (this.dom.displaySecondary) {
          this.dom.displaySecondary.textContent = "Cliquez sur la carte pour commencer";
        }
        if (this.dom.displayExtra) this.dom.displayExtra.style.display = "none";
        if (this.dom.hint) {
          this.dom.hint.textContent = this.mode === "distance"
            ? "Cliquez sur la carte pour mesurer une distance. Double-cliquez pour terminer."
            : "Cliquez pour délimiter une zone. Double-cliquez pour fermer la superficie.";
        }
        return;
      }

      if (this.mode === "distance") {
        const totalDist = computeTotalPathDistance(coords);
        if (this.dom.displayLabel) this.dom.displayLabel.textContent = `Distance (${count} point${count > 1 ? "s" : ""})`;
        if (this.dom.displayValue) this.dom.displayValue.textContent = this.formatDistance(totalDist);
        if (this.dom.displaySecondary) this.dom.displaySecondary.textContent = this.formatDistanceSecondary(totalDist);

        if (this.dom.displayExtra) {
          if (count >= 2) {
            const lastSegment = haversineDistance(coords[count - 2], coords[count - 1]);
            this.dom.displayExtra.style.display = "block";
            this.dom.displayExtra.textContent = `Dernier segment : ${this.formatDistance(lastSegment)}`;
          } else {
            this.dom.displayExtra.style.display = "none";
          }
        }
      } else {
        // Mode Superficie
        const areaM2 = count >= 3 ? computeGeodesicPolygonArea(coords) : 0;
        const perimeter = computeTotalPathDistance([...coords, coords[0]]);

        if (this.dom.displayLabel) {
          this.dom.displayLabel.textContent = count >= 3 ? `Superficie (${count} sommets)` : `Délimitation (${count} sommets)`;
        }

        if (count >= 3) {
          if (this.dom.displayValue) this.dom.displayValue.textContent = this.formatArea(areaM2);
          if (this.dom.displaySecondary) this.dom.displaySecondary.textContent = this.formatAreaSecondary(areaM2);
          if (this.dom.displayExtra) {
            this.dom.displayExtra.style.display = "block";
            this.dom.displayExtra.textContent = `Périmètre : ${this.formatDistance(perimeter)} (${this.formatDistanceSecondary(perimeter)})`;
          }
        } else {
          if (this.dom.displayValue) this.dom.displayValue.textContent = "—";
          if (this.dom.displaySecondary) this.dom.displaySecondary.textContent = "Cliquez au moins 3 points pour fermer la surface";
          if (this.dom.displayExtra) this.dom.displayExtra.style.display = "none";
        }
      }

      if (this.dom.hint) {
        if (this.isFinished) {
          this.dom.hint.textContent = "Mesure terminée. Cliquez sur « Effacer » pour démarrer une nouvelle mesure.";
        } else {
          this.dom.hint.textContent = canFinish
            ? "Continuez à cliquer ou double-cliquez pour terminer la mesure."
            : "Cliquez sur la carte pour ajouter des sommets.";
        }
      }
    }
  }

  window.MeasureManager = MeasureManager;
  window.measureManager = new MeasureManager();
})();
