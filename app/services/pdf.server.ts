import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import db from "../db.server";
import { getQuote } from "./quotes.server";
import { quoteSchema, reference } from "../domain/quote";
import { QuoteDocument } from "../components/QuoteDocument";
import legacyCss from "../styles/legacy-document.css?raw";
import css from "../styles/document.css?raw";
const embeddedCss = css
  .replaceAll(
    "/fonts/inter-400.woff2",
    `data:font/woff2;base64,${readFileSync(resolve("public/fonts/inter-400.woff2")).toString("base64")}`,
  )
  .replaceAll(
    "/fonts/inter-700.woff2",
    `data:font/woff2;base64,${readFileSync(resolve("public/fonts/inter-700.woff2")).toString("base64")}`,
  );
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
async function generatePdf(shop: string, id: number, version: number) {
  const q = await getQuote(shop, id);
  const r = await db.revision.findUnique({
    where: { quoteId_version: { quoteId: id, version } },
  });
  if (!r) throw new Response("Version introuvable", { status: 404 });
  const number = q.number || reference(id, q.createdAt);
  const fileVersion = r.publishedNumber
    ? `R${r.publishedNumber}`
    : `v${version}`;
  if (r.pdf) return { bytes: Buffer.from(r.pdf), number, fileVersion };
  const state = quoteSchema.parse(JSON.parse(r.state));
  const seller = r.documentMeta ? JSON.parse(r.documentMeta) : undefined;
  if (state.schemaVersion === 2 && !r.publishedNumber)
    throw new Response("Figez le devis avant téléchargement.", { status: 409 });
  const markup = renderToStaticMarkup(
    createElement(QuoteDocument, {
      state,
      seller,
      issuedAt: r.issuedAt,
      calculation: r.calculation ? JSON.parse(r.calculation) : null,
      number,
      version: r.publishedNumber || version,
      demo: shop === "demo.local",
    }),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const deadline = setTimeout(() => {
    void browser.close().catch(() => {});
  }, 45000);
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      try {
        const u = new URL(route.request().url());
        return u.protocol === "https:" && u.hostname === "cdn.shopify.com"
          ? route.continue()
          : route.abort();
      } catch {
        return route.abort();
      }
    });
    await page.setContent(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${state.schemaVersion === 1 ? legacyCss : embeddedCss}</style></head><body>${markup}</body></html>`,
      { waitUntil: "networkidle", timeout: 20000 },
    );
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-family:Arial,sans-serif;font-size:8px;width:100%;margin:0 55px;text-align:right">${number}</div>`,
      footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:7px;width:100%;margin:0 55px;display:flex;justify-content:space-between;gap:12px"><span>${[
        seller?.name || "Mikado Deco",
        seller?.address || "Rue du Doyenné 75",
        seller?.email || "shop@mikadodeco.be",
        seller?.website || "shop.mikadodeco.be",
      ]
        .map((value) => escapeHtml(String(value)))
        .join(" · ")}</span><span><span class="pageNumber"></span> sur <span class="totalPages"></span></span></div>`,
      margin: { top: "15mm", bottom: "18mm", left: "15mm", right: "15mm" },
    });
    await db.revision.updateMany({
      where: { id: r.id, pdf: null },
      data: { pdf: new Uint8Array(bytes), pdfGeneratedAt: new Date() },
    });
    const frozen = await db.revision.findUniqueOrThrow({ where: { id: r.id } });
    return { bytes: Buffer.from(frozen.pdf!), number, fileVersion };
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}

let tail: Promise<unknown> = Promise.resolve();
const pending = new Map<
  string,
  Promise<Awaited<ReturnType<typeof generatePdf>>>
>();
export async function quotePdf(shop: string, id: number, version: number) {
  const key = `${shop}:${id}:${version}`;
  if (pending.has(key)) return pending.get(key)!;
  if (pending.size >= 6)
    throw new Response(
      "Plusieurs PDF sont en cours. Réessayez dans quelques instants.",
      { status: 503 },
    );
  const job = tail.catch(() => {}).then(() => generatePdf(shop, id, version));
  tail = job;
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
