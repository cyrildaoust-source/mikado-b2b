export const operations = {
  shop: "query Shop { shop { name currencyCode taxesIncluded } }",
  products:
    "query Products($query:String,$after:String) { productVariants(first:20,query:$query,after:$after) { nodes { id displayName sku taxable price product { description featuredMedia { preview { image { url } } } } image { url } } pageInfo { hasNextPage endCursor } } }",
  variants:
    "query Variants($ids:[ID!]!) { nodes(ids:$ids) { ... on ProductVariant { id displayName sku taxable price product { description featuredMedia { preview { image { url } } } } image { url } } } }",
  customers:
    "query Customers($query:String,$after:String) { customers(first:20,query:$query,after:$after) { nodes { id displayName defaultEmailAddress { emailAddress } defaultAddress { address1 address2 city zip countryCodeV2 company firstName lastName } } pageInfo { hasNextPage endCursor } } }",
  calculate:
    "mutation Calculate($input:DraftOrderInput!) { draftOrderCalculate(input:$input) { calculatedDraftOrder { totalPriceSet { presentmentMoney { amount currencyCode } } totalTaxSet { presentmentMoney { amount currencyCode } } subtotalPriceSet { presentmentMoney { amount currencyCode } } taxesIncluded taxLines { rate title priceSet { presentmentMoney { amount currencyCode } } } lineItems { uuid quantity discountedTotalSet { presentmentMoney { amount currencyCode } } } } userErrors { field message } } }",
  create:
    "mutation Create($input:DraftOrderInput!) { draftOrderCreate(input:$input) { draftOrder { id name totalPriceSet { presentmentMoney { amount currencyCode } } } userErrors { field message } } }",
  inspectDraft:
    "query InspectDraft($id:ID!,$after:String) { draftOrder(id:$id) { id name totalPriceSet { presentmentMoney { amount currencyCode } } totalTaxSet { presentmentMoney { amount currencyCode } } lineItems(first:100,after:$after) { nodes { uuid quantity variant { id } discountedTotalSet { presentmentMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } } } }",
  recover:
    "query Recover($query:String!) { draftOrders(first:2,query:$query) { nodes { id name } } }",
};
