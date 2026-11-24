# Mikado Devis sur le Mac

Le lanceur `Lancer Mikado Devis.command` démarre l'application réelle depuis ce dossier. Il prépare la base et le build, ouvre un tunnel HTTPS Cloudflare temporaire, valide et publie la nouvelle adresse de l'application Shopify existante. Il n'installe pas de service au démarrage du Mac. La première installation dans la boutique doit encore être effectuée dans Shopify.

## Utilisation après installation

1. Double-cliquer sur `Lancer Mikado Devis.command`.
2. Attendre « Mikado Devis fonctionne sur votre Mac ».
3. Ouvrir Shopify → Applications → Mikado Devis.
4. Laisser le Terminal ouvert et le Mac éveillé. Ctrl+C arrête le serveur et le tunnel.

L'adresse du tunnel change à chaque lancement. Le lanceur la republie dans Shopify : une connexion Shopify CLI valide est donc nécessaire. Ce fonctionnement convient à un essai manuel ; les tunnels temporaires n'offrent aucune garantie de disponibilité. Aucune commande `shopify app dev` n'est utilisée sur la boutique réelle.

## Données et facturation

- Les devis et sessions persistent dans la base SQLite existante sur ce Mac. Ils sont séparés par boutique ; les simulations `demo.local` ne deviennent pas des devis réels.
- Le serveur écoute seulement sur `127.0.0.1:3002`. Le tunnel est son entrée HTTPS publique. Les routes métier conservent l'authentification Shopify.
- Les paramètres privés sont dans `.env` et `.env.shopify.local`, exclus de Git. Ne pas partager ces fichiers ni la base de données.
- Cloudflare relaie le trafic entre Shopify et le Mac. Cyril a autorisé explicitement cette connexion Cloudflare.
- Le lanceur force `ODOO_AUTOMATION_ENABLED=false` pendant l'installation. Il ne démarre aucun worker de facturation.
- Il faut sauvegarder régulièrement la base locale avant l'usage commercial.

## En cas d'arrêt brutal

Le lanceur refuse deux lancements simultanés. Si le Mac s'arrête brutalement, un dossier `.shopify/manual-launch.lock` peut subsister. Vérifier qu'aucun lanceur ni serveur n'est encore actif avant de supprimer uniquement ce dossier de verrouillage.

## État au 19 septembre 2026

Cloudflared installé, tunnel autorisé et actif, configuration publiée et application installée dans la boutique Mikado Deco. Ouverture intégrée, création d'un brouillon vide (MD-2026-0003), catalogue réel et liste des clients vérifiés dans Shopify. Correction de la redirection d'entrée pour conserver les paramètres Shopify. Aucune commande ni facture réelle créée. Le parcours complet PDF / commande / Odoo reste à valider sur un premier dossier choisi par Cyril. Accès : https://admin.shopify.com/store/mikadodeco/apps/mikado-devis

## Statuts des devis

- Brouillon : projet créé, sans PDF prêt.
- Prêt à envoyer : PDF préparé pour la version courante, sans envoi déclaré.
- Envoyé : envoi déclaré via le bouton « Marquer comme envoyé ». Le téléchargement ne déclare jamais un envoi.
- Modifications en cours : nouvelle sauvegarde après une version PDF précédente ; l'envoi de l'ancienne révision reste dans l'historique.
- Commande créée : conversion Shopify réussie.
- Archivé : classement volontaire, restauration possible.
- Supprimé · corbeille : retrait réversible, PDF et historique conservés. Les devis liés à une commande ou une facturation ne peuvent pas être mis à la corbeille ; utiliser les archives.

La liste permet de filtrer les statuts, les archives et la corbeille. L'application ne déduit pas un envoi depuis un téléchargement et ne supprime ni n'archive automatiquement un dossier. Dans Shopify, l'enregistrement utilise uniquement la barre native ; la barre locale reste disponible en démonstration.
