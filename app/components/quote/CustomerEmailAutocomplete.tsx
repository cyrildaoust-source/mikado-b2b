import { useEffect, useRef, useState } from "react";
import type { Customer } from "./ProductPicker";

export function CustomerEmailAutocomplete({
  value,
  disabled,
  onChange,
  onSelect,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
}) {
  const [items, setItems] = useState<Customer[]>([]);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const seq = useRef(0);
  const query = value.trim();

  useEffect(() => {
    if (!focused || query.length < 2) {
      setItems([]);
      setBusy(false);
      setError(false);
      return;
    }
    const current = ++seq.current;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError(false);
      try {
        const url = new URL("/app/catalog", location.origin);
        url.searchParams.set("kind", "customers");
        url.searchParams.set("q", query);
        const response = await fetch(url);
        if (!response.ok) throw Error();
        const data = (await response.json()) as { items: Customer[] };
        if (seq.current === current)
          setItems(data.items.filter((customer) => customer.email).slice(0, 6));
      } catch {
        if (seq.current === current) setError(true);
      } finally {
        if (seq.current === current) setBusy(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      seq.current++;
    };
  }, [focused, query]);

  const show = focused && query.length >= 2;
  return (
    <div className="email-autocomplete">
      <label>
        E-mail
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          disabled={disabled}
          value={value}
          aria-autocomplete="list"
          aria-expanded={show && (busy || error || items.length > 0)}
          aria-controls="customer-email-suggestions"
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setFocused(false);
          }}
        />
      </label>
      {show && (busy || error || items.length > 0) && (
        <div
          id="customer-email-suggestions"
          className="email-suggestions"
          role="listbox"
          aria-label="Clients Shopify suggérés"
        >
          {busy && <p role="status">Recherche dans Shopify…</p>}
          {!busy && error && (
            <p role="alert">Suggestions Shopify indisponibles.</p>
          )}
          {!busy &&
            !error &&
            items.map((customer) => (
              <button
                type="button"
                role="option"
                key={customer.id || customer.email}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(customer);
                  setFocused(false);
                }}
              >
                <span>
                  <strong>{customer.email}</strong>
                  <small>
                    {customer.address.company || customer.name}
                    {customer.address.city ? ` · ${customer.address.city}` : ""}
                  </small>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
