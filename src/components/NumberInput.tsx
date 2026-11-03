import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  /** Current value. Works with numeric state (0, 40) and with text state ("", "40"). */
  value: number | string;
  /** `n` is the number (empty counts as 0). `raw` is the cleaned text, for fields that keep text state. */
  onChange: (n: number, raw: string) => void;
};

/** "040" -> "40", "00" -> "0", "-05" -> "-5". Leaves "0", "0.5" and "10" alone. */
const clean = (raw: string) => raw.replace(/^(-?)0+(?=\d)/, "$1");

/**
 * A number field that behaves the way people expect:
 *  - clicking or tabbing into it selects the old value, so typing replaces it (0 becomes 40, 40 becomes 0);
 *  - leading zeros never appear (no "040").
 */
export default function NumberInput({ value, onChange, onFocus, onBlur, onMouseUp, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  const justFocused = useRef(false);

  // Follow changes made from outside (e.g. "Reset to saved team"), but never fight the user mid-typing.
  useEffect(() => {
    const ext = String(value);
    const same =
      ext === text ||
      (ext !== "" && text !== "" && Number(ext) === Number(text)) ||
      (text === "" && typeof value === "number" && value === 0); // field cleared while typing
    if (!same) setText(ext);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const c = clean(e.target.value);
        setText(c);
        onChange(c === "" ? 0 : Number(c), c);
      }}
      onFocus={(e) => {
        justFocused.current = true;
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onMouseUp={(e) => {
        // Stop the click that focused the field from dropping the selection again.
        if (justFocused.current) e.preventDefault();
        justFocused.current = false;
        onMouseUp?.(e);
      }}
      onBlur={(e) => {
        justFocused.current = false;
        // A numeric field left empty shows its real value (0) again.
        if (text === "" && typeof value === "number") setText(String(value));
        onBlur?.(e);
      }}
    />
  );
}
