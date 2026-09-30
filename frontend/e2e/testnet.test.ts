/**
 * Prueba end-to-end contra Stellar Testnet.
 *
 * Despliega el Wasm compilado, inicializa una campaña y ejercita el mismo código que usa la
 * dApp (`fetchCampaign`, `fetchBalance` y `donate` de src/lib/stellar.ts), comprobando que el
 * XLM llega realmente al creador. Freighter se reemplaza por un keypair de prueba fondeado con
 * Friendbot.
 *
 * Requisitos: compilar antes el contrato
 *   cd contracts && cargo build --target wasm32-unknown-unknown --release
 * o indicar otra ruta con la variable WASM_PATH.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";

const RPC_URL = "https://soroban-testnet.stellar.org";
const XLM = 10_000_000n;
const WASM_PATH =
  process.env.WASM_PATH ??
  fileURLToPath(
    new URL(
      "../../contracts/target/wasm32-unknown-unknown/release/stellar_sponsor.wasm",
      import.meta.url,
    ),
  );

// Billetera simulada: firma con la clave secreta del donante de prueba.
const wallet = vi.hoisted(() => ({ secret: "" }));

vi.mock("@stellar/freighter-api", async () => {
  const { Keypair, Networks, TransactionBuilder } = await import("@stellar/stellar-sdk");
  return {
    getNetworkDetails: async () => ({
      network: "TESTNET",
      networkUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: Networks.TESTNET,
    }),
    signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
      const keypair = Keypair.fromSecret(wallet.secret);
      const tx = TransactionBuilder.fromXDR(txXdr, opts?.networkPassphrase ?? Networks.TESTNET);
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR(), signerAddress: keypair.publicKey() };
    },
  };
});

const server = new rpc.Server(RPC_URL);

/** Prepara, firma, envía y espera una operación Soroban. Devuelve el valor de retorno. */
async function submit(signer: Keypair, operation: xdr.Operation): Promise<xdr.ScVal | undefined> {
  const account = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status !== "PENDING") throw new Error(`sendTransaction devolvió ${sent.status}`);

  const result = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`La transacción ${sent.hash} terminó en ${result.status}`);
  }
  return result.returnValue;
}

/** Lee una función sin argumentos del contrato por simulación (sin firmar ni pagar comisión). */
async function view(contractId: string, method: string): Promise<unknown> {
  const source = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`Falló la simulación de ${method}`);
  return scValToNative(sim.result.retval);
}

type StellarLib = typeof import("../src/lib/stellar");

describe("dApp en Stellar Testnet", () => {
  const creator = Keypair.random();
  const donor = Keypair.random();
  let contractId = "";
  let lib: StellarLib;

  beforeAll(async () => {
    if (!existsSync(WASM_PATH)) {
      throw new Error(
        `No se encontró el Wasm en ${WASM_PATH}. Compílalo con ` +
          "`cargo build --target wasm32-unknown-unknown --release` en contracts/ o define WASM_PATH.",
      );
    }

    await Promise.all([
      server.fundAddress(creator.publicKey()),
      server.fundAddress(donor.publicKey()),
    ]);
    wallet.secret = donor.secret();

    const wasmHash = await submit(
      creator,
      Operation.uploadContractWasm({ wasm: readFileSync(WASM_PATH) }),
    );
    const created = await submit(
      creator,
      Operation.createCustomContract({
        address: new Address(creator.publicKey()),
        wasmHash: scValToNative(wasmHash!),
      }),
    );
    contractId = scValToNative(created!);

    await submit(
      creator,
      new Contract(contractId).call(
        "initialize",
        new Address(creator.publicKey()).toScVal(),
        nativeToScVal("Campaña e2e", { type: "string" }),
        nativeToScVal(100n * XLM, { type: "i128" }),
      ),
    );

    // stellar.ts lee NEXT_PUBLIC_CONTRACT_ID al cargarse: se importa después de desplegar.
    process.env.NEXT_PUBLIC_CONTRACT_ID = contractId;
    lib = await import("../src/lib/stellar");
    console.info(`Contrato de prueba: ${lib.explorerLink("contract", contractId)}`);
  });

  it("lee la campaña recién inicializada", async () => {
    expect(lib.IS_DEMO).toBe(false);
    expect(await lib.fetchCampaign()).toEqual({
      creator: creator.publicKey(),
      title: "Campaña e2e",
      targetAmount: 100n * XLM,
      currentAmount: 0n,
      status: "Active",
    });
  });

  it("usa el contrato del XLM nativo de la red", async () => {
    expect(await view(contractId, "get_token")).toBe(lib.NATIVE_XLM_CONTRACT);
  });

  it("dona, firma y transfiere el XLM al creador", async () => {
    const creatorBefore = (await lib.fetchBalance(creator.publicKey()))!;
    const donorBefore = (await lib.fetchBalance(donor.publicKey()))!;
    const phases: string[] = [];

    const hash = await lib.donate(donor.publicKey(), 25n * XLM, (phase) => phases.push(phase));

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(phases).toEqual(["preparing", "signing", "confirming"]);

    // El creador recibe exactamente lo donado; el donante paga además la comisión de red.
    expect(await lib.fetchBalance(creator.publicKey())).toBe(creatorBefore + 25n * XLM);
    const donorSpent = donorBefore - (await lib.fetchBalance(donor.publicKey()))!;
    expect(donorSpent).toBeGreaterThan(25n * XLM);
    expect(donorSpent).toBeLessThan(26n * XLM);

    const campaign = await lib.fetchCampaign();
    expect(campaign.currentAmount).toBe(25n * XLM);
    expect(campaign.status).toBe("Active");
  });

  it("traduce los errores del contrato", async () => {
    await expect(lib.donate(donor.publicKey(), 0n)).rejects.toThrow(
      "El monto de la donación debe ser mayor que cero.",
    );
  });

  it("rechaza donar más XLM del que tiene el donante y no cambia nada", async () => {
    const balance = (await lib.fetchBalance(donor.publicKey()))!;

    await expect(lib.donate(donor.publicKey(), balance + XLM)).rejects.toThrow(/^Saldo insuficiente/);
    expect((await lib.fetchCampaign()).currentAmount).toBe(25n * XLM);
  });

  it("completa la campaña al alcanzar la meta y rechaza nuevas donaciones", async () => {
    await lib.donate(donor.publicKey(), 75n * XLM);

    const campaign = await lib.fetchCampaign();
    expect(campaign.currentAmount).toBe(100n * XLM);
    expect(campaign.status).toBe("Completed");

    await expect(lib.donate(donor.publicKey(), XLM)).rejects.toThrow(
      "La campaña ya alcanzó su meta y no acepta más donaciones.",
    );
  });

  it("avisa cuando la cuenta del donante no existe", async () => {
    const missing = Keypair.random().publicKey();

    expect(await lib.fetchBalance(missing)).toBeNull();
    await expect(lib.donate(missing, XLM)).rejects.toThrow(/Friendbot/);
  });
});
