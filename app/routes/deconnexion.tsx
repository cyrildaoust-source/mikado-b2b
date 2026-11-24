import { redirect, type ActionFunctionArgs } from "react-router";
import { isStandalone } from "../services/mode.server";
import { assertSameOrigin, logout } from "../services/auth.server";

export async function loader() {
  return redirect("/app");
}

export async function action({ request }: ActionFunctionArgs) {
  if (!isStandalone()) return redirect("/app");
  assertSameOrigin(request);
  return logout(request);
}
