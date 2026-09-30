import { Address, Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { STROOPS_PER_XLM } from "./format";
import { DEMO_CAMPAIGN, applyDonation, parseCampaign, readableError } from "./stellar";

/** Codifica una campaña igual que el contrato: struct → ScMap, enum unitario → Vec[Symbol]. */
function encodeCampaign(creator: string, status: "Active" | "Completed") {
  return nativeToScVal(
    {
      creator: new Address(creator),
      current_amount: 1_850n * STROOPS_PER_XLM,
      status: nativeToScVal([status], { type: ["symbol"] }),
      target_amount: 5_000n * STROOPS_PER_XLM,
      title: "Biblioteca comunitaria",
    },
    {
      type: {
        creator: ["symbol", null],
        current_amount: ["symbol", "i128"],
        status: ["symbol", null],
        target_amount: ["symbol", "i128"],
        title: ["symbol", "string"],
      },
    },
  );
}

describe("parseCampaign", () => {
  it("decodifica el resultado de get_campaign", () => {
    const creator = Keypair.random().publicKey();
    const native = scValToNative(encodeCampaign(creator, "Active"));

    expect(parseCampaign(native)).toEqual({
      creator,
      title: "Biblioteca comunitaria",
      targetAmount: 5_000n * STROOPS_PER_XLM,
      currentAmount: 1_850n * STROOPS_PER_XLM,
      status: "Active",
    });
  });

  it("reconoce el estado Completed", () => {
    const native = scValToNative(encodeCampaign(Keypair.random().publicKey(), "Completed"));

    expect(parseCampaign(native).status).toBe("Completed");
  });
});

describe("applyDonation", () => {
  it("suma el monto y mantiene la campaña activa bajo la meta", () => {
    const updated = applyDonation(DEMO_CAMPAIGN, 100n * STROOPS_PER_XLM);

    expect(updated.currentAmount).toBe(1_950n * STROOPS_PER_XLM);
    expect(updated.status).toBe("Active");
  });

  it("marca la campaña como completada al alcanzar la meta", () => {
    const updated = applyDonation(DEMO_CAMPAIGN, 3_150n * STROOPS_PER_XLM);

    expect(updated.currentAmount).toBe(DEMO_CAMPAIGN.targetAmount);
    expect(updated.status).toBe("Completed");
  });

  it("no muta la campaña original", () => {
    applyDonation(DEMO_CAMPAIGN, STROOPS_PER_XLM);

    expect(DEMO_CAMPAIGN.currentAmount).toBe(1_850n * STROOPS_PER_XLM);
  });
});

describe("readableError", () => {
  it("traduce los códigos de error del contrato", () => {
    expect(readableError(new Error("HostError: Error(Contract, #6)\n..."))).toBe(
      "La campaña ya alcanzó su meta y no acepta más donaciones.",
    );
    expect(readableError("Error(Contract, #99)")).toBe("El contrato devolvió el error #99.");
  });

  it("traduce el saldo insuficiente del contrato de XLM (#10)", () => {
    expect(readableError(new Error("HostError: Error(Contract, #10)"))).toMatch(/^Saldo insuficiente/);
    expect(readableError("balance is not sufficient to spend: 5 < 10")).toMatch(/^Saldo insuficiente/);
  });

  it("explica cuándo la cuenta no está fondeada", () => {
    expect(readableError(new Error("Account not found: GABC"))).toMatch(/Friendbot/);
  });

  it("recorta mensajes muy largos", () => {
    const message = readableError(new Error("x".repeat(500)));

    expect(message).toHaveLength(241);
    expect(message.endsWith("…")).toBe(true);
  });
});
