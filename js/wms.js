    const WMS_ICON_PRESETS = {
      folder: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
      layer: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
      foncier: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      eau: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
      foret: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L7 9h3l-4 7h6l-3 5h8l-3-5h6l-4-7h3L12 2z"/></svg>`,
      imagerie: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
      custom: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
      cadastre: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
      water: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M2 6c.6 0 1.2-.2 1.7-.6 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 .5.4 1.1.6 1.7.6"/><path d="M2 12c.6 0 1.2-.2 1.7-.6 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 .5.4 1.1.6 1.7.6"/><path d="M2 18c.6 0 1.2-.2 1.7-.6 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 .5.4 1.1.6 1.7.6"/></svg>`,
      camera: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`,
      flood: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      wetland: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a10 10 0 0 0-7.54 16.56C5.54 17.65 7.18 17 9 17c1.47 0 2.82.43 3.96 1.16A7.95 7.95 0 0 1 17 17c1.82 0 3.46.65 4.54 1.56A10 10 0 0 0 12 2z"/><path d="M7 10v4"/><path d="M12 7v7"/><path d="M17 9v5"/><path d="M3 20c1.2-1 2.8-1.5 4.5-1.5s3.3.5 4.5 1.5c1.2-1 2.8-1.5 4.5-1.5s3.3.5 4.5 1.5"/></svg>`,
      moisture: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><path d="M7 16a5 5 0 0 0 10 0"/></svg>`,
      drainage: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
      tree: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L7 9h3l-4 7h6l-3 5h8l-3-5h6l-4-7h3L12 2z"/></svg>`,
      zone_agricole: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>`
    };

    class WmsLayerManager {
      constructor(map) {
        this.map = map;
        this.registry = new Map();
        this.activeLayerIds = new Set();
        this.storageKey = "pedo_custom_wms_layers";
        this.isCadastreActive = false;
        this.cadastreAbortController = null;
        this._cadastreDebounceTimer = null;
        this._cadastreMoveListener = null;
        this.catalogUrl = "data/wms-catalog.json";
        this.catalogLoaded = false;
        this._pendingRestoreIds = null;

        // Categories for grouping layers in collapsible dropdowns
        this.categories = [
          {
            id: "foncier",
            title: "Foncier & Aménagement",
            icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
            defaultOpen: false
          },
          {
            id: "eau",
            title: "Hydrographie & Milieux humides",
            icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
            defaultOpen: false
          },
          {
            id: "foret",
            title: "Foresterie & Environnement",
            icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L7 9h3l-4 7h6l-3 5h8l-3-5h6l-4-7h3L12 2z"/></svg>`,
            defaultOpen: false
          },
          {
            id: "imagerie",
            title: "Photographies aériennes & Orthophotos",
            icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
            defaultOpen: false
          },
          {
            id: "custom",
            title: "Couches personnalisées",
            icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
            defaultOpen: false
          }
        ];

        // Preconfigured catalog:
        // 1. Hydrographie — Réseau (cours d'eau permanents & intermittents - MRNF eau.qlr)
        // 2. Cadastre du Québec (Lots rénovés - GeoJSON vectoriel au-dessus de tout, 1 numéro/lot)
        // 3. Photographies aériennes (Orthomosaïque continue MRNF)
        // 4. Orthomosaïque Montérégie (MRNF / Info-Sols 20 cm)
        // 5. Orthomosaïque Estrie (MRNF / Info-Sols 20 cm)
        // 6. Orthomosaïque Centre-du-Québec (MRNF / Info-Sols 20 cm)
        // 7. Orthomosaïque Chaudière-Appalaches (MRNF 15 cm)
        // 8. Zone agricole CPTAQ (Zonage LPTAA)
        // 9. Hydrographie — Plans d'eau (Surfaces GRHQ - MRNF)
        // 10. Zones inondables (MRNF)
        this.defaultCatalog = [
          {
            id: "eau_grhq",
            category: "eau",
            name: "Hydrographie — Réseau (GRHQ)",
            subtitle: "Cours d'eau permanents & intermittents",
            url: "https://servicescarto.mrnf.gouv.qc.ca/pes/services/Territoire/GRHQ_simple_WMS/MapServer/WMSServer",
            layers: "9,10,11,12,13,14,15,16",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.90,
            insertPosition: "above_pedologie",
            attribution: "© Gouvernement du Québec (MRNF - GRHQ)",
            description: "Réseau hydrographique officiel du Québec (cours d'eau permanents et intermittents, conforme à eau.qlr).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M2 6c.6 0 1.2-.2 1.7-.6 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 .5.4 1.1.6 1.7.6"/><path d="M2 12c.6 0 1.2-.2 1.7-.6 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 .5.4 1.1.6 1.7.6"/><path d="M2 18c.6 0 1.2-.2 1.7-.6 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 1.1.8 2.3.8 3.4 0 1.1-.8 2.3-.8 3.4 0 .5.4 1.1.6 1.7.6"/></svg>`
          },
          {
            id: "cadastre_quebec",
            category: "foncier",
            name: "Cadastre du Québec (Lots rénovés)",
            subtitle: "Limites foncières & numéro de lot unique (zoom 14+)",
            type: "cadastre_geojson",
            url: "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query",
            defaultOpacity: 0.90,
            minZoom: 13.5,
            attribution: "© Gouvernement du Québec (MRNF / MELCCFP - Cadastre)",
            description: "Lots rénovés du cadastre du Québec issus du registre public foncier (MRNF). Rendu vectoriel avec un seul numéro par polygone, affiché au-dessus de tout.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`
          },
          {
            id: "orthophotos_quebec",
            category: "imagerie",
            name: "Photographies aériennes (Orthomosaïque QC)",
            subtitle: "Imagerie continue provinciale (MRNF)",
            url: "https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wms/Imagerie_Continue",
            layers: "Imagerie_GQ",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF - Imagerie continue)",
            description: "Mosaïque d'orthophotographies aériennes officielles continue couvrant le Québec.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_geomont_2023_m",
            category: "imagerie",
            name: "Photos aériennes 2023 — Montérégie (GeoMont)",
            subtitle: "Haute résolution 2023 (GeoMont)",
            url: "https://orthophotos2023.geomont.qc.ca/WMS/mapserv",
            layers: "GeoMont_Orthophotos_2023",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© GeoMont / Montérégie",
            description: "Campagne d'orthophotographies aériennes 2023 à très haute résolution couvrant la Montérégie (GeoMont).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_geomont_2023_e",
            category: "imagerie",
            name: "Photos aériennes 2023 — Estrie (GeoMont)",
            subtitle: "Haute résolution 2023 (GeoMont)",
            url: "https://estrie-ortho2023.geomont.qc.ca/WMS/mapserv",
            layers: "GeoMont_Orthophotos_2023_Estrie",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© GeoMont / Estrie",
            description: "Campagne d'orthophotographies aériennes 2023 à très haute résolution couvrant l'Estrie (GeoMont).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_geomont_2020",
            category: "imagerie",
            name: "Photos aériennes 2020 — Montérégie (GeoMont)",
            subtitle: "Campagne 2020 haute résolution (GeoMont)",
            url: "https://orthophotos2020.geomont.qc.ca/WMS/mapserv",
            layers: "GeoMont_Orthophotos_2020",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© GeoMont",
            description: "Campagne d'orthophotographies aériennes 2020 couvrant la Montérégie (GeoMont).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_geomont_2017",
            category: "imagerie",
            name: "Photos aériennes 2017 — Montérégie (GeoMont)",
            subtitle: "Campagne 2017 haute résolution (GeoMont)",
            url: "https://orthophotos2017.geomont.qc.ca/WMS/mapserv",
            layers: "GeoMont_Orthophotos_2017",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© GeoMont",
            description: "Campagne d'orthophotographies aériennes 2017 couvrant la Montérégie (GeoMont).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_monteregie",
            category: "imagerie",
            name: "Orthomosaïque Montérégie (MRNF - 20 cm)",
            subtitle: "Campagne 2020 (MRNF / Info-Sols)",
            url: "https://imagesgeo-atlas.mrnf.gouv.qc.ca/IDS_IMAGERIE_WMS/service.svc/get",
            layers: "Orthomosaique_2020_2020_Partenariat_Monteregie_20cm_RVB",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF - Info-Sols Montérégie)",
            description: "Orthophotographies aériennes haute résolution (20 cm RVB) de la Montérégie.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_estrie",
            category: "imagerie",
            name: "Orthomosaïque Estrie (MRNF - 20 cm)",
            subtitle: "Campagne 2023 (MRNF / Info-Sols)",
            url: "https://imagesgeo-atlas.mrnf.gouv.qc.ca/IDS_IMAGERIE_WMS/service.svc/get",
            layers: "Orthomosaique_2023_2023_Partenariat_Estrie_20cm_RVB",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF - Info-Sols Estrie)",
            description: "Orthophotographies aériennes 2023 haute résolution (20 cm RVB) de l'Estrie.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_centre_qc",
            category: "imagerie",
            name: "Orthomosaïque Centre-du-Québec (MRNF - 20 cm)",
            subtitle: "Campagne 2020 (MRNF / Info-Sols)",
            url: "https://imagesgeo-atlas.mrnf.gouv.qc.ca/IDS_IMAGERIE_WMS/service.svc/get",
            layers: "Orthomosaique_2020_2020_Partenariat_Centre-du-Quebec_20cm_RVB",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF - Info-Sols Centre-du-Québec)",
            description: "Orthophotographies aériennes 2020 haute résolution (20 cm RVB) du Centre-du-Québec.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_chaudiere",
            category: "imagerie",
            name: "Orthomosaïque Chaudière-Appalaches (MRNF - 15 cm)",
            subtitle: "Campagne 2020 (MRNF)",
            url: "https://imagesgeo-atlas.mrnf.gouv.qc.ca/IDS_IMAGERIE_WMS/service.svc/get",
            layers: "Orthomosaique_2020_2020_Partenariat_Chaudiere-Appalaches_15cm_RVB",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF)",
            description: "Orthophotographies aériennes 2020 à 15 cm/pixel de la région Chaudière-Appalaches.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_laurentides_2022",
            category: "imagerie",
            name: "Orthomosaïque Laurentides 2022 (MRNF - 20 cm)",
            subtitle: "Campagne 2022 haute résolution (MRNF)",
            url: "https://imagesgeo-atlas.mrnf.gouv.qc.ca/IDS_IMAGERIE_WMS/service.svc/get",
            layers: "Orthomosaique_2022_2022_Partenariat_Laurentides_20cm_RVB",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF)",
            description: "Orthophotographies aériennes 2022 (20 cm RVB) des Laurentides.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "ortho_cmq_2021",
            category: "imagerie",
            name: "Orthomosaïque Québec 2021 (CMQ - 12 cm)",
            subtitle: "Très haute résolution 12 cm (MRNF / CMQ)",
            url: "https://imagesgeo-atlas.mrnf.gouv.qc.ca/IDS_IMAGERIE_WMS/service.svc/get",
            layers: "Orthomosaique_2021_2021_Partenariat_CMQ_12cm_RVB",
            format: "image/jpeg",
            transparent: false,
            version: "1.3.0",
            defaultOpacity: 1.0,
            insertPosition: "bottom",
            attribution: "© Gouvernement du Québec (MRNF / CMQ)",
            description: "Orthomosaïque 2021 ultra-haute résolution (12 cm RVB) de la Communauté métropolitaine de Québec.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`
          },
          {
            id: "cptaq_zone_agricole",
            category: "foncier",
            name: "Zone agricole provinciale (CPTAQ)",
            subtitle: "Territoire protégé au cadastre (LPTAA)",
            url: "https://carto.cptaq.gouv.qc.ca/cgi-bin/v2/cptaq",
            layers: "zone_agricole",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.55,
            insertPosition: "below_pedologie",
            attribution: "© CPTAQ",
            description: "Zonage agricole officiel de la Commission de protection du territoire agricole du Québec.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>`
          },
          {
            id: "eau_grhq_surfaces",
            category: "eau",
            name: "Hydrographie — Plans d'eau (GRHQ)",
            subtitle: "Lacs, réservoirs & fleuve St-Laurent",
            url: "https://servicescarto.mrnf.gouv.qc.ca/pes/services/Territoire/GRHQ_simple_WMS/MapServer/WMSServer",
            layers: "1,2,3,4,5,6,7",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.75,
            insertPosition: "below_pedologie",
            attribution: "© Gouvernement du Québec (MRNF - GRHQ)",
            description: "Surfaces et plans d'eau du Québec à toutes les échelles (1:125 000 à 1:40 000 000).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`
          },
          {
            id: "inondation_mrnf",
            category: "eau",
            name: "Zones inondables (MRNF)",
            subtitle: "Cartographie des plaines inondables à risque",
            url: "https://servicescarto.mrnf.gouv.qc.ca/pes/services/Territoire/Zones_a_risque_inondation_WMS/MapServer/WMSServer",
            layers: "0",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.65,
            insertPosition: "below_pedologie",
            attribution: "© Gouvernement du Québec (MRNF)",
            description: "Périmètres des zones inondables répertoriées au Québec.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
          },
          {
            id: "milieux_humides",
            category: "eau",
            name: "Milieux humides potentiels (MELCCFP)",
            subtitle: "Cartographie provinciale (Tourbières, marais, marécages)",
            url: "https://geo.environnement.gouv.qc.ca/donnees/services/Biodiversite/MH_potentiels/MapServer/WMSServer",
            layers: "Milieux_humides_potentiels11904",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.70,
            insertPosition: "below_pedologie",
            attribution: "© Gouvernement du Québec (MELCCFP)",
            description: "Milieux humides potentiels du Québec issus de la cartographie provinciale officielle (MELCCFP - Biodiversité).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a10 10 0 0 0-7.54 16.56C5.54 17.65 7.18 17 9 17c1.47 0 2.82.43 3.96 1.16A7.95 7.95 0 0 1 17 17c1.82 0 3.46.65 4.54 1.56A10 10 0 0 0 12 2z"/><path d="M7 10v4"/><path d="M12 7v7"/><path d="M17 9v5"/><path d="M3 20c1.2-1 2.8-1.5 4.5-1.5s3.3.5 4.5 1.5c1.2-1 2.8-1.5 4.5-1.5s3.3.5 4.5 1.5"/></svg>`
          },
          {
            id: "eau_twi_mffp",
            category: "eau",
            name: "Indice d'humidité du sol (TWI)",
            subtitle: "MFFP — Écologie forestière (LiDAR 1m, zoom 10+)",
            url: "https://geoegl.msp.gouv.qc.ca/ws/mffpecofor.fcgi",
            layers: "lidar_twi",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.75,
            insertPosition: "above_pedologie",
            proxy: true,
            minZoom: 9.5,
            attribution: "© Gouvernement du Québec (MFFP - Écologie forestière)",
            description: "Indice d'humidité topographique (Topographic Wetness Index - TWI) dérivé du LiDAR 1 m par le MFFP. Permet de localiser les zones de saturation hydrique, d'accumulation des eaux et les bas-fonds propices au drainage ou aux cultures exigeantes.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><path d="M7 16a5 5 0 0 0 10 0"/></svg>`
          },
          {
            id: "plans_drainage",
            category: "foncier",
            name: "Plans de drainage agricole (Info-Sols)",
            subtitle: "Périmètres drainés & plans numérisés (JPG)",
            type: "drainage_pmtiles",
            url: "pmtiles://https://storage.googleapis.com/geoqc/drainage/plans_drainage.pmtiles",
            defaultOpacity: 0.85,
            attribution: "© Info-Sols / MAPAQ / Producteurs de grains du Québec",
            description: "Périmètres des travaux de drainage agricole souterrain et accès direct aux plans d'ingénierie numérisés haute résolution (JPG).",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`
          },
          {
            id: "foret_canopee_mffp",
            category: "foret",
            name: "Hauteur de canopée (MFFP LiDAR)",
            subtitle: "Écologie forestière (LiDAR 1m, zoom 10+)",
            url: "https://geoegl.msp.gouv.qc.ca/ws/mffpecofor.fcgi",
            layers: "lidar_mhc",
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            defaultOpacity: 0.75,
            insertPosition: "above_pedologie",
            proxy: true,
            minZoom: 9.5,
            attribution: "© Gouvernement du Québec (MFFP - Écologie forestière)",
            description: "Modèle de hauteur de canopée (MHC) issu du LiDAR 1 m du MFFP. Représente la hauteur relative de la végétation arborée et des peuplements forestiers.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L7 9h3l-4 7h6l-3 5h8l-3-5h6l-4-7h3L12 2z"/></svg>`
          },
          {
            id: "deboisement_gfw",
            category: "foret",
            name: "Déboisement — Couvert forestier (GFW)",
            subtitle: "Pertes annuelles Landsat 2001–2024 (Global Forest Watch)",
            type: "xyz",
            url: "https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png",
            format: "image/png",
            transparent: true,
            defaultOpacity: 0.80,
            insertPosition: "below_pedologie",
            attribution: "© Global Forest Watch / Hansen / UMD / WRI / Esri",
            description: "Pertes et perturbations du couvert forestier détectées par satellites Landsat à 30 m de résolution (Global Forest Watch / GLAD / UMD). Source du service : Global Forest Watch Tree Loss (ArcGIS ImageServer / GFW Tile Cache API). Rose/magenta = perte de couvert forestier.",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L7 9h3l-4 7h6l-3 5h8l-3-5h6l-4-7h3L12 2z"/></svg>`
          }
        ];
      }

      resolveIcon(icon, fallbackType = "layer") {
        if (typeof icon === "string") {
          const trimmed = icon.trim();
          if (trimmed.startsWith("<svg")) return trimmed;
          if (WMS_ICON_PRESETS[trimmed]) return WMS_ICON_PRESETS[trimmed];
        }
        return WMS_ICON_PRESETS[fallbackType] || WMS_ICON_PRESETS.layer;
      }

      async loadCatalog() {
        try {
          const resp = await fetch(this.catalogUrl, { cache: "no-cache" });
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data.categories) && data.categories.length > 0) {
              this.categories = data.categories;
            }
            if (Array.isArray(data.layers) && data.layers.length > 0) {
              const activeIds = new Set(this.activeLayerIds);
              this.registry.clear();
              data.layers.forEach(l => this.register(l));
              this.loadCustomLayersFromStorage();
              this.renderAllInSidebar();
              activeIds.forEach(id => {
                if (this.registry.has(id)) {
                  this.toggle(id, true);
                }
              });
            }
          }
        } catch (e) {
          console.warn("[WMS] Chargement de " + this.catalogUrl + ":", e);
        } finally {
          this.catalogLoaded = true;
          if (this._pendingRestoreIds) {
            this.restoreFromState(this._pendingRestoreIds);
            this._pendingRestoreIds = null;
          }
        }
      }

      init() {
        if (Array.isArray(this.defaultCatalog)) {
          this.defaultCatalog.forEach(c => this.register(c));
        }
        this.loadCustomLayersFromStorage();
        this.renderAllInSidebar();
        this.setupCustomAddEvents();
        return this.loadCatalog();
      }

      register(config) {
        const fullConfig = {
          format: "image/png",
          transparent: true,
          version: "1.3.0",
          insertPosition: "below_pedologie",
          defaultOpacity: 0.8,
          currentOpacity: config.defaultOpacity !== undefined ? config.defaultOpacity : 0.8,
          ...config
        };
        this.registry.set(fullConfig.id, fullConfig);
      }

      getTileUrl(config) {
        if (config.type === "xyz") {
          return config.url;
        }
        if (config.type === "arcgis_rest") {
          const cleanUrl = config.url.split("?")[0].replace(/\/export\/?$/, "");
          const layersParam = config.layers !== undefined && config.layers !== "" ? `&layers=show:${config.layers}` : "";
          const fmt = config.format || "png32";
          return `${cleanUrl}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=${fmt}&transparent=true&f=image${layersParam}`;
        }
        const [cleanUrl, existingQuery] = config.url.split("?");
        const queryPrefix = existingQuery ? `${existingQuery}&` : "";
        const crsParam = config.version === "1.1.1" ? "SRS=EPSG:3857" : "CRS=EPSG:3857";
        const transparent = config.transparent ? "TRUE" : "FALSE";
        const styles = config.styles || "";
        const fmt = config.format || "image/png";
        let tileUrl = `${cleanUrl}?${queryPrefix}SERVICE=WMS&VERSION=${config.version || '1.3.0'}&REQUEST=GetMap&${crsParam}&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&LAYERS=${config.layers}&STYLES=${styles}&FORMAT=${fmt}&TRANSPARENT=${transparent}`;
        if (config.proxy || cleanUrl.includes("geoegl.msp.gouv.qc.ca")) {
          tileUrl = `https://wsrv.nl/?url=${encodeURIComponent(tileUrl).replace(/%7Bbbox-epsg-3857%7D/g, '{bbox-epsg-3857}')}`;
        }
        return tileUrl;
      }

      ensureCadastreLayers(cfg) {
        if (!this.map.getSource("cadastre-source")) {
          this.map.addSource("cadastre-source", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
          });
        }

        if (!this.map.getLayer("cadastre-fill")) {
          this.map.addLayer({
            id: "cadastre-fill",
            type: "fill",
            source: "cadastre-source",
            minzoom: 13.5,
            layout: { visibility: "none" },
            paint: {
              "fill-color": "#ffffff",
              "fill-opacity": 0.001
            }
          });
        }

        if (!this.map.getLayer("cadastre-lines")) {
          this.map.addLayer({
            id: "cadastre-lines",
            type: "line",
            source: "cadastre-source",
            minzoom: 13.5,
            layout: {
              visibility: "none",
              "line-join": "round",
              "line-cap": "round"
            },
            paint: {
              "line-color": "#0f172a",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                13.5, 0.9,
                15, 1.4,
                17, 2.2
              ],
              "line-opacity": (cfg.currentOpacity !== undefined ? cfg.currentOpacity : 0.9) * 0.95
            }
          });
        }

        if (!this.map.getLayer("cadastre-labels")) {
          this.map.addLayer({
            id: "cadastre-labels",
            type: "symbol",
            source: "cadastre-source",
            minzoom: 13.5,
            layout: {
              visibility: "none",
              "symbol-placement": "point",
              "text-field": ["to-string", ["coalesce", ["get", "NO_LOT"], ""]],
              "text-font": ["Noto Sans Regular"],
              "text-size": [
                "interpolate", ["linear"], ["zoom"],
                13.5, 9.5,
                15, 11,
                17, 13
              ],
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
              "text-padding": 4
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 2,
              "text-halo-blur": 0.5,
              "text-opacity": cfg.currentOpacity !== undefined ? cfg.currentOpacity : 0.9
            }
          });
        }

        if (typeof bringTopLayersToFront === "function") {
          bringTopLayersToFront();
        } else if (typeof bringParcellesToFront === "function") {
          bringParcellesToFront();
        }
        return true;
      }

      updateCadastreViewport() {
        if (!this.isCadastreActive) return;
        if (this._cadastreDebounceTimer) {
          clearTimeout(this._cadastreDebounceTimer);
        }
        this._cadastreDebounceTimer = setTimeout(() => {
          this._fetchCadastreData();
        }, 300);
      }

      _fetchCadastreData() {
        if (!this.isCadastreActive) return;
        const currentZoom = this.map.getZoom();
        const src = this.map.getSource("cadastre-source");
        if (!src) return;

        if (currentZoom < 13.5) {
          src.setData({ type: "FeatureCollection", features: [] });
          return;
        }

        if (this.cadastreAbortController) {
          this.cadastreAbortController.abort();
        }
        this.cadastreAbortController = new AbortController();

        const bounds = this.map.getBounds();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const buf = 0.12;
        const w = (bounds.getWest() - lngSpan * buf).toFixed(5);
        const s = (bounds.getSouth() - latSpan * buf).toFixed(5);
        const e = (bounds.getEast() + lngSpan * buf).toFixed(5);
        const n = (bounds.getNorth() + latSpan * buf).toFixed(5);

        const url = `https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query?geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=NO_LOT,OBJECTID&f=geojson&returnGeometry=true`;

        fetch(url, { signal: this.cadastreAbortController.signal })
          .then(res => {
            if (!res.ok) throw new Error("Status " + res.status);
            return res.json();
          })
          .then(geojson => {
            if (!this.isCadastreActive) return;
            if (geojson && geojson.features && src.setData) {
              src.setData(geojson);
              if (typeof bringTopLayersToFront === "function") {
                bringTopLayersToFront();
              } else if (typeof bringParcellesToFront === "function") {
                bringParcellesToFront();
              }
            }
          })
          .catch(err => {
            if (err.name !== "AbortError") {
              console.warn("Erreur chargement cadastre:", err);
            }
          });
      }

      ensureDrainageLayers(cfg) {
        if (!this.map.getSource("drainage-source")) {
          this.map.addSource("drainage-source", {
            type: "vector",
            url: cfg.url || "pmtiles://https://storage.googleapis.com/geoqc/drainage/plans_drainage.pmtiles"
          });
        }

        let beforeLayer;
        if (this.map.getLayer("parcelles-line-bg")) {
          beforeLayer = "parcelles-line-bg";
        } else if (this.map.getLayer("pedologie-line")) {
          beforeLayer = "pedologie-line";
        }

        if (!this.map.getLayer("drainage-fill")) {
          this.map.addLayer({
            id: "drainage-fill",
            type: "fill",
            source: "drainage-source",
            "source-layer": "plans_drainage",
            layout: { visibility: "none" },
            paint: {
              "fill-color": "#0284c7",
              "fill-opacity": (cfg.currentOpacity !== undefined ? cfg.currentOpacity : 0.85) * 0.22
            }
          }, beforeLayer);
        }

        if (!this.map.getLayer("drainage-line")) {
          this.map.addLayer({
            id: "drainage-line",
            type: "line",
            source: "drainage-source",
            "source-layer": "plans_drainage",
            layout: {
              visibility: "none",
              "line-join": "round",
              "line-cap": "round"
            },
            paint: {
              "line-color": "#0369a1",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                9, 1.0,
                12, 1.6,
                15, 2.4
              ],
              "line-dasharray": [3, 2],
              "line-opacity": (cfg.currentOpacity !== undefined ? cfg.currentOpacity : 0.85) * 0.95
            }
          }, beforeLayer);
        }

        if (typeof bringTopLayersToFront === "function") {
          bringTopLayersToFront();
        } else if (typeof bringParcellesToFront === "function") {
          bringParcellesToFront();
        }
        return true;
      }

      ensureMapLayer(id) {
        const cfg = this.registry.get(id);
        if (!cfg) return false;

        if (cfg.type === "cadastre_geojson") {
          return this.ensureCadastreLayers(cfg);
        }
        if (cfg.type === "drainage_pmtiles") {
          return this.ensureDrainageLayers(cfg);
        }

        const sourceId = `wms-source-${id}`;
        const layerId = `wms-layer-${id}`;

        if (!this.map.getSource(sourceId)) {
          this.map.addSource(sourceId, {
            type: "raster",
            tiles: [this.getTileUrl(cfg)],
            tileSize: 256,
            attribution: cfg.attribution || "WMS"
          });
        }

        if (!this.map.getLayer(layerId)) {
          let beforeLayer;
          if (cfg.insertPosition === "above_pedologie") {
            if (this.map.getLayer("parcelles-fill")) {
              beforeLayer = "parcelles-fill";
            } else if (this.map.getLayer("parcelles-line-bg")) {
              beforeLayer = "parcelles-line-bg";
            } else if (this.map.getLayer("pedologie-line")) {
              beforeLayer = "pedologie-line";
            }
          } else if (cfg.insertPosition === "bottom") {
            if (this.map.getLayer("pedologie-hit-layer")) {
              beforeLayer = "pedologie-hit-layer";
            } else if (this.map.getLayer("pedologie-fill")) {
              beforeLayer = "pedologie-fill";
            }
          } else {
            if (this.map.getLayer("pedologie-hit-layer")) {
              beforeLayer = "pedologie-hit-layer";
            } else if (this.map.getLayer("pedologie-fill")) {
              beforeLayer = "pedologie-fill";
            }
          }

          const layerDef = {
            id: layerId,
            type: "raster",
            source: sourceId,
            layout: { visibility: "none" },
            paint: { "raster-opacity": cfg.currentOpacity }
          };
          if (cfg.minZoom) layerDef.minzoom = cfg.minZoom;
          if (cfg.maxZoom) layerDef.maxzoom = cfg.maxZoom;

          this.map.addLayer(layerDef, beforeLayer);

          if (typeof bringTopLayersToFront === "function") {
            bringTopLayersToFront();
          } else if (typeof bringParcellesToFront === "function") {
            bringParcellesToFront();
          }
        }
        return true;
      }

      toggle(id, visible) {
        const cfg = this.registry.get(id);
        if (!cfg) return;

        if (cfg.type === "cadastre_geojson") {
          this.ensureCadastreLayers(cfg);
          const vis = visible ? "visible" : "none";
          ["cadastre-fill", "cadastre-lines", "cadastre-labels"].forEach(l => {
            if (this.map.getLayer(l)) {
              this.map.setLayoutProperty(l, "visibility", vis);
            }
          });

          this.isCadastreActive = visible;
          if (visible) {
            this.activeLayerIds.add(id);
            if (!this._cadastreMoveListener) {
              this._cadastreMoveListener = () => {
                if (this.isCadastreActive) {
                  this.updateCadastreViewport();
                }
              };
              this.map.on("moveend", this._cadastreMoveListener);
            }
            this.updateCadastreViewport();
            if (typeof bringTopLayersToFront === "function") {
              bringTopLayersToFront();
            } else if (typeof bringParcellesToFront === "function") {
              bringParcellesToFront();
            }
          } else {
            this.activeLayerIds.delete(id);
            if (this.cadastreAbortController) {
              this.cadastreAbortController.abort();
            }
          }
        } else if (cfg.type === "drainage_pmtiles") {
          this.ensureDrainageLayers(cfg);
          const vis = visible ? "visible" : "none";
          ["drainage-fill", "drainage-line"].forEach(l => {
            if (this.map.getLayer(l)) {
              this.map.setLayoutProperty(l, "visibility", vis);
            }
          });
          if (visible) {
            this.activeLayerIds.add(id);
            if (typeof bringTopLayersToFront === "function") {
              bringTopLayersToFront();
            } else if (typeof bringParcellesToFront === "function") {
              bringParcellesToFront();
            }
          } else {
            this.activeLayerIds.delete(id);
          }
        } else {
          const layerId = `wms-layer-${id}`;
          if (visible) {
            this.ensureMapLayer(id);
            this.map.setLayoutProperty(layerId, "visibility", "visible");
            this.activeLayerIds.add(id);
            if (typeof bringTopLayersToFront === "function") {
              bringTopLayersToFront();
            }
          } else {
            if (this.map.getLayer(layerId)) {
              this.map.setLayoutProperty(layerId, "visibility", "none");
            }
            this.activeLayerIds.delete(id);
          }
        }

        const itemEl = document.getElementById(`wms-item-${id}`);
        if (itemEl) {
          if (visible) itemEl.classList.add("active");
          else itemEl.classList.remove("active");
          const chk = itemEl.querySelector('input[type="checkbox"]');
          if (chk) chk.checked = visible;
        }

        if (typeof updateUrl === "function") updateUrl();
        this.updateCategoryBadges();
      }

      setOpacity(id, opacity) {
        const cfg = this.registry.get(id);
        if (!cfg) return;
        cfg.currentOpacity = opacity;

        if (cfg.type === "cadastre_geojson") {
          if (this.map.getLayer("cadastre-lines")) {
            this.map.setPaintProperty("cadastre-lines", "line-opacity", opacity * 0.95);
          }
          if (this.map.getLayer("cadastre-labels")) {
            this.map.setPaintProperty("cadastre-labels", "text-opacity", opacity);
          }
        } else if (cfg.type === "drainage_pmtiles") {
          if (this.map.getLayer("drainage-fill")) {
            this.map.setPaintProperty("drainage-fill", "fill-opacity", opacity * 0.22);
          }
          if (this.map.getLayer("drainage-line")) {
            this.map.setPaintProperty("drainage-line", "line-opacity", opacity * 0.95);
          }
        } else {
          const layerId = `wms-layer-${id}`;
          if (this.map.getLayer(layerId)) {
            this.map.setPaintProperty(layerId, "raster-opacity", opacity);
          }
        }
        const valBadge = document.getElementById(`wms-opacity-val-${id}`);
        if (valBadge) valBadge.textContent = `${Math.round(opacity * 100)}%`;
        if (typeof updateUrl === "function") updateUrl();
      }

      updateCategoryBadges() {
        this.categories.forEach(cat => {
          const badge = document.getElementById(`cat-badge-${cat.id}`);
          if (!badge) return;
          const layersInCat = Array.from(this.registry.values()).filter(c => (c.category || "custom") === cat.id);
          const activeCount = layersInCat.filter(c => this.activeLayerIds.has(c.id)).length;
          if (activeCount > 0) {
            badge.textContent = `${activeCount} active${activeCount > 1 ? "s" : ""}`;
            badge.style.display = "inline-block";
          } else {
            badge.style.display = "none";
          }
        });
      }

      renderAllInSidebar() {
        const container = document.getElementById("wms-layers-list");
        if (!container) return;
        container.innerHTML = "";

        // 1. Search / filter bar
        const searchWrap = document.createElement("div");
        searchWrap.className = "wms-filter-bar";
        searchWrap.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="wms-filter-input" placeholder="Filtrer les couches..." class="wms-filter-input" autocomplete="off" />
          <button type="button" id="wms-filter-clear" style="display:none; background:none; border:none; padding:0; cursor:pointer; color:#94a3b8; font-size:13px; line-height:1;" title="Effacer">&times;</button>
        `;
        container.appendChild(searchWrap);

        // 2. Actions row
        const actionsRow = document.createElement("div");
        actionsRow.className = "wms-groups-actions";
        actionsRow.innerHTML = `
          <span style="font-size: 10px; color: #64748b; font-weight: 500;">${this.registry.size} couches disponibles</span>
          <button type="button" id="btn-toggle-all-groups" class="wms-btn-action">Tout déplier</button>
        `;
        container.appendChild(actionsRow);

        // 3. Category groups
        this.categories.forEach(cat => {
          const layersInCat = Array.from(this.registry.values()).filter(c => (c.category || "custom") === cat.id);
          if (cat.id === "custom" && layersInCat.length === 0) return; // Hide custom group if empty

          const isOpen = Boolean(cat.defaultOpen);

          const groupEl = document.createElement("details");
          groupEl.className = "wms-group";
          groupEl.id = `wms-group-${cat.id}`;
          groupEl.dataset.cat = cat.id;
          if (isOpen) groupEl.open = true;

          groupEl.innerHTML = `
            <summary class="wms-group-header">
              <div class="wms-group-title">
                <span class="wms-group-icon">${this.resolveIcon(cat.icon, cat.id || 'folder')}</span>
                <span>${cat.title}</span>
                <span class="wms-group-badge" id="cat-badge-${cat.id}"></span>
              </div>
              <svg class="wms-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </summary>
            <div class="wms-group-content" id="wms-group-items-${cat.id}"></div>
          `;

          container.appendChild(groupEl);

          const itemsContainer = groupEl.querySelector(`#wms-group-items-${cat.id}`);
          layersInCat.forEach(cfg => {
            this.renderLayerItem(cfg, itemsContainer);
          });
        });

        this.setupFilterEvents();
        this.updateCategoryBadges();
        if (this.map) {
          this.updateZoomState(this.map.getZoom());
        }
      }

      updateZoomState(currentZoom) {
        this.registry.forEach(cfg => {
          const itemEl = document.getElementById(`wms-item-${cfg.id}`);
          if (!itemEl) return;
          const minZ = cfg.minZoom !== undefined ? cfg.minZoom : 0;
          const maxZ = cfg.maxZoom !== undefined ? cfg.maxZoom : Infinity;
          const inRange = currentZoom >= minZ && currentZoom <= maxZ;

          let badge = itemEl.querySelector(".layer-zoom-badge");
          if (!badge && (minZ > 0 || maxZ < Infinity)) {
            badge = document.createElement("span");
            badge.className = "layer-zoom-badge";
            const titleEl = itemEl.querySelector(".wms-item-title");
            if (titleEl) titleEl.appendChild(badge);
          }

          if (!inRange) {
            itemEl.classList.add("layer-out-of-zoom");
            itemEl.setAttribute("title", `Couche masquée à ce niveau de zoom (requiert zoom ${minZ >= 13 ? '14+' : Math.ceil(minZ) + '+'})`);
            if (badge) {
              badge.textContent = `z ≥ ${minZ >= 13 ? 14 : Math.ceil(minZ)}`;
              badge.classList.remove("visible-now");
            }
          } else {
            itemEl.classList.remove("layer-out-of-zoom");
            itemEl.removeAttribute("title");
            if (badge) {
              badge.classList.add("visible-now");
            }
          }
        });
      }

      setupFilterEvents() {
        const inp = document.getElementById("wms-filter-input");
        const clearBtn = document.getElementById("wms-filter-clear");
        const toggleAllBtn = document.getElementById("btn-toggle-all-groups");
        if (!inp) return;

        inp.addEventListener("input", () => {
          const q = inp.value.trim().toLowerCase();
          if (clearBtn) clearBtn.style.display = q ? "block" : "none";

          this.registry.forEach(cfg => {
            const itemEl = document.getElementById(`wms-item-${cfg.id}`);
            if (!itemEl) return;
            const textMatch = !q ||
              cfg.name.toLowerCase().includes(q) ||
              (cfg.subtitle && cfg.subtitle.toLowerCase().includes(q)) ||
              (cfg.description && cfg.description.toLowerCase().includes(q));
            itemEl.style.display = textMatch ? "block" : "none";
          });

          this.categories.forEach(cat => {
            const groupEl = document.getElementById(`wms-group-${cat.id}`);
            if (!groupEl) return;
            const items = groupEl.querySelectorAll(".wms-layer-item");
            let hasVisible = false;
            items.forEach(it => {
              if (it.style.display !== "none") hasVisible = true;
            });
            groupEl.style.display = hasVisible ? "block" : "none";
            if (q && hasVisible) groupEl.open = true;
          });
        });

        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            inp.value = "";
            inp.dispatchEvent(new Event("input"));
            inp.focus();
          });
        }

        if (toggleAllBtn) {
          toggleAllBtn.addEventListener("click", () => {
            const allGroups = document.querySelectorAll(".wms-group");
            const anyClosed = Array.from(allGroups).some(g => !g.open);
            allGroups.forEach(g => g.open = anyClosed);
            toggleAllBtn.textContent = anyClosed ? "Tout replier" : "Tout déplier";
          });
        }
      }

      renderLayerItem(cfg, container) {
        const item = document.createElement("div");
        item.id = `wms-item-${cfg.id}`;
        item.className = "wms-layer-item";
        
        const opVal = Math.round(cfg.currentOpacity * 100);

        item.innerHTML = `
          <div class="wms-item-header">
            <div class="wms-item-info">
              <div class="wms-item-icon">
                ${this.resolveIcon(cfg.icon, 'layer')}
              </div>
              <div class="wms-item-titles" title="${cfg.description || cfg.name}">
                <div class="wms-item-title">
                  <span>${cfg.name}</span>
                </div>
                <div class="wms-item-subtitle">${cfg.subtitle || cfg.layers}</div>
              </div>
            </div>
            <label class="switch-label" title="Activer/Désactiver cette couche">
              <input type="checkbox" id="toggle-wms-${cfg.id}">
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="wms-item-controls">
            <div class="tool-label-row">
              <span class="tool-sublabel">Opacité</span>
              <span id="wms-opacity-val-${cfg.id}" class="val-badge">${opVal}%</span>
            </div>
            <input type="range" id="slider-wms-${cfg.id}" min="0" max="100" value="${opVal}" class="slider">
          </div>
        `;

        container.appendChild(item);

        const chk = item.querySelector(`#toggle-wms-${cfg.id}`);
        if (chk) {
          chk.addEventListener("change", (e) => {
            this.toggle(cfg.id, e.target.checked);
          });
        }

        const slider = item.querySelector(`#slider-wms-${cfg.id}`);
        if (slider) {
          slider.addEventListener("input", (e) => {
            this.setOpacity(cfg.id, parseInt(e.target.value, 10) / 100);
          });
        }
      }

      setupCustomAddEvents() {
        const btnToggle = document.getElementById("btn-toggle-add-wms");
        const box = document.getElementById("wms-custom-add-box");
        const btnConfirm = document.getElementById("btn-confirm-add-wms");
        const btnCancel = document.getElementById("btn-cancel-add-wms");
        const nameInp = document.getElementById("custom-wms-name");
        const urlInp = document.getElementById("custom-wms-url");
        const layersInp = document.getElementById("custom-wms-layers");
        const errEl = document.getElementById("custom-wms-error");

        if (btnToggle && box) {
          btnToggle.addEventListener("click", () => {
            box.style.display = box.style.display === "none" ? "block" : "none";
          });
        }

        if (btnCancel && box) {
          btnCancel.addEventListener("click", () => {
            box.style.display = "none";
            if (errEl) errEl.style.display = "none";
          });
        }

        if (btnConfirm) {
          btnConfirm.addEventListener("click", () => {
            const name = (nameInp.value || "").trim();
            const url = (urlInp.value || "").trim();
            const layers = (layersInp.value || "").trim();

            if (!name || !url || !layers) {
              if (errEl) {
                errEl.textContent = "Veuillez remplir le nom, l'URL WMS et la couche.";
                errEl.style.display = "block";
              }
              return;
            }

            const id = "custom_" + Date.now().toString(36);
            const newCfg = {
              id,
              name,
              subtitle: "Flux WMS personnalisé",
              badge: "Perso",
              badgeColor: "#64748b",
              url,
              layers,
              format: "image/png",
              transparent: true,
              version: "1.3.0",
              defaultOpacity: 0.8,
              insertPosition: "below_pedologie",
              attribution: name
            };

            this.register(newCfg);
            this.saveCustomLayerToStorage(newCfg);

            const container = document.getElementById("wms-layers-list");
            if (container) this.renderLayerItem(newCfg, container);

            this.toggle(id, true);

            nameInp.value = "";
            urlInp.value = "";
            layersInp.value = "";
            if (errEl) errEl.style.display = "none";
            if (box) box.style.display = "none";
          });
        }
      }

      saveCustomLayerToStorage(cfg) {
        try {
          const list = JSON.parse(localStorage.getItem(this.storageKey) || "[]");
          list.push(cfg);
          localStorage.setItem(this.storageKey, JSON.stringify(list));
        } catch(e) {}
      }

      loadCustomLayersFromStorage() {
        try {
          const list = JSON.parse(localStorage.getItem(this.storageKey) || "[]");
          list.forEach(c => this.register(c));
        } catch(e) {}
      }

      getActiveLayerIds() {
        return Array.from(this.activeLayerIds);
      }

      restoreFromState(wmsIds) {
        if (!Array.isArray(wmsIds)) return;
        wmsIds.forEach(id => {
          if (this.registry.has(id)) {
            this.toggle(id, true);
          }
        });
        if (!this.catalogLoaded) {
          this._pendingRestoreIds = wmsIds;
        }
      }
    }
