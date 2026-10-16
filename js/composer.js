/* ==========================================================================
   Plan de Ferme — Module de Compositeur Cartographique & Export PDF
   Format Lettre (8,5 × 11 po) — Modes Portrait et Paysage
   Gabarits réutilisables, textes éditables, logo, rose des vents, échelle.
   ========================================================================== */

(function (window, document) {
  "use strict";

  const STORAGE_KEY_TEMPLATES = "plandeferme_composer_templates_v1";

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
      logoUrl: null,
      excludedLegendIds: []
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
      logoUrl: null,
      excludedLegendIds: []
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
      logoUrl: null,
      excludedLegendIds: []
    }
  };

  class PlanDeFermeComposer {
    constructor() {
      this.map = null;
      this.wmsManager = null;
      this.isOpen = false;
      this.state = {
        ...DEFAULT_TEMPLATES.standard_paysage,
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

          <!-- Corps : Paramètres (gauche) + Prévisualisation (droite) -->
          <div class="composer-body">
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
                  <button type="button" id="composer-btn-save-template" class="composer-btn-action" title="Enregistrer le modèle actuel dans votre navigateur">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                    <span>Enregistrer</span>
                  </button>
                  <button type="button" id="composer-btn-export-json" class="composer-btn-action" title="Télécharger le modèle sous forme de fichier JSON">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>Export JSON</span>
                  </button>
                </div>
                <div style="display: flex; gap: 6px;">
                  <label class="composer-btn-action" style="flex: 1; cursor: pointer; text-align: center;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Charger un fichier .json</span>
                    <input type="file" id="composer-input-import-json" accept=".json" style="display: none;" />
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
                    <!-- Cadre de carte -->
                    <div class="sheet-map-frame" id="sheet-map-frame">
                      <img id="sheet-map-img" class="sheet-map-img" alt="Capture de la carte" />
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
        btnExportJson: document.getElementById("composer-btn-export-json"),
        inputImportJson: document.getElementById("composer-input-import-json"),
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
        sheetNotesText: document.getElementById("sheet-notes-text")
      };

      this.populateTemplateSelect();
      this.renderCompass();
    }

    /**
     * Rendu vectoriel de la Rose des vents (SVG)
     */
    renderCompass() {
      const bearing = this.map ? this.map.getBearing() : 0;
      this.dom.sheetCompassWrap.innerHTML = `
        <svg class="sheet-compass-svg" viewBox="0 0 100 100" style="transform: rotate(${bearing}deg); width: 100%; height: 100%;">
          <!-- Cercles extérieurs gradués -->
          <circle cx="50" cy="50" r="46" fill="none" stroke="#0f172a" stroke-width="1.2" stroke-dasharray="2 2" />
          <circle cx="50" cy="50" r="41" fill="none" stroke="#0f172a" stroke-width="0.8" />
          
          <!-- Nord (Grande flèche bicolore) -->
          <polygon points="50,6 44,48 50,44" fill="#0f172a" />
          <polygon points="50,6 56,48 50,44" fill="#475569" />
          
          <!-- Sud -->
          <polygon points="50,94 44,52 50,56" fill="#94a3b8" />
          <polygon points="50,94 56,52 50,56" fill="#cbd5e1" />
          
          <!-- Est -->
          <polygon points="94,50 52,44 56,50" fill="#94a3b8" />
          <polygon points="94,50 52,56 56,50" fill="#cbd5e1" />
          
          <!-- Ouest (O) -->
          <polygon points="6,50 48,44 44,50" fill="#94a3b8" />
          <polygon points="6,50 48,56 44,50" fill="#cbd5e1" />
          
          <!-- 4 pointes intermédiaires NE, SE, SO, NO -->
          <polygon points="80,20 50,50 53,47" fill="#cbd5e1" />
          <polygon points="80,80 50,50 53,53" fill="#cbd5e1" />
          <polygon points="20,80 50,50 47,53" fill="#cbd5e1" />
          <polygon points="20,20 50,50 47,47" fill="#cbd5e1" />
          
          <!-- Centre -->
          <circle cx="50" cy="50" r="4.5" fill="#0f172a" />
          <circle cx="50" cy="50" r="1.5" fill="#ffffff" />
          
          <!-- Lettres N, S, E, O -->
          <text x="50" y="20" font-size="11" font-weight="800" font-family="'Plus Jakarta Sans', sans-serif" text-anchor="middle" fill="#0f172a">N</text>
          <text x="50" y="87" font-size="8.5" font-weight="600" font-family="'Plus Jakarta Sans', sans-serif" text-anchor="middle" fill="#64748b">S</text>
          <text x="85" y="53" font-size="8.5" font-weight="600" font-family="'Plus Jakarta Sans', sans-serif" text-anchor="middle" fill="#64748b">E</text>
          <text x="15" y="53" font-size="8.5" font-weight="600" font-family="'Plus Jakarta Sans', sans-serif" text-anchor="middle" fill="#64748b">O</text>
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

      // Télécharger en JSON
      this.dom.btnExportJson.addEventListener("click", () => {
        const exportData = {
          app: "PlanDeFerme",
          version: "1.0",
          exportDate: new Date().toISOString(),
          template: this.state
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const slug = (this.state.title || "modele").toLowerCase().replace(/[^a-z0-9]/g, "-");
        a.download = `plan-de-ferme-template-${slug}.layout.json`;
        a.click();
        URL.revokeObjectURL(url);
      });

      // Importer depuis un JSON
      this.dom.inputImportJson.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            const tmpl = data.template || data;
            if (!tmpl.title && !tmpl.orientation) {
              throw new Error("Structure de gabarit non reconnue.");
            }
            const id = "imported_" + Date.now();
            tmpl.id = id;
            tmpl.name = tmpl.name || file.name.replace(/\.[^/.]+$/, "");
            this.userTemplates[id] = tmpl;
            this.saveUserTemplates();
            this.populateTemplateSelect();
            this.dom.templateSelect.value = "user_" + id;
            this.loadState(tmpl);
            alert(`Modèle "${tmpl.name}" importé avec succès !`);
          } catch (err) {
            alert("Erreur lors de l'importation du modèle JSON : " + err.message);
          }
        };
        reader.readAsText(file);
      });

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

      // Bouton de génération PDF
      this.dom.btnGeneratePdf.addEventListener("click", () => this.generatePdf());
    }

    /**
     * Applique une échelle de zoom fluide à la feuille et adapte le conteneur scaler
     */
    applyScale(scale, isFit = false) {
      this.currentScale = Math.max(0.25, Math.min(scale, 1.6));
      if (!this.dom.sheetScaler || !this.dom.sheet) return;

      const isLandscape = this.state.orientation === "landscape";
      const sheetW = isLandscape ? 880 : 650;
      const sheetH = isLandscape ? 680 : 840;

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
      const padX = vpW <= 600 ? 16 : 48;
      const padY = vpW <= 600 ? 16 : 48;
      const availW = Math.max(100, vpW - padX);
      const availH = Math.max(100, vpH - padY);

      const isLandscape = this.state.orientation === "landscape";
      const sheetW = isLandscape ? 880 : 650;
      const sheetH = isLandscape ? 680 : 840;

      const scale = Math.min(availW / sheetW, availH / sheetH, 1.0);
      this.applyScale(scale, true);
    }

    updateNavBlockVisibility() {
      const show = this.state.showCompass || this.state.showScale;
      this.dom.sheetNavBlock.style.display = show ? "flex" : "none";
    }

    /**
     * Mise à jour de l'affichage du logo
     */
    updateLogoDisplay() {
      if (this.state.logoUrl) {
        this.dom.logoPreview.innerHTML = `<img src="${this.state.logoUrl}" alt="Logo" />`;
        this.dom.btnClearLogo.style.display = "block";
        this.dom.sheetLogoContainer.style.display = "flex";
        this.dom.sheetLogoImg.src = this.state.logoUrl;
      } else {
        this.dom.logoPreview.innerHTML = `<span class="composer-logo-preview-empty">Aucun<br/>logo</span>`;
        this.dom.btnClearLogo.style.display = "none";
        this.dom.sheetLogoContainer.style.display = "none";
        this.dom.sheetLogoImg.src = "";
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
     */
    updateMapSnapshotForOrientation() {
      if (!this.rawMapCanvas) return;
      const isLandscape = this.state.orientation === "landscape";
      // Ratios d'aspect réels des cadres sur papier (mapW / mapH)
      // Paysage : mapW = 195.4 mm, mapH = 164.9 mm -> ratio = 1.18496
      // Portrait : mapW = 195.9 mm, mapH = 158 mm -> ratio = 1.23987
      const targetAspect = isLandscape ? (195.4 / 164.9) : (195.9 / 158);
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
      this.state = { ...this.state, ...state };

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

      this.dom.sheetCompassWrap.style.display = this.dom.checkCompass.checked ? "flex" : "none";
      this.dom.sheetScaleWrap.style.display = this.dom.checkScale.checked ? "flex" : "none";
      this.updateNavBlockVisibility();
      this.dom.sheetLegendBlock.style.display = this.dom.checkLegend.checked ? "flex" : "none";
      this.dom.sheetNotesBlock.style.display = this.dom.checkNotes.checked ? "flex" : "none";

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
      const sheetMapWidthMm = isLandscape ? 195.4 : 195.9;

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
            label: "Ombrage 3D du relief (azimut 315°)",
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

      // 4. Affichage
      this.dom.overlay.classList.add("active");
      this.isOpen = true;

      // Toujours démarrer le défilement tout en haut pour que l'en-tête soit visible
      if (this.dom.previewViewport) {
        this.dom.previewViewport.scrollTop = 0;
      }

      // Ajustement dynamique de l'échelle à la taille exacte du viewport
      setTimeout(() => {
        if (this.zoomMode === "fit") {
          this.fitSheetToViewport();
        } else {
          this.applyScale(this.currentScale, false);
        }
        if (this.dom.previewViewport) {
          this.dom.previewViewport.scrollTop = 0;
        }
      }, 40);
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
        const margin = 10;

        // Synchronisation des couches actives et de la légende
        this.updateActiveLegend();

        // 1. Fond blanc
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageW, pageH, "F");

        // 2. Cartouche d'en-tête
        const headerX = margin;
        const headerY = margin;
        const headerW = pageW - (margin * 2);
        const headerH = 22;

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
            const maxH = 16;
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
        doc.text(this.state.title || "Plan de ferme", textStartX, headerY + 7);

        // Sous-titre
        if (this.state.subtitle) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9.5);
          doc.setTextColor(22, 101, 52); // Vert forêt #166534
          doc.text(this.state.subtitle, textStartX, headerY + 12);
        }

        // Métadonnées à droite dans le cartouche
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        const metaX = headerX + headerW - 4;
        const dateStr = this.dom.sheetMetaDate.textContent || "";
        doc.text(`Date : ${dateStr}`, metaX, headerY + 6, { align: "right" });

        let curMetaY = headerY + 10.5;
        if (this.state.location) {
          doc.text(`Lieu : ${this.state.location}`, metaX, curMetaY, { align: "right" });
          curMetaY += 4.5;
        }
        if (this.state.author) {
          doc.text(`Auteur : ${this.state.author}`, metaX, curMetaY, { align: "right" });
        }

        // 3. Cadre de carte & Panneau d'informations
        const mapTopY = headerY + headerH + 3;

        if (isLandscape) {
          // Disposition PAYSAGE
          const sideW = 60;
          const mapW = headerW - sideW - 4;
          const mapH = pageH - mapTopY - margin - 6;

          // Image de la carte (recadrée au ratio exact du cadre pour éviter toute compression/distorsion)
          if (this.mapSnapshotDataUrl) {
            doc.addImage(this.mapSnapshotDataUrl, "PNG", headerX, mapTopY, mapW, mapH, undefined, "MEDIUM");
          }
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.4);
          doc.rect(headerX, mapTopY, mapW, mapH);

          // Panneau latéral
          const sideX = headerX + mapW + 4;
          let currentSideY = mapTopY;

          // Rose des vents & Échelle
          if (this.state.showCompass || this.state.showScale) {
            const navBlockH = 46;
            doc.setDrawColor(203, 213, 225);
            doc.setLineWidth(0.3);
            doc.rect(sideX, currentSideY, sideW, navBlockH);

            // Rose des vents (Boussole)
            if (this.state.showCompass) {
              this.drawVectorCompass(doc, sideX + (sideW / 2), currentSideY + 15, 11);
            }

            // Échelle
            if (this.state.showScale && this.scaleInfo) {
              const scaleY = currentSideY + 34;
              const barW = Math.min(sideW - 16, 44);
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
          const mapH = 158;

          // Image de carte (recadrée au ratio exact du cadre)
          if (this.mapSnapshotDataUrl) {
            doc.addImage(this.mapSnapshotDataUrl, "PNG", headerX, mapTopY, mapW, mapH, undefined, "MEDIUM");
          }
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.4);
          doc.rect(headerX, mapTopY, mapW, mapH);

          // Section basse
          const bottomY = mapTopY + mapH + 3;
          const bottomH = pageH - bottomY - margin - 6;

          // Colonne 1 : Rose des vents & Échelle (48 mm)
          const col1W = 46;
          doc.setDrawColor(203, 213, 225);
          doc.rect(headerX, bottomY, col1W, bottomH);

          if (this.state.showCompass) {
            this.drawVectorCompass(doc, headerX + col1W / 2, bottomY + 16, 11);
          }

          if (this.state.showScale && this.scaleInfo) {
            const scaleY = bottomY + 36;
            const barW = 34;
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
          doc.rect(col2X, bottomY, col2W, bottomH, "FD");

          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(15, 23, 42);
          doc.text("LÉGENDE", col2X + 3.5, bottomY + 5);

          if (this.state.showLegend && this.currentLegendItems && this.currentLegendItems.length > 0) {
            this.drawPdfLegend(doc, {
              x: col2X,
              y: bottomY,
              w: col2W,
              maxH: bottomH,
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
     * Dessin vectoriel direct de la Rose des vents dans jsPDF
     */
    drawVectorCompass(doc, cx, cy, r) {
      const bearing = this.map ? (this.map.getBearing() * Math.PI) / 180 : 0;

      // Cercle extérieur
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.2);
      doc.circle(cx, cy, r, "S");
      doc.circle(cx, cy, r * 0.9, "S");

      const rotPoint = (x, y) => {
        const cos = Math.cos(-bearing);
        const sin = Math.sin(-bearing);
        return [cx + (x * cos - y * sin), cy + (x * sin + y * cos)];
      };

      // Nord (Pointe foncée + grise)
      const [nx, ny] = rotPoint(0, -r * 0.95);
      const [slx, sly] = rotPoint(-r * 0.2, 0);
      const [srx, srxY] = rotPoint(r * 0.2, 0);

      doc.setFillColor(15, 23, 42);
      doc.triangle(cx, cy, slx, sly, nx, ny, "F");

      doc.setFillColor(100, 116, 139);
      doc.triangle(cx, cy, srx, srxY, nx, ny, "F");

      // Sud
      const [sx, sy] = rotPoint(0, r * 0.9);
      doc.setFillColor(148, 163, 184);
      doc.triangle(cx, cy, slx, sly, sx, sy, "F");
      doc.setFillColor(203, 213, 225);
      doc.triangle(cx, cy, srx, srxY, sx, sy, "F");

      // Est & Ouest
      const [ex, ey] = rotPoint(r * 0.9, 0);
      const [stx, sty] = rotPoint(0, -r * 0.2);
      const [sbx, sby] = rotPoint(0, r * 0.2);

      doc.setFillColor(148, 163, 184);
      doc.triangle(cx, cy, stx, sty, ex, ey, "F");
      doc.setFillColor(203, 213, 225);
      doc.triangle(cx, cy, sbx, sby, ex, ey, "F");

      const [wx, wy] = rotPoint(-r * 0.9, 0);
      doc.setFillColor(148, 163, 184);
      doc.triangle(cx, cy, stx, sty, wx, wy, "F");
      doc.setFillColor(203, 213, 225);
      doc.triangle(cx, cy, sbx, sby, wx, wy, "F");

      // Centre
      doc.setFillColor(15, 23, 42);
      doc.circle(cx, cy, 1, "F");

      // Lettre N
      const [labelNx, labelNy] = rotPoint(0, -r * 0.55);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text("N", labelNx, labelNy + 1, { align: "center" });
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
