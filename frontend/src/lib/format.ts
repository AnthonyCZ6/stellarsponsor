/** 1 XLM = 10^7 stroops, la unidad mínima de Stellar. */
export const XLM_DECIMALS = 7;
export const STROOPS_PER_XLM = 10n ** BigInt(XLM_DECIMALS);

const AMOUNT_PATTERN = new RegExp(`^\\d+(\\.\\d{1,${XLM_DECIMALS}})?$`);
const thousands = new Intl.NumberFormat("en-US");

/**
 * Convierte un monto escrito por el usuario ("12.5" o "12,5") a stroops.
 * Devuelve `null` si el formato es inválido o tiene más de 7 decimales.
 */
export function xlmToStroops(input: string): bigint | null {
  const value = input.trim().replace(",", ".");
  if (!AMOUNT_PATTERN.test(value)) return null;

  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(XLM_DECIMALS, "0"));
}

/** Formatea stroops como XLM legible, p. ej. `18500000000n` → `"1,850"`. */
export function formatXlm(stroops: bigint, maxFractionDigits = 2): string {
  const sign = stroops < 0n ? "-" : "";
  const abs = stroops < 0n ? -stroops : stroops;

  const whole = thousands.format(abs / STROOPS_PER_XLM);
  const fraction = (abs % STROOPS_PER_XLM)
    .toString()
    .padStart(XLM_DECIMALS, "0")
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "");

  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Porcentaje de avance con 2 decimales (puede superar 100). */
export function progressPercent(current: bigint, target: bigint): number {
  if (target <= 0n) return 0;
  return Number((current * 10_000n) / target) / 100;
}

/** Recorta una dirección Stellar: `GABCD...WXYZ`. */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}
