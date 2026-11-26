import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkingDays,
  arrivalWindow,
  deliveryLabel,
  editingAfterRelease,
  firstName,
  longest,
  parseLeadTime,
  quoteLeadTime,
  stage,
  validityLeft,
} from "../app/domain/dashboard";

const rev = (
  version: number,
  n: number | null,
  pdf: boolean,
  sent: boolean,
) => ({
  version,
  publishedNumber: n,
  pdfGeneratedAt: pdf ? new Date() : null,
  sentAt: sent ? new Date() : null,
});

test("étapes d'un devis", () => {
  assert.equal(stage({ status: "draft", version: 1, revisions: [] }), "draft");
  assert.equal(
    stage({
      status: "draft",
      version: 2,
      revisions: [rev(2, 1, false, false)],
    }),
    "draft",
  );
  assert.equal(
    stage({ status: "draft", version: 2, revisions: [rev(2, 1, true, false)] }),
    "ready",
  );
  assert.equal(
    stage({ status: "draft", version: 2, revisions: [rev(2, 1, true, true)] }),
    "sent",
  );
  // R1 envoyée puis modifiée : de nouveau en préparation, comme dans la liste.
  const editing = {
    status: "draft",
    version: 3,
    revisions: [rev(2, 1, true, true)],
  };
  assert.equal(stage(editing), "draft");
  assert.equal(editingAfterRelease(editing), true);
  // R1 prête mais pas envoyée, puis modifiée : en préparation, sans mention d'envoi.
  const unsent = {
    status: "draft",
    version: 3,
    revisions: [rev(2, 1, true, false)],
  };
  assert.equal(stage(unsent), "draft");
  assert.equal(editingAfterRelease(unsent), false);
  // La dernière révision prête décide, pas une plus ancienne envoyée.
  assert.equal(
    stage({
      status: "draft",
      version: 4,
      revisions: [rev(4, 2, true, false), rev(2, 1, true, true)],
    }),
    "ready",
  );
  assert.equal(
    stage({
      status: "converted",
      version: 1,
      conversion: { status: "complete" },
    }),
    "ordered",
  );
  assert.equal(
    stage({
      status: "converted",
      version: 1,
      conversion: { status: "complete", orderStatus: "uncertain" },
    }),
    "check",
  );
  assert.equal(
    stage({ status: "draft", version: 1, conversion: { status: "uncertain" } }),
    "check",
  );
  assert.equal(stage({ status: "archived", version: 1 }), null);
  assert.equal(stage({ status: "deleted", version: 1 }), null);
});

test("lecture des délais", () => {
  assert.deepEqual(parseLeadTime("7-10 jours ouvrés"), {
    kind: "days",
    min: 7,
    max: 10,
    text: "7-10 jours ouvrés",
  });
  assert.deepEqual(parseLeadTime("6-10 semaines"), {
    kind: "days",
    min: 30,
    max: 50,
    text: "6-10 semaines",
  });
  assert.deepEqual(parseLeadTime("3 semaines"), {
    kind: "days",
    min: 15,
    max: 15,
    text: "3 semaines",
  });
  assert.deepEqual(parseLeadTime("1 semaine"), {
    kind: "days",
    min: 5,
    max: 5,
    text: "1 semaine",
  });
  assert.deepEqual(parseLeadTime("sur demande"), {
    kind: "onRequest",
    text: "sur demande",
  });
  assert.equal(parseLeadTime(""), null);
  assert.equal(parseLeadTime(null), null);
  assert.equal(parseLeadTime("bientôt"), null);
  assert.equal(parseLeadTime("10-6 semaines"), null);
});

test("le délai le plus long d'un devis", () => {
  const p = parseLeadTime;
  assert.equal(
    longest([p("7-10 jours ouvrés"), p("3-4 semaines"), null])?.text,
    "3-4 semaines",
  );
  assert.equal(
    longest([p("3-4 semaines"), p("sur demande")])?.text,
    "sur demande",
  );
  assert.equal(longest([null, null]), null);
  const map = new Map([
    ["a", "7-10 jours ouvrés"],
    ["b", "6-10 semaines"],
    ["c", null],
  ]);
  assert.deepEqual(
    { ...quoteLeadTime(["a", "b", "c", "a", "d"], map), longest: undefined },
    { longest: undefined, missing: 2, products: 4 },
  );
  assert.equal(quoteLeadTime(["a", "b"], map).longest?.text, "6-10 semaines");
});

test("arrivée estimée en jours ouvrés", () => {
  // Jeudi 26 novembre 2026 + 2 jours ouvrés = lundi 30 novembre.
  const thu = new Date("2026-11-26T10:00:00Z");
  assert.equal(addWorkingDays(thu, 2).toISOString().slice(0, 10), "2026-11-30");
  assert.equal(addWorkingDays(thu, 0).toISOString().slice(0, 10), "2026-11-26");
  const w = arrivalWindow(thu, parseLeadTime("3-4 semaines"))!;
  assert.equal(w.from.toISOString().slice(0, 10), "2026-12-17");
  assert.equal(w.to.toISOString().slice(0, 10), "2026-12-24");
  assert.equal(arrivalWindow(thu, parseLeadTime("sur demande")), null);
  assert.equal(arrivalWindow(thu, null), null);
});

test("validité, prénom et livraison", () => {
  const today = new Date("2026-11-26T15:00:00Z");
  assert.equal(validityLeft("2026-11-30", today), 4);
  assert.equal(validityLeft("2026-11-26", today), 0);
  assert.equal(validityLeft("2026-11-20", today), -6);
  assert.equal(validityLeft("", today), null);
  assert.equal(firstName("Marie Dupont"), "Marie");
  assert.equal(firstName("  Cyril "), "Cyril");
  assert.equal(firstName("archi@exemple.be"), "");
  assert.equal(firstName(""), "");
  assert.equal(deliveryLabel("FULFILLED"), "Livrée");
  assert.equal(deliveryLabel("PARTIALLY_FULFILLED"), "Livrée en partie");
  assert.equal(deliveryLabel("UNFULFILLED"), "En commande");
  assert.equal(deliveryLabel("UNFULFILLED", true), "Commande annulée");
  assert.equal(deliveryLabel(null), null);
});

test("classes d'architectes : remise actuelle et suivante", async () => {
  const { classStatus } = await import("../app/domain/dashboard");
  const classes = [
    { id: 3, name: "Or", discount: 15, threshold: 5000000 },
    { id: 1, name: "Bronze", discount: 5, threshold: 0 },
    { id: 2, name: "Argent", discount: 10, threshold: 2000000 },
  ];
  // Nouveau compte : Bronze par le palier 0, Argent ensuite.
  let s = classStatus(classes, null, 0);
  assert.equal(s.current?.name, "Bronze");
  assert.equal(s.next?.name, "Argent");
  assert.equal(s.remaining, 2000000);
  assert.equal(s.progress, 0);
  // Le chiffre ouvre Argent.
  s = classStatus(classes, null, 2500000);
  assert.equal(s.current?.name, "Argent");
  assert.equal(s.earned, true);
  assert.equal(s.next?.name, "Or");
  assert.equal(s.remaining, 2500000);
  assert.equal(s.progress, 0.5);
  // Mikado Deco a mis Or : un minimum, même sans chiffre.
  s = classStatus(classes, 3, 100);
  assert.equal(s.current?.name, "Or");
  assert.equal(s.earned, false);
  assert.equal(s.next, null);
  assert.equal(s.progress, 1);
  // Choix plus bas que le chiffre : le chiffre l'emporte.
  s = classStatus(classes, 1, 6000000);
  assert.equal(s.current?.name, "Or");
  // Sans classe à palier 0 ni choix : pas de classe, la première à atteindre.
  s = classStatus([classes[0], classes[2]], null, 1000000);
  assert.equal(s.current, null);
  assert.equal(s.next?.name, "Argent");
  assert.equal(s.remaining, 1000000);
  assert.equal(classStatus([], null, 0).current, null);
});

test("fidélité : garantie de 12 mois et premier devis double", async () => {
  const { loyaltyStatus, rollingVolume } = await import(
    "../app/domain/dashboard"
  );
  const classes = [
    { id: 1, name: "Esquisse", discount: 10, threshold: 0 },
    { id: 2, name: "Plan", discount: 12, threshold: 1500000 },
    { id: 3, name: "Projet", discount: 14, threshold: 3500000 },
    { id: 4, name: "Signature", discount: 16, threshold: 7500000 },
  ];
  const d = (s: string) => new Date(`${s}T10:00:00Z`);
  const old = d("2024-01-01");
  // 20 000 € le 1er mars 2026 et 20 000 € le 1er juin 2026 : Projet (40 000).
  const items = [
    { at: d("2026-03-01"), amount: 2000000 },
    { at: d("2026-06-01"), amount: 2000000 },
  ];
  assert.equal(rollingVolume(items, d("2026-11-26")), 4000000);
  // En mars 2027, le devis de mars 2026 est sorti du chiffre glissant :
  // 20 000 €, mais Projet reste acquis jusqu'au 1er juin 2027.
  let s = loyaltyStatus(classes, null, items, old, d("2027-03-15"));
  assert.equal(s.volume, 2000000);
  assert.equal(s.current?.name, "Projet");
  assert.equal(s.next?.name, "Signature");
  assert.equal(s.remaining, 5500000);
  assert.deepEqual(s.guarantee, {
    until: "2027-06-01",
    keep: 1500000,
    soon: false,
  });
  // À 60 jours de la fin, l'accueil prévient.
  s = loyaltyStatus(classes, null, items, old, d("2027-04-10"));
  assert.equal(s.guarantee?.soon, true);
  // Après la fin, retour à la classe du chiffre.
  s = loyaltyStatus(classes, null, items, old, d("2027-06-02"));
  assert.equal(s.current?.name, "Esquisse");
  assert.equal(s.volume, 0);
  assert.equal(s.guarantee, null);
  // Chiffre au-dessus du palier : pas d'échéance à afficher.
  s = loyaltyStatus(classes, null, items, old, d("2026-11-26"));
  assert.equal(s.current?.name, "Projet");
  assert.equal(s.guarantee, null);
  assert.equal(s.welcome, null);
  // Un choix de Mikado Deco plus haut l'emporte, sans garantie à afficher.
  s = loyaltyStatus(classes, 4, items, old, d("2027-03-15"));
  assert.equal(s.current?.name, "Signature");
  assert.equal(s.guarantee, null);

  // Bienvenue : compte ouvert le 1er octobre, premier devis de 10 000 € le
  // 20 novembre, compté 20 000 € : Plan.
  const created = d("2026-10-01");
  const first = [{ at: d("2026-11-20"), amount: 1000000 }];
  s = loyaltyStatus(classes, null, first, created, d("2026-11-26"));
  assert.equal(s.welcome, "counted");
  assert.equal(s.volume, 2000000);
  assert.equal(s.current?.name, "Plan");
  // Après 60 jours, le premier devis compte simple.
  const late = [{ at: d("2026-12-15"), amount: 1000000 }];
  s = loyaltyStatus(classes, null, late, created, d("2026-12-20"));
  assert.equal(s.welcome, null);
  assert.equal(s.volume, 1000000);
  // Pas encore de devis accepté, compte récent : l'offre est ouverte.
  s = loyaltyStatus(classes, null, [], created, d("2026-11-26"));
  assert.equal(s.welcome, "open");
  s = loyaltyStatus(classes, null, [], created, d("2027-01-15"));
  assert.equal(s.welcome, null);
});
