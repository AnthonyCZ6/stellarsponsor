import { describe, expect, it } from "vitest";
import {
  STROOPS_PER_XLM,
  formatXlm,
  progressPercent,
  shortenAddress,
  xlmToStroops,
} from "./format";

describe("xlmToStroops", () => {
  it("convierte enteros y decimales a stroops", () => {
    expect(xlmToStroops("1")).toBe(10_000_000n);
    expect(xlmToStroops("12.5")).toBe(125_000_000n);
    expect(xlmToStroops("0.0000001")).toBe(1n);
    expect(xlmToStroops("5000")).toBe(5_000n * STROOPS_PER_XLM);
  });

  it("acepta coma decimal y espacios alrededor", () => {
    expect(xlmToStroops(" 12,5 ")).toBe(125_000_000n);
  });

  it("no pierde precisión con montos grandes", () => {
    expect(xlmToStroops("922337203685.4775807")).toBe(9_223_372_036_854_775_807n);
  });

  it("rechaza formatos inválidos", () => {
    for (const input of ["", " ", "abc", "-1", "1e3", "1.", ".5", "1.2.3", "1.00000001"]) {
      expect(xlmToStroops(input), input).toBeNull();
    }
  });
});

describe("formatXlm", () => {
  it("agrupa miles y recorta a 2 decimales por defecto", () => {
    expect(formatXlm(18_500_000_000n)).toBe("1,850");
    expect(formatXlm(12_345_678_901n)).toBe("1,234.56");
    expect(formatXlm(0n)).toBe("0");
  });

  it("respeta el máximo de decimales y quita ceros finales", () => {
    expect(formatXlm(1n, 7)).toBe("0.0000001");
    expect(formatXlm(125_000_000n, 7)).toBe("12.5");
  });

  it("formatea valores negativos", () => {
    expect(formatXlm(-15_000_000n)).toBe("-1.5");
  });
});

describe("progressPercent", () => {
  it("calcula el porcentaje con 2 decimales", () => {
    expect(progressPercent(1_850n, 5_000n)).toBe(37);
    expect(progressPercent(1n, 3n)).toBe(33.33);
  });

  it("puede superar 100 y tolera meta cero", () => {
    expect(progressPercent(110n, 100n)).toBe(110);
    expect(progressPercent(10n, 0n)).toBe(0);
  });
});

describe("shortenAddress", () => {
  it("recorta direcciones largas", () => {
    expect(shortenAddress("GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW")).toBe(
      "GABCD...TUVW",
    );
  });

  it("deja intactas las cadenas cortas", () => {
    expect(shortenAddress("GABC")).toBe("GABC");
  });
});
