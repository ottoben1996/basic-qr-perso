# Basic QR

Application web installable (PWA) qui affiche le QR d'accès à la salle, calculé **localement** sur
le téléphone. Aucun serveur, aucune requête réseau, aucune donnée envoyée.

## Ce qui change en v2

La v1 demandait trois valeurs techniques, dont un UUID à retrouver à la main. La v2 part du principe
que personne ne doit voir un identifiant technique.

- **Deux gestes à faire une fois** : coller le lien de connexion, puis importer une capture du QR
  de l'appli officielle. L'appli détecte seule ce qu'elle peut extraire, y compris dans un JSON,
  un texte libre ou une charge utile `GM2:…`.
- **Lecture du QR officiel par l'image** : capture d'écran importée, ou caméra. Le décodeur est
  embarqué (jsQR en secours de `BarcodeDetector`), donc ça marche aussi sur iPhone.
- **Interface réduite** : un écran d'accueil en deux étapes, un écran QR dédié, des réglages
  cachés derrière une feuille.
- **Thème automatique**, respect de `prefers-color-scheme`, contrastes AA.
- **CSP stricte** : `connect-src 'none'` — le navigateur interdit toute requête sortante.

## Fonctionnement

Le code est calculé dans le navigateur : `SHA-256(numéro de carte + constante + horodatage +
identifiant d'appareil)`, dont les 8 derniers caractères sont conservés en majuscules, puis encodé
sous la forme `GM2:<carte>:<constante>:<horodatage>:<hash>`.

Le code se renouvelle automatiquement (5 s par défaut, réglable), avec un mode plein écran et un
maintien de l'écran allumé (Wake Lock).

Les trois valeurs nécessaires :

| Valeur | Où la trouver |
|---|---|
| Numéro de carte | dans le lien de connexion, ou dans un QR de l'appli |
| Constante | 3ᵉ champ d'un QR de l'appli (`GM2:carte:constante:…`) |
| Identifiant d'appareil | dans le lien de connexion, ou dans les données locales de l'appli |

Si la constante n'a pas été lue, l'appli utilise `QII` par défaut et l'indique clairement à l'écran :
un QR potentiellement refusé vaut mieux qu'un écran bloqué, mais l'information reste visible.

Pré-remplissage possible par l'URL, en fragment de préférence (un fragment n'est jamais transmis au
serveur). Le fragment est retiré de la barre d'adresse dès la lecture :

```
https://<hote>/#card=V012345678&device=…&constant=…
```

## Installation

Ouvrir la page dans le navigateur du téléphone, puis **⋮ → Ajouter à l'écran d'accueil** (Android)
ou **Partager → Sur l'écran d'accueil** (iOS). L'appli fonctionne ensuite hors ligne.

## Développement

```bash
npm run serve   # serveur statique local, accessible depuis le téléphone
npm test        # tests de la logique pure (node:test, aucune dépendance)
```

Le service worker met en cache la coquille de l'appli : incrémenter `CACHE` dans `sw.js` à chaque
changement de fichier, sinon le téléphone continue de servir l'ancienne version.

## Structure

```
index.html            écrans, feuilles (dialogs), aucun style inline
styles.css            thèmes sombre/clair, mise en page mobile d'abord
app.js                état, rendu du QR, parcours d'entrée
src/core.js           logique pure : hash, validation, analyse des entrées
src/scan.js           décodage QR (BarcodeDetector + jsQR à la demande)
src/qrcode.js         encodeur QR (vendor)
src/jsQR.js           décodeur QR (vendor, chargé seulement si nécessaire)
src/fonts/            Archivo (woff2, sous licence OFL)
src/theme-boot.js     application du thème avant le premier rendu
sw.js                 cache hors ligne
test/                 tests node:test
```

> Usage personnel. Ces valeurs valent un droit d'accès : ne pas les partager.
