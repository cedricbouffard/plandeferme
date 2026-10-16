/**
 * Plan de Ferme — Module de Gestion et Édition de Couches Vectorielles
 * Inspiré de GeoLibre (Création, Dessin d'entités, Table d'attributs, Stylisation & QML)
 *
 * Fonctionnalités complètes :
 * 1. Création & importation de couches vectorielles (Polygone, Ligne, Point)
 * 2. Numérisation/Dessin interactif d'entités avec calcul géodésique précis (superficie ha / longueur m)
 * 3. Édition interactive des attributs (formulaire individuel & tableur tabulaire complet)
 * 4. Modification de géométrie (déplacement des sommets / vertex dragging)
 * 5. Édition de style (couleur, opacité, contour, formes de marqueurs, étiquettes)
 * 6. Exportation & Importation de styles QGIS QML (.qml)
 * 7. Exportation vectorielle (GeoJSON, KML, CSV)
 * 8. Intégration transparente dans la légende et l'export PDF du compositeur
 */

(function () {
  "use strict";

  const STORAGE_KEY_VECTORS = "plandeferme_vector_layers";

  const DEFAULT_PALETTE = [
    "#16a34a", // Vert prairie
    "#0284c7", // Bleu azur
    "#ea580c", // Orange terre
    "#9333ea", // Violet sol
    "#e11d48", // Rouge repère
    "#d97706", // Ocre / Blé
    "#0d9488", // Turquoise eau
    "#475569"  // Anthracite
  ];

  /**
   * Calcul géodésique précis de la superficie d'un polygone sur l'ellipsoïde WGS-84
   * Retourne la surface en m² et en hectares
   */
  function computePolygonArea(coords) {
    if (!coords || coords.length < 3) return { m2: 0, ha: 0 };
    const rad = Math.PI / 180;
    const R = 6378137; // Rayon moyen de la Terre en mètres
    let total = 0;
    const n = coords.length;
    for (let i = 0; i < n; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % n];
      total += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
    }
    const m2 = Math.abs((total * R * R) / 2);
    const ha = m2 / 10000;
    return {
      m2: Math.round(m2 * 100) / 100,
      ha: Math.round(ha * 100) / 100
    };
  }

  /**
   * Calcul géodésique précis de la longueur d'une polyligne (formule de Haversine)
   * Retourne la longueur en mètres et en kilomètres
   */
  function computeLineDistance(coords) {
    if (!coords || coords.length < 2) return { m: 0, km: 0 };
    const rad = Math.PI / 180;
    const R = 6378137;
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];
      const dLat = (lat2 - lat1) * rad;
      const dLon = (lon2 - lon1) * rad;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      dist += R * c;
    }
    return {
      m: Math.round(dist * 10) / 10,
      km: Math.round((dist / 1000) * 100) / 100
    };
  }

  /**
   * Test géométrique précis : vérifie si un point [lng, lat] est dans un polygone
   */
  function pointInPolygon(point, vs) {
    if (!point || !vs) return false;
    const ring = vs && vs[0] && Array.isArray(vs[0][0]) ? vs[0] : vs;
    if (!ring || ring.length < 3) return false;
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Déclenche le téléchargement d'un fichier texte dans le navigateur
   */
  function downloadBlob(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Convertit une couleur Hex (#rrggbb) et une opacité (0-1) en chaîne QGIS r,g,b,a (0-255)
   */
  function hexToRgba(hex, opacity = 1) {
    const clean = hex && hex.startsWith("#") ? hex.slice(1) : "000000";
    const r = parseInt(clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.slice(4, 6), 16) || 0;
    const a = Math.max(0, Math.min(255, Math.round(opacity * 255)));
    return `${r},${g},${b},${a}`;
  }

  /**
   * Convertit une chaîne QGIS r,g,b[,a] en objet { hex, alpha }
   */
  function rgbaToHex(rgbaStr) {
    if (!rgbaStr) return null;
    const parts = rgbaStr.split(",").map(p => parseInt(p.trim(), 10));
    if (parts.length < 3 || parts.some(n => isNaN(n))) return null;
    const [r, g, b] = parts;
    const alpha = parts.length >= 4 ? Math.max(0, Math.min(255, parts[3])) / 255 : 1;
    const hex = "#" + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
    return { hex, alpha };
  }

  /**
   * =========================================================================
   * Moteur QGIS QML (Style XML) : Importation & Exportation fidèle (GeoLibre)
   * =========================================================================
   */
  const QmlHandler = {
    /**
     * Génère un document XML de style QGIS QML (.qml)
     */
    generate(layer) {
      const geomType = layer.geometryType.toLowerCase();
      const style = layer.style;
      const isPolygon = geomType === "polygon";
      const isLine = geomType === "linestring" || geomType === "line";
      const qgisGeom = isPolygon ? "fill" : isLine ? "line" : "marker";

      let symbolLayerXml = "";
      if (isPolygon) {
        const fillColorRgba = hexToRgba(style.fillColor || "#3b82f6", style.fillOpacity ?? 0.45);
        const strokeColorRgba = hexToRgba(style.strokeColor || "#1d4ed8", 1);
        const strokeStyle = style.strokeStyle || "solid";
        symbolLayerXml = `
          <layer class="SimpleFill" enabled="1" locked="0" pass="0">
            <Option type="Map">
              <Option name="color" type="QString" value="${fillColorRgba}"/>
              <Option name="outline_color" type="QString" value="${strokeColorRgba}"/>
              <Option name="outline_width" type="QString" value="${style.strokeWidth || 2}"/>
              <Option name="outline_width_unit" type="QString" value="Pixel"/>
              <Option name="outline_style" type="QString" value="${strokeStyle}"/>
              <Option name="style" type="QString" value="solid"/>
            </Option>
          </layer>
        `;
      } else if (isLine) {
        const strokeColorRgba = hexToRgba(style.strokeColor || "#0284c7", style.strokeOpacity ?? 1);
        const strokeStyle = style.strokeStyle || "solid";
        symbolLayerXml = `
          <layer class="SimpleLine" enabled="1" locked="0" pass="0">
            <Option type="Map">
              <Option name="line_color" type="QString" value="${strokeColorRgba}"/>
              <Option name="line_width" type="QString" value="${style.strokeWidth || 3}"/>
              <Option name="line_width_unit" type="QString" value="Pixel"/>
              <Option name="line_style" type="QString" value="${strokeStyle}"/>
              <Option name="capstyle" type="QString" value="round"/>
              <Option name="joinstyle" type="QString" value="round"/>
            </Option>
          </layer>
        `;
      } else {
        const markerColorRgba = hexToRgba(style.fillColor || "#ef4444", style.fillOpacity ?? 0.9);
        const strokeColorRgba = hexToRgba(style.strokeColor || "#ffffff", 1);
        const shape = style.markerShape || "circle";
        symbolLayerXml = `
          <layer class="SimpleMarker" enabled="1" locked="0" pass="0">
            <Option type="Map">
              <Option name="name" type="QString" value="${shape}"/>
              <Option name="color" type="QString" value="${markerColorRgba}"/>
              <Option name="size" type="QString" value="${style.markerSize || 8}"/>
              <Option name="size_unit" type="QString" value="Pixel"/>
              <Option name="outline_color" type="QString" value="${strokeColorRgba}"/>
              <Option name="outline_width" type="QString" value="${style.strokeWidth || 1.5}"/>
              <Option name="outline_width_unit" type="QString" value="Pixel"/>
              <Option name="outline_style" type="QString" value="solid"/>
            </Option>
          </layer>
        `;
      }

      return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="AllStyleCategories">
  <renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0">
    <symbols>
      <symbol type="${qgisGeom}" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        ${symbolLayerXml.trim()}
      </symbol>
    </symbols>
  </renderer-v2>
</qgis>`;
    },

    /**
     * Analyse un fichier XML QGIS QML et en extrait les propriétés de style
     */
    parse(xmlText) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, "text/xml");
      if (doc.querySelector("parsererror")) {
        throw new Error("Fichier XML QML invalide ou corrompu.");
      }

      const symbol = doc.querySelector("renderer-v2 symbols symbol") || doc.querySelector("symbol");
      if (!symbol) {
        throw new Error("Aucun symbole valide trouvé dans le fichier QML.");
      }

      const symbolType = symbol.getAttribute("type") || "fill";
      const options = {};

      // 1. Lire les <Option name="..." value="..."/> modernes
      symbol.querySelectorAll("Option[name][value]").forEach(opt => {
        options[opt.getAttribute("name")] = opt.getAttribute("value");
      });

      // 2. Lire les <prop k="..." v="..."/> traditionnels QGIS
      symbol.querySelectorAll("prop[k][v]").forEach(prop => {
        options[prop.getAttribute("k")] = prop.getAttribute("v");
      });

      const parsedStyle = {};

      // Remplissage / Couleur principale
      const rawFill = options["color"] || options["fill_color"] || options["line_color"];
      if (rawFill) {
        const fillRgba = rgbaToHex(rawFill);
        if (fillRgba) {
          parsedStyle.fillColor = fillRgba.hex;
          parsedStyle.fillOpacity = Math.round(fillRgba.alpha * 100) / 100;
        }
      }

      // Contour / Ligne
      const rawStroke = options["outline_color"] || options["line_color"] || options["stroke_color"];
      if (rawStroke) {
        const strokeRgba = rgbaToHex(rawStroke);
        if (strokeRgba) {
          parsedStyle.strokeColor = strokeRgba.hex;
        }
      }

      const strokeW = parseFloat(options["outline_width"] || options["line_width"]);
      if (!isNaN(strokeW) && strokeW > 0) {
        parsedStyle.strokeWidth = strokeW;
      }

      const strokeStyle = options["outline_style"] || options["line_style"];
      if (strokeStyle) {
        parsedStyle.strokeStyle = strokeStyle.toLowerCase();
      }

      // Marqueur ponctuel
      const markerSize = parseFloat(options["size"]);
      if (!isNaN(markerSize) && markerSize > 0) {
        parsedStyle.markerSize = markerSize;
      }
      const markerName = options["name"];
      if (markerName) {
        const cleanName = markerName.toLowerCase();
        if (["circle", "square", "triangle", "diamond", "star", "cross"].includes(cleanName)) {
          parsedStyle.markerShape = cleanName;
        }
      }

      return {
        detectedType: symbolType,
        style: parsedStyle
      };
    }
  };

  /**
   * =========================================================================
   * Gestionnaire Principal de Couches Vectorielles & Numérisation (VectorManager)
   * =========================================================================
   */
  class VectorManager {
    constructor() {
      this.map = null;
      this.layers = [];
      this.activeLayerId = null;

      // État de dessin
      this.isDrawing = false;
      this.drawingCoords = [];
      this.drawingType = null; // "Polygon" | "LineString" | "Point"

      // Éléments d'interaction sur la carte
      this.activeVertexMarkers = [];
      this.selectedFeature = null;
      this.activePopup = null;

      // DOM refs
      this.dom = {};

      this.loadLayers();
    }

    /**
     * Initialisation avec l'instance de carte MapLibre
     */
    init(mapInstance) {
      this.map = mapInstance;
      this.buildDom();
      this.bindMapEvents();
      this.setupDragAndDrop();
      this.syncAllLayersToMap();
      this.renderInlineLayersList();
    }

    /**
     * Initialise les couches en mémoire (sans persistance localStorage selon les exigences utilisateur)
     */
    loadLayers() {
      try {
        localStorage.removeItem(STORAGE_KEY_VECTORS);
      } catch (e) {
        // Ignorer
      }
      this.layers = [];
      this.activeLayerId = null;
    }

    /**
     * Enregistre les couches (désactivé pour éviter la saturation 5MB et préserver des sessions fraîches)
     */
    saveLayers() {
      // Non-persistant selon la consigne de l'utilisateur
    }

    /**
     * Construit les modales et la barre d'outils de dessin dans le DOM
     */
    buildDom() {
      // 1. Barre d'outils de tracé flottante sur la carte
      const drawToolbar = document.createElement("div");
      drawToolbar.id = "vector-drawing-toolbar";
      drawToolbar.className = "vector-drawing-toolbar";
      drawToolbar.style.display = "none";
      drawToolbar.innerHTML = `
        <div class="vector-drawing-info">
          <svg class="vector-drawing-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          <span id="vector-draw-type-label">Tracé en cours</span>
          <span id="vector-draw-measure" class="vector-drawing-measure">0 sommet</span>
        </div>
        <button type="button" id="vector-draw-btn-finish" class="vector-drawing-btn finish" title="Terminer l'entité (ou double-clic sur la carte)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Terminer</span>
        </button>
        <button type="button" id="vector-draw-btn-undo" class="vector-drawing-btn undo" title="Annuler le dernier sommet">
          <span>Annuler point</span>
        </button>
        <button type="button" id="vector-draw-btn-cancel" class="vector-drawing-btn cancel" title="Annuler le tracé (Échap)">
          <span>Annuler</span>
        </button>
      `;
      document.body.appendChild(drawToolbar);

      // 2. Modale principale du Gestionnaire de Couches Vectorielles
      const managerModal = document.createElement("div");
      managerModal.id = "vector-manager-modal";
      managerModal.className = "vector-modal-overlay";
      managerModal.innerHTML = `
        <div class="vector-modal">
          <div class="vector-modal-header">
            <div class="vector-modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              <span>Couche personnelle</span>
            </div>
            <button type="button" class="vector-modal-close" id="vector-modal-close">&times;</button>
          </div>
          <div class="vector-modal-body">
            <div class="vector-actions-bar">
              <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                <button type="button" id="vector-btn-new-layer" class="vector-btn-primary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>Nouvelle couche</span>
                </button>
                <label class="vector-btn-secondary" style="cursor: pointer; margin: 0;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  <span>Importer fichier</span>
                  <input type="file" id="vector-input-import-data" accept=".geojson,.json,.kml,.fgb,.zip,.qml" multiple style="display: none;" />
                </label>
              </div>
            </div>

            <!-- Zone de glisser-déposer dans la modale -->
            <div class="vector-modal-dropzone" id="vector-modal-dropzone" title="Glissez des fichiers ici ou cliquez pour parcourir">
              <svg class="vector-modal-dropzone-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <div class="vector-modal-dropzone-text">Glissez vos fichiers ici ou <span style="text-decoration: underline; color: #166534;">parcourez</span></div>
              <div class="vector-modal-dropzone-sub">Shapefile (.zip), FlatGeobuf (.fgb), GeoJSON, KML ou Style QGIS (.qml)</div>
            </div>

            <!-- Liste des couches -->
            <div id="vector-layers-list" class="vector-layers-list">
              <!-- Rempli dynamiquement -->
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(managerModal);

      // 3. Modale d'Édition du Style & QML
      const styleModal = document.createElement("div");
      styleModal.id = "vector-style-modal";
      styleModal.className = "vector-modal-overlay";
      styleModal.innerHTML = `
        <div class="vector-modal vector-style-modal">
          <div class="vector-modal-header">
            <div class="vector-modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12"></path></svg>
              <span>Style de la couche : <strong id="vector-style-layer-name"></strong></span>
            </div>
            <button type="button" class="vector-modal-close" id="vector-style-close">&times;</button>
          </div>
          <div class="vector-modal-body">
            <!-- Aperçu de la symbologie -->
            <div id="vector-style-preview" class="vector-style-preview"></div>

            <!-- Contrôles spécifiques au type -->
            <div id="vector-style-controls" style="display: flex; flex-direction: column; gap: 8px;"></div>

            <!-- Boîte d'interopérabilité QGIS QML -->
            <div class="vector-qml-box">
              <div class="vector-qml-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span>Style QGIS (.qml)</span>
              </div>
              <div style="font-size: 11px; color: #475569;">
                Importez ou exportez ce style au format standard QGIS QML pour le réutiliser fidèlement dans QGIS Desktop ou GeoLibre.
              </div>
              <div class="vector-qml-actions">
                <button type="button" id="vector-btn-export-qml" class="vector-btn-secondary" style="flex: 1; justify-content: center;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>Exporter style .qml</span>
                </button>
                <label class="vector-btn-secondary" style="flex: 1; justify-content: center; cursor: pointer; margin: 0;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                  <span>Importer style .qml</span>
                  <input type="file" id="vector-input-import-qml" accept=".qml,.xml" style="display: none;" />
                </label>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(styleModal);

      // 4. Modale Table d'Attributs
      const tableModal = document.createElement("div");
      tableModal.id = "vector-table-modal";
      tableModal.className = "vector-modal-overlay";
      tableModal.innerHTML = `
        <div class="vector-modal vector-table-modal">
          <div class="vector-modal-header">
            <div class="vector-modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line></svg>
              <span>Table d'attributs : <strong id="vector-table-layer-name"></strong></span>
            </div>
            <button type="button" class="vector-modal-close" id="vector-table-close">&times;</button>
          </div>
          <div class="vector-modal-body">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
              <input type="text" id="vector-table-search" placeholder="Filtrer les entités..." class="vector-attr-input" style="max-width: 240px;" />
              <div style="display: flex; gap: 6px;">
                <button type="button" id="vector-table-btn-add-field" class="vector-btn-secondary" style="font-size: 11px;">
                  + Ajouter un champ
                </button>
                <button type="button" id="vector-table-btn-export-csv" class="vector-btn-secondary" style="font-size: 11px;">
                  Exporter CSV
                </button>
              </div>
            </div>
            <div class="vector-table-wrap">
              <table class="vector-table" id="vector-table-element">
                <thead><tr id="vector-table-thead-row"></tr></thead>
                <tbody id="vector-table-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(tableModal);

      // 5. Modale Formulaire d'une entité
      const featureModal = document.createElement("div");
      featureModal.id = "vector-feature-modal";
      featureModal.className = "vector-modal-overlay";
      featureModal.innerHTML = `
        <div class="vector-modal" style="max-width: 480px;">
          <div class="vector-modal-header">
            <div class="vector-modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              <span>Attributs de l'entité</span>
            </div>
            <button type="button" class="vector-modal-close" id="vector-feature-close">&times;</button>
          </div>
          <div class="vector-modal-body">
            <form id="vector-feature-form" class="vector-feature-form">
              <div id="vector-feature-fields-container"></div>
              <div style="display: flex; gap: 8px; margin-top: 10px;">
                <button type="submit" class="vector-btn-primary" style="flex: 1; justify-content: center;">Enregistrer</button>
                <button type="button" id="vector-feature-btn-delete" class="vector-tool-btn danger" style="padding: 7px 12px;">Supprimer l'entité</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(featureModal);

      // 5. Overlay plein écran pour le Glisser-Déposer (Drag and Drop sur la carte ou la fenêtre)
      const dropOverlay = document.createElement("div");
      dropOverlay.id = "vector-drag-drop-overlay";
      dropOverlay.className = "vector-drag-drop-overlay";
      dropOverlay.innerHTML = `
        <div class="vector-drop-card">
          <div class="vector-drop-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <div class="vector-drop-title">Déposez vos fichiers géospatiaux ici</div>
          <div class="vector-drop-desc">Ajoutez instantanément vos couches vectorielles ou appliquez vos styles QGIS sur la carte</div>
          <div class="vector-drop-badges">
            <span class="vector-drop-badge highlight">Shapefile (.zip)</span>
            <span class="vector-drop-badge highlight">FlatGeobuf (.fgb)</span>
            <span class="vector-drop-badge highlight">GeoJSON (.geojson, .json)</span>
            <span class="vector-drop-badge highlight">KML (.kml)</span>
            <span class="vector-drop-badge">Style QGIS (.qml)</span>
          </div>
        </div>
      `;
      document.body.appendChild(dropOverlay);

      // Références DOM
      this.dom = {
        drawToolbar,
        drawTypeLabel: document.getElementById("vector-draw-type-label"),
        drawMeasure: document.getElementById("vector-draw-measure"),
        drawBtnFinish: document.getElementById("vector-draw-btn-finish"),
        drawBtnUndo: document.getElementById("vector-draw-btn-undo"),
        drawBtnCancel: document.getElementById("vector-draw-btn-cancel"),

        dropOverlay,
        modalDropzone: document.getElementById("vector-modal-dropzone"),
        managerModal,
        layersList: document.getElementById("vector-layers-list"),
        btnNewLayer: document.getElementById("vector-btn-new-layer"),
        inputImportData: document.getElementById("vector-input-import-data"),
        modalClose: document.getElementById("vector-modal-close"),

        styleModal,
        styleLayerName: document.getElementById("vector-style-layer-name"),
        stylePreview: document.getElementById("vector-style-preview"),
        styleControls: document.getElementById("vector-style-controls"),
        styleClose: document.getElementById("vector-style-close"),
        btnExportQml: document.getElementById("vector-btn-export-qml"),
        inputImportQml: document.getElementById("vector-input-import-qml"),

        tableModal,
        tableLayerName: document.getElementById("vector-table-layer-name"),
        tableTheadRow: document.getElementById("vector-table-thead-row"),
        tableTbody: document.getElementById("vector-table-tbody"),
        tableSearch: document.getElementById("vector-table-search"),
        btnAddField: document.getElementById("vector-table-btn-add-field"),
        btnExportCsv: document.getElementById("vector-table-btn-export-csv"),
        tableClose: document.getElementById("vector-table-close"),

        featureModal,
        featureForm: document.getElementById("vector-feature-form"),
        featureFieldsContainer: document.getElementById("vector-feature-fields-container"),
        btnDeleteFeature: document.getElementById("vector-feature-btn-delete"),
        featureClose: document.getElementById("vector-feature-close")
      };

      this.bindUiEvents();
    }

    /**
     * Liaison des écouteurs d'interface utilisateur
     */
    bindUiEvents() {
      // Fermeture des modales
      const closeAllModals = () => {
        document.querySelectorAll(".vector-modal-overlay").forEach(el => el.classList.remove("active"));
      };

      [this.dom.modalClose, this.dom.styleClose, this.dom.tableClose, this.dom.featureClose].forEach(btn => {
        if (btn) btn.addEventListener("click", closeAllModals);
      });

      document.querySelectorAll(".vector-modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) closeAllModals();
        });
      });

      // Raccourci Échap pour fermer modales ou annuler dessin
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (this.isDrawing) {
            this.cancelDrawing();
          } else {
            closeAllModals();
          }
        } else if (e.key === "Enter" && this.isDrawing) {
          this.finishDrawing();
        }
      });

      // Actions de dessin
      if (this.dom.drawBtnFinish) this.dom.drawBtnFinish.addEventListener("click", () => this.finishDrawing());
      if (this.dom.drawBtnUndo) this.dom.drawBtnUndo.addEventListener("click", () => this.undoLastPoint());
      if (this.dom.drawBtnCancel) this.dom.drawBtnCancel.addEventListener("click", () => this.cancelDrawing());

      // Création de nouvelle couche
      if (this.dom.btnNewLayer) {
        this.dom.btnNewLayer.addEventListener("click", () => this.promptCreateLayer());
      }

      // Importation de données vectorielles (multi-fichiers, SHP, FGB, GeoJSON, KML, QML)
      if (this.dom.inputImportData) {
        this.dom.inputImportData.addEventListener("change", async (e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          await this.handleDroppedFiles(files);
          e.target.value = "";
        });
      }

      // Dropdown menu du bouton "+" dans le panneau des couches perso
      const btnAddPersonal = document.getElementById("btn-add-personal-layer");
      const dropdownPersonal = document.getElementById("personal-add-dropdown");
      if (btnAddPersonal && dropdownPersonal) {
        btnAddPersonal.addEventListener("click", (e) => {
          e.stopPropagation();
          const isShown = dropdownPersonal.style.display === "block";
          dropdownPersonal.style.display = isShown ? "none" : "block";
        });

        document.addEventListener("click", (e) => {
          if (!dropdownPersonal.contains(e.target) && e.target !== btnAddPersonal) {
            dropdownPersonal.style.display = "none";
          }
        });

        const btnQuickPoly = document.getElementById("btn-quick-new-poly");
        if (btnQuickPoly) {
          btnQuickPoly.addEventListener("click", () => {
            dropdownPersonal.style.display = "none";
            this.createNewLayerQuick("Polygon");
          });
        }

        const btnQuickLine = document.getElementById("btn-quick-new-line");
        if (btnQuickLine) {
          btnQuickLine.addEventListener("click", () => {
            dropdownPersonal.style.display = "none";
            this.createNewLayerQuick("LineString");
          });
        }

        const btnQuickPoint = document.getElementById("btn-quick-new-point");
        if (btnQuickPoint) {
          btnQuickPoint.addEventListener("click", () => {
            dropdownPersonal.style.display = "none";
            this.createNewLayerQuick("Point");
          });
        }

        const inputQuickFile = document.getElementById("vector-input-quick-file");
        if (inputQuickFile) {
          inputQuickFile.addEventListener("change", async (e) => {
            dropdownPersonal.style.display = "none";
            if (e.target.files && e.target.files.length > 0) {
              await this.handleDroppedFiles(e.target.files);
              e.target.value = "";
            }
          });
        }
      }

      // Exportation de style QML
      if (this.dom.btnExportQml) {
        this.dom.btnExportQml.addEventListener("click", () => {
          const layer = this.getLayer(this.editingStyleLayerId);
          if (!layer) return;
          const qmlXml = QmlHandler.generate(layer);
          const fileName = `${layer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_style.qml`;
          downloadBlob(qmlXml, fileName, "text/xml");
        });
      }

      // Importation de style QML
      if (this.dom.inputImportQml) {
        this.dom.inputImportQml.addEventListener("change", async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          await this.applyQmlFile(file, this.editingStyleLayerId);
          e.target.value = "";
        });
      }

      // Table d'attributs : recherche
      if (this.dom.tableSearch) {
        this.dom.tableSearch.addEventListener("input", (e) => {
          const q = e.target.value.toLowerCase().trim();
          const rows = this.dom.tableTbody.querySelectorAll("tr");
          rows.forEach(tr => {
            tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
          });
        });
      }

      // Table d'attributs : ajout de champ
      if (this.dom.btnAddField) {
        this.dom.btnAddField.addEventListener("click", () => {
          const layer = this.getLayer(this.activeTableLayerId);
          if (!layer) return;
          const fieldName = prompt("Nom du nouvel attribut (ex: Culture, Drainage, Rendement) :");
          if (!fieldName || !fieldName.trim()) return;
          const clean = fieldName.trim();
          if (!layer.fields) layer.fields = [];
          if (layer.fields.some(f => f.name === clean)) {
            alert("Cet attribut existe déjà.");
            return;
          }
          layer.fields.push({ name: clean, label: clean });
          this.saveLayers();
          this.renderTableModal(layer);
        });
      }

      // Table d'attributs : export CSV
      if (this.dom.btnExportCsv) {
        this.dom.btnExportCsv.addEventListener("click", () => {
          const layer = this.getLayer(this.activeTableLayerId);
          if (!layer) return;
          this.exportLayerCsv(layer);
        });
      }

      // Formulaire entité : enregistrement
      if (this.dom.featureForm) {
        this.dom.featureForm.addEventListener("submit", (e) => {
          e.preventDefault();
          this.saveFeatureForm();
        });
      }

      // Formulaire entité : suppression
      if (this.dom.btnDeleteFeature) {
        this.dom.btnDeleteFeature.addEventListener("click", () => {
          if (!this.editingFeatureInfo) return;
          if (confirm("Voulez-vous vraiment supprimer cette entité ?")) {
            this.deleteFeature(this.editingFeatureInfo.layerId, this.editingFeatureInfo.featureId);
            this.dom.featureModal.classList.remove("active");
          }
        });
      }
    }

    /**
     * Liaison des interactions MapLibre pour le dessin et la sélection
     */
    bindMapEvents() {
      if (!this.map) return;

      // Source & Calques de prévisualisation du dessin
      const ensureDrawSources = () => {
        if (!this.map.getSource("vector-draw-preview")) {
          this.map.addSource("vector-draw-preview", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });

          // Remplissage polygone en cours
          this.map.addLayer({
            id: "vector-draw-fill",
            type: "fill",
            source: "vector-draw-preview",
            filter: ["==", "$type", "Polygon"],
            paint: {
              "fill-color": "#22c55e",
              "fill-opacity": 0.35
            }
          });

          // Ligne ou contour de polygone en cours
          this.map.addLayer({
            id: "vector-draw-line",
            type: "line",
            source: "vector-draw-preview",
            paint: {
              "line-color": "#15803d",
              "line-width": 2.5,
              "line-dasharray": [2, 1]
            }
          });

          // Sommets de repère
          this.map.addLayer({
            id: "vector-draw-vertices",
            type: "circle",
            source: "vector-draw-preview",
            filter: ["==", "$type", "Point"],
            paint: {
              "circle-radius": 5,
              "circle-color": "#ffffff",
              "circle-stroke-color": "#15803d",
              "circle-stroke-width": 2.5
            }
          });
        }
      };

      if (this.map.style) {
        ensureDrawSources();
      } else {
        this.map.once("load", ensureDrawSources);
      }

      this.map.on("styledata", () => {
        ensureDrawSources();
        this.bringToFront();
      });

      // Écouteur de clic sur la carte
      this.map.on("click", (e) => {
        if (this.isDrawing) {
          this.onMapClick(e);
          return;
        }

        // Si on n'est pas en mode dessin, vérifier si on a cliqué sur une entité vectorielle
        const vectorLayerIds = [];
        this.layers.forEach(l => {
          if (l.visible) {
            vectorLayerIds.push(
              `vector-fill-${l.id}`,
              `vector-stroke-${l.id}`,
              `vector-line-${l.id}`,
              `vector-point-${l.id}`,
              `vector-label-${l.id}`
            );
          }
        });

        const existingLayers = vectorLayerIds.filter(id => this.map.getLayer(id));
        if (existingLayers.length > 0) {
          const features = this.map.queryRenderedFeatures(e.point, { layers: existingLayers });
          if (features && features.length > 0) {
            const feat = features[0];
            const layerId = feat.layer.id.replace(/^vector-(fill|stroke|line|point|label)-/, "");
            const featId = feat.properties?.__pf_id || feat.id || feat.properties?.id;
            const clickCoords = [e.lngLat.lng, e.lngLat.lat];
            this.selectFeature(layerId, featId, feat.properties, clickCoords);
          } else {
            this.clearFeatureSelection();
          }
        }
      });

      // Écouteur de mouvement de souris (pour la ligne dynamique / rubberband)
      this.map.on("mousemove", (e) => {
        if (this.isDrawing) {
          this.onMouseMove(e);
        }
      });

      // Double-clic : terminer le dessin OU ouvrir directement les attributs de l'entité cliquée
      this.map.on("dblclick", (e) => {
        if (this.isDrawing) {
          e.preventDefault();
          this.finishDrawing();
          return;
        }

        const vectorLayerIds = [];
        this.layers.forEach(l => {
          if (l.visible) {
            vectorLayerIds.push(
              `vector-fill-${l.id}`,
              `vector-stroke-${l.id}`,
              `vector-line-${l.id}`,
              `vector-point-${l.id}`,
              `vector-label-${l.id}`
            );
          }
        });

        const existingLayers = vectorLayerIds.filter(id => this.map.getLayer(id));
        if (existingLayers.length > 0) {
          const features = this.map.queryRenderedFeatures(e.point, { layers: existingLayers });
          if (features && features.length > 0) {
            e.preventDefault();
            const feat = features[0];
            const layerId = feat.layer.id.replace(/^vector-(fill|stroke|line|point|label)-/, "");
            const featId = feat.properties?.__pf_id || feat.id || feat.properties?.id;
            const clickCoords = [e.lngLat.lng, e.lngLat.lat];
            const layer = this.getLayer(layerId);
            const targetFeat = this.findFeature(layer, featId, feat.properties, clickCoords);
            if (targetFeat) {
              const actualId = targetFeat.properties?.__pf_id || targetFeat.id || targetFeat.properties?.id;
              this.openFeatureModal(layerId, actualId, targetFeat);
            }
          }
        }
      });
    }

    /**
     * Recherche avec précision une entité spécifique dans une couche (évite absolument de renvoyer la 1ère par défaut)
     */
    findFeature(layer, featureId, featProps = null, clickCoords = null) {
      if (!layer || !layer.data || !layer.data.features || !layer.data.features.length) return null;
      const features = layer.data.features;

      // 1. Chercher par identifiant exact strict (ne jamais matcher avec undefined)
      if (featureId !== undefined && featureId !== null && featureId !== "") {
        const byId = features.find(f => 
          (f.properties && f.properties.__pf_id === featureId) ||
          f.__pf_id === featureId ||
          f.id === featureId ||
          (f.properties && f.properties.id === featureId)
        );
        if (byId) return byId;
      }

      // 2. Chercher via les propriétés retournées par MapLibre
      if (featProps && typeof featProps === "object") {
        const propId = featProps.__pf_id || featProps.id;
        if (propId) {
          const byPropId = features.find(f => 
            (f.properties && f.properties.__pf_id === propId) ||
            f.id === propId ||
            (f.properties && f.properties.id === propId)
          );
          if (byPropId) return byPropId;
        }

        // Comparaison sur les attributs réels
        const propKeys = Object.keys(featProps).filter(k => !k.startsWith("__"));
        if (propKeys.length > 0) {
          const byProps = features.find(f => {
            if (!f.properties) return false;
            return propKeys.every(k => String(f.properties[k]) === String(featProps[k]));
          });
          if (byProps) return byProps;
        }
      }

      // 3. Fallback géométrique si des coordonnées de clic sont fournies (point dans polygone)
      if (clickCoords && Array.isArray(clickCoords)) {
        for (const f of features) {
          if (f.geometry && f.geometry.type === "Polygon") {
            if (pointInPolygon(clickCoords, f.geometry.coordinates)) {
              return f;
            }
          } else if (f.geometry && f.geometry.type === "MultiPolygon") {
            for (const ring of f.geometry.coordinates) {
              if (pointInPolygon(clickCoords, ring)) return f;
            }
          }
        }
      }

      return null;
    }

    /**
     * Retourne une couche par son identifiant
     */
    getLayer(layerId) {
      return this.layers.find(l => l.id === layerId) || null;
    }

    /**
     * Ouvre la modale principale du gestionnaire
     */
    openManagerModal() {
      this.renderLayersList();
      this.dom.managerModal.classList.add("active");
    }

    /**
     * Affiche la liste des couches dans la modale
     */
    renderLayersList() {
      const container = this.dom.layersList;
      if (!container) return;
      container.innerHTML = "";

      if (this.layers.length === 0) {
        container.innerHTML = `
          <div class="vector-layer-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            <div><strong>Aucune couche vectorielle personnalisée</strong><br/>Créez une couche ou importez un fichier GeoJSON/KML pour commencer.</div>
          </div>
        `;
        return;
      }

      this.layers.forEach(layer => {
        const card = document.createElement("div");
        card.className = `vector-layer-card ${layer.id === this.activeLayerId ? "active" : ""}`;
        card.dataset.layerId = layer.id;

        const count = layer.data && layer.data.features ? layer.data.features.length : 0;
        const geomType = layer.geometryType.toLowerCase();
        const typeClass = geomType.includes("poly") ? "polygon" : geomType.includes("line") ? "line" : "point";
        const typeName = geomType.includes("poly") ? "Polygones" : geomType.includes("line") ? "Lignes" : "Points";
        const color = layer.style.fillColor || layer.style.strokeColor || "#16a34a";

        card.innerHTML = `
          <div class="vector-layer-top">
            <input type="checkbox" ${layer.visible ? "checked" : ""} class="vector-check-vis" title="Afficher / Masquer la couche sur la carte" />
            <div class="vector-layer-swatch" style="background: ${color};"></div>
            <div class="vector-layer-info">
              <span class="vector-layer-name" contenteditable="true" spellcheck="false" title="Cliquer pour renommer">${layer.name}</span>
              <span class="vector-badge-type ${typeClass}">${typeName}</span>
            </div>
            <span class="vector-badge-count">${count} entité${count > 1 ? "s" : ""}</span>
          </div>

          <div class="vector-layer-toolbar">
            <button type="button" class="vector-tool-btn primary btn-draw" title="Tracer une nouvelle entité sur la carte">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              <span>Tracer / Dessiner</span>
            </button>
            <button type="button" class="vector-tool-btn btn-style" title="Modifier la symbologie et exporter/importer le style QGIS QML">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12"></path></svg>
              <span>Style &amp; QML</span>
            </button>
            <button type="button" class="vector-tool-btn btn-table" title="Ouvrir la table d'attributs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg>
              <span>Attributs (${count})</span>
            </button>
            <button type="button" class="vector-tool-btn btn-export-data" title="Télécharger les données au format GeoJSON">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>GeoJSON</span>
            </button>
            <button type="button" class="vector-tool-btn btn-zoom" title="Cadrer la vue sur les entités de cette couche">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </button>
            <button type="button" class="vector-tool-btn danger btn-delete" title="Supprimer définitivement cette couche">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        `;

        // Événements de la carte couche
        const checkVis = card.querySelector(".vector-check-vis");
        checkVis.addEventListener("change", (e) => {
          layer.visible = e.target.checked;
          this.setLayerVisibility(layer.id, layer.visible);
          this.saveLayers();
        });

        const nameEl = card.querySelector(".vector-layer-name");
        nameEl.addEventListener("blur", () => {
          const val = nameEl.textContent.trim();
          if (val && val !== layer.name) {
            layer.name = val;
            this.updateLayerOnMap(layer);
            this.renderInlineLayersList();
            this.showToast(`Couche renommée en "${layer.name}"`);
          }
        });
        nameEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nameEl.blur();
          }
        });

        card.querySelector(".btn-draw").addEventListener("click", () => {
          this.activeLayerId = layer.id;
          this.dom.managerModal.classList.remove("active");
          this.startDrawing(layer.id);
        });

        card.querySelector(".btn-style").addEventListener("click", () => {
          this.openStyleModal(layer.id);
        });

        card.querySelector(".btn-table").addEventListener("click", () => {
          this.openTableModal(layer.id);
        });

        card.querySelector(".btn-export-data").addEventListener("click", () => {
          this.exportLayerGeoJson(layer);
        });

        card.querySelector(".btn-zoom").addEventListener("click", () => {
          this.zoomToLayer(layer.id);
        });

        card.querySelector(".btn-delete").addEventListener("click", () => {
          if (confirm(`Supprimer la couche vectorielle "${layer.name}" ?`)) {
            this.deleteLayer(layer.id);
          }
        });

        container.appendChild(card);
      });

      // Mettre à jour la liste rapide dans le volet d'outils
      const quickContainer = document.getElementById("panel-vector-layers-quick");
      if (quickContainer) {
        quickContainer.innerHTML = "";
        this.layers.forEach(layer => {
          const count = layer.data && layer.data.features ? layer.data.features.length : 0;
          const color = layer.style.fillColor || layer.style.strokeColor || "#16a34a";
          const row = document.createElement("div");
          row.style.cssText = "display:flex; align-items:center; justify-content:space-between; padding:5px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px;";
          row.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
              <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${color}; flex-shrink:0;"></span>
              <span style="font-weight:600; color:#1e293b; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${layer.name}</span>
            </div>
            <span style="font-size:10px; color:#64748b; font-weight:600; flex-shrink:0;">${count} entité${count > 1 ? "s" : ""}</span>
          `;
          quickContainer.appendChild(row);
        });
      }

      // Si le compositeur est ouvert, rafraîchir sa légende
      if (window.composer && window.composer.isOpen && typeof window.composer.updateActiveLegend === "function") {
        window.composer.updateActiveLegend();
      }

      this.renderInlineLayersList();
    }

    /**
     * Affiche la liste compacte directe des couches personnelles dans le volet latéral
     * avec les boutons directs : Cacher/Afficher, Zoom to, Éditer (style/QML/attributs), Tracer, Supprimer
     */
    renderInlineLayersList() {
      const container = document.getElementById("panel-vector-layers-list");
      if (!container) return;
      container.innerHTML = "";

      if (this.layers.length === 0) {
        container.innerHTML = `
          <div style="padding: 10px 8px; text-align: center; color: #64748b; font-size: 11px; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 6px;">
            Aucune couche personnelle.<br/>Cliquez sur <strong style="color: #0284c7;">+</strong> ci-dessus ou glissez un fichier.
          </div>
        `;
        return;
      }

      this.layers.forEach(layer => {
        const row = document.createElement("div");
        row.className = `personal-layer-row ${layer.id === this.activeLayerId ? "active" : ""}`;
        row.dataset.layerId = layer.id;

        const count = layer.data && layer.data.features ? layer.data.features.length : 0;
        const color = layer.style.fillColor || layer.style.strokeColor || "#16a34a";

        const eyeIcon = layer.visible
          ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
          : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

        row.innerHTML = `
          <div class="personal-layer-left">
            <button type="button" class="personal-layer-btn btn-vis ${layer.visible ? "" : "muted"}" title="${layer.visible ? "Masquer la couche" : "Afficher la couche"}">
              ${eyeIcon}
            </button>
            <span class="personal-layer-swatch" style="background: ${color};" title="Couleur de la couche"></span>
            <span class="personal-layer-name" contenteditable="true" spellcheck="false" title="Double-cliquez ou modifiez pour renommer">${layer.name}</span>
            <span style="font-size: 10px; color: #94a3b8; font-weight: 600; flex-shrink: 0;">(${count})</span>
          </div>
          <div class="personal-layer-actions">
            <button type="button" class="personal-layer-btn btn-draw" title="Tracer une nouvelle entité sur cette couche">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button type="button" class="personal-layer-btn btn-zoom" title="Zoomer sur cette couche">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </button>
            <button type="button" class="personal-layer-btn btn-rename" title="Renommer la couche">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button type="button" class="personal-layer-btn btn-export" title="Exporter la couche (GeoJSON, KML, CSV)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button type="button" class="personal-layer-btn btn-edit" title="Modifier le style, attributs &amp; QML">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button type="button" class="personal-layer-btn danger btn-del" title="Supprimer la couche">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        `;

        // Événement Visibilité
        row.querySelector(".btn-vis").addEventListener("click", (e) => {
          e.stopPropagation();
          layer.visible = !layer.visible;
          this.setLayerVisibility(layer.id, layer.visible);
          if (layer.visible) this.bringToFront();
          this.renderInlineLayersList();
          this.renderLayersList();
        });

        // Événement Renommer la couche
        const nameEl = row.querySelector(".personal-layer-name");
        const btnRename = row.querySelector(".btn-rename");
        const doRename = () => {
          const current = layer.name;
          const val = prompt("Nouveau nom de la couche :", current);
          if (val && val.trim() && val.trim() !== current) {
            layer.name = val.trim();
            this.updateLayerOnMap(layer);
            this.renderInlineLayersList();
            this.renderLayersList();
            this.showToast(`Couche renommée en "${layer.name}"`);
          }
        };

        if (btnRename) {
          btnRename.addEventListener("click", (e) => {
            e.stopPropagation();
            doRename();
          });
        }

        if (nameEl) {
          nameEl.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            doRename();
          });
          nameEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              nameEl.blur();
            }
          });
          nameEl.addEventListener("blur", () => {
            const val = nameEl.textContent.trim();
            if (val && val !== layer.name) {
              layer.name = val;
              this.updateLayerOnMap(layer);
              this.renderLayersList();
              this.showToast(`Couche renommée en "${layer.name}"`);
            } else {
              nameEl.textContent = layer.name;
            }
          });
        }

        // Événement Exporter la couche
        const btnExport = row.querySelector(".btn-export");
        if (btnExport) {
          btnExport.addEventListener("click", (e) => {
            e.stopPropagation();
            this.showExportMenu(layer, btnExport);
          });
        }

        // Événement Tracer / Dessiner
        row.querySelector(".btn-draw").addEventListener("click", (e) => {
          e.stopPropagation();
          this.activeLayerId = layer.id;
          this.startDrawing(layer.id);
        });

        // Événement Zoom to
        row.querySelector(".btn-zoom").addEventListener("click", (e) => {
          e.stopPropagation();
          this.zoomToLayer(layer.id);
        });

        // Événement Éditer style & QML
        row.querySelector(".btn-edit").addEventListener("click", (e) => {
          e.stopPropagation();
          this.openStyleModal(layer.id);
        });

        // Événement Supprimer
        row.querySelector(".btn-del").addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm(`Supprimer la couche vectorielle "${layer.name}" ?`)) {
            this.deleteLayer(layer.id);
          }
        });

        // Clic sur la ligne pour activer la couche
        row.addEventListener("click", () => {
          this.activeLayerId = layer.id;
          container.querySelectorAll(".personal-layer-row").forEach(el => el.classList.remove("active"));
          row.classList.add("active");
        });

        container.appendChild(row);
      });
    }

    /**
     * Maintient les couches personnelles toujours par-dessus toutes les autres couches de la carte
     */
    bringToFront() {
      if (!this.map || !this.map.style) return;

      this.layers.forEach(layer => {
        const layerIds = [
          `vector-fill-${layer.id}`,
          `vector-stroke-${layer.id}`,
          `vector-line-${layer.id}`,
          `vector-point-${layer.id}`,
          `vector-label-${layer.id}`
        ];
        layerIds.forEach(id => {
          if (this.map.getLayer(id)) {
            try {
              this.map.moveLayer(id);
            } catch (e) {}
          }
        });
      });

      const drawLayers = ["vector-draw-fill", "vector-draw-line", "vector-draw-vertices"];
      drawLayers.forEach(id => {
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
     * Crée instantanément une nouvelle couche vectorielle et démarre le tracé
     */
    createNewLayerQuick(geometryType = "Polygon") {
      const count = this.layers.filter(l => l.geometryType === geometryType).length + 1;
      const geomFr = geometryType === "Polygon" ? "Polygone" : geometryType === "LineString" ? "Ligne" : "Point";
      const name = `${geomFr} ${count}`;
      const color = DEFAULT_PALETTE[this.layers.length % DEFAULT_PALETTE.length];

      const newLayer = {
        id: "vec_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
        name,
        geometryType,
        visible: true,
        data: { type: "FeatureCollection", features: [] },
        style: {
          fillColor: color,
          fillOpacity: geometryType === "Polygon" ? 0.45 : 0.9,
          strokeColor: color,
          strokeWidth: 2,
          strokeStyle: "solid",
          markerShape: "circle",
          markerSize: 8,
          labelProperty: "nom"
        },
        fields: [
          { name: "nom", label: "Nom" },
          { name: "description", label: "Description" },
          ...(geometryType === "Polygon" ? [{ name: "superficie_ha", label: "Superficie (ha)" }] : []),
          ...(geometryType === "LineString" ? [{ name: "longueur_m", label: "Longueur (m)" }] : [])
        ]
      };

      this.layers.push(newLayer);
      this.activeLayerId = newLayer.id;
      this.syncLayerToMap(newLayer);
      this.bringToFront();
      this.renderInlineLayersList();
      this.renderLayersList();
      this.startDrawing(newLayer.id);
      this.showToast(`Nouvelle couche "${name}" créée. Cliquez sur la carte pour dessiner.`);
      return newLayer;
    }

    /**
     * Dialogue de création d'une nouvelle couche
     */
    promptCreateLayer() {
      const name = prompt("Nom de la nouvelle couche :", "Nouvelle parcelle");
      if (!name || !name.trim()) return;

      const typeChoice = prompt("Type de géométrie : Tapez '1' pour Polygones, '2' pour Lignes, '3' pour Points", "1");
      let geometryType = "Polygon";
      if (typeChoice === "2") geometryType = "LineString";
      if (typeChoice === "3") geometryType = "Point";

      const color = DEFAULT_PALETTE[this.layers.length % DEFAULT_PALETTE.length];
      const newLayer = {
        id: "vec_" + Date.now(),
        name: name.trim(),
        geometryType,
        visible: true,
        data: { type: "FeatureCollection", features: [] },
        style: {
          fillColor: color,
          fillOpacity: geometryType === "Polygon" ? 0.45 : 0.9,
          strokeColor: color,
          strokeWidth: 2,
          strokeStyle: "solid",
          markerShape: "circle",
          markerSize: 8,
          labelProperty: "nom"
        },
        fields: [
          { name: "nom", label: "Nom" },
          { name: "description", label: "Description" },
          ...(geometryType === "Polygon" ? [{ name: "superficie_ha", label: "Superficie (ha)" }] : []),
          ...(geometryType === "LineString" ? [{ name: "longueur_m", label: "Longueur (m)" }] : [])
        ]
      };

      this.layers.push(newLayer);
      this.activeLayerId = newLayer.id;
      this.syncLayerToMap(newLayer);
      this.bringToFront();
      this.renderLayersList();
      this.renderInlineLayersList();
    }

    /**
     * Supprime une couche vectorielle
     */
    deleteLayer(layerId) {
      this.removeLayerFromMap(layerId);
      this.layers = this.layers.filter(l => l.id !== layerId);
      if (this.activeLayerId === layerId) {
        this.activeLayerId = this.layers.length > 0 ? this.layers[0].id : null;
      }
      this.renderLayersList();
      this.renderInlineLayersList();
    }

    /**
     * Cadrer la carte sur les entités d'une couche
     */
    zoomToLayer(layerId) {
      const layer = this.getLayer(layerId);
      if (!layer || !layer.data || !layer.data.features || layer.data.features.length === 0) {
        alert("Cette couche ne contient aucune entité pour le moment.");
        return;
      }

      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      const scanCoords = (coords) => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === "number" && typeof coords[1] === "number") {
          minLng = Math.min(minLng, coords[0]);
          maxLng = Math.max(maxLng, coords[0]);
          minLat = Math.min(minLat, coords[1]);
          maxLat = Math.max(maxLat, coords[1]);
        } else {
          coords.forEach(scanCoords);
        }
      };

      layer.data.features.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
          scanCoords(f.geometry.coordinates);
        }
      });

      if (isFinite(minLng) && isFinite(minLat)) {
        this.dom.managerModal.classList.remove("active");
        this.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
          padding: 80,
          maxZoom: 17,
          duration: 900
        });
      }
    }

    /**
     * =========================================================================
     * Numérisation & Dessin interactif d'entités (Drawing Controller)
     * =========================================================================
     */
    startDrawing(layerId) {
      const layer = this.getLayer(layerId);
      if (!layer) return;

      this.activeLayerId = layerId;
      this.isDrawing = true;
      this.drawingCoords = [];
      this.drawingType = layer.geometryType;

      // Afficher la barre de dessin
      this.dom.drawToolbar.style.display = "flex";
      const geomLabel = layer.geometryType === "Polygon" ? "Polygone" : layer.geometryType === "LineString" ? "Ligne" : "Point";
      this.dom.drawTypeLabel.textContent = `Tracer : ${layer.name} (${geomLabel})`;
      this.dom.drawMeasure.textContent = "0 sommet";

      if (this.map) {
        this.map.getCanvas().style.cursor = "crosshair";
      }
    }

    onMapClick(e) {
      if (!this.isDrawing) return;
      const pt = [e.lngLat.lng, e.lngLat.lat];

      if (this.drawingType === "Point") {
        this.createFeatureFromCoords([pt]);
        this.finishDrawing();
        return;
      }

      // Si polygone et clic proche du premier point, terminer le tracé
      if (this.drawingType === "Polygon" && this.drawingCoords.length >= 3) {
        const first = this.drawingCoords[0];
        const screenP1 = this.map.project(first);
        const screenP2 = this.map.project(pt);
        const distPx = Math.hypot(screenP1.x - screenP2.x, screenP1.y - screenP2.y);
        if (distPx < 18) {
          this.finishDrawing();
          return;
        }
      }

      this.drawingCoords.push(pt);
      this.updateDrawPreview();
    }

    onMouseMove(e) {
      if (!this.isDrawing || this.drawingCoords.length === 0) return;
      if (this.drawingType === "Point") return;

      const curPt = [e.lngLat.lng, e.lngLat.lat];
      const previewList = [...this.drawingCoords, curPt];

      if (this.drawingType === "Polygon" && previewList.length >= 3) {
        const closed = [...previewList, previewList[0]];
        const area = computePolygonArea(closed);
        this.dom.drawMeasure.textContent = `${area.ha} ha (${previewList.length} sommets)`;
      } else if (this.drawingType === "LineString" && previewList.length >= 2) {
        const dist = computeLineDistance(previewList);
        const distStr = dist.km >= 1 ? `${dist.km} km` : `${dist.m} m`;
        this.dom.drawMeasure.textContent = `${distStr} (${previewList.length} sommets)`;
      }

      this.updateDrawPreview(curPt);
    }

    updateDrawPreview(hoverPt = null) {
      const src = this.map ? this.map.getSource("vector-draw-preview") : null;
      if (!src) return;

      const coords = hoverPt ? [...this.drawingCoords, hoverPt] : [...this.drawingCoords];
      if (coords.length === 0) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      const features = [];

      // Sommets individuels
      coords.forEach(c => {
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: c }
        });
      });

      if (this.drawingType === "Polygon") {
        if (coords.length >= 3) {
          features.push({
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] }
          });
        }
        if (coords.length >= 2) {
          features.push({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords }
          });
        }
      } else if (this.drawingType === "LineString") {
        if (coords.length >= 2) {
          features.push({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords }
          });
        }
      }

      src.setData({ type: "FeatureCollection", features });
    }

    undoLastPoint() {
      if (this.drawingCoords.length > 0) {
        this.drawingCoords.pop();
        this.updateDrawPreview();
        this.dom.drawMeasure.textContent = `${this.drawingCoords.length} sommet(s)`;
      }
    }

    cancelDrawing() {
      this.isDrawing = false;
      this.drawingCoords = [];
      this.dom.drawToolbar.style.display = "none";
      if (this.map) {
        this.map.getCanvas().style.cursor = "";
        const src = this.map.getSource("vector-draw-preview");
        if (src) src.setData({ type: "FeatureCollection", features: [] });
      }
    }

    finishDrawing() {
      if (!this.isDrawing) return;

      const minPts = this.drawingType === "Polygon" ? 3 : this.drawingType === "LineString" ? 2 : 1;
      if (this.drawingCoords.length < minPts) {
        alert(`Veuillez cliquer au moins ${minPts} point(s) pour terminer.`);
        return;
      }

      const coords = [...this.drawingCoords];
      const geomType = this.drawingType;
      this.cancelDrawing();
      this.createFeatureFromCoords(coords, geomType);
    }

    createFeatureFromCoords(coords, forcedGeomType = null) {
      const layer = this.getLayer(this.activeLayerId);
      if (!layer) return;

      const featId = "feat_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      let geom = null;
      const type = forcedGeomType || this.drawingType || layer.geometryType;
      const props = {
        id: featId,
        __pf_id: featId,
        nom: `${layer.name} ${layer.data.features.length + 1}`,
        date: new Date().toLocaleDateString("fr-CA")
      };

      if (type === "Polygon") {
        // Enlever les points consécutifs identiques (double-clic)
        const cleanCoords = [];
        for (let i = 0; i < coords.length; i++) {
          const pt = coords[i];
          if (cleanCoords.length === 0) {
            cleanCoords.push(pt);
          } else {
            const prev = cleanCoords[cleanCoords.length - 1];
            if (Math.abs(prev[0] - pt[0]) > 1e-7 || Math.abs(prev[1] - pt[1]) > 1e-7) {
              cleanCoords.push(pt);
            }
          }
        }
        if (cleanCoords.length < 3) return;

        const ring = [...cleanCoords];
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push([...ring[0]]);
        }
        geom = { type: "Polygon", coordinates: [ring] };
        const area = computePolygonArea(ring);
        props.superficie_ha = area.ha;
        props.superficie_m2 = area.m2;
      } else if (type === "LineString") {
        const cleanCoords = [];
        for (let i = 0; i < coords.length; i++) {
          const pt = coords[i];
          if (cleanCoords.length === 0) {
            cleanCoords.push(pt);
          } else {
            const prev = cleanCoords[cleanCoords.length - 1];
            if (Math.abs(prev[0] - pt[0]) > 1e-7 || Math.abs(prev[1] - pt[1]) > 1e-7) {
              cleanCoords.push(pt);
            }
          }
        }
        if (cleanCoords.length < 2) return;
        geom = { type: "LineString", coordinates: cleanCoords };
        const dist = computeLineDistance(cleanCoords);
        props.longueur_m = dist.m;
      } else {
        geom = { type: "Point", coordinates: coords[0] };
      }

      const newFeature = {
        type: "Feature",
        id: featId,
        properties: props,
        geometry: geom
      };

      layer.data.features.push(newFeature);
      this.syncLayerToMap(layer);
      this.bringToFront();
      if (typeof window.bringTopLayersToFront === "function") {
        window.bringTopLayersToFront();
      }
      this.renderLayersList();
      this.renderInlineLayersList();
      if (typeof this.map.triggerRepaint === "function") {
        this.map.triggerRepaint();
      }

      // Sélectionner l'entité nouvellement créée avec ses sommets et son popup d'options
      this.selectFeature(layer.id, featId, props);

      const geomLabel = type === "Polygon" ? "Polygone créé" : type === "LineString" ? "Ligne créée" : "Point créé";
      const measureStr = props.superficie_ha ? ` (${props.superficie_ha} ha)` : props.longueur_m ? ` (${props.longueur_m} m)` : "";
      this.showToast(`${geomLabel}${measureStr} !`);
    }

    /**
     * =========================================================================
     * Sélection & Modification des sommets (Vertex Dragging)
     * =========================================================================
     */
    selectFeature(layerId, featureId, featProps = null, clickCoords = null) {
      this.clearFeatureSelection();
      const layer = this.getLayer(layerId);
      if (!layer) return;

      const feat = this.findFeature(layer, featureId, featProps, clickCoords);
      if (!feat) return;

      const actualId = feat.properties?.__pf_id || feat.id || feat.properties?.id;
      this.selectedFeature = { layerId, featureId: actualId, feature: feat };

      // Afficher les poignées de sommets déplaçables
      const geom = feat.geometry;
      let vertexCoords = [];
      if (geom.type === "Polygon") {
        vertexCoords = geom.coordinates[0].slice(0, -1);
      } else if (geom.type === "LineString") {
        vertexCoords = geom.coordinates;
      } else if (geom.type === "Point") {
        vertexCoords = [geom.coordinates];
      }

      vertexCoords.forEach((pt, idx) => {
        const el = document.createElement("div");
        el.className = "vector-vertex-handle";
        el.style.cssText = `
          width: 13px;
          height: 13px;
          background: #ffffff;
          border: 2.5px solid #16a34a;
          border-radius: 50%;
          cursor: move;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        `;

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(pt)
          .addTo(this.map);

        marker.on("drag", () => {
          const lngLat = marker.getLngLat();
          const newPos = [lngLat.lng, lngLat.lat];
          if (geom.type === "Polygon") {
            geom.coordinates[0][idx] = newPos;
            if (idx === 0) geom.coordinates[0][geom.coordinates[0].length - 1] = newPos;
            const area = computePolygonArea(geom.coordinates[0]);
            feat.properties.superficie_ha = area.ha;
            feat.properties.superficie_m2 = area.m2;
          } else if (geom.type === "LineString") {
            geom.coordinates[idx] = newPos;
            const dist = computeLineDistance(geom.coordinates);
            feat.properties.longueur_m = dist.m;
          } else if (geom.type === "Point") {
            geom.coordinates = newPos;
          }
          this.updateLayerOnMap(layer);
        });

        marker.on("dragend", () => {
          this.saveLayers();
        });

        this.activeVertexMarkers.push(marker);
      });

      // Afficher un popup informatif sur l'entité exacte
      const center = clickCoords || this.getFeatureCenter(feat);
      const featName = feat.properties.nom || feat.properties.name || "Entité";
      const popupHtml = `
        <div style="font-family: var(--font-sans, sans-serif); font-size: 12px; padding: 4px;">
          <strong style="color: #0f172a; font-size: 13px;">${featName}</strong>
          <div style="color: #64748b; margin: 3px 0 6px;">
            ${feat.properties.superficie_ha ? `${feat.properties.superficie_ha} ha` : ""}
            ${feat.properties.longueur_m ? `${feat.properties.longueur_m} m` : ""}
          </div>
          <div style="display: flex; gap: 5px;">
            <button type="button" id="btn-popup-edit-attr" class="vector-tool-btn primary" style="font-size: 10.5px;">Éditer attributs</button>
            <button type="button" id="btn-popup-del-feat" class="vector-tool-btn danger" style="font-size: 10.5px;">Supprimer</button>
          </div>
        </div>
      `;

      this.activePopup = new maplibregl.Popup({ closeButton: true, offset: 12 })
        .setLngLat(center)
        .setHTML(popupHtml)
        .addTo(this.map);

      setTimeout(() => {
        const btnEdit = document.getElementById("btn-popup-edit-attr");
        if (btnEdit) {
          btnEdit.addEventListener("click", () => {
            this.openFeatureModal(layerId, actualId, feat);
          });
        }
        const btnDel = document.getElementById("btn-popup-del-feat");
        if (btnDel) {
          btnDel.addEventListener("click", () => {
            if (confirm(`Supprimer l'entité "${featName}" ?`)) {
              this.deleteFeature(layerId, actualId, feat);
              this.clearFeatureSelection();
            }
          });
        }
      }, 50);
    }

    clearFeatureSelection() {
      this.activeVertexMarkers.forEach(m => m.remove());
      this.activeVertexMarkers = [];
      if (this.activePopup) {
        this.activePopup.remove();
        this.activePopup = null;
      }
      this.selectedFeature = null;
    }

    getFeatureCenter(feat) {
      const geom = feat.geometry;
      if (geom.type === "Point") return geom.coordinates;
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      const scanCoords = (c) => {
        if (typeof c[0] === "number" && typeof c[1] === "number") {
          minLng = Math.min(minLng, c[0]);
          maxLng = Math.max(maxLng, c[0]);
          minLat = Math.min(minLat, c[1]);
          maxLat = Math.max(maxLat, c[1]);
        } else if (Array.isArray(c)) {
          c.forEach(scanCoords);
        }
      };
      scanCoords(geom.coordinates);
      return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
    }

    deleteFeature(layerId, featureId, featureObj = null) {
      const layer = this.getLayer(layerId);
      if (!layer) return;
      const target = featureObj || this.findFeature(layer, featureId);
      if (target) {
        layer.data.features = layer.data.features.filter(f => f !== target);
      } else {
        layer.data.features = layer.data.features.filter(f => {
          const fid = f.properties?.__pf_id || f.id || f.properties?.id;
          return fid !== featureId;
        });
      }
      this.updateLayerOnMap(layer);
      this.renderLayersList();
      this.renderInlineLayersList();
    }

    /**
     * =========================================================================
     * Formulaire & Table d'Attributs (Attribute Management)
     * =========================================================================
     */
    openFeatureModal(layerId, featureId, featureObj = null) {
      const layer = this.getLayer(layerId);
      if (!layer) return;
      const feat = featureObj || this.findFeature(layer, featureId);
      if (!feat) return;

      const actualId = feat.properties?.__pf_id || feat.id || feat.properties?.id;
      this.editingFeatureInfo = { layerId, featureId: actualId, feature: feat };
      const container = this.dom.featureFieldsContainer;
      container.innerHTML = "";

      // Champs existants de la couche ou de l'entité
      const fieldKeys = new Set(["nom", "description"]);
      if (layer.fields) layer.fields.forEach(f => fieldKeys.add(f.name));
      Object.keys(feat.properties).forEach(k => {
        if (!k.startsWith("__")) fieldKeys.add(k);
      });

      // Ne pas permettre d'éditer manuellement l'identifiant interne
      fieldKeys.delete("id");

      fieldKeys.forEach(key => {
        const row = document.createElement("div");
        row.className = "vector-form-row";
        const val = feat.properties[key] !== undefined ? feat.properties[key] : "";
        const isCalc = key.startsWith("superficie_") || key.startsWith("longueur_");

        row.innerHTML = `
          <label>${key} ${isCalc ? '<span style="font-size:10px; color:#166534;">(calculé auto)</span>' : ""}</label>
          <input type="text" name="${key}" value="${val}" class="vector-attr-input" ${isCalc ? "readonly style='background:#f8fafc; font-weight:600; color:#166534;'" : ""} />
        `;
        container.appendChild(row);
      });

      // Bouton pour ajouter un nouvel attribut personnalisé
      const addFieldRow = document.createElement("div");
      addFieldRow.style.marginTop = "6px";
      addFieldRow.innerHTML = `
        <button type="button" id="btn-modal-add-attr" class="vector-btn-secondary" style="font-size: 11px; width: 100%; justify-content: center;">
          + Ajouter un champ personnalisé
        </button>
      `;
      container.appendChild(addFieldRow);

      addFieldRow.querySelector("#btn-modal-add-attr").addEventListener("click", () => {
        const newAttr = prompt("Nom du nouveau champ (ex: Culture, Variété, pH, Drainage) :");
        if (!newAttr || !newAttr.trim()) return;
        const clean = newAttr.trim();
        feat.properties[clean] = "";
        if (!layer.fields) layer.fields = [];
        if (!layer.fields.some(f => f.name === clean)) {
          layer.fields.push({ name: clean, label: clean });
        }
        this.openFeatureModal(layerId, actualId, feat);
      });

      this.dom.featureModal.classList.add("active");
    }

    saveFeatureForm() {
      if (!this.editingFeatureInfo) return;
      const { layerId, feature } = this.editingFeatureInfo;
      const layer = this.getLayer(layerId);
      if (!layer) return;

      const inputs = this.dom.featureFieldsContainer.querySelectorAll("input[name]");
      inputs.forEach(input => {
        const k = input.getAttribute("name");
        let v = input.value;
        if (!isNaN(v) && v.trim() !== "" && !k.includes("nom") && !k.includes("date") && !k.includes("culture")) {
          v = parseFloat(v);
        }
        feature.properties[k] = v;
      });

      this.updateLayerOnMap(layer);
      this.renderLayersList();
      this.renderInlineLayersList();
      this.dom.featureModal.classList.remove("active");
      this.clearFeatureSelection();
    }

    openTableModal(layerId) {
      const layer = this.getLayer(layerId);
      if (!layer) return;
      this.activeTableLayerId = layerId;
      this.renderTableModal(layer);
      this.dom.tableModal.classList.add("active");
    }

    renderTableModal(layer) {
      this.dom.tableLayerName.textContent = layer.name;
      const theadRow = this.dom.tableTheadRow;
      const tbody = this.dom.tableTbody;
      theadRow.innerHTML = "";
      tbody.innerHTML = "";

      const cols = ["nom"];
      if (layer.fields) {
        layer.fields.forEach(f => {
          if (!cols.includes(f.name)) cols.push(f.name);
        });
      }
      layer.data.features.forEach(f => {
        Object.keys(f.properties).forEach(k => {
          if (k !== "id" && !cols.includes(k)) cols.push(k);
        });
      });

      // En-têtes
      cols.forEach(col => {
        const th = document.createElement("th");
        th.textContent = col;
        theadRow.appendChild(th);
      });
      const thActions = document.createElement("th");
      thActions.textContent = "Actions";
      theadRow.appendChild(thActions);

      // Lignes de données
      layer.data.features.forEach(feat => {
        const tr = document.createElement("tr");
        cols.forEach(col => {
          const td = document.createElement("td");
          const val = feat.properties[col] !== undefined ? feat.properties[col] : "";
          td.textContent = val;
          tr.appendChild(td);
        });

        const tdActions = document.createElement("td");
        tdActions.style.whiteSpace = "nowrap";
        tdActions.innerHTML = `
          <button type="button" class="vector-tool-btn btn-row-zoom" title="Zoomer sur l'entité">Zoom</button>
          <button type="button" class="vector-tool-btn primary btn-row-edit" title="Modifier les attributs">Éditer</button>
          <button type="button" class="vector-tool-btn danger btn-row-del" title="Supprimer">Suppr</button>
        `;

        tdActions.querySelector(".btn-row-zoom").addEventListener("click", () => {
          this.dom.tableModal.classList.remove("active");
          const center = this.getFeatureCenter(feat);
          this.map.flyTo({ center, zoom: 16, duration: 800 });
          setTimeout(() => this.selectFeature(layer.id, feat.properties?.__pf_id || feat.id || feat.properties?.id, feat.properties), 850);
        });

        tdActions.querySelector(".btn-row-edit").addEventListener("click", () => {
          this.openFeatureModal(layer.id, feat.properties?.__pf_id || feat.id || feat.properties?.id, feat);
        });

        tdActions.querySelector(".btn-row-del").addEventListener("click", () => {
          const featName = feat.properties?.nom || feat.properties?.name || "cette entité";
          if (confirm(`Supprimer ${featName} ?`)) {
            this.deleteFeature(layer.id, feat.properties?.__pf_id || feat.id || feat.properties?.id, feat);
            this.renderTableModal(layer);
          }
        });

        tr.appendChild(tdActions);
        tbody.appendChild(tr);
      });
    }

    /**
     * =========================================================================
     * Modale de Style (Symbologie) & Intégration QML
     * =========================================================================
     */
    openStyleModal(layerId) {
      const layer = this.getLayer(layerId);
      if (!layer) return;
      this.editingStyleLayerId = layerId;
      this.dom.styleLayerName.textContent = layer.name;
      this.renderStyleModal(layer);
      this.dom.styleModal.classList.add("active");
    }

    renderStyleModal(layer) {
      const container = this.dom.styleControls;
      container.innerHTML = "";
      const geomType = layer.geometryType.toLowerCase();
      const isPolygon = geomType === "polygon";
      const isLine = geomType === "linestring" || geomType === "line";
      const style = layer.style;

      // Palette de couleurs pré-définies rapides
      const paletteRow = document.createElement("div");
      paletteRow.style.cssText = "display: flex; gap: 6px; margin-bottom: 8px; align-items: center;";
      paletteRow.innerHTML = `<span style="font-size: 11px; font-weight: 600; color: #475569;">Nuances recommandées :</span>`;
      DEFAULT_PALETTE.forEach(c => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.style.cssText = `width: 22px; height: 22px; border-radius: 4px; background: ${c}; border: 1px solid rgba(0,0,0,0.2); cursor: pointer; padding: 0;`;
        swatch.addEventListener("click", () => {
          if (isPolygon) style.fillColor = c;
          style.strokeColor = c;
          this.updateLayerOnMap(layer);
          this.saveLayers();
          this.renderStyleModal(layer);
        });
        paletteRow.appendChild(swatch);
      });
      container.appendChild(paletteRow);

      if (isPolygon) {
        // Remplissage
        container.innerHTML += `
          <div class="vector-style-row">
            <span class="vector-style-label">Couleur de remplissage</span>
            <div class="vector-color-input-wrap">
              <input type="color" id="style-fill-color" class="vector-color-picker" value="${style.fillColor || "#3b82f6"}" />
            </div>
          </div>
          <div class="vector-style-row">
            <span class="vector-style-label">Opacité du fond</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="range" id="style-fill-opacity" min="0" max="100" value="${Math.round((style.fillOpacity ?? 0.45) * 100)}" class="slider" style="width: 100px;" />
              <span id="style-fill-opacity-val" class="val-badge">${Math.round((style.fillOpacity ?? 0.45) * 100)}%</span>
            </div>
          </div>
        `;
      }

      // Contour / Ligne
      container.innerHTML += `
        <div class="vector-style-row">
          <span class="vector-style-label">Couleur de contour / ligne</span>
          <div class="vector-color-input-wrap">
            <input type="color" id="style-stroke-color" class="vector-color-picker" value="${style.strokeColor || "#1d4ed8"}" />
          </div>
        </div>
        <div class="vector-style-row">
          <span class="vector-style-label">Épaisseur du trait (px)</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" id="style-stroke-width" min="1" max="8" step="0.5" value="${style.strokeWidth || 2}" class="slider" style="width: 100px;" />
            <span id="style-stroke-width-val" class="val-badge">${style.strokeWidth || 2} px</span>
          </div>
        </div>
        <div class="vector-style-row">
          <span class="vector-style-label">Style de ligne</span>
          <select id="style-stroke-style" class="tool-select" style="font-size: 11px;">
            <option value="solid" ${style.strokeStyle === "solid" ? "selected" : ""}>Trait plein (Solid)</option>
            <option value="dashed" ${style.strokeStyle === "dashed" ? "selected" : ""}>Tirets (Dashed)</option>
            <option value="dotted" ${style.strokeStyle === "dotted" ? "selected" : ""}>Pointillés (Dotted)</option>
          </select>
        </div>
      `;

      if (!isPolygon && !isLine) {
        // Point / Marqueur
        container.innerHTML += `
          <div class="vector-style-row">
            <span class="vector-style-label">Forme du marqueur</span>
            <select id="style-marker-shape" class="tool-select" style="font-size: 11px;">
              <option value="circle" ${style.markerShape === "circle" ? "selected" : ""}>Cercle</option>
              <option value="square" ${style.markerShape === "square" ? "selected" : ""}>Carré</option>
              <option value="triangle" ${style.markerShape === "triangle" ? "selected" : ""}>Triangle</option>
              <option value="diamond" ${style.markerShape === "diamond" ? "selected" : ""}>Losange</option>
              <option value="star" ${style.markerShape === "star" ? "selected" : ""}>Étoile</option>
            </select>
          </div>
          <div class="vector-style-row">
            <span class="vector-style-label">Taille du point</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="range" id="style-marker-size" min="4" max="20" value="${style.markerSize || 8}" class="slider" style="width: 100px;" />
              <span id="style-marker-size-val" class="val-badge">${style.markerSize || 8} px</span>
            </div>
          </div>
        `;
      }

      // Étiquettes (Labels)
      const fieldOptions = (layer.fields || []).map(f => `<option value="${f.name}" ${style.labelProperty === f.name ? "selected" : ""}>${f.name}</option>`).join("");
      container.innerHTML += `
        <div class="vector-style-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #e2e8f0;">
          <span class="vector-style-label">Étiquettes sur la carte</span>
          <select id="style-label-prop" class="tool-select" style="font-size: 11px;">
            <option value="">(Aucune étiquette)</option>
            ${fieldOptions}
          </select>
        </div>
      `;

      // Liaison des écouteurs en direct
      const fillInput = container.querySelector("#style-fill-color");
      if (fillInput) {
        fillInput.addEventListener("input", (e) => {
          style.fillColor = e.target.value;
          this.applyStyleChange(layer);
        });
      }

      const fillOpInput = container.querySelector("#style-fill-opacity");
      if (fillOpInput) {
        fillOpInput.addEventListener("input", (e) => {
          style.fillOpacity = parseInt(e.target.value, 10) / 100;
          container.querySelector("#style-fill-opacity-val").textContent = `${e.target.value}%`;
          this.applyStyleChange(layer);
        });
      }

      const strokeInput = container.querySelector("#style-stroke-color");
      if (strokeInput) {
        strokeInput.addEventListener("input", (e) => {
          style.strokeColor = e.target.value;
          this.applyStyleChange(layer);
        });
      }

      const strokeWInput = container.querySelector("#style-stroke-width");
      if (strokeWInput) {
        strokeWInput.addEventListener("input", (e) => {
          style.strokeWidth = parseFloat(e.target.value);
          container.querySelector("#style-stroke-width-val").textContent = `${e.target.value} px`;
          this.applyStyleChange(layer);
        });
      }

      const strokeStyleSelect = container.querySelector("#style-stroke-style");
      if (strokeStyleSelect) {
        strokeStyleSelect.addEventListener("change", (e) => {
          style.strokeStyle = e.target.value;
          this.applyStyleChange(layer);
        });
      }

      const markerShapeSelect = container.querySelector("#style-marker-shape");
      if (markerShapeSelect) {
        markerShapeSelect.addEventListener("change", (e) => {
          style.markerShape = e.target.value;
          this.applyStyleChange(layer);
        });
      }

      const markerSizeInput = container.querySelector("#style-marker-size");
      if (markerSizeInput) {
        markerSizeInput.addEventListener("input", (e) => {
          style.markerSize = parseFloat(e.target.value);
          container.querySelector("#style-marker-size-val").textContent = `${e.target.value} px`;
          this.applyStyleChange(layer);
        });
      }

      const labelPropSelect = container.querySelector("#style-label-prop");
      if (labelPropSelect) {
        labelPropSelect.addEventListener("change", (e) => {
          style.labelProperty = e.target.value;
          this.applyStyleChange(layer);
        });
      }

      this.updateStylePreview(layer);
    }

    applyStyleChange(layer) {
      this.updateStylePreview(layer);
      this.updateLayerOnMap(layer);
      this.renderLayersList();
      this.renderInlineLayersList();
    }

    updateStylePreview(layer) {
      const el = this.dom.stylePreview;
      if (!el) return;
      const isPolygon = layer.geometryType.toLowerCase() === "polygon";
      const isLine = layer.geometryType.toLowerCase().includes("line");
      const style = layer.style;

      if (isPolygon) {
        const borderStyle = style.strokeStyle === "dashed" ? "dashed" : style.strokeStyle === "dotted" ? "dotted" : "solid";
        el.innerHTML = `
          <div style="width: 140px; height: 55px; background: ${style.fillColor || "#3b82f6"}; opacity: 1; border: ${style.strokeWidth || 2}px ${borderStyle} ${style.strokeColor || "#1d4ed8"}; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; color: #0f172a; font-size: 11px; font-weight: 700;">
            <div style="background: rgba(255,255,255,0.85); padding: 2px 6px; border-radius: 4px;">Aperçu polygone</div>
          </div>
        `;
      } else if (isLine) {
        const borderStyle = style.strokeStyle === "dashed" ? "dashed" : style.strokeStyle === "dotted" ? "dotted" : "solid";
        el.innerHTML = `
          <div style="width: 160px; height: 0; border-top: ${style.strokeWidth || 3}px ${borderStyle} ${style.strokeColor || "#0284c7"};"></div>
        `;
      } else {
        el.innerHTML = `
          <div style="width: ${(style.markerSize || 8) * 2}px; height: ${(style.markerSize || 8) * 2}px; background: ${style.fillColor || "#ef4444"}; border: ${style.strokeWidth || 1.5}px solid ${style.strokeColor || "#ffffff"}; border-radius: ${style.markerShape === "circle" ? "50%" : "2px"}; box-shadow: 0 2px 6px rgba(0,0,0,0.2);"></div>
        `;
      }
    }

    /**
     * =========================================================================
     * Rendu & Cycle de vie MapLibre GL JS
     * =========================================================================
     */
    syncAllLayersToMap() {
      if (!this.map) return;
      this.layers.forEach(layer => this.syncLayerToMap(layer));
    }

    syncLayerToMap(layer) {
      if (!this.map) return;
      if (!this.map.style) {
        this.map.once("load", () => this.syncLayerToMap(layer));
        return;
      }

      const sourceId = `vector-source-${layer.id}`;
      const geomType = (layer.geometryType || "Polygon").toLowerCase();
      const style = layer.style || {};

      // 1. Source GeoJSON standard (feature.id natif)
      const featureCollection = {
        type: "FeatureCollection",
        features: Array.isArray(layer.data?.features) ? [...layer.data.features] : []
      };

      let src = this.map.getSource(sourceId);
      if (!src) {
        this.map.addSource(sourceId, {
          type: "geojson",
          data: featureCollection
        });
      } else {
        src.setData(featureCollection);
      }

      // 2. Calques d'affichage
      if (geomType === "polygon") {
        const fillId = `vector-fill-${layer.id}`;
        const strokeId = `vector-stroke-${layer.id}`;

        const fillOp = style.fillOpacity !== undefined ? Math.max(0, Math.min(1, Number(style.fillOpacity))) : 0.45;
        const strokeCol = style.strokeColor || "#1d4ed8";
        const strokeW = Math.max(1, Number(style.strokeWidth || 2.5));

        if (!this.map.getLayer(fillId)) {
          this.map.addLayer({
            id: fillId,
            type: "fill",
            source: sourceId,
            paint: {
              "fill-color": style.fillColor || "#3b82f6",
              "fill-opacity": fillOp,
              "fill-outline-color": strokeCol
            }
          });
        } else {
          this.map.setPaintProperty(fillId, "fill-color", style.fillColor || "#3b82f6");
          this.map.setPaintProperty(fillId, "fill-opacity", fillOp);
          try { this.map.setPaintProperty(fillId, "fill-outline-color", strokeCol); } catch (e) {}
        }

        const dash = style.strokeStyle === "dashed" ? [3, 2] : style.strokeStyle === "dotted" ? [1, 1.5] : undefined;
        if (!this.map.getLayer(strokeId)) {
          this.map.addLayer({
            id: strokeId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": strokeCol,
              "line-width": strokeW,
              "line-opacity": 1,
              ...(dash ? { "line-dasharray": dash } : {})
            }
          });
        } else {
          this.map.setPaintProperty(strokeId, "line-color", strokeCol);
          this.map.setPaintProperty(strokeId, "line-width", strokeW);
          try { this.map.setPaintProperty(strokeId, "line-opacity", 1); } catch (e) {}
          if (dash) {
            this.map.setPaintProperty(strokeId, "line-dasharray", dash);
          } else {
            try { this.map.setPaintProperty(strokeId, "line-dasharray", null); } catch (e) {}
          }
        }
      } else if (geomType.includes("line")) {
        const lineId = `vector-line-${layer.id}`;
        const dash = style.strokeStyle === "dashed" ? [3, 2] : style.strokeStyle === "dotted" ? [1, 1.5] : undefined;
        const lineCol = style.strokeColor || "#0284c7";
        const lineW = Math.max(1, Number(style.strokeWidth || 3));
        const lineOp = style.strokeOpacity !== undefined ? Math.max(0, Math.min(1, Number(style.strokeOpacity))) : 1;

        if (!this.map.getLayer(lineId)) {
          this.map.addLayer({
            id: lineId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": lineCol,
              "line-width": lineW,
              "line-opacity": lineOp,
              ...(dash ? { "line-dasharray": dash } : {})
            }
          });
        } else {
          this.map.setPaintProperty(lineId, "line-color", lineCol);
          this.map.setPaintProperty(lineId, "line-width", lineW);
          try { this.map.setPaintProperty(lineId, "line-opacity", lineOp); } catch (e) {}
          if (dash) {
            this.map.setPaintProperty(lineId, "line-dasharray", dash);
          } else {
            try { this.map.setPaintProperty(lineId, "line-dasharray", null); } catch (e) {}
          }
        }
      } else {
        const pointId = `vector-point-${layer.id}`;
        const markerR = Math.max(3, Number(style.markerSize || 8));
        const pointOp = style.fillOpacity !== undefined ? Math.max(0, Math.min(1, Number(style.fillOpacity))) : 0.9;
        const strokeW = Math.max(0.5, Number(style.strokeWidth || 1.5));

        if (!this.map.getLayer(pointId)) {
          this.map.addLayer({
            id: pointId,
            type: "circle",
            source: sourceId,
            paint: {
              "circle-radius": markerR,
              "circle-color": style.fillColor || "#ef4444",
              "circle-opacity": pointOp,
              "circle-stroke-color": style.strokeColor || "#ffffff",
              "circle-stroke-width": strokeW
            }
          });
        } else {
          this.map.setPaintProperty(pointId, "circle-radius", markerR);
          this.map.setPaintProperty(pointId, "circle-color", style.fillColor || "#ef4444");
          this.map.setPaintProperty(pointId, "circle-opacity", pointOp);
          this.map.setPaintProperty(pointId, "circle-stroke-color", style.strokeColor || "#ffffff");
          this.map.setPaintProperty(pointId, "circle-stroke-width", strokeW);
        }
      }

      // Calque d'étiquette textuelle (utilise la police "Noto Sans Regular" disponible et stable)
      const labelId = `vector-label-${layer.id}`;
      const textField = ["to-string", ["coalesce", ["get", style.labelProperty || "nom"], ["get", "nom"], ["get", "name"], ""]];
      if (style.labelProperty) {
        if (!this.map.getLayer(labelId)) {
          this.map.addLayer({
            id: labelId,
            type: "symbol",
            source: sourceId,
            layout: {
              "text-field": textField,
              "text-size": 12,
              "text-font": ["Noto Sans Regular"],
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              ...(geomType.includes("line") ? { "symbol-placement": "line-center" } : {})
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 2.5
            }
          });
        } else {
          this.map.setLayoutProperty(labelId, "text-field", textField);
          this.map.setLayoutProperty(labelId, "text-font", ["Noto Sans Regular"]);
          this.map.setLayoutProperty(labelId, "text-allow-overlap", true);
          this.map.setLayoutProperty(labelId, "text-ignore-placement", true);
        }
      } else if (this.map.getLayer(labelId)) {
        this.map.removeLayer(labelId);
      }

      this.setLayerVisibility(layer.id, layer.visible);
      this.bringToFront();
      if (typeof this.map.triggerRepaint === "function") {
        this.map.triggerRepaint();
      }
    }

    updateLayerOnMap(layer) {
      if (!this.map || !this.map.style) return;
      this.syncLayerToMap(layer);
    }

    setLayerVisibility(layerId, isVisible) {
      if (!this.map || !this.map.style) return;
      const vis = isVisible ? "visible" : "none";
      const layerIds = [
        `vector-fill-${layerId}`,
        `vector-stroke-${layerId}`,
        `vector-line-${layerId}`,
        `vector-point-${layerId}`,
        `vector-label-${layerId}`
      ];
      layerIds.forEach(id => {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, "visibility", vis);
        }
      });
      if (isVisible) {
        this.bringToFront();
      }
    }

    removeLayerFromMap(layerId) {
      if (!this.map || !this.map.style) return;
      const layerIds = [
        `vector-fill-${layerId}`,
        `vector-stroke-${layerId}`,
        `vector-line-${layerId}`,
        `vector-point-${layerId}`,
        `vector-label-${layerId}`
      ];
      layerIds.forEach(id => {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      });
      const sourceId = `vector-source-${layerId}`;
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    }

    /**
     * =========================================================================
     * Exportation & Importation de données vectorielles (GeoJSON, KML, FGB, SHP, CSV)
     * =========================================================================
     */
    exportLayerGeoJson(layer) {
      const geojsonStr = JSON.stringify(layer.data, null, 2);
      const fileName = `${layer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.geojson`;
      downloadBlob(geojsonStr, fileName, "application/geo+json");
    }

    exportLayerKml(layer) {
      if (!layer.data || !layer.data.features || layer.data.features.length === 0) {
        alert("Aucune entité à exporter dans cette couche.");
        return;
      }
      let placemarksXml = "";
      layer.data.features.forEach((feat, idx) => {
        const name = feat.properties.nom || feat.properties.name || `Entité ${idx + 1}`;
        const desc = feat.properties.description || "";
        let extendedData = "<ExtendedData>";
        Object.entries(feat.properties).forEach(([k, v]) => {
          if (k !== "nom" && k !== "description") {
            extendedData += `<Data name="${k}"><value>${v}</value></Data>`;
          }
        });
        extendedData += "</ExtendedData>";

        let geomXml = "";
        const geom = feat.geometry;
        if (geom.type === "Point") {
          geomXml = `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},0</coordinates></Point>`;
        } else if (geom.type === "LineString") {
          geomXml = `<LineString><coordinates>${geom.coordinates.map(pt => `${pt[0]},${pt[1]},0`).join(" ")}</coordinates></LineString>`;
        } else if (geom.type === "Polygon") {
          geomXml = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${geom.coordinates[0].map(pt => `${pt[0]},${pt[1]},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
        }

        placemarksXml += `
          <Placemark>
            <name>${name}</name>
            <description>${desc}</description>
            ${extendedData}
            ${geomXml}
          </Placemark>
        `;
      });

      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${layer.name}</name>
    ${placemarksXml}
  </Document>
</kml>`;
      const fileName = `${layer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.kml`;
      downloadBlob(kml, fileName, "application/vnd.google-earth.kml+xml");
    }

    exportLayerCsv(layer) {
      if (!layer.data || !layer.data.features || layer.data.features.length === 0) {
        alert("Aucune entité à exporter dans cette couche.");
        return;
      }
      const cols = ["id", "nom"];
      layer.data.features.forEach(f => {
        Object.keys(f.properties).forEach(k => {
          if (!cols.includes(k)) cols.push(k);
        });
      });

      let csv = "\uFEFF" + cols.join(";") + ";wkt\n";
      layer.data.features.forEach(f => {
        const row = cols.map(c => `"${String(f.properties[c] !== undefined ? f.properties[c] : "").replace(/"/g, '""')}"`);
        const geom = f.geometry;
        let wkt = "";
        if (geom.type === "Point") wkt = `POINT(${geom.coordinates.join(" ")})`;
        else if (geom.type === "LineString") wkt = `LINESTRING(${geom.coordinates.map(pt => pt.join(" ")).join(", ")})`;
        else if (geom.type === "Polygon") wkt = `POLYGON((${geom.coordinates[0].map(pt => pt.join(" ")).join(", ")}))`;
        row.push(`"${wkt}"`);
        csv += row.join(";") + "\n";
      });

      const fileName = `${layer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.csv`;
      downloadBlob(csv, fileName, "text/csv;charset=utf-8;");
    }

    /**
     * Menu contextuel flottant pour exporter une couche personnelle
     */
    showExportMenu(layer, anchorEl) {
      const existing = document.getElementById("vector-export-popover");
      if (existing) existing.remove();

      const popover = document.createElement("div");
      popover.id = "vector-export-popover";
      popover.className = "personal-add-dropdown";
      popover.style.cssText = `
        position: fixed;
        z-index: 10001;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.18);
        padding: 5px;
        min-width: 190px;
        font-family: var(--font-sans, sans-serif);
      `;

      const rect = anchorEl.getBoundingClientRect();
      popover.style.top = `${rect.bottom + 4}px`;
      const right = window.innerWidth - rect.right;
      popover.style.right = `${Math.max(10, right)}px`;

      popover.innerHTML = `
        <div style="font-size: 10px; font-weight: 700; color: #64748b; padding: 4px 8px 6px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #f1f5f9; margin-bottom: 4px;">
          Exporter "${layer.name}"
        </div>
        <button type="button" class="personal-dropdown-item btn-exp-geojson">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>GeoJSON (.geojson)</span>
        </button>
        <button type="button" class="personal-dropdown-item btn-exp-kml">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2"><polygon points="12 2 19 21 12 17 5 21 12 2"></polygon></svg>
          <span>KML (.kml - Google Earth)</span>
        </button>
        <button type="button" class="personal-dropdown-item btn-exp-csv">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          <span>Tableur CSV (.csv - WKT)</span>
        </button>
        <button type="button" class="personal-dropdown-item btn-exp-qml" style="border-top: 1px solid #f1f5f9; margin-top: 3px; padding-top: 6px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Style QGIS (.qml)</span>
        </button>
      `;

      document.body.appendChild(popover);

      const closePopover = (evt) => {
        if (!popover.contains(evt.target) && evt.target !== anchorEl) {
          popover.remove();
          document.removeEventListener("click", closePopover);
        }
      };
      setTimeout(() => document.addEventListener("click", closePopover), 50);

      popover.querySelector(".btn-exp-geojson").addEventListener("click", () => {
        popover.remove();
        this.exportLayerGeoJson(layer);
        this.showToast(`Couche "${layer.name}" exportée en GeoJSON.`);
      });

      popover.querySelector(".btn-exp-kml").addEventListener("click", () => {
        popover.remove();
        this.exportLayerKml(layer);
        this.showToast(`Couche "${layer.name}" exportée en KML.`);
      });

      popover.querySelector(".btn-exp-csv").addEventListener("click", () => {
        popover.remove();
        this.exportLayerCsv(layer);
        this.showToast(`Couche "${layer.name}" exportée en CSV.`);
      });

      popover.querySelector(".btn-exp-qml").addEventListener("click", () => {
        popover.remove();
        const qmlXml = QmlHandler.generate(layer);
        const fileName = `${layer.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_style.qml`;
        downloadBlob(qmlXml, fileName, "text/xml");
        this.showToast(`Style QGIS (.qml) exporté.`);
      });
    }

    importVectorFile(file) {
      return new Promise((resolve) => {
        const fileNameLower = file.name.toLowerCase();
        const isBinary = fileNameLower.endsWith(".fgb") || fileNameLower.endsWith(".zip");
        const name = file.name.replace(/\.[^/.]+$/, "");

        const processFeatureCollection = (featureCollection) => {
          if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) {
            throw new Error("Aucune entité trouvée dans le fichier vectoriel.");
          }

          // Détection du type géométrique prédominant
          let geomType = "Polygon";
          const first = featureCollection.features.find(f => f.geometry && f.geometry.type);
          if (first) {
            const t = first.geometry.type;
            if (t.includes("Line")) geomType = "LineString";
            else if (t.includes("Point")) geomType = "Point";
          }

          // Assurer un identifiant unique persistant et les attributs sur chaque entité
          featureCollection.features.forEach((feat, idx) => {
            const fid = feat.id || feat.properties?.id || `feat_${Date.now()}_${idx}_${Math.floor(Math.random() * 100000)}`;
            feat.id = fid;
            if (!feat.properties) feat.properties = {};
            feat.properties.__pf_id = fid;
            if (!feat.properties.id) feat.properties.id = fid;
          });

          // Extraire les champs d'attributs détectés
          const fieldsMap = new Set();
          featureCollection.features.forEach(f => {
            if (f.properties) {
              Object.keys(f.properties).forEach(k => {
                if (!k.startsWith("__")) fieldsMap.add(k);
              });
            }
          });
          const fields = Array.from(fieldsMap).map(k => ({ name: k, label: k }));

          const color = DEFAULT_PALETTE[this.layers.length % DEFAULT_PALETTE.length];
          const newLayer = {
            id: "vec_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
            name: name || "Couche importée",
            geometryType: geomType,
            visible: true,
            data: featureCollection,
            style: {
              fillColor: color,
              fillOpacity: geomType === "Polygon" ? 0.4 : 0.9,
              strokeColor: color,
              strokeWidth: 2,
              strokeStyle: "solid",
              markerShape: "circle",
              markerSize: 8,
              labelProperty: fieldsMap.has("nom") ? "nom" : (fieldsMap.has("name") ? "name" : (fields.length > 0 ? fields[0].name : "nom"))
            },
            fields
          };

          this.layers.push(newLayer);
          this.activeLayerId = newLayer.id;
          this.syncLayerToMap(newLayer);
          this.bringToFront();
          if (typeof window.bringTopLayersToFront === "function") {
            window.bringTopLayersToFront();
          }
          this.renderLayersList();
          this.renderInlineLayersList();
          this.zoomToLayer(newLayer.id);
          this.showToast(`Couche "${newLayer.name}" importée avec succès (${featureCollection.features.length} entités) !`);
          resolve(newLayer.id);
        };

        if (isBinary) {
          const reader = new FileReader();
          reader.onload = async (evt) => {
            try {
              const buffer = evt.target.result;
              let featureCollection = null;

              if (fileNameLower.endsWith(".fgb")) {
                const fgbModule = window.flatgeobuf || (typeof flatgeobuf !== "undefined" ? flatgeobuf : null);
                const deserialize = fgbModule ? (fgbModule.deserialize || (fgbModule.geojson && fgbModule.geojson.deserialize)) : null;
                if (!deserialize) {
                  throw new Error("Module FlatGeobuf non disponible dans le navigateur.");
                }
                const uint8 = new Uint8Array(buffer);
                const res = deserialize(uint8);
                if (res && res.features) {
                  featureCollection = res;
                } else if (res && typeof res[Symbol.asyncIterator] === "function") {
                  const features = [];
                  for await (const f of res) {
                    if (f) features.push(f);
                  }
                  featureCollection = { type: "FeatureCollection", features };
                } else {
                  featureCollection = await res;
                }
              } else if (fileNameLower.endsWith(".zip")) {
                if (typeof window.shp !== "function") {
                  throw new Error("Module Shapefile (shp.min.js) non disponible.");
                }
                const res = await window.shp(buffer);
                if (Array.isArray(res)) {
                  // Si l'archive zip contient plusieurs shapefiles
                  featureCollection = res[0];
                } else {
                  featureCollection = res;
                }
              }

              processFeatureCollection(featureCollection);
            } catch (err) {
              this.showToast("Erreur lors de l'import : " + err.message, true);
              resolve(null);
            }
          };
          reader.onerror = () => {
            this.showToast("Erreur de lecture du fichier binaire.", true);
            resolve(null);
          };
          reader.readAsArrayBuffer(file);
        } else {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const text = evt.target.result;
              let featureCollection = null;

              if (fileNameLower.endsWith(".kml")) {
                featureCollection = this.parseKmlToGeoJson(text);
              } else {
                featureCollection = JSON.parse(text);
              }

              processFeatureCollection(featureCollection);
            } catch (err) {
              this.showToast("Erreur lors de l'import : " + err.message, true);
              resolve(null);
            }
          };
          reader.onerror = () => {
            this.showToast("Erreur de lecture du fichier texte.", true);
            resolve(null);
          };
          reader.readAsText(file);
        }
      });
    }

    parseKmlToGeoJson(kmlText) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(kmlText, "text/xml");
      const placemarks = doc.querySelectorAll("Placemark");
      const features = [];

      placemarks.forEach((pm, idx) => {
        const name = pm.querySelector("name") ? pm.querySelector("name").textContent : `Entité ${idx + 1}`;
        const desc = pm.querySelector("description") ? pm.querySelector("description").textContent : "";
        const props = { nom: name, description: desc };

        // Attributs étendus
        pm.querySelectorAll("ExtendedData Data").forEach(d => {
          const k = d.getAttribute("name");
          const v = d.querySelector("value") ? d.querySelector("value").textContent : "";
          if (k) props[k] = v;
        });

        // Polygone
        const poly = pm.querySelector("Polygon");
        if (poly) {
          const coordsText = poly.querySelector("coordinates") ? poly.querySelector("coordinates").textContent : "";
          const ring = coordsText.trim().split(/\s+/).map(str => {
            const [lng, lat] = str.split(",").map(Number);
            return [lng, lat];
          }).filter(pt => !isNaN(pt[0]) && !isNaN(pt[1]));
          if (ring.length >= 3) {
            features.push({
              type: "Feature",
              properties: props,
              geometry: { type: "Polygon", coordinates: [ring] }
            });
            return;
          }
        }

        // Ligne
        const line = pm.querySelector("LineString");
        if (line) {
          const coordsText = line.querySelector("coordinates") ? line.querySelector("coordinates").textContent : "";
          const pts = coordsText.trim().split(/\s+/).map(str => {
            const [lng, lat] = str.split(",").map(Number);
            return [lng, lat];
          }).filter(pt => !isNaN(pt[0]) && !isNaN(pt[1]));
          if (pts.length >= 2) {
            features.push({
              type: "Feature",
              properties: props,
              geometry: { type: "LineString", coordinates: pts }
            });
            return;
          }
        }

        // Point
        const ptEl = pm.querySelector("Point");
        if (ptEl) {
          const coordsText = ptEl.querySelector("coordinates") ? ptEl.querySelector("coordinates").textContent : "";
          const [lng, lat] = coordsText.trim().split(",").map(Number);
          if (!isNaN(lng) && !isNaN(lat)) {
            features.push({
              type: "Feature",
              properties: props,
              geometry: { type: "Point", coordinates: [lng, lat] }
            });
          }
        }
      });

      return {
        type: "FeatureCollection",
        features
      };
    }

    /**
     * Applique un fichier de style QGIS XML (.qml) à une couche vectorielle
     */
    applyQmlFile(file, layerId) {
      return new Promise((resolve) => {
        const layer = this.getLayer(layerId);
        if (!layer) {
          this.showToast("Aucune couche vectorielle pour appliquer ce style QML.", true);
          return resolve(false);
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const res = QmlHandler.parse(evt.target.result);
            Object.assign(layer.style, res.style);
            this.updateLayerOnMap(layer);
            this.saveLayers();
            if (this.editingStyleLayerId === layer.id) {
              this.renderStyleModal(layer);
            }
            this.renderLayersList();
            this.renderInlineLayersList();
            this.showToast(`Style QGIS "${file.name}" appliqué à "${layer.name}" !`);
            resolve(true);
          } catch (err) {
            this.showToast("Erreur style QML : " + err.message, true);
            resolve(false);
          }
        };
        reader.onerror = () => {
          this.showToast("Erreur de lecture du fichier QML.", true);
          resolve(false);
        };
        reader.readAsText(file);
      });
    }

    /**
     * Traite un ensemble de fichiers glissés-déposés (SHP, FGB, GeoJSON, KML, QML, QPT)
     */
    async handleDroppedFiles(fileList) {
      const files = Array.from(fileList);
      if (!files.length) return;

      const vectorFiles = [];
      const qmlFiles = [];
      const qptFiles = [];

      for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith(".qml")) {
          qmlFiles.push(file);
        } else if (name.endsWith(".qpt")) {
          qptFiles.push(file);
        } else if (name.endsWith(".zip") || name.endsWith(".fgb") || name.endsWith(".geojson") || name.endsWith(".json") || name.endsWith(".kml")) {
          vectorFiles.push(file);
        } else {
          console.warn("[Vectors] Format ignoré :", file.name);
        }
      }

      if (vectorFiles.length === 0 && qmlFiles.length === 0 && qptFiles.length === 0) {
        this.showToast("Format non supporté. Formats acceptés : .zip (SHP), .fgb, .geojson, .kml, .qml", true);
        return;
      }

      let lastCreatedId = null;
      for (const vFile of vectorFiles) {
        const createdId = await this.importVectorFile(vFile);
        if (createdId) lastCreatedId = createdId;
      }

      for (const qFile of qmlFiles) {
        const targetId = lastCreatedId || this.editingStyleLayerId || this.activeLayerId || (this.layers.length > 0 ? this.layers[this.layers.length - 1].id : null);
        if (targetId) {
          await this.applyQmlFile(qFile, targetId);
        } else {
          this.showToast(`Pour appliquer "${qFile.name}", importez ou créez d'abord une couche vectorielle.`, true);
        }
      }

      // Support direct des gabarits QPT glissés-déposés
      if (qptFiles.length > 0 && window.composer && typeof window.composer.importQptTemplate === "function") {
        for (const qpt of qptFiles) {
          const reader = new FileReader();
          reader.onload = (e) => {
            window.composer.importQptTemplate(e.target.result, qpt.name);
            window.composer.open();
          };
          reader.readAsText(qpt);
        }
      }
    }

    /**
     * Configure les écouteurs de Glisser-Déposer (Drag and drop) sur toute la fenêtre et les zones dédiées
     */
    setupDragAndDrop() {
      let dragCounter = 0;
      const overlay = this.dom.dropOverlay;

      const hasFiles = (e) => {
        if (!e.dataTransfer || !e.dataTransfer.types) return false;
        return Array.from(e.dataTransfer.types).includes("Files");
      };

      window.addEventListener("dragenter", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragCounter++;
        if (overlay) overlay.classList.add("active");
      });

      window.addEventListener("dragleave", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          if (overlay) overlay.classList.remove("active");
        }
      });

      window.addEventListener("dragover", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      });

      window.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragCounter = 0;
        if (overlay) overlay.classList.remove("active");

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.handleDroppedFiles(e.dataTransfer.files);
        }
      });

      // Zone de glisser-déposer dans la modale
      if (this.dom.modalDropzone) {
        this.dom.modalDropzone.addEventListener("click", () => {
          if (this.dom.inputImportData) this.dom.inputImportData.click();
        });

        this.dom.modalDropzone.addEventListener("dragover", (e) => {
          e.preventDefault();
          this.dom.modalDropzone.classList.add("dragover");
        });

        this.dom.modalDropzone.addEventListener("dragleave", () => {
          this.dom.modalDropzone.classList.remove("dragover");
        });

        this.dom.modalDropzone.addEventListener("drop", (e) => {
          e.preventDefault();
          this.dom.modalDropzone.classList.remove("dragover");
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            this.handleDroppedFiles(e.dataTransfer.files);
          }
        });
      }
    }

    /**
     * Affiche un message toast flottant élégant
     */
    showToast(message, isError = false) {
      let toast = document.getElementById("vector-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "vector-toast";
        toast.className = "share-toast";
        document.body.appendChild(toast);
      }
      toast.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isError ? '#ef4444' : '#22c55e'}" stroke-width="2.5">
          ${isError ? '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' : '<polyline points="20 6 9 17 4 12"></polyline>'}
        </svg>
        <span>${message}</span>
      `;
      toast.classList.add("visible");
      clearTimeout(this._toastTimeout);
      this._toastTimeout = setTimeout(() => {
        toast.classList.remove("visible");
      }, 3800);
    }
  }

  // Exposer l'instance globale
  window.VectorManager = VectorManager;
  window.vectorManager = new VectorManager();

})();
