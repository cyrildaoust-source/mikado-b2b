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

## Les accès

Pas d'envoi d'e-mail : Mikado Deco crée l'accès dans « Accès » et transmet lui-même le
lien d'invitation (usage unique, 7 jours). L'architecte y choisit son mot de passe.
« Retirer l'accès » coupe la connexion et conserve ses devis.

Premier accès admin, sur le serveur :

```sh
npm run user:invite -- --email cyril@exemple.be --name "Cyril" --role admin
```

## Configuration

Variables en plus de celles de Mikado Devis (voir `.env.production.example`) :

- `APP_MODE=standalone`
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
