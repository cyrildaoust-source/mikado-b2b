import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// Sur Vercel, le preset découpe le serveur en fonctions ; ailleurs (Docker, Mac),
// le build reste celui de react-router-serve.
export default {
  ssr: true,
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
