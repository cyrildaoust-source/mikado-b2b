# Mikado Devis — version B2B locale

Application privée de devis pour Mikado Deco, intégrable à Shopify : React Router, SDK Shopify officiel, Prisma/SQLite et PDF Chromium. Le projet actif est conservé hors iCloud dans `/Users/cyrildaoust/Developer/mikado-devis`. L’archive livrée contient le code, sans données clients, secrets ni dépendances installées.

## Fonctionnement

- Projets avec lots, descriptions, produits, variantes et alternatives exclusives ; options du catalogue ou prestations libres.
- Quantités liées entre alternatives, avec désactivation explicite ; remises et frais fixes ou proportionnels aux produits retenus après remise.
- Prix et négociation HTVA ; ventilation TVA, total TVAC, acompte et solde TVAC. Conditions prédéfinies comptant, 30 %, 50 %, paiement intégral ou personnalisées.
- Catalogue et clients Shopify ; données fictives en mode local. Selon la configuration Mikado confirmée, la TVA est de 21 % et les prix catalogue TVAC sont convertis automatiquement en HTVA. Aucun champ de TVA par produit. Les descriptions sont reprises de Shopify, sans ajout ; une fiche vide reste vide.
- Sauvegarde avec contrôle de concurrence, récupération de saisie dans l’onglet pendant huit heures, duplication et archivage.
- « Figer le devis » crée une révision commerciale R1, R2, etc. Les sauvegardes intermédiaires ne changent pas ce numéro. Historique, restauration en nouvelle version et marquage manuel « envoyé ».
- PDF A4 par révision figée. Les PDF déjà générés sont conservés à l’identique ; les anciennes données restent consultables et se dupliquent explicitement en B2B.
- Comparaison avec le calcul Shopify avant publication et avant conversion : devise, lignes, quantités, net, taxes par taux et total. Tout écart bloque l’opération ; aucun ajustement silencieux.
- Création d’une commande provisoire avec les seules lignes retenues. Verrou, référence de récupération et recherche avant création limitent les doublons ; une réponse incertaine reste verrouillée.

L’application n’envoie pas d’e-mail et ne déclenche ni signature ni paiement. Le marquage « envoyé » est une indication manuelle.

## Essayer localement

Utiliser Node 22 LTS :

```sh
npm ci
cp .env.example .env
npm run setup
npx playwright install chromium
npm run dev:local
```

Ouvrir `http://127.0.0.1:3000/app`. La démonstration utilise SQLite local et un catalogue fictif ; elle ne crée pas de commande Shopify. Le mode démo est refusé en production et sur un domaine distant. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` permet d’utiliser un Chromium installé ; ne pas reporter un chemin macOS sur Linux.

Parcours : créer le projet, choisir le client et l’adresse, ajouter produits et alternatives, vérifier les prix HTVA, choisir les options et modalités, sauvegarder, vérifier les montants, figer puis télécharger le PDF. Une modification ultérieure exige une nouvelle révision pour l’export courant.

## Vérifications

```sh
npm test
npm run test:integration
npm run typecheck
npm run build
```

Les tests d’intégration migrent une base temporaire indépendante et n’appellent pas Shopify. Vérification du 18 septembre 2026 : 13 tests unitaires et 7 tests d’intégration ; parcours navigateur ordinateur/mobile, récupération de saisie, sauvegarde depuis l’aperçu et publication ; PDF court et devis de 30 lignes sur cinq pages contrôlés visuellement ; sauvegarde chiffrée/restauration et refus d’une archive altérée vérifiés. Exemple : 5 150 € HTVA + 1 081,50 € TVA = 6 231,50 € TVAC, acompte de 30 % = 1 869,45 €.

Les opérations GraphQL ajoutées ont été vérifiées contre le schéma Shopify. Ces contrôles et les simulations ne remplacent pas un essai sur la boutique réelle. L’image Docker n’a pas été construite ici, faute de moteur Docker disponible.

## Mise en service

Voir [le guide d’exploitation](docs/exploitation.md) et [le plan B2B](docs/plan-b2b-v0.2.md).

Restent nécessaires : hébergement avec HTTPS et volume persistant, secrets Shopify et installation privée, coordonnées complètes du vendeur, confirmation des règles fiscales du catalogue et essais réels. L’application Shopify est enregistrée ; les URL du TOML doivent être remplacées par le domaine définitif. Publier la configuration Shopify ne déploie pas le serveur web.

## Limites

EUR uniquement ; une instance SQLite ; liste des 100 devis récents. Les taux saisis servent au devis et doivent correspondre à la situation client et au calcul Shopify : les exemptions, taux mixtes et règles d’arrondi doivent être testés sur la boutique. Les cas divergents sont bloqués.

Les images sont chargées uniquement depuis `cdn.shopify.com` ; avant le premier export, une image supprimée du catalogue peut manquer. Une fois généré, le PDF est conservé en base. Le pied de page vendeur est dans `app/components/QuoteDocument.tsx` et doit être complété avant utilisation commerciale.

Les sauvegardes chiffrées sont outillées mais aucune planification ni copie hors site n’est activée. Les jetons Shopify et données clients nécessitent un stockage protégé, une durée de conservation et des sauvegardes gérées par l’exploitant. La désinstallation retire les sessions, pas les devis.
