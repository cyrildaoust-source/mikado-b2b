import { useRouteLoaderData } from "react-router";
import { money } from "../domain/quote";
import {
  proPrice,
  viewPrice,
  type PriceView,
  type ProPricing,
} from "../domain/pro";

type AppData = { pro?: ProPricing | null; view?: PriceView } | undefined;

/** Remise pro du compte, lue dans la barre du haut (routes/app). */
export function useProPricing(): ProPricing | null {
  const data = useRouteLoaderData("routes/app") as AppData;
  return data?.pro ?? null;
}

/** Prix affiché choisi dans la barre du haut. */
export function usePriceView(): PriceView {
  const data = useRouteLoaderData("routes/app") as AppData;
  return data?.view ?? "htva";
}

/**
 * Prix d'un produit du catalogue dans la vue choisie (HTVA, pro, TVAC), avec
 * sa nature dessous. Le montant change, la place reste la même.
 */
export function CataloguePrice({
  cents,
  from = false,
  className = "",
}: {
  cents: number;
  from?: boolean;
  className?: string;
}) {
  const shown = viewPrice(cents, usePriceView(), useProPricing());
  return (
    <span className={`shown-price ${className}`}>
      <span className="shown-price-amount">
        {from ? "dès " : ""}
        {money(shown.cents)}
      </span>
      <small className={`shown-price-kind${shown.pending ? " pending" : ""}`}>
        {shown.kind}
      </small>
    </span>
  );
}

/**
 * Prix pro sous le prix public. Dans l'éditeur de devis (`always`), il est
 * toujours là : c'est le prix d'achat de l'architecte chez Mikado Deco
 * (Cyril, 26/11/2026). Jamais dans le PDF ni sur la page du client.
 */
export function ProPrice({
  cents,
  from = false,
  className = "",
  label = "Pro",
  always = false,
}: {
  cents: number;
  from?: boolean;
  className?: string;
  label?: string;
  always?: boolean;
}) {
  const found = useProPricing();
  const pro = found && always ? { ...found, show: true } : found;
  if (!pro) return null;
  // Option coupée : la place reste réservée, la page ne bouge pas à la bascule.
  if (!pro.show)
    return (
      <small className={`pro-price placeholder ${className}`} aria-hidden="true">
        {label} {from ? "dès " : ""}
        {money(cents)}
      </small>
    );
  if (pro.discount === null)
    return (
      <small className={`pro-price pending ${className}`}>Prix pro à confirmer</small>
    );
  return (
    <small className={`pro-price ${className}`}>
      {label} {from ? "dès " : ""}
      {money(proPrice(cents, pro.discount))}
    </small>
  );
}
