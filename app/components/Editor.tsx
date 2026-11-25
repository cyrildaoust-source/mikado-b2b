import { NumberField } from "./quote/NumberField";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useNavigation,
  useSubmit,
  useNavigate,
  useRevalidator,
} from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import {
  applyMikadoPolicy,
  commercialStatus,
  quoteSchema,
  lineSchema,
  quoteSections,
  removeLine,
  setQuantity,
  money,
  lineTotal,
  fiscalTotals,
  paymentText,
  type QuoteState,
  clientNames,
  withClientNames,
  type Line,
} from "../domain/quote";
import type { getQuote } from "../services/quotes.server";
import { QuoteDocument } from "./QuoteDocument";
import { dropOnQuote, type DragSource, type DropTarget } from "../domain/move";
import {
  CATALOGUE_ADD,
  catalogueDrag,
  type CatalogueCard,
} from "./quote/CatalogueBrowser";
import { Modal } from "./quote/Modal";
import { useDraft } from "./quote/useDraft";
import { ProductRow } from "./quote/ProductRow";
import { QuoteSummary } from "./quote/QuoteSummary";
import { PaymentTerms } from "./quote/PaymentTerms";
import { CustomerCard, AddressFields } from "./quote/CustomerCard";
import { CustomerEmailAutocomplete } from "./quote/CustomerEmailAutocomplete";
import {
  ProductPicker,
  nativeProducts,
  type Customer,
} from "./quote/ProductPicker";

type RecordQuote = Awaited<ReturnType<typeof getQuote>>;
type Target = {
  kind: "products" | "customers";
  group?: string;
  section?: string;
  sectionTitle?: string;
  extra?: boolean;
};
/** Brouillon de la fiche client : noms retrouvés, facturation pré-remplie. */
function draftFrom(s: QuoteState): QuoteState {
  return {
    ...s,
    ...clientNames(s),
    billing:
      s.billingSame || !s.billing.address1 ? { ...s.shipping } : s.billing,
  };
}
function fromCustomer(d: QuoteState, c: Customer): QuoteState {
  const [first, ...rest] = c.name.trim().split(/\s+/);
  return {
    ...d,
    firstName: c.address.firstName || (rest.length ? first : ""),
    lastName:
      c.address.lastName || (rest.length ? rest.join(" ") : first || ""),
    company: c.address.company,
    email: c.email,
    customerId: c.id,
    billing: c.address,
    shipping: c.address,
    billingSame: true,
  };
}

export default function Editor({
  q,
  demo,
  embedded = !demo,
  admin = true,
  alternativeFor = null,
  onAlternative,
  shop,
  actor,
  result,
  billingMode,
  odooUrl,
}: {
  q: RecordQuote;
  billingMode: "disabled" | "simulation" | "live";
  odooUrl: string | null;
  demo: boolean;
  embedded?: boolean;
  admin?: boolean;
  /** Espace devis : produit dont on cherche une alternative dans le catalogue. */
  alternativeFor?: string | null;
  onAlternative?: (target: { group: string; name: string } | null) => void;
  shop: string;
  actor: string | null;
  result?: { ok?: string; error?: string };
}) {
  const draft = useDraft(
      q.state,
      actor ? `mikado-draft:${shop}:${actor}:${q.id}` : null,
      q.version,
    ),
    { state: s, dirty, change } = draft;
  const revalidator = useRevalidator();
  useEffect(() => {
    if (billingMode !== "live" || dirty || !q.billingRequests.length) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 60000);
    return () => clearInterval(timer);
  }, [billingMode, dirty, q.billingRequests.length, revalidator]);
  const submit = useSubmit(),
    navigation = useNavigation(),
    navigate = useNavigate();
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [picker, setPicker] = useState<Target | null>(null),
    [custom, setCustom] = useState<Target | null>(null),
    [modal, setModal] = useState<
      | "client"
      | "pdf"
      | "leave"
      | "trash"
      | "archive"
      | "policy"
      | "convert"
      | null
    >(null),
    [policy, setPolicy] = useState<QuoteState | null>(null),
    [newLot, setNewLot] = useState(false),
    [clientDraft, setClientDraft] = useState(s),
    [showHistory, setShowHistory] = useState(false),
    // Glisser-déposer : produit (avec ses alternatives) ou alternative seule.
    [dragging, setDragging] = useState<DragSource | null>(null),
    [dropAt, setDropAt] = useState<string | null>(null),
    // Outil pro : coordonnées en bandeau, ou épinglées à droite sur grand écran.
    [coordsOpen, setCoordsOpen] = useState(!s.client),
    [pinPref, setPinPref] = useState(false),
    [wide, setWide] = useState(false);
  const pinned = !embedded && pinPref && wide;
  function setPinned(value: boolean) {
    setPinPref(value);
    try {
      localStorage.setItem("mikado-coordonnees", value ? "epinglees" : "");
    } catch {}
  }
  useEffect(() => {
    try {
      setPinPref(localStorage.getItem("mikado-coordonnees") === "epinglees");
    } catch {}
    const mq = window.matchMedia("(min-width: 1600px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const busy = navigation.state !== "idle" || working,
    legacy = s.schemaVersion === 1,
    locked =
      legacy ||
      q.status !== "draft" ||
      ["creating", "uncertain", "complete"].includes(
        q.conversion?.status || "",
      ),
    sections = quoteSections(s);
  const current = q.revisions.find(
      (r) => r.version === q.version && r.publishedNumber,
    ),
    lastReady = q.revisions.find((r) => r.pdfGeneratedAt),
    ready = Boolean(current?.pdfGeneratedAt),
    fiscal = fiscalTotals(s);
  useEffect(() => {
    if (
      result?.ok === "Devis enregistré." ||
      result?.ok?.startsWith("Votre PDF")
    ) {
      draft.saved();
      setModal(null);
    }
  }, [result]);
  // Hors Shopify, chaque modification s'enregistre seule, sans bouton.
  const autosave = useFetcher<{ ok?: string; error?: string }>(),
    autoSaving = autosave.state !== "idle",
    autoSent = useRef<QuoteState | null>(null),
    autoFailed = useRef<QuoteState | null>(null),
    auto = !embedded && !locked;
  useEffect(() => {
    if (!auto || !dirty || autoSaving || busy || autoFailed.current === s)
      return;
    const t = setTimeout(() => {
      const parsed = quoteSchema.safeParse(s);
      if (!parsed.success) {
        autoFailed.current = s;
        setError(parsed.error.issues.map((e) => e.message).join(" "));
        return;
      }
      autoSent.current = s;
      autosave.submit(
        {
          intent: "save",
          version: q.version,
          state: JSON.stringify(parsed.data),
        },
        { method: "post" },
      );
    }, 700);
    return () => clearTimeout(t);
  }, [auto, dirty, autoSaving, busy, s, q.version]);
  useEffect(() => {
    if (autosave.state !== "idle" || !autosave.data) return;
    if (autosave.data.error) {
      autoFailed.current = autoSent.current;
      setError(autosave.data.error);
    } else if (autoSent.current === s) {
      draft.saved();
      setError("");
    }
  }, [autosave.state, autosave.data]);
  function field<K extends keyof QuoteState>(key: K, value: QuoteState[K]) {
    change({ ...s, [key]: value });
    setError("");
  }
  function patch(id: string, value: Partial<Line>) {
    if (value.qty !== undefined) {
      change(setQuantity(s, id, value.qty));
      return;
    }
    change({
      ...s,
      groups: s.groups.map((g) => ({
        ...g,
        items: g.items.map((i) => (i.id === id ? { ...i, ...value } : i)),
      })),
      extras: s.extras.map((e) => (e.id === id ? { ...e, ...value } : e)),
    });
  }
  function send(intent: string, extra: Record<string, string> = {}) {
    if (dirty && !["save", "prepare"].includes(intent)) {
      setError(
        auto
          ? "Enregistrement en cours, réessayez dans un instant."
          : "Enregistrez vos modifications avant cette action.",
      );
      return;
    }
    if (["save", "prepare"].includes(intent)) {
      const parsed = quoteSchema.safeParse(s);
      if (!parsed.success) {
        setError(parsed.error.issues.map((e) => e.message).join(" "));
        return;
      }
      submit(
        {
          intent,
          version: q.version,
          state: JSON.stringify(parsed.data),
          ...extra,
        },
        { method: "post" },
      );
    } else submit({ intent, version: q.version, ...extra }, { method: "post" });
  }
  function remove(id: string) {
    change((current) => removeLine(current, id), true);
  }
  function add(
    items: (Line | Customer)[],
    target: Target,
    reversible = false,
  ) {
    if (target.kind === "customers") {
      const c = items[0] as Customer;
      setClientDraft(fromCustomer(draftFrom(s), c));
      setModal("client");
      setPicker(null);
      return;
    }
    const lines = (items as Line[]).map((i) => ({
      ...i,
      id: crypto.randomUUID(),
    }));
    if (lines.some((i) => !i.taxable)) {
      setError(
        "Un article Shopify est configuré sans taxe. Corrigez sa taxation dans Shopify avant de l’ajouter au devis à 21 %.",
      );
      return;
    }
    change((previous) => {
      if (target.extra)
        return {
          ...previous,
          extras: [
            ...previous.extras,
            ...lines.map((i) => ({ ...i, selected: false })),
          ],
        };
      if (target.group)
        return {
          ...previous,
          groups: previous.groups.map((g) =>
            g.id === target.group
              ? {
                  ...g,
                  items: [
                    ...g.items,
                    ...lines.map((i) => ({
                      ...i,
                      qty: g.syncQty ? g.items[0].qty : i.qty,
                    })),
                  ],
                }
              : g,
          ),
        };
      const section =
          sections.find((x) => x.id === target.section) ||
          (target.sectionTitle ? undefined : sections.at(-1)),
        sectionId = target.section || section?.id || crypto.randomUUID(),
        newGroups = lines.map((i) => ({
          id: crypto.randomUUID(),
          sectionId,
          section: target.sectionTitle || section?.title || "Produits",
          selected: i.id,
          syncQty: true,
          items: [i],
        })),
        insertAfter = previous.groups.reduce(
          (last, group, index) =>
            group.sectionId === sectionId ? index : last,
          -1,
        ),
        groups = [...previous.groups];
      if (insertAfter >= 0) groups.splice(insertAfter + 1, 0, ...newGroups);
      else groups.push(...newGroups);
      return {
        ...previous,
        groups,
      };
    }, reversible);
    setPicker(null);
  }
  // Catalogue à gauche du devis : une carte glissée ou ajoutée par +.
  async function addCard(card: CatalogueCard, target: Target) {
    if (locked) return;
    setError("");
    try {
      const url = new URL("/app/catalog", location.origin);
      url.searchParams.set("kind", "line");
      url.searchParams.set("produit", card.numericId);
      url.searchParams.set("variante", card.id);
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok || !d.items?.length) throw Error(d.error || "");
      add(d.items, target, true);
    } catch (e) {
      setError(
        (e instanceof Error && e.message) ||
          "Ce produit n’a pas pu être ajouté. Réessayez.",
      );
    }
  }
  const addCardRef = useRef(addCard);
  addCardRef.current = addCard;
  useEffect(() => {
    const onAdd = (e: Event) => {
      const card = (e as CustomEvent<CatalogueCard>).detail;
      addCardRef.current(
        card,
        card.group
          ? { kind: "products", group: card.group }
          : { kind: "products" },
      );
    };
    window.addEventListener(CATALOGUE_ADD, onAdd);
    return () => window.removeEventListener(CATALOGUE_ADD, onAdd);
  }, []);
  async function pick(target: Target) {
    if (!embedded || target.kind === "customers") {
      setPicker(target);
      return;
    }
    setWorking(true);
    setError("");
    try {
      const items = await nativeProducts();
      if (items) add(items, target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sélection indisponible.");
    } finally {
      setWorking(false);
    }
  }
  async function download(version: number) {
    setWorking(true);
    setError("");
    try {
      const r = await fetch(`/app/quotes/${q.id}/pdf`, {
        method: "POST",
        body: new URLSearchParams({ version: String(version) }),
      });
      if (!r.ok) throw Error(await r.text());
      const blob = await r.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `${q.number}-${q.revisions.find((r) => r.version === version)?.publishedNumber ? "R" + q.revisions.find((r) => r.version === version)!.publishedNumber : "v" + version}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF indisponible");
    } finally {
      setWorking(false);
    }
  }
  function move(groupId: string, direction: number) {
    const groups = [...s.groups],
      i = groups.findIndex((g) => g.id === groupId),
      j = i + direction;
    if (j < 0 || j >= groups.length) return;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    change({ ...s, groups });
  }
  // Ref en plus de l'état : le navigateur peut envoyer dragover avant le rendu.
  const dragRef = useRef<DragSource | null>(null);
  function dropProps(key: string, target: DropTarget) {
    if (locked) return {};
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragRef.current && !catalogueDrag.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = dragRef.current ? "move" : "copy";
        if (dropAt !== key) setDropAt(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
      },
      onDrop: (e: React.DragEvent) => {
        const card = catalogueDrag.current;
        if (card && !dragRef.current) {
          e.preventDefault();
          e.stopPropagation();
          catalogueDrag.current = null;
          setDropAt(null);
          if (alternativeFor) onAlternative?.(null);
          void addCard(
            card,
            target.kind === "group"
              ? { kind: "products", group: target.groupId }
              : target.sectionId
                ? { kind: "products", section: target.sectionId }
                : { kind: "products" },
          );
          return;
        }
        const source = dragRef.current;
        if (!source) return;
        e.preventDefault();
        e.stopPropagation();
        const next = dropOnQuote(s, source, target);
        if (next !== s)
          change((current) => dropOnQuote(current, source, target), true);
        dragRef.current = null;
        setDragging(null);
        setDropAt(null);
      },
    };
  }
  function dragHandle(source: DragSource, name: string) {
    if (locked) return null;
    return (
      <span
        className="drag-handle"
        draggable
        title={`Glisser ${name} vers une pièce ou sur un autre produit`}
        aria-hidden="true"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", name);
          const row = e.currentTarget.parentElement;
          if (row) e.dataTransfer.setDragImage(row, 24, 24);
          dragRef.current = source;
          setDragging(source);
        }}
        onDragEnd={() => {
          dragRef.current = null;
          setDragging(null);
          setDropAt(null);
        }}
      />
    );
  }
  function prepare() {
    const valid = quoteSchema.safeParse(s);
    if (!valid.success) {
      setError(valid.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setModal("pdf");
  }
  // Les blocs du devis, assemblés différemment selon l'écran : colonne
  // de droite dans l'admin Shopify, espace de travail dans l'outil pro.
  const productsSection = (
            <s-section>
              <div className="section-toolbar">
                <span className="muted">Prix unitaires HTVA</span>
                <div>
                  <button onClick={() => setNewLot(true)}>
                    Ajouter une pièce
                  </button>
                  <button onClick={() => pick({ kind: "products" })}>
                    Ajouter des produits
                  </button>
                </div>
              </div>
              {!s.groups.length && (
                <div
                  className={`empty-state${dropAt === "vide" ? " drop-over" : ""}`}
                  {...dropProps("vide", {
                    kind: "section",
                    sectionId: "",
                    title: "",
                  })}
                >
                  <span className="empty-symbol">◇</span>
                  <h3>Composez votre proposition</h3>
                  <p>
                    Créez une pièce par espace du projet, ajoutez-y vos
                    produits, puis proposez des alternatives si nécessaire.
                  </p>
                  <button
                    className="primary"
                    onClick={() => pick({ kind: "products" })}
                  >
                    Choisir des produits
                  </button>
                </div>
              )}
              {sections.map((section) => (
                <div
                  className={`quote-lot${dropAt === `s:${section.id}` ? " drop-over" : ""}`}
                  id={`lot-${section.id}`}
                  key={section.id}
                  {...dropProps(`s:${section.id}`, {
                    kind: "section",
                    sectionId: section.id,
                    title: section.title,
                  })}
                >
                  <div className="lot-heading">
                    <input
                      aria-label={`Nom de la pièce ${section.title}`}
                      value={section.title}
                      maxLength={150}
                      onChange={(e) =>
                        change({
                          ...s,
                          groups: s.groups.map((g) =>
                            section.groups.some((x) => x.id === g.id)
                              ? {
                                  ...g,
                                  sectionId: section.id,
                                  section: e.target.value,
                                }
                              : g,
                          ),
                        })
                      }
                    />
                    <span>
                      {money(
                        section.groups.reduce(
                          (n, g) =>
                            n +
                            lineTotal(
                              g.items.find((i) => i.id === g.selected)!,
                            ),
                          0,
                        ),
                      )}{" "}
                      HTVA
                    </span>
                  </div>
                  {section.groups.length > 0 && (
                    <div className="line-head" aria-hidden="true">
                      <span>Produit</span>
                      <span>Qté</span>
                      <span>Prix HTVA</span>
                      <span>Remise %</span>
                      <span>Total HTVA</span>
                    </div>
                  )}
                  {section.groups.map((g) => (
                    <div
                      className={`alternative-group${dropAt === `g:${g.id}` ? " drop-over" : ""}${
                        alternativeFor === g.id ? " is-target" : ""
                      }${
                        dragging?.kind === "group" && dragging.groupId === g.id
                          ? " is-dragging"
                          : ""
                      }`}
                      key={g.id}
                      {...dropProps(`g:${g.id}`, {
                        kind: "group",
                        groupId: g.id,
                      })}
                    >
                      {g.items.map((i, n) => (
                        <div className="drag-row" key={i.id}>
                          {dragHandle(
                            n
                              ? { kind: "line", lineId: i.id }
                              : { kind: "group", groupId: g.id },
                            i.name,
                          )}
                          <ProductRow
                            line={i}
                            base={n ? g.items[0] : undefined}
                            selected={g.items.length > 1 && g.selected === i.id}
                            onSelect={
                              g.items.length > 1
                                ? () =>
                                    change({
                                      ...s,
                                      groups: s.groups.map((x) =>
                                        x.id === g.id
                                          ? { ...x, selected: i.id }
                                          : x,
                                      ),
                                    })
                                : undefined
                            }
                            onChange={(p) => patch(i.id, p)}
                            onRemove={() => remove(i.id)}
                          />
                        </div>
                      ))}
                      <div className="group-footer">
                        {alternativeFor === g.id ? (
                          <p className="alternative-hint" role="status">
                            Choisissez l’alternative dans le catalogue
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => onAlternative?.(null)}
                            >
                              Annuler
                            </button>
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="add-action"
                            onClick={() =>
                              onAlternative
                                ? onAlternative({
                                    group: g.id,
                                    name: g.items[0].name,
                                  })
                                : pick({ kind: "products", group: g.id })
                            }
                          >
                            Proposer une alternative
                          </button>
                        )}
                        <details>
                          <summary>Organiser</summary>
                          <div className="group-settings">
                            {g.items.length > 1 && (
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={!g.syncQty}
                                  onChange={(e) =>
                                    change({
                                      ...s,
                                      groups: s.groups.map((x) =>
                                        x.id === g.id
                                          ? {
                                              ...x,
                                              syncQty: !e.target.checked,
                                              items: e.target.checked
                                                ? x.items
                                                : x.items.map((i) => ({
                                                    ...i,
                                                    qty: x.items[0].qty,
                                                  })),
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                                Utiliser des quantités différentes
                              </label>
                            )}
                            <label>
                              Déplacer vers la pièce
                              <select
                                value={section.id}
                                onChange={(e) => {
                                  const target = sections.find(
                                    (x) => x.id === e.target.value,
                                  )!;
                                  change({
                                    ...s,
                                    groups: s.groups.map((x) =>
                                      x.id === g.id
                                        ? {
                                            ...x,
                                            sectionId: target.id,
                                            section: target.title,
                                          }
                                        : x,
                                    ),
                                  });
                                }}
                              >
                                {sections.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="button-row">
                              <button
                                disabled={s.groups[0].id === g.id}
                                onClick={() => move(g.id, -1)}
                              >
                                Monter
                              </button>
                              <button
                                disabled={s.groups.at(-1)!.id === g.id}
                                onClick={() => move(g.id, 1)}
                              >
                                Descendre
                              </button>
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>
                  ))}
                  <div className="lot-footer">
                    <button
                      className="add-action"
                      onClick={() =>
                        pick({ kind: "products", section: section.id })
                      }
                    >
                      Ajouter un produit
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="add-action"
                onClick={() => setCustom({ kind: "products" })}
              >
                Ajouter une ligne personnalisée
              </button>
            </s-section>
  );
  const optionsSection = (
            <s-section heading="Options et prestations">
              <div className="section-toolbar">
                <p className="muted">
                  Seules les options cochées sont comprises dans le total.
                </p>
                <div>
                  <button
                    onClick={() => pick({ kind: "products", extra: true })}
                  >
                    Option du catalogue
                  </button>
                  <button
                    onClick={() => setCustom({ kind: "products", extra: true })}
                  >
                    Prestation libre
                  </button>
                </div>
              </div>
              {!s.extras.some((e) => !e.deliveryFee) && (
                <p className="muted">
                  Installation, livraison, mobilier supplémentaire…
                </p>
              )}
              {s.extras
                .filter((e) => !e.deliveryFee)
                .map((e) => (
                  <div
                    className={`optional-row ${e.selected ? "" : "not-included"}`}
                    key={e.id}
                  >
                    <div className="card-title">
                      <label className="check">
                        <input
                          type="checkbox"
                          aria-label={`Inclure ${e.name}`}
                          checked={e.selected}
                          onChange={(ev) =>
                            change({
                              ...s,
                              extras: s.extras.map((x) =>
                                x.id === e.id
                                  ? { ...x, selected: ev.target.checked }
                                  : x,
                              ),
                            })
                          }
                        />
                        <strong>{e.name}</strong>
                      </label>
                      <span>{e.selected ? "Incluse" : "Non comprise"}</span>
                      <button
                        className="icon-button"
                        aria-label={`Retirer ${e.name}`}
                        onClick={() => remove(e.id)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="option-fields">
                      {!e.variantId && (
                        <label>
                          Mode de calcul
                          <select
                            value={
                              e.chargePercent === null ? "fixed" : "percent"
                            }
                            onChange={(ev) =>
                              patch(e.id, {
                                chargePercent:
                                  ev.target.value === "percent" ? 5 : null,
                              })
                            }
                          >
                            <option value="fixed">Montant fixe</option>
                            <option value="percent">
                              Pourcentage des produits
                            </option>
                          </select>
                        </label>
                      )}
                      {e.chargePercent === null ? (
                        <>
                          <label>
                            Quantité
                            <NumberField
                              aria-label={`Quantité ${e.name}`}
                              type="number"
                              min={1}
                              max={10000}
                              value={e.qty}
                              onChange={(ev) =>
                                patch(e.id, { qty: Number(ev.target.value) })
                              }
                            />
                          </label>
                          <label>
                            Prix HTVA
                            <NumberField
                              aria-label={`Prix ${e.name}`}
                              type="number"
                              min={0}
                              step=".01"
                              value={e.price / 100}
                              onChange={(ev) =>
                                patch(e.id, {
                                  price: Math.round(
                                    Number(ev.target.value) * 100,
                                  ),
                                  priceConfirmed: true,
                                })
                              }
                            />
                          </label>
                        </>
                      ) : (
                        <label>
                          Pourcentage
                          <NumberField
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={e.chargePercent}
                            onChange={(ev) =>
                              patch(e.id, {
                                chargePercent: Number(ev.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                      {e.chargePercent === null && (
                        <label>
                          Remise (%)
                          <NumberField
                            aria-label={`Remise ${e.name}`}
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={e.discount}
                            onChange={(ev) =>
                              patch(e.id, { discount: Number(ev.target.value) })
                            }
                          />
                        </label>
                      )}
                      <strong>{money(lineTotal(e))} HTVA</strong>
                    </div>
                    <details>
                      <summary>Description</summary>
                      {e.variantId ? (
                        <p className="preline">
                          {e.detail || "Aucune description dans Shopify."}
                        </p>
                      ) : (
                        <label>
                          Description
                          <textarea
                            value={e.detail}
                            maxLength={4000}
                            onChange={(ev) =>
                              patch(e.id, { detail: ev.target.value })
                            }
                          />
                        </label>
                      )}
                    </details>
                  </div>
                ))}
            </s-section>
  );
  const paymentSection = (
            <s-section heading="Paiement et livraison">
              <PaymentTerms state={s} onChange={change} />
              <details className="notes-details">
                <summary>Note visible sur le devis</summary>
                <textarea
                  aria-label="Note visible sur le devis"
                  value={s.note}
                  maxLength={4000}
                  onChange={(e) => field("note", e.target.value)}
                />
              </details>
            </s-section>
  );
  const historySection = showHistory && (
            <s-section heading="Historique">
              <div className="timeline">
                {q.revisions
                  .filter((r) => r.publishedNumber)
                  .map((r) => (
                    <div className="timeline-row" key={r.version}>
                      <div>
                        <strong>Révision {r.publishedNumber}</strong>
                        <small>
                          {r.issuedAt
                            ? new Date(r.issuedAt).toLocaleDateString("fr-BE")
                            : ""}
                          {r.sentAt ? " · Envoi déclaré" : ""}
                        </small>
                      </div>
                      {r.pdfGeneratedAt ? (
                        <button
                          disabled={busy}
                          onClick={() => download(r.version)}
                        >
                          PDF R{r.publishedNumber}
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => download(r.version)}
                        >
                          Préparer le fichier
                        </button>
                      )}
                      {!r.sentAt && r.pdfGeneratedAt && (
                        <button
                          disabled={busy || dirty}
                          onClick={() =>
                            send("sent", { version: String(r.version) })
                          }
                        >
                          Marquer comme envoyé
                        </button>
                      )}
                      {!locked && (
                        <button
                          disabled={busy || dirty}
                          onClick={() =>
                            send("restore", {
                              sourceVersion: String(r.version),
                            })
                          }
                        >
                          Reprendre cette version
                        </button>
                      )}
                    </div>
                  ))}
                {!q.revisions.some((r) => r.publishedNumber) && (
                  <p className="muted">Les versions PDF apparaîtront ici.</p>
                )}
                <details>
                  <summary>Sauvegardes de travail</summary>
                  {q.revisions.slice(0, 20).map((r) => (
                    <button
                      key={r.version}
                      disabled={busy || dirty || locked}
                      onClick={() =>
                        send("restore", { sourceVersion: String(r.version) })
                      }
                    >
                      Reprendre la sauvegarde du{" "}
                      {new Date(r.createdAt).toLocaleString("fr-BE")}
                    </button>
                  ))}
                </details>
              </div>
            </s-section>
  );
  const clientSection = (
          <s-section>
            <CustomerCard
              state={s}
              disabled={locked || busy}
              onEdit={() => {
                setClientDraft(draftFrom(s));
                setModal("client");
              }}
              onSearch={() => {
                if (!locked) pick({ kind: "customers" });
              }}
            />
          </s-section>
  );
  const summarySection = (
          <s-section heading="Récapitulatif">
            <QuoteSummary state={s} />
            <p className="muted summary-footnote">
              {ready && !dirty
                ? "Version conservée dans l’historique."
                : "Vérifiez l’aperçu avant de créer la version à transmettre."}
            </p>
          </s-section>
  );
  const shopifySection = admin && (
            <s-section heading="Shopify">
              {q.conversion?.status === "uncertain" && (
                <p role="alert" className="error">
                  {q.conversion.error ||
                    "Vérification requise avant toute nouvelle action."}
                </p>
              )}
              {q.conversion?.draftId ? (
                <>
                  <p>Commande {q.conversion.draftName}</p>
                  <a
                    href={`https://${shop}/admin/draft_orders/${q.conversion.draftId.split("/").at(-1)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir dans Shopify
                  </a>
                </>
              ) : (
                <p className="muted">
                  Quand votre client a choisi, créez la commande provisoire avec
                  les produits retenus.
                </p>
              )}
              {["creating", "uncertain"].includes(
                q.conversion?.status || "",
              ) ? (
                <button disabled={busy} onClick={() => send("reconcile")}>
                  Vérifier dans Shopify
                </button>
              ) : (
                !q.conversion?.draftId && (
                  <button
                    disabled={demo || busy || dirty || !ready || locked}
                    onClick={() => setModal("convert")}
                  >
                    Créer la commande provisoire
                  </button>
                )
              )}
              {demo && (
                <small className="muted">
                  Disponible après connexion à la boutique.
                </small>
              )}
            </s-section>
  );
  const coordinates = (
    <>
      {clientSection}
      <fieldset disabled={busy || locked} className="unframed">
        {paymentSection}
      </fieldset>
    </>
  );
  return (
    <main className={embedded ? "workspace" : "workspace quote-editor"}>
      <Link
        to="/app"
        className="back-link"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setModal("leave");
          }
        }}
      >
        ← Devis
      </Link>
      <header className="quote-header">
        <div>
          <div className="eyebrow">{q.number}</div>
          <h1 className="quote-title">
            <input
              aria-label="Nom du projet"
              value={s.project}
              maxLength={150}
              disabled={busy || locked}
              onChange={(e) => field("project", e.target.value)}
            />
          </h1>
          <div className="status-line">
            <s-badge tone={ready && !dirty ? "success" : "info"}>
              {dirty
                ? auto
                  ? "Enregistrement…"
                  : "Modifications non enregistrées"
                : commercialStatus(q)}
            </s-badge>
            {lastReady && lastReady.version !== q.version && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => download(lastReady.version)}
              >
                Dernier PDF · R{lastReady.publishedNumber}
              </button>
            )}
          </div>
        </div>
        <div className="header-actions">
          {q.status === "draft" && ready && !current?.sentAt && (
            <button disabled={busy || dirty} onClick={() => send("sent")}>
              Marquer comme envoyé
            </button>
          )}
          <details className="action-menu">
            <summary>Autres actions</summary>
            <div>
              <button
                disabled={busy || dirty}
                onClick={() => send("duplicate")}
              >
                {legacy ? "Créer une copie B2B" : "Dupliquer le devis"}
              </button>
              {ready && !locked && (
                <button
                  disabled={busy || dirty}
                  onClick={() => send("refresh-pdf")}
                >
                  Préparer une nouvelle version PDF
                </button>
              )}
              {!demo && !locked && (
                <button disabled={busy || dirty} onClick={() => send("photos")}>
                  Compléter les photos Shopify
                </button>
              )}
              <button onClick={() => setShowHistory(!showHistory)}>
                Afficher l’historique
              </button>
              {q.status === "deleted" ? (
                <button
                  disabled={busy || dirty}
                  onClick={() => send("restore-trash")}
                >
                  Restaurer depuis la corbeille
                </button>
              ) : q.status === "archived" ? (
                <button onClick={() => send("unarchive")}>
                  Restaurer le devis
                </button>
              ) : (
                <button
                  disabled={busy || dirty}
                  onClick={() => setModal("archive")}
                >
                  Archiver
                </button>
              )}
              {q.status !== "deleted" &&
                q.status !== "converted" &&
                !["creating", "uncertain", "complete"].includes(
                  q.conversion?.status || "",
                ) && (
                  <button
                    className="danger"
                    disabled={busy || dirty}
                    onClick={() => setModal("trash")}
                  >
                    Mettre à la corbeille
                  </button>
                )}
            </div>
          </details>
          <button
            disabled={busy}
            onClick={ready && !dirty ? () => download(q.version) : prepare}
            className="primary"
          >
            {working
              ? "Préparation…"
              : ready && !dirty
                ? "Télécharger le PDF"
                : "Préparer le PDF"}
          </button>
        </div>
      </header>
      {q.status === "draft" && ready && !dirty && (
        <p className="muted">
          {current?.sentAt
            ? `Envoi déclaré le ${new Date(current.sentAt).toLocaleDateString("fr-BE")}.`
            : "PDF prêt, pas encore déclaré envoyé. Après votre envoi par e-mail ou WhatsApp, cliquez sur « Marquer comme envoyé »."}
        </p>
      )}
      {demo && (
        <div className="demo-ribbon">
          Démonstration · catalogue fictif · aucune commande réelle
        </div>
      )}
      {(error || result?.error) && (
        <p role="alert" className="error">
          {error || result?.error}
        </p>
      )}
      {result?.ok && !dirty && (
        <p role="status" className="success">
          {result.ok}
        </p>
      )}
      {draft.recovery && (
        <div className="notice">
          Une saisie non enregistrée est disponible.
          <button onClick={draft.restore}>Restaurer la saisie</button>
          <button onClick={draft.ignore}>Ignorer</button>
        </div>
      )}
      {draft.undo && (
        <div role="status" className="undo-notice">
          Modification appliquée.
          <button className="text-button" onClick={draft.undo}>
            Annuler
          </button>
        </div>
      )}
      {legacy && (
        <div className="notice">
          Ancien devis conservé en lecture seule. Créez une copie B2B pour le
          modifier.
        </div>
      )}
      {!legacy && s.taxPolicy !== "BE21" && !locked && (
        <div className="notice">
          Ce devis utilise l’ancien réglage fiscal.{" "}
          <button
            onClick={() => {
              try {
                setPolicy(applyMikadoPolicy(s));
                setModal("policy");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Vérifier les prix à 21 %
          </button>
        </div>
      )}
      {embedded && !locked && (
        <SaveBar open={dirty}>
          <button
            variant="primary"
            disabled={busy}
            onClick={() => send("save")}
          ></button>
          <button disabled={busy} onClick={draft.discard}></button>
        </SaveBar>
      )}
      {auto && dirty && autoFailed.current === s && (
        <div className="save-strip">
          <span>Modifications non enregistrées</span>
          <div>
            <button disabled={busy} onClick={draft.discard}>
              Abandonner
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => send("save")}
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}
      {sections.length > 1 && (
        <nav className="lot-summary" aria-label="Sommaire des pièces">
          <strong>Vos pièces</strong>
          <div>
            {sections.map((section, index) => (
              <a key={section.id} href={`#lot-${section.id}`}>
                <span>
                  {index + 1}. {section.title}
                </span>
                <small>
                  {money(
                    section.groups.reduce(
                      (sum, group) =>
                        sum +
                        lineTotal(
                          group.items.find(
                            (item) => item.id === group.selected,
                          )!,
                        ),
                      0,
                    ),
                  )}{" "}
                  HTVA
                </small>
              </a>
            ))}
          </div>
        </nav>
      )}
      {embedded ? (
        <div className="editor-grid">
          <div className="editor-main">
            <fieldset disabled={busy || locked} className="unframed">
              {productsSection}
              {optionsSection}
              {paymentSection}
            </fieldset>
            {historySection}
          </div>
          <aside className="editor-sidebar">
            {clientSection}
            {summarySection}
            {shopifySection}
            {/* Facturation Odoo : écartée de l'outil pour l'instant (Cyril). */}
          </aside>
        </div>
      ) : (
        <div className={`editor-grid${pinned ? " is-pinned" : ""}`}>
          <div className="editor-main">
            {!pinned && (
              <details
                className="coords-band"
                open={coordsOpen}
                onToggle={(e) => setCoordsOpen(e.currentTarget.open)}
              >
                <summary>
                  <span className="coords-title">Client et conditions</span>
                  <span className="coords-line">
                    {[
                      s.client || "Client à compléter",
                      s.terms,
                      s.validity &&
                        `valable jusqu’au ${new Date(s.validity).toLocaleDateString("fr-BE")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </summary>
                <div className="coords-body">
                  {coordinates}
                  <button
                    type="button"
                    className="text-button coords-pin"
                    onClick={() => setPinned(true)}
                  >
                    Garder ouvert à droite
                  </button>
                </div>
              </details>
            )}
            <fieldset disabled={busy || locked} className="unframed">
              {productsSection}
              {optionsSection}
            </fieldset>
            {historySection}
            {!pinned && (
              <div className="recap" id="recapitulatif">
                {summarySection}
                {shopifySection}
              </div>
            )}
          </div>
          {pinned && (
            <aside className="editor-sidebar" id="recapitulatif">
              <div className="card-title sidebar-head">
                <span className="muted">Client et conditions</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPinned(false)}
                >
                  Replier dans le devis
                </button>
              </div>
              {coordinates}
              {summarySection}
              {shopifySection}
            </aside>
          )}
          <a className="total-bar" href="#recapitulatif">
            <span>Total HTVA</span>
            <strong>{money(fiscal.net)}</strong>
            <span className="total-bar-gross">TVAC {money(fiscal.gross)}</span>
          </a>
        </div>
      )}
      {picker && (
        <ProductPicker
          kind={picker.kind}
          onClose={() => setPicker(null)}
          onSelect={(items) => add(items, picker)}
        />
      )}
      {modal === "client" && (
        <Modal
          title={s.client ? "Client et adresses" : "Ajouter un client au devis"}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Ces coordonnées sont enregistrées dans le devis. Aucune fiche client
            Shopify n’est créée automatiquement.
          </p>
          <button
            disabled={locked}
            onClick={() => {
              setModal(null);
              pick({ kind: "customers" });
            }}
          >
            Rechercher un client Shopify
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // La facturation se saisit d'abord ; « même adresse » copie la
              // facturation vers la livraison (adresse de la commande Shopify).
              const d = withClientNames({
                ...clientDraft,
                shipping: clientDraft.billingSame
                  ? clientDraft.billing
                  : clientDraft.shipping,
              });
              change({
                ...s,
                firstName: d.firstName,
                lastName: d.lastName,
                company: d.company,
                client: d.client,
                contact: d.contact,
                email: d.email,
                customerId: d.customerId,
                customerVat: d.customerVat,
                shipping: d.shipping,
                billing: d.billingSame ? d.shipping : d.billing,
                billingSame: d.billingSame,
              });
              setModal(null);
            }}
          >
            <fieldset className="unframed" disabled={locked}>
              <div className="fields">
                {(
                  [
                    ["firstName", "Prénom", "given-name", false],
                    ["lastName", "Nom", "family-name", true],
                    ["company", "Société (facultatif)", "organization", false],
                  ] as const
                ).map(([k, label, auto, required]) => (
                  <label key={k}>
                    {label}
                    <input
                      type="text"
                      name={k}
                      autoComplete={auto}
                      required={required}
                      maxLength={150}
                      value={clientDraft[k]}
                      onChange={(e) =>
                        setClientDraft({ ...clientDraft, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <CustomerEmailAutocomplete
                  value={clientDraft.email}
                  disabled={locked}
                  onChange={(email) =>
                    setClientDraft({
                      ...clientDraft,
                      email,
                      customerId:
                        email === clientDraft.email
                          ? clientDraft.customerId
                          : null,
                    })
                  }
                  onSelect={(customer) =>
                    setClientDraft(fromCustomer(clientDraft, customer))
                  }
                />
                <label>
                  Numéro de TVA client
                  <input
                    type="text"
                    name="customerVat"
                    autoComplete="off"
                    maxLength={100}
                    value={clientDraft.customerVat}
                    onChange={(event) =>
                      setClientDraft({
                        ...clientDraft,
                        customerVat: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <h3>Adresse de facturation</h3>
              <AddressFields
                value={clientDraft.billing}
                onChange={(billing) =>
                  setClientDraft({ ...clientDraft, billing })
                }
              />
              <h3>Adresse de livraison</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={clientDraft.billingSame}
                  onChange={(e) =>
                    setClientDraft({
                      ...clientDraft,
                      billingSame: e.target.checked,
                      shipping: e.target.checked
                        ? clientDraft.shipping
                        : clientDraft.shipping.address1
                          ? clientDraft.shipping
                          : clientDraft.billing,
                    })
                  }
                />
                Livrer à l’adresse de facturation
              </label>
              {!clientDraft.billingSame && (
                <AddressFields
                  value={clientDraft.shipping}
                  onChange={(shipping) =>
                    setClientDraft({ ...clientDraft, shipping })
                  }
                />
              )}
              <footer className="modal-actions">
                <button type="button" onClick={() => setModal(null)}>
                  Annuler
                </button>
                <button className="primary">Appliquer</button>
              </footer>
            </fieldset>
          </form>
        </Modal>
      )}
      {custom && (
        <Modal
          title={
            custom.extra
              ? "Ajouter une prestation"
              : "Ajouter une ligne personnalisée"
          }
          onClose={() => setCustom(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const line = lineSchema.parse({
                id: crypto.randomUUID(),
                name: String(data.get("name")),
                detail: String(data.get("detail")),
                price: Math.round(Number(data.get("price")) * 100),
                qty: 1,
                discount: 0,
                vatRate: 21,
                requiresShipping: data.get("shipping") === "on",
              });
              add([line], custom);
              setCustom(null);
            }}
          >
            <label>
              Désignation
              <input name="name" required maxLength={250} />
            </label>
            <label>
              Prix HTVA
              <NumberField
                name="price"
                type="number"
                min={0}
                max={1000000}
                step=".01"
                required
              />
            </label>
            <label>
              Description
              <textarea name="detail" maxLength={4000} />
            </label>
            <label className="check">
              <input
                name="shipping"
                type="checkbox"
                defaultChecked={!custom.extra}
              />
              Article à livrer
            </label>
            <footer className="modal-actions">
              <button className="primary">Ajouter</button>
            </footer>
          </form>
        </Modal>
      )}
      {newLot && (
        <Modal title="Ajouter une pièce" onClose={() => setNewLot(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget),
                title = String(data.get("title")),
                id = crypto.randomUUID();
              setNewLot(false);
              pick({ kind: "products", section: id, sectionTitle: title });
            }}
          >
            <p className="muted">
              Nommez la pièce (salon, cuisine, chambre…), puis choisissez ses
              produits.
            </p>
            <label>
              Nom de la pièce
              <input
                name="title"
                required
                maxLength={150}
                placeholder="Ex. Terrasse"
              />
            </label>
            <footer className="modal-actions">
              <button className="primary">Choisir les produits</button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === "pdf" && (
        <Modal title="Préparer le PDF" wide onClose={() => setModal(null)}>
          <p>
            Vérifiez le client, les produits retenus et les conditions. Une
            nouvelle version sera conservée après validation des montants.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              disabled={locked}
              checked={!s.hideDiscounts}
              onChange={(e) => field("hideDiscounts", !e.target.checked)}
            />
            Montrer les remises au client
          </label>
          {s.hideDiscounts && (
            <p className="muted">
              Version client : prix publics sans remise, totaux recalculés. Le
              devis garde vos remises pour la commande.
            </p>
          )}
          {(error || result?.error) && (
            <p role="alert" className="error">
              {error || result?.error}
            </p>
          )}
          <div className="preview-scroll">
            <QuoteDocument
              state={s}
              number={q.number || String(q.id)}
              version={(current?.publishedNumber || 0) + 1}
              demo={demo}
            />
          </div>
          <footer className="modal-actions">
            <button onClick={() => setModal(null)}>Revenir au devis</button>
            <button
              className="primary"
              disabled={busy || locked || !fiscal.complete}
              onClick={() => send("prepare")}
            >
              {busy
                ? "Vérification et génération…"
                : ready && !dirty
                  ? "Vérifier cette version"
                  : "Créer la version PDF"}
            </button>
          </footer>
        </Modal>
      )}
      {modal === "policy" && policy && (
        <Modal
          title="Vérifier le passage à 21 %"
          onClose={() => setModal(null)}
        >
          <p>
            Les prix déjà HTVA sont conservés. Les prix source TVAC non
            confirmés sont divisés par 1,21. Les versions PDF précédentes
            restent inchangées.
          </p>
          <p>
            Avant : {money(fiscalTotals(s).gross)} TVAC · Après :{" "}
            {money(fiscalTotals(policy).gross)} TVAC
          </p>
          <button
            className="primary"
            onClick={() => {
              change(policy, true);
              setModal(null);
            }}
          >
            Appliquer au brouillon
          </button>
        </Modal>
      )}
      {modal === "leave" && (
        <Modal
          title="Quitter sans enregistrer ?"
          onClose={() => setModal(null)}
        >
          <p>
            Les modifications en cours ne seront pas enregistrées sur le
            serveur.
          </p>
          <footer className="modal-actions">
            <button onClick={() => setModal(null)}>Continuer le devis</button>
            <button
              onClick={() => {
                draft.discard();
                navigate("/app");
              }}
            >
              Quitter
            </button>
          </footer>
        </Modal>
      )}
      {modal === "trash" && (
        <Modal
          title="Mettre ce devis à la corbeille ?"
          onClose={() => setModal(null)}
        >
          <p>
            Le devis disparaîtra de la liste active. Vous pourrez le restaurer
            depuis la corbeille, avec ses PDF et son historique.
          </p>
          <button disabled={busy} onClick={() => send("trash")}>
            Mettre à la corbeille
          </button>
        </Modal>
      )}
      {modal === "archive" && (
        <Modal title="Archiver ce devis ?" onClose={() => setModal(null)}>
          <p>Vous pourrez le retrouver et le restaurer depuis les archives.</p>
          <button onClick={() => send("archive")}>Archiver</button>
        </Modal>
      )}
      {modal === "convert" && (
        <Modal
          title="Créer la commande provisoire Shopify"
          onClose={() => setModal(null)}
        >
          <p>
            {s.client} · {money(fiscal.gross)} TVAC. Seuls les produits et
            options retenus seront transférés. Aucun paiement ne sera déclenché.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              send("convert");
              setModal(null);
            }}
          >
            Créer la commande provisoire
          </button>
        </Modal>
      )}
    </main>
  );
}
