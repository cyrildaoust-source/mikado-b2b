# Outil pro (mode autonome)

L'outil pro reprend Mikado Devis hors de l'admin Shopify, pour les architectes avec qui
Mikado Deco travaille. Il garde le même moteur de devis, le même PDF et la même création
de commande provisoire. Il ajoute un catalogue visuel, des comptes personnels et un
réglage par marque.

## Ce que voit chacun

| | Mikado Deco (rôle admin) | Architecte |
|---|---|---|
| Catalogue | oui | oui, selon le réglage des marques |
| Devis | tous | les siens uniquement |
| Recherche des clients Shopify | oui | non : elle saisit les coordonnées de son client |
| Marques et accès | oui | non |
| Prix d'achat, marges | jamais affichés | jamais affichés |

## L'accueil : le tableau de bord

À la connexion et à l'activation d'une invitation, `/app` ouvre le tableau de bord du
compte (tous les devis pour Mikado Deco, les siens pour une architecte), avec « Créer un
devis » en premier et « Parcourir le catalogue » à côté. Un lien direct vers un devis
ramène à ce devis après la connexion. La liste complète des devis est sous `/app/devis`.
Dans l'admin Shopify, `/app` reste la liste des devis.

- « Bonjour » avec le prénom du compte, en grand, et une phrase sur ce qui attend.
- Pour une architecte : sa remise Mikado Deco (classe actuelle), la remise suivante et ce
  qu'il reste de chiffre à faire pour l'obtenir (voir « Classes et remises »).
- Quatre chiffres, chacun ouvre la liste filtrée : devis ouverts (brouillons et PDF
  prêts), en attente du client (avec le total HTVA), acceptés, à relancer. « À relancer »
  et le filtre du même nom suivent une seule règle (`needsFollowUp`,
  `app/domain/dashboard.ts`) : révision en cours envoyée depuis 10 jours entiers ou plus.
- À faire : validité dépassée ou proche (7 jours), devis envoyé sans réponse depuis
  10 jours, PDF prêt à envoyer, commande à vérifier.
- En attente du client : date d'envoi, validité, délai le plus long des produits retenus.
  Un devis envoyé puis modifié repasse « en préparation », comme dans la liste, avec la
  mention qu'une révision est déjà chez le client.
- Devis acceptés : commande provisoire ou confirmée, état de livraison Shopify (en
  commande, livrée en partie, livrée), délai annoncé et arrivée estimée chez Mikado Deco.

Le délai vient du métachamp produit `custom.lead_time` posé par l'importateur
(« 7-10 jours ouvrés », « 4-5 semaines », « sur demande ») : délai de la marque jusqu'à la
boutique. Le tableau de bord prend le plus long des produits retenus et compte en jours
ouvrés depuis la date de la commande confirmée (une semaine = cinq jours ouvrés). Un
produit sans délai est signalé, l'estimation est alors partielle. Lecture seule : rien
n'est écrit en base ni dans Shopify. Sans Shopify, la page s'affiche sans les délais.

## Classes et remises

Dans « Accès », Mikado Deco crée des classes (nom, remise en %, palier en € HTVA) et
peut choisir une classe pour chaque architecte. La classe d'une architecte est la plus
haute entre la classe choisie (un minimum) et celle que son chiffre ouvre : devis acceptés
(commande créée), HTVA, sur les 12 derniers mois glissants. Une classe à palier 0 est
ouverte dès l'inscription. La remise est affichée, pas appliquée aux prix du devis.

### Prix pro

Le prix pro est le prix public HTVA moins la remise de la classe (palier). C'est la seule
réduction du portail pro : ni promotion ni autre remise (Cyril, 26/11/2026). Un
pourcentage donne le même résultat HTVA ou TVAC. La livraison (5 % ou 3 %) et les
prestations ne prennent pas la remise.

Le sélecteur « Prix affichés » de la barre du haut (dans le menu sur téléphone) choisit le
prix des cartes du catalogue, de la fiche et du choix de finition : « Prix HTVA » (public),
« Prix pro HTVA » (architecte seul) ou « Prix TVAC » (public, TVA de 21 %). C'est un
réglage de l'appareil (cookie `prix_affiche`, l'ancien `prix_pro=1` vaut « Prix pro »). Il
ne change ni le devis, ni son PDF, ni la commande. Dans l'éditeur de devis, l'architecte
voit toujours son prix pro sous chaque ligne et dans le récapitulatif (« Marchandise au
prix pro »), jamais repris dans le PDF ni sur la page du client. Sans classe attribuée,
la page indique « Prix pro à confirmer ». Le devis montre toujours les remises que
l'architecte accorde à son client : la version « sans remises » a été retirée (Cyril,
26/11/2026). Code : `app/domain/pro.ts`, `app/services/pro-price.server.ts`,
`app/components/ProPrice.tsx`.

L'architecte ne change pas les prix du catalogue : la ligne montre le prix public, et le
serveur le rétablit à chaque enregistrement (`lockPrices`). La colonne « Remise client % »
reste à lui : c'est la remise qu'il fait à son client, s'il le veut, distincte de la
remise de palier de Mikado Deco. Ses lignes personnalisées gardent un prix libre.

Grille de départ (décision de Cyril du 26/11/2026), posée par la migration
`20261126180000_architect_classes_seed` si aucune classe n'existe encore : Esquisse 10 %
dès l'inscription, Plan 12 % dès 15 000 €, Projet 14 % dès 35 000 €, Signature 16 % dès
75 000 € HTVA sur 12 mois. Pas de plafond par marque.

Leviers de fidélité (`loyaltyStatus`, `app/domain/dashboard.ts`) :

- Garantie de 12 mois : une classe atteinte reste acquise 12 mois après le devis accepté
  qui l'a ouverte ou confirmée, même si le chiffre glissant baisse. L'accueil donne la date
  de fin et, à 60 jours de cette date, le montant à accepter pour la garder.
- Bienvenue : le premier devis accepté dans les 60 jours qui suivent l'ouverture du compte
  compte double dans le chiffre.
- « Accès » montre la date de fin de garantie à côté de la remise actuelle.

## Le catalogue

Les fiches sont lues dans Shopify côté serveur. Rien n'est publié ni modifié.

- Toutes les fiches encodées sont visibles, **actives ou en brouillon**, gold ou non
  (décision de Cyril du 25/11/2026).
- Page « Marques » : masquer une marque entière.
- Une carte par produit, avec sa photo principale (le packshot), le nombre de finitions et
  le prix « dès ». Quand un produit a plusieurs finitions, + ou un glisser ouvre le choix
  par option (taille, couleur…), comme sur la fiche ; une finition déjà proposée pour ce
  produit du devis est barrée. La fiche montre la photo de la variante puis les photos
  d'ambiance du produit. Rien ne change dans Shopify.
- Une fiche archivée n'apparaît jamais. Une fiche masquée renvoie une page introuvable,
  même si on devine son adresse.
- Modèles 3D : la fiche montre les fichiers du produit (métachamp `custom.models_3d`,
  JSON `{"files": [{"format": "DWG", "url": "https://…"}], "page": "https://…"}`, posé par
  l'importateur). Sans fichier, elle renvoie vers la bibliothèque 3D de la marque
  (`app/domain/models3d.ts`) ; pour une marque réservée aux revendeurs, elle invite à
  demander le fichier à Mikado Deco. Une marque sans source vérifiée n'affiche rien.
- Les prix affichés sont les prix publics HTVA (prix Shopify TVAC divisé par 1,21).

## Le mood board

Depuis un devis, « Mood board » ouvre une planche par pièce, plus une planche « Tout le
projet » quand le devis a plusieurs pièces. À la première ouverture, chaque planche est
disposée toute seule : le nom de la pièce, puis les photos des produits retenus et des
options.

- À gauche : les photos des produits de la pièce (produit, alternative, option), les photos
  d'ambiance de leurs fiches Shopify et les photos ajoutées par l'architecte (JPEG, PNG
  ou WebP, réduites à 2000 px dans le navigateur, 60 par devis au plus).
- Un toucher ou un glisser pose la photo sur la planche. Glisser déplace, le coin agrandit
  (une photo garde ses proportions). Textes (titre, texte, légende), pastilles de couleur
  avec leur nom, quatre fonds. Annuler et Rétablir, flèches du clavier, Suppr.
- Enregistrement automatique, à part du devis : le mood board ne crée ni version ni PDF de
  devis.
- Exporter : PowerPoint 16:9 (une diapositive par pièce, s'ouvre dans Canva et Keynote),
  PDF (une page par pièce, ou la planche ouverte) et image PNG 3840 × 2160 de la planche
  ouverte, pour Photoshop. Les exports tournent sur le serveur ; seules les photos de
  `cdn.shopify.com` et les photos ajoutées y entrent.

### Matières

L'onglet « Matières » de la colonne de gauche propose :

- les finitions des produits du devis, quand la fiche Shopify a des pastilles d'option
  (photo de tissu, de bois, ou couleur) ;
- « Ajouter mon échantillon » : la photo d'un tissu (Dedar, Kvadrat…), d'un marbre ou d'un
  bois, posée en carré avec son nom, son éditeur et sa référence (« Kvadrat · 130 ») ;
- la bibliothèque Mikado Deco : les tissus en magasin (Kvadrat d'abord), par éditeur, avec
  une recherche par collection ou coloris. La légende reprend la collection, l'éditeur et
  le coloris ;
- des textures génériques libres de droits (Poly Haven, CC0) : bois, pierre et carrelage,
  tissus et cuirs, enduits et bétons, métal. Liste dans `app/domain/materials.ts`.

Les images d'un éditeur n'entrent dans la bibliothèque qu'avec l'accord de Cyril, partenaire
de la marque (Kvadrat, 26/11/2026).

### Bibliothèque de matières (page « Matières », Mikado Deco seul)

Cyril y dépose les photos d'échantillon fournies par l'éditeur : un dossier ou des photos,
nommées « Collection - coloris.jpg » (« Hallingdal 65 - 130.jpg »). La liste se vérifie et se
corrige avant l'envoi. Chaque photo est ramenée à 1 200 px dans le navigateur et rangée en
base (`LibraryMaterial`). Une photo déjà présente pour le même éditeur, la même collection et
le même coloris est remplacée. Une matière retirée disparaît des planches à leur prochaine
ouverture. Sur la planche, une matière de la bibliothèque s'écrit `library:<id>`.

« Importer depuis Kvadrat » : Cyril colle l'adresse d'une fiche kvadrat.dk ou son numéro de
produit. Le serveur relaie, sans le garder, le pack d'images basse résolution que la fiche
publique propose (`kvadrat-downloadcenter.azurewebsites.net/api/downloadcenter/downloadimages/<n°>`),
une requête par clic. Le navigateur ouvre l'archive (`app/domain/zip.ts`) et remplit la liste
à vérifier : collection tirée de l'adresse, coloris lu dans le nom du fichier
(`kvadratColour`). Cyril retire les photos d'ambiance et complète les coloris manquants avant
l'envoi. Un zip téléchargé à la main se dépose de la même façon. Accord de Cyril, partenaire
Kvadrat, le 26/11/2026.

## Les accès

Pas d'envoi d'e-mail : Mikado Deco crée l'accès dans « Accès » et transmet lui-même le
lien d'invitation (usage unique, 7 jours). L'architecte y choisit son mot de passe.
« Retirer l'accès » coupe la connexion et conserve ses devis.

Premier accès admin, sur le serveur :

```sh
npm run user:invite -- --email cyril@exemple.be --name "Cyril" --role admin
```

### Mon cabinet

Chaque architecte remplit sa fiche cabinet dans « Mon cabinet » : nom, adresse,
numéro de TVA, téléphone, e-mail, site et logo (PNG, JPEG ou WebP, 1 Mo au plus ;
le type est lu dans le fichier, pas dans son nom). Le nom, l'adresse et la TVA
sont requis pour partager une proposition en ligne au nom du cabinet. Mikado
Deco ouvre la fiche d'un architecte par « Fiche cabinet » dans « Accès ».

### Proposition en ligne

Une fois le PDF prêt, « Créer le lien » (bloc « Proposition en ligne », sous
l'en-tête du devis) donne une adresse privée `/d/…` à
envoyer au client. Le lien montre la révision figée : mêmes prix, alternatives
et options, au nom du cabinet de l'architecte (ou de Mikado Deco pour ses propres
devis). Il vaut jusqu'à la fin du jour de validité, et un mois au plus après
l'émission. Un seul lien est actif par devis : « Remplacer le lien » retire
l'ancien, « Retirer le lien » le ferme. La base ne garde que l'empreinte SHA-256
du jeton, d'où un lien affiché une seule fois. Le serveur n'envoie à la page qu'une liste blanche de champs
(`app/domain/client-quote.ts`) : ni identifiants Shopify, ni prix source du
catalogue, ni référence interne, adresses, e-mail ou TVA du client. La page n'est pas indexée et ne
transmet pas son adresse aux sites tiers. Elle est faite pour le téléphone : le
client compare les alternatives, coche les options et voit le total suivre
(livraison recalculée sur la marchandise retenue), puis télécharge le PDF. Sur un
écran large, la page passe sur deux colonnes, le total restant visible à droite. Le devis d'un architecte ne peut être
figé que si « Mon cabinet » porte le nom, l'adresse et la TVA ; il n'affiche alors
ni les coordonnées ni les conditions générales de Mikado Deco.

### Acceptation, contresignature et facturation

Le client accepte en ligne : prénom, nom, case d'engagement, puis « Accepter le
devis avec obligation de paiement ». Le serveur recalcule les totaux à partir de
ses choix, enregistre l'heure, l'adresse IP et le navigateur, et passe le devis à
« Accepté par le client ». La première acceptation l'emporte ; la page devient
ensuite une simple lecture. L'architecte (ou Mikado Deco sur ses propres devis)
contresigne dans les 48 heures depuis le devis : nom, case de confirmation,
« Contresigner ». Les montants à facturer à l'architecte sont alors figés (prix
public, remise de classe, prix pro, livraison). « Rouvrir pour réviser » remet le
devis en brouillon et ferme le lien. Sans contresignature après 48 heures, rien
n'est facturé : un rappel part une seule fois à l'architecte et une alerte à
Mikado Deco. La contresignature reste possible après 48 heures : le délai
déclenche un rappel, pas un blocage (Cyril, 27/11/2026). Chaque rappel
(architecte, Mikado Deco) est marqué envoyé seulement quand Resend l'a accepté ;
un envoi en échec repart au passage suivant sans renvoyer l'autre (table
`DecisionReminder`, clé d'idempotence Resend). La page « À facturer » (Mikado Deco seul) liste les devis
contresignés, ceux en attente et ceux facturés depuis 30 jours ; le montant
facturé à l'architecte suit la règle d'arrondi de l'écran : prix pro arrondi
ligne par ligne puis additionné, livraison (3 % ou 5 %) sur cette marchandise
remisée, prestations exclues, TVA par taux ; « Facturé »
enregistre l'échéance. La commande Shopify et le brouillon Odoo viendront après
un essai validé par Cyril.

## Configuration

Variables en plus de celles de Mikado Devis (voir `.env.production.example`) :

- `APP_MODE=standalone`
- `RESEND_API_KEY` : envoi des courriels (sans elle, ils sont seulement journalisés)
- `MAIL_FROM` : expéditeur, par défaut `Mikado Deco Pro <noreply@mikadodeco.be>`
- `MIKADO_ALERT_EMAIL` : destinataire des alertes, par défaut `shop@mikadodeco.be`
- `CRON_SECRET` : jeton du rappel quotidien `/internal/decisions` (Vercel Cron)
- `MAIL_SIMULATE=true` : aucun e-mail ne part, chaque envoi est journalisé (essais, préversions)
- `SHOPIFY_SHOP` : domaine `*.myshopify.com` de la boutique
- `SESSION_SECRET` : au moins 32 caractères aléatoires
- `SHOPIFY_API_KEY` et `SHOPIFY_API_SECRET` : ceux de l'app du Dev Dashboard. Le jeton
  Admin s'obtient par le « client credentials grant », qui exige que l'app et la boutique
  soient dans la même organisation du Dev Dashboard.
- `SHOPIFY_APP_URL` : l'adresse publique de l'outil (sert aux liens d'invitation).

Sans `APP_MODE`, l'application reste l'app intégrée à l'admin Shopify, comme avant.

## Essai local

`npm run dev:local` ouvre la démonstration avec un catalogue fictif, sans Shopify ni
connexion. Il faut un Postgres local (`DATABASE_URL` dans `.env`, voir `.env.example`).

## Mise en ligne sur Vercel

La base est Postgres (Neon, ajouté depuis l'onglet « Storage » du projet Vercel). Sur Vercel :

1. Importer le dépôt `mikado-b2b` dans l'équipe Vercel (offre Pro).
2. Storage → créer une base Neon, région Francfort, reliée au projet. L'intégration fournit
   `DATABASE_URL` et `DATABASE_URL_UNPOOLED`, avec une branche de base par Preview.
   Prisma Postgres (région Francfort) convient aussi : `scripts/vercel-build.sh` prend la
   première connexion fournie (`DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`,
   `POSTGRES_URL` ou `DATABASE_URL`).
3. Variables d'environnement : `APP_MODE`, `SHOPIFY_SHOP`, `SHOPIFY_API_KEY`,
   `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SESSION_SECRET`, `SCOPES`, et les
   coordonnées vendeur (`SELLER_*`) pour le PDF.
4. Le build (`npm run vercel-build`, soit `scripts/vercel-build.sh`) applique les migrations puis construit l'app. Les
   fonctions tournent à Francfort (`vercel.json`).
5. Domaine : `pro.mikadodeco.be`, avec un enregistrement CNAME chez GoDaddy vers
   l'adresse indiquée par Vercel.
6. Premier accès, sans terminal : définir `BOOTSTRAP_ADMIN_EMAIL` (l'e-mail de Cyril) et
   `BOOTSTRAP_TOKEN` (32 caractères aléatoires ou plus), puis ouvrir
   `https://pro.mikadodeco.be/premier-acces?jeton=<BOOTSTRAP_TOKEN>`. La page mène au choix
   du mot de passe. Mot de passe oublié : rouvrir la même adresse donne un nouveau lien
   pour cet accès admin. Retirer `BOOTSTRAP_TOKEN` ferme la page.

Le PDF utilise `@sparticuz/chromium` sur Vercel (fonction de 60 s et 2 Go) et le Chromium
de Playwright ailleurs.

**Facturation Odoo : non disponible sur Vercel pour l'instant.** Le pont Odoo est un
script Python et le worker tourne en continu ; ni l'un ni l'autre n'existe dans une
fonction Vercel. L'automatisation était déjà désactivée. La porter en TypeScript, avec une
tâche planifiée Vercel, sera un chantier à part.

## Tests

```sh
npm test                      # unitaires
TEST_DATABASE_URL=postgresql://… npm run test:integration   # Postgres, schéma jetable
```
