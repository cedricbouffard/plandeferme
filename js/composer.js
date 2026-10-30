/* ==========================================================================
   Plan de Ferme — Module de Compositeur Cartographique & Export PDF
   Format Lettre (8,5 × 11 po) — Modes Portrait et Paysage
   Gabarits réutilisables, textes éditables, logo, rose des vents, échelle.
   ========================================================================== */

(function (window, document) {
  "use strict";

  const STORAGE_KEY_TEMPLATES = "plandeferme_composer_templates_v1";

  // Dimensions standards par défaut (en millimètres, inspiré de QGIS Layout-Composer)
  const DEFAULT_LAYOUT = {
    margin: 10,       // Marge extérieure (mm)
    headerH: 22,      // Hauteur du cartouche d'en-tête (mm)
    sideW: 60,        // Largeur du panneau latéral en Paysage (mm)
    compassSize: 24,  // Diamètre / dimension de la rose des vents (mm)
    profileH: 46      // Hauteur du bloc de coupe topographique MNT (mm)
  };

  // Gabarits intégrés par défaut
  const DEFAULT_TEMPLATES = {
    standard_paysage: {
      id: "standard_paysage",
      name: "Modèle Standard (Paysage)",
      format: "letter",
      orientation: "landscape",
      title: "Plan de ferme",
      subtitle: "Parcelles principales",
      author: "",
      location: "Québec, QC",
      notes: "Carte d'aménagement des parcelles et du relief topographique.",
      showCompass: true,
      showScale: true,
      showLegend: true,
      showNotes: true,
      showProfile: false,
      logoUrl: null,
      excludedLegendIds: [],
      layout: { ...DEFAULT_LAYOUT }
    },
    fiche_portrait: {
      id: "fiche_portrait",
      name: "Fiche Parcelle (Portrait)",
      format: "letter",
      orientation: "portrait",
      title: "Fiche d'intervention parcellaire",
      subtitle: "Régie des sols et drainage",
      author: "",
      location: "",
      notes: "Observations agronomiques et prévisions des travaux de drainage.",
      showCompass: true,
      showScale: true,
      showLegend: true,
      showNotes: true,
      showProfile: false,
      logoUrl: null,
      excludedLegendIds: [],
      layout: { ...DEFAULT_LAYOUT }
    },
    drainage_paysage: {
      id: "drainage_paysage",
      name: "Plan Pédologique & Drainage (Paysage)",
      format: "letter",
      orientation: "landscape",
      title: "Diagnostic pédologique et de drainage",
      subtitle: "Relief LiDAR HRDEM 1m & Hydrographie",
      author: "",
      location: "",
      notes: "Vérifier le profil d'écoulement et les bas-fonds avant travaux.",
      showCompass: true,
      showScale: true,
      showLegend: true,
      showNotes: true,
      showProfile: false,
      logoUrl: null,
      excludedLegendIds: [],
      layout: { ...DEFAULT_LAYOUT }
    },
    coupe_topo: {
      id: "coupe_topo",
      name: "Coupe Topographique (MNT & Profil)",
      format: "letter",
      orientation: "landscape",
      title: "Coupe Topographique & Profil Altimétrique",
      subtitle: "Modèle numérique de terrain (MNT LiDAR 1 m)",
      author: "",
      location: "",
      notes: "Profil altimétrique et pentes calculés à partir du MNT LiDAR 1 m.",
      showCompass: true,
      showScale: true,
      showLegend: true,
      showNotes: true,
      showProfile: true,
      logoUrl: null,
      excludedLegendIds: [],
      layout: { ...DEFAULT_LAYOUT }
    }
  };

  class PlanDeFermeComposer {
    constructor() {
      this.map = null;
      this.wmsManager = null;
      this.isOpen = false;
      this.state = {
        ...DEFAULT_TEMPLATES.standard_paysage,
        layout: { ...DEFAULT_LAYOUT },
        showProfile: false,
        excludedLegendIds: []
      };
      this.userTemplates = {};
      this.mapSnapshotDataUrl = null;
      this.rawMapCanvas = null;
      this.croppedVisibleWidthPx = null;
      this.scaleInfo = null;
      this.zoomMode = "fit";
      this.currentScale = 1.0;
      this.allDetectedLegendItems = [];

      this.dom = {};
      this.loadUserTemplates();
    }

    init(mapInstance, wmsInstance) {
      this.map = mapInstance;
      this.wmsManager = wmsInstance;
      this.buildModalDom();
      this.bindEvents();
    }

    loadUserTemplates() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_TEMPLATES);
        if (raw) {
          this.userTemplates = JSON.parse(raw);
        }
      } catch (e) {
        console.warn("[Composer] Erreur lecture templates localStorage:", e);
      }
    }

    saveUserTemplates() {
      try {
        localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(this.userTemplates));
      } catch (e) {
        console.warn("[Composer] Erreur sauvegarde templates localStorage:", e);
      }
    }

    /**
     * Construction du DOM de la boîte modale du compositeur
     */
    buildModalDom() {
      if (document.getElementById("composer-overlay")) return;

      const overlay = document.createElement("div");
      overlay.id = "composer-overlay";
      overlay.className = "composer-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "Compositeur cartographique");

      overlay.innerHTML = `
        <div class="composer-modal">
          <!-- En-tête -->
          <div class="composer-header">
            <div class="composer-header-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              <span>Mise en page &amp; Export PDF (Format Lettre)</span>
            </div>
            <div class="composer-header-actions">
              <button id="composer-btn-generate-pdf" class="composer-btn-pdf" type="button">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>Télécharger le PDF</span>
              </button>
              <button id="composer-btn-close" class="composer-btn-close" type="button" aria-label="Fermer le compositeur">&times;</button>
            </div>
          </div>

          <!-- Onglets Mobiles (Réglages vs Aperçu) -->
          <div class="composer-mobile-nav" id="composer-mobile-nav">
            <button type="button" class="composer-tab-btn active" id="composer-tab-settings" data-tab="settings">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <span>Réglages</span>
            </button>
            <button type="button" class="composer-tab-btn" id="composer-tab-preview" data-tab="preview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <span>Aperçu de la feuille</span>
            </button>
          </div>

          <!-- Corps : Paramètres (gauche) + Prévisualisation (droite) -->
          <div class="composer-body" id="composer-body" data-active-tab="settings">
            <!-- Sidebar Paramètres -->
            <div class="composer-sidebar">
              <!-- 1. Format & Orientation -->
              <div class="composer-section">
                <div class="composer-section-title">
                  <span>Format de page &amp; Orientation</span>
                  <span style="font-size: 10px; color: #166534; font-weight: 600;">8,5 × 11 po</span>
                </div>
                <div class="composer-segmented">
                  <button type="button" id="composer-orient-landscape" class="composer-seg-btn active">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"></rect></svg>
                    <span>Paysage</span>
                  </button>
                  <button type="button" id="composer-orient-portrait" class="composer-seg-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"></rect></svg>
                    <span>Portrait</span>
                  </button>
                </div>
              </div>

              <!-- 2. Gestion des Gabarits / Templates -->
              <div class="composer-section">
                <div class="composer-section-title">
                  <span>Modèles de mise en page</span>
                </div>
                <div class="composer-field-group">
                  <select id="composer-template-select" class="composer-select">
                    <!-- Rempli dynamiquement -->
                  </select>
                </div>
                <div class="composer-template-actions">
                  <button type="button" id="composer-btn-save-template" class="composer-btn-action" title="Enregistrer le modèle actuel dans votre navigateur (localStorage)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                    <span>Enregistrer</span>
                  </button>
                  <button type="button" id="composer-btn-export-qpt" class="composer-btn-action" title="Télécharger le modèle au format gabarit QGIS (.qpt)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>Exporter .qpt</span>
                  </button>
                </div>
                <div style="margin-top: 6px;">
                  <label class="composer-btn-action" style="width: 100%; cursor: pointer; text-align: center; border-color: #86efac; background: #f0fdf4; color: #166534;" title="Importer un modèle de mise en page QGIS (.qpt)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                    <span>Importer un gabarit QGIS (.qpt)</span>
                    <input type="file" id="composer-input-import-qpt" accept=".qpt,.xml" style="display: none;" />
                  </label>
                </div>
              </div>

              <!-- 3. Logo de la ferme / entreprise -->
              <div class="composer-section">
                <div class="composer-section-title">
                  <span>Logo de l'entreprise</span>
                </div>
                <div class="composer-logo-row">
                  <div id="composer-logo-preview" class="composer-logo-preview">
                    <span class="composer-logo-preview-empty">Aucun<br/>logo</span>
                  </div>
                  <div class="composer-logo-controls">
                    <label class="composer-btn-upload">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                      <span>Choisir un logo...</span>
                      <input type="file" id="composer-input-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display: none;" />
                    </label>
                    <button type="button" id="composer-btn-clear-logo" class="composer-btn-clear-logo" style="display: none;">Retirer le logo</button>
                  </div>
                </div>
              </div>

              <!-- 4. Textes éditables (Cartouche) -->
              <div class="composer-section">
                <div class="composer-section-title">
                  <span>Textes &amp; Informations</span>
                </div>
                <div class="composer-field-group">
                  <label class="composer-label" for="composer-input-title">Titre principal</label>
                  <input type="text" id="composer-input-title" class="composer-input" value="Plan de ferme" />
                </div>
                <div class="composer-field-group">
                  <label class="composer-label" for="composer-input-subtitle">Sous-titre / Nom de la ferme / Parcelle</label>
                  <input type="text" id="composer-input-subtitle" class="composer-input" value="Parcelles principales" />
                </div>
                <div class="composer-field-group">
                  <label class="composer-label" for="composer-input-location">Municipalité / Rang / Localisation</label>
                  <input type="text" id="composer-input-location" class="composer-input" value="Québec, QC" />
                </div>
                <div class="composer-field-group">
                  <label class="composer-label" for="composer-input-author">Auteur / Conseiller / Agronome</label>
                  <input type="text" id="composer-input-author" class="composer-input" placeholder="Ex: Cédric Bouffard" />
                </div>
                <div class="composer-field-group">
                  <label class="composer-label" for="composer-input-notes">Notes de terrain / Interventions</label>
                  <textarea id="composer-input-notes" class="composer-textarea" placeholder="Observations agronomiques, travaux de nivellement ou drainage..."></textarea>
                </div>
              </div>

              <!-- 5. Éléments cartographiques -->
              <div class="composer-section">
                <div class="composer-section-title">
                  <span>Éléments cartographiques</span>
                </div>
                <label class="composer-checkbox-row">
                  <span>Rose des vents (Boussole N-S-E-O)</span>
                  <input type="checkbox" id="composer-check-compass" checked />
                </label>
                <label class="composer-checkbox-row">
                  <span>Barre d'échelle &amp; Ratio 1:N</span>
                  <input type="checkbox" id="composer-check-scale" checked />
                </label>
                <label class="composer-checkbox-row">
                  <span>Légende dynamique des couches actives</span>
                  <input type="checkbox" id="composer-check-legend" checked />
                </label>

                <!-- Personnalisation / Retrait d'éléments de la légende -->
                <div id="composer-legend-customizer" class="composer-legend-customizer">
                  <div class="composer-legend-customizer-header">
                    <span>Éléments de la légende</span>
                    <button type="button" id="composer-btn-reset-legend" class="composer-btn-mini-reset" title="Réafficher tous les éléments masqués">Tout afficher</button>
                  </div>
                  <div id="composer-legend-checklist" class="composer-legend-checklist">
                    <!-- Rempli dynamiquement -->
                  </div>
                </div>

                <label class="composer-checkbox-row">
                  <span>Bloc des notes de terrain</span>
                  <input type="checkbox" id="composer-check-notes" checked />
                </label>
                <label class="composer-checkbox-row" id="composer-row-check-profile">
                  <span>Coupe topographique (Profil MNT)</span>
                  <input type="checkbox" id="composer-check-profile" />
                </label>
              </div>

              <!-- Section Dimensions des boîtes (mm) -->
              <div class="composer-section">
                <div class="composer-section-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                  Dimensions des boîtes (mm)
                </div>
                <div class="composer-size-grid">
                  <div class="composer-size-field">
                    <label for="composer-size-header-h">En-tête (H)</label>
                    <div class="composer-size-input-wrap">
                      <input type="number" id="composer-size-header-h" class="composer-input-sm" min="12" max="60" step="1" value="22" />
                      <span class="composer-unit">mm</span>
                    </div>
                  </div>
                  <div class="composer-size-field">
                    <label for="composer-size-side-w">Panneau (L)</label>
                    <div class="composer-size-input-wrap">
                      <input type="number" id="composer-size-side-w" class="composer-input-sm" min="30" max="110" step="1" value="60" />
                      <span class="composer-unit">mm</span>
                    </div>
                  </div>
                  <div class="composer-size-field">
                    <label for="composer-size-compass">Boussole</label>
                    <div class="composer-size-input-wrap">
                      <input type="number" id="composer-size-compass" class="composer-input-sm" min="14" max="50" step="1" value="24" />
                      <span class="composer-unit">mm</span>
                    </div>
                  </div>
                  <div class="composer-size-field">
                    <label for="composer-size-profile-h">Profil (H)</label>
                    <div class="composer-size-input-wrap">
                      <input type="number" id="composer-size-profile-h" class="composer-input-sm" min="20" max="90" step="1" value="46" />
                      <span class="composer-unit">mm</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Viewport de Prévisualisation (Feuille de papier) -->
            <div class="composer-preview-viewport" id="composer-preview-viewport">
              <div id="composer-sheet-scaler" class="composer-sheet-scaler">
                <div id="composer-sheet" class="composer-sheet landscape">
                  <!-- 1. En-tête / Cartouche -->
                  <div class="sheet-cartouche">
                    <div id="sheet-logo-container" class="sheet-logo-container" style="display: none;">
                      <img id="sheet-logo-img" alt="Logo" />
                    </div>
                    <div class="sheet-cartouche-main">
                      <h1 id="sheet-title" class="sheet-title" contenteditable="true" spellcheck="false" title="Cliquez pour éditer directement">Plan de ferme</h1>
                      <div id="sheet-subtitle" class="sheet-subtitle" contenteditable="true" spellcheck="false" title="Cliquez pour éditer directement">Parcelles principales</div>
                    </div>
                    <div class="sheet-cartouche-meta">
                      <div>Date : <strong id="sheet-meta-date">16 oct. 2026</strong></div>
                      <div id="sheet-meta-location-row">Lieu : <strong id="sheet-meta-location">Québec</strong></div>
                      <div id="sheet-meta-author-row" style="display: none;">Auteur : <strong id="sheet-meta-author"></strong></div>
                    </div>
                  </div>

                  <!-- 2. Zone centrale : Carte + Éléments latéraux -->
                  <div class="sheet-content-row">
                    <!-- Colonne Carte & Profil MNT éventuel -->
                    <div class="sheet-map-column" id="sheet-map-column">
                      <div class="sheet-map-frame" id="sheet-map-frame">
                        <img id="sheet-map-img" class="sheet-map-img" alt="Capture de la carte" />
                      </div>

                      <!-- Bloc Profil Topographique MNT (si coupe active) -->
                      <div id="sheet-profile-block" class="sheet-profile-block" style="display: none;">
                        <div class="sheet-profile-header">
                          <div class="sheet-profile-title">Profil altimétrique de la coupe (MNT LiDAR 1 m)</div>
                          <div id="sheet-profile-chips" class="sheet-profile-chips"></div>
                        </div>
                        <div id="sheet-profile-chart-wrap" class="sheet-profile-chart-wrap"></div>
                      </div>
                    </div>

                    <!-- Panneau latéral sur la feuille -->
                    <div class="sheet-side-panel">
                      <!-- Rose des vents & Échelle -->
                      <div id="sheet-nav-block" class="sheet-nav-block">
                        <div id="sheet-compass-wrap" class="sheet-compass-wrap">
                          <!-- SVG Rose des vents injecté ici -->
                        </div>
                        <div id="sheet-scale-wrap" class="sheet-scale-wrap">
                          <div class="sheet-scale-bar">
                            <div class="sheet-scale-bar-seg"></div>
                            <div class="sheet-scale-bar-seg"></div>
                            <div class="sheet-scale-bar-seg"></div>
                            <div class="sheet-scale-bar-seg"></div>
                          </div>
                          <div class="sheet-scale-labels">
                            <span>0</span>
                            <span id="sheet-scale-mid">100m</span>
                            <span id="sheet-scale-max">200m</span>
                          </div>
                          <div id="sheet-scale-ratio" class="sheet-scale-ratio">Échelle 1 : 5 000</div>
                        </div>
                      </div>

                      <!-- Légende dynamique -->
                      <div id="sheet-legend-block" class="sheet-legend-block">
                        <div class="sheet-legend-title">Légende</div>
                        <div id="sheet-legend-items" class="sheet-legend-items">
                          <!-- Rempli selon les couches actives -->
                        </div>
                      </div>

                      <!-- Bloc de notes -->
                      <div id="sheet-notes-block" class="sheet-notes-block">
                        <div class="sheet-notes-title">Notes &amp; Interventions</div>
                        <div id="sheet-notes-text" class="sheet-notes-text" contenteditable="true" spellcheck="false" title="Cliquez pour éditer les notes">Observations agronomiques et prévisions des travaux.</div>
                      </div>
                    </div>
                  </div>

                  <!-- 3. Pied de page -->
                  <div class="sheet-footer">
                    <span>Plan de Ferme • <a href="https://plandeferme.ca" target="_blank" style="color: inherit; text-decoration: none;">plandeferme.ca</a></span>
                    <span>Données : LiDAR HRDEM Canada 1 m, IRDA, BDPPAD</span>
                  </div>
                </div>
              </div>

              <!-- Barre d'outils de Zoom (Ajuster, 100%, + / -) -->
              <div class="composer-zoom-toolbar">
                <button type="button" id="composer-zoom-out" class="composer-zoom-btn" title="Zoom arrière">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button type="button" id="composer-zoom-fit" class="composer-zoom-btn active" title="Ajuster la feuille entière à l'écran">
                  <span>Ajuster</span>
                </button>
                <button type="button" id="composer-zoom-100" class="composer-zoom-btn" title="Taille réelle (100%)">
                  <span>100%</span>
                </button>
                <button type="button" id="composer-zoom-in" class="composer-zoom-btn" title="Zoom avant">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <span id="composer-zoom-level" class="composer-zoom-level">100%</span>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Référencement des éléments DOM utiles
      this.dom = {
        overlay,
        btnGeneratePdf: document.getElementById("composer-btn-generate-pdf"),
        btnClose: document.getElementById("composer-btn-close"),
        btnOrientLandscape: document.getElementById("composer-orient-landscape"),
        btnOrientPortrait: document.getElementById("composer-orient-portrait"),
        templateSelect: document.getElementById("composer-template-select"),
        btnSaveTemplate: document.getElementById("composer-btn-save-template"),
        btnExportQpt: document.getElementById("composer-btn-export-qpt"),
        inputLogo: document.getElementById("composer-input-logo"),
        btnClearLogo: document.getElementById("composer-btn-clear-logo"),
        logoPreview: document.getElementById("composer-logo-preview"),
        inputTitle: document.getElementById("composer-input-title"),
        inputSubtitle: document.getElementById("composer-input-subtitle"),
        inputLocation: document.getElementById("composer-input-location"),
        inputAuthor: document.getElementById("composer-input-author"),
        inputNotes: document.getElementById("composer-input-notes"),
        checkCompass: document.getElementById("composer-check-compass"),
        checkScale: document.getElementById("composer-check-scale"),
        checkLegend: document.getElementById("composer-check-legend"),
        checkNotes: document.getElementById("composer-check-notes"),

        // Personnalisation de la légende
        legendCustomizer: document.getElementById("composer-legend-customizer"),
        btnResetLegend: document.getElementById("composer-btn-reset-legend"),
        legendChecklist: document.getElementById("composer-legend-checklist"),

        // Éléments du viewport & échelle
        previewViewport: document.getElementById("composer-preview-viewport"),
        sheetScaler: document.getElementById("composer-sheet-scaler"),
        zoomFit: document.getElementById("composer-zoom-fit"),
        zoom100: document.getElementById("composer-zoom-100"),
        zoomIn: document.getElementById("composer-zoom-in"),
        zoomOut: document.getElementById("composer-zoom-out"),
        zoomLevel: document.getElementById("composer-zoom-level"),

        // Éléments de la feuille (aperçu)
        sheet: document.getElementById("composer-sheet"),
        sheetLogoContainer: document.getElementById("sheet-logo-container"),
        sheetLogoImg: document.getElementById("sheet-logo-img"),
        sheetTitle: document.getElementById("sheet-title"),
        sheetSubtitle: document.getElementById("sheet-subtitle"),
        sheetMetaDate: document.getElementById("sheet-meta-date"),
        sheetMetaLocation: document.getElementById("sheet-meta-location"),
        sheetMetaLocationRow: document.getElementById("sheet-meta-location-row"),
        sheetMetaAuthor: document.getElementById("sheet-meta-author"),
        sheetMetaAuthorRow: document.getElementById("sheet-meta-author-row"),
        sheetMapImg: document.getElementById("sheet-map-img"),
        sheetMapFrame: document.getElementById("sheet-map-frame"),
        sheetNavBlock: document.getElementById("sheet-nav-block"),
        sheetCompassWrap: document.getElementById("sheet-compass-wrap"),
        sheetScaleWrap: document.getElementById("sheet-scale-wrap"),
        sheetScaleMid: document.getElementById("sheet-scale-mid"),
        sheetScaleMax: document.getElementById("sheet-scale-max"),
        sheetScaleRatio: document.getElementById("sheet-scale-ratio"),
        sheetLegendBlock: document.getElementById("sheet-legend-block"),
        sheetLegendItems: document.getElementById("sheet-legend-items"),
        sheetNotesBlock: document.getElementById("sheet-notes-block"),
        sheetNotesText: document.getElementById("sheet-notes-text"),

        // Onglets mobiles & QGIS & Profil coupe MNT
        composerBody: document.getElementById("composer-body"),
        tabSettings: document.getElementById("composer-tab-settings"),
        tabPreview: document.getElementById("composer-tab-preview"),
        inputImportQpt: document.getElementById("composer-input-import-qpt"),
        checkProfile: document.getElementById("composer-check-profile"),
        rowCheckProfile: document.getElementById("composer-row-check-profile"),
        sheetMapColumn: document.getElementById("sheet-map-column"),
        sheetProfileBlock: document.getElementById("sheet-profile-block"),
        sheetProfileChips: document.getElementById("sheet-profile-chips"),
        sheetProfileChartWrap: document.getElementById("sheet-profile-chart-wrap"),

        // Réglages des dimensions des boîtes
        inputSizeHeaderH: document.getElementById("composer-size-header-h"),
        inputSizeSideW: document.getElementById("composer-size-side-w"),
        inputSizeCompass: document.getElementById("composer-size-compass"),
        inputSizeProfileH: document.getElementById("composer-size-profile-h"),
        sheetCartouche: document.querySelector(".sheet-cartouche"),
        sheetSidePanel: document.querySelector(".sheet-side-panel")
      };

      this.populateTemplateSelect();
      this.renderCompass();
    }

    /**
     * Rendu vectoriel géodésique haute précision de la Rose des vents (SVG)
     */
    renderCompass() {
      const bearing = this.map ? this.map.getBearing() : 0;
      
      // Génération dynamique des 36 graduations du cadran (tous les 10°)
      let ticksHtml = "";
      for (let deg = 0; deg < 360; deg += 10) {
        const isCardinal = deg % 90 === 0;
        const isSemi = deg % 45 === 0 && !isCardinal;
        const tickLen = isCardinal ? 4.8 : isSemi ? 3.2 : 1.8;
        const strokeW = isCardinal ? 1.1 : isSemi ? 0.75 : 0.45;
        const strokeColor = isCardinal ? "#0f172a" : isSemi ? "#475569" : "#94a3b8";
        const rad = (deg * Math.PI) / 180;
        const rOuter = 46.5;
        const rInner = rOuter - tickLen;
        const x1 = (50 + rOuter * Math.sin(rad)).toFixed(2);
        const y1 = (50 - rOuter * Math.cos(rad)).toFixed(2);
        const x2 = (50 + rInner * Math.sin(rad)).toFixed(2);
        const y2 = (50 - rInner * Math.cos(rad)).toFixed(2);
        ticksHtml += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
      }

      this.dom.sheetCompassWrap.innerHTML = `
        <svg class="sheet-compass-svg" viewBox="0 0 100 100" style="transform: rotate(${bearing}deg); width: 100%; height: 100%;">
          <!-- Cadran extérieur et cercle gradué -->
          <circle cx="50" cy="50" r="48" fill="#ffffff" stroke="#0f172a" stroke-width="1.2"/>
          <circle cx="50" cy="50" r="46.5" fill="none" stroke="#cbd5e1" stroke-width="0.5"/>
          <circle cx="50" cy="50" r="41.5" fill="none" stroke="#e2e8f0" stroke-width="0.75"/>
          
          <!-- Graduations d'azimut -->
          ${ticksHtml}

          <!-- 4 pointes intermédiaires NE, SE, SO, NO -->
          <polygon points="50,50 69,31 52,48" fill="#94a3b8" />
          <polygon points="50,50 69,31 48,52" fill="#cbd5e1" />
          <polygon points="50,50 69,69 52,52" fill="#94a3b8" />
          <polygon points="50,50 69,69 48,48" fill="#cbd5e1" />
          <polygon points="50,50 31,69 48,52" fill="#94a3b8" />
          <polygon points="50,50 31,69 52,48" fill="#cbd5e1" />
          <polygon points="50,50 31,31 48,48" fill="#94a3b8" />
          <polygon points="50,50 31,31 52,52" fill="#cbd5e1" />

          <!-- Sud -->
          <polygon points="50,86 46,50 50,53" fill="#94a3b8" />
          <polygon points="50,86 54,50 50,53" fill="#cbd5e1" />

          <!-- Est -->
          <polygon points="86,50 50,46 53,50" fill="#94a3b8" />
          <polygon points="86,50 50,54 53,50" fill="#cbd5e1" />

          <!-- Ouest (O) -->
          <polygon points="14,50 50,46 47,50" fill="#94a3b8" />
          <polygon points="14,50 50,54 47,50" fill="#cbd5e1" />

          <!-- Nord (Grande flèche bicolore contrastée) -->
          <polygon points="50,14 44,50 50,47" fill="#0f172a" />
          <polygon points="50,14 56,50 50,47" fill="#475569" />

          <!-- Pointeau rouge supérieur Nord -->
          <polygon points="50,10.5 47.5,15 52.5,15" fill="#dc2626" />

          <!-- Anneau central multi-épaisseurs -->
          <circle cx="50" cy="50" r="5" fill="#0f172a" stroke="#ffffff" stroke-width="0.8"/>
          <circle cx="50" cy="50" r="2.2" fill="#ffffff" />
          <circle cx="50" cy="50" r="1.1" fill="#0f172a" />

          <!-- Lettres cardinales élégantes et distinctes -->
          <text x="50" y="8" font-size="8.5" font-weight="900" font-family="'Plus Jakarta Sans', system-ui, sans-serif" text-anchor="middle" fill="#0f172a">N</text>
          <text x="50" y="96" font-size="6.5" font-weight="700" font-family="'Plus Jakarta Sans', system-ui, sans-serif" text-anchor="middle" fill="#64748b">S</text>
          <text x="94" y="52.2" font-size="6.5" font-weight="700" font-family="'Plus Jakarta Sans', system-ui, sans-serif" text-anchor="middle" fill="#64748b">E</text>
          <text x="6" y="52.2" font-size="6.5" font-weight="700" font-family="'Plus Jakarta Sans', system-ui, sans-serif" text-anchor="middle" fill="#64748b">O</text>
        </svg>
      `;
    }

    /**
     * Remplissage de la liste des modèles
     */
    populateTemplateSelect() {
      const select = this.dom.templateSelect;
      select.innerHTML = "";

      // Modèles par défaut
      const optGroupDef = document.createElement("optgroup");
      optGroupDef.label = "Modèles standards";
      Object.values(DEFAULT_TEMPLATES).forEach(tmpl => {
        const opt = document.createElement("option");
        opt.value = tmpl.id;
        opt.textContent = tmpl.name;
        optGroupDef.appendChild(opt);
      });
      select.appendChild(optGroupDef);

      // Modèles utilisateur
      const userKeys = Object.keys(this.userTemplates);
      if (userKeys.length > 0) {
        const optGroupUser = document.createElement("optgroup");
        optGroupUser.label = "Mes modèles enregistrés";
        userKeys.forEach(key => {
          const tmpl = this.userTemplates[key];
          const opt = document.createElement("option");
          opt.value = "user_" + key;
          opt.textContent = tmpl.name || key;
          optGroupUser.appendChild(opt);
        });
        select.appendChild(optGroupUser);
      }
    }

    /**
     * Liaison des écouteurs d'événements
     */
    bindEvents() {
      // Fermeture
      this.dom.btnClose.addEventListener("click", () => this.close());
      this.dom.overlay.addEventListener("click", (e) => {
        if (e.target === this.dom.overlay) this.close();
      });

      // Raccourci Échap
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) this.close();
      });

      // Navigation par onglets sur mobile (Réglages vs Aperçu)
      if (this.dom.tabSettings && this.dom.tabPreview) {
        this.dom.tabSettings.addEventListener("click", () => {
          this.dom.tabSettings.classList.add("active");
          this.dom.tabPreview.classList.remove("active");
          if (this.dom.composerBody) {
            this.dom.composerBody.dataset.activeTab = "settings";
          }
        });

        this.dom.tabPreview.addEventListener("click", () => {
          this.dom.tabPreview.classList.add("active");
          this.dom.tabSettings.classList.remove("active");
          if (this.dom.composerBody) {
            this.dom.composerBody.dataset.activeTab = "preview";
          }
          // Double rAF pour laisser le moteur CSS déployer display: flex et calculer la géométrie réelle
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (this.zoomMode === "fit") {
                this.fitSheetToViewport();
              } else {
                this.applyScale(this.currentScale, false);
              }
              if (this.dom.previewViewport) {
                this.dom.previewViewport.scrollTop = 0;
              }
            });
          });
        });
      }

      // Changement d'orientation
      this.dom.btnOrientLandscape.addEventListener("click", () => this.setOrientation("landscape"));
      this.dom.btnOrientPortrait.addEventListener("click", () => this.setOrientation("portrait"));

      // Sélection de modèle
      this.dom.templateSelect.addEventListener("change", (e) => {
        this.applyTemplate(e.target.value);
      });

      // Enregistrement d'un modèle
      this.dom.btnSaveTemplate.addEventListener("click", () => {
        const name = prompt("Nom du modèle à enregistrer :", this.state.name || "Mon modèle personnalisé");
        if (name && name.trim()) {
          const cleanName = name.trim();
          const id = "custom_" + Date.now();
          this.userTemplates[id] = {
            ...this.state,
            id,
            name: cleanName
          };
          this.saveUserTemplates();
          this.populateTemplateSelect();
          this.dom.templateSelect.value = "user_" + id;
          alert(`Modèle "${cleanName}" enregistré dans votre navigateur !`);
        }
      });

      // Exporter au format QGIS Print Layout (.qpt)
      if (this.dom.btnExportQpt) {
        this.dom.btnExportQpt.addEventListener("click", () => this.exportQptTemplate());
      }

      // Importer depuis un gabarit QGIS (.qpt)
      if (this.dom.inputImportQpt) {
        this.dom.inputImportQpt.addEventListener("change", (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.importQptTemplate(evt.target.result, file.name);
            e.target.value = "";
          };
          reader.readAsText(file);
        });
      }

      // Upload de logo
      this.dom.inputLogo.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          this.state.logoUrl = evt.target.result;
          this.updateLogoDisplay();
        };
        reader.readAsDataURL(file);
      });

      // Retirer le logo
      this.dom.btnClearLogo.addEventListener("click", () => {
        this.state.logoUrl = null;
        this.dom.inputLogo.value = "";
        this.updateLogoDisplay();
      });

      // Synchronisation bidirectionnelle des champs texte
      // 1. Titre
      this.dom.inputTitle.addEventListener("input", (e) => {
        this.state.title = e.target.value;
        this.dom.sheetTitle.textContent = e.target.value || "Plan de ferme";
      });
      this.dom.sheetTitle.addEventListener("input", (e) => {
        this.state.title = e.target.textContent;
        this.dom.inputTitle.value = e.target.textContent;
      });

      // 2. Sous-titre
      this.dom.inputSubtitle.addEventListener("input", (e) => {
        this.state.subtitle = e.target.value;
        this.dom.sheetSubtitle.textContent = e.target.value;
      });
      this.dom.sheetSubtitle.addEventListener("input", (e) => {
        this.state.subtitle = e.target.textContent;
        this.dom.inputSubtitle.value = e.target.textContent;
      });

      // 3. Localisation
      this.dom.inputLocation.addEventListener("input", (e) => {
        this.state.location = e.target.value;
        this.dom.sheetMetaLocation.textContent = e.target.value;
        this.dom.sheetMetaLocationRow.style.display = e.target.value ? "block" : "none";
      });

      // 4. Auteur
      this.dom.inputAuthor.addEventListener("input", (e) => {
        this.state.author = e.target.value;
        this.dom.sheetMetaAuthor.textContent = e.target.value;
        this.dom.sheetMetaAuthorRow.style.display = e.target.value ? "block" : "none";
      });

      // 5. Notes
      this.dom.inputNotes.addEventListener("input", (e) => {
        this.state.notes = e.target.value;
        this.dom.sheetNotesText.textContent = e.target.value;
      });
      this.dom.sheetNotesText.addEventListener("input", (e) => {
        this.state.notes = e.target.textContent;
        this.dom.inputNotes.value = e.target.textContent;
      });

      // Cases à cocher des éléments
      this.dom.checkCompass.addEventListener("change", (e) => {
        this.state.showCompass = e.target.checked;
        this.dom.sheetCompassWrap.style.display = e.target.checked ? "flex" : "none";
        this.updateNavBlockVisibility();
      });

      this.dom.checkScale.addEventListener("change", (e) => {
        this.state.showScale = e.target.checked;
        this.dom.sheetScaleWrap.style.display = e.target.checked ? "flex" : "none";
        this.updateNavBlockVisibility();
      });

      this.dom.checkLegend.addEventListener("change", (e) => {
        this.state.showLegend = e.target.checked;
        this.dom.sheetLegendBlock.style.display = e.target.checked ? "flex" : "none";
        if (this.dom.legendCustomizer) {
          this.dom.legendCustomizer.style.display = e.target.checked ? "block" : "none";
        }
      });

      if (this.dom.btnResetLegend) {
        this.dom.btnResetLegend.addEventListener("click", () => {
          this.resetExcludedLegendItems();
        });
      }

      this.dom.checkNotes.addEventListener("change", (e) => {
        this.state.showNotes = e.target.checked;
        this.dom.sheetNotesBlock.style.display = e.target.checked ? "flex" : "none";
      });

      if (this.dom.checkProfile) {
        this.dom.checkProfile.addEventListener("change", (e) => {
          this.state.showProfile = e.target.checked;
          this.updateProfileBlockVisibility();
        });
      }

      // Réglages dynamiques des dimensions des boîtes (style Layout-Composer)
      const onSizeChange = () => {
        if (!this.state.layout) this.state.layout = { ...DEFAULT_LAYOUT };
        if (this.dom.inputSizeHeaderH) {
          const val = parseFloat(this.dom.inputSizeHeaderH.value);
          if (val > 0) this.state.layout.headerH = val;
        }
        if (this.dom.inputSizeSideW) {
          const val = parseFloat(this.dom.inputSizeSideW.value);
          if (val > 0) this.state.layout.sideW = val;
        }
        if (this.dom.inputSizeCompass) {
          const val = parseFloat(this.dom.inputSizeCompass.value);
          if (val > 0) this.state.layout.compassSize = val;
        }
        if (this.dom.inputSizeProfileH) {
          const val = parseFloat(this.dom.inputSizeProfileH.value);
          if (val > 0) this.state.layout.profileH = val;
        }
        this.applyLayoutDimensions();
        this.updateMapSnapshotForOrientation();
        this.updateScale();
      };

      [this.dom.inputSizeHeaderH, this.dom.inputSizeSideW, this.dom.inputSizeCompass, this.dom.inputSizeProfileH].forEach(input => {
        if (input) {
          input.addEventListener("input", onSizeChange);
          input.addEventListener("change", onSizeChange);
        }
      });

      // Contrôles de zoom & ajustement de la prévisualisation
      if (this.dom.zoomFit) {
        this.dom.zoomFit.addEventListener("click", () => {
          this.zoomMode = "fit";
          this.fitSheetToViewport();
          if (this.dom.previewViewport) this.dom.previewViewport.scrollTop = 0;
        });
      }

      if (this.dom.zoom100) {
        this.dom.zoom100.addEventListener("click", () => {
          this.zoomMode = "100";
          this.applyScale(1.0, false);
          if (this.dom.previewViewport) this.dom.previewViewport.scrollTop = 0;
        });
      }

      if (this.dom.zoomIn) {
        this.dom.zoomIn.addEventListener("click", () => {
          this.zoomMode = "custom";
          this.applyScale(this.currentScale + 0.15, false);
        });
      }

      if (this.dom.zoomOut) {
        this.dom.zoomOut.addEventListener("click", () => {
          this.zoomMode = "custom";
          this.applyScale(this.currentScale - 0.15, false);
        });
      }

      // Redimensionnement automatique si le mode "Ajuster" est actif
      window.addEventListener("resize", () => {
        if (this.isOpen && this.zoomMode === "fit") {
          this.fitSheetToViewport();
        }
      });

      // Observer les changements de taille du viewport (redimensionnement / onglets mobiles)
      if (window.ResizeObserver && this.dom.previewViewport) {
        this.resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.contentRect.width > 50 && entry.contentRect.height > 50) {
              if (this.isOpen && this.zoomMode === "fit") {
                this.fitSheetToViewport();
              }
            }
          }
        });
        this.resizeObserver.observe(this.dom.previewViewport);
      }

      // Bouton de génération PDF
      this.dom.btnGeneratePdf.addEventListener("click", () => this.generatePdf());
    }

    /**
     * Applique une échelle de zoom fluide à la feuille et adapte le conteneur scaler
     */
    applyScale(scale, isFit = false) {
      this.currentScale = Math.max(0.2, Math.min(scale, 1.8));
      if (!this.dom.sheetScaler || !this.dom.sheet) return;

      const isLandscape = this.state.orientation === "landscape";
      const sheetW = isLandscape ? 880 : 650;
      const sheetH = isLandscape ? 680 : 841;

      const scaledW = Math.round(sheetW * this.currentScale);
      const scaledH = Math.round(sheetH * this.currentScale);

      this.dom.sheetScaler.style.width = scaledW + "px";
      this.dom.sheetScaler.style.height = scaledH + "px";
      this.dom.sheet.style.transform = `scale(${this.currentScale})`;
      this.dom.sheet.style.transformOrigin = "top left";

      if (this.dom.zoomLevel) {
        this.dom.zoomLevel.textContent = `${Math.round(this.currentScale * 100)}%`;
      }

      if (this.dom.zoomFit) {
        this.dom.zoomFit.classList.toggle("active", isFit);
      }
      if (this.dom.zoom100) {
        this.dom.zoom100.classList.toggle("active", !isFit && Math.abs(this.currentScale - 1.0) < 0.02);
      }
    }

    /**
     * Calcule l'échelle idéale pour que l'intégralité de la page (haut et bas)
     * tienne parfaitement dans la fenêtre de prévisualisation, sans tronquer le cartouche en haut.
     */
    fitSheetToViewport() {
      if (!this.dom.previewViewport || !this.isOpen) return;

      const vpW = this.dom.previewViewport.clientWidth;
      const vpH = this.dom.previewViewport.clientHeight;
      if (vpW <= 50 || vpH <= 50) return;

      // Marge de confort pour éviter tout ascenseur parasite
      const padX = vpW <= 600 ? 16 : 40;
      const padY = vpW <= 600 ? 16 : 40;
      const availW = Math.max(100, vpW - padX);
      const availH = Math.max(100, vpH - padY);

      const isLandscape = this.state.orientation === "landscape";
      const sheetW = isLandscape ? 880 : 650;
      const sheetH = isLandscape ? 680 : 841;

      const scale = Math.min(availW / sheetW, availH / sheetH, 1.0);
      this.applyScale(scale, true);
    }

    updateNavBlockVisibility() {
      const show = this.state.showCompass || this.state.showScale;
      if (this.dom && this.dom.sheetNavBlock) {
        this.dom.sheetNavBlock.style.display = show ? "flex" : "none";
      }
    }

    /**
     * Mise à jour de l'affichage du logo
     */
    updateLogoDisplay() {
      if (!this.dom) return;
      if (this.state.logoUrl) {
        if (this.dom.logoPreview) this.dom.logoPreview.innerHTML = `<img src="${this.state.logoUrl}" alt="Logo" />`;
        if (this.dom.btnClearLogo) this.dom.btnClearLogo.style.display = "block";
        if (this.dom.sheetLogoContainer) this.dom.sheetLogoContainer.style.display = "flex";
        if (this.dom.sheetLogoImg) this.dom.sheetLogoImg.src = this.state.logoUrl;
      } else {
        if (this.dom.logoPreview) this.dom.logoPreview.innerHTML = `<span class="composer-logo-preview-empty">Aucun<br/>logo</span>`;
        if (this.dom.btnClearLogo) this.dom.btnClearLogo.style.display = "none";
        if (this.dom.sheetLogoContainer) this.dom.sheetLogoContainer.style.display = "none";
        if (this.dom.sheetLogoImg) this.dom.sheetLogoImg.src = "";
      }
    }

    /**
     * Mise à jour de la visibilité du bloc profil topographique sur la feuille
     */
    updateProfileBlockVisibility() {
      const block = this.dom.sheetProfileBlock;
      if (!block) return;
      const isVisible = !!this.state.showProfile;
      block.style.display = isVisible ? "flex" : "none";
      if (isVisible) {
        this.renderSheetProfile();
      }
      this.updateMapSnapshotForOrientation();
    }

    /**
     * Rendu du graphique de la coupe topographique sur la feuille de composition
     */
    renderSheetProfile() {
      const block = this.dom.sheetProfileBlock;
      const chipsEl = this.dom.sheetProfileChips;
      const wrapEl = this.dom.sheetProfileChartWrap;
      if (!block || !chipsEl || !wrapEl) return;

      const profile = window.profileManager ? window.profileManager.profile : null;
      if (!profile || profile.length < 2) {
        chipsEl.innerHTML = "";
        wrapEl.innerHTML = `<div style="font-size: 8px; color: #94a3b8; font-style: italic; padding: 12px; text-align: center;">Tracez une coupe sur la carte avec l'outil Coupe MNT pour afficher le profil altimétrique ici.</div>`;
        return;
      }

      const elevations = profile.map(p => p.elevation);
      const minElev = Math.min(...elevations);
      const maxElev = Math.max(...elevations);
      const deltaElev = maxElev - minElev;
      const totalDist = profile[profile.length - 1].distance;

      // Régression linéaire pour la pente moyenne
      const n = profile.length;
      const meanX = profile.reduce((acc, p) => acc + p.distance, 0) / n;
      const meanY = elevations.reduce((acc, e) => acc + e, 0) / n;
      let num = 0, den = 0;
      for (const p of profile) {
        const dx = p.distance - meanX;
        num += dx * (p.elevation - meanY);
        den += dx * dx;
      }
      const slope = den === 0 ? 0 : num / den;
      const intercept = meanY - slope * meanX;
      const slopePct = slope * 100;

      // Badges statistiques
      const distStr = totalDist >= 1000 ? (totalDist / 1000).toFixed(2) + " km" : Math.round(totalDist) + " m";
      chipsEl.innerHTML = `
        <span class="sheet-profile-chip">Min : <strong>${minElev.toFixed(1)} m</strong></span>
        <span class="sheet-profile-chip">Max : <strong>${maxElev.toFixed(1)} m</strong></span>
        <span class="sheet-profile-chip">Dénivelé &Delta; : <strong>${deltaElev.toFixed(1)} m</strong></span>
        <span class="sheet-profile-chip">Pente moy. : <strong>${slopePct >= 0 ? '+' : ''}${slopePct.toFixed(1)}%</strong></span>
        <span class="sheet-profile-chip">Distance : <strong>${distStr}</strong></span>
      `;

      // Graphique SVG vectoriel
      const w = 550;
      const h = 88;
      const pad = { left: 40, right: 15, top: 10, bottom: 20 };
      const plotW = w - pad.left - pad.right;
      const plotH = h - pad.top - pad.bottom;
      const span = deltaElev || 1;

      const points = profile.map(p => [
        pad.left + (p.distance / totalDist) * plotW,
        pad.top + (1 - (p.elevation - minElev) / span) * plotH
      ]);

      const pathD = points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(" ");
      const axisBottom = pad.top + plotH;
      const axisLeft = pad.left;

      const trendY1 = pad.top + (1 - (intercept - minElev) / span) * plotH;
      const trendY2 = pad.top + (1 - (intercept + slope * totalDist - minElev) / span) * plotH;
      const trendD = `M${pad.left.toFixed(1)} ${trendY1.toFixed(1)} L${(pad.left + plotW).toFixed(1)} ${trendY2.toFixed(1)}`;

      let gridHtml = "";
      for (let i = 0; i <= 3; i++) {
        const gy = pad.top + (i / 3) * plotH;
        gridHtml += `<line x1="${axisLeft}" y1="${gy.toFixed(1)}" x2="${(axisLeft + plotW).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#f1f5f9" stroke-width="1"/>`;
      }
      for (let i = 0; i <= 4; i++) {
        const gx = axisLeft + (i / 4) * plotW;
        gridHtml += `<line x1="${gx.toFixed(1)}" y1="${pad.top}" x2="${gx.toFixed(1)}" y2="${axisBottom}" stroke="#f1f5f9" stroke-width="1"/>`;
      }

      wrapEl.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sheet-profile-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0284c7" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#0284c7" stop-opacity="0.04"/>
            </linearGradient>
          </defs>
          ${gridHtml}
          <!-- Aire colorée sous le profil -->
          <path d="${pathD} L ${(axisLeft + plotW).toFixed(1)} ${axisBottom} L ${axisLeft} ${axisBottom} Z" fill="url(#sheet-profile-grad)"/>
          <!-- Ligne de tendance -->
          <path d="${trendD}" stroke="#ea580c" stroke-width="1.2" stroke-dasharray="3 3"/>
          <!-- Ligne du profil altimétrique -->
          <path d="${pathD}" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Axes -->
          <line x1="${axisLeft}" y1="${axisBottom}" x2="${(axisLeft + plotW).toFixed(1)}" y2="${axisBottom}" stroke="#94a3b8" stroke-width="0.8"/>
          <line x1="${axisLeft}" y1="${pad.top}" x2="${axisLeft}" y2="${axisBottom}" stroke="#94a3b8" stroke-width="0.8"/>
          <!-- Étiquettes d'élévation -->
          <text x="${axisLeft - 4}" y="${pad.top + 3}" text-anchor="end" font-size="7.5" fill="#64748b" font-weight="600">${maxElev.toFixed(1)} m</text>
          <text x="${axisLeft - 4}" y="${(pad.top + plotH / 2 + 2.5).toFixed(1)}" text-anchor="end" font-size="7.5" fill="#64748b">${((minElev + maxElev) / 2).toFixed(1)} m</text>
          <text x="${axisLeft - 4}" y="${axisBottom + 1}" text-anchor="end" font-size="7.5" fill="#64748b" font-weight="600">${minElev.toFixed(1)} m</text>
          <!-- Étiquettes de distance -->
          <text x="${axisLeft}" y="${h - 4}" text-anchor="start" font-size="7.5" fill="#64748b" font-weight="600">0 m</text>
          <text x="${(axisLeft + plotW).toFixed(1)}" y="${h - 4}" text-anchor="end" font-size="7.5" fill="#64748b" font-weight="600">${distStr}</text>
        </svg>
      `;
    }

    /**
     * Échappe les caractères réservés XML
     */
    escapeXml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }

    /**
     * Décode les entités XML vers du texte brut
     */
    unescapeXml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&#10;/g, "\n")
        .replace(/&#13;/g, "")
        .replace(/&amp;/g, "&");
    }

    /**
     * Applique fidèlement les dimensions personnalisées (en millimètres) sur la feuille d'aperçu
     * (style QGIS Layout-Composer)
     */
    applyLayoutDimensions() {
      if (!this.state.layout) {
        this.state.layout = { ...DEFAULT_LAYOUT };
      }
      const layout = this.state.layout;
      const isLandscape = this.state.orientation === "landscape";
      const pxPerMm = isLandscape ? (880 / 279.4) : (650 / 215.9);

      // 1. En-tête / Cartouche (Hauteur stricte et gap de 3mm vers le contenu)
      if (this.dom.sheetCartouche) {
        const hPx = Math.round((layout.headerH || 22) * pxPerMm);
        const gapPx = Math.round(3 * pxPerMm);
        this.dom.sheetCartouche.style.height = `${hPx}px`;
        this.dom.sheetCartouche.style.minHeight = `${hPx}px`;
        this.dom.sheetCartouche.style.maxHeight = `${hPx}px`;
        this.dom.sheetCartouche.style.marginBottom = `${gapPx}px`;
        this.dom.sheetCartouche.style.boxSizing = "border-box";
      }

      // 2. Panneau latéral (Paysage: largeur sideW / Portrait: section basse 55mm = 165px)
      if (this.dom.sheetSidePanel) {
        if (isLandscape) {
          const wPx = Math.round((layout.sideW || 60) * pxPerMm);
          this.dom.sheetSidePanel.style.width = `${wPx}px`;
          this.dom.sheetSidePanel.style.minWidth = `${wPx}px`;
          this.dom.sheetSidePanel.style.maxWidth = `${wPx}px`;
          this.dom.sheetSidePanel.style.height = "";
          this.dom.sheetSidePanel.style.minHeight = "";
          this.dom.sheetSidePanel.style.maxHeight = "";
        } else {
          const bottomHPx = Math.round(55 * pxPerMm);
          this.dom.sheetSidePanel.style.width = "100%";
          this.dom.sheetSidePanel.style.minWidth = "100%";
          this.dom.sheetSidePanel.style.maxWidth = "100%";
          this.dom.sheetSidePanel.style.height = `${bottomHPx}px`;
          this.dom.sheetSidePanel.style.minHeight = `${bottomHPx}px`;
          this.dom.sheetSidePanel.style.maxHeight = `${bottomHPx}px`;
        }
      }

      // 3. Boussole / Rose des vents
      if (this.dom.sheetCompassWrap) {
        const compassPx = Math.round((layout.compassSize || 24) * pxPerMm);
        this.dom.sheetCompassWrap.style.width = `${compassPx}px`;
        this.dom.sheetCompassWrap.style.height = `${compassPx}px`;
      }

      // 3b. Nav Block en mode portrait (largeur col1W)
      if (this.dom.sheetNavBlock) {
        if (!isLandscape) {
          const col1WPx = Math.round(Math.max(42, (layout.compassSize || 24) + 14) * pxPerMm);
          this.dom.sheetNavBlock.style.width = `${col1WPx}px`;
          this.dom.sheetNavBlock.style.minWidth = `${col1WPx}px`;
        } else {
          this.dom.sheetNavBlock.style.width = "100%";
          this.dom.sheetNavBlock.style.minWidth = "";
        }
      }

      // 4. Bloc Profil Coupe MNT
      if (this.dom.sheetProfileBlock) {
        const profPx = Math.round((layout.profileH || 46) * pxPerMm);
        this.dom.sheetProfileBlock.style.height = `${profPx}px`;
        this.dom.sheetProfileBlock.style.minHeight = `${profPx}px`;
        this.dom.sheetProfileBlock.style.maxHeight = `${profPx}px`;
      }

      // 5. Synchroniser les champs de saisie s'ils existent
      if (this.dom.inputSizeHeaderH && document.activeElement !== this.dom.inputSizeHeaderH) {
        this.dom.inputSizeHeaderH.value = Math.round(layout.headerH || 22);
      }
      if (this.dom.inputSizeSideW && document.activeElement !== this.dom.inputSizeSideW) {
        this.dom.inputSizeSideW.value = Math.round(layout.sideW || 60);
      }
      if (this.dom.inputSizeCompass && document.activeElement !== this.dom.inputSizeCompass) {
        this.dom.inputSizeCompass.value = Math.round(layout.compassSize || 24);
      }
      if (this.dom.inputSizeProfileH && document.activeElement !== this.dom.inputSizeProfileH) {
        this.dom.inputSizeProfileH.value = Math.round(layout.profileH || 46);
      }
    }

    /**
     * Exporte le gabarit actuel au format standard QGIS Print Layout (.qpt / XML)
     * Respecte fidèlement les dimensions réelles (mm) et positions selon Layout-Composer
     */
    exportQptTemplate() {
      const isLandscape = this.state.orientation === "landscape";
      const pageW = isLandscape ? 279.4 : 215.9;
      const pageH = isLandscape ? 215.9 : 279.4;
      const orientation = isLandscape ? "landscape" : "portrait";
      const templateName = this.state.title || "Plan de ferme";

      const layout = { ...DEFAULT_LAYOUT, ...(this.state.layout || {}) };
      const margin = layout.margin || 10;
      const headerH = layout.headerH || 22;
      const sideW = layout.sideW || 60;
      const compassSize = layout.compassSize || 24;
      const profileH = layout.profileH || 46;
      const hasProfile = !!this.state.showProfile;

      const mapTopY = margin + headerH + 3;

      let mapW, mapH, sideX, sideY;
      let compassX, compassY, scaleX, scaleY, legendX, legendY, legendH, notesX, notesY, notesH, profileY;

      if (isLandscape) {
        mapW = pageW - margin * 2 - sideW - 4;
        mapH = hasProfile ? (pageH - mapTopY - margin - profileH - 6) : (pageH - mapTopY - margin - 6);
        sideX = margin + mapW + 4;
        sideY = mapTopY;

        compassX = sideX + (sideW - compassSize) / 2;
        compassY = sideY + 2;

        scaleX = sideX;
        scaleY = compassY + compassSize + 4;

        legendX = sideX;
        legendY = scaleY + 16;
        legendH = Math.max(30, pageH - legendY - margin - 35);

        notesX = sideX;
        notesY = pageH - margin - 32;
        notesH = 30;

        profileY = mapTopY + mapH + 3;
      } else {
        mapW = pageW - margin * 2;
        const bottomH = 55;
        const availableH = pageH - mapTopY - bottomH - margin - 6;
        mapH = hasProfile ? Math.max(80, availableH - profileH - 3) : Math.max(120, availableH);

        profileY = mapTopY + mapH + 3;
        const bottomY = hasProfile ? (profileY + profileH + 3) : (mapTopY + mapH + 3);

        const col1W = Math.max(38, compassSize + 10);
        compassX = margin + (col1W - compassSize) / 2;
        compassY = bottomY + 2;

        scaleX = margin;
        scaleY = compassY + compassSize + 4;

        legendX = margin + col1W + 3;
        legendY = bottomY;
        const col2W = 70;
        legendH = pageH - bottomY - margin - 6;

        notesX = legendX + col2W + 3;
        notesY = bottomY;
        notesH = pageH - bottomY - margin - 6;
      }

      // Sérialisation des paramètres PlanDeFerme dans une propriété personnalisée
      const serializedState = encodeURIComponent(JSON.stringify(this.state));

      const dateStr = (this.dom.sheetMetaDate && this.dom.sheetMetaDate.textContent) || "";
      const metaLines = [];
      if (dateStr) metaLines.push("Date : " + dateStr);
      if (this.state.location) metaLines.push("Lieu : " + this.state.location);
      if (this.state.author) metaLines.push("Auteur : " + this.state.author);

      // Calcul des coordonnées internes du cartouche
      let titleX = margin + 4;
      let titleW = pageW - margin * 2 - 80;
      let logoItemXml = "";
      if (this.state.logoUrl) {
        logoItemXml = `
  <!-- Logo -->
  <LayoutItem id="Logo" type="65640" position="${margin + 2},${margin + 2},mm" positionOnPage="${margin + 2},${margin + 2},mm" size="24,${headerH - 4},mm" frame="false" visibility="1" zIndex="2" file="${this.escapeXml(this.state.logoUrl)}" picturePath="${this.escapeXml(this.state.logoUrl)}" resizeMode="1" anchorPoint="0">
  </LayoutItem>`;
        titleX = margin + 28;
        titleW = pageW - margin * 2 - 104;
      }

      const qptXml = `<!DOCTYPE qgis_layout>
<Layout name="${this.escapeXml(templateName)}" units="mm" worldFileMap="">
  <Snapper snapToGuides="1" tolerance="5" snapToItems="1" snapToGrid="0"/>
  <Grid offsetX="0" resolution="10" resUnits="mm" offsetY="0" offsetUnits="mm"/>
  <PageCollection>
    <symbol force_rhr="0" type="fill" alpha="1" clip_to_extent="1" name="">
      <layer class="SimpleFill" pass="0" locked="0" enabled="1">
        <prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/>
        <prop k="color" v="255,255,255,255"/>
        <prop k="joinstyle" v="miter"/>
        <prop k="outline_color" v="15,23,42,255"/>
        <prop k="outline_style" v="no"/>
        <prop k="outline_width" v="0.26"/>
        <prop k="outline_width_unit" v="MM"/>
        <prop k="style" v="solid"/>
      </layer>
    </symbol>
    <LayoutItem id="" type="65638" position="0,0,mm" positionOnPage="0,0,mm" size="${pageW},${pageH},mm" frame="false" visibility="1" zIndex="0" background="true">
      <pageProperties pageWidth="${pageW}" pageHeight="${pageH}" orientation="${orientation}" format="Letter"/>
    </LayoutItem>
  </PageCollection>

  <!-- Cadre de Carte Principale -->
  <LayoutItem id="Carte Principale" type="65639" position="${margin},${mapTopY},mm" positionOnPage="${margin},${mapTopY},mm" size="${mapW},${mapH},mm" frame="true" outlineWidthM="0.4,mm" visibility="1" zIndex="1" background="true">
    <FrameColor alpha="255" red="15" blue="42" green="23"/>
    <BackgroundColor alpha="255" red="241" blue="249" green="245"/>
  </LayoutItem>

  ${hasProfile ? `
  <!-- Bloc Coupe Topographique (Profil MNT) -->
  <LayoutItem id="Profil Topographique" type="65640" position="${margin},${profileY},mm" positionOnPage="${margin},${profileY},mm" size="${mapW},${profileH},mm" frame="true" outlineWidthM="0.35,mm" visibility="1" zIndex="1" background="true">
    <FrameColor alpha="255" red="15" blue="42" green="23"/>
    <BackgroundColor alpha="255" red="255" blue="255" green="255"/>
  </LayoutItem>` : ""}

  <!-- Cartouche En-Tête -->
  <LayoutItem id="Cartouche Fond" type="65641" position="${margin},${margin},mm" positionOnPage="${margin},${margin},mm" size="${pageW - margin * 2},${headerH},mm" frame="true" outlineWidthM="0.4,mm" visibility="1" zIndex="1" background="true">
    <FrameColor alpha="255" red="15" blue="42" green="23"/>
    <BackgroundColor alpha="255" red="255" blue="255" green="255"/>
  </LayoutItem>
${logoItemXml}
  <!-- Titre -->
  <LayoutItem id="Titre" type="65641" position="${titleX},${margin + 2},mm" positionOnPage="${titleX},${margin + 2},mm" size="${titleW},${Math.min(10, headerH * 0.45)},mm" frame="false" visibility="1" zIndex="2" labelText="${this.escapeXml(this.state.title || "Plan de ferme")}">
    <FontDescription style="Bold" description="Helvetica,14,-1,5,75,0,0,0,0,0"/>
    <FontColor alpha="255" red="15" blue="42" green="23"/>
  </LayoutItem>

  <!-- Sous-titre -->
  <LayoutItem id="SousTitre" type="65641" position="${titleX},${margin + Math.min(12, headerH * 0.52)},mm" positionOnPage="${titleX},${margin + Math.min(12, headerH * 0.52)},mm" size="${titleW},${Math.min(8, headerH * 0.38)},mm" frame="false" visibility="1" zIndex="2" labelText="${this.escapeXml(this.state.subtitle || "")}">
    <FontDescription style="Bold" description="Helvetica,9,-1,5,75,0,0,0,0,0"/>
    <FontColor alpha="255" red="22" blue="52" green="101"/>
  </LayoutItem>

  <!-- Métadonnées (Date, Lieu, Auteur) -->
  <LayoutItem id="Metadonnees" type="65641" position="${pageW - margin - 75},${margin + 2},mm" positionOnPage="${pageW - margin - 75},${margin + 2},mm" size="70,${headerH - 4},mm" frame="false" halign="2" visibility="1" zIndex="2" labelText="${this.escapeXml(metaLines.join("\n"))}">
    <FontDescription style="Regular" description="Helvetica,8,-1,5,50,0,0,0,0,0"/>
    <FontColor alpha="255" red="71" blue="105" green="85"/>
  </LayoutItem>

  ${this.state.showLegend !== false ? `
  <!-- Légende -->
  <LayoutItem id="Legende" type="65642" position="${legendX},${legendY},mm" size="${isLandscape ? sideW : 70},${legendH},mm" frame="true" outlineWidthM="0.3,mm" visibility="1" zIndex="2" title="LÉGENDE">
    <TitleFont style="Bold" description="Helvetica,8,-1,5,75,0,0,0,0,0"/>
  </LayoutItem>` : ""}

  ${this.state.showScale !== false ? `
  <!-- Barre d'échelle -->
  <LayoutItem id="Echelle" type="65646" position="${scaleX},${scaleY},mm" size="${isLandscape ? sideW : (compassSize + 10)},14,mm" frame="false" visibility="1" zIndex="2" unitLabel="m" numUnitsPerSegment="100" segmentMillimeters="20" numSegments="2" numSegmentsLeft="0" numMapUnitsPerScaleBarUnit="1">
  </LayoutItem>` : ""}

  ${this.state.showCompass !== false ? `
  <!-- Flèche Nord (Rose des vents) standard QGIS -->
  <LayoutItem id="RoseDesVents" type="65640" position="${compassX},${compassY},mm" size="${compassSize},${compassSize},mm" northMode="1" pictureRotation="0" frame="false" visibility="1" zIndex="2" file="arrows/NorthArrow_04.svg" picturePath="arrows/NorthArrow_04.svg" resizeMode="0" anchorPoint="4">
  </LayoutItem>` : ""}

  ${(this.state.showNotes !== false && this.state.notes) ? `
  <!-- Notes de terrain -->
  <LayoutItem id="Notes" type="65641" position="${notesX},${notesY},mm" size="${isLandscape ? sideW : (pageW - margin - notesX)},${notesH},mm" frame="true" outlineWidthM="0.3,mm" visibility="1" zIndex="2" labelText="${this.escapeXml(this.state.notes)}">
    <FontDescription style="Regular" description="Helvetica,7,-1,5,50,0,0,0,0,0"/>
    <FontColor alpha="255" red="71" blue="105" green="85"/>
  </LayoutItem>` : ""}

  <customproperties>
    <property key="plandeferme_app" value="PlanDeFerme"/>
    <property key="plandeferme_version" value="1.0"/>
    <property key="plandeferme_state" value="${serializedState}"/>
  </customproperties>
</Layout>`;

      const blob = new Blob([qptXml], { type: "application/x-qgis-project" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = (this.state.title || "plan-de-ferme").toLowerCase().replace(/[^a-z0-9]/g, "-");
      a.download = `plan-de-ferme-${slug}.qpt`;
      a.click();
      URL.revokeObjectURL(url);
    }

    /**
     * Importe fidèlement un fichier de composition QGIS Print Layout (.qpt / XML)
     * Système d'analyse universel inspiré du plugin Layout-Composer (Defani) :
     * lecture de la rose des vents (northMode / svg), labels par ID/position, échelle, légende, dimensions précises en mm.
     */
    importQptTemplate(xmlContent, fileName) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
        if (xmlDoc.querySelector("parsererror")) {
          throw new Error("Le fichier XML n'est pas valide ou est corrompu.");
        }

        const root = xmlDoc.querySelector("Layout") || xmlDoc.querySelector("Composer") || xmlDoc.documentElement;
        if (!root) {
          throw new Error("Aucun élément <Layout> ou <Composer> trouvé dans le gabarit QGIS.");
        }

        // Unités et helper de mesure inspiré de Layout-Composer (Defani)
        const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, pt: 25.4 / 72, pica: 25.4 / 6, px: 25.4 / 96 };
        const qMeasure = (s) => {
          if (!s) return [0, 0];
          const [a, b, u = "mm"] = String(s).split(",");
          const k = UNIT_MM[u] || 1;
          return [Number(a) * k, Number(b) * k];
        };

        // 1. Détection de l'orientation et des dimensions de la page
        let orientation = "landscape";
        let pageW = 279.4;
        let pageH = 215.9;
        const pageItem = xmlDoc.querySelector('LayoutItem[type="65638"]') || xmlDoc.querySelector("Page") || xmlDoc.querySelector("Composition");
        if (pageItem) {
          const [pw, ph] = qMeasure(pageItem.getAttribute("size"));
          const attrW = parseFloat(pageItem.getAttribute("pageWidth") || pageItem.getAttribute("width") || "0");
          const attrH = parseFloat(pageItem.getAttribute("pageHeight") || pageItem.getAttribute("height") || "0");
          if (pw > 0 && ph > 0) {
            pageW = pw;
            pageH = ph;
          } else if (attrW > 0 && attrH > 0) {
            pageW = attrW;
            pageH = attrH;
          }
          if (pageH > pageW) orientation = "portrait";
          else orientation = "landscape";
        }

        // 2. Scan de tous les LayoutItems
        const items = Array.from(xmlDoc.querySelectorAll("LayoutItem, ComposerMap, ComposerLabel, ComposerPicture, ComposerLegend, ComposerScaleBar, ComposerShape, NorthArrow"));

        let hasMap = false;
        let hasLegend = false;
        let hasScale = false;
        let hasCompass = false;
        let hasProfile = false;
        let hasNotes = false;
        let logoUrl = null;

        let detectedHeaderH = null;
        let detectedSideW = null;
        let detectedCompassSize = null;
        let detectedProfileH = null;

        // Stockage des labels pour extraction fine
        const labels = [];

        items.forEach(item => {
          const type = Number(item.getAttribute("type") || 0);
          const tagName = item.tagName.toLowerCase();
          const id = (item.getAttribute("id") || "").trim();
          const [x, y] = qMeasure(item.getAttribute("position") || item.getAttribute("positionOnPage"));
          const [w, h] = qMeasure(item.getAttribute("size"));
          const file = item.getAttribute("file") || item.getAttribute("picturePath") || "";

          // A. Carte
          if (type === 65639 || tagName === "composermap" || /carte|map/i.test(id)) {
            hasMap = true;
          }

          // B. Rose des vents / North Arrow
          const isNorthMode = item.getAttribute("northMode") === "1";
          const isNorthPath = /north|arrow|compass|boussole|rose/i.test(file);
          const isNorthId = /north|arrow|compass|boussole|rose/i.test(id);
          const isNorthTag = tagName === "northarrow" || type === 65644;
          if (isNorthMode || isNorthPath || isNorthId || isNorthTag) {
            hasCompass = true;
            if (w > 10 && w < 80) {
              detectedCompassSize = Math.round(w);
            }
            return;
          }

          // C. Image / Logo / Profil
          if (type === 65640 || tagName === "composerpicture") {
            if (/profil|coupe|elevation|chart/i.test(id)) {
              hasProfile = true;
              if (h >= 15 && h <= 100) detectedProfileH = Math.round(h);
            } else if (/logo/i.test(id) || (!isNorthMode && !isNorthPath && (file.startsWith("data:") || file.startsWith("base64:") || file.startsWith("http")))) {
              if (file.startsWith("base64:")) {
                const b64 = file.slice(7);
                const isSvg = /^PD94|^PHN2/.test(b64);
                logoUrl = `data:${isSvg ? "image/svg+xml" : "image/png"};base64,${b64}`;
              } else if (file) {
                logoUrl = file;
              }
            }
            return;
          }

          // D. Légende
          if (type === 65642 || tagName === "composerlegend" || /legende|legend/i.test(id)) {
            hasLegend = true;
            if (orientation === "landscape" && w >= 35 && w <= 120) {
              detectedSideW = Math.round(w);
            }
            return;
          }

          // E. Échelle
          if (type === 65646 || tagName === "composerscalebar" || /echelle|scale/i.test(id)) {
            hasScale = true;
            return;
          }

          // F. Formes / Cadres (ex: Cartouche fond)
          if (type === 65643 || tagName === "composershape") {
            if (/cartouche|header|en-tete/i.test(id) || (y < 20 && h >= 14 && h <= 60)) {
              detectedHeaderH = Math.round(h);
            }
            return;
          }

          // G. Labels / Textes
          if (type === 65641 || tagName === "composerlabel") {
            let text = item.getAttribute("labelText") || "";
            if (!text) {
              const textNode = item.querySelector("labelText, LabelText");
              if (textNode) text = textNode.textContent;
              else text = item.textContent || "";
            }
            text = this.unescapeXml(text).trim();

            // Ne pas traiter les expressions internes [% ... %] vides
            if (text.startsWith("[%") && text.endsWith("%]") && !text.includes("format_date")) {
              return;
            }

            // Détection du cartouche si c'est un rectangle avec fond
            if (/cartouche|header|en-tete/i.test(id) && h >= 14 && h <= 60) {
              detectedHeaderH = Math.round(h);
            }

            // Récupération de la taille de police si présente
            let fontSize = 10;
            const fontDesc = item.querySelector("FontDescription, LabelFont");
            if (fontDesc) {
              const desc = fontDesc.getAttribute("description") || "";
              const parts = desc.split(",");
              if (parts[1] && parseFloat(parts[1]) > 0) fontSize = parseFloat(parts[1]);
            }
            const textStyle = item.querySelector("text_style");
            if (textStyle) {
              const sz = parseFloat(textStyle.getAttribute("fontSize"));
              if (sz > 0) fontSize = sz;
            }

            labels.push({ id, text, x, y, w, h, fontSize });
          }
        });

        // 3. Extraction intelligente des textes (Titre, Sous-titre, Métadonnées, Notes)
        let title = "";
        let subtitle = "";
        let notes = "";
        let location = "";
        let author = "";

        const unassignedLabels = [];

        labels.forEach(lbl => {
          const lowerId = lbl.id.toLowerCase();
          if (/^titre$|^title$/i.test(lowerId)) {
            title = lbl.text;
          } else if (/^soustitre$|^subtitle$|^sous-titre$/i.test(lowerId)) {
            subtitle = lbl.text;
          } else if (/^metadonnees$|^metadata$|^meta$/i.test(lowerId)) {
            // Parser les métadonnées ligne par ligne
            const lines = this.unescapeXml(lbl.text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
            lines.forEach(l => {
              const trimmed = l.trim();
              if (/^lieu\s*:/i.test(trimmed)) location = trimmed.replace(/^lieu\s*:\s*/i, "").trim();
              else if (/^auteur\s*:/i.test(trimmed)) author = trimmed.replace(/^auteur\s*:\s*/i, "").trim();
              else if (/^location\s*:/i.test(trimmed)) location = trimmed.replace(/^location\s*:\s*/i, "").trim();
              else if (/^author\s*:/i.test(trimmed)) author = trimmed.replace(/^author\s*:\s*/i, "").trim();
            });
          } else if (/^notes?$|^observations?$/i.test(lowerId)) {
            notes = lbl.text;
            hasNotes = true;
          } else {
            unassignedLabels.push(lbl);
          }
        });

        // Fallback si certains labels n'avaient pas d'identifiant explicite
        if (!title || !subtitle || !notes) {
          // Trier les labels restants par position Y (haut vers bas), puis par taille de police décroissante
          unassignedLabels.sort((a, b) => {
            if (Math.abs(a.y - b.y) > 8) return a.y - b.y;
            return b.fontSize - a.fontSize;
          });

          for (const lbl of unassignedLabels) {
            // Ignorer les petits textes techniques
            if (lbl.text.length < 2) continue;

            const cleanText = this.unescapeXml(lbl.text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

            // Vérifier s'il contient des métadonnées
            if (!location && (/lieu\s*:/i.test(cleanText) || /location\s*:/i.test(cleanText))) {
              const m = cleanText.match(/(?:lieu|location)\s*:\s*([^\n\r]+)/i);
              if (m) location = m[1].trim();
            }
            if (!author && (/auteur\s*:/i.test(cleanText) || /author\s*:/i.test(cleanText))) {
              const m = cleanText.match(/(?:auteur|author)\s*:\s*([^\n\r]+)/i);
              if (m) author = m[1].trim();
            }

            // Titre : premier texte près du haut avec grande police
            if (!title && lbl.y < 45 && lbl.fontSize >= 11) {
              title = lbl.text;
              continue;
            }

            // Sous-titre : juste sous le titre avec police moyenne
            if (!subtitle && lbl.y < 55 && lbl.fontSize >= 8 && lbl.fontSize < 14 && lbl.text !== title) {
              subtitle = lbl.text;
              continue;
            }

            // Notes : texte plus bas ou multilignes
            if (!notes && (lbl.y > 60 || lbl.text.includes("\n") || lbl.text.length > 50)) {
              notes = lbl.text;
              hasNotes = true;
              continue;
            }
          }
        }

        // Si des notes ont été trouvées
        if (notes) hasNotes = true;

        // 4. Dimensions du gabarit
        const layout = {
          margin: 10,
          headerH: detectedHeaderH || 22,
          sideW: detectedSideW || 60,
          compassSize: detectedCompassSize || 24,
          profileH: detectedProfileH || 46
        };

        const baseName = fileName ? fileName.replace(/\.qpt$/i, "").replace(/\.xml$/i, "") : "Modèle QGIS";

        // 5. Fusion avec état PlanDeFerme existant si disponible
        let customState = {};
        const customProp = xmlDoc.querySelector('customproperties property[key="plandeferme_state"]');
        if (customProp && customProp.getAttribute("value")) {
          try {
            const rawJson = decodeURIComponent(customProp.getAttribute("value"));
            customState = JSON.parse(rawJson) || {};
          } catch (e) {
            console.warn("[Composer] Erreur lecture métadonnées JSON:", e);
          }
        }

        const templateId = "user_qpt_" + Date.now();
        const newTemplate = {
          ...customState,
          id: templateId,
          name: `QGIS - ${baseName}`,
          format: "letter",
          orientation,
          title: title || customState.title || baseName,
          subtitle: subtitle || customState.subtitle || "Modèle importé de QGIS",
          author: author || customState.author || "",
          location: location || customState.location || "",
          notes: notes || customState.notes || "",
          showCompass: hasCompass !== false,
          showScale: hasScale !== false,
          showLegend: hasLegend !== false,
          showNotes: hasNotes !== false && !!(notes || customState.notes),
          showProfile: hasProfile || !!customState.showProfile,
          logoUrl: logoUrl || customState.logoUrl || null,
          excludedLegendIds: customState.excludedLegendIds || [],
          layout: {
            ...layout,
            ...(customState.layout || {})
          }
        };

        // Si nous avons détecté des dimensions précises dans le XML, elles prévalent sur le cache
        if (detectedHeaderH) newTemplate.layout.headerH = detectedHeaderH;
        if (detectedSideW) newTemplate.layout.sideW = detectedSideW;
        if (detectedCompassSize) newTemplate.layout.compassSize = detectedCompassSize;
        if (detectedProfileH) newTemplate.layout.profileH = detectedProfileH;

        this.userTemplates[templateId.replace("user_", "")] = newTemplate;
        this.saveUserTemplates();
        this.populateTemplateSelect();
        this.dom.templateSelect.value = templateId;
        this.loadState(newTemplate);

        alert(`Gabarit QGIS importé fidèlement !\n\nNom : ${newTemplate.name}\nOrientation : ${orientation === "portrait" ? "Portrait" : "Paysage"}\nDimensions : En-tête ${newTemplate.layout.headerH} mm, Panneau ${newTemplate.layout.sideW} mm, Boussole ${newTemplate.layout.compassSize} mm\nÉléments : ${newTemplate.showLegend ? "Légende, " : ""}${newTemplate.showScale ? "Échelle, " : ""}${newTemplate.showCompass ? "Rose des vents, " : ""}${newTemplate.showNotes ? "Notes" : ""}`);
      } catch (err) {
        console.error("[Composer] Erreur import .qpt:", err);
        alert("Impossible d'importer le fichier .qpt : " + err.message);
      }
    }

    /**
     * Recadre le snapshot de la carte selon le ratio d'aspect exact du cadre de la feuille
     * pour éviter toute distorsion ou écrasement (horizontal/vertical) à l'export PDF.
     */
    cropMapSnapshot(targetAspect) {
      if (!this.rawMapCanvas) return null;
      const srcW = this.rawMapCanvas.width;
      const srcH = this.rawMapCanvas.height;
      const srcAspect = srcW / srcH;

      let cropW = srcW;
      let cropH = srcH;
      let cropX = 0;
      let cropY = 0;

      if (srcAspect > targetAspect) {
        // Source plus large que le cadre cible : on rogne les côtés gauche et droit
        cropW = srcH * targetAspect;
        cropX = (srcW - cropW) / 2;
      } else {
        // Source plus haute : on rogne le haut et le bas
        cropH = srcW / targetAspect;
        cropY = (srcH - cropH) / 2;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cropW);
      canvas.height = Math.round(cropH);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        this.rawMapCanvas,
        cropX, cropY, cropW, cropH,
        0, 0, canvas.width, canvas.height
      );

      this.croppedVisibleWidthPx = cropW;
      return canvas.toDataURL("image/png");
    }

    /**
     * Recalcule l'image recadrée selon l'orientation courante (Paysage ou Portrait)
     * et les dimensions personnalisées réelles (mm) pour une fidélité d'affichage 100% exacte.
     */
    updateMapSnapshotForOrientation() {
      if (!this.rawMapCanvas) return;
      const isLandscape = this.state.orientation === "landscape";
      const hasProfile = !!this.state.showProfile;
      const layout = { ...DEFAULT_LAYOUT, ...(this.state.layout || {}) };
      const pageW = isLandscape ? 279.4 : 215.9;
      const pageH = isLandscape ? 215.9 : 279.4;
      const margin = layout.margin || 10;
      const headerH = layout.headerH || 22;
      const sideW = layout.sideW || 60;
      const profileH = hasProfile ? (layout.profileH || 46) : 0;
      const mapTopY = margin + headerH + 3;

      let mapW, mapH;
      if (isLandscape) {
        mapW = pageW - margin * 2 - sideW - 4;
        mapH = hasProfile ? (pageH - mapTopY - margin - profileH - 6) : (pageH - mapTopY - margin - 6);
      } else {
        mapW = pageW - margin * 2;
        const bottomH = 55;
        const availableH = pageH - mapTopY - bottomH - margin - 6;
        mapH = hasProfile ? Math.max(80, availableH - profileH - 3) : Math.max(120, availableH);
      }

      const targetAspect = mapW / Math.max(30, mapH);
      this.mapSnapshotDataUrl = this.cropMapSnapshot(targetAspect);
      if (this.dom && this.dom.sheetMapImg) {
        this.dom.sheetMapImg.src = this.mapSnapshotDataUrl || "";
      }
    }

    /**
     * Basculer l'orientation
     */
    setOrientation(orientation) {
      this.state.orientation = orientation;
      if (orientation === "portrait") {
        this.dom.btnOrientPortrait.classList.add("active");
        this.dom.btnOrientLandscape.classList.remove("active");
        this.dom.sheet.classList.remove("landscape");
        this.dom.sheet.classList.add("portrait");
      } else {
        this.dom.btnOrientLandscape.classList.add("active");
        this.dom.btnOrientPortrait.classList.remove("active");
        this.dom.sheet.classList.remove("portrait");
        this.dom.sheet.classList.add("landscape");
      }
      this.applyLayoutDimensions();
      this.updateMapSnapshotForOrientation();
      this.updateScale();

      // Recalcule du cadrage pour que la feuille entière soit immédiatement visible
      if (this.zoomMode === "fit") {
        this.fitSheetToViewport();
      } else {
        this.applyScale(this.currentScale, false);
      }
      if (this.dom.previewViewport) {
        this.dom.previewViewport.scrollTop = 0;
      }
    }

    /**
     * Appliquer un gabarit
     */
    applyTemplate(templateId) {
      let tmpl = null;
      if (templateId.startsWith("user_")) {
        const id = templateId.replace("user_", "");
        tmpl = this.userTemplates[id];
      } else {
        tmpl = DEFAULT_TEMPLATES[templateId];
      }

      if (tmpl) {
        this.loadState(tmpl);
      }
    }

    /**
     * Charger un état de configuration dans le formulaire et la feuille
     */
    loadState(state) {
      this.state = {
        ...this.state,
        ...state,
        layout: {
          ...DEFAULT_LAYOUT,
          ...(this.state.layout || {}),
          ...(state.layout || {})
        }
      };

      // Appliquer les dimensions sur la feuille
      this.applyLayoutDimensions();

      // Orientation
      this.setOrientation(this.state.orientation || "landscape");

      // Textes inputs
      this.dom.inputTitle.value = this.state.title || "";
      this.dom.inputSubtitle.value = this.state.subtitle || "";
      this.dom.inputLocation.value = this.state.location || "";
      this.dom.inputAuthor.value = this.state.author || "";
      this.dom.inputNotes.value = this.state.notes || "";

      // Textes sheet
      this.dom.sheetTitle.textContent = this.state.title || "Plan de ferme";
      this.dom.sheetSubtitle.textContent = this.state.subtitle || "";
      this.dom.sheetMetaLocation.textContent = this.state.location || "";
      this.dom.sheetMetaLocationRow.style.display = this.state.location ? "block" : "none";
      this.dom.sheetMetaAuthor.textContent = this.state.author || "";
      this.dom.sheetMetaAuthorRow.style.display = this.state.author ? "block" : "none";
      this.dom.sheetNotesText.textContent = this.state.notes || "";

      // Checkboxes
      this.dom.checkCompass.checked = this.state.showCompass !== false;
      this.dom.checkScale.checked = this.state.showScale !== false;
      this.dom.checkLegend.checked = this.state.showLegend !== false;
      this.dom.checkNotes.checked = this.state.showNotes !== false;
      if (this.dom.checkProfile) {
        this.dom.checkProfile.checked = !!this.state.showProfile;
      }

      this.dom.sheetCompassWrap.style.display = this.dom.checkCompass.checked ? "flex" : "none";
      this.dom.sheetScaleWrap.style.display = this.dom.checkScale.checked ? "flex" : "none";
      this.updateNavBlockVisibility();
      this.dom.sheetLegendBlock.style.display = this.dom.checkLegend.checked ? "flex" : "none";
      this.dom.sheetNotesBlock.style.display = this.dom.checkNotes.checked ? "flex" : "none";
      this.updateProfileBlockVisibility();

      // Logo
      this.updateLogoDisplay();
    }

    /**
     * Calcul de l'échelle cartographique réelle
     */
    updateScale() {
      if (!this.map) return;
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();
      const latRad = (center.lat * Math.PI) / 180;

      // Résolution au sol en mètres par pixel Web Mercator
      const metersPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
      const visibleWidthPx = this.croppedVisibleWidthPx || (this.map.getCanvas() ? this.map.getCanvas().width : 1000);
      const groundWidthMeters = visibleWidthPx * metersPerPixel;

      // Largeur du cadre sur la feuille imprimée (en mm)
      const isLandscape = this.state.orientation === "landscape";
      const layout = { ...DEFAULT_LAYOUT, ...(this.state.layout || {}) };
      const margin = layout.margin || 10;
      const sideW = layout.sideW || 60;
      const sheetMapWidthMm = isLandscape ? (279.4 - margin * 2 - sideW - 4) : (215.9 - margin * 2);

      let rawScale = (groundWidthMeters * 1000) / sheetMapWidthMm;
      if (!isFinite(rawScale) || rawScale <= 0) rawScale = 5000;

      // Choix d'une distance ronde pour la barre
      const candidateDists = [10, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
      const targetBarMeters = (30 * rawScale) / 1000;
      let barMeters = candidateDists[0];
      for (const d of candidateDists) {
        if (Math.abs(d - targetBarMeters) < Math.abs(barMeters - targetBarMeters)) {
          barMeters = d;
        }
      }

      const roundedRatio = Math.round(rawScale / 100) * 100;
      const ratioStr = `Échelle 1 : ${roundedRatio.toLocaleString("fr-CA")}`;

      const formatDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`);
      const midDist = barMeters / 2;

      this.dom.sheetScaleMid.textContent = formatDist(midDist);
      this.dom.sheetScaleMax.textContent = formatDist(barMeters);
      this.dom.sheetScaleRatio.textContent = ratioStr;

      this.scaleInfo = {
        rawScale,
        roundedRatio,
        ratioStr,
        barMeters,
        barWidthMm: (barMeters * 1000) / rawScale,
        formatDist
      };
    }

    /**
     * Détecte les couches actives et peuple la légende avec symbologie informative
     * et gestion de l'exclusion / personnalisation des éléments.
     */
    updateActiveLegend() {
      const container = this.dom.sheetLegendItems;
      if (!container) return;
      container.innerHTML = "";

      const items = [];

      // 1. Fond de carte
      const btnSat = document.getElementById("btn-basemap-sat");
      const isSat = btnSat && btnSat.classList.contains("active");
      items.push({
        id: "basemap",
        groupId: "basemap",
        type: "swatch",
        label: isSat ? "Fond : Satellite (Google Hybride)" : "Fond : Plan OpenFreeMap",
        color: isSat ? "#065f46" : "#cbd5e1"
      });

      // 2. Topographie & Relief MNE (LiDAR 1 m)
      const toggleTopo = document.getElementById("toggle-topo");
      if (toggleTopo && toggleTopo.checked) {
        const altBadge = document.getElementById("topo-alt-badge");
        let minText = "30 m";
        let midText = "75 m";
        let maxText = "120 m";
        if (altBadge && altBadge.textContent && altBadge.textContent.includes("→")) {
          const match = altBadge.textContent.match(/([\d.,]+)\s*m[^→]+→\s*([\d.,]+)\s*m/);
          if (match) {
            const minVal = parseFloat(match[1].replace(",", "."));
            const maxVal = parseFloat(match[2].replace(",", "."));
            minText = Math.round(minVal) + " m";
            maxText = Math.round(maxVal) + " m";
            midText = Math.round((minVal + maxVal) / 2) + " m";
          }
        }

        items.push({
          id: "hdr_topo",
          groupId: "topo",
          isHeader: true,
          label: "Relief & Topographie (LiDAR 1 m)"
        });

        items.push({
          id: "topo_mne",
          groupId: "topo",
          type: "gradient",
          gradient: true,
          label: "Relief altimétrique MNE",
          minText,
          midText,
          maxText,
          color: "#7c3aed"
        });

        const toggleHillshade = document.getElementById("toggle-topo-hillshade");
        if (toggleHillshade && toggleHillshade.checked) {
          items.push({
            id: "topo_hillshade",
            groupId: "topo",
            type: "swatch",
            label: "Ombrage multidirectionnel du relief (QGIS)",
            color: "#64748b"
          });
        }
      }

      // 3. Courbes de niveau
      const toggleContours = document.getElementById("toggle-contours") || document.getElementById("toggle-contour");
      if (toggleContours && toggleContours.checked) {
        const activePill = document.querySelector(".pills-group .pill-btn.active") || document.querySelector(".seg-btn.active");
        const intervalText = activePill ? activePill.textContent.trim() : "1 m";
        items.push({
          id: "contours",
          groupId: "topo",
          type: "line",
          line: true,
          label: `Courbes de niveau MNT (${intervalText})`,
          color: "#d97706"
        });
      }

      // 4. Milieux humides (MELCCFP / CIC)
      let hasWetlands = false;
      const checkWetlandId = (id) => {
        const s = (id || "").toLowerCase();
        return s.includes("humide") || s.includes("wetland") || s.includes("marais") || s.includes("tourbiere");
      };

      if (this.wmsManager && this.wmsManager.activeLayerIds) {
        hasWetlands = Array.from(this.wmsManager.activeLayerIds).some(checkWetlandId);
      }
      if (!hasWetlands && window.wmsManager && window.wmsManager.activeLayerIds) {
        hasWetlands = Array.from(window.wmsManager.activeLayerIds).some(checkWetlandId);
      }

      if (hasWetlands) {
        items.push({
          id: "hdr_wetlands",
          groupId: "wetlands",
          isHeader: true,
          label: "Milieux humides (MELCCFP / CIC)"
        });
        items.push({
          id: "wetlands_marsh",
          groupId: "wetlands",
          type: "swatch",
          label: "Marais (végétation herbacée)",
          color: "#10b981"
        });
        items.push({
          id: "wetlands_swamp",
          groupId: "wetlands",
          type: "swatch",
          label: "Marécage (arborescent / arbustif)",
          color: "#059669"
        });
        items.push({
          id: "wetlands_peat",
          groupId: "wetlands",
          type: "swatch",
          label: "Tourbière (sphaigne / dépôts)",
          color: "#b45309"
        });
        items.push({
          id: "wetlands_water",
          groupId: "wetlands",
          type: "swatch",
          label: "Plan d'eau peu profond",
          color: "#0284c7"
        });
      }

      // 5. Indice d'humidité du sol / TWI (Topographic Wetness Index)
      let hasTwi = false;
      const checkTwiId = (id) => {
        const s = (id || "").toLowerCase();
        return s.includes("twi") || s.includes("humidite");
      };
      if (this.wmsManager && this.wmsManager.activeLayerIds) {
        hasTwi = Array.from(this.wmsManager.activeLayerIds).some(checkTwiId);
      }
      if (!hasTwi && window.wmsManager && window.wmsManager.activeLayerIds) {
        hasTwi = Array.from(window.wmsManager.activeLayerIds).some(checkTwiId);
      }
      if (hasTwi) {
        items.push({
          id: "hdr_twi",
          groupId: "twi",
          isHeader: true,
          label: "Humidité du sol (TWI LiDAR)"
        });
        items.push({
          id: "twi_high",
          groupId: "twi",
          type: "swatch",
          label: "Accumulation / Bas-fond (> 9)",
          color: "#0369a1"
        });
        items.push({
          id: "twi_med",
          groupId: "twi",
          type: "swatch",
          label: "Humidité modérée (6 – 9)",
          color: "#38bdf8"
        });
        items.push({
          id: "twi_low",
          groupId: "twi",
          type: "swatch",
          label: "Évacuation en crête (< 6)",
          color: "#bae6fd"
        });
      }

      // 6. Carte des pentes (%)
      const togglePentes = document.getElementById("toggle-pentes");
      if (togglePentes && togglePentes.checked) {
        items.push({
          id: "hdr_pentes",
          groupId: "pentes",
          isHeader: true,
          label: "Pentes du terrain (%)"
        });
        items.push(
          { id: "pente_0", groupId: "pentes", type: "swatch", label: "0 – 0,3 % (Stagnation)", color: "#0284c7" },
          { id: "pente_1", groupId: "pentes", type: "swatch", label: "0,3 – 1 % (Très faible)", color: "#22c55e" },
          { id: "pente_2", groupId: "pentes", type: "swatch", label: "1 – 3 % (Faible)", color: "#84cc16" },
          { id: "pente_3", groupId: "pentes", type: "swatch", label: "3 – 10 % (Modérée)", color: "#eab308" },
          { id: "pente_4", groupId: "pentes", type: "swatch", label: "10 – 30 % (Forte)", color: "#ea580c" },
          { id: "pente_5", groupId: "pentes", type: "swatch", label: "> 30 % (Talus / Escarp.)", color: "#b91c1c" }
        );
      }

      // 7. Écoulement & Dépressions
      const toggleHydro = document.getElementById("toggle-hydro-parcelle");
      if (toggleHydro && toggleHydro.checked) {
        items.push({
          id: "hydro_arrows",
          groupId: "hydro",
          type: "swatch",
          label: "Flèches de ruissellement",
          color: "#0284c7"
        });
        items.push({
          id: "hydro_depr",
          groupId: "hydro",
          type: "swatch",
          label: "Dépressions / zones plates (<0,1%)",
          color: "rgba(2,132,199,0.85)"
        });
      }

      // 8. Hauteur de canopée (LiDAR 1 m)
      const toggleCanopee = document.getElementById("toggle-canopee");
      if (toggleCanopee && toggleCanopee.checked) {
        items.push({
          id: "hdr_canopee",
          groupId: "canopee",
          isHeader: true,
          label: "Hauteur de canopée LiDAR"
        });
        items.push(
          { id: "canopee_1", groupId: "canopee", type: "swatch", label: "0,5 – 5 m (Régénération)", color: "#22c55e" },
          { id: "canopee_2", groupId: "canopee", type: "swatch", label: "5 – 12 m (Jeune peuplement)", color: "#16a34a" },
          { id: "canopee_3", groupId: "canopee", type: "swatch", label: "12 – 20 m (Peuplement mature)", color: "#15803d" },
          { id: "canopee_4", groupId: "canopee", type: "swatch", label: "> 20 m (Haute canopée)", color: "#064e3b" }
        );
      }

      // 9. Sols (Pédologie)
      const togglePedo = document.getElementById("toggle-pedo");
      if (togglePedo && togglePedo.checked) {
        items.push({
          id: "pedo",
          groupId: "pedo",
          type: "swatch",
          label: "Séries de sols de surface (IRDA)",
          color: "#a16207"
        });
      }

      // 10. Parcelles BDPPAD
      const toggleParcelles = document.getElementById("toggle-parcelles");
      if (toggleParcelles && toggleParcelles.checked) {
        items.push({
          id: "parcelles",
          groupId: "parcelles",
          type: "swatch",
          label: "Parcelles agricoles (BDPPAD)",
          color: "#000000"
        });
      }

      // 11. Cadastre du Québec (Lots rénovés)
      const isCadastreActive = (this.wmsManager && this.wmsManager.isCadastreActive) || (window.wmsManager && window.wmsManager.isCadastreActive);
      if (isCadastreActive) {
        items.push({
          id: "cadastre_quebec",
          groupId: "cadastre",
          type: "line",
          line: true,
          label: "Cadastre du Québec (Lots rénovés)",
          color: "#9333ea"
        });
      }

      // 12. Autres couches WMS actives
      const activeWmsIds = (this.wmsManager && this.wmsManager.activeLayerIds) || (window.wmsManager && window.wmsManager.activeLayerIds) || [];
      activeWmsIds.forEach(id => {
        if (id === "cadastre_quebec" || checkWetlandId(id) || checkTwiId(id)) return;
        const cfg = (this.wmsManager && this.wmsManager.registry && this.wmsManager.registry.get(id))
          || (window.wmsManager && window.wmsManager.registry && window.wmsManager.registry.get(id))
          || null;
        items.push({
          id: "wms_" + id,
          groupId: "wms",
          type: "swatch",
          label: (cfg && (cfg.name || cfg.title)) || id,
          color: id.includes("eau") ? "#0284c7" : id.includes("foret") ? "#15803d" : "#64748b"
        });
      });

      // 13. Couches vectorielles personnalisées (Plan de Ferme / GeoLibre)
      if (window.vectorManager && window.vectorManager.layers) {
        const visibleVectorLayers = window.vectorManager.layers.filter(l => l.visible);
        if (visibleVectorLayers.length > 0) {
          items.push({
            id: "hdr_vectors",
            groupId: "vectors",
            isHeader: true,
            label: "Couche personnelle"
          });
          visibleVectorLayers.forEach(vl => {
            const isLine = vl.geometryType === "LineString";
            const color = vl.style.fillColor || vl.style.strokeColor || "#16a34a";
            items.push({
              id: "vec_" + vl.id,
              groupId: "vectors",
              type: isLine ? "line" : "swatch",
              line: isLine,
              label: vl.name || "Couche vectorielle",
              color: color
            });
          });
        }
      }

      this.allDetectedLegendItems = items;

      // Filtrage des éléments exclus par l'utilisateur
      const excluded = new Set(this.state.excludedLegendIds || []);
      const visibleNonHeaders = items.filter(it => !it.isHeader && !excluded.has(it.id));
      const visibleGroupIds = new Set(visibleNonHeaders.map(it => it.groupId));

      // Les en-têtes ne sont conservés que si leur groupe a au moins un élément visible
      const visibleItems = items.filter(it => {
        if (excluded.has(it.id)) return false;
        if (it.isHeader) {
          return visibleGroupIds.has(it.groupId);
        }
        return true;
      });

      this.currentLegendItems = visibleItems;

      // Rendu dans le DOM de la feuille (WYSIWYG)
      if (visibleItems.length === 0) {
        container.innerHTML = `<div style="font-size:7.5px; color:#94a3b8; font-style:italic; padding:4px 0;">Aucun élément affiché</div>`;
      } else {
        visibleItems.forEach(it => {
          if (it.isHeader) {
            const hdr = document.createElement("div");
            hdr.className = "sheet-legend-group-header";
            hdr.textContent = it.label;
            container.appendChild(hdr);
            return;
          }

          const div = document.createElement("div");
          div.className = "sheet-legend-item";
          div.dataset.id = it.id;

          let leftHtml = "";
          if (it.type === "gradient" || it.gradient) {
            leftHtml = `
              <div class="sheet-legend-gradient-block">
                <div style="font-weight:600; font-size:7.5px; color:#1e293b;">${it.label}</div>
                <div class="sheet-legend-gradient-bar"></div>
                <div class="sheet-legend-gradient-labels">
                  <span>${it.minText || "Bas"}</span>
                  <span>${it.midText || "Moyen"}</span>
                  <span>${it.maxText || "Haut"}</span>
                </div>
              </div>
            `;
          } else if (it.type === "line" || it.line) {
            leftHtml = `
              <div class="sheet-legend-item-left">
                <span class="sheet-legend-line" style="background: ${it.color};"></span>
                <span>${it.label}</span>
              </div>
            `;
          } else {
            leftHtml = `
              <div class="sheet-legend-item-left">
                <span class="sheet-legend-color" style="background: ${it.color};"></span>
                <span>${it.label}</span>
              </div>
            `;
          }

          div.innerHTML = `
            ${leftHtml}
            <button type="button" class="sheet-legend-remove-btn" title="Masquer cet élément de la légende">&times;</button>
          `;

          const removeBtn = div.querySelector(".sheet-legend-remove-btn");
          if (removeBtn) {
            removeBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.excludeLegendItem(it.id);
            });
          }

          container.appendChild(div);
        });
      }

      // Synchronisation de la liste à cocher dans le panneau latéral
      this.renderLegendChecklist();
    }

    /**
     * Rendu de la liste à cocher des éléments de légende dans la barre latérale
     */
    renderLegendChecklist() {
      const checklist = this.dom.legendChecklist;
      if (!checklist) return;
      checklist.innerHTML = "";

      const nonHeaders = (this.allDetectedLegendItems || []).filter(it => !it.isHeader);
      if (nonHeaders.length === 0) {
        checklist.innerHTML = `<span style="font-size:10.5px; color:#94a3b8; font-style:italic;">Aucune couche active détectée</span>`;
        return;
      }

      const excluded = new Set(this.state.excludedLegendIds || []);

      nonHeaders.forEach(it => {
        const labelEl = document.createElement("label");
        labelEl.className = "composer-legend-check-item";

        const isChecked = !excluded.has(it.id);
        const swatchStyle = (it.type === "gradient" || it.gradient)
          ? "background: linear-gradient(to right, #7c3aed, #0284c7, #22c55e, #eab308, #dc2626);"
          : `background: ${it.color || "#64748b"};`;

        labelEl.innerHTML = `
          <input type="checkbox" data-id="${it.id}" ${isChecked ? "checked" : ""} />
          <span class="composer-legend-check-swatch" style="${swatchStyle}"></span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${it.label}">${it.label}</span>
        `;

        const cb = labelEl.querySelector("input");
        cb.addEventListener("change", (e) => {
          if (e.target.checked) {
            this.includeLegendItem(it.id);
          } else {
            this.excludeLegendItem(it.id);
          }
        });

        checklist.appendChild(labelEl);
      });
    }

    /**
     * Exclure un élément de la légende
     */
    excludeLegendItem(id) {
      if (!this.state.excludedLegendIds) this.state.excludedLegendIds = [];
      if (!this.state.excludedLegendIds.includes(id)) {
        this.state.excludedLegendIds.push(id);
        this.updateActiveLegend();
      }
    }

    /**
     * Réinclure un élément dans la légende
     */
    includeLegendItem(id) {
      if (!this.state.excludedLegendIds) return;
      this.state.excludedLegendIds = this.state.excludedLegendIds.filter(x => x !== id);
      this.updateActiveLegend();
    }

    /**
     * Réafficher tous les éléments masqués
     */
    resetExcludedLegendItems() {
      this.state.excludedLegendIds = [];
      this.updateActiveLegend();
    }

    /**
     * Ouvrir la boîte modale de composition
     */
    open() {
      if (!this.map) return;

      // 1. Capture haute résolution du canvas MapLibre et conservation d'une copie 2D
      try {
        const canvas = this.map.getCanvas();
        const copyCanvas = document.createElement("canvas");
        copyCanvas.width = canvas.width;
        copyCanvas.height = canvas.height;
        const copyCtx = copyCanvas.getContext("2d");
        copyCtx.drawImage(canvas, 0, 0);
        this.rawMapCanvas = copyCanvas;

        this.applyLayoutDimensions();
        this.updateMapSnapshotForOrientation();
      } catch (e) {
        console.warn("[Composer] Erreur capture canvas:", e);
      }

      // 2. Date du jour en français québécois
      const now = new Date();
      const dateStr = now.toLocaleDateString("fr-CA", { year: "numeric", month: "short", day: "numeric" });
      this.dom.sheetMetaDate.textContent = dateStr;

      // 3. Rose des vents, échelle et légende
      this.renderCompass();
      this.updateScale();
      this.updateActiveLegend();

      // 4. Profil topographique MNT
      const hasProfileData = !!(window.profileManager && window.profileManager.profile && window.profileManager.profile.length >= 2);
      if (this.dom.rowCheckProfile) {
        const labelText = this.dom.rowCheckProfile.querySelector("span:last-child");
        if (labelText) {
          labelText.innerHTML = hasProfileData
            ? `Graphique de coupe topographique <span style="font-size:10px; color:#166534; font-weight:700;">(Profil actif)</span>`
            : `Graphique de coupe topographique <span style="font-size:10px; color:#64748b;">(Aucun tracé)</span>`;
        }
      }
      this.updateProfileBlockVisibility();

      // Réinitialisation de l'onglet actif sur mobile vers "Réglages"
      if (this.dom.tabSettings && this.dom.tabPreview && this.dom.composerBody) {
        this.dom.tabSettings.classList.add("active");
        this.dom.tabPreview.classList.remove("active");
        this.dom.composerBody.dataset.activeTab = "settings";
      }

      // 5. Affichage
      this.dom.overlay.classList.add("active");
      this.isOpen = true;

      // Toujours démarrer le défilement tout en haut pour que l'en-tête soit visible
      if (this.dom.previewViewport) {
        this.dom.previewViewport.scrollTop = 0;
      }

      // Ajustement dynamique de l'échelle à la taille exacte du viewport
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this.zoomMode === "fit") {
            this.fitSheetToViewport();
          } else {
            this.applyScale(this.currentScale, false);
          }
          if (this.dom.previewViewport) {
            this.dom.previewViewport.scrollTop = 0;
          }
        });
      });
    }

    /**
     * Fermer le compositeur
     */
    close() {
      this.dom.overlay.classList.remove("active");
      this.isOpen = false;
    }

    /**
     * Génération & Téléchargement du PDF avec jsPDF
     */
    async generatePdf() {
      const btn = this.dom.btnGeneratePdf;
      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.innerHTML = `<span>Génération en cours...</span>`;

      try {
        const isLandscape = this.state.orientation === "landscape";
        const orientation = isLandscape ? "landscape" : "portrait";

        // Chargement jsPDF (UMD)
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : null;
        if (!jsPDF) {
          throw new Error("Bibliothèque jsPDF introuvable.");
        }

        // Format Lettre en mm : 215.9 × 279.4 mm
        const doc = new jsPDF({
          orientation,
          unit: "mm",
          format: "letter",
          compress: true
        });

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const layout = { ...DEFAULT_LAYOUT, ...(this.state.layout || {}) };
        const margin = layout.margin || 10;
        const headerH = layout.headerH || 22;
        const sideW = layout.sideW || 60;
        const compassRadius = (layout.compassSize || 24) / 2;
        const profileH = layout.profileH || 46;

        // Synchronisation des couches actives et de la légende
        this.updateActiveLegend();

        // 1. Fond blanc
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageW, pageH, "F");

        // 2. Cartouche d'en-tête
        const headerX = margin;
        const headerY = margin;
        const headerW = pageW - (margin * 2);

        doc.setDrawColor(15, 23, 42); // Noir anthracite #0f172a
        doc.setLineWidth(0.4);
        doc.rect(headerX, headerY, headerW, headerH);

        // Logo si présent (proportions préservées)
        let textStartX = headerX + 4;
        if (this.state.logoUrl) {
          try {
            const logoImg = this.dom.sheetLogoImg;
            const naturalW = (logoImg && logoImg.naturalWidth) || 1;
            const naturalH = (logoImg && logoImg.naturalHeight) || 1;
            const maxW = 24;
            const maxH = Math.max(12, headerH - 6);
            let logoW = maxW;
            let logoH = (maxW * naturalH) / naturalW;
            if (logoH > maxH) {
              logoH = maxH;
              logoW = (maxH * naturalW) / naturalH;
            }
            const logoY = headerY + 3 + ((maxH - logoH) / 2);
            doc.addImage(this.state.logoUrl, "PNG", headerX + 3, logoY, logoW, logoH, undefined, "MEDIUM");
            textStartX = headerX + maxW + 6;
          } catch (e) {
            console.warn("[Composer] Erreur intégration logo dans le PDF:", e);
          }
        }

        // Titre
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(15, 23, 42);
        doc.text(this.state.title || "Plan de ferme", textStartX, headerY + Math.min(7.5, headerH * 0.4));

        // Sous-titre
        if (this.state.subtitle) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9.5);
          doc.setTextColor(22, 101, 52); // Vert forêt #166534
          doc.text(this.state.subtitle, textStartX, headerY + Math.min(14, headerH * 0.7));
        }

        // Métadonnées à droite dans le cartouche
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        const metaX = headerX + headerW - 4;
        const dateStr = this.dom.sheetMetaDate.textContent || "";
        doc.text(`Date : ${dateStr}`, metaX, headerY + Math.min(6, headerH * 0.35), { align: "right" });

        let curMetaY = headerY + Math.min(10.5, headerH * 0.55);
        if (this.state.location) {
          doc.text(`Lieu : ${this.state.location}`, metaX, curMetaY, { align: "right" });
          curMetaY += 4.5;
        }
        if (this.state.author) {
          doc.text(`Auteur : ${this.state.author}`, metaX, curMetaY, { align: "right" });
        }

        // 3. Cadre de carte & Panneau d'informations
        const mapTopY = headerY + headerH + 3;
        const hasProfile = !!this.state.showProfile;
        const profileData = (window.profileManager && window.profileManager.profile && window.profileManager.profile.length >= 2)
          ? window.profileManager.profile
          : null;

        if (isLandscape) {
          // Disposition PAYSAGE
          const mapW = headerW - sideW - 4;
          const fullMapH = pageH - mapTopY - margin - 6;
          const profileBoxH = hasProfile ? profileH : 0;
          const mapH = hasProfile ? (fullMapH - profileBoxH - 3) : fullMapH;

          // Image de la carte (recadrée au ratio exact du cadre pour éviter toute compression/distorsion)
          if (this.mapSnapshotDataUrl) {
            doc.addImage(this.mapSnapshotDataUrl, "PNG", headerX, mapTopY, mapW, mapH, undefined, "MEDIUM");
          }
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.4);
          doc.rect(headerX, mapTopY, mapW, mapH);

          // Profil topographique (Coupe MNT) sous la carte
          if (hasProfile) {
            const profileY = mapTopY + mapH + 3;
            this.drawVectorProfile(doc, headerX, profileY, mapW, profileBoxH, profileData);
          }

          // Panneau latéral
          const sideX = headerX + mapW + 4;
          let currentSideY = mapTopY;

          // Rose des vents & Échelle
          if (this.state.showCompass || this.state.showScale) {
            const navBlockH = (this.state.showCompass && this.state.showScale)
              ? (compassRadius * 2 + 20)
              : (this.state.showCompass || this.state.showScale ? (compassRadius * 2 + 10) : 0);
            doc.setDrawColor(203, 213, 225);
            doc.setLineWidth(0.3);
            doc.rect(sideX, currentSideY, sideW, navBlockH);

            // Rose des vents (Boussole)
            if (this.state.showCompass) {
              this.drawVectorCompass(doc, sideX + (sideW / 2), currentSideY + compassRadius + 3, compassRadius);
            }

            // Échelle
            if (this.state.showScale && this.scaleInfo) {
              const scaleY = currentSideY + (this.state.showCompass ? (compassRadius * 2 + 7.5) : 5);
              const barW = Math.min(sideW - 14, 44);
              const barStartX = sideX + (sideW - barW) / 2;

              // Segments noir / blanc alternés
              const segW = barW / 4;
              doc.setDrawColor(15, 23, 42);
              doc.setLineWidth(0.2);

              doc.setFillColor(15, 23, 42);
              doc.rect(barStartX, scaleY, segW, 2, "FD");
              doc.setFillColor(255, 255, 255);
              doc.rect(barStartX + segW, scaleY, segW, 2, "FD");
              doc.setFillColor(15, 23, 42);
              doc.rect(barStartX + segW * 2, scaleY, segW, 2, "FD");
              doc.setFillColor(255, 255, 255);
              doc.rect(barStartX + segW * 3, scaleY, segW, 2, "FD");

              // Étiquettes d'échelle
              doc.setFont("courier", "bold");
              doc.setFontSize(6.5);
              doc.setTextColor(51, 65, 85);
              doc.text("0", barStartX, scaleY + 4.5);
              doc.text(this.scaleInfo.formatDist(this.scaleInfo.barMeters / 2), barStartX + barW / 2, scaleY + 4.5, { align: "center" });
              doc.text(this.scaleInfo.formatDist(this.scaleInfo.barMeters), barStartX + barW, scaleY + 4.5, { align: "right" });

              doc.setFont("courier", "bold");
              doc.setFontSize(7);
              doc.setTextColor(15, 23, 42);
              doc.text(this.scaleInfo.ratioStr, sideX + sideW / 2, scaleY + 8.5, { align: "center" });
            }

            currentSideY += navBlockH + 3;
          }

          // Légende
          if (this.state.showLegend && this.currentLegendItems && this.currentLegendItems.length > 0) {
            let neededContentH = 9;
            for (const it of this.currentLegendItems) {
              if (it.isHeader) neededContentH += 4.2;
              else if (it.type === "gradient" || it.gradient) neededContentH += 8.5;
              else neededContentH += 3.6;
            }

            const maxAvailableH = (mapTopY + mapH) - currentSideY;
            const reservedNotesH = (this.state.showNotes && this.state.notes) ? 26 : 0;
            const maxLegendH = Math.max(25, maxAvailableH - reservedNotesH);
            const legendH = Math.min(neededContentH, maxLegendH);

            doc.setDrawColor(203, 213, 225);
            doc.setLineWidth(0.3);
            doc.setFillColor(255, 255, 255);
            doc.rect(sideX, currentSideY, sideW, legendH, "FD");

            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            doc.setTextColor(15, 23, 42);
            doc.text("LÉGENDE", sideX + 3.5, currentSideY + 5);

            this.drawPdfLegend(doc, {
              x: sideX,
              y: currentSideY,
              w: sideW,
              maxH: legendH,
              items: this.currentLegendItems,
              twoColumns: false
            });

            currentSideY += legendH + 3;
          }

          // Notes
          if (this.state.showNotes && this.state.notes) {
            const notesH = mapTopY + mapH - currentSideY;
            if (notesH > 15) {
              doc.setDrawColor(203, 213, 225);
              doc.setFillColor(248, 250, 252);
              doc.rect(sideX, currentSideY, sideW, notesH, "FD");

              doc.setFont("helvetica", "bold");
              doc.setFontSize(7.5);
              doc.setTextColor(15, 23, 42);
              doc.text("NOTES DE TERRAIN", sideX + 3, currentSideY + 5);

              doc.setFont("helvetica", "normal");
              doc.setFontSize(6.5);
              doc.setTextColor(71, 85, 105);
              const splitNotes = doc.splitTextToSize(this.state.notes, sideW - 6);
              doc.text(splitNotes, sideX + 3, currentSideY + 9);
            }
          }
        } else {
          // Disposition PORTRAIT
          const mapW = headerW;
          const profileBoxH = hasProfile ? profileH : 0;
          const bottomH = Math.max(55, compassRadius * 2 + 30);
          const availableH = pageH - mapTopY - bottomH - margin - 6;
          const mapH = hasProfile ? Math.max(80, availableH - profileBoxH - 3) : Math.max(120, availableH);

          // Image de carte (recadrée au ratio exact du cadre)
          if (this.mapSnapshotDataUrl) {
            doc.addImage(this.mapSnapshotDataUrl, "PNG", headerX, mapTopY, mapW, mapH, undefined, "MEDIUM");
          }
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.4);
          doc.rect(headerX, mapTopY, mapW, mapH);

          let nextY = mapTopY + mapH + 3;

          // Profil topographique (Coupe MNT) sous la carte
          if (hasProfile) {
            this.drawVectorProfile(doc, headerX, nextY, mapW, profileBoxH, profileData);
            nextY += profileBoxH + 3;
          }

          // Section basse
          const bottomY = nextY;
          const realBottomH = pageH - bottomY - margin - 6;

          // Colonne 1 : Rose des vents & Échelle
          const col1W = Math.max(42, compassRadius * 2 + 14);
          doc.setDrawColor(203, 213, 225);
          doc.rect(headerX, bottomY, col1W, realBottomH);

          if (this.state.showCompass) {
            this.drawVectorCompass(doc, headerX + col1W / 2, bottomY + compassRadius + 4, compassRadius);
          }

          if (this.state.showScale && this.scaleInfo) {
            const scaleY = bottomY + (this.state.showCompass ? (compassRadius * 2 + 10) : 8);
            const barW = Math.min(34, col1W - 8);
            const barStartX = headerX + (col1W - barW) / 2;
            const segW = barW / 4;

            doc.setDrawColor(15, 23, 42);
            doc.setFillColor(15, 23, 42);
            doc.rect(barStartX, scaleY, segW, 2, "FD");
            doc.setFillColor(255, 255, 255);
            doc.rect(barStartX + segW, scaleY, segW, 2, "FD");
            doc.setFillColor(15, 23, 42);
            doc.rect(barStartX + segW * 2, scaleY, segW, 2, "FD");
            doc.setFillColor(255, 255, 255);
            doc.rect(barStartX + segW * 3, scaleY, segW, 2, "FD");

            doc.setFont("courier", "bold");
            doc.setFontSize(6);
            doc.setTextColor(51, 65, 85);
            doc.text("0", barStartX, scaleY + 4.5);
            doc.text(this.scaleInfo.formatDist(this.scaleInfo.barMeters / 2), barStartX + barW / 2, scaleY + 4.5, { align: "center" });
            doc.text(this.scaleInfo.formatDist(this.scaleInfo.barMeters), barStartX + barW, scaleY + 4.5, { align: "right" });

            doc.setFont("courier", "bold");
            doc.setFontSize(6.5);
            doc.setTextColor(15, 23, 42);
            doc.text(this.scaleInfo.ratioStr, headerX + col1W / 2, scaleY + 8.5, { align: "center" });
          }

          // Colonne 2 : Légende (72 mm)
          const col2X = headerX + col1W + 3;
          const col2W = 72;
          doc.setDrawColor(203, 213, 225);
          doc.setLineWidth(0.3);
          doc.setFillColor(255, 255, 255);
          doc.rect(col2X, bottomY, col2W, realBottomH, "FD");

          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(15, 23, 42);
          doc.text("LÉGENDE", col2X + 3.5, bottomY + 5);

          if (this.state.showLegend && this.currentLegendItems && this.currentLegendItems.length > 0) {
            this.drawPdfLegend(doc, {
              x: col2X,
              y: bottomY,
              w: col2W,
              maxH: realBottomH,
              items: this.currentLegendItems,
              twoColumns: false
            });
          } else {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(6.5);
            doc.setTextColor(148, 163, 184);
            doc.text("Aucun élément affiché", col2X + 3.5, bottomY + 12);
          }

          // Colonne 3 : Notes (reste de la largeur)
          const col3X = col2X + col2W + 3;
          const col3W = headerW - col1W - col2W - 6;
          doc.setDrawColor(203, 213, 225);
          doc.setFillColor(248, 250, 252);
          doc.rect(col3X, bottomY, col3W, bottomH, "FD");

          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(15, 23, 42);
          doc.text("NOTES & OBSERVATIONS", col3X + 3, bottomY + 5);

          if (this.state.notes) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            doc.setTextColor(71, 85, 105);
            const splitNotes = doc.splitTextToSize(this.state.notes, col3W - 6);
            doc.text(splitNotes, col3X + 3, bottomY + 9.5);
          }
        }

        // 4. Pied de page
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text("Plan de Ferme • plandeferme.ca • Données ouvertes : LiDAR HRDEM 1 m, IRDA, BDPPAD", margin, pageH - 4.5);

        // 5. Sauvegarde & Téléchargement du fichier PDF
        const slug = (this.state.title || "plan-de-ferme").toLowerCase().replace(/[^a-z0-9]/g, "-");
        doc.save(`plan-de-ferme-${slug}.pdf`);
      } catch (err) {
        alert("Erreur lors de la génération du PDF : " + err.message);
        console.error(err);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }

    /**
     * Dessin vectoriel direct de la Rose des vents dans jsPDF (Étoile géodésique à 8 pointes & cadran 36 graduations)
     */
    drawVectorCompass(doc, cx, cy, r) {
      const bearing = this.map ? (this.map.getBearing() * Math.PI) / 180 : 0;

      const rotPoint = (x, y) => {
        const cos = Math.cos(-bearing);
        const sin = Math.sin(-bearing);
        return [cx + (x * cos - y * sin), cy + (x * sin + y * cos)];
      };

      // 1. Cadrans concentriques
      doc.setFillColor(255, 255, 255);
      doc.circle(cx, cy, r, "F");

      doc.setDrawColor(15, 23, 42); // Noir anthracite
      doc.setLineWidth(0.3);
      doc.circle(cx, cy, r, "S");

      doc.setDrawColor(203, 213, 225); // #cbd5e1
      doc.setLineWidth(0.18);
      doc.circle(cx, cy, r * 0.94, "S");

      doc.setDrawColor(226, 232, 240); // #e2e8f0
      doc.setLineWidth(0.15);
      doc.circle(cx, cy, r * 0.84, "S");

      // 2. Graduations d'azimut (36 graduations tous les 10°)
      for (let deg = 0; deg < 360; deg += 10) {
        const isCardinal = deg % 90 === 0;
        const isSemi = deg % 45 === 0 && !isCardinal;
        const tickLen = isCardinal ? (r * 0.12) : isSemi ? (r * 0.08) : (r * 0.04);
        const rOuter = r * 0.94;
        const rInner = rOuter - tickLen;
        const rad = (deg * Math.PI) / 180;

        const x1Local = rOuter * Math.sin(rad);
        const y1Local = -rOuter * Math.cos(rad);
        const x2Local = rInner * Math.sin(rad);
        const y2Local = -rInner * Math.cos(rad);

        const p1 = rotPoint(x1Local, y1Local);
        const p2 = rotPoint(x2Local, y2Local);

        if (isCardinal) {
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.24);
        } else if (isSemi) {
          doc.setDrawColor(71, 85, 105);
          doc.setLineWidth(0.18);
        } else {
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(0.12);
        }
        doc.line(p1[0], p1[1], p2[0], p2[1]);
      }

      // 3. Les 4 pointes secondaires intermédiaires (NE, SE, SO, NO) à 45°, 135°, 225°, 315°
      const subAngles = [45, 135, 225, 315];
      const rSub = r * 0.60;
      const wSub = r * 0.10;
      for (const a of subAngles) {
        const radCenter = (a * Math.PI) / 180;
        const radL = ((a - 20) * Math.PI) / 180;
        const radR = ((a + 20) * Math.PI) / 180;

        const tip = rotPoint(rSub * Math.sin(radCenter), -rSub * Math.cos(radCenter));
        const wingL = rotPoint(wSub * Math.sin(radL), -wSub * Math.cos(radL));
        const wingR = rotPoint(wSub * Math.sin(radR), -wSub * Math.cos(radR));

        doc.setFillColor(148, 163, 184); // #94a3b8
        doc.triangle(cx, cy, wingL[0], wingL[1], tip[0], tip[1], "F");
        doc.setFillColor(203, 213, 225); // #cbd5e1
        doc.triangle(cx, cy, wingR[0], wingR[1], tip[0], tip[1], "F");
      }

      // 4. Pointes cardinales Sud, Est, Ouest
      const rCard = r * 0.74;
      const wCard = r * 0.13;

      // Sud (180°)
      const tipS = rotPoint(0, rCard);
      const wingSL = rotPoint(-wCard, 0);
      const wingSR = rotPoint(wCard, 0);
      doc.setFillColor(148, 163, 184);
      doc.triangle(cx, cy, wingSL[0], wingSL[1], tipS[0], tipS[1], "F");
      doc.setFillColor(203, 213, 225);
      doc.triangle(cx, cy, wingSR[0], wingSR[1], tipS[0], tipS[1], "F");

      // Est (90°)
      const tipE = rotPoint(rCard, 0);
      const wingET = rotPoint(0, -wCard);
      const wingEB = rotPoint(0, wCard);
      doc.setFillColor(148, 163, 184);
      doc.triangle(cx, cy, wingET[0], wingET[1], tipE[0], tipE[1], "F");
      doc.setFillColor(203, 213, 225);
      doc.triangle(cx, cy, wingEB[0], wingEB[1], tipE[0], tipE[1], "F");

      // Ouest (270°)
      const tipW = rotPoint(-rCard, 0);
      doc.setFillColor(148, 163, 184);
      doc.triangle(cx, cy, wingET[0], wingET[1], tipW[0], tipW[1], "F");
      doc.setFillColor(203, 213, 225);
      doc.triangle(cx, cy, wingEB[0], wingEB[1], tipW[0], tipW[1], "F");

      // 5. Nord (Grande flèche bicolore contrastée)
      const rNorth = r * 0.80;
      const tipN = rotPoint(0, -rNorth);
      doc.setFillColor(15, 23, 42); // Noir anthracite
      doc.triangle(cx, cy, wingSL[0], wingSL[1], tipN[0], tipN[1], "F");
      doc.setFillColor(71, 85, 105); // Slate foncé
      doc.triangle(cx, cy, wingSR[0], wingSR[1], tipN[0], tipN[1], "F");

      // 6. Pointeau supérieur rouge Nord (apex)
      const apexTop = rotPoint(0, -r * 0.88);
      const apexL = rotPoint(-r * 0.05, -r * 0.77);
      const apexR = rotPoint(r * 0.05, -r * 0.77);
      doc.setFillColor(220, 38, 38); // Rouge vif #dc2626
      doc.triangle(apexTop[0], apexTop[1], apexL[0], apexL[1], apexR[0], apexR[1], "F");

      // 7. Anneau central multi-épaisseurs
      doc.setFillColor(15, 23, 42);
      doc.circle(cx, cy, r * 0.12, "F");
      doc.setFillColor(255, 255, 255);
      doc.circle(cx, cy, r * 0.06, "F");
      doc.setFillColor(15, 23, 42);
      doc.circle(cx, cy, r * 0.025, "F");

      // 8. Lettres cardinales élégantes
      doc.setFont("helvetica", "bold");

      // N
      const [lxN, lyN] = rotPoint(0, -r * 0.60);
      doc.setFontSize(6.8);
      doc.setTextColor(15, 23, 42);
      doc.text("N", lxN, lyN + 0.8, { align: "center" });

      // S
      const [lxS, lyS] = rotPoint(0, r * 0.70);
      doc.setFontSize(5);
      doc.setTextColor(100, 116, 139);
      doc.text("S", lxS, lyS + 0.8, { align: "center" });

      // E
      const [lxE, lyE] = rotPoint(r * 0.70, 0);
      doc.text("E", lxE, lyE + 0.8, { align: "center" });

      // O (Ouest)
      const [lxO, lyO] = rotPoint(-r * 0.70, 0);
      doc.text("O", lxO, lyO + 0.8, { align: "center" });
    }

    /**
     * Dessin vectoriel haute précision du profil altimétrique (Coupe MNT) dans jsPDF
     */
    drawVectorProfile(doc, x, y, w, h, profile) {
      // 1. Cadre du bloc
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.35);
      doc.setFillColor(255, 255, 255);
      doc.rect(x, y, w, h, "FD");

      // 2. En-tête : Titre
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text("COUPE TOPOGRAPHIQUE (PROFIL MNT)", x + 3.5, y + 4.5);

      if (!profile || profile.length < 2) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(6.5);
        doc.setTextColor(148, 163, 184);
        doc.text("Tracez une coupe sur la carte avec l'outil Coupe MNT pour afficher le profil altimétrique ici.", x + 3.5, y + 12);
        return;
      }

      // Calcul des statistiques altimétriques
      const elevations = profile.map(p => p.elevation);
      const minElev = Math.min(...elevations);
      const maxElev = Math.max(...elevations);
      const deltaElev = maxElev - minElev;
      const totalDist = profile[profile.length - 1].distance;

      // Régression linéaire (Pente moyenne)
      const n = profile.length;
      const meanX = profile.reduce((acc, p) => acc + p.distance, 0) / n;
      const meanY = elevations.reduce((acc, e) => acc + e, 0) / n;
      let num = 0, den = 0;
      for (const p of profile) {
        const dx = p.distance - meanX;
        num += dx * (p.elevation - meanY);
        den += dx * dx;
      }
      const slope = den === 0 ? 0 : num / den;
      const intercept = meanY - slope * meanX;
      const slopePct = slope * 100;

      const distStr = totalDist >= 1000 ? (totalDist / 1000).toFixed(2) + " km" : Math.round(totalDist) + " m";
      const statText = `Min : ${minElev.toFixed(1)} m  |  Max : ${maxElev.toFixed(1)} m  |  Dénivelé Δ : ${deltaElev.toFixed(1)} m  |  Pente moy. : ${slopePct >= 0 ? '+' : ''}${slopePct.toFixed(1)}%  |  Distance : ${distStr}`;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(71, 85, 105);
      doc.text(statText, x + w - 3.5, y + 4.5, { align: "right" });

      // 3. Zone du graphique
      const padLeft = 14;
      const padRight = 6;
      const padTop = 7.5;
      const padBottom = 5.5;

      const plotX = x + padLeft;
      const plotY = y + padTop;
      const plotW = w - padLeft - padRight;
      const plotH = h - padTop - padBottom;
      const baseY = plotY + plotH;
      const span = deltaElev > 0.01 ? deltaElev : 1;

      // Grille de fond
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.2);
      for (let i = 0; i <= 3; i++) {
        const gy = plotY + (i / 3) * plotH;
        doc.line(plotX, gy, plotX + plotW, gy);
      }
      for (let i = 0; i <= 4; i++) {
        const gx = plotX + (i / 4) * plotW;
        doc.line(gx, plotY, gx, baseY);
      }

      // Calcul des coordonnées des points
      const points = profile.map(p => [
        plotX + (p.distance / totalDist) * plotW,
        plotY + (1 - (p.elevation - minElev) / span) * plotH
      ]);

      // Aire remplie sous la courbe (teinte douce bleu ciel #e0f2fe = [224, 242, 254])
      doc.setFillColor(224, 242, 254);
      for (let i = 0; i < points.length - 1; i++) {
        const x1 = points[i][0];
        const y1 = points[i][1];
        const x2 = points[i + 1][0];
        const y2 = points[i + 1][1];
        doc.triangle(x1, baseY, x1, y1, x2, y1, "F");
        doc.triangle(x1, baseY, x2, y1, x2, baseY, "F");
      }

      // Ligne de tendance de régression (orange #ea580c = [234, 88, 12])
      const trendY1 = plotY + (1 - (intercept - minElev) / span) * plotH;
      const trendY2 = plotY + (1 - (intercept + slope * totalDist - minElev) / span) * plotH;
      doc.setDrawColor(234, 88, 12);
      doc.setLineWidth(0.3);
      doc.line(plotX, trendY1, plotX + plotW, trendY2);

      // Courbe altimétrique principale (bleu roi #0284c7 = [2, 132, 199])
      doc.setDrawColor(2, 132, 199);
      doc.setLineWidth(0.55);
      for (let i = 0; i < points.length - 1; i++) {
        doc.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
      }

      // Axes X et Y
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.25);
      doc.line(plotX, baseY, plotX + plotW, baseY);
      doc.line(plotX, plotY, plotX, baseY);

      // Étiquettes altimétriques
      doc.setFont("courier", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text(maxElev.toFixed(1) + " m", plotX - 1.2, plotY + 1.2, { align: "right" });
      doc.text(((minElev + maxElev) / 2).toFixed(1) + " m", plotX - 1.2, plotY + (plotH / 2) + 0.8, { align: "right" });
      doc.text(minElev.toFixed(1) + " m", plotX - 1.2, baseY, { align: "right" });

      // Étiquettes de distance
      doc.text("0 m", plotX, baseY + 3.6, { align: "left" });
      doc.text(distStr, plotX + plotW, baseY + 3.6, { align: "right" });
    }

    /**
     * Analyse une chaîne de couleur (hex, rgb, rgba) en triplet [r, g, b] compatible jsPDF.
     */
    parseRgbColor(str) {
      if (!str) return [100, 116, 139];
      if (Array.isArray(str)) return str;
      str = String(str).trim();
      if (str.startsWith("#")) {
        const hex = str.replace("#", "");
        if (hex.length === 3) {
          return [
            parseInt(hex[0] + hex[0], 16),
            parseInt(hex[1] + hex[1], 16),
            parseInt(hex[2] + hex[2], 16)
          ];
        }
        return [
          parseInt(hex.substring(0, 2), 16) || 0,
          parseInt(hex.substring(2, 4), 16) || 0,
          parseInt(hex.substring(4, 6), 16) || 0
        ];
      }
      const matchRgb = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (matchRgb) {
        return [parseInt(matchRgb[1], 10), parseInt(matchRgb[2], 10), parseInt(matchRgb[3], 10)];
      }
      return [100, 116, 139];
    }

    /**
     * Tronque un texte pour qu'il tienne dans une largeur max en millimètres.
     */
    truncateText(doc, text, maxW) {
      if (!text) return "";
      try {
        if (doc.getTextWidth && doc.getTextWidth(text) <= maxW) return text;
        let t = text;
        while (t.length > 3 && doc.getTextWidth && doc.getTextWidth(t + "...") > maxW) {
          t = t.substring(0, t.length - 1);
        }
        return t + "...";
      } catch (e) {
        const approx = Math.max(8, Math.floor(maxW / 1.35));
        return text.length > approx ? text.substring(0, approx - 2) + "..." : text;
      }
    }

    /**
     * Rendu vectoriel complet et adaptatif de la légende dans jsPDF.
     */
    drawPdfLegend(doc, { x, y, w, maxH, items, twoColumns = false }) {
      if (!items || items.length === 0) return;

      // Calcul de la hauteur totale requise sur 1 colonne
      let totalNeededH = 0;
      for (const it of items) {
        if (it.isHeader) totalNeededH += 4.2;
        else if (it.type === "gradient" || it.gradient) totalNeededH += 8.5;
        else totalNeededH += 3.6;
      }

      // Si le mode deux colonnes est demandé ou si la hauteur dépasse maxH
      const useTwoCols = twoColumns || (w >= 68 && totalNeededH > (maxH - 10));

      const maxY = y + maxH - 2.5;

      if (!useTwoCols) {
        // --- Disposition sur une seule colonne ---
        let curY = y + 8.5;
        for (const it of items) {
          const itemH = it.isHeader ? 4.2 : (it.type === "gradient" || it.gradient) ? 8.5 : 3.6;
          if (curY + itemH > maxY) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(5.5);
            doc.setTextColor(148, 163, 184);
            doc.text("...", x + 4, curY + 2);
            break;
          }

          if (it.isHeader) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(5.8);
            doc.setTextColor(71, 85, 105);
            const truncated = this.truncateText(doc, it.label.toUpperCase(), w - 7);
            doc.text(truncated, x + 3.5, curY + 2.5);
            curY += itemH;
          } else if (it.type === "gradient" || it.gradient) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6.2);
            doc.setTextColor(30, 41, 59);
            const truncated = this.truncateText(doc, it.label, w - 7);
            doc.text(truncated, x + 3.5, curY + 1.8);

            const barX = x + 3.5;
            const barW = w - 7;
            const barY = curY + 2.8;
            const barH = 2.2;
            const segW = barW / 5;

            const gradColors = [
              [124, 58, 237], // Mauve
              [2, 132, 199],  // Bleu
              [34, 197, 94],  // Vert
              [234, 179, 8],  // Jaune
              [220, 38, 38]   // Rouge
            ];
            for (let c = 0; c < 5; c++) {
              doc.setFillColor(gradColors[c][0], gradColors[c][1], gradColors[c][2]);
              doc.rect(barX + segW * c, barY, segW, barH, "F");
            }
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.15);
            doc.rect(barX, barY, barW, barH, "S");

            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.2);
            doc.setTextColor(100, 116, 139);
            doc.text(it.minText || "Bas", barX, barY + barH + 2.4);
            doc.text(it.midText || "Moyen", barX + barW / 2, barY + barH + 2.4, { align: "center" });
            doc.text(it.maxText || "Haut", barX + barW, barY + barH + 2.4, { align: "right" });

            curY += itemH;
          } else if (it.type === "line" || it.line) {
            const [r, g, b] = this.parseRgbColor(it.color);
            doc.setDrawColor(r, g, b);
            doc.setLineWidth(0.8);
            doc.line(x + 3.5, curY + 1.2, x + 7.5, curY + 1.2);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.2);
            doc.setTextColor(51, 65, 85);
            const truncated = this.truncateText(doc, it.label, w - 12);
            doc.text(truncated, x + 9, curY + 2);
            curY += itemH;
          } else {
            const [r, g, b] = this.parseRgbColor(it.color);
            doc.setFillColor(r, g, b);
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.15);
            doc.rect(x + 3.5, curY, 2.5, 2.5, "FD");

            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.2);
            doc.setTextColor(51, 65, 85);
            const truncated = this.truncateText(doc, it.label, w - 10);
            doc.text(truncated, x + 7.5, curY + 2);
            curY += itemH;
          }
        }
      } else {
        // --- Disposition sur deux sous-colonnes adaptatives ---
        const subW = (w - 6) / 2;
        let col = 0;
        let col1Y = y + 8.5;
        let col2Y = y + 8.5;

        for (const it of items) {
          // Dégradé en pleine largeur si au début
          if ((it.type === "gradient" || it.gradient) && col1Y === y + 8.5 && col2Y === y + 8.5) {
            const itemH = 8.5;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6.2);
            doc.setTextColor(30, 41, 59);
            const truncated = this.truncateText(doc, it.label, w - 7);
            doc.text(truncated, x + 3.5, col1Y + 1.8);

            const barX = x + 3.5;
            const barW = w - 7;
            const barY = col1Y + 2.8;
            const barH = 2.2;
            const segW = barW / 5;

            const gradColors = [
              [124, 58, 237], [2, 132, 199], [34, 197, 94], [234, 179, 8], [220, 38, 38]
            ];
            for (let c = 0; c < 5; c++) {
              doc.setFillColor(gradColors[c][0], gradColors[c][1], gradColors[c][2]);
              doc.rect(barX + segW * c, barY, segW, barH, "F");
            }
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.15);
            doc.rect(barX, barY, barW, barH, "S");

            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.2);
            doc.setTextColor(100, 116, 139);
            doc.text(it.minText || "Bas", barX, barY + barH + 2.4);
            doc.text(it.midText || "Moyen", barX + barW / 2, barY + barH + 2.4, { align: "center" });
            doc.text(it.maxText || "Haut", barX + barW, barY + barH + 2.4, { align: "right" });

            col1Y += itemH;
            col2Y += itemH;
            continue;
          }

          const itemH = it.isHeader ? 4.2 : (it.type === "gradient" || it.gradient) ? 8.5 : 3.6;

          let activeX = x + 2;
          let activeY = col1Y;
          if (col === 0) {
            if (col1Y + itemH > maxY) {
              col = 1;
              activeX = x + subW + 4;
              activeY = col2Y;
            }
          } else {
            activeX = x + subW + 4;
            activeY = col2Y;
          }

          if (activeY + itemH > maxY) {
            continue;
          }

          if (it.isHeader) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(5.5);
            doc.setTextColor(71, 85, 105);
            const truncated = this.truncateText(doc, it.label.toUpperCase(), subW - 3);
            doc.text(truncated, activeX, activeY + 2.5);
          } else if (it.type === "gradient" || it.gradient) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(5.8);
            doc.setTextColor(30, 41, 59);
            const truncated = this.truncateText(doc, it.label, subW - 3);
            doc.text(truncated, activeX, activeY + 1.8);

            const barX = activeX;
            const barW = subW - 3;
            const barY = activeY + 2.8;
            const barH = 2.0;
            const segW = barW / 5;
            const gradColors = [
              [124, 58, 237], [2, 132, 199], [34, 197, 94], [234, 179, 8], [220, 38, 38]
            ];
            for (let c = 0; c < 5; c++) {
              doc.setFillColor(gradColors[c][0], gradColors[c][1], gradColors[c][2]);
              doc.rect(barX + segW * c, barY, segW, barH, "F");
            }
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.15);
            doc.rect(barX, barY, barW, barH, "S");
          } else if (it.type === "line" || it.line) {
            const [r, g, b] = this.parseRgbColor(it.color);
            doc.setDrawColor(r, g, b);
            doc.setLineWidth(0.8);
            doc.line(activeX, activeY + 1.2, activeX + 4.5, activeY + 1.2);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.8);
            doc.setTextColor(51, 65, 85);
            const truncated = this.truncateText(doc, it.label, subW - 7);
            doc.text(truncated, activeX + 5.5, activeY + 2);
          } else {
            const [r, g, b] = this.parseRgbColor(it.color);
            doc.setFillColor(r, g, b);
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.15);
            doc.rect(activeX, activeY, 2.3, 2.3, "FD");

            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.8);
            doc.setTextColor(51, 65, 85);
            const truncated = this.truncateText(doc, it.label, subW - 5.5);
            doc.text(truncated, activeX + 3.8, activeY + 2);
          }

          if (col === 0) col1Y += itemH;
          else col2Y += itemH;
        }
      }
    }
  }

  // Exposition globale
  window.PlanDeFermeComposer = PlanDeFermeComposer;
})(window, document);
