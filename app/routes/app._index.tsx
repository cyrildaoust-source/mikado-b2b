import {
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import { loadDashboard } from "../services/dashboard.server";
import {
  acceptedVolumes,
  architectStatus,
  listClasses,
} from "../services/classes.server";
import { classStatus } from "../domain/dashboard";
import { firstName } from "../domain/dashboard";
import { DashboardView } from "../components/dashboard/Dashboard";
import Quotes, { loader as quotesLoader, action } from "./app.devis";

// Accueil. Outil pro : le tableau de bord du compte. Dans l'admin Shopify,
// l'accueil reste la liste des devis, comme avant.
export { action };
export const meta = () => [{ title: "Accueil · Mikado Deco Pro" }];

export async function loader(args: LoaderFunctionArgs) {
  const c = await context(args.request);
  if (c.embedded)
    return { kind: "list" as const, ...(await quotesLoader(args)) };
  const architect = c.user && c.user.role !== "admin" ? c.user : null;
  return {
    kind: "dashboard" as const,
    dashboard: await loadDashboard(c.shop, ownerScope(c), c.admin, c.demo),
    // Classe et remise : pour une architecte, et en démo pour voir le bloc.
    tier: architect
      ? await architectStatus(c.shop, architect.id)
      : c.demo
        ? await demoStatus(c.shop)
        : null,
    name: c.demo ? "" : firstName(c.user?.name),
    admin: c.user?.role === "admin",
    demo: c.demo,
  };
}

/** Démo : les classes de la base locale, avec le chiffre de tous les devis. */
async function demoStatus(shop: string) {
  const classes = await listClasses();
  if (!classes.length) return null;
  let volume = 0;
  for (const v of (
    await acceptedVolumes(shop, null, new Date(), true)
  ).values())
    volume += v;
  return classStatus(classes, null, volume);
}

export default function Home() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  if (data.kind === "list") return <Quotes />;
  return (
    <DashboardView
      data={data.dashboard}
      name={data.name}
      tier={data.tier}
      admin={data.admin}
      demo={data.demo}
      error={result && "error" in result ? result.error : undefined}
    />
  );
}
