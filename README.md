# Basic QR

Application web installable (PWA) qui affiche le QR d'accès à la salle, calculé **localement** sur
l'appareil.

## Fonctionnement

- Le code est calculé dans le navigateur : `SHA-256(numéro de carte + constante + horodatage +
  identifiant d'appareil)`, dont les 8 derniers caractères sont conservés en majuscules, puis encodé
  sous la forme `GM2:<carte>:<constante>:<horodatage>:<hash>`.
- Le code se renouvelle automatiquement toutes les 5 secondes (réglable), avec un affichage plein
  écran et un mode « écran allumé » pour le passage au portique.
- **Aucun serveur, aucun compte, aucun traqueur.** Les valeurs restent dans le stockage local du
  navigateur et ne quittent jamais l'appareil.
- Fonctionne **hors ligne** une fois installée (service worker).

## Réglage

Trois valeurs sont nécessaires :

| Valeur | Où la trouver |
|---|---|
| Numéro de carte | sur la carte, ou dans un QR généré par l'application (`1ᵉʳ` champ) |
| Constante du QR | `3ᵉ` champ d'un QR généré par l'application |
| Identifiant d'appareil | dans les données locales de l'application |

Saisie directe dans l'interface, ou pré-remplissage par l'URL — **en fragment de préférence**, car un
fragment n'est jamais transmis au serveur :

```
https://<hote>/#card=V012345678&device=…&constant=…
```

Le fragment est retiré de la barre d'adresse dès la lecture.

## Installation

Ouvrir la page dans le navigateur du téléphone, vérifier que le code s'affiche, puis
**⋮ → Ajouter à l'écran d'accueil**.

## Tests

```bash
npm test
```

Aucune dépendance : les tests tournent sur le lanceur de tests de Node.

> Usage personnel. Ces trois valeurs valent un droit d'accès : ne pas les partager.
