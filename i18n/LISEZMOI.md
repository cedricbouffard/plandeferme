# Traductions de Plan de Ferme

Le français est la langue source : il reste écrit dans `index.html` et dans les modules `js/`.
Chaque autre langue est un fichier de ce dossier, chargé par `js/i18n.js`.

Les fichiers sont des scripts très simples : une première ligne `window.pfI18n.langue("en", {`, une ligne par phrase,
puis `});` à la fin. Ils se chargent sans `fetch`, donc aussi quand `index.html` est ouvert directement depuis le disque.

| Fichier | Rôle |
|---|---|
| `langues.js` | Langues offertes dans le menu, et fuseaux horaires qui choisissent la langue par défaut |
| `en.js` | Anglais |
| `es.js` | Espagnol |
| `_modele.js` | Toutes les phrases françaises, traductions vides : point de départ d'une nouvelle langue |

## Corriger une phrase

Ouvrez `en.js` ou `es.js`, cherchez la phrase française (à gauche) et modifiez la traduction (à droite) :

```js
"Partager la vue": "Share view",
```

Enregistrez, puis rechargez la page. La phrase de gauche doit rester identique au texte français du site.

## Phrases avec valeurs variables

`{0}`, `{1}`… marquent un nombre ou un nom inséré par le site. Gardez-les dans la traduction ; leur ordre peut changer.

```js
"Impossible : {0} zones d'au moins {1} ha demandent {2} ha, la parcelle en fait {3}.": "Not possible: {0} zones of at least {1} ha need {2} ha, and the field is {3}."
```

## Ajouter une langue (exemple : allemand)

1. Copiez `_modele.js` en `de.js`, remplacez `"xx"` par `"de"` à la première ligne et remplissez les traductions. Une traduction laissée vide reste en français à l'écran.
2. Ajoutez une ligne dans `langues.js` :
   ```js
   { "code": "de", "nom": "Deutsch", "fichier": "de.js", "fuseaux": ["Europe/Berlin", "Europe/Vienna"] }
   ```
3. Ajoutez `"/i18n/de.js"` à la liste `ASSETS` de `sw.js` pour l'usage hors ligne.

## Langue choisie au démarrage

Dans l'ordre : paramètre d'adresse `?lang=en`, choix fait dans le menu (mémorisé sur l'appareil), emplacement
(fuseau horaire de l'appareil comparé aux listes `fuseaux`), langue du navigateur, puis français.

Un fuseau qui n'est dans aucune liste (par exemple `America/Toronto`, partagé par le Québec et l'Ontario)
laisse la langue du navigateur décider.

## Trouver les textes non traduits

Après avoir ajouté un texte français au site, il reste en français dans les autres langues tant qu'il n'est pas
dans les fichiers. Pour les repérer : passez le site dans la langue voulue, utilisez les écrans concernés, puis
tapez dans la console du navigateur :

```js
pfI18n.missing()
```

La liste donne les phrases françaises vues à l'écran sans traduction. Copiez-les comme clés dans le fichier de langue.

## Ce qui n'est pas traduit

- Les données elles-mêmes : descriptions des séries de sols, noms de cultures et de lieux, titres des études pédologiques.
- Les réponses de l'assistant de diagnostic des sols et de la base Agri-Réseau.
- Les noms de vos couches et dossiers dans Mes données.
