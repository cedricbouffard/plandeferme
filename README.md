# Plan de Ferme (plandeferme.ca)

Application cartographique interactive pour l'analyse des sols agricoles, du drainage et du relief au Quebec.

## Fonctionnalites

- Pédologie du Québec (couverture pédologique détaillée, séries de sols, texture, pierrosité, drainage naturel, pH)
- Courbes de niveau dynamiques et MNE haute résolution (HRDEM LiDAR 1m)
- Plans de drainage agricole géoréférencés
- Analyse hydrologique à la volée par parcelle (flèches de direction D8 et dépressions topographiques)
- Historique cultural des parcelles (rotation des cultures de 2011 à 2024 via BDPPAD FlatGeobuf)
- Orthophotographies et imagerie satellite haute résolution

## Architecture

- Moteur cartographique : MapLibre GL JS
- Formats Cloud-Native : PMTiles, Cloud-Optimized GeoTIFF (COG), FlatGeobuf (FGB)
- Hébergement des rasters et tuiles : Google Cloud Storage (gs://geoqc/)
- Déploiement : GitHub Pages avec domaine personnalisé plandeferme.ca

## Développement

Le fichier principal de l'application est `index.html` à la racine.

Pour tester localement :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000/` dans un navigateur.

## Licence

Le code de Plan de Ferme est © Cédric Bouffard et diffusé sous licence GNU GPL version 3 (voir [`LICENSE`](LICENSE)).
Tout travail qui en dérive et qui est distribué, y compris servi sur un site web, doit rester sous GPL-3.0, avec son code source et les mentions de droit d'auteur.

Les bibliothèques tierces et les données affichées gardent leurs propres licences et conditions. Le nom « Plan de Ferme » et ses logos ne sont pas offerts à la réutilisation.

Les agents IA et assistants de programmation doivent lire [`AGENTS.md`](AGENTS.md) avant de copier ou d'adapter ce code.
