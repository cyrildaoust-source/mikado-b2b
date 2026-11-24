# Devis B2B, Shopify Basic et Odoo

## État au 19 septembre 2026

Implémenté : acceptation explicite du devis, finalisation de la commande Shopify sans encaissement, file persistante par jalon, échéanciers acompte/solde et 30/50/20, création de brouillons Odoo, lecture périodique des états de facture/paiement, détection des annulations/avoirs et simulation locale.

Connexion réelle **en lecture seulement** vérifiée le 6 octobre 2026 sur Odoo 19 : société Mikado Deco (1), devise EUR, journal Sales / INV (8), compte 700000 (438), taxe de vente 21 % hors prix (5). Le pont Python a aussi lu les champs de suivi des factures avec succès. Les clés sont dans le `.env` local ignoré par Git, accès propriétaire uniquement. Aucune facture Odoo ni commande Shopify réelle n'a été créée pendant cette recette.

L'exécution automatique en production reste **désactivée**, sans hébergement souscrit. La configuration Shopify a été validée par CLI ; `read_orders` doit être accordé lors de l'installation/mise à jour de l'application.

## Architecture

- Application React Router + Prisma/SQLite, une instance d'écriture, volume persistant.
- Le connecteur Odoo intégré reprend le protocole XML-RPC de `odoo-tools` dans un pont Python limité à la lecture et à la création de factures clients en brouillon. Aucun `action_post`, envoi d'e-mail ou enregistrement de paiement n'est exposé.
- Un worker séparé appelle `/internal/billing` avec un secret serveur toutes les minutes. Les factures liées sont relues au plus toutes les cinq minutes. Pas de dépendance à Codex/Claude ni à un Mac allumé.
- Les demandes sont uniques par devis et jalon (`deposit`, `before_delivery`, `after_delivery`, `balance`). Leur référence Odoo est déterministe à partir du numéro de devis et du jalon, indépendamment du montant et de la base locale.
- Chaque jalon est ventilé sur les lignes commerciales retenues. Les centimes sont répartis entre ces lignes déjà taxées ; aucune ligne d'arrondi distincte n'est créée. Le cumul des jalons égale exactement le HTVA, la TVA et le TVAC du devis.
- Une coupure lors d'une création laisse un état incertain. Le worker recherche la facture par référence ; il ne la recrée jamais automatiquement en son absence. Une erreur avant création peut être relancée explicitement après correction.
- Un traitement interrompu pendant les contrôles/écritures attend 15 minutes avant récupération. La persistance locale et la facture Odoo doivent être sauvegardées ensemble dans la procédure d'exploitation ; une restauration de base ancienne exige une réconciliation avant réactivation.

## Coexistence avec l'ancien outil

Le fichier `Documents/Mikado Deco/Outils CRM Odoo/odoo-tools/odoo_tools/invoicing.py` ignore désormais **toutes** les commandes portant le tag `mikado-devis`, même accompagnées de tags `facture` ou `acompte`. Ses ventes ordinaires/POS conservent leur circuit existant. 69 tests passent dans ce connecteur.

Avant activation, vérifier qu'aucune autre copie non corrigée du programme n'est utilisée. La variable `ODOO_LEGACY_GUARD_CONFIRMED=true` atteste ce contrôle. Un autre serveur ou une ancienne copie non corrigée pourrait créer des doublons.

## Paramétrage

Utiliser `.env.production.example` comme modèle, avec les secrets réels dans `.env.production` uniquement sur le serveur. Configurer URL HTTPS publique, application Shopify, accès hors ligne et domaine de boutique exact. Ne pas copier `APP_DEMO_MODE=true` en production.

- `ODOO_AUTOMATION_ENABLED=false` par défaut.
- `ODOO_LEGACY_GUARD_CONFIRMED=false` par défaut.
- `ODOO_SHOP` lie l'unique société Odoo à la boutique autorisée ; aucun autre tenant ne peut utiliser ces clés.
- `BILLING_WORKER_TOKEN` : secret aléatoire d'au moins 32 caractères, identique dans les deux services.
- Python 3 est déjà installé dans l'image Docker. Le pont utilise uniquement la bibliothèque standard.

Après configuration et sauvegarde, lancement prévu : `docker compose --env-file .env.production up -d --build`. Le port de l'application est lié à localhost ; installer un reverse proxy HTTPS sur le serveur. Le worker reste sur le réseau interne Compose. Ne pas publier ce service sans HTTPS et authentification Shopify.

Le volume `mikado-data` conserve devis, PDF, demandes et sessions. Prévoir sauvegardes régulières SQLite cohérentes, restauration testée et surveillance des erreurs du worker. La construction Docker n'a pas été exécutée localement faute de démon Docker disponible ; le build applicatif a été validé.

## Parcours

1. Préparer et vérifier le PDF.
2. En réel, créer/vérifier la commande provisoire puis « Confirmer l'accord du client ». Shopify réserve le stock lors de la finalisation.
3. Le numéro de TVA du client doit être renseigné sur le devis et apparaît dans le bloc de facturation du PDF. Le client Odoo doit correspondre de façon unique par TVA ou e-mail ; une divergence bloque la création.
4. Pour 30/50/20, le premier brouillon porte sur 30 %. Après sa validation Odoo, le brouillon de 50 % devient disponible. Le brouillon final de 20 % exige une confirmation explicite de la livraison.
5. Le worker crée uniquement des brouillons. Chaque brouillon est relu après création et contrôlé sur le client, l'origine, la référence, les lignes, le compte 700000, la TVA 21 %, le HTVA, la TVA et le TVAC.
6. Le panneau distingue brouillon, à payer, règlement partiel, paiement en cours et facture soldée. Il affiche le résiduel Odoo et la dernière synchronisation. Un état « soldée » peut résulter de paiements ou d'avoirs ; il n'est pas présenté comme une preuve d'encaissement bancaire.

## Limites explicites de cette première version

- EUR, clients facturés en Belgique, TVA 21 % hors prix. Autres régimes bloqués.
- Les lignes de jalon reprennent les désignations commerciales du devis, avec un montant partiel par étape. Elles ne constituent pas une nouvelle ligne d'arrondi.
- Pas de comptabilisation, e-mail, prélèvement ou écriture du statut financier Shopify automatique.
- Avoirs/annulations/écarts de montant bloquent la suite pour rapprochement ; aucune compensation automatique.
- La conversion utilise `paymentPending:true`, validé dans l'API 2026-07 mais déprécié. Avant une montée de version Shopify, migrer vers des conditions de paiement après test sur Basic. Ne jamais retirer ce paramètre sans remplacement : l'appel par défaut peut marquer la commande payée.
- En cas de refus de finalisation Shopify, récupération par la commande provisoire connue ; pas de recréation automatique.
- L'ancien programme de facturation ordinaire reste lancé comme avant : cette première automatisation concerne le circuit des devis B2B.

## Recette avant activation

Simulation locale : vérifier les trois jalons 30/50/20, leur somme exacte HTVA/TVA/TVAC, la validation séquentielle et la confirmation de livraison avant le dernier jalon. La simulation n'appelle ni Shopify ni Odoo.

Ensuite sur environnement de test connecté : client Odoo vérifié, commande Shopify dédiée, contrôle des stocks, création d'un seul brouillon, contrôle fiscal/arrondis, rejeu de demande, déconnexion, lecture des paiements, avoir et annulation. Activer la production seulement après cette recette et choix de l'hébergement.
