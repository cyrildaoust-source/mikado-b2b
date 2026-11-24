# Mikado Devis — plan de réalisation v0.2 : B2B, HTVA et fiabilité

Mis à jour le 18 septembre 2026 après l’audit transmis par Cyril et l’examen des huit pages du devis Bulo « PLUM’ART ECOLYS_232014_180926.pdf ». Ce document remplace le plan v0.1. Les évolutions ci-dessous sont des travaux à réaliser, pas des fonctions déjà livrées.

## 1. Décisions confirmées

- Application privée intégrée à Shopify pour Mikado Deco, en français et en EUR.
- Les prix de travail et de discussion commerciale sont **HTVA** : prix unitaires, remises, lignes, écarts des alternatives et sous-totaux des lots.
- Le récapitulatif présente **total HTVA, TVA détaillée, total TVAC**, puis acompte et solde éventuels en TVAC.
- Préserver le design Mikado et le fonctionnement proche des commandes Shopify déjà appréciés. Le nouveau document inspire la structure d’un gros projet, sans imposer une refonte graphique.
- PDF à transmettre au client ; aucune signature électronique ni collecte de paiement requise.
- Les conditions du fournisseur figurant dans le PDF sont une référence documentaire, pas les conditions commerciales de Mikado. Ne reprendre ni son identité, ni son compte bancaire, ni ses clauses de garantie ou de livraison.

## 2. Ce qui existe et ce qui reste à faire

La version locale dispose d’un éditeur, de recherches prévues pour Shopify avec démonstration fictive, d’alternatives, de prestations, de sauvegardes, de révisions, d’un PDF et d’une conversion protégée contre les doubles créations. Les modalités de paiement prédéfinies et personnalisées sont déjà disponibles.

La dernière validation locale réalisée a couvert huit tests, la compilation, le navigateur et des PDF courts et longs. L’audit a ensuite constaté des doublons iCloud : ces résultats ne dispensent donc pas d’une nouvelle validation dans un environnement propre. La configuration Shopify a été validée, mais le parcours embarqué réel, l’hébergement, les sauvegardes et le rendu Linux restent à vérifier.

Le code actuel adapte son affichage au régime du catalogue (HT/TTC). Il ne réalise pas encore le fonctionnement B2B HTVA décrit ici. Changer uniquement le libellé serait incorrect.

## 3. Structure du devis client

### En-tête

Identité Mikado, numéro de devis stable, révision commerciale, date d’émission, validité, nom du projet, entreprise cliente, contact, adresses et numéro de TVA client si renseigné. Une introduction commerciale est facultative ; ne pas imposer une page de couverture aux devis courts.

### Détail par pièce ou lot

Numérotation lisible : 1. Salle de réunion ; 1.1 Table ; 1.2 Chaises. Colonnes : repère, visuel et description, référence, quantité, prix unitaire HTVA, remise, montant HTVA. Les descriptions doivent être éditables et imprimées : dimensions, matériaux, finitions et remarques du projet, indépendamment du catalogue.

Pour chaque groupe :

- Identifier la proposition retenue avec « Retenu — inclus dans le total ».
- Présenter les autres propositions sous « Alternative — non comprise dans le total » avec le produit remplacé et l’écart signé (+ ou −) en HTVA.
- Si l’alternative est retenue, c’est la base qui devient exclue. L’étiquette ne doit pas dépendre uniquement de l’ordre des lignes.
- Une option supplémentaire porte « Incluse » ou « Non comprise dans le total » selon son état.
- Séparer visuellement le montant indicatif des propositions exclues du montant retenu. Ne pas présenter une colonne apparemment additionnable sans distinguer ces valeurs.
- Afficher un sous-total HTVA du lot, calculé uniquement sur les choix retenus.

Ajouter des en-têtes répétés, le numéro du devis et une pagination cohérente sur les pages suivantes. Éviter les titres de lot isolés en bas de page. Les longues descriptions peuvent se poursuivre proprement sans masquer les montants. Utiliser une police embarquée avec licence adaptée et le même moteur de rendu pour les vérifications et la production.

### Récapitulatif

Présenter les sous-totaux HTVA par lot, puis les frais et prestations retenus, le total HTVA, la TVA par taux effectivement applicable et le total TVAC à payer. Les frais ne doivent apparaître qu’une fois dans le calcul.

Livraison et installation : montant fixe HTVA dans la première version. Prévoir aussi un mode pourcentage avec une assiette explicitement affichée et figée : sous-total HTVA des produits retenus après remises, hors autres frais. Un recalcul doit suivre tout changement des sélections. Le devis de référence comporte ce type de majoration ; ne pas activer son taux de 3 % automatiquement chez Mikado.

Modalités de paiement : texte visible, pourcentage d’acompte structuré lorsqu’il est applicable, montant d’acompte TVAC et solde TVAC. Pour une condition libre, aucun pourcentage ne doit être deviné depuis le texte. Le montant de l’acompte reste indicatif tant que la fiscalité du devis n’est pas validée.

Les mentions et coordonnées Mikado sont configurables. Confirmer l’adresse complète, le numéro d’entreprise/TVA, le site à afficher et les éventuelles coordonnées bancaires avant mise en service. Ne pas remplacer le site par celui indiqué dans l’audit sans vérification auprès de Cyril.

## 4. Prix HTVA, taxes et rapprochement Shopify

### Modèle à introduire

Distinguer explicitement : prix d’origine du catalogue, régime de ce prix, prix unitaire HTVA du devis, remise, montant de ligne HTVA, taxes et total TVAC. Conserver la provenance et la précision utilisée pour la conversion de prix. Les taux et montants fiscaux sont des données d’une version du devis, pas de simples préférences d’affichage.

Ajouter un état de calcul fiscal : « à calculer », « calculé » ou « à recalculer », ainsi qu’une empreinte des données utilisées (client, adresses, lignes, prix, remises et frais). Modifier l’une de ces données invalide le calcul précédent.

### Import d’un prix Shopify

- Si le prix source est hors taxes, il sert de point de départ au prix HTVA.
- S’il comprend les taxes, déterminer sa composante hors taxes selon le contexte vérifié du catalogue. Ne jamais diviser tous les prix par 1,21 sans connaître le traitement du produit.
- Distinguer la taxe incorporée dans le prix source de la taxe applicable à la vente au client : elles ne sont pas nécessairement identiques.
- Tant que le prix HTVA ne peut pas être déterminé de manière fiable, signaler la ligne à vérifier ; permettre un prix HTVA explicite avec traçabilité.
- Ne pas changer le régime global de la boutique pour satisfaire l’affichage de cette application.

### Émission et conversion

Obtenir un calcul fiscal avant de figer un devis destiné au client. Une prévisualisation sans calcul reste identifiable comme brouillon ; aucun montant TVAC estimé ne doit être présenté comme montant définitif à payer. Ne pas déduire une exonération de la seule présence d’un numéro de TVA.

À la conversion, reconstruire les prix dans le régime attendu par Shopify, puis comparer séparément HTVA, TVA et TVAC, devise et lignes retenues. Un total HTVA ne se compare pas directement à un total TVAC. Contrôler également les frais et remises.

Un écart commercial ou fiscal non résolu bloque la création. Présenter sa cause et proposer de recalculer une nouvelle révision, plutôt que de modifier silencieusement l’offre figée. Les règles d’arrondi doivent être vérifiées sur Shopify réel avant de fixer une politique d’écart ; ne pas masquer automatiquement un centime de différence.

### Exemple d’acceptation arithmétique

Hypothèse de test uniquement : toutes les lignes sont soumises à une TVA de 21 %.

| Élément retenu | HTVA |
|---|---:|
| 40 chaises de l’alternative à 120 € | 4 800,00 € |
| Installation retenue | 350,00 € |
| Total HTVA | 5 150,00 € |
| TVA de l’exemple : 21 % | 1 081,50 € |
| Total TVAC | 6 231,50 € |
| Acompte de 30 % sur le TVAC | 1 869,45 € |
| Solde TVAC | 4 362,05 € |

La base à 4 000 € et les autres propositions restent visibles mais exclues du total retenu. Un second test doit couvrir des taux différents, et un autre l’absence de taxe validée par le contexte. Le taux de cet exemple n’est pas une règle fiscale de l’application.

## 5. Corrections et améliorations issues de l’audit

| Sujet | Décision | Validation attendue |
|---|---|---|
| iCloud / Git | Développement hors dossier synchronisé ; dépendances réinstallées ; dépôt Git local puis dépôt privé selon hébergement retenu ; seuls les livrables sont copiés dans outputs | Installation reproductible, aucun doublon généré, tests et compilation propres |
| Code dense | Formater les sources et séparer progressivement éditeur, calculs et document | Aucun changement fonctionnel involontaire |
| Confirmations | Remplacer confirm() par des dialogues internes ; protéger aussi les sorties dans Shopify avec les mécanismes de l’interface embarquée | Archivage et navigation testés dans Shopify réel |
| Enregistrer depuis l’aperçu | Utiliser une même action de sauvegarde validée pour les deux vues | Modification, aperçu, sauvegarde et rechargement réussis |
| Perte de saisie | Récupération locale limitée, isolée par boutique/devis/utilisateur, avec expiration et proposition explicite de restauration ; effacement après sauvegarde | Aucune restauration dans le mauvais compte, gestion du stockage indisponible |
| Erreurs Shopify | Distinguer refus explicite, échec transitoire avant exécution prouvé et résultat incertain | Refus net réessayable après correction ; timeout sans recréation aveugle |
| Sortie d’incertitude | Réconciliation prioritaire ; procédure de résolution tracée ; un clic de confirmation ne prouve pas l’absence de commande | Interruption après création retrouvée sans doublon |
| Références de conversion | Identifiant aléatoire durable par tentative logique, réutilisé lors de sa récupération ; ne plus dépendre du seul entier local | Restauration ancienne sans association avec une commande étrangère au devis |
| Numéro de devis | Référence commerciale stockée à la création et stratégie après restauration ; identifiant technique indépendant | Aucun numéro réémis silencieusement après récupération |
| Recherche réelle | Vérifier recherche partielle, accents, SKU et entreprise cliente avec les filtres réellement disponibles | Cinq cas du catalogue réel, sans supposer qu’un filtre entreprise existe |
| Conditions dans la commande | Transmettre modalités de paiement, délai de livraison et référence de révision dans la note | Relecture de la commande provisoire ; texte distinct d’un échéancier Shopify configuré |
| Quantités | Quantité commune par défaut dans un groupe ; possibilité de désynchroniser explicitement une alternative | Passage de 40 à 44 propagé ; quantité différente signalée avant comparaison |
| Catalogue / lignes libres | Autoriser produits du catalogue comme options et lignes libres comme propositions principales | Bon total et bonnes lignes transférées |
| Descriptions | Champ éditable, imprimé et figé avec la révision | La modification du catalogue n’altère pas l’offre émise |
| Remise collective | Action « appliquer X % » aux groupes/lignes choisis, sans deuxième remise cumulée implicite | Base, alternatives et options clairement incluses ou exclues du périmètre |
| Saisie de gros projets | Sélection multiple de produits, ordre des groupes, sous-totaux par lot, erreurs en français | Préparation d’un devis de 30 lignes sans opérations répétitives inutiles |
| Versions | Séparer numéro de sauvegarde interne et révision commerciale figée | Enregistrer dix fois ne produit pas une offre client V10 |
| Sauvegardes | Sauvegarde cohérente et chiffrée de SQLite, hors serveur, rétention et alerte d’échec ; exercice de restauration | Devis, PDF et références récupérés ; commandes réconciliées |
| PDF Linux | Vérification dans l’image Docker réelle, police fixée, visuels et pagination contrôlés | Comparaison macOS/Linux sur devis court et long |

Les observations de l’audit sur la recherche, les arrondis et certaines limites d’iframe sont des hypothèses à tester, pas des comportements déjà reproduits sur la boutique.

## 6. Sauvegardes et versions commerciales

« Enregistrer » conserve le travail et son historique interne. « Figer le devis » crée une révision commerciale et son PDF immuable, avec date d’émission, taxes, coordonnées et conditions figées. « Marquer comme transmis » enregistre une action manuelle ; un téléchargement n’est pas assimilé à un envoi.

Modifier une révision émise ouvre un nouveau brouillon. Repartir d’une ancienne version copie ses données dans ce brouillon sans écraser l’historique. La conversion désigne une révision et une sélection exactes.

Les anciens documents ne doivent jamais être réétiquetés HTVA sans conversion. Conserver les anciens PDF et leur modèle ; marquer les brouillons existants à vérifier lors du passage au nouveau modèle. Ajouter un numéro de schéma aux données JSON et une migration testée, avec sauvegarde préalable.

## 7. Ordre d’implémentation

1. **Fondation propre** : copie hors iCloud, Git, formatage, réinstallation et base isolée pour les tests. Réparer la sauvegarde depuis l’aperçu et les confirmations ; ajouter les conditions aux notes de commande.
2. **Calcul B2B** : données HTVA distinctes, import des prix catalogue, calcul fiscal contextualisé, comparaison HTVA/TVA/TVAC, remises et arrondis. Tester les opérations sur Shopify de test sans envoyer de message au client.
3. **Éditeur et PDF contract** : descriptions, quantités de groupe, lignes libres/options catalogue, repères, sous-totaux, exclusions visibles, récapitulatif fiscal et acompte TVAC. Garder le style validé.
4. **Révisions et conversion** : figer/émettre, conserver les anciens documents, classifier les erreurs, identifiants de conversion indépendants, récupération robuste.
5. **Pilote en conditions réelles** : hébergement HTTPS, installation privée, accès clients, PDF Docker, sauvegardes et restauration ; un devis représentatif de bout en bout jusqu’à la commande provisoire de test.

Fichiers principalement concernés : app/domain/quote.ts (schéma et calculs), app/services/shopify-api.server.ts (prix et rapprochement), app/services/conversion.server.ts (états et référence), app/services/quotes.server.ts (travail et révisions), app/components/Editor.tsx, app/components/QuoteDocument.tsx, app/services/pdf.server.ts, styles documentaires, schéma Prisma, migrations et tests.

## 8. Critères avant utilisation avec de vrais clients

- Des prix issus d’un catalogue TVAC produisent des prix HTVA justifiés et traçables.
- Les taux/exonérations ne sont pas supposés ; le TVAC de la version émise correspond au contexte fiscal enregistré.
- Les changements après calcul invalident explicitement les taxes précédentes.
- Les alternatives exclues ne gonflent ni les sous-totaux des lots, ni les frais proportionnels, ni l’acompte.
- Aucun PDF déjà émis n’est modifié par une migration, un changement de prix ou une nouvelle mise en page.
- Les écarts de prix ou taxes sont résolus avant création Shopify.
- Le parcours réel fonctionne avec double clic, refus API, expiration de session, timeout et reprise.
- L’offre courte et le gros projet sont lisibles en PDF Linux ; les totaux, échéances et descriptions sont vérifiés.
- Une sauvegarde hors serveur a été restaurée et contrôlée ; le déploiement ne remplace pas la base persistante.

## 9. Informations encore à fournir ou vérifier

Coordonnées légales et fiscales Mikado, site et IBAN à afficher ; conditions commerciales propres à Mikado ; contexte de TVA réel du catalogue et des clients ; hébergement et domaine. Ces éléments ne bloquent pas la conception ci-dessus, mais conditionnent l’émission de documents définitifs et la mise en service.

Le document de référence confirme l’intérêt des lots, descriptions, alternatives exclues, récapitulatif des lots, frais explicites et ventilation nette/TVA/total. Son contenu commercial n’est pas importé dans les données de l’application.

## État après implémentation — 18 septembre 2026

Réalisé localement : modèle HTVA/TVA/TVAC, acomptes et solde, conversion explicite des prix source inclus, lots et alternatives, options fixes/proportionnelles, quantités liées, descriptions, révisions commerciales séparées des sauvegardes, PDF figés et historique préservé, récupération de saisie, calcul Shopify comparé avant publication/conversion et récupération des créations incertaines. Sources sorties d’iCloud, Git local, sauvegarde chiffrée/restauration et configuration Docker fournis.

Validation : 13 tests unitaires et 7 d’intégration, parcours navigateur desktop/mobile et PDF court/long ; les tests Shopify utilisent des réponses simulées. Voir README et `exploitation.md` pour les limites et commandes.

À terminer sur l’environnement réel : identité vendeur complète, confirmation du régime des prix catalogue, hébergement/domaine, image Docker cible, installation privée, essais fiscaux et commande provisoire réelle, planification et stockage hors site des sauvegardes. Ces étapes ne sont pas considérées comme validées par la démonstration locale.
