import { useRouteLoaderData } from "react-router";
import { money } from "../domain/quote";
import { proPrice, type ProPricing } from "../domain/pro";

/** Remise pro du compte, lue dans la barre du haut (routes/app). */
export function useProPricing(): ProPricing | null {
  const data = useRouteLoaderData("routes/app") as
    | { pro?: ProPricing | null }
    | undefined;
  return data?.pro ?? null;
}

/**
 * Prix pro sous le prix public, quand l'architecte a choisi de l'afficher.
 * Affichage seul : le devis et son PDF restent au prix public.
 */
export function ProPrice({
  cents,
  from = false,
  className = "",
  label = "Pro",
}: {
  cents: number;
  from?: boolean;
  className?: string;
  label?: string;
}) {
  const pro = useProPricing();
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
