"""Server-only XML-RPC bridge, same protocol as the existing odoo-tools connector.
No posting, payment registration, email or Shopify mutation is allowed here.
Credentials are inherited from the server environment, never passed on the command line.
"""
import json
import os
import re
import socket
import sys
import xmlrpc.client
from urllib.parse import urlparse

READ_MODELS = {"account.move", "account.move.line", "res.partner", "res.company", "account.journal", "account.tax", "account.account", "res.currency", "res.country"}

PARTNER_FIELDS = {
    "name", "is_company", "company_type", "customer_rank", "vat", "email",
    "street", "street2", "zip", "city", "country_id", "company_id"
}

def valid_partner_create(args):
    if not args or not isinstance(args[0], dict):
        return False
    values = args[0]
    vat = str(values.get("vat", "")).replace(" ", "").upper()
    return (
        set(values) <= PARTNER_FIELDS
        and bool(str(values.get("name", "")).strip())
        and values.get("is_company") is True
        and values.get("company_type") == "company"
        and values.get("customer_rank") == 1
        and vat.startswith("BE")
        and vat[2:].isdigit()
        and len(vat) == 12
        and isinstance(values.get("country_id"), int)
        and isinstance(values.get("company_id"), int)
    )

def valid_invoice_payment_reference_write(args):
    if (
        len(args) != 2
        or not isinstance(args[0], list)
        or len(args[0]) != 1
        or not isinstance(args[0][0], int)
        or args[0][0] <= 0
        or not isinstance(args[1], dict)
        or set(args[1]) != {"payment_reference"}
    ):
        return False
    value = args[1]["payment_reference"]
    return isinstance(value, str) and bool(re.fullmatch(
        r"(Acompte|Avant livraison|Après livraison|Solde) devis (MD-\d{4}-\d{4}|\d+)",
        value,
    ))

def main():
    payload = json.load(sys.stdin)
    model, method = payload["model"], payload["method"]
    if not (
        (model in READ_MODELS and method in {"search_read", "read"})
        or (model == "account.move" and method == "create")
        or (model == "account.move" and method == "write" and valid_invoice_payment_reference_write(payload.get("args", [])))
        or (model == "res.partner" and method == "create")
    ):
        raise ValueError("Operation interdite")
    url = os.environ["ODOO_URL"].rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("URL Odoo HTTPS requise")
    db, login, key = [os.environ[k] for k in ["ODOO_DB", "ODOO_LOGIN", "ODOO_API_KEY"]]
    socket.setdefaulttimeout(25)
    common = xmlrpc.client.ServerProxy(url + "/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(db, login, key, {})
    if not uid:
        raise ValueError("Authentification refusee")
    models = xmlrpc.client.ServerProxy(url + "/xmlrpc/2/object", allow_none=True)
    args = payload.get("args", [])
    if model == "account.move" and method == "create" and (not args or args[0].get("move_type") != "out_invoice" or args[0].get("state", "draft") != "draft"):
        raise ValueError("Brouillons clients uniquement")
    if model == "account.move" and method == "write":
        existing = models.execute_kw(db, uid, key, "account.move", "read", [args[0]], {"fields": ["state", "move_type"]})
        if len(existing) != 1 or existing[0].get("state") != "draft" or existing[0].get("move_type") != "out_invoice":
            raise ValueError("Communication modifiable sur un brouillon client uniquement")
    if model == "res.partner" and method == "create" and not valid_partner_create(args):
        raise ValueError("Creation de contact refusee")
    result = models.execute_kw(db, uid, key, model, method, args, payload.get("kwargs", {}))
    print(json.dumps({"result": result}))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Odoo faults can contain credentials, addresses or invoice details. Never echo them.
        print(json.dumps({"error": "Odoo indisponible ou requete refusee. Verifiez la connexion et les droits."}))
        sys.exit(1)
