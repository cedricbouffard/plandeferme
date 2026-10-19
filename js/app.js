    // ContourManager, readCogRegion, fromUrl, proj4 are declared in js/config.js

    // Initialize PMTiles protocol
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    // Parse URL parameters for shared views (position & active layers)
    function parseUrlState() {
      const searchParams = new URLSearchParams(window.location.search);
      let hashStr = window.location.hash.replace(/^#/, "");
      
      let lat = null, lng = null, zoom = null;
      
      if (searchParams.has("lat") && (searchParams.has("lng") || searchParams.has("lon"))) {
        lat = parseFloat(searchParams.get("lat"));
        lng = parseFloat(searchParams.get("lng") || searchParams.get("lon"));
      }
      if (searchParams.has("z") || searchParams.has("zoom")) {
        zoom = parseFloat(searchParams.get("z") || searchParams.get("zoom"));
      }
      
      // Also check hash for coordinates if not in query search
      if ((lat === null || isNaN(lat)) && hashStr) {
        const parts = hashStr.split('/');
        if (parts.length >= 3 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1])) && !isNaN(parseFloat(parts[2]))) {
          zoom = parseFloat(parts[0]);
          lat = parseFloat(parts[1]);
          lng = parseFloat(parts[2]);
        } else {
          const hashParams = new URLSearchParams(hashStr);
          if (hashParams.has("lat") && (hashParams.has("lng") || hashParams.has("lon"))) {
            lat = parseFloat(hashParams.get("lat"));
            lng = parseFloat(hashParams.get("lng") || hashParams.get("lon"));
          }
          if (hashParams.has("z") || hashParams.has("zoom")) {
            zoom = parseFloat(hashParams.get("z") || hashParams.get("zoom"));
          }
        }
      }

      // Layers
      let layers = [];
      if (searchParams.has("layers")) {
        layers = searchParams.get("layers").split(",").map(s => s.trim().toLowerCase());
      } else if (hashStr) {
        const hashParams = new URLSearchParams(hashStr.includes("&") ? hashStr : "");
        if (hashParams.has("layers")) {
          layers = hashParams.get("layers").split(",").map(s => s.trim().toLowerCase());
        }
      }

      // Check individual layer flags
      if (searchParams.get("pedo") === "1" || searchParams.get("pedo") === "true") {
        if (!layers.includes("pedo")) layers.push("pedo");
      }
      if (searchParams.get("parcelles") === "1" || searchParams.get("parcelles") === "true") {
        if (!layers.includes("parcelles")) layers.push("parcelles");
      }
      if (searchParams.get("topo") === "1" || searchParams.get("topo") === "true") {
        if (!layers.includes("topo")) layers.push("topo");
      }
      if (searchParams.get("pentes") === "1" || searchParams.get("pentes") === "true") {
        if (!layers.includes("pentes")) layers.push("pentes");
      }
      if (searchParams.get("canopee") === "1" || searchParams.get("canopee") === "true") {
        if (!layers.includes("canopee")) layers.push("canopee");
      }
      if (searchParams.get("contours") === "1" || searchParams.get("contours") === "true") {
        if (!layers.includes("contours")) layers.push("contours");
      }
      if (searchParams.get("ndvi") === "1" || searchParams.get("ndvi") === "true") {
        if (!layers.includes("ndvi")) layers.push("ndvi");
      }

      // WMS layers
      let wms = [];
      if (searchParams.has("wms")) {
        wms = searchParams.get("wms").split(",").map(s => s.trim().toLowerCase());
      } else if (hashStr) {
        const hashParams = new URLSearchParams(hashStr.includes("&") ? hashStr : "");
        if (hashParams.has("wms")) {
          wms = hashParams.get("wms").split(",").map(s => s.trim().toLowerCase());
        }
      }

      // Basemap
      let basemap = searchParams.get("basemap");
      if (!basemap && hashStr) {
        const hashParams = new URLSearchParams(hashStr.includes("&") ? hashStr : "");
        basemap = hashParams.get("basemap");
      }

      // Opacities & options
      const pedoOp = searchParams.get("pedo_op");
      const parcellesOp = searchParams.get("parcelles_op");
      const topoOp = searchParams.get("topo_op");
      const topoHs = searchParams.get("topo_hs");
      const topoHsOp = searchParams.get("topo_hs_op");
      const pentesOp = searchParams.get("pentes_op");
      const canopeeOp = searchParams.get("canopee_op");
      const interval = searchParams.get("interval");

      const hasLocation = (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng) && zoom !== null && !isNaN(zoom));

      return {
        hasLocation,
        lat,
        lng,
        zoom,
        basemap,
        layers,
        wms,
        pedoOp: pedoOp ? parseInt(pedoOp, 10) : null,
        parcellesOp: parcellesOp ? parseInt(parcellesOp, 10) : null,
        topoOp: topoOp ? parseInt(topoOp, 10) : null,
        topoHs: topoHs !== null ? (topoHs === "1" || topoHs === "true") : null,
        topoHsOp: topoHsOp ? parseInt(topoHsOp, 10) : null,
        pentesOp: pentesOp ? parseInt(pentesOp, 10) : null,
        canopeeOp: canopeeOp ? parseInt(canopeeOp, 10) : null,
        interval: interval ? parseFloat(interval) : null
      };
    }

    const urlState = parseUrlState();

    // Initial map view: restored from URL if present, or Southern Quebec by default
    const initialCenter = urlState.hasLocation ? [urlState.lng, urlState.lat] : [-72.4, 46.5];
    const initialZoom = urlState.hasLocation ? urlState.zoom : 6.8;

    const map = new maplibregl.Map({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: true,
      preserveDrawingBuffer: true
    });
    window.map = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true
      }),
      "top-right"
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");

    let searchMarker = null;

    // Study titles dictionary

    let topoManager = null;
    let pentesManager = null;
    let canopeeManager = null;
    let contourManager = null;
    let profileManager = null;
    let ndviManager = null;
    let soilAiAssistant = null;
    let wmsManager = null;
    let parcelHydrologyManager = null;

    map.on("load", () => {
      // 1. Google Hybrid Raster Source
      map.addSource("google-hybrid-source", {
        type: "raster",
        tiles: [
          "https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
          "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
          "https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
          "https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
        ],
        tileSize: 256,
        attribution: "© Google"
      });

      // 2. Vector PMTiles Source
      map.addSource("pedologie", {
        type: "vector",
        url: "pmtiles://https://storage.googleapis.com/geoqc/Pedologie/couverture_pedologique.pmtiles"
      });

      // Google Hybrid Layer
      map.addLayer({
        id: "google-hybrid-layer",
        type: "raster",
        source: "google-hybrid-source",
        layout: { visibility: "none" }
      });

      // Permanent invisible query layer for pedologie (active even when pedologie-fill is hidden)
      map.addLayer({
        id: "pedologie-hit-layer",
        type: "fill",
        source: "pedologie",
        "source-layer": "pedologie_quebec",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-opacity": 0
        }
      });

      // 3. Polygon Fill layer
      map.addLayer({
        id: "pedologie-fill",
        type: "fill",
        source: "pedologie",
        "source-layer": "pedologie_quebec",
        filter: ["==", ["geometry-type"], "Polygon"],
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#b23434"],
          "fill-opacity": 0.8
        }
      });

      // 4. Polygon Boundaries
      map.addLayer({
        id: "pedologie-line",
        type: "line",
        source: "pedologie",
        "source-layer": "pedologie_quebec",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#1e293b",
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            8, 0.4,
            12, 0.8,
            16, 1.5
          ],
          "line-opacity": 0.4
        }
      });

      // 5. Polygon LABELS (minzoom: 12)
      map.addLayer({
        id: "pedologie-labels",
        type: "symbol",
        source: "pedologie",
        "source-layer": "pedologie_quebec",
        minzoom: 12,
        maxzoom: 24,
        layout: {
          "visibility": "none",
          "text-field": ["to-string", ["coalesce", ["get", "Appellation_cartographique"], ""]],
          "text-font": ["Noto Sans Regular"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            12, 10,
            14, 12,
            16, 15
          ],
          "text-anchor": "center",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-max-width": 8
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "rgba(255, 255, 255, 0.85)",
          "text-halo-width": 2,
          "text-halo-blur": 0.5,
          "text-opacity": 0.8
        }
      });

      // 6. Vector PMTiles Source for Agricultural Parcels (BDPPAD 2026)
      map.addSource("parcelles-source", {
        type: "vector",
        url: "pmtiles://https://storage.googleapis.com/geoqc/BDPPAD/BDPPAD_2026.pmtiles"
      });

      // Permanent invisible query layer for parcelles (queryable even when parcelles-fill is hidden)
      map.addLayer({
        id: "parcelles-hit-layer",
        type: "fill",
        source: "parcelles-source",
        "source-layer": "BDPPAD_2026",
        paint: {
          "fill-opacity": 0
        }
      });

      // 7. Parcelles Fill Layer (transparent background)
      map.addLayer({
        id: "parcelles-fill",
        type: "fill",
        source: "parcelles-source",
        "source-layer": "BDPPAD_2026",
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#000000",
          "fill-opacity": 0
        }
      });

      // 8. Parcelles Boundary Background (solid white underlay line for B&W contrast)
      map.addLayer({
        id: "parcelles-line-bg",
        type: "line",
        source: "parcelles-source",
        "source-layer": "BDPPAD_2026",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#ffffff",
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            10, 1.4,
            13, 2.2,
            16, 3.2
          ],
          "line-opacity": 0.95
        }
      });

      // 9. Parcelles Boundary Foreground (dashed black line for alternating zebra/hachure effect)
      map.addLayer({
        id: "parcelles-line-fg",
        type: "line",
        source: "parcelles-source",
        "source-layer": "BDPPAD_2026",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#000000",
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            10, 1.4,
            13, 2.2,
            16, 3.2
          ],
          "line-dasharray": [4, 4],
          "line-opacity": 0.95
        }
      });

      // Instantiate Topography Manager (starts disabled by default)
      topoManager = new TopoManager(map);
      pentesManager = new PentesManager(map);
      canopeeManager = new CanopeeManager(map);

      // Instantiate ContourManager from geolibre-plugin
      const mockApp = {
        getMap: () => map,
        getLocale: () => 'fr',
        translate: (k, fallback) => fallback
      };
      contourManager = new ContourManager(mockApp);
      
      const defaultTile = findTileForCoords(initialCenter[0], initialCenter[1]);
      contourManager.updateConfig({
        cogUrl: defaultTile,
        regionProvider: (bbox, gridSize, signal) => readMultiHrdemRegion(bbox, gridSize, signal, 'bilinear'),
        interval: 1,
        majorEvery: 5,
        gridSize: 128,
        minZoom: 11,
        lineColor: "#000000",
        majorWidth: 1.6,
        minorWidth: 0.8,
        labelSize: 13
      });

      const contourStatusEl = document.getElementById('contour-status');
      contourManager.setStatusListener((text, kind) => {
        if (contourStatusEl) {
          contourStatusEl.textContent = text;
          contourStatusEl.className = 'contour-status-badge ' + (kind === 'success' ? 'active' : '');
        }
      });

      contourManager.setup(map);
      for (const layerId of ["gc-contour-minor", "gc-contour-major", "gc-contour-labels"]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", "none");
        }
      }

      // Function to ensure parcels, cadastre, contours and hydrography stay properly layered
      function bringTopLayersToFront() {
        // -1. Ombrage 3D (Hillshade) AU-DESSUS du relief altimétrique (Topo)
        if (map.getLayer("hrdem-topo-layer") && map.getLayer("hrdem-hillshade-layer")) {
          map.moveLayer("hrdem-topo-layer", "hrdem-hillshade-layer");
        }

        // 0. Courbes de niveau placées SOUS les couches d'écoulement et de dépressions
        const hydroFirstId = map.getLayer("hydro-cuvettes-layer")
          ? "hydro-cuvettes-layer"
          : (map.getLayer("hydro-flow-lines")
            ? "hydro-flow-lines"
            : (map.getLayer("hydro-flow-arrows")
              ? "hydro-flow-arrows"
              : (map.getLayer("parcelles-fill") ? "parcelles-fill" : undefined)));

        ["gc-contour-minor", "gc-contour-major", "gc-contour-labels"].forEach(id => {
          if (map.getLayer(id)) {
            map.moveLayer(id, hydroFirstId);
          }
        });

        // 0.5 Hydrographie officielle (GRHQ) au-dessus de tous les rasters et de la pédologie
        const hydroBeforeId = map.getLayer("parcelles-fill") ? "parcelles-fill" : undefined;
        if (map.getLayer("wms-layer-eau_grhq")) {
          map.moveLayer("wms-layer-eau_grhq", hydroBeforeId);
        }

        // 0.8 Écoulement & Dépressions AU-DESSUS des courbes de niveau et sous le contour des parcelles
        const hydroParcelBefore = map.getLayer("parcelles-line-bg") ? "parcelles-line-bg" : (map.getLayer("parcelles-fill") ? "parcelles-fill" : undefined);
        ["hydro-cuvettes-layer", "hydro-flow-lines", "hydro-flow-arrows"].forEach(id => {
          if (map.getLayer(id)) {
            map.moveLayer(id, hydroParcelBefore);
          }
        });
        // 1. Parcels above soils, contours, and WMS
        ["parcelles-fill", "parcelles-line-bg", "parcelles-line-fg"].forEach(id => {
          if (map.getLayer(id)) {
            map.moveLayer(id);
          }
        });
        // 2. Cadastre
        ["cadastre-fill", "cadastre-lines", "cadastre-labels"].forEach(id => {
          if (map.getLayer(id)) {
            map.moveLayer(id);
          }
        });

        // 3. Couches personnelles au SOMMET ABSOLU de toutes les couches
        if (window.vectorManager && typeof window.vectorManager.bringToFront === "function") {
          window.vectorManager.bringToFront();
        }

        // 4. Calques de mesure géodésique au sommet absolu
        if (window.measureManager && typeof window.measureManager.bringToFront === "function") {
          window.measureManager.bringToFront();
        }
      }
      window.bringParcellesToFront = bringTopLayersToFront;
      window.bringTopLayersToFront = bringTopLayersToFront;
      bringTopLayersToFront();

      // Instantiate Elevation Profile Manager
      profileManager = new ProfileManager(map);
      window.profileManager = profileManager;

      // Instantiate Parcel Hydrology Manager (Écoulement & Raster de cuvettes à la volée)
      parcelHydrologyManager = new ParcelHydrologyManager(map);
      if (parcelHydrologyManager.enabled) {
        parcelHydrologyManager.scheduleViewportUpdate();
      }

      // Instantiate Sentinel-2 NDVI Manager
      ndviManager = new NdviManager(map);
      ndviManager.initYearSelect();
      ndviManager.syncStretchUi();

      // Instantiate Soil AI Assistant
      soilAiAssistant = new SoilAiAssistant(map);

      // Instantiate WMS Layer Manager (Info-Sols & Québec services)
      wmsManager = new WmsLayerManager(map);
      wmsManager.init();
      window.wmsManager = wmsManager;

      // Instantiate Cartographic Layout Composer & PDF Exporter
      if (window.PlanDeFermeComposer) {
        window.composer = new window.PlanDeFermeComposer();
        window.composer.init(map, wmsManager);
      }

      // Instantiate Vector Manager (Couches vectorielles, Dessin, Import/Export QML & glisser-déposer)
      if (window.vectorManager) {
        window.vectorManager.init(map);
      }

      // Instantiate Measure Tool (Distances & Superficies métriques / impériales)
      if (window.measureManager) {
        window.measureManager.init(map);
      }

      // Map click handler for transect line drawing & NDVI mode
      map.on("click", (e) => {
        if (window.measureManager && window.measureManager.isActive) {
          return;
        }
        if (window.vectorManager && window.vectorManager.isDrawing) {
          return;
        }
        if (ndviManager && ndviManager.isActiveMode) {
          let parcelProps = null;
          const parcelFeatures = map.queryRenderedFeatures(e.point, { layers: ["parcelles-fill"] });
          if (parcelFeatures && parcelFeatures.length > 0) {
            parcelProps = parcelFeatures[0].properties;
          }
          ndviManager.analyzeLocation(e.lngLat, parcelProps);
          return;
        }
        if (profileManager && profileManager.isDrawing) {
          profileManager.addPoint(e.lngLat);
        }
      });

      // Double-click to complete drawing and calculate profile
      map.on("dblclick", (e) => {
        if (window.measureManager && window.measureManager.isActive) {
          return;
        }
        if (window.vectorManager && window.vectorManager.isDrawing) {
          return;
        }
        if (profileManager && profileManager.isDrawing) {
          e.preventDefault();
          if (profileManager.line.length >= 2) {
            triggerProfileCalculation();
          }
        }
      });

      // Right-click to complete drawing and calculate profile
      map.on("contextmenu", (e) => {
        if (window.measureManager && window.measureManager.isActive) {
          return;
        }
        if (window.vectorManager && window.vectorManager.isDrawing) {
          e.preventDefault();
          window.vectorManager.finishDrawing();
          return;
        }
        if (profileManager && profileManager.isDrawing) {
          e.preventDefault();
          if (profileManager.line.length >= 2) {
            triggerProfileCalculation();
          }
        }
      });

      // Synchronisation visuelle de l'état des couches selon le niveau de zoom
      function updateLayersZoomState() {
        if (!map) return;
        const zoom = map.getZoom();

        const toolRules = [
          {
            id: "card-topo",
            checkboxId: "toggle-topo",
            minZoom: 7,
            maxZoom: Infinity,
            badgeText: "z ≥ 7",
            title: "Relief MNE non affiché à ce niveau de zoom (visible dès le zoom 7)"
          },
          {
            id: "card-pentes",
            checkboxId: "toggle-pentes",
            minZoom: 7,
            maxZoom: Infinity,
            badgeText: "z ≥ 7",
            title: "Pentes non affichées à ce niveau de zoom (visibles dès le zoom 7)"
          },
          {
            id: "card-canopee",
            checkboxId: "toggle-canopee",
            minZoom: 7,
            maxZoom: Infinity,
            badgeText: "z ≥ 7",
            title: "Canopée non affichée à ce niveau de zoom (visible dès le zoom 7)"
          },
          {
            id: "card-contours",
            checkboxId: "toggle-contours",
            minZoom: 11,
            maxZoom: Infinity,
            badgeText: "z ≥ 11",
            title: "Courbes de niveau non affichées à ce niveau de zoom (visibles dès le zoom 11)"
          },
          {
            id: "card-hydro-parcelle",
            checkboxId: "toggle-hydro-parcelle",
            minZoom: 12.8,
            maxZoom: Infinity,
            badgeText: "z ≥ 13",
            title: "Écoulement & dépressions non affichés à ce niveau de zoom (visibles dès le zoom 13)"
          },
          {
            id: "card-pedo",
            checkboxId: "toggle-pedo",
            minZoom: 3,
            maxZoom: Infinity,
            badgeText: "z ≥ 3",
            title: "Sols non affichés à ce niveau de zoom (visibles dès le zoom 3)"
          },
          {
            id: "card-parcelles",
            checkboxId: "toggle-parcelles",
            minZoom: 3,
            maxZoom: Infinity,
            badgeText: "z ≥ 3",
            title: "Parcelles non affichées à ce niveau de zoom (visibles dès le zoom 3)"
          }
        ];

        toolRules.forEach(rule => {
          const card = document.getElementById(rule.id) || (rule.checkboxId && document.getElementById(rule.checkboxId)?.closest(".tool-card, .topo-sub-accordion"));
          if (!card) return;
          const isVisibleAtZoom = zoom >= rule.minZoom && zoom <= rule.maxZoom;

          let badge = card.querySelector(".layer-zoom-badge");
          if (!badge && (rule.minZoom > 3 || rule.maxZoom < Infinity)) {
            badge = document.createElement("span");
            badge.className = "layer-zoom-badge";
            const titleEl = card.querySelector(".tool-card-title") || card.querySelector(".topo-sub-title");
            if (titleEl) titleEl.appendChild(badge);
          }

          if (!isVisibleAtZoom) {
            card.classList.add("layer-out-of-zoom");
            card.setAttribute("title", rule.title);
            if (badge) {
              badge.textContent = rule.badgeText;
              badge.classList.remove("visible-now");
            }
          } else {
            card.classList.remove("layer-out-of-zoom");
            card.removeAttribute("title");
            if (badge) {
              badge.classList.add("visible-now");
            }
          }
        });

        if (wmsManager && typeof wmsManager.updateZoomState === "function") {
          wmsManager.updateZoomState(zoom);
        }

        const btnQuickProfile = document.getElementById("btn-quick-profile");
        if (btnQuickProfile) {
          if (zoom < 7) {
            btnQuickProfile.classList.add("btn-out-of-zoom");
            btnQuickProfile.title = "Zoomer (z7+) pour tracer une coupe MNT";
          } else {
            btnQuickProfile.classList.remove("btn-out-of-zoom");
            btnQuickProfile.title = "Tracer une coupe topographique (cliquez sur la carte, double-clic ou clic droit pour calculer)";
          }
        }
      }
      window.updateLayersZoomState = updateLayersZoomState;

      // Camera zoom & move listeners
      map.on('zoom', updateLayersZoomState);
      map.on('zoomend', updateLayersZoomState);
      updateLayersZoomState();

      // Camera move listeners
      map.on('moveend', () => {
        if (topoManager && topoManager.enabled) topoManager.scheduleUpdate();
        if (pentesManager && pentesManager.enabled) pentesManager.scheduleUpdate();
        if (canopeeManager && canopeeManager.enabled) canopeeManager.scheduleUpdate();
        
        const toggleContoursEl = document.getElementById("toggle-contours");
        if (contourManager && toggleContoursEl && toggleContoursEl.checked) {
          contourManager.generateForView();
        }

        if (parcelHydrologyManager && parcelHydrologyManager.enabled) {
          parcelHydrologyManager.scheduleViewportUpdate();
        }
      });

      // Cursor pointer on polygon hover
      map.on("mouseenter", "pedologie-fill", () => {
        if (profileManager && profileManager.isDrawing) return;
        map.getCanvas().style.cursor = (ndviManager && ndviManager.isActiveMode) ? "crosshair" : "pointer";
      });
      map.on("mouseleave", "pedologie-fill", () => {
        if (profileManager && profileManager.isDrawing) return;
        map.getCanvas().style.cursor = (ndviManager && ndviManager.isActiveMode) ? "crosshair" : "";
      });
      map.on("mouseenter", "parcelles-fill", () => {
        if (profileManager && profileManager.isDrawing) return;
        map.getCanvas().style.cursor = (ndviManager && ndviManager.isActiveMode) ? "crosshair" : "pointer";
      });
      map.on("mouseleave", "parcelles-fill", () => {
        if (profileManager && profileManager.isDrawing) return;
        map.getCanvas().style.cursor = (ndviManager && ndviManager.isActiveMode) ? "crosshair" : "";
      });

      // Unified Tabbed Popup for Sols, Cultures, and NDVI
      function openTabbedFeaturePopup(e, defaultTab) {
        if (profileManager && profileManager.isDrawing) return;
        if (ndviManager && ndviManager.isActiveMode) {
          let parcelProps = null;
          const parcelFeatures = map.queryRenderedFeatures(e.point, { layers: ["parcelles-fill"].filter(l => map.getLayer(l)) });
          if (parcelFeatures && parcelFeatures.length > 0) {
            parcelProps = parcelFeatures[0].properties;
          }
          ndviManager.analyzeLocation(e.lngLat, parcelProps);
          return;
        }

        // 1. Query pedologie (from visible layer or hit layer)
        let pedoProps = null;
        let pedoGeom = null;
        const pedoHits = map.queryRenderedFeatures(e.point, {
          layers: ["pedologie-fill", "pedologie-hit-layer"].filter(l => map.getLayer(l))
        });
        if (pedoHits && pedoHits.length > 0) {
          pedoProps = pedoHits[0].properties;
          pedoGeom = pedoHits[0].geometry;
        }

        // 2. Query parcelles (from visible layer or hit layer)
        let parcelProps = null;
        let parcelGeom = null;
        const parcelHits = map.queryRenderedFeatures(e.point, {
          layers: ["parcelles-fill", "parcelles-hit-layer"].filter(l => map.getLayer(l))
        });
        if (parcelHits && parcelHits.length > 0) {
          parcelProps = parcelHits[0].properties;
          parcelGeom = parcelHits[0].geometry;
        }

        // 3. Query cadastre (lots rénovés)
        let cadastreProps = null;
        const cadastreHits = map.queryRenderedFeatures(e.point, {
          layers: ["cadastre-fill"].filter(l => map.getLayer(l))
        });
        if (cadastreHits && cadastreHits.length > 0) {
          cadastreProps = cadastreHits[0].properties;
        }

        // 4. Query drainage (plans de drainage agricole)
        let drainagePlans = [];
        const seenDrainageKeys = new Set();
        const drainageBbox = [
          [e.point.x - 5, e.point.y - 5],
          [e.point.x + 5, e.point.y + 5]
        ];
        const drainageHits = map.queryRenderedFeatures(drainageBbox, {
          layers: ["drainage-fill"].filter(l => map.getLayer(l))
        });

        const activeDrainageLots = new Set();
        if (cadastreProps && cadastreProps.NO_LOT) {
          activeDrainageLots.add(String(cadastreProps.NO_LOT).trim());
        }

        if (drainageHits && drainageHits.length > 0) {
          drainageHits.forEach(h => {
            const p = h.properties || {};
            if (p.no_lot) activeDrainageLots.add(String(p.no_lot).trim());
            const key = (p.nom || "") + "___" + (p.url || "") + "___" + (p.no_lot || "");
            if (key !== "___" && !seenDrainageKeys.has(key)) {
              seenDrainageKeys.add(key);
              drainagePlans.push(p);
            }
          });
        }

        // If a lot number is known and drainage layer is rendered, also check any sister plans rendered for that exact same lot
        if (activeDrainageLots.size > 0 && map.getLayer("drainage-fill")) {
          const sisterHits = map.queryRenderedFeatures({ layers: ["drainage-fill"] });
          sisterHits.forEach(h => {
            const p = h.properties || {};
            const lot = String(p.no_lot || "").trim();
            if (lot && activeDrainageLots.has(lot)) {
              const key = (p.nom || "") + "___" + (p.url || "") + "___" + (p.no_lot || "");
              if (key !== "___" && !seenDrainageKeys.has(key)) {
                seenDrainageKeys.add(key);
                drainagePlans.push(p);
              }
            }
          });
        }

        // Natural sort by plan name (page 1 before page 2, page 9 before page 10, etc.)
        drainagePlans.sort((a, b) => {
          const nomA = a.nom || "";
          const nomB = b.nom || "";
          return nomA.localeCompare(nomB, undefined, { numeric: true, sensitivity: "base" });
        });

        const drainageProps = drainagePlans.length > 0 ? drainagePlans[0] : null;

        if (!pedoProps && !parcelProps && !cadastreProps && drainagePlans.length === 0) return;

        // If only cadastre was clicked (neither pedology, parcel, nor drainage)
        if (!pedoProps && !parcelProps && drainagePlans.length === 0 && cadastreProps) {
          const lotNum = cadastreProps.NO_LOT || "Inconnu";
          const lotHtml = `
            <div class="pedo-popup" style="padding: 10px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Cadastre du Québec</div>
              <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">Lot nº ${lotNum}</div>
              <div style="font-size: 11px; color: #64748b;">Registre foncier officiel du Québec (MRNF)</div>
            </div>
          `;
          new maplibregl.Popup({ maxWidth: "280px", className: "pedo-custom-popup" })
            .setLngLat(e.lngLat)
            .setHTML(lotHtml)
            .addTo(map);
          return;
        }

        // If only drainage plan was clicked (with optional cadastre info)
        if (!pedoProps && !parcelProps && drainagePlans.length > 0) {
          const lotsList = Array.from(new Set(drainagePlans.map(p => p.no_lot).filter(Boolean)));
          const lotLabel = lotsList.length > 0 
            ? lotsList.join(", ") 
            : (cadastreProps ? cadastreProps.NO_LOT : "Inconnu");

          const formatDrainageUrl = (raw) => {
            if (!raw || typeof raw !== "string") return "";
            let u = raw.trim();
            if (u.includes("/dbase/fichiers/")) u = u.replace("/dbase/fichiers/", "/api/fichiers/");
            return u;
          };

          let plansListHtml = "";
          if (drainagePlans.length === 1) {
            const dp = drainagePlans[0];
            const nomFichier = dp.nom || "Plan_drainage.jpg";
            const planUrl = formatDrainageUrl(dp.url || "");
            plansListHtml = `
              <div style="font-size: 11.5px; color: #475569; margin-bottom: 10px;">Fichier : <code style="font-size: 11px; background: #f1f5f9; padding: 2px 4px; border-radius: 3px; color: #0f172a;">${nomFichier}</code></div>
              ${planUrl ? `
                <a href="${planUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 6px; background: #0284c7; color: #ffffff; text-decoration: none; font-size: 11.5px; font-weight: 600; padding: 7px 12px; border-radius: 5px; box-sizing: border-box; transition: background 0.15s ease;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  <span>Consulter le plan numérisé (JPG)</span>
                </a>
              ` : '<div style="color: #94a3b8; font-size: 11px;">Lien indisponible.</div>'}
            `;
          } else {
            plansListHtml = `
              <div style="font-size: 11px; color: #64748b; margin-bottom: 8px;">
                ${drainagePlans.length} documents répertoriés à cet emplacement :
              </div>
              <div style="max-height: 250px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px;">
                ${drainagePlans.map((dp, idx) => {
                  const nom = dp.nom || `Document ${idx + 1}`;
                  const planUrl = formatDrainageUrl(dp.url || "");
                  const subLot = dp.no_lot ? `<span style="font-size: 9.5px; color: #0284c7; background: #e0f2fe; padding: 1px 4px; border-radius: 3px; font-weight: 600; margin-left: auto;">Lot ${dp.no_lot}</span>` : "";
                  return `
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #0284c7; border-radius: 5px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px;">
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="font-weight: 600; font-size: 11px; color: #0f172a; word-break: break-all; line-height: 1.3;">${nom}</span>
                        ${subLot}
                      </div>
                      <div style="display: flex; align-items: center; justify-content: flex-end; margin-top: 2px;">
                        ${planUrl ? `
                          <a href="${planUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; background: #0284c7; color: #ffffff; text-decoration: none; font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 4px; transition: background 0.15s ease;">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            <span>Ouvrir (JPG)</span>
                          </a>
                        ` : '<span style="color: #94a3b8; font-size: 10px;">Lien indisponible</span>'}
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            `;
          }

          const drainageHtml = `
            <div class="pedo-popup" style="padding: 12px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 260px; max-width: 320px;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                <span style="font-size: 10px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 0.5px; background: #e0f2fe; padding: 2px 6px; border-radius: 4px;">
                  ${drainagePlans.length > 1 ? `Plans de drainage (${drainagePlans.length})` : "Plan de drainage"}
                </span>
                <span style="font-size: 11px; color: #64748b; margin-left: auto;">Info-Sols</span>
              </div>
              <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">Lot nº ${lotLabel}</div>
              ${plansListHtml}
            </div>
          `;
          new maplibregl.Popup({ maxWidth: "340px", className: "pedo-custom-popup", closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(drainageHtml)
            .addTo(map);
          return;
        }

        let activeTab = defaultTab || (drainagePlans.length > 0 && defaultTab === "drainage" ? "drainage" : (pedoProps ? "sols" : (parcelProps ? "cultures" : "drainage")));
        if (!pedoProps && parcelProps) activeTab = defaultTab || "cultures";
        if (!parcelProps && pedoProps && activeTab === "cultures") activeTab = "sols";
        if (defaultTab === "drainage" && drainagePlans.length > 0) activeTab = "drainage";

        // Tab 1: Sols HTML
        let solsTabHtml = "";
        if (pedoProps) {
          const p = pedoProps;
          const rawEtude = String(p.No_etude || p.etude_code || "").trim();
          const etudeUrl = (p.etude_url || "").trim();
          const appellation = (p.Appellation_cartographique || "").trim();

          let studyInfo = null;
          let cleanEtudeCode = rawEtude.replace(/^0+/, "");
          if (rawEtude) {
            studyInfo = STUDY_NAMES[rawEtude] || STUDY_NAMES[cleanEtudeCode] || STUDY_NAMES[rawEtude.padStart(2, "0")];
          }
          const studyTitle = studyInfo ? studyInfo.title : (rawEtude ? "Étude pédologique nº " + rawEtude : "Étude pédologique");
          const studyYear = studyInfo ? studyInfo.year : "";
          const localPqFile = "pq" + cleanEtudeCode.toLowerCase() + ".html";

          let cardsHtml = "";
          let validSeriesCount = 0;
          for (let i = 1; i <= 4; i++) {
            const desc = (p["s" + i + "_desc"] || "").trim();
            const rawPct = p["s" + i + "_pct"];
            const pctNum = parseFloat(rawPct);
            const rawUrl = (p["s" + i + "_url"] || "").trim();
            if (!desc || isNaN(pctNum) || pctNum <= 0) continue;
            validSeriesCount++;
            const pctDisplay = Math.round(pctNum);
            cardsHtml += `
              <div class="pedo-series-card">
                <div class="pedo-series-top">
                  <span class="pedo-series-name">${desc}</span>
                  <span class="pedo-series-pct">${pctDisplay}%</span>
                </div>
                <div class="pedo-progress-track">
                  <div class="pedo-progress-fill" style="width: ${Math.min(pctDisplay, 100)}%;"></div>
                </div>
                ${rawUrl ? `
                  <div class="pedo-series-action">
                    <a href="${rawUrl}" target="_blank" rel="noopener noreferrer" class="pedo-series-link">
                      <span>Consulter la fiche descriptive</span>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                    </a>
                  </div>` : ""}
              </div>
            `;
          }
          if (!cardsHtml) {
            cardsHtml = '<div style="color: #64748b; font-style: italic; padding: 6px 0;">Séries de sols non détaillées pour ce polygone.</div>';
          }

          solsTabHtml = `
            <div class="pedo-study-meta">
              ${rawEtude ? `<span class="pedo-study-badge">Étude nº ${rawEtude}</span>` : ""}
              ${studyYear ? `<span class="pedo-study-year">(${studyYear})</span>` : ""}
            </div>
            <h3 class="pedo-popup-title">${studyTitle}</h3>
            ${appellation ? `<div class="pedo-appellation" title="Appellation cartographique">${appellation}</div>` : ""}
            
            <div class="pedo-links-row">
              <a href="${localPqFile}" target="_blank" rel="noopener noreferrer" class="pedo-study-link">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
                <span>Mémoire sur le portail &rarr;</span>
              </a>
              ${etudeUrl ? `
                <a href="${etudeUrl}" target="_blank" rel="noopener noreferrer" class="pedo-pdf-link">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                  </svg>
                  <span>Rapport PDF &rarr;</span>
                </a>` : ""}
            </div>

            ${validSeriesCount > 0 ? '<div class="pedo-series-heading" style="margin-top: 6px;">Séries de sols identifiées</div>' : ''}
            ${cardsHtml}

            <button id="btn-tab-ai-identify" type="button" class="btn-popup-ai" style="margin-top: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg>
              <span>Identifier la série de sol (Diagnostic terrain)</span>
            </button>
            <button type="button" class="btn-popup-rag" data-query="${appellation ? `Gestion agronomique des sols : ${appellation}` : 'Gestion des sols agricoles au Québec'}" title="Consulter la base documentaire Agri-Réseau">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              <span>Consulter Agri-Réseau pour ce sol</span>
            </button>
          `;
        } else {
          solsTabHtml = `
            <div style="color: #64748b; font-size: 12px; padding: 16px 4px; text-align: center;">
              Aucune donnée pédologique cartographiée sous ce point.
            </div>
          `;
        }

        // Tab 2: Cultures HTML
        let culturesTabHtml = "";
        if (parcelProps) {
          const pf = parcelProps;
          const pid = pf.IDPAR || pf.idpar || "";
          const sup = pf.SUPHEC || pf.suphec || "";
          const crop = pf.DESCODPR1 || pf.descodpr1 || "";
          const group = pf.DESGROPRO || pf.desgropro || "";
          const supNum = parseFloat(sup);
          const supStr = !isNaN(supNum) ? supNum.toFixed(1) + " ha" : (sup ? sup + " ha" : "");

          culturesTabHtml = `
            <div class="parcel-info-badge" style="padding: 9px 11px; background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3.5px solid #0f172a; border-radius: 6px; font-size: 0.8rem;">
              <div style="font-weight: 700; color: #0f172a; display: flex; justify-content: space-between; align-items: center;">
                <span>Parcelle BDPPAD ${pid ? `nº ${pid}` : ''}</span>
                ${supStr ? `<span style="font-weight: 700; color: #1e293b;">${supStr}</span>` : ''}
              </div>
              ${crop ? `<div style="color: #334155; margin-top: 4px;">Culture 2026 : <strong>${crop}</strong>${group ? ` <span style="color:#64748b;">(${group})</span>` : ''}</div>` : ''}
              ${cadastreProps && cadastreProps.NO_LOT ? `<div style="color: #475569; margin-top: 3px; font-size: 11px;">Lot cadastre rénové : <strong>nº ${cadastreProps.NO_LOT}</strong></div>` : ''}
              <button type="button" class="btn-popup-rag" data-query="${crop ? `Pratiques agronomiques pour la culture : ${crop}` : 'Rotation et santé des sols agricoles'}" title="Consulter la base documentaire Agri-Réseau pour cette culture" style="margin-top: 6px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                <span>Consulter Agri-Réseau pour cette culture</span>
              </button>
            </div>

            <div class="popup-crop-history" style="margin-top: 8px;">
              <div class="crop-history-header">
                <span class="crop-history-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span>Historique des rotations (2003–2026)</span>
                </span>
                <span class="crop-history-badge">Chargement...</span>
              </div>
              <div class="crop-history-content">
                <div style="color: #64748b; font-size: 11px; padding: 4px 0;">Recherche des rotations culturales...</div>
              </div>
            </div>
          `;
        } else {
          culturesTabHtml = `
            <div style="color: #64748b; font-size: 11.5px; padding: 4px 0; line-height: 1.45;">
              Aucun contour de parcelle BDPPAD 2026 enregistré à cet endroit précis.
            </div>
            <div class="popup-crop-history" style="margin-top: 8px;">
              <div class="crop-history-header">
                <span class="crop-history-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span>Recherche historique (2003–2026)</span>
                </span>
                <span class="crop-history-badge">Chargement...</span>
              </div>
              <div class="crop-history-content">
                <div style="color: #64748b; font-size: 11px; padding: 4px 0;">Recherche des rotations culturales...</div>
              </div>
            </div>
          `;
        }

        // Tab 3: NDVI HTML
        const ndviTabHtml = `
          <div style="font-size: 12px; color: #334155; line-height: 1.5; padding: 4px 0;">
            <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px; font-size: 12.5px;">Vigueur Végétale &mdash; Sentinel-2</div>
            <p style="margin: 0 0 10px 0; color: #475569; font-size: 11.5px;">
              Analysez la courbe annuelle de l'indice de végétation par différence normalisée (NDVI) à 10 m de résolution pour ce point ou cette parcelle agricole (2018&ndash;2026).
            </p>
            <button id="btn-tab-ndvi" type="button" class="btn-popup-ndvi">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path></svg>
              <span>Analyser l'évolution NDVI annuelle</span>
            </button>
          </div>
        `;

        // Tab 4: Drainage HTML
        let drainageTabHtml = "";
        if (drainagePlans.length > 0) {
          const lotsList = Array.from(new Set(drainagePlans.map(p => p.no_lot).filter(Boolean)));
          const lotVal = lotsList.length > 0 
            ? lotsList.join(", ") 
            : (cadastreProps ? cadastreProps.NO_LOT : "Inconnu");

          const formatDrainageUrl = (raw) => {
            if (!raw || typeof raw !== "string") return "";
            let u = raw.trim();
            if (u.includes("/dbase/fichiers/")) u = u.replace("/dbase/fichiers/", "/api/fichiers/");
            return u;
          };

          if (drainagePlans.length === 1) {
            const dp = drainagePlans[0];
            const nomFichier = dp.nom || "Plan_drainage.jpg";
            const planUrl = formatDrainageUrl(dp.url || "");

            drainageTabHtml = `
              <div class="parcel-info-badge" style="padding: 10px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-left: 3.5px solid #0284c7; border-radius: 6px; font-size: 0.8rem; margin-bottom: 10px;">
                <div style="font-weight: 700; color: #0369a1; display: flex; justify-content: space-between; align-items: center;">
                  <span>Plan de drainage souterrain</span>
                  <span style="font-weight: 700; color: #0284c7;">Lot nº ${lotVal}</span>
                </div>
                <div style="color: #334155; margin-top: 5px; font-size: 11.5px;">Fichier : <code style="font-size: 10.5px; background: #e0f2fe; padding: 2px 5px; border-radius: 3px; color: #0369a1;">${nomFichier}</code></div>
                <div style="color: #64748b; margin-top: 3px; font-size: 11px;">Source : Cartothèque Info-Sols / MAPAQ</div>
              </div>

              <p style="margin: 0 0 12px 0; color: #475569; font-size: 11.5px; line-height: 1.45;">
                Ce polygone correspond à un aménagement de drains agricoles souterrains numérisé à haute résolution.
              </p>

              ${planUrl ? `
                <a href="${planUrl}" target="_blank" rel="noopener noreferrer" class="pedo-study-link" style="background: #0284c7; color: #ffffff; text-decoration: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; font-size: 11.5px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; width: 100%; box-sizing: border-box; transition: background 0.15s ease;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                  <span>Consulter le plan numérisé (JPG)</span>
                </a>
              ` : '<div style="color: #94a3b8; font-size: 11px;">Lien du document non disponible.</div>'}
            `;
          } else {
            drainageTabHtml = `
              <div class="parcel-info-badge" style="padding: 10px 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-left: 3.5px solid #0284c7; border-radius: 6px; font-size: 0.8rem; margin-bottom: 10px;">
                <div style="font-weight: 700; color: #0369a1; display: flex; justify-content: space-between; align-items: center;">
                  <span>Plans de drainage souterrain</span>
                  <span style="font-weight: 700; color: #0284c7;">Lot nº ${lotVal}</span>
                </div>
                <div style="color: #334155; margin-top: 4px; font-size: 11.5px;">
                  <strong>${drainagePlans.length} plans ou feuillets</strong> numérisés pour cet emplacement.
                </div>
                <div style="color: #64748b; margin-top: 2px; font-size: 11px;">Source : Cartothèque Info-Sols / MAPAQ</div>
              </div>

              <div style="max-height: 230px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px;">
                ${drainagePlans.map((dp, idx) => {
                  const nom = dp.nom || `Document ${idx + 1}`;
                  const planUrl = formatDrainageUrl(dp.url || "");
                  const subLot = dp.no_lot ? `<span style="font-size: 9.5px; color: #0284c7; background: #e0f2fe; padding: 1px 4px; border-radius: 3px; font-weight: 600; margin-left: auto;">Lot ${dp.no_lot}</span>` : "";
                  return `
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #0284c7; border-radius: 5px; padding: 7px 9px; display: flex; flex-direction: column; gap: 5px;">
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="font-weight: 600; font-size: 11px; color: #0f172a; word-break: break-all; line-height: 1.3;">${nom}</span>
                        ${subLot}
                      </div>
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 10px; color: #64748b;">Feuillet JPG</span>
                        ${planUrl ? `
                          <a href="${planUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; background: #0284c7; color: #ffffff; text-decoration: none; font-size: 10.5px; font-weight: 600; padding: 3px 8px; border-radius: 4px; transition: background 0.15s ease;">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            <span>Ouvrir (JPG)</span>
                          </a>
                        ` : '<span style="color: #94a3b8; font-size: 10px;">Lien indisponible</span>'}
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            `;
          }
        } else {
          drainageTabHtml = `
            <div style="color: #64748b; font-size: 12px; padding: 16px 4px; text-align: center;">
              Aucun périmètre de plan de drainage agricole répertorié sous ce point.
            </div>
          `;
        }

        const popupHtml = `
          <div class="pedo-popup">
            <div class="popup-tabs-header">
              <button type="button" class="popup-tab-btn ${activeTab === 'sols' ? 'active' : ''}" data-tab="sols">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                <span>Sols</span>
              </button>
              <button type="button" class="popup-tab-btn ${activeTab === 'cultures' ? 'active' : ''}" data-tab="cultures">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>
                <span>Cultures</span>
                ${parcelProps ? `<span class="popup-tab-dot" title="Parcelle agricole présente"></span>` : ''}
              </button>
              <button type="button" class="popup-tab-btn ${activeTab === 'ndvi' ? 'active' : ''}" data-tab="ndvi">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path></svg>
                <span>NDVI</span>
              </button>
              ${drainagePlans.length > 0 ? `
              <button type="button" class="popup-tab-btn ${activeTab === 'drainage' ? 'active' : ''}" data-tab="drainage">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
                <span>Drainage${drainagePlans.length > 1 ? ` (${drainagePlans.length})` : ''}</span>
                <span class="popup-tab-dot" title="${drainagePlans.length} plan(s) de drainage disponible(s)" style="background: #0284c7;"></span>
              </button>` : ''}
            </div>
            <div class="popup-tab-pane ${activeTab === 'sols' ? 'active' : ''}" data-tab="sols">
              ${solsTabHtml}
            </div>
            <div class="popup-tab-pane ${activeTab === 'cultures' ? 'active' : ''}" data-tab="cultures">
              ${culturesTabHtml}
            </div>
            <div class="popup-tab-pane ${activeTab === 'ndvi' ? 'active' : ''}" data-tab="ndvi">
              ${ndviTabHtml}
            </div>
            ${drainagePlans.length > 0 ? `
            <div class="popup-tab-pane ${activeTab === 'drainage' ? 'active' : ''}" data-tab="drainage">
              ${drainageTabHtml}
            </div>` : ''}
          </div>
        `;

        const popup = new maplibregl.Popup({ closeButton: true, offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(popupHtml)
          .addTo(map);

        const popupDom = popup.getElement();
        if (popupDom) {
          // Tab switching
          const tabBtns = popupDom.querySelectorAll(".popup-tab-btn");
          const tabPanes = popupDom.querySelectorAll(".popup-tab-pane");
          tabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
              const tabName = btn.dataset.tab;
              tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
              tabPanes.forEach(p => p.classList.toggle("active", p.dataset.tab === tabName));
            });
          });

          // NDVI trigger
          const btnNdviInPopup = popupDom.querySelector("#btn-tab-ndvi");
          if (btnNdviInPopup) {
            btnNdviInPopup.addEventListener("click", () => {
              popup.remove();
              if (ndviManager) ndviManager.analyzeLocation(e.lngLat, parcelProps);
            });
          }

          // Diagnostic terrain IA trigger
          const btnAiInPopup = popupDom.querySelector("#btn-tab-ai-identify");
          if (btnAiInPopup) {
            btnAiInPopup.addEventListener("click", () => {
              popup.remove();
              if (soilAiAssistant) {
                soilAiAssistant.openWithContext(e.lngLat, pedoProps, pedoGeom);
              }
            });
          }

          // Agri-Réseau RAG popup trigger
          const ragPopupBtns = popupDom.querySelectorAll(".btn-popup-rag");
          ragPopupBtns.forEach(btn => {
            btn.addEventListener("click", () => {
              const query = btn.dataset.query || "";
              if (window.ragManager) {
                window.ragManager.open(query);
              }
            });
          });



          // Trigger crop history query
          loadCropHistory(e.lngLat, popupDom, parcelProps);
        }
      }

      // Helper to check if click should be ignored by background analysis layers
      const isVectorInteraction = (e) => {
        if (window.measureManager && window.measureManager.isActive) return true;
        if (window.vectorManager && window.vectorManager.isDrawing) return true;
        try {
          const vectorHits = map.queryRenderedFeatures(e.point).filter(f => f.layer && f.layer.id && f.layer.id.startsWith("vector-") && !f.layer.id.startsWith("vector-draw"));
          if (vectorHits.length > 0) return true;
        } catch (err) {}
        return false;
      };

      // Click on drainage-fill
      map.on("click", "drainage-fill", (e) => {
        if (isVectorInteraction(e)) return;
        if (e.originalEvent && e.originalEvent._handled) return;
        if (e.originalEvent) e.originalEvent._handled = true;
        openTabbedFeaturePopup(e, "drainage");
      });

      // Click on pedologie-fill
      map.on("click", "pedologie-fill", (e) => {
        if (isVectorInteraction(e)) return;
        if (e.originalEvent && e.originalEvent._handled) return;
        const drainageFeatures = map.queryRenderedFeatures(e.point, { layers: ["drainage-fill"].filter(l => map.getLayer(l)) });
        if (drainageFeatures && drainageFeatures.length > 0) {
          if (e.originalEvent) e.originalEvent._handled = true;
          openTabbedFeaturePopup(e, "drainage");
          return;
        }
        if (e.originalEvent) e.originalEvent._handled = true;
        openTabbedFeaturePopup(e, "sols");
      });

      // Click on parcelles-fill
      map.on("click", "parcelles-fill", (e) => {
        if (isVectorInteraction(e)) return;
        if (e.originalEvent && e.originalEvent._handled) return;
        const drainageFeatures = map.queryRenderedFeatures(e.point, { layers: ["drainage-fill"].filter(l => map.getLayer(l)) });
        if (drainageFeatures && drainageFeatures.length > 0) {
          if (e.originalEvent) e.originalEvent._handled = true;
          openTabbedFeaturePopup(e, "drainage");
          return;
        }
        const pedoFeatures = map.queryRenderedFeatures(e.point, { layers: ["pedologie-fill"].filter(l => map.getLayer(l)) });
        if (pedoFeatures && pedoFeatures.length > 0) return; // Handled by pedologie-fill click
        if (e.originalEvent) e.originalEvent._handled = true;
        openTabbedFeaturePopup(e, "cultures");
      });

      // Click on cadastre-fill
      map.on("click", "cadastre-fill", (e) => {
        if (isVectorInteraction(e)) return;
        if (e.originalEvent && e.originalEvent._handled) return;
        const drainageFeatures = map.queryRenderedFeatures(e.point, { layers: ["drainage-fill"].filter(l => map.getLayer(l)) });
        if (drainageFeatures && drainageFeatures.length > 0) {
          if (e.originalEvent) e.originalEvent._handled = true;
          openTabbedFeaturePopup(e, "drainage");
          return;
        }
        const otherFeatures = map.queryRenderedFeatures(e.point, { layers: ["pedologie-fill", "parcelles-fill"].filter(l => map.getLayer(l)) });
        if (otherFeatures && otherFeatures.length > 0) return; // Handled by pedologie or parcelles
        if (e.originalEvent) e.originalEvent._handled = true;
        openTabbedFeaturePopup(e, "cultures");
      });

      // Hover on drainage-fill
      map.on("mouseenter", "drainage-fill", () => {
        if (profileManager && profileManager.isDrawing) return;
        map.getCanvas().style.cursor = (ndviManager && ndviManager.isActiveMode) ? "crosshair" : "pointer";
      });
      map.on("mouseleave", "drainage-fill", () => {
        if (profileManager && profileManager.isDrawing) return;
        map.getCanvas().style.cursor = (ndviManager && ndviManager.isActiveMode) ? "crosshair" : "";
      });
    });

    // --- UI Controls Event Handlers ---

    // Basemap Switcher
    const btnPlan = document.getElementById("btn-basemap-plan");
    const btnSat = document.getElementById("btn-basemap-sat");

    btnPlan.addEventListener("click", () => {
      btnPlan.classList.add("active");
      btnSat.classList.remove("active");
      if (map.getLayer("google-hybrid-layer")) {
        map.setLayoutProperty("google-hybrid-layer", "visibility", "none");
      }
      if (typeof bringTopLayersToFront === "function") bringTopLayersToFront();
    });

    btnSat.addEventListener("click", () => {
      btnSat.classList.add("active");
      btnPlan.classList.remove("active");
      if (map.getLayer("google-hybrid-layer")) {
        map.setLayoutProperty("google-hybrid-layer", "visibility", "visible");
      }
      if (typeof bringTopLayersToFront === "function") bringTopLayersToFront();
    });

    // Pedo Layer Toggle & Opacity Slider
    const togglePedo = document.getElementById("toggle-pedo");
    const opacitySlider = document.getElementById("pedo-opacity");
    const opacityVal = document.getElementById("opacity-val");

    function updatePedoLayerVisibility() {
      const isVisible = togglePedo.checked;
      const opacity = isVisible ? (parseInt(opacitySlider.value, 10) / 100) : 0;
      
      opacityVal.textContent = isVisible ? (opacitySlider.value + "%") : "Masqué";
      
      if (map.getLayer("pedologie-fill")) {
        map.setLayoutProperty("pedologie-fill", "visibility", isVisible ? "visible" : "none");
        map.setPaintProperty("pedologie-fill", "fill-opacity", opacity);
      }
      if (map.getLayer("pedologie-line")) {
        map.setLayoutProperty("pedologie-line", "visibility", isVisible ? "visible" : "none");
        map.setPaintProperty("pedologie-line", "line-opacity", opacity * 0.5);
      }
      if (map.getLayer("pedologie-labels")) {
        map.setLayoutProperty("pedologie-labels", "visibility", isVisible ? "visible" : "none");
        map.setPaintProperty("pedologie-labels", "text-opacity", opacity);
      }
      if (typeof bringTopLayersToFront === "function") bringTopLayersToFront();
    }

    togglePedo.addEventListener("change", updatePedoLayerVisibility);
    opacitySlider.addEventListener("input", updatePedoLayerVisibility);

    // Parcelles agricoles Controls
    const toggleParcelles = document.getElementById("toggle-parcelles");
    const parcellesOpacity = document.getElementById("parcelles-opacity");
    const parcellesOpacityVal = document.getElementById("parcelles-opacity-val");

    if (toggleParcelles) {
      toggleParcelles.addEventListener("change", (e) => {
        const vis = e.target.checked ? "visible" : "none";
        ["parcelles-fill", "parcelles-line-bg", "parcelles-line-fg"].forEach(id => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", vis);
          }
        });
      });
    }

    if (parcellesOpacity) {
      parcellesOpacity.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        const opacity = val / 100;
        if (parcellesOpacityVal) parcellesOpacityVal.textContent = val + "%";
        ["parcelles-line-bg", "parcelles-line-fg"].forEach(id => {
          if (map.getLayer(id)) {
            map.setPaintProperty(id, "line-opacity", opacity);
          }
        });
      });
    }

    // Hydrologie Parcellaire Controls
    const toggleHydroParcelle = document.getElementById("toggle-hydro-parcelle");
    const btnClearHydroParcelle = document.getElementById("btn-clear-hydro-parcelle");

    if (toggleHydroParcelle) {
      toggleHydroParcelle.addEventListener("change", (e) => {
        if (parcelHydrologyManager) {
          parcelHydrologyManager.setEnabled(e.target.checked);
        }
      });
    }

    if (btnClearHydroParcelle) {
      btnClearHydroParcelle.addEventListener("click", () => {
        if (parcelHydrologyManager) {
          parcelHydrologyManager.clear();
        }
      });
    }

    // Topo Layer Toggle, Opacity & Stretch Controls
    const toggleTopo = document.getElementById("toggle-topo");
    const topoOpacitySlider = document.getElementById("topo-opacity");
    const topoOpacityVal = document.getElementById("topo-opacity-val");
    const btnStretchPct = document.getElementById("btn-stretch-pct");
    const btnStretchMinMax = document.getElementById("btn-stretch-minmax");

    toggleTopo.addEventListener("change", (e) => {
      if (topoManager) topoManager.setEnabled(e.target.checked);
    });

    topoOpacitySlider.addEventListener("input", (e) => {
      const pct = parseInt(e.target.value, 10);
      topoOpacityVal.textContent = pct + "%";
      if (topoManager) topoManager.setOpacity(pct / 100);
    });

    const btnStretchManual = document.getElementById("btn-stretch-manual");
    const topoManualBox = document.getElementById("topo-manual-box");
    const topoManualMin = document.getElementById("topo-manual-min");
    const topoManualMax = document.getElementById("topo-manual-max");
    const btnApplyTopoManual = document.getElementById("btn-apply-topo-manual");
    const topoManualError = document.getElementById("topo-manual-error");

    btnStretchPct.addEventListener("click", () => {
      btnStretchPct.classList.add("active");
      btnStretchMinMax.classList.remove("active");
      if (btnStretchManual) btnStretchManual.classList.remove("active");
      if (topoManualBox) topoManualBox.style.display = "none";
      if (topoManager) topoManager.setStretchMethod("percentile");
    });

    btnStretchMinMax.addEventListener("click", () => {
      btnStretchMinMax.classList.add("active");
      btnStretchPct.classList.remove("active");
      if (btnStretchManual) btnStretchManual.classList.remove("active");
      if (topoManualBox) topoManualBox.style.display = "none";
      if (topoManager) topoManager.setStretchMethod("minmax");
    });

    function applyManualTopoRange() {
      if (!topoManualMin || !topoManualMax || !topoManager) return;
      const mn = parseFloat(topoManualMin.value);
      const mx = parseFloat(topoManualMax.value);
      if (isNaN(mn) || isNaN(mx) || mx <= mn) {
        if (topoManualError) {
          topoManualError.textContent = "Le max doit être strictement supérieur au min.";
          topoManualError.style.display = "block";
        }
        return;
      }
      if (topoManualError) topoManualError.style.display = "none";
      topoManager.setManualRange(mn, mx);
    }

    if (btnStretchManual) {
      btnStretchManual.addEventListener("click", () => {
        btnStretchManual.classList.add("active");
        btnStretchPct.classList.remove("active");
        btnStretchMinMax.classList.remove("active");
        if (topoManualBox) {
          topoManualBox.style.display = "block";
          if ((!topoManualMin.value || !topoManualMax.value) && topoManager) {
            const curMin = Number.isFinite(topoManager.manualMin) ? topoManager.manualMin : (topoManager.lastAutoMin || 0);
            const curMax = Number.isFinite(topoManager.manualMax) ? topoManager.manualMax : (topoManager.lastAutoMax || 100);
            topoManualMin.value = curMin.toFixed(2);
            topoManualMax.value = curMax.toFixed(2);
          }
        }
        applyManualTopoRange();
      });
    }

    if (btnApplyTopoManual) {
      btnApplyTopoManual.addEventListener("click", applyManualTopoRange);
    }
    if (topoManualMin) {
      topoManualMin.addEventListener("keydown", (e) => { if (e.key === "Enter") applyManualTopoRange(); });
    }
    if (topoManualMax) {
      topoManualMax.addEventListener("keydown", (e) => { if (e.key === "Enter") applyManualTopoRange(); });
    }

    // Topo Hillshade (Ombrage 3D) Controls
    const toggleTopoHillshade = document.getElementById("toggle-topo-hillshade");
    const topoHillshadeOpacitySlider = document.getElementById("topo-hillshade-opacity");
    const topoHillshadeVal = document.getElementById("topo-hillshade-val");

    if (toggleTopoHillshade) {
      toggleTopoHillshade.addEventListener("change", (e) => {
        if (topoManager) topoManager.setHillshadeEnabled(e.target.checked);
      });
    }

    if (topoHillshadeOpacitySlider) {
      topoHillshadeOpacitySlider.addEventListener("input", (e) => {
        const pct = parseInt(e.target.value, 10);
        if (topoHillshadeVal) topoHillshadeVal.textContent = pct + "%";
        if (topoManager) topoManager.setHillshadeOpacity(pct / 100);
      });
    }

    // Carte des Pentes (%) Controls
    const togglePentes = document.getElementById("toggle-pentes");
    const pentesOpacitySlider = document.getElementById("pentes-opacity");
    const pentesOpacityVal = document.getElementById("pentes-opacity-val");

    if (togglePentes) {
      togglePentes.addEventListener("change", (e) => {
        if (pentesManager) pentesManager.setEnabled(e.target.checked);
      });
    }

    if (pentesOpacitySlider) {
      pentesOpacitySlider.addEventListener("input", (e) => {
        const pct = parseInt(e.target.value, 10);
        if (pentesOpacityVal) pentesOpacityVal.textContent = pct + "%";
        if (pentesManager) pentesManager.setOpacity(pct / 100);
      });
    }

    // Hauteur de Canopée Controls
    const toggleCanopee = document.getElementById("toggle-canopee");
    const canopeeOpacitySlider = document.getElementById("canopee-opacity");
    const canopeeOpacityVal = document.getElementById("canopee-opacity-val");

    if (toggleCanopee) {
      toggleCanopee.addEventListener("change", (e) => {
        if (canopeeManager) canopeeManager.setEnabled(e.target.checked);
      });
    }

    if (canopeeOpacitySlider) {
      canopeeOpacitySlider.addEventListener("input", (e) => {
        const pct = parseInt(e.target.value, 10);
        if (canopeeOpacityVal) canopeeOpacityVal.textContent = pct + "%";
        if (canopeeManager) canopeeManager.setOpacity(pct / 100);
      });
    }

    // Dynamic Contours Controls
    const toggleContours = document.getElementById("toggle-contours");
    const pillButtons = document.querySelectorAll(".pill-btn");
    const colorCircles = document.querySelectorAll(".color-circle");

    toggleContours.addEventListener("change", (e) => {
      const on = e.target.checked;
      for (const layerId of ["gc-contour-minor", "gc-contour-major", "gc-contour-labels"]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", on ? "visible" : "none");
        }
      }
      if (on && contourManager) {
        contourManager.generateForView();
      }
    });

    pillButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        pillButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const interval = parseFloat(btn.dataset.interval);
        let majorEvery = 5;
        if (interval === 0.1) majorEvery = 10;
        else if (interval === 0.25) majorEvery = 4;
        else if (interval === 0.5) majorEvery = 2;
        else if (interval === 1) majorEvery = 5;
        if (contourManager) {
          contourManager.updateConfig({ interval, majorEvery, labelSize: 13 });
          contourManager.generateForView();
        }
      });
    });

    // Elevation Profile Controls
    const btnQuickProfile = document.getElementById("btn-quick-profile");
    const btnQuickCalc = document.getElementById("btn-quick-calc");
    const btnQuickClear = document.getElementById("btn-quick-clear");
    const btnDockClear = document.getElementById("btn-dock-clear");
    const btnCloseProfileDock = document.getElementById("btn-close-profile-dock");
    const profilePrecision = document.getElementById("profile-precision");
    const profileBtnText = document.getElementById("profile-btn-text");

    function startDrawing() {
      if (!profileManager) return;
      if (window.measureManager && window.measureManager.isActive) {
        window.measureManager.deactivate();
      }
      if (ndviManager && ndviManager.isActiveMode) {
        ndviManager.setMode(false);
      }
      profileManager.isDrawing = true;
      map.doubleClickZoom.disable();
      if (btnQuickProfile) btnQuickProfile.classList.add("active");
      if (profileBtnText) profileBtnText.textContent = "Annuler tracé";

      const mobileProfileBtn = document.getElementById("mobile-btn-profile");
      const mobileProfileLabel = document.getElementById("mobile-profile-label");
      const mobileDrawingActions = document.getElementById("mobile-drawing-actions");
      const mobileBtnTools = document.getElementById("mobile-btn-tools");
      const mobileToolProfileBadge = document.getElementById("mobile-tool-profile-badge");

      if (mobileProfileBtn) mobileProfileBtn.classList.add("active-blue");
      if (mobileProfileLabel) mobileProfileLabel.textContent = "Annuler";
      if (mobileDrawingActions) mobileDrawingActions.classList.add("visible");
      if (mobileBtnTools) mobileBtnTools.classList.add("active-blue");
      if (mobileToolProfileBadge) mobileToolProfileBadge.style.display = "inline-block";

      map.getCanvas().style.cursor = "crosshair";
      updateToolbarButtons();
    }

    function stopDrawing() {
      if (!profileManager) return;
      profileManager.isDrawing = false;
      map.doubleClickZoom.enable();
      if (btnQuickProfile) btnQuickProfile.classList.remove("active");
      if (profileBtnText) {
        profileBtnText.textContent = profileManager.line.length >= 2 ? "Retracer coupe" : "Tracer coupe MNT";
      }

      const mobileProfileBtn = document.getElementById("mobile-btn-profile");
      const mobileProfileLabel = document.getElementById("mobile-profile-label");
      const mobileDrawingActions = document.getElementById("mobile-drawing-actions");
      const mobileBtnTools = document.getElementById("mobile-btn-tools");
      const mobileToolProfileBadge = document.getElementById("mobile-tool-profile-badge");

      if (mobileProfileBtn) mobileProfileBtn.classList.remove("active-blue");
      if (mobileProfileLabel) {
        mobileProfileLabel.textContent = profileManager.line.length >= 2 ? "Retracer" : "Coupe MNT";
      }
      if (mobileDrawingActions) mobileDrawingActions.classList.remove("visible");
      if (mobileBtnTools) {
        mobileBtnTools.classList.remove("active-blue");
        const isNdviActive = ndviManager && ndviManager.isActiveMode;
        mobileBtnTools.classList.toggle("active", isNdviActive);
      }
      if (mobileToolProfileBadge) mobileToolProfileBadge.style.display = "none";

      map.getCanvas().style.cursor = "";
      updateToolbarButtons();
    }

    function toggleDrawing() {
      if (profileManager && profileManager.isDrawing) {
        stopDrawing();
      } else {
        startDrawing();
      }
    }

    function updateToolbarButtons() {
      const hasPoints = profileManager && profileManager.line.length > 0;
      const canCalc = profileManager && profileManager.line.length >= 2;
      const count = profileManager ? profileManager.line.length : 0;

      if (btnQuickCalc) btnQuickCalc.style.display = canCalc ? "inline-flex" : "none";
      if (btnQuickClear) btnQuickClear.style.display = hasPoints ? "inline-flex" : "none";

      const mobileActCalc = document.getElementById("mobile-act-calc");
      const mobileActClear = document.getElementById("mobile-act-clear");
      const mobilePtsCount = document.getElementById("mobile-pts-count");

      if (mobileActCalc) mobileActCalc.style.display = canCalc ? "inline-flex" : "none";
      if (mobileActClear) mobileActClear.style.display = hasPoints ? "inline-flex" : "none";
      if (mobilePtsCount) mobilePtsCount.textContent = count;
    }

    async function triggerProfileCalculation() {
      if (!profileManager || profileManager.line.length < 2) return;
      stopDrawing();
      try {
        if (btnQuickCalc) {
          btnQuickCalc.disabled = true;
          btnQuickCalc.textContent = "Calcul...";
        }
        const prec = profilePrecision ? profilePrecision.value : "decimal2";
        await profileManager.calculateProfile(prec);
      } catch (err) {
        console.error("Profile calculation error:", err);
      } finally {
        if (btnQuickCalc) {
          btnQuickCalc.disabled = false;
          btnQuickCalc.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Calculer</span>`;
        }
      }
    }

    if (btnQuickProfile) {
      btnQuickProfile.addEventListener("click", toggleDrawing);
    }

    if (btnQuickCalc) {
      btnQuickCalc.addEventListener("click", triggerProfileCalculation);
    }

    if (btnQuickClear) {
      btnQuickClear.addEventListener("click", () => {
        if (profileManager) {
          stopDrawing();
          profileManager.clear();
        }
      });
    }

    if (btnDockClear) {
      btnDockClear.addEventListener("click", () => {
        if (profileManager) {
          stopDrawing();
          profileManager.clear();
        }
      });
    }

    if (profilePrecision) {
      profilePrecision.addEventListener("change", () => {
        if (profileManager && profileManager.profile.length >= 2) {
          profileManager.renderChart(profilePrecision.value);
        }
      });
    }

    if (btnCloseProfileDock) {
      btnCloseProfileDock.addEventListener("click", () => {
        const dock = document.getElementById("elevation-profile-dock");
        if (dock) dock.classList.remove("open");
      });
    }

    // NDVI Controls Event Handlers
    const btnQuickNdvi = document.getElementById("btn-quick-ndvi");
    const btnCloseNdviDock = document.getElementById("btn-close-ndvi-dock");
    const btnCollapseNdviDock = document.getElementById("btn-collapse-ndvi-dock");
    const ndviDockTitleWrap = document.getElementById("ndvi-dock-title-wrap");
    const btnDockClearNdvi = document.getElementById("btn-dock-clear-ndvi");
    const btnNdviPrev = document.getElementById("btn-ndvi-prev");
    const btnNdviNext = document.getElementById("btn-ndvi-next");
    const ndviTileOpacity = document.getElementById("ndvi-tile-opacity");
    const ndviOpacityVal = document.getElementById("ndvi-opacity-val");
    const ndviYearSelect = document.getElementById("ndvi-year-select");

    if (ndviYearSelect) {
      ndviYearSelect.addEventListener("change", (e) => {
        const yr = parseInt(e.target.value, 10);
        if (ndviManager) {
          ndviManager.selectedYear = yr;
          if (ndviManager.currentLocation) {
            ndviManager.analyzeLocation(ndviManager.currentLocation, ndviManager.currentParcel, yr);
          }
        }
      });
    }

    if (btnQuickNdvi) {
      btnQuickNdvi.addEventListener("click", () => {
        if (ndviManager) ndviManager.toggleMode();
      });
    }

    if (btnCloseNdviDock) {
      btnCloseNdviDock.addEventListener("click", () => {
        if (ndviManager) ndviManager.closeDock();
      });
    }

    if (btnCollapseNdviDock) {
      btnCollapseNdviDock.addEventListener("click", (e) => {
        e.stopPropagation();
        if (ndviManager) ndviManager.toggleCollapse();
      });
    }

    if (ndviDockTitleWrap) {
      ndviDockTitleWrap.addEventListener("click", () => {
        if (ndviManager) ndviManager.toggleCollapse();
      });
    }

    if (btnDockClearNdvi) {
      btnDockClearNdvi.addEventListener("click", () => {
        if (ndviManager) ndviManager.clearLayer();
      });
    }

    if (btnNdviPrev) {
      btnNdviPrev.addEventListener("click", () => {
        if (ndviManager && ndviManager.selectedIndex > 0) {
          ndviManager.selectDate(ndviManager.selectedIndex - 1);
        }
      });
    }

    if (btnNdviNext) {
      btnNdviNext.addEventListener("click", () => {
        if (ndviManager && ndviManager.selectedIndex < ndviManager.series.length - 1) {
          ndviManager.selectDate(ndviManager.selectedIndex + 1);
        }
      });
    }

    if (ndviTileOpacity) {
      ndviTileOpacity.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (ndviOpacityVal) ndviOpacityVal.textContent = val + "%";
        if (ndviManager) ndviManager.setTileOpacity(val / 100);
      });
    }

    const ndviStretchPreset = document.getElementById("ndvi-stretch-preset");
    const ndviStretchMin = document.getElementById("ndvi-stretch-min");
    const ndviStretchMax = document.getElementById("ndvi-stretch-max");
    const btnNdviAutoStretch = document.getElementById("btn-ndvi-auto-stretch");

    if (ndviStretchPreset) {
      ndviStretchPreset.addEventListener("change", (e) => {
        if (ndviManager) {
          ndviManager.applyStretchPreset(e.target.value);
        }
      });
    }

    if (ndviStretchMin) {
      ndviStretchMin.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10) / 100;
        if (ndviManager) {
          ndviManager.setStretchRange(val, ndviManager.stretchMax, "custom");
        }
      });
    }

    if (ndviStretchMax) {
      ndviStretchMax.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10) / 100;
        if (ndviManager) {
          ndviManager.setStretchRange(ndviManager.stretchMin, val, "custom");
        }
      });
    }

    if (btnNdviAutoStretch) {
      btnNdviAutoStretch.addEventListener("click", () => {
        if (ndviManager) {
          ndviManager.applyStretchPreset("auto");
        }
      });
    }

    const btnNdviToggleCustom = document.getElementById("btn-ndvi-toggle-custom");
    if (btnNdviToggleCustom) {
      btnNdviToggleCustom.addEventListener("click", () => {
        const customBox = document.getElementById("ndvi-custom-sliders-box");
        if (customBox) {
          const isShown = (customBox.style.display === "flex");
          customBox.style.display = isShown ? "none" : "flex";
        }
      });
    }

    // Agri-Réseau RAG Manager
    const ragManager = new RagManager();
    window.ragManager = ragManager;

    // Cartographic Layout Composer & PDF Export triggers
    const btnQuickExport = document.getElementById("btn-quick-export");
    if (btnQuickExport) {
      btnQuickExport.addEventListener("click", () => {
        if (window.composer) window.composer.open();
      });
    }

    const btnPanelComposer = document.getElementById("btn-panel-composer");
    if (btnPanelComposer) {
      btnPanelComposer.addEventListener("click", () => {
        if (window.composer) window.composer.open();
      });
    }

    // Vector Manager triggers
    function openPersonalLayersPanel() {
      const panelTools = document.getElementById("panel-tools");
      const backdrop = document.getElementById("tools-backdrop");
      if (panelTools) {
        panelTools.classList.add("open");
        panelTools.scrollTop = 0;
        if (backdrop) backdrop.classList.add("active");
        const card = document.getElementById("card-custom-vectors");
        if (card) {
          card.style.transition = "box-shadow 0.3s ease";
          card.style.boxShadow = "0 0 0 3px #0284c7";
          setTimeout(() => { card.style.boxShadow = ""; }, 1200);
        }
      }
    }

    const btnQuickVectors = document.getElementById("btn-quick-vectors");
    if (btnQuickVectors) {
      btnQuickVectors.addEventListener("click", openPersonalLayersPanel);
    }

    window.openPersonalLayersPanel = openPersonalLayersPanel;

    window.addEventListener("resize", () => {
      if (profileManager && profileManager.profile.length >= 2) {
        const dock = document.getElementById("elevation-profile-dock");
        if (dock && dock.classList.contains("open")) {
          const prec = profilePrecision ? profilePrecision.value : "decimal2";
          profileManager.renderChart(prec);
        }
      }
      if (ndviManager && ndviManager.series.length > 0) {
        const dock = document.getElementById("ndvi-dock");
        if (dock && dock.classList.contains("open")) {
          ndviManager.renderChart(ndviManager.selectedIndex);
        }
      }
    });

    // Address Search Logic (Nominatim API)
    const addressInput = document.getElementById("address-input");
    const clearBtn = document.getElementById("clear-search");
    const suggestionsBox = document.getElementById("search-suggestions");
    const mapSearchPanel = document.getElementById("map-search-panel");
    const btnToggleSearch = document.getElementById("btn-toggle-search");
    let searchDebounce = null;

    function openSearchPanel() {
      if (mapSearchPanel) {
        mapSearchPanel.style.display = "block";
        if (btnToggleSearch) btnToggleSearch.classList.add("active");
        setTimeout(() => { if (addressInput) addressInput.focus(); }, 50);
      }
    }

    function closeSearchPanel() {
      if (mapSearchPanel) {
        mapSearchPanel.style.display = "none";
        if (btnToggleSearch) btnToggleSearch.classList.remove("active");
      }
    }

    function toggleSearchPanel() {
      if (mapSearchPanel && mapSearchPanel.style.display === "block") {
        closeSearchPanel();
      } else {
        openSearchPanel();
      }
    }

    if (btnToggleSearch) {
      btnToggleSearch.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSearchPanel();
      });
    }

    addressInput.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      clearBtn.style.display = q ? "block" : "none";
      clearTimeout(searchDebounce);

      if (q.length < 3) {
        suggestionsBox.style.display = "none";
        suggestionsBox.innerHTML = "";
        return;
      }

      searchDebounce = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=ca&limit=5&addressdetails=1`;
          const res = await fetch(url, { headers: { "User-Agent": "PlanDeFermeApp/1.0" } });
          const results = await res.json();

          if (!results || results.length === 0) {
            suggestionsBox.innerHTML = '<div style="padding: 10px; font-size: 11px; color: #64748b;">Aucun résultat trouvé</div>';
            suggestionsBox.style.display = "block";
            return;
          }

          suggestionsBox.innerHTML = "";
          results.forEach((item) => {
            const div = document.createElement("div");
            div.className = "suggestion-item";
            div.textContent = item.display_name;
            div.addEventListener("click", () => {
              const lat = parseFloat(item.lat);
              const lon = parseFloat(item.lon);
              addressInput.value = item.display_name;
              suggestionsBox.style.display = "none";

              if (searchMarker) searchMarker.remove();
              searchMarker = new maplibregl.Marker({ color: "#204838" })
                .setLngLat([lon, lat])
                .addTo(map);

              map.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
            });
            suggestionsBox.appendChild(div);
          });
          suggestionsBox.style.display = "block";
        } catch (err) {
          console.error("Erreur de recherche d'adresse:", err);
        }
      }, 300);
    });

    clearBtn.addEventListener("click", () => {
      addressInput.value = "";
      clearBtn.style.display = "none";
      suggestionsBox.style.display = "none";
      suggestionsBox.innerHTML = "";
      if (searchMarker) {
        searchMarker.remove();
        searchMarker = null;
      }
      addressInput.focus();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".map-search-panel") && !e.target.closest("#btn-toggle-search") && !e.target.closest("#mobile-btn-search")) {
        suggestionsBox.style.display = "none";
        closeSearchPanel();
      }
    });
  
    // Mobile Tools Drawer Toggle
    const btnToggleTools = document.getElementById("btn-toggle-tools");
    const btnCloseTools = document.getElementById("btn-close-tools");
    const panelTools = document.getElementById("panel-tools");
    const toolsBackdrop = document.getElementById("tools-backdrop");

    function openMobileTools() {
      if (typeof updateLayersZoomState === "function") updateLayersZoomState();
      if (panelTools) panelTools.classList.add("open");
      if (toolsBackdrop) toolsBackdrop.classList.add("active");
      if (btnToggleTools) btnToggleTools.classList.add("active");
      const mobileBtnLayers = document.getElementById("mobile-btn-layers");
      if (mobileBtnLayers) mobileBtnLayers.classList.add("active");
    }

    function closeMobileTools() {
      if (panelTools) panelTools.classList.remove("open");
      if (toolsBackdrop) toolsBackdrop.classList.remove("active");
      if (btnToggleTools) btnToggleTools.classList.remove("active");
      const mobileBtnLayers = document.getElementById("mobile-btn-layers");
      if (mobileBtnLayers) mobileBtnLayers.classList.remove("active");
    }

    if (btnToggleTools) {
      btnToggleTools.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (panelTools && panelTools.classList.contains("open")) {
          closeMobileTools();
        } else {
          openMobileTools();
        }
      });
    }

    if (btnCloseTools) {
      btnCloseTools.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeMobileTools();
      });
    }

    if (toolsBackdrop) {
      toolsBackdrop.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeMobileTools();
      });
    }

    // Mobile Bottom Navigation Bar & Tools Action Sheet
    const mobileBtnLayers = document.getElementById("mobile-btn-layers");
    const mobileBtnTools = document.getElementById("mobile-btn-tools");
    const mobileBtnSearch = document.getElementById("mobile-btn-search");
    const mobileBtnLocate = document.getElementById("mobile-btn-locate");

    const mobileToolsSheet = document.getElementById("mobile-tools-sheet");
    const mobileToolsBackdrop = document.getElementById("mobile-tools-backdrop");
    const mobileToolsClose = document.getElementById("mobile-tools-close");

    const mobileToolNdvi = document.getElementById("mobile-tool-ndvi");
    const mobileToolProfile = document.getElementById("mobile-tool-profile");
    const mobileToolRag = document.getElementById("mobile-tool-rag");
    const mobileToolComposer = document.getElementById("mobile-tool-composer");

    const mobileToolNdviBadge = document.getElementById("mobile-tool-ndvi-badge");
    const mobileToolProfileBadge = document.getElementById("mobile-tool-profile-badge");

    const mobileActCancel = document.getElementById("mobile-act-cancel");
    const mobileActCalc = document.getElementById("mobile-act-calc");
    const mobileActClear = document.getElementById("mobile-act-clear");

    function openMobileToolsSheet() {
      if (!mobileToolsSheet) return;
      if (panelTools && panelTools.classList.contains("open")) {
        closeMobileTools();
      }
      mobileToolsSheet.classList.add("open");
      mobileToolsSheet.setAttribute("aria-hidden", "false");
      if (mobileToolsBackdrop) mobileToolsBackdrop.classList.add("active");
      if (mobileBtnTools) mobileBtnTools.classList.add("active");

      // Synchronisation de l'état des badges
      if (mobileToolNdviBadge && ndviManager) {
        mobileToolNdviBadge.style.display = ndviManager.isActiveMode ? "inline-block" : "none";
      }
      if (mobileToolProfileBadge && profileManager) {
        mobileToolProfileBadge.style.display = profileManager.isDrawing ? "inline-block" : "none";
      }
    }

    function closeMobileToolsSheet() {
      if (!mobileToolsSheet) return;
      mobileToolsSheet.classList.remove("open");
      mobileToolsSheet.setAttribute("aria-hidden", "true");
      if (mobileToolsBackdrop) mobileToolsBackdrop.classList.remove("active");
      if (mobileBtnTools) {
        const isToolActive = (ndviManager && ndviManager.isActiveMode) || (profileManager && profileManager.isDrawing);
        mobileBtnTools.classList.toggle("active", isToolActive);
      }
    }

    if (mobileBtnLayers) {
      mobileBtnLayers.addEventListener("click", () => {
        closeMobileToolsSheet();
        if (panelTools && panelTools.classList.contains("open")) {
          closeMobileTools();
        } else {
          openMobileTools();
        }
      });
    }

    if (mobileBtnTools) {
      mobileBtnTools.addEventListener("click", () => {
        if (mobileToolsSheet && mobileToolsSheet.classList.contains("open")) {
          closeMobileToolsSheet();
        } else {
          openMobileToolsSheet();
        }
      });
    }

    if (mobileToolsClose) {
      mobileToolsClose.addEventListener("click", closeMobileToolsSheet);
    }
    if (mobileToolsBackdrop) {
      mobileToolsBackdrop.addEventListener("click", closeMobileToolsSheet);
    }

    // 1. NDVI (Sentinel-2)
    if (mobileToolNdvi) {
      mobileToolNdvi.addEventListener("click", () => {
        closeMobileToolsSheet();
        if (ndviManager) ndviManager.toggleMode();
      });
    }

    // 2. Coupe Topographique (MNT)
    if (mobileToolProfile) {
      mobileToolProfile.addEventListener("click", () => {
        closeMobileToolsSheet();
        toggleDrawing();
      });
    }

    // 3. Conseiller Agri-Réseau
    if (mobileToolRag) {
      mobileToolRag.addEventListener("click", () => {
        closeMobileToolsSheet();
        if (window.ragManager) window.ragManager.open();
      });
    }

    // 4. Couche personnelle
    const mobileToolVectors = document.getElementById("mobile-tool-vectors");
    if (mobileToolVectors) {
      mobileToolVectors.addEventListener("click", () => {
        closeMobileToolsSheet();
        openPersonalLayersPanel();
      });
    }

    // 5. Outil de Mesure mobile
    const mobileToolMeasure = document.getElementById("mobile-tool-measure");
    if (mobileToolMeasure) {
      mobileToolMeasure.addEventListener("click", () => {
        closeMobileToolsSheet();
        if (window.measureManager) window.measureManager.activate();
      });
    }

    // 6. Impression & Mise en page PDF
    if (mobileToolComposer) {
      mobileToolComposer.addEventListener("click", () => {
        closeMobileToolsSheet();
        if (window.composer) window.composer.open();
      });
    }

    if (mobileBtnSearch) {
      mobileBtnSearch.addEventListener("click", () => {
        closeMobileToolsSheet();
        toggleSearchPanel();
      });
    }

    // Mobile GPS Locate button
    let mobileUserMarker = null;
    if (mobileBtnLocate) {
      mobileBtnLocate.addEventListener("click", () => {
        if (!navigator.geolocation) {
          alert("La géolocalisation n'est pas supportée par votre navigateur.");
          return;
        }
        mobileBtnLocate.classList.add("active");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lng = pos.coords.longitude;
            const lat = pos.coords.latitude;
            if (mobileUserMarker) mobileUserMarker.remove();
            
            const el = document.createElement("div");
            el.className = "mobile-user-marker";
            el.innerHTML = '<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;border:2.5px solid #ffffff;box-shadow:0 0 10px rgba(37,99,235,0.6);"></div>';
            
            mobileUserMarker = new maplibregl.Marker({ element: el })
              .setLngLat([lng, lat])
              .addTo(map);

            map.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 });
            setTimeout(() => {
              if (mobileBtnLocate) mobileBtnLocate.classList.remove("active");
            }, 1500);
          },
          (err) => {
            console.warn("Geolocation error:", err);
            mobileBtnLocate.classList.remove("active");
            alert("Impossible d'obtenir votre position GPS.");
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });
    }

    if (mobileActCancel) {
      mobileActCancel.addEventListener("click", () => {
        stopDrawing();
      });
    }

    if (mobileActCalc) {
      mobileActCalc.addEventListener("click", () => {
        triggerProfileCalculation();
      });
    }

    if (mobileActClear) {
      mobileActClear.addEventListener("click", () => {
        if (profileManager) {
          profileManager.clear();
        }
      });
    }

    // --- URL State Management (Position & Active Layers) ---
    let urlUpdateDebounce = null;
    function updateUrl(immediate = false) {
      if (!map) return;
      const doUpdate = () => {
        const center = map.getCenter();
        const zoom = map.getZoom();

        const params = new URLSearchParams();
        params.set("lat", center.lat.toFixed(4));
        params.set("lng", center.lng.toFixed(4));
        params.set("z", zoom.toFixed(2));

        // Basemap
        const isSat = btnSat && btnSat.classList.contains("active");
        if (isSat) {
          params.set("basemap", "sat");
        }

        // Active layers
        const activeLayers = [];
        if (togglePedo && togglePedo.checked) activeLayers.push("pedo");
        if (toggleParcelles && toggleParcelles.checked) activeLayers.push("parcelles");
        if (toggleTopo && toggleTopo.checked) activeLayers.push("topo");
        if (togglePentes && togglePentes.checked) activeLayers.push("pentes");
        if (toggleCanopee && toggleCanopee.checked) activeLayers.push("canopee");
        if (toggleContours && toggleContours.checked) activeLayers.push("contours");
        if (toggleHydroParcelle && toggleHydroParcelle.checked) activeLayers.push("hydro");
        if (ndviManager && ndviManager.isActiveMode) activeLayers.push("ndvi");

        if (activeLayers.length > 0) {
          params.set("layers", activeLayers.join(","));
        }

        // Opacities if modified from default
        if (togglePedo && togglePedo.checked && opacitySlider && parseInt(opacitySlider.value, 10) !== 80) {
          params.set("pedo_op", opacitySlider.value);
        }
        if (toggleParcelles && toggleParcelles.checked && parcellesOpacity && parseInt(parcellesOpacity.value, 10) !== 95) {
          params.set("parcelles_op", parcellesOpacity.value);
        }
        if (toggleTopo && toggleTopo.checked && topoOpacitySlider && parseInt(topoOpacitySlider.value, 10) !== 70) {
          params.set("topo_op", topoOpacitySlider.value);
        }
        if (toggleTopo && toggleTopo.checked && toggleTopoHillshade && !toggleTopoHillshade.checked) {
          params.set("topo_hs", "0");
        }
        if (toggleTopo && toggleTopo.checked && topoHillshadeOpacitySlider && parseInt(topoHillshadeOpacitySlider.value, 10) !== 60) {
          params.set("topo_hs_op", topoHillshadeOpacitySlider.value);
        }
        if (togglePentes && togglePentes.checked && pentesOpacitySlider && parseInt(pentesOpacitySlider.value, 10) !== 75) {
          params.set("pentes_op", pentesOpacitySlider.value);
        }
        if (toggleCanopee && toggleCanopee.checked && canopeeOpacitySlider && parseInt(canopeeOpacitySlider.value, 10) !== 75) {
          params.set("canopee_op", canopeeOpacitySlider.value);
        }

        // Active WMS layers
        if (wmsManager) {
          const activeWms = wmsManager.getActiveLayerIds();
          if (activeWms.length > 0) {
            params.set("wms", activeWms.join(","));
          }
        }

        const queryString = params.toString();
        const newUrl = window.location.pathname + (queryString ? "?" + queryString : "");
        window.history.replaceState(null, "", newUrl);
      };

      clearTimeout(urlUpdateDebounce);
      if (immediate) {
        doUpdate();
      } else {
        urlUpdateDebounce = setTimeout(doUpdate, 120);
      }
    }

    function applyUrlState(state) {
      if (!state) return;

      // 1. Basemap
      if (state.basemap === "sat") {
        if (btnSat) btnSat.click();
      } else if (state.basemap === "plan") {
        if (btnPlan) btnPlan.click();
      }

      // 2. Pedologie
      if (state.layers.includes("pedo")) {
        if (state.pedoOp !== null && opacitySlider) {
          opacitySlider.value = state.pedoOp;
        }
        if (togglePedo) {
          togglePedo.checked = true;
          updatePedoLayerVisibility();
        }
      }

      // 3. Parcelles agricoles
      if (state.layers.includes("parcelles")) {
        if (state.parcellesOp !== null && parcellesOpacity) {
          parcellesOpacity.value = state.parcellesOp;
          if (parcellesOpacityVal) parcellesOpacityVal.textContent = state.parcellesOp + "%";
          const op = state.parcellesOp / 100;
          ["parcelles-line-bg", "parcelles-line-fg"].forEach(id => {
            if (map.getLayer(id)) map.setPaintProperty(id, "line-opacity", op);
          });
        }
        if (toggleParcelles) {
          toggleParcelles.checked = true;
          ["parcelles-fill", "parcelles-line-bg", "parcelles-line-fg"].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
          });
        }
      }

      // 4. Topo & Hillshade
      if (state.layers.includes("topo")) {
        if (state.topoOp !== null && topoOpacitySlider) {
          topoOpacitySlider.value = state.topoOp;
          if (topoOpacityVal) topoOpacityVal.textContent = state.topoOp + "%";
          if (topoManager) topoManager.setOpacity(state.topoOp / 100);
        }
        if (state.topoHs !== null && toggleTopoHillshade) {
          toggleTopoHillshade.checked = state.topoHs;
          if (topoManager) topoManager.setHillshadeEnabled(state.topoHs);
        }
        if (state.topoHsOp !== null && topoHillshadeOpacitySlider) {
          topoHillshadeOpacitySlider.value = state.topoHsOp;
          if (topoHillshadeVal) topoHillshadeVal.textContent = state.topoHsOp + "%";
          if (topoManager) topoManager.setHillshadeOpacity(state.topoHsOp / 100);
        }
        if (toggleTopo) {
          toggleTopo.checked = true;
          if (topoManager) topoManager.setEnabled(true);
        }
      }

      // 4b. Carte des Pentes (%)
      if (state.layers.includes("pentes")) {
        if (state.pentesOp !== null && pentesOpacitySlider) {
          pentesOpacitySlider.value = state.pentesOp;
          if (pentesOpacityVal) pentesOpacityVal.textContent = state.pentesOp + "%";
          if (pentesManager) pentesManager.setOpacity(state.pentesOp / 100);
        }
        if (togglePentes) {
          togglePentes.checked = true;
          if (pentesManager) pentesManager.setEnabled(true);
        }
      }

      // 4c. Hauteur de canopée (AWS Canada)
      if (state.layers.includes("canopee")) {
        if (state.canopeeOp !== null && canopeeOpacitySlider) {
          canopeeOpacitySlider.value = state.canopeeOp;
          if (canopeeOpacityVal) canopeeOpacityVal.textContent = state.canopeeOp + "%";
          if (canopeeManager) canopeeManager.setOpacity(state.canopeeOp / 100);
        }
        if (toggleCanopee) {
          toggleCanopee.checked = true;
          if (canopeeManager) canopeeManager.setEnabled(true);
        }
      }

      // 5. Contours
      if (state.layers.includes("contours")) {
        if (state.interval && contourManager) {
          const btn = document.querySelector(`.pill-btn[data-interval="${state.interval}"]`);
          if (btn) btn.click();
        }
        if (toggleContours) {
          toggleContours.checked = true;
          for (const layerId of ["gc-contour-minor", "gc-contour-major", "gc-contour-labels"]) {
            if (map.getLayer(layerId)) {
              map.setLayoutProperty(layerId, "visibility", "visible");
            }
          }
          if (contourManager) {
            contourManager.generateForView();
          }
        }
      }

      // 5b. Écoulement & Dépressions
      if (state.layers.includes("hydro")) {
        if (toggleHydroParcelle) {
          toggleHydroParcelle.checked = true;
          if (parcelHydrologyManager) parcelHydrologyManager.setEnabled(true);
        }
      } else {
        if (toggleHydroParcelle) {
          toggleHydroParcelle.checked = false;
          if (parcelHydrologyManager) parcelHydrologyManager.setEnabled(false);
        }
      }

      // Auto-déplier l'accordéon topo principal et le sous-accordéon si une couche topo est active dans l'URL
      if (state.layers.some(l => ["topo", "pentes", "contours", "hydro", "canopee"].includes(l))) {
        const topoMaster = document.getElementById("card-topo-master");
        if (topoMaster) topoMaster.open = true;
        if (state.layers.includes("topo")) {
          const el = document.getElementById("card-topo");
          if (el) el.open = true;
        }
        if (state.layers.includes("pentes")) {
          const el = document.getElementById("card-pentes");
          if (el) el.open = true;
        }
        if (state.layers.includes("canopee")) {
          const el = document.getElementById("card-canopee");
          if (el) el.open = true;
        }
        if (state.layers.includes("contours")) {
          const el = document.getElementById("card-contours");
          if (el) el.open = true;
        }
        if (state.layers.includes("hydro")) {
          const el = document.getElementById("card-hydro-parcelle");
          if (el) el.open = true;
        }
      }

      // 6. NDVI
      if (state.layers.includes("ndvi")) {
        if (ndviManager) {
          ndviManager.setMode(true);
        }
      }

      // 7. WMS layers
      if (state.wms && state.wms.length > 0 && wmsManager) {
        wmsManager.restoreFromState(state.wms);
      }

      // Ensure parcelles stay on top of other layers
      if (typeof bringParcellesToFront === "function") {
        bringParcellesToFront();
      }
    }

    // Apply URL state once map finishes loading
    if (map.loaded()) {
      applyUrlState(urlState);
    } else {
      map.once("load", () => {
        applyUrlState(urlState);
      });
    }

    // Map movement listener to update URL coordinates & zoom
    map.on("moveend", () => {
      updateUrl();
    });

    // Wire layer controls to update URL
    if (togglePedo) togglePedo.addEventListener("change", () => updateUrl());
    if (opacitySlider) opacitySlider.addEventListener("change", () => updateUrl());
    if (toggleParcelles) toggleParcelles.addEventListener("change", () => updateUrl());
    if (parcellesOpacity) parcellesOpacity.addEventListener("change", () => updateUrl());
    if (toggleTopo) toggleTopo.addEventListener("change", () => updateUrl());
    if (topoOpacitySlider) topoOpacitySlider.addEventListener("change", () => updateUrl());
    if (toggleContours) toggleContours.addEventListener("change", () => updateUrl());
    if (pillButtons) {
      pillButtons.forEach(btn => btn.addEventListener("click", () => updateUrl()));
    }
    if (btnPlan) btnPlan.addEventListener("click", () => updateUrl());
    if (btnSat) btnSat.addEventListener("click", () => updateUrl());

    // Share View Helpers & Event Handlers
    function showShareToast() {
      const toast = document.getElementById("share-toast");
      if (!toast) return;
      toast.classList.add("show");
      if (window.shareToastTimer) clearTimeout(window.shareToastTimer);
      window.shareToastTimer = setTimeout(() => {
        toast.classList.remove("show");
      }, 2500);
    }

    function shareCurrentView() {
      updateUrl(true);
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showShareToast();
        }).catch(() => {
          fallbackCopy(url);
        });
      } else {
        fallbackCopy(url);
      }
    }

    function fallbackCopy(text) {
      const input = document.createElement("input");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        showShareToast();
      } catch (err) {
        prompt("Copiez ce lien pour partager la vue :", text);
      }
      document.body.removeChild(input);
    }

    const btnPanelShare = document.getElementById("btn-panel-share");

    if (btnPanelShare) {
      btnPanelShare.addEventListener("click", shareCurrentView);
    }

    // Register Service Worker (PWA)
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
          // Vérification immédiate des mises à jour du Service Worker à chaque chargement
          reg.update().catch(() => {});

          // Vérification automatique au retour sur l'onglet
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              reg.update().catch(() => {});
            }
          });
        }).catch((err) => {
          console.warn("Service Worker registration failed:", err);
        });
      });
    }

    // PWA Install Prompt
    let deferredInstallPrompt = null;
    const pwaBar = document.getElementById("pwa-install-bar");
    const pwaText = document.getElementById("pwa-install-text");
    const pwaBtn = document.getElementById("pwa-install-btn");
    const pwaDismiss = document.getElementById("pwa-install-dismiss");
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;

    function showPwaBar(text, btnLabel) {
      if (!pwaBar) return;
      if (pwaText) pwaText.textContent = text;
      if (pwaBtn && btnLabel) pwaBtn.textContent = btnLabel;
      pwaBar.classList.add("visible");
    }
    function hidePwaBar() {
      if (pwaBar) pwaBar.classList.remove("visible");
    }

    if (!isStandalone) {
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        showPwaBar("Installer Plan de Ferme sur votre appareil", "Installer");
      });

      window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        hidePwaBar();
      });

      if (pwaBtn) {
        pwaBtn.addEventListener("click", async () => {
          hidePwaBar();
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            try { await deferredInstallPrompt.userChoice; } catch (e) {}
            deferredInstallPrompt = null;
          }
        });
      }

      if (pwaDismiss) {
        pwaDismiss.addEventListener("click", hidePwaBar);
      }

      if (isIOS) {
        setTimeout(() => {
          showPwaBar("Ajoutez Plan de Ferme à l'écran d'accueil : bouton Partager puis « Sur l'écran d'accueil ».", "OK");
        }, 3000);
      }
    }