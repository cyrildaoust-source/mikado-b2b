-- Paliers de départ des architectes (décision de Cyril du 26/11/2026).
-- Palier en centimes HTVA sur 12 mois. Ne pose rien si des classes existent
-- déjà : celles saisies dans « Accès » restent maîtresses.
INSERT INTO "ArchitectClass" ("name", "discount", "threshold")
SELECT v.name, v.discount, v.threshold
FROM (VALUES
  ('Esquisse', 10, 0),
  ('Plan', 12, 1500000),
  ('Projet', 14, 3500000),
  ('Signature', 16, 7500000)
) AS v(name, discount, threshold)
WHERE NOT EXISTS (SELECT 1 FROM "ArchitectClass");
