import { getNetworkDetails, signTransaction } from "@stellar/freighter-api";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import { STROOPS_PER_XLM } from "./format";

// ─── Configuración ───────────────────────────────────────────

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim() ?? "";
export const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL?.trim() || "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim() || Networks.TESTNET;
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL?.trim() ||
  "https://stellar.expert/explorer/testnet";

/** Sin contrato configurado la UI funciona en modo demo (solo estado local). */
export const IS_DEMO = CONTRACT_ID === "";

/** Stellar Asset Contract del XLM nativo en la red configurada (el mismo que usa el contrato). */
export const NATIVE_XLM_CONTRACT = Asset.native().contractId(NETWORK_PASSPHRASE);

/**
 * Cuenta nula usada como origen para simulaciones de solo lectura: la RPC no
 * exige que exista, así podemos leer la campaña sin billetera conectada.
 */
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

// ─── Tipos ───────────────────────────────────────────────────

export type CampaignStatus = "Active" | "Completed";

/** Espejo de `Campaign` del contrato. Los montos están en stroops. */
export interface Campaign {
  creator: string;
  title: string;
  targetAmount: bigint;
  currentAmount: bigint;
  status: CampaignStatus;
}

export type DonationPhase = "preparing" | "signing" | "confirming";

export const DEMO_CAMPAIGN: Campaign = {
  creator: SIMULATION_SOURCE,
  title: "Biblioteca comunitaria de código abierto",
  targetAmount: 5_000n * STROOPS_PER_XLM,
  currentAmount: 1_850n * STROOPS_PER_XLM,
  status: "Active",
};

// ─── Errores ─────────────────────────────────────────────────

/** Mensajes para los códigos de `Error` definidos en `contracts/src/lib.rs`. */
const CONTRACT_ERRORS: Record<number, string> = {
  1: "La campaña ya fue inicializada.",
  2: "El contrato aún no tiene una campaña inicializada.",
  3: "El título de la campaña no es válido.",
  4: "La meta de la campaña debe ser mayor que cero.",
  5: "El monto de la donación debe ser mayor que cero.",
  6: "La campaña ya alcanzó su meta y no acepta más donaciones.",
  7: "El monto supera el máximo permitido por el contrato.",
};

export function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // BalanceError (#10) del Stellar Asset Contract al transferir el XLM.
  if (/Error\(Contract, #10\)|balance is not sufficient/i.test(message)) {
    return "Saldo insuficiente. Recuerda que tu cuenta debe conservar la reserva mínima de XLM.";
  }

  const contractError = message.match(/Error\(Contract, #(\d+)\)/);
  if (contractError) {
    const code = Number(contractError[1]);
    return CONTRACT_ERRORS[code] ?? `El contrato devolvió el error #${code}.`;
  }
  if (/Account not found/i.test(message)) {
    return "Tu cuenta no existe en esta red. Fondéala con Friendbot antes de donar.";
  }

  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

// ─── Lectura ─────────────────────────────────────────────────

function decodeText(value: unknown): string {
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
}

/** Convierte el resultado nativo de `get_campaign` al tipo `Campaign` de la UI. */
export function parseCampaign(raw: Record<string, unknown>): Campaign {
  // Un enum de Soroban sin datos llega como ["Active"] / ["Completed"].
  const status = Array.isArray(raw.status) ? raw.status[0] : raw.status;

  return {
    creator: String(raw.creator),
    title: decodeText(raw.title),
    targetAmount: BigInt(raw.target_amount as bigint),
    currentAmount: BigInt(raw.current_amount as bigint),
    status: decodeText(status) === "Completed" ? "Completed" : "Active",
  };
}

async function simulateRead(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(readableError(simulation.error));
  }
  if (!simulation.result) {
    throw new Error(`La simulación de "${method}" no devolvió resultado.`);
  }

  return scValToNative(simulation.result.retval);
}

/** Lee la campaña on-chain invocando `get_campaign` en modo simulación. */
export async function fetchCampaign(): Promise<Campaign> {
  const raw = await simulateRead(CONTRACT_ID, "get_campaign");
  return parseCampaign(raw as Record<string, unknown>);
}

/** Saldo de XLM (en stroops) de una cuenta, leído del SAC nativo. `null` si no se puede leer. */
export async function fetchBalance(address: string): Promise<bigint | null> {
  try {
    const raw = await simulateRead(NATIVE_XLM_CONTRACT, "balance", new Address(address).toScVal());
    return BigInt(raw as bigint);
  } catch {
    return null;
  }
}

// ─── Escritura ───────────────────────────────────────────────

/** Verifica que Freighter esté apuntando a la misma red que la dApp. */
async function assertWalletNetwork(): Promise<void> {
  const details = await getNetworkDetails();
  if (details.error) {
    throw new Error(details.error.message || "No se pudo leer la red de Freighter.");
  }
  if (details.networkPassphrase !== NETWORK_PASSPHRASE) {
    throw new Error(
      `Freighter está en "${details.network}". Cámbiala a la red de la dApp (Testnet) e inténtalo de nuevo.`,
    );
  }
}

/**
 * Invoca `donate(donor, amount)`, que transfiere el XLM al creador: simula, firma con
 * Freighter, envía y espera la confirmación. Devuelve el hash de la transacción.
 */
export async function donate(
  donor: string,
  amount: bigint,
  onPhase?: (phase: DonationPhase) => void,
): Promise<string> {
  try {
    onPhase?.("preparing");
    await assertWalletNetwork();

    const account = await server.getAccount(donor);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(CONTRACT_ID).call(
          "donate",
          new Address(donor).toScVal(),
          nativeToScVal(amount, { type: "i128" }),
        ),
      )
      .setTimeout(120)
      .build();

    // Simula la invocación y añade footprint, recursos y autorizaciones.
    const prepared: Transaction = await server.prepareTransaction(tx);

    onPhase?.("signing");
    const signed = await signTransaction(prepared.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: donor,
    });
    if (signed.error) {
      throw new Error(signed.error.message || "La firma fue rechazada en Freighter.");
    }

    onPhase?.("confirming");
    const sent = await server.sendTransaction(
      TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE),
    );
    if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
      throw new Error(`La red rechazó la transacción (${sent.status}).`);
    }

    const result = await server.pollTransaction(sent.hash, { attempts: 30 });
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return sent.hash;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`La transacción falló on-chain. Hash: ${sent.hash}`);
    }
    throw new Error(`La transacción no se confirmó a tiempo. Revisa el hash ${sent.hash}.`);
  } catch (error) {
    throw new Error(readableError(error));
  }
}

// ─── Utilidades ──────────────────────────────────────────────

/** Aplica una donación al estado local, igual que lo hace el contrato. */
export function applyDonation(campaign: Campaign, amount: bigint): Campaign {
  const currentAmount = campaign.currentAmount + amount;
  return {
    ...campaign,
    currentAmount,
    status: currentAmount >= campaign.targetAmount ? "Completed" : "Active",
  };
}

export function explorerLink(kind: "tx" | "account" | "contract", id: string): string {
  return `${EXPLORER_URL}/${kind}/${id}`;
}
