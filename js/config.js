const { fromUrl, proj4 } = window.GeoLibreContour || {};

    const STUDY_NAMES = {"01": {"title": "Étude pédologique des sols défrichés de l’Abitibi-Témiscamingue", "year": 1997}, "1": {"title": "Étude pédologique des sols défrichés de l’Abitibi-Témiscamingue", "year": 1997}, "02": {"title": "Les sols des comtés d’Argenteuil, Deux-Montagnes et Terrebonne", "year": 1960}, "2": {"title": "Les sols des comtés d’Argenteuil, Deux-Montagnes et Terrebonne", "year": 1960}, "04": {"title": "Étude pédologique du comté d’Arthabaska", "year": 1984}, "4": {"title": "Étude pédologique du comté d’Arthabaska", "year": 1984}, "05": {"title": "Étude pédologique du comté de Bagot", "year": 1959}, "5": {"title": "Étude pédologique du comté de Bagot", "year": 1959}, "06": {"title": "Étude pédologique du comté de Beauce", "year": 1995}, "6": {"title": "Étude pédologique du comté de Beauce", "year": 1995}, "07": {"title": "Étude pédologique des sols des comtés de Huntingdon et Beauharnois", "year": 1954}, "7": {"title": "Étude pédologique des sols des comtés de Huntingdon et Beauharnois", "year": 1954}, "08": {"title": "Étude pédologique des comtés de Bellechasse et de Montmagny", "year": 1966}, "8": {"title": "Étude pédologique des comtés de Bellechasse et de Montmagny", "year": 1966}, "09": {"title": "Étude pédologique du comté de Berthier", "year": 1957}, "9": {"title": "Étude pédologique du comté de Berthier", "year": 1957}, "11": {"title": "Études des sols des comtés de Shefford, Brome et Missisquoi", "year": 1948}, "12": {"title": "Étude pédologique du comté de Chambly (Volume 1 et 2)", "year": 1991}, "13": {"title": "Étude pédologique des comtés de Champlain et de Laviolette", "year": 1967}, "14": {"title": "Étude pédologique de la région de Charlevoix", "year": 1981}, "16": {"title": "Étude pédologique des sols du comté de Châteauguay", "year": 1950}, "17": {"title": "Pédologie de la région de Chicoutimi", "year": 1971}, "18": {"title": "Étude des sols des comtés de Stanstead, Richmond, Sherbrooke et Compton", "year": 1943}, "19": {"title": "Étude pédologique du comté de Dorchester", "year": 1976}, "20": {"title": "Étude pédologique du comté de Drummond", "year": 1960}, "21": {"title": "Étude pédologique du comté de Frontenac", "year": 1996}, "24": {"title": "Étude pédologique des comtés de Gatineau et de Pontiac", "year": 1962}, "25": {"title": "Étude pédologique des comtés de Hull, Labelle et Papineau", "year": 1967}, "26": {"title": "Carte pédologique du comté d'Iberville", "year": 2010}, "27": {"title": "Pédologie des Ïles-de-la-Madeleine", "year": 1967}, "28": {"title": "Étude pédologique du comté de Joliette", "year": 1961}, "29": {"title": "Étude pédologique du comté de Kamouraska", "year": 1965}, "30": {"title": "Pédologie de la région du Lac-Saint-Jean", "year": 1965}, "31": {"title": "Étude pédologique du comté de Laprairie", "year": 2000}, "32": {"title": "Étude pédologique des comtés de l'Assomption et de Montcalm", "year": 1965}, "33": {"title": "Étude pédologique du comté de Lévis", "year": 1962}, "34": {"title": "Étude pédologique du comté de l'Islet", "year": 1979}, "35": {"title": "Étude pédologique du comté de Lotbinière", "year": 1957}, "36": {"title": "Étude pédologique du comté de Maskinongé", "year": 1962}, "37-38": {"title": "Étude pédologique des sols en culture des comtés de Matane et de Matapédia", "year": 2017}, "39": {"title": "Étude pédologique du comté de Mégantic", "year": 1989}, "66": {"title": "Étude pédologique du bassin versant du Bras d'Henri", "year": 2010}, "41": {"title": "Les sols de l’Île de Montréal, de l’Île Jésus et de l’Île Bizard", "year": 1956}, "42": {"title": "Étude pédologique du comté de Napierville", "year": 2013}, "43": {"title": "Étude des sols du comté de Nicolet", "year": 1948}, "44": {"title": "Pédologie du comté de Portneuf", "year": 1976}, "46": {"title": "Étude pédologique du comté de Richelieu", "year": 1990}, "47": {"title": "Carte d'utilisation des terres du comté de Rimouski", "year": 1962}, "48": {"title": "Étude pédologique du comté de Rivière-du-Loup", "year": 1979}, "49": {"title": "Étude pédologique du comté de Rouville", "year": 1999}, "51": {"title": "Étude pédologique du comté de Saint-Hyacinthe (Volume 1 et 2)", "year": 1991}, "52": {"title": "Étude pédologique du comté de Saint-Jean", "year": 2001}, "53": {"title": "Étude des sols des comtés de Soulanges et de Vaudreuil", "year": 1951}, "55": {"title": "Étude pédologique du comté de Témiscouata", "year": 1981}, "56": {"title": "Étude pédologique des comtés de Trois-Rivières et de Saint-Maurice", "year": 1967}, "57": {"title": "Étude pédologique du comté de Verchères (Volume 1 et 2)", "year": 1990}, "58": {"title": "Étude pédologique du comté de Wolfe", "year": 1998}, "59": {"title": "Étude pédologique des sols du comté de Yamaska", "year": 1954}, "60": {"title": "Étude pédologique des Îles d'Orléans, aux Coudres et aux Grues", "year": 1980}, "63": {"title": "Les terres cultivées de la Péninsule Gaspésienne", "year": 2005}, "62": {"title": "Étude pédologique de l'île Sainte-Thérèse, comté de Verchères", "year": 1996}, "40": {"title": "Les terres cultivées de la MRC de la Côte-de-Beaupré", "year": 2000}, "45": {"title": "La région de Québec (secteur Sainte-Foy et Valcartier)", "year": 2001}};

    // Exact HRDEM Mosaics (56 tiles covering Canada & Quebec)
    const EPSG_3979_DEF = '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    const VALID_HRDEM_TILES = new Set([
      '1_3','1_4','1_5','1_6','1_7','2_3','2_4','2_5','2_6','2_7','2_8',
      '3_3','3_4','3_5','3_6','3_7','3_8','4_3','4_4','4_5','4_6',
      '5_3','5_4','5_6','5_7','5_8','6_2','6_3','6_5','6_6','6_7','6_8',
      '7_2','7_3','7_4','7_5','7_6','7_7','7_8','8_1','8_2','8_3','8_4',
      '8_5','8_6','8_7','9_2','9_3','9_4','9_5','10_2','10_3','10_4','10_5',
      '11_3','11_4'
    ]);

    function findTileForCoords(lng, lat) {
      try {
        const pt = proj4('EPSG:4326', EPSG_3979_DEF, [lng, lat]);
        const col = Math.floor(pt[0] / 500000) + 6;
        const row = Math.floor(pt[1] / 500000) + 3;
        const key = `${col}_${row}`;
        if (VALID_HRDEM_TILES.has(key)) {
          return `https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/${key}-mosaic-1m-dtm.tif`;
        }
      } catch (e) {
        console.warn('findTileForCoords calculation error:', e);
      }
      return null;
    }

    function findBestTileForArea(minLng, minLat, maxLng, maxLat, clickLng, clickLat) {
      if (typeof clickLng === "number" && typeof clickLat === "number") {
        const t = findTileForCoords(clickLng, clickLat);
        if (t) return t;
      }
      const midLng = (minLng + maxLng) / 2;
      const midLat = (minLat + maxLat) / 2;
      let t = findTileForCoords(midLng, midLat);
      if (t) return t;
      for (const [lng, lat] of [[minLng, minLat], [maxLng, maxLat], [minLng, maxLat], [maxLng, minLat]]) {
        t = findTileForCoords(lng, lat);
        if (t) return t;
      }
      return null;
    }

    // Shared HRDEM COG header cache across managers
    const HRDEM_COG_CACHE = new Map();
    function getHrdemCog(url) {
      if (!HRDEM_COG_CACHE.has(url)) {
        HRDEM_COG_CACHE.set(url, fromUrl(url, {}, AbortSignal.timeout(30000)));
      }
      return HRDEM_COG_CACHE.get(url);
    }

    // Identify all HRDEM 500x500 km tiles intersecting a WGS84 bounding box
    function findTilesForBbox(minLng, minLat, maxLng, maxLat, product = 'dtm') {
      try {
        const pts = [
          proj4('EPSG:4326', EPSG_3979_DEF, [minLng, maxLat]),
          proj4('EPSG:4326', EPSG_3979_DEF, [maxLng, maxLat]),
          proj4('EPSG:4326', EPSG_3979_DEF, [maxLng, minLat]),
          proj4('EPSG:4326', EPSG_3979_DEF, [minLng, minLat]),
          proj4('EPSG:4326', EPSG_3979_DEF, [(minLng + maxLng) / 2, maxLat]),
          proj4('EPSG:4326', EPSG_3979_DEF, [(minLng + maxLng) / 2, minLat]),
          proj4('EPSG:4326', EPSG_3979_DEF, [minLng, (minLat + maxLat) / 2]),
          proj4('EPSG:4326', EPSG_3979_DEF, [maxLng, (minLat + maxLat) / 2])
        ];
        const minX = Math.min(...pts.map(p => p[0]));
        const maxX = Math.max(...pts.map(p => p[0]));
        const minY = Math.min(...pts.map(p => p[1]));
        const maxY = Math.max(...pts.map(p => p[1]));
        const minCol = Math.floor(minX / 500000) + 6;
        const maxCol = Math.floor(maxX / 500000) + 6;
        const minRow = Math.floor(minY / 500000) + 3;
        const maxRow = Math.floor(maxY / 500000) + 3;
        const tiles = [];
        for (let c = minCol; c <= maxCol; c++) {
          for (let r = minRow; r <= maxRow; r++) {
            const key = `${c}_${r}`;
            if (VALID_HRDEM_TILES.has(key)) {
              tiles.push({
                key,
                col: c,
                row: r,
                url: `https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/${key}-mosaic-1m-${product}.tif`,
                tileX0: (c - 6) * 500000,
                tileX1: (c - 5) * 500000,
                tileY0: (r - 3) * 500000,
                tileY1: (r - 2) * 500000
              });
            }
          }
        }
        return tiles;
      } catch (e) {
        console.warn('findTilesForBbox error:', e);
        return [];
      }
    }

    // Unified Multi-Tile HRDEM Region Reader: merges adjacent tiles seamlessly into a continuous elevation grid
    async function readMultiHrdemRegion(bboxWgs84, targetSize = 256, signal = null, resampling = 'bilinear', product = 'dtm') {
      const [w, s, e, n] = bboxWgs84;
      const pts = [
        proj4('EPSG:4326', EPSG_3979_DEF, [w, n]),
        proj4('EPSG:4326', EPSG_3979_DEF, [e, n]),
        proj4('EPSG:4326', EPSG_3979_DEF, [e, s]),
        proj4('EPSG:4326', EPSG_3979_DEF, [w, s]),
        proj4('EPSG:4326', EPSG_3979_DEF, [(w + e) / 2, n]),
        proj4('EPSG:4326', EPSG_3979_DEF, [(w + e) / 2, s]),
        proj4('EPSG:4326', EPSG_3979_DEF, [w, (s + n) / 2]),
        proj4('EPSG:4326', EPSG_3979_DEF, [e, (s + n) / 2])
      ];
      const minX = Math.min(...pts.map(p => p[0]));
      const maxX = Math.max(...pts.map(p => p[0]));
      const minY = Math.min(...pts.map(p => p[1]));
      const maxY = Math.max(...pts.map(p => p[1]));

      if (minX >= maxX || minY >= maxY) return null;

      const minCol = Math.floor(minX / 500000) + 6;
      const maxCol = Math.floor(maxX / 500000) + 6;
      const minRow = Math.floor(minY / 500000) + 3;
      const maxRow = Math.floor(maxY / 500000) + 3;

      const intersecting = [];
      for (let c = minCol; c <= maxCol; c++) {
        for (let r = minRow; r <= maxRow; r++) {
          const key = `${c}_${r}`;
          if (VALID_HRDEM_TILES.has(key)) {
            const tileX0 = (c - 6) * 500000;
            const tileX1 = (c - 5) * 500000;
            const tileY0 = (r - 3) * 500000;
            const tileY1 = (r - 2) * 500000;
            const ovX0 = Math.max(minX, tileX0);
            const ovX1 = Math.min(maxX, tileX1);
            const ovY0 = Math.max(minY, tileY0);
            const ovY1 = Math.min(maxY, tileY1);
            if (ovX0 < ovX1 && ovY0 < ovY1) {
              intersecting.push({
                key, col: c, row: r,
                url: `https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/${key}-mosaic-1m-${product}.tif`,
                tileX0, tileX1, tileY0, tileY1,
                ovX0, ovX1, ovY0, ovY1
              });
            }
          }
        }
      }

      if (intersecting.length === 0) return null;

      const gridW = targetSize;
      const gridH = targetSize;
      const unifiedData = new Float32Array(gridW * gridH).fill(NaN);

      await Promise.all(intersecting.map(async (tile) => {
        try {
          const cog = await getHrdemCog(tile.url);
          if (signal && signal.aborted) return;

          const col0 = Math.max(0, Math.min(gridW, Math.round(((tile.ovX0 - minX) / (maxX - minX)) * gridW)));
          const col1 = Math.max(0, Math.min(gridW, Math.round(((tile.ovX1 - minX) / (maxX - minX)) * gridW)));
          const row0 = Math.max(0, Math.min(gridH, Math.round(((maxY - tile.ovY1) / (maxY - minY)) * gridH)));
          const row1 = Math.max(0, Math.min(gridH, Math.round(((maxY - tile.ovY0) / (maxY - minY)) * gridH)));

          const subW = col1 - col0;
          const subH = row1 - row0;
          if (subW < 1 || subH < 1) return;

          const gX0 = minX + (col0 / gridW) * (maxX - minX);
          const gX1 = minX + (col1 / gridW) * (maxX - minX);
          const gY_top = maxY - (row0 / gridH) * (maxY - minY);
          const gY_bottom = maxY - (row1 / gridH) * (maxY - minY);

          const xFraction1 = Math.max(0, Math.min(1, (gX0 - tile.tileX0) / 500000));
          const xFraction2 = Math.max(0, Math.min(1, (gX1 - tile.tileX0) / 500000));
          const yFraction1 = Math.max(0, Math.min(1, (tile.tileY1 - gY_top) / 500000));
          const yFraction2 = Math.max(0, Math.min(1, (tile.tileY1 - gY_bottom) / 500000));

          if (xFraction2 <= xFraction1 || yFraction2 <= yFraction1) return;

          const baseImage = await cog.getImage(0);
          const imageCount = await cog.getImageCount();
          let image = baseImage;
          for (let idx = 1; idx < imageCount; idx++) {
            const candidate = await cog.getImage(idx);
            const candW = (xFraction2 - xFraction1) * candidate.getWidth();
            const candH = (yFraction2 - yFraction1) * candidate.getHeight();
            if (candW < subW || candH < subH) break;
            image = candidate;
          }

          const imgW = image.getWidth();
          const imgH = image.getHeight();
          const px1 = Math.max(0, Math.floor(xFraction1 * imgW));
          const py1 = Math.max(0, Math.floor(yFraction1 * imgH));
          const px2 = Math.min(imgW, Math.ceil(xFraction2 * imgW));
          const py2 = Math.min(imgH, Math.ceil(yFraction2 * imgH));

          if (px2 - px1 < 1 || py2 - py1 < 1) return;

          const rasters = await image.readRasters({
            samples: [0],
            window: [px1, py1, px2, py2],
            width: subW,
            height: subH,
            signal,
            resampleMethod: resampling
          });

          const raw = rasters[0];
          for (let r = 0; r < subH; r++) {
            const targetRowOffset = (row0 + r) * gridW + col0;
            const srcRowOffset = r * subW;
            for (let c = 0; c < subW; c++) {
              const v = Number(raw[srcRowOffset + c]);
              if (Number.isFinite(v) && v > -1000 && v < 9000 && v !== -32767 && v !== -9999) {
                unifiedData[targetRowOffset + c] = v;
              }
            }
          }
        } catch (e) {
          if (signal && signal.aborted) return;
          console.warn('Error reading slice for HRDEM tile', tile.key, e);
        }
      }));

      let hasValid = false;
      for (let i = 0; i < unifiedData.length; i++) {
        if (!isNaN(unifiedData[i])) {
          hasValid = true;
          break;
        }
      }
      if (!hasValid) return null;

      const toWgs = (x, y) => proj4(EPSG_3979_DEF, 'EPSG:4326', [x, y]);
      const cornersWgs84 = [
        toWgs(minX, maxY), // NW
        toWgs(maxX, maxY), // NE
        toWgs(maxX, minY), // SE
        toWgs(minX, minY)  // SW
      ];
      const actualBboxWgs84 = [
        Math.min(cornersWgs84[0][0], cornersWgs84[3][0]),
        Math.min(cornersWgs84[2][1], cornersWgs84[3][1]),
        Math.max(cornersWgs84[1][0], cornersWgs84[2][0]),
        Math.max(cornersWgs84[0][1], cornersWgs84[1][1])
      ];

      return {
        data: unifiedData,
        width: gridW,
        height: gridH,
        sourceBBox: [minX, minY, maxX, maxY],
        bboxWgs84: actualBboxWgs84,
        cornersWgs84,
        projection: EPSG_3979_DEF,
        tilesCount: intersecting.length,
        tiles: intersecting.map(t => t.key)
      };
    }

    function isPointInRing(pt, ring) {
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

    function isPointInGeom(pt, geom) {
      if (!geom || !geom.coordinates) return true;
      if (geom.type === "Polygon") {
        if (!geom.coordinates.length || !isPointInRing(pt, geom.coordinates[0])) return false;
        for (let k = 1; k < geom.coordinates.length; k++) {
          if (isPointInRing(pt, geom.coordinates[k])) return false;
        }
        return true;
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          if (poly.length && isPointInRing(pt, poly[0])) {
            let inHole = false;
            for (let k = 1; k < poly.length; k++) {
              if (isPointInRing(pt, poly[k])) { inHole = true; break; }
            }
            if (!inHole) return true;
          }
        }
        return false;
      }
      return true;
    }

    // Viewport Raster Stretch Color Ramp: Mauve (lowest) -> Red (highest)
    const TOPO_COLORMAP = [
      { t: 0.00, r: 76,  g: 29,  b: 149 }, // mauve sombre (#4c1d95)
      { t: 0.15, r: 124, g: 58,  b: 237 }, // violet (#7c3aed)
      { t: 0.30, r: 37,  g: 99,  b: 235 }, // bleu royal (#2563eb)
      { t: 0.45, r: 13,  g: 148, b: 136 }, // cyan/sarcelle (#0d9488)
      { t: 0.60, r: 22,  g: 163, b: 74  }, // vert (#16a34a)
      { t: 0.75, r: 234, g: 179, b: 8   }, // jaune (#eab308)
      { t: 0.88, r: 234, g: 88,  b: 12  }, // orange (#ea580c)
      { t: 1.00, r: 220, g: 38,  b: 38  }  // rouge (#dc2626)
    ];

    function interpolateColor(t) {
      if (t <= 0) return TOPO_COLORMAP[0];
      if (t >= 1) return TOPO_COLORMAP[TOPO_COLORMAP.length - 1];
      for (let i = 0; i < TOPO_COLORMAP.length - 1; i++) {
        const c1 = TOPO_COLORMAP[i];
        const c2 = TOPO_COLORMAP[i + 1];
        if (t >= c1.t && t <= c2.t) {
          const ratio = (t - c1.t) / (c2.t - c1.t);
          return {
            r: Math.round(c1.r + (c2.r - c1.r) * ratio),
            g: Math.round(c1.g + (c2.g - c1.g) * ratio),
            b: Math.round(c1.b + (c2.b - c1.b) * ratio)
          };
        }
      }
      return TOPO_COLORMAP[TOPO_COLORMAP.length - 1];
    }

    function stretchPercentile(sorted, fraction) {
      if (sorted.length === 1) return sorted[0];
      const pos = fraction * (sorted.length - 1);
      const low = Math.floor(pos);
      const up = Math.ceil(pos);
      return sorted[low] + (sorted[up] - sorted[low]) * (pos - low);
    }

    function calculateViewportStretchRange(rawValues, method) {
      const valid = [];
      for (let i = 0; i < rawValues.length; i++) {
        const v = rawValues[i];
        if (Number.isFinite(v) && v > -1000 && v < 9000) {
          valid.push(v);
        }
      }
      if (valid.length === 0) return [0, 100];
      valid.sort((a, b) => a - b);
      if (method === "minmax") {
        return [valid[0], valid[valid.length - 1]];
      }
      // Percentile 5-95%
      return [stretchPercentile(valid, 0.05), stretchPercentile(valid, 0.95)];
    }

    // TopoManager handles real-time dynamic viewport raster stretch