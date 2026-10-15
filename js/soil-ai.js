    class SoilAiAssistant {
      constructor(mapInstance) {
        this.map = mapInstance;
        this.isOpen = false;
        this.messages = [];
        this.currentContext = null;
        this.isWaitingResponse = false;
        this.apiKey = localStorage.getItem("pedo_openai_key") || "";
        this.workerUrl = "https://autumn-wood-e444.lingering-thunder-a2ad.workers.dev/";
        this.seriesDb = null;
        this.loadSeriesSummaries();

        this.dockEl = document.getElementById("soil-ai-dock");
        this.messagesEl = document.getElementById("soil-ai-messages");
        this.quickRepliesEl = document.getElementById("soil-ai-quick-replies");
        this.keyPanelEl = document.getElementById("soil-ai-key-panel");
        this.contextStripEl = document.getElementById("soil-ai-context-strip");
        this.contextTextEl = document.getElementById("soil-ai-context-text");
        this.keyInputEl = document.getElementById("input-openai-key");
        this.keyStatusEl = document.getElementById("soil-ai-key-status");
        this.userInputEl = document.getElementById("soil-ai-user-input");
        this.formEl = document.getElementById("soil-ai-form");
        this.marker = null;

        this.initListeners();
        if (this.apiKey && this.keyInputEl) {
          this.keyInputEl.value = this.apiKey;
        }
      }

      async loadSeriesSummaries() {
        if (this.seriesDb) return;
        try {
          const res = await fetch("data/series_summaries.json");
          if (res.ok) {
            this.seriesDb = await res.json();
          }
        } catch (e) {
          console.warn("Could not load series_summaries.json:", e);
        }
      }

      lookupSeries(name) {
        if (!this.seriesDb || !name) return null;
        let clean = name.replace(/^Série\s+/i, "").trim().toLowerCase();
        let slug = clean.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        return this.seriesDb[slug] || this.seriesDb[clean] || null;
      }

      formatSeriesDetails(seriesList) {
        if (!seriesList || seriesList.length === 0) return "- Aucune série documentée.";
        return seriesList.map(s => {
          const info = this.lookupSeries(s.name);
          let str = `- **${s.name}** (~${s.pct}%)`;
          if (s.url) {
            str += ` [Fiche : ${s.url}]`;
          }
          if (info) {
            const metaParts = [];
            if (info.ordre) metaParts.push(`Ordre : ${info.ordre}` + (info.groupe ? ` (${info.groupe})` : ''));
            if (info.texture) metaParts.push(`Texture : ${info.texture}`);
            if (info.drainage) metaParts.push(`Drainage : ${info.drainage}`);
            if (info.materiau) metaParts.push(`Origine : ${info.materiau}`);
            if (metaParts.length > 0) {
              str += String.fromCharCode(10) + `  • ` + metaParts.join(" | ");
            }
            if (info.description) {
              str += String.fromCharCode(10) + `  • Caractères physiques : ${info.description}`;
            }
          }
          return str;
        }).join(String.fromCharCode(10, 10));
      }

      async analyzeTopography(lngLat, geom = null) {
        try {
          if (typeof findTileForCoords !== "function" || typeof fromUrl !== "function" || typeof readCogRegion !== "function") {
            return null;
          }
          const tileUrl = findTileForCoords(lngLat.lng, lngLat.lat);
          if (!tileUrl) return null;

          let minLng = lngLat.lng, maxLng = lngLat.lng, minLat = lngLat.lat, maxLat = lngLat.lat;
          let hasGeom = false;

          if (geom && geom.coordinates) {
            const extractCoords = (coords) => {
              if (!Array.isArray(coords)) return;
              if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
                if (coords[0] < minLng) minLng = coords[0];
                if (coords[0] > maxLng) maxLng = coords[0];
                if (coords[1] < minLat) minLat = coords[1];
                if (coords[1] > maxLat) maxLat = coords[1];
                hasGeom = true;
              } else {
                for (const c of coords) extractCoords(c);
              }
            };
            extractCoords(geom.coordinates);
          }

          const maxRadiusDeg = 400 / 111320;
          if (!hasGeom || (maxLng - minLng) > maxRadiusDeg * 2 || (maxLat - minLat) > maxRadiusDeg * 2) {
            minLng = lngLat.lng - maxRadiusDeg;
            maxLng = lngLat.lng + maxRadiusDeg;
            minLat = lngLat.lat - maxRadiusDeg;
            maxLat = lngLat.lat + maxRadiusDeg;
          } else {
            const pad = 0.0003;
            minLng -= pad; maxLng += pad; minLat -= pad; maxLat += pad;
          }

          const bbox = [minLng, minLat, maxLng, maxLat];
          const region = await readMultiHrdemRegion(bbox, 64, AbortSignal.timeout(6000), 'bilinear');
          if (!region || !region.data || !region.sourceBBox) return null;

          const [clickX, clickY] = proj4('EPSG:4326', EPSG_3979_DEF, [lngLat.lng, lngLat.lat]);
          const px = Math.max(0, Math.min(region.width - 1, Math.round(((clickX - region.sourceBBox[0]) / (region.sourceBBox[2] - region.sourceBBox[0])) * (region.width - 1))));
          const py = Math.max(0, Math.min(region.height - 1, Math.round(((region.sourceBBox[3] - clickY) / (region.sourceBBox[3] - region.sourceBBox[1])) * (region.height - 1))));
          const pointAlt = region.data[py * region.width + px];

          if (!Number.isFinite(pointAlt) || pointAlt <= -1000 || pointAlt >= 9000) return null;

          const validAlts = [];
          for (let i = 0; i < region.data.length; i++) {
            const v = region.data[i];
            if (Number.isFinite(v) && v > -1000 && v < 9000) {
              validAlts.push(v);
            }
          }

          if (validAlts.length === 0) return null;

          validAlts.sort((a, b) => a - b);
          const minAlt = validAlts[0];
          const maxAlt = validAlts[validAlts.length - 1];
          const avgAlt = validAlts.reduce((a, b) => a + b, 0) / validAlts.length;
          const lowerCount = validAlts.filter(v => v <= pointAlt).length;
          const percentile = Math.round((lowerCount / validAlts.length) * 100);

          let position = "Mi-pente";
          let catenaEffect = "Position intermédiaire de versant (ruissellement et drainage modérés).";
          if (percentile >= 70) {
            position = "Haut de versant / Sommet";
            catenaEffect = "Zone d'évacuation de l'eau en crête ou haut de pente : favorise les sols bien drainés et réduit le risque d'engorgement superficiel.";
          } else if (percentile <= 30) {
            position = "Bas de versant / Dépression";
            catenaEffect = "Pied de pente ou zone réceptrice : accumulation de l'eau et sédimentation fine, propice aux gleysols ou marbrures d'hydromorphie plus superficielles.";
          }

          return {
            pointAlt: Math.round(pointAlt * 10) / 10,
            minAlt: Math.round(minAlt * 10) / 10,
            maxAlt: Math.round(maxAlt * 10) / 10,
            avgAlt: Math.round(avgAlt * 10) / 10,
            diffFromAvg: Math.round((pointAlt - avgAlt) * 10) / 10,
            totalRelief: Math.round((maxAlt - minAlt) * 10) / 10,
            percentile,
            position,
            catenaEffect
          };
        } catch (err) {
          console.warn("Topography analysis note:", err);
          return null;
        }
      }

      initListeners() {
        const btnClose = document.getElementById("btn-soil-ai-close");
        const btnSettings = document.getElementById("btn-soil-ai-settings");
        const btnReset = document.getElementById("btn-soil-ai-reset");
        const btnSaveKey = document.getElementById("btn-save-openai-key");

        if (btnClose) btnClose.addEventListener("click", () => this.close());
        if (btnSettings) {
          btnSettings.addEventListener("click", () => {
            if (this.keyPanelEl) {
              const isShown = this.keyPanelEl.style.display !== "none";
              this.keyPanelEl.style.display = isShown ? "none" : "block";
            }
          });
        }
        if (btnReset) {
          btnReset.addEventListener("click", () => {
            if (this.currentContext) {
              this.startDiagnosis(this.currentContext);
            } else {
              this.renderWelcome();
            }
          });
        }
        if (btnSaveKey && this.keyInputEl) {
          btnSaveKey.addEventListener("click", () => {
            const val = this.keyInputEl.value.trim();
            if (val) {
              this.apiKey = val;
              localStorage.setItem("pedo_openai_key", val);
              if (this.keyStatusEl) {
                this.keyStatusEl.innerHTML = `<span style="color:#16a34a; font-weight:600;">Clé enregistrée avec succès.</span>`;
              }
              setTimeout(() => {
                if (this.keyPanelEl) this.keyPanelEl.style.display = "none";
                if (this.currentContext && this.messages.length === 0) {
                  this.startDiagnosis(this.currentContext);
                }
              }, 600);
            } else {
              this.apiKey = "";
              localStorage.removeItem("pedo_openai_key");
              if (this.keyStatusEl) {
                this.keyStatusEl.innerHTML = `<span style="color:#dc2626;">Clé supprimée.</span>`;
              }
            }
          });
        }

        if (this.formEl) {
          this.formEl.addEventListener("submit", (e) => {
            e.preventDefault();
            const text = this.userInputEl ? this.userInputEl.value.trim() : "";
            if (text && !this.isWaitingResponse) {
              this.sendMessage(text);
              if (this.userInputEl) this.userInputEl.value = "";
            }
          });
        }
      }

      open() {
        if (!this.dockEl) return;
        this.dockEl.classList.add("open");
        this.isOpen = true;
        if (!this.currentContext && this.messages.length === 0) {
          this.renderWelcome();
        }
      }

      close() {
        if (!this.dockEl) return;
        this.dockEl.classList.remove("open");
        this.isOpen = false;
        if (this.marker) {
          this.marker.remove();
          this.marker = null;
        }
      }

      async openWithContext(lngLat, pedoProps = null, featureGeom = null) {
        this.open();
        if (this.contextStripEl && this.contextTextEl) {
          this.contextStripEl.style.display = "flex";
          this.contextTextEl.textContent = "Acquisition du secteur et calcul du relief MNT LiDAR...";
        }
        const context = await this.gatherContext(lngLat, pedoProps, featureGeom);
        this.startDiagnosis(context);
      }

      async gatherContext(lngLat, pedoProps = null, featureGeom = null) {
        let pProps = pedoProps;
        let geom = featureGeom;
        const ptPoint = this.map.project(lngLat);

        const pedoLayers = [];
        if (this.map.getLayer("pedologie-hit-layer")) pedoLayers.push("pedologie-hit-layer");
        if (this.map.getLayer("pedologie-fill")) pedoLayers.push("pedologie-fill");

        if ((!pProps || !geom) && pedoLayers.length > 0) {
          try {
            const hits = this.map.queryRenderedFeatures(ptPoint, { layers: pedoLayers });
            if (hits && hits.length > 0) {
              if (!pProps) pProps = hits[0].properties;
              if (!geom) geom = hits[0].geometry;
            }
          } catch (e) {
            console.warn("Could not query pedologie at point:", e);
          }
        }

        const radiusMeters = 50;
        const deltaLat = radiusMeters / 111320;
        const deltaLng = radiusMeters / (111320 * Math.cos(lngLat.lat * Math.PI / 180));

        const p1 = this.map.project([lngLat.lng - deltaLng, lngLat.lat - deltaLat]);
        const p2 = this.map.project([lngLat.lng + deltaLng, lngLat.lat + deltaLat]);

        const bbox = [
          [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y)],
          [Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)]
        ];

        let nearbyPedoFeatures = [];
        if (pedoLayers.length > 0) {
          try {
            nearbyPedoFeatures = this.map.queryRenderedFeatures(bbox, { layers: pedoLayers });
          } catch (e) {
            nearbyPedoFeatures = [];
          }
        }

        if (!pProps && nearbyPedoFeatures.length > 0) {
          pProps = nearbyPedoFeatures[0].properties;
          if (!geom) geom = nearbyPedoFeatures[0].geometry;
        }

        const primarySeries = [];
        let studyTitle = "";
        let studyYear = "";
        let appellation = "";
        let region = "";

        if (pProps) {
          const rawEtude = String(pProps.No_etude || pProps.etude_code || "").trim();
          let cleanEtudeCode = rawEtude.replace(/^0+/, "");
          const studyInfo = (typeof STUDY_NAMES !== "undefined")
            ? (STUDY_NAMES[rawEtude] || STUDY_NAMES[cleanEtudeCode] || STUDY_NAMES[rawEtude.padStart(2, "0")])
            : null;
          studyTitle = studyInfo ? studyInfo.title : (rawEtude ? "Étude nº " + rawEtude : "Étude pédologique");
          studyYear = studyInfo ? studyInfo.year : "";
          appellation = (pProps.Appellation_cartographique || "").trim();
          region = (pProps.Nom_region || pProps.nom_region || "").trim();

          for (let i = 1; i <= 4; i++) {
            const desc = (pProps["s" + i + "_desc"] || "").trim();
            const pct = parseFloat(pProps["s" + i + "_pct"]);
            const url = (pProps["s" + i + "_url"] || "").trim();
            if (desc && !isNaN(pct) && pct > 0) {
              primarySeries.push({ name: desc, pct: Math.round(pct), url: url });
            }
          }
        }

        const nearbySeriesMap = new Map();
        nearbyPedoFeatures.forEach(feat => {
          const fp = feat.properties;
          if (!fp) return;
          for (let i = 1; i <= 4; i++) {
            const desc = (fp["s" + i + "_desc"] || "").trim();
            const pct = parseFloat(fp["s" + i + "_pct"]);
            const url = (fp["s" + i + "_url"] || "").trim();
            if (desc && !isNaN(pct) && pct > 0) {
              if (!primarySeries.some(s => s.name === desc) && !nearbySeriesMap.has(desc)) {
                nearbySeriesMap.set(desc, { name: desc, pct: Math.round(pct), url: url });
              }
            }
          }
        });

        const nearbySeries = Array.from(nearbySeriesMap.values());

        const topo = await this.analyzeTopography(lngLat, geom);

        return {
          lngLat,
          studyTitle,
          studyYear,
          appellation,
          region,
          primarySeries,
          nearbySeries,
          topo
        };
      }

      renderWelcome() {
        if (!this.messagesEl) return;
        this.messagesEl.innerHTML = `
          <div style="text-align: center; padding: 24px 14px; color: #475569;">
            <div style="width: 38px; height: 38px; border-radius: 6px; background: #0f172a; color: #ffffff; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line></svg>
            </div>
            <h4 style="margin: 0 0 6px 0; color: #0f172a; font-size: 13.5px; font-weight: 600;">Clé diagnostique des sols du Québec</h4>
            <p style="margin: 0 0 16px 0; font-size: 12px; line-height: 1.5; color: #64748b;">
              Sélectionnez un polygone pédologique ou une parcelle sur la carte pour initier l'analyse topographique LiDAR et l'identification de la série présente.
            </p>
            ${(!this.apiKey && !this.workerUrl) ? `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: left;">
                <div style="font-weight: 600; color: #0f172a; font-size: 11.5px; margin-bottom: 4px;">Clé d'accès API requise</div>
                <div style="font-size: 11px; color: #64748b; margin-bottom: 8px;">Entrez votre clé OpenAI pour activer l'assistant de terrain :</div>
                <div style="display:flex; gap:6px;">
                  <input type="password" id="welcome-key-input" class="soil-ai-text-input" placeholder="sk-..." style="background:#fff;" />
                  <button id="welcome-key-btn" class="profile-dock-btn" type="button" style="background:#0f172a; color:#fff; border-color:#1e293b; font-weight:600;">Activer</button>
                </div>
              </div>
            ` : ''}
          </div>
        `;

        const welcomeBtn = document.getElementById("welcome-key-btn");
        const welcomeInput = document.getElementById("welcome-key-input");
        if (welcomeBtn && welcomeInput) {
          welcomeBtn.addEventListener("click", () => {
            const k = welcomeInput.value.trim();
            if (k) {
              this.apiKey = k;
              localStorage.setItem("pedo_openai_key", k);
              if (this.keyInputEl) this.keyInputEl.value = k;
              this.renderWelcome();
            }
          });
        }
      }

      async startDiagnosis(context) {
        this.currentContext = context;
        this.messages = [];
        if (this.quickRepliesEl) this.quickRepliesEl.innerHTML = "";
        if (this.messagesEl) this.messagesEl.innerHTML = "";

        if (this.marker) this.marker.remove();
        const el = document.createElement("div");
        el.innerHTML = '<div style="width:14px;height:14px;border-radius:50%;background:#0f172a;border:2.5px solid #fff;box-shadow:0 0 8px rgba(15,23,42,0.6);"></div>';
        this.marker = new maplibregl.Marker({ element: el })
          .setLngLat([context.lngLat.lng, context.lngLat.lat])
          .addTo(this.map);

        if (this.contextStripEl && this.contextTextEl) {
          this.contextStripEl.style.display = "flex";
          const seriesNames = context.primarySeries.map(s => s.name).join(", ") || (context.appellation || 'Secteur');
          let text = `${seriesNames}`;
          if (context.topo) {
            text += ` • Alt. ${context.topo.pointAlt} m (${context.topo.position})`;
          }
          this.contextTextEl.textContent = text;
        }

        if (!this.seriesDb) {
          await this.loadSeriesSummaries();
        }

        if (context.primarySeries.length === 0 && context.nearbySeries.length === 0) {
          if (this.contextStripEl && this.contextTextEl) {
            this.contextStripEl.style.display = "flex";
            this.contextTextEl.textContent = "Aucune série cartographiée à cet endroit";
          }
          this.renderErrorMessage("Aucune série de sol documentée sous ce point dans les inventaires pédologiques officiels (zone non cartographiée ou hors inventaire). Veuillez sélectionner un secteur cartographié sur la carte.");
          return;
        }

        if (!this.apiKey && !this.workerUrl) {
          this.renderWelcome();
          if (this.keyPanelEl) this.keyPanelEl.style.display = "block";
          return;
        }

        const systemPrompt = this.buildSystemPrompt(context);
        this.messages.push({ role: "system", content: systemPrompt });

        this.messages.push({
          role: "user",
          content: "Bonjour. Je me trouve sur ce point. Peux-tu analyser les séries de sols candidates dans ce polygone et à moins de 50 m en tenant compte du relief et de la caténa, et me poser la première question discriminante pour identifier le sol présent ?"
        });

        this.callOpenAi();
      }

      buildSystemPrompt(context) {
        const primaryStr = this.formatSeriesDetails(context.primarySeries);
        const nearbyStr = this.formatSeriesDetails(context.nearbySeries);

        let topoBlock = "- Altitude et relief : Données altimétriques non disponibles pour ce secteur.";
        if (context.topo) {
          const t = context.topo;
          topoBlock = `- Altitude au point : ${t.pointAlt} m
- Relief du polygone/secteur : ${t.minAlt} m à ${t.maxAlt} m (dénivelé : ${t.totalRelief} m, moyenne : ${t.avgAlt} m)
- Position relative dans le versant : ${t.position} (percentile topographique : ${t.percentile}%, écart à la moyenne : ${t.diffFromAvg >= 0 ? '+' : ''}${t.diffFromAvg} m)
- Incidence topopédologique (caténa) : ${t.catenaEffect}`;
        }

        return `Tu es un pédologue expert et cartographe des sols du Québec. Ton mandat est de guider un observateur sur le terrain pour identifier avec rigueur la série de sol exacte sous ses pieds selon la classification officielle québécoise.

DONNÉES GÉOGRAPHIQUES DU SITE :
- Coordonnées : [${context.lngLat.lat.toFixed(5)}°N, ${Math.abs(context.lngLat.lng).toFixed(5)}°O]
- Région : ${context.region || 'Québec'}
- Étude pédologique : ${context.studyTitle} ${context.studyYear ? `(${context.studyYear})` : ''}
- Appellation cartographique : ${context.appellation || 'N/A'}

TOPOGRAPHIE ET CATÉNA (MNT LiDAR 1 m) :
${topoBlock}

SÉRIES DE SOLS DU POLYGONE CARTOGRAPHIQUE :
${primaryStr}

SÉRIES DE SOLS DU VOISINAGE IMMÉDIAT (RAYON 50 MÈTRES) :
${nearbyStr}

MÉTHODOLOGIE SCIENTIFIQUE ET DIRECTIVES DE RÉDACTION :
1. TON ET VOCABULAIRE :
   - Adopte un ton strictement scientifique, sobre, neutre et professionnel.
   - INTERDICTION STRICTE : N'utilise AUCUN émoji ni émoticône dans l'ensemble de tes messages.
2. DÈS TON PREMIER MESSAGE :
   - Énonce clairement les séries candidates présentes sur ce site avec leurs textures et drainages caractéristiques.
   - Utilise immédiatement l'altitude (${context.topo ? context.topo.pointAlt + ' m' : 'du site'}) et la position dans la caténa (${context.topo ? context.topo.position : 'du secteur'}) pour expliquer comment le relief oriente le drainage naturel et oriente le diagnostic vers telle ou telle série.
   - Pose UNE SEULE question morphologique discriminante et facile à vérifier sur le terrain (ex: texture tactile au doigt de l'horizon de surface Ap, présence de marbrures d'oxydoréduction à 25-40 cm à la bêche, pierrosité).
3. CHOIX DE RÉPONSES STRICTEMENT ADAPTÉS (OBLIGATOIRE) :
   - À la toute dernière ligne de ton intervention, ajoute obligatoirement :
OPTIONS: [Choix 1 | Choix 2 | Choix 3]
   - Chaque choix DOIT répondre directement et fidèlement à la question posée, sous la forme d'observations de terrain concrètes, contrastées et mutuellement exclusives permettant de trancher entre les séries candidates.
   - Ne formule aucun choix vague ou hors de propos.
4. CONFIRMATION FINALE ET FICHE DESCRIPTIVE :
   - Dès que les réponses permettent de conclure, confirme la série identifiée (ex: Série Sainte-Rosalie).
   - Décris ses caractères de terrain : texture, classe de drainage naturel et potentiel agronomique.
   - Inclus OBLIGATOIREMENT le lien Markdown vers la fiche descriptive officielle :
     [Consulter la fiche descriptive officielle de la série X](URL)
     (reprends exactement l'URL de la fiche fournie dans les données ci-dessus pour la série identifiée).
5. CONCISION :
   - Réponses concises et denses (130 à 190 mots maximum).`;
      }

      async callOpenAi() {
        this.isWaitingResponse = true;
        this.showTypingIndicator();

        try {
          const endpoint = this.workerUrl || "https://api.openai.com/v1/chat/completions";
          const headers = { "Content-Type": "application/json" };
          if (!this.workerUrl && this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
          }

          const resp = await fetch(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: this.messages,
              temperature: 0.5,
              max_tokens: 700
            })
          });

          this.removeTypingIndicator();

          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            const msg = errData.error ? (typeof errData.error === 'string' ? errData.error : errData.error.message) : `Erreur (${resp.status})`;
            throw new Error(msg);
          }

          const data = await resp.json();
          const assistantText = data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : "Désolé, aucune réponse générée.";

          this.messages.push({ role: "assistant", content: assistantText });
          this.renderAssistantMessage(assistantText);
        } catch (err) {
          this.removeTypingIndicator();
          console.error("OpenAI call error:", err);
          this.renderErrorMessage(err.message);
        } finally {
          this.isWaitingResponse = false;
        }
      }

      sendMessage(userText) {
        this.messages.push({ role: "user", content: userText });
        this.renderUserMessage(userText);
        if (this.quickRepliesEl) this.quickRepliesEl.innerHTML = "";
        this.callOpenAi();
      }

      renderAssistantMessage(rawText) {
        if (!this.messagesEl) return;

        let displayText = rawText;
        let options = [];
        const optMatch = rawText.match(/OPTIONS:\s*\[(.*?)\]/is);
        if (optMatch) {
          displayText = rawText.replace(optMatch[0], "").trim();
          options = optMatch[1].split("|").map(s => s.trim()).filter(Boolean);
        }

        const htmlContent = (typeof marked !== "undefined" && marked.parse)
          ? marked.parse(displayText)
          : ("<p>" + displayText.split(String.fromCharCode(10, 10)).join("</p><p>") + "</p>");

        const msgDiv = document.createElement("div");
        msgDiv.className = "soil-ai-msg assistant";
        msgDiv.innerHTML = htmlContent;
        msgDiv.querySelectorAll("a").forEach(a => {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
        });
        this.messagesEl.appendChild(msgDiv);
        this.scrollToBottom();

        if (this.quickRepliesEl) {
          this.quickRepliesEl.innerHTML = "";
          if (options.length > 0) {
            options.forEach((opt, idx) => {
              const btn = document.createElement("button");
              btn.className = "soil-ai-chip";
              btn.type = "button";
              const letter = String.fromCharCode(65 + idx);
              btn.innerHTML = `<span class="soil-ai-chip-letter">${letter}</span><span>${opt}</span>`;
              btn.addEventListener("click", () => {
                this.sendMessage(opt);
              });
              this.quickRepliesEl.appendChild(btn);
            });
          }
        }
      }

      renderUserMessage(text) {
        if (!this.messagesEl) return;
        const msgDiv = document.createElement("div");
        msgDiv.className = "soil-ai-msg user";
        msgDiv.textContent = text;
        this.messagesEl.appendChild(msgDiv);
        this.scrollToBottom();
      }

      renderErrorMessage(errMsg) {
        if (!this.messagesEl) return;
        const div = document.createElement("div");
        div.className = "soil-ai-msg assistant";
        div.style.borderColor = "#fca5a5";
        div.style.background = "#fef2f2";
        div.innerHTML = `
          <div style="color:#b91c1c; font-weight:700; font-size:12px; margin-bottom:4px;">Erreur OpenAI</div>
          <div style="font-size:11.5px; color:#7f1d1d; margin-bottom:8px;">${errMsg}</div>
          <button type="button" class="profile-dock-btn" style="background:#fee2e2; border-color:#fca5a5; color:#991b1b; font-weight:600;" onclick="document.getElementById('btn-soil-ai-settings').click()">Vérifier ma clé API</button>
        `;
        this.messagesEl.appendChild(div);
        this.scrollToBottom();
      }

      showTypingIndicator() {
        if (!this.messagesEl) return;
        const div = document.createElement("div");
        div.id = "soil-ai-typing-indicator";
        div.className = "soil-ai-typing";
        div.innerHTML = `<span></span><span></span><span></span>`;
        this.messagesEl.appendChild(div);
        this.scrollToBottom();
      }

      removeTypingIndicator() {
        const el = document.getElementById("soil-ai-typing-indicator");
        if (el) el.remove();
      }

      scrollToBottom() {
        if (this.messagesEl) {
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
      }
    }


    class RagManager {
      constructor() {
        this.dock = document.getElementById("rag-dock");
        this.iframe = document.getElementById("rag-iframe");
        this.loadingEl = document.getElementById("rag-loading");
        this.btnQuick = document.getElementById("btn-quick-rag");
        this.btnMobile = document.getElementById("mobile-btn-rag");
        this.baseUrl = "https://agrireseau-rag.vercel.app";
        this.isLoaded = false;
        this.isOpen = false;
        this.isExpanded = false;

        this.init();
      }

      init() {
        if (this.btnQuick) {
          this.btnQuick.addEventListener("click", () => this.toggle());
        }
        if (this.btnMobile) {
          this.btnMobile.addEventListener("click", () => this.toggle());
        }
        const btnClose = document.getElementById("btn-close-rag");
        if (btnClose) {
          btnClose.addEventListener("click", () => this.close());
        }
        const btnExpand = document.getElementById("btn-expand-rag");
        if (btnExpand) {
          btnExpand.addEventListener("click", () => this.toggleExpand());
        }
        const btnPanelOpen = document.getElementById("btn-panel-open-rag");
        if (btnPanelOpen) {
          btnPanelOpen.addEventListener("click", () => this.open());
        }

        if (this.iframe) {
          this.iframe.addEventListener("load", () => {
            if (this.loadingEl) this.loadingEl.classList.add("hidden");
          });
        }

        // Close on Escape key
        window.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && this.isOpen) {
            this.close();
          }
        });
      }

      open(query = "") {
        if (!this.dock) return;
        this.isOpen = true;
        this.dock.style.display = "flex";
        this.dock.offsetHeight; // force reflow
        this.dock.classList.add("open");

        if (this.btnQuick) this.btnQuick.classList.add("active");
        if (this.btnMobile) this.btnMobile.classList.add("active");

        let targetUrl = this.baseUrl;
        if (query && query.trim()) {
          targetUrl += `?q=${encodeURIComponent(query.trim())}`;
        }

        if (!this.isLoaded || (query && this.iframe && this.iframe.src !== targetUrl)) {
          if (this.loadingEl) this.loadingEl.classList.remove("hidden");
          if (this.iframe) this.iframe.src = targetUrl;
          this.isLoaded = true;
        }
      }

      close() {
        if (!this.dock) return;
        this.isOpen = false;
        this.dock.classList.remove("open");
        if (this.btnQuick) this.btnQuick.classList.remove("active");
        if (this.btnMobile) this.btnMobile.classList.remove("active");
        setTimeout(() => {
          if (!this.isOpen) this.dock.style.display = "none";
        }, 280);
      }

      toggle(query = "") {
        if (this.isOpen) {
          this.close();
        } else {
          this.open(query);
        }
      }

      toggleExpand() {
        if (!this.dock) return;
        this.isExpanded = !this.isExpanded;
        this.dock.classList.toggle("expanded", this.isExpanded);
      }
    }

    const ragManager = new RagManager();
    window.ragManager = ragManager;

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
