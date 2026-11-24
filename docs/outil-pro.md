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

- Par défaut, une marque est visible avec ses fiches **actives**.
- Page « Marques » : masquer une marque, ou y inclure ses fiches **en brouillon**
  (marques en représentation indirecte, absentes du site public).
- Une fiche archivée n'apparaît jamais. Une fiche masquée renvoie une page introuvable,
  même si on devine son adresse.
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
connexion.
