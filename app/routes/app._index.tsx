import {
  useLoaderData,
  useActionData,
  type LoaderFunctionArgs,
} from "react-router";
import { context, ownerScope } from "../services/context.server";
import { loadDashboard } from "../services/dashboard.server";
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
  return {
    kind: "dashboard" as const,
    dashboard: await loadDashboard(c.shop, ownerScope(c), c.admin, c.demo),
    name: c.demo ? "" : firstName(c.user?.name),
    admin: c.user?.role === "admin",
    demo: c.demo,
  };
}

export default function Home() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  if (data.kind === "list") return <Quotes />;
  return (
    <DashboardView
      data={data.dashboard}
      name={data.name}
      admin={data.admin}
      demo={data.demo}
      error={result && "error" in result ? result.error : undefined}
    />
  );
}
