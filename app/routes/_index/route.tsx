import { redirect, type LoaderFunctionArgs } from "react-router";
import { isStandalone } from "../../services/mode.server";
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (isStandalone() && !url.search) return redirect("/app");
  return redirect(`/app${url.search}`);
}
export default function Index() {
  return null;
}
