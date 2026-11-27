import test from "node:test";
import assert from "node:assert/strict";
import { emptyQuote, fiscalTotals, lineSchema, setDeliveryFee } from "../app/domain/quote";
import { clientQuote, fromClientQuote } from "../app/domain/client-quote";
import { applyChoices } from "../app/domain/proposal";

test("lien client : liste blanche, sans identifiants Shopify ni données internes", () => {
  let s = emptyQuote();
  s.client = "Anne Dupont";
  s.email = "anne@example.be";
  s.customerId = "gid://shopify/Customer/42";
  s.customerVat = "BE0123456789";
  s.shipping = { ...s.shipping, address1: "Rue secrète 1" };
  s.groups = [
    {
      id: "g", section: "Salon", sectionId: "s", selected: "a", syncQty: true,
      items: [
        lineSchema.parse({
          id: "a", name: "Canapé", sku: "INT-SKU-9", qty: 2, price: 100000, discount: 10, vatRate: 21,
          variantId: "gid://shopify/ProductVariant/77", sourcePrice: 121000,
          sourceIncludesTax: true, sourceVatRate: 21, family: "Canapés",
        }),
      ],
    },
  ];
  s = setDeliveryFee(s, true, "liv", 5);
  const sent = JSON.stringify(clientQuote(s));
  for (const secret of ["gid://", "INT-SKU-9", "121000", "anne@example.be", "BE0123456789", "Rue secrète", "Canapés", "sourcePrice", "variantId", "customerId"])
    assert.ok(!sent.includes(secret), `fuite : ${secret}`);
  // Les montants du client restent exacts.
  const back = fromClientQuote(JSON.parse(sent));
  assert.deepEqual(
    fiscalTotals(applyChoices(back, {})),
    fiscalTotals(applyChoices(s, {})),
  );
});
