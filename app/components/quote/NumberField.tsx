import { useEffect, useState, type InputHTMLAttributes } from "react";

// Keep the edited text separate from the numeric model so clearing 0 stays empty.
export function NumberField({ value, onChange, onFocus, onBlur, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [text, setText] = useState(String(value ?? ""));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value ?? "")); }, [value, focused]);
  return <input {...props} value={text}
    onFocus={event => { setFocused(true); event.currentTarget.select(); onFocus?.(event); }}
    onChange={event => {
      let next = event.currentTarget.value.replace(/^0+(?=\d)/, "");
      if (props.step === 1 && next !== "" && Number.isFinite(Number(next))) next = String(Math.round(Number(next)));
      event.currentTarget.value = next;
      setText(next);
      onChange?.(event);
    }}
    onBlur={event => { setFocused(false); setText(String(value ?? "")); onBlur?.(event); }}
  />;
}
