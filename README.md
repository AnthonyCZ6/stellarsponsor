# StellarSponsor — Micro-mecenazgo transparente en Stellar

dApp de micro-mecenazgo construida sobre **Stellar Soroban**. Un creador publica una campaña con una
meta en XLM y cualquier persona puede apoyarla firmando una donación con su billetera **Freighter**.
Cada donación **transfiere XLM real directamente al creador** y queda registrada en un contrato
inteligente: la meta, el acumulado, el estado y lo aportado por cada donante viven on-chain y cada
donación emite un evento, así que cualquiera puede auditar la campaña desde un explorador de bloques
sin confiar en un servidor intermedio.

## Características

- **Contrato Soroban (Rust, `no_std`)** que administra una campaña: `initialize`, `donate`,
  `get_campaign`, `get_donation` y `get_token`.
- **Donaciones reales en XLM**: `donate` transfiere los fondos del donante al creador a través del
  Stellar Asset Contract (SAC) del XLM nativo. Si la transferencia falla, toda la operación se revierte.
- **Autorización nativa**: `donate` exige la firma del donante (para la donación y la transferencia);
  `initialize` exige la firma del creador.
- **Transparencia**: eventos `init`, `donate` y `completed`, y registro del total aportado por cada donante.
- **Cierre automático**: al alcanzar la meta, la campaña pasa a `Completed` y deja de aceptar donaciones.
- **Frontend Next.js** con tema oscuro, conexión a Freighter, saldo del donante, barra de progreso
  animada y formulario de donación en XLM.
- **Sitio estático**: se exporta a HTML/JS y se publica en **GitHub Pages** con GitHub Actions.
- **Modo demo**: sin contrato configurado, la UI funciona con datos locales para explorarla.

## Arquitectura

```
                 GitHub Pages (sitio estático)
┌──────────────────────────┐   firma (signTransaction)   ┌──────────────────────┐
│  Frontend (Next.js 16)   │ ──────────────────────────► │  Freighter Wallet    │
│  App Router · Tailwind 4 │ ◄────────────────────────── │  (extensión)         │
└────────────┬─────────────┘        XDR firmado          └──────────────────────┘
             │ @stellar/stellar-sdk (rpc.Server), directo desde el navegador
             │  · simulateTransaction → get_campaign / balance (lectura, sin firma)
             │  · prepareTransaction + sendTransaction → donate (escritura)
             ▼
┌──────────────────────────┐   ┌────────────────────────────────┐   transfer   ┌─────────────────┐
│  Stellar RPC (Testnet)   │ ► │ Contrato `stellar-sponsor`      │ ───────────► │ SAC XLM nativo  │
│  soroban-testnet...      │   │ Instance:   Campaign · Token    │ donante →    │ (CDLZFC3S…)     │
└──────────────────────────┘   │ Persistent: Donation(Address)   │ creador      └─────────────────┘
                               │ Eventos: init · donate · completed
                               └────────────────────────────────┘
```

| Capa | Tecnología |
| --- | --- |
| Smart contract | Rust + [Soroban SDK](https://docs.rs/soroban-sdk/20) `20.x`, compilado a Wasm |
| Frontend | [Next.js](https://nextjs.org) (App Router, exportación estática) + React 19 + TypeScript |
| Estilos | Tailwind CSS 4 (tema oscuro) + íconos `lucide-react` |
| Blockchain SDK | `@stellar/stellar-sdk` (RPC de Soroban, construcción de transacciones y ScVal) |
| Billetera | `@stellar/freighter-api` (`isConnected`, `requestAccess`, `getAddress`, `signTransaction`) |
| Hosting | GitHub Pages (workflow `.github/workflows/pages.yml`) |
| Red | Stellar Testnet |

### Estructura del repositorio

```
stellarsponsor/
├── .gitignore
├── README.md
├── .github/workflows/
│   ├── ci.yml                  # CI: pruebas del contrato y del frontend
│   └── pages.yml               # Publicación del frontend en GitHub Pages
├── contracts/                  # Contrato Soroban (crate Rust)
│   ├── Cargo.toml
│   ├── Cargo.lock              # Versiones compatibles con Rust 1.80
│   ├── rust-toolchain.toml     # Fija Rust 1.80.1 (requerido por soroban-sdk 20)
│   └── src/
│       ├── lib.rs              # Lógica del contrato
│       └── test.rs             # Pruebas unitarias
└── frontend/                   # dApp Next.js
    ├── .env.example
    ├── package.json
    ├── next.config.ts          # Exportación estática + basePath para Pages
    ├── postcss.config.mjs
    ├── tsconfig.json
    ├── vitest.config.mts
    ├── e2e/
    │   └── testnet.test.ts     # Prueba end-to-end contra Stellar Testnet
    └── src/
        ├── app/
        │   ├── globals.css
        │   ├── icon.svg        # Ícono de la app (favicon)
        │   ├── layout.tsx
        │   └── page.tsx        # UI: billetera, progreso y formulario de donación
        └── lib/
            ├── format.ts       # Conversión XLM ⇄ stroops y formato
            ├── stellar.ts      # Lectura/escritura del contrato vía RPC + Freighter
            └── *.test.ts       # Pruebas unitarias (Vitest)
```

### API del contrato

Todos los montos se expresan en **stroops** (`1 XLM = 10_000_000 stroops`).

| Función | Auth | Descripción |
| --- | --- | --- |
| `initialize(creator: Address, title: String, target_amount: i128)` | `creator` | Crea la campaña (una sola vez) y fija el XLM nativo de la red como token de las donaciones. |
| `donate(donor: Address, amount: i128)` | `donor` | Transfiere `amount` de XLM del donante al creador y lo suma al acumulado y al total del donante. |
| `get_campaign() -> Campaign` | — | Devuelve `{ creator, title, target_amount, current_amount, status }`. |
| `get_donation(donor: Address) -> i128` | — | Total aportado por `donor`. |
| `get_token() -> Address` | — | Contrato del token de las donaciones (SAC del XLM nativo). |

`status` es `Active` o `Completed`. Errores del contrato:

| Código | Error | Cuándo |
| --- | --- | --- |
| 1 | `AlreadyInitialized` | Se llama `initialize` por segunda vez. |
| 2 | `NotInitialized` | Se consulta o dona antes de `initialize`. |
| 3 | `InvalidTitle` | Título vacío o de más de 100 bytes. |
| 4 | `InvalidTarget` | Meta ≤ 0. |
| 5 | `InvalidAmount` | Donación ≤ 0. |
| 6 | `CampaignCompleted` | La campaña ya alcanzó su meta. |
| 7 | `Overflow` | Desbordamiento al acumular. |

Si el donante no tiene saldo suficiente, la transferencia falla con el error `#10` (`BalanceError`)
del SAC y la donación completa se revierte. Ten en cuenta que toda cuenta de Stellar debe conservar
una reserva mínima de XLM, que no se puede donar.

> **Flujo de fondos:** el contrato no custodia dinero. Cada `donate` mueve el XLM directamente de la
> cuenta del donante a la del creador en la misma transacción, y el contrato solo guarda el registro.
> La dirección del SAC nativo se deriva dentro de `initialize` a partir de la red, por eso no se pasa
> como parámetro.

## Requisitos

- [Rust](https://www.rust-lang.org/tools/install) vía `rustup`. El archivo `contracts/rust-toolchain.toml`
  instala y usa automáticamente **Rust 1.80.1** con el target `wasm32-unknown-unknown`.
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli) (`stellar`; antes se llamaba
  `soroban`). Los pasos de este README están verificados con la versión 28.1.0.
- [Node.js](https://nodejs.org) **≥ 22.12** y npm.
- Extensión [Freighter](https://www.freighter.app/) en el navegador.

> **¿Por qué Rust 1.80?** `soroban-sdk` 20 tiene dos incompatibilidades con compiladores nuevos:
> - Desde Rust **1.81**, un panic que atraviesa una función `extern "C"` aborta el proceso, así que las
>   pruebas `#[should_panic]` fallan con `thread caused non-unwinding panic. aborting`.
> - Desde Rust **1.82**, el target `wasm32-unknown-unknown` activa `reference-types` y la red rechaza el Wasm.
>
> Las versiones más nuevas del SDK (≥ 22) ya resuelven ambos problemas.

## 1. Compilar y probar el contrato

```bash
cd contracts

# Ejecuta las pruebas unitarias (usa el entorno de pruebas de soroban-sdk)
cargo test --locked

# Compila el contrato a Wasm optimizado
stellar contract build          # equivalente al antiguo: soroban contract build
```

El Wasm queda en `contracts/target/wasm32-unknown-unknown/release/stellar_sponsor.wasm`. También
puedes compilarlo sin la CLI con `cargo build --locked --target wasm32-unknown-unknown --release`.

<details>
<summary>Solución de problemas: <code>feature `edition2024` is required</code></summary>

Cargo 1.80 no tiene en cuenta el `rust-version` de las dependencias al resolverlas, así que sin
lockfile elegiría crates recientes que ya no compilan con 1.80 (p. ej. `zeroize 1.9`). Por eso el
repositorio incluye un `Cargo.lock` con versiones compatibles; usa `--locked` para respetarlo. Si
necesitas regenerarlo, hazlo con un toolchain reciente que respete `rust-version = "1.80"` y fija
`derive_arbitrary` a la misma versión que `arbitrary` (soroban-env-host 20 exige `arbitrary = 1.3.2`;
con `derive_arbitrary 1.4` falla con `no function or associated item named try_size_hint`):

```bash
CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +stable generate-lockfile
cargo update -p derive_arbitrary --precise 1.3.2
cargo test --locked
```
</details>

> **Windows con Smart App Control:** esta función bloquea los *build scripts* que Cargo compila
> localmente (`An Application Control policy has blocked this file`). Ejecuta las pruebas del
> contrato en WSL (Ubuntu) o en CI.

## 2. Desplegar en Stellar Testnet

```bash
cd contracts

# Identidad del creador, fondeada con Friendbot
stellar keys generate creator --network testnet --fund

# Despliega el contrato (guarda el ID que imprime: empieza con "C...")
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_sponsor.wasm \
  --source-account creator \
  --network testnet \
  --alias stellar_sponsor

# Inicializa la campaña: meta de 500 XLM = 5,000,000,000 stroops
stellar contract invoke \
  --id stellar_sponsor \
  --source-account creator \
  --network testnet \
  -- initialize \
  --creator "$(stellar keys address creator)" \
  --title "Biblioteca comunitaria de código abierto" \
  --target_amount 5000000000

# Consulta el estado y el token de las donaciones (SAC del XLM nativo)
stellar contract invoke --id stellar_sponsor --source-account creator --network testnet -- get_campaign
stellar contract invoke --id stellar_sponsor --source-account creator --network testnet -- get_token
```

Inicializa la campaña justo después de desplegar: hasta entonces, cualquiera podría llamar a
`initialize` con otro creador.

Opcional, donación de prueba desde la CLI (10 XLM) y comprobación de que el creador los recibió:

```bash
stellar keys generate donor --network testnet --fund
stellar contract invoke --id stellar_sponsor --source-account donor --network testnet \
  -- donate --donor "$(stellar keys address donor)" --amount 100000000

# Saldo del creador en el SAC del XLM nativo (en stroops)
XLM_SAC=$(stellar contract id asset --asset native --network testnet)
stellar contract invoke --id "$XLM_SAC" --source-account creator --network testnet \
  -- balance --id "$(stellar keys address creator)"

# Muestra el ID del contrato para configurar el frontend
stellar contract alias show stellar_sponsor --network testnet
```

## 3. Ejecutar el frontend

```bash
cd frontend
npm install
cp .env.example .env.local      # en PowerShell: Copy-Item .env.example .env.local
```

Edita `frontend/.env.local` y pega el ID del contrato desplegado:

```dotenv
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Luego:

```bash
npm run dev                     # http://localhost:3000
```

| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Exporta el sitio estático a `out/`. |
| `npm start` | Sirve `out/` localmente (tras `npm run build`). |
| `npm run typecheck` | Verificación de tipos con TypeScript. |
| `npm test` | Pruebas unitarias con Vitest (formato de montos, decodificación de la campaña, errores). |
| `npm run test:e2e` | Prueba end-to-end en Testnet (ver [Pruebas](#pruebas)). |

Sin `NEXT_PUBLIC_CONTRACT_ID`, la app arranca en **modo demo**: muestra una campaña de ejemplo y
las donaciones solo actualizan el estado local.

## 4. Publicar en GitHub Pages

La dApp es 100 % cliente (habla con Stellar desde el navegador), así que se publica como sitio
estático. El workflow `.github/workflows/pages.yml` la compila y la despliega en cada push a `main`.

1. Sube el repositorio a GitHub.
2. En **Settings → Pages → Build and deployment**, elige **Source: GitHub Actions**.
3. En **Settings → Secrets and variables → Actions → Variables**, crea la variable
   `NEXT_PUBLIC_CONTRACT_ID` con el ID del contrato (es un dato público, no un secreto). Con la CLI
   de GitHub: `gh variable set NEXT_PUBLIC_CONTRACT_ID --body "C..."`.
4. Ejecuta el workflow (*Actions → Deploy a GitHub Pages → Run workflow*) o haz push a `main`.

El sitio queda en `https://<tu-usuario>.github.io/<repositorio>/`. La ruta base la toma
automáticamente de `actions/configure-pages`. Si falta la variable del contrato, se publica en modo demo.

## 5. Probar el flujo completo en Testnet

1. Instala Freighter, crea o importa una cuenta y, en **Settings → Network**, elige **Testnet**.
2. Fondea la cuenta con Friendbot (botón *Fund with Friendbot* en Freighter, o
   `curl "https://friendbot.stellar.org?addr=TU_DIRECCION_G..."`).
3. Abre la dApp (local o en GitHub Pages) y pulsa **Conectar Freighter**. Verás tu dirección recortada
   (`GABCD...WXYZ`) y tu saldo de XLM.
4. Ingresa un monto en XLM (o usa los atajos 5/10/25/50) y pulsa **Donar**.
5. Freighter muestra la transacción `donate`; al firmarla, el XLM se transfiere al creador, la dApp
   espera la confirmación y actualiza la barra de progreso y tu saldo.
6. Sigue el enlace **Ver transacción** para auditarla en [stellar.expert](https://stellar.expert/explorer/testnet).

### Cómo funciona la integración

- **Lectura** (`get_campaign`, saldo): se construye una transacción con una cuenta nula como origen
  y se **simula** en la RPC; no requiere billetera ni comisiones. El saldo se lee del SAC del XLM
  nativo (`Asset.native().contractId(...)`), el mismo contrato que usa `donate`.
- **Escritura** (`donate`): se obtiene la cuenta del donante, `prepareTransaction` simula y añade
  footprint, recursos y autorización (incluida la del `transfer` anidado); Freighter firma el XDR; se
  envía con `sendTransaction` y se consulta con `pollTransaction` hasta que el estado es `SUCCESS`.
- La dApp verifica que Freighter esté en la misma red (`getNetworkDetails`) antes de firmar y traduce
  los códigos de error del contrato y del SAC a mensajes legibles.

## Pruebas

| Suite | Comando | Qué cubre |
| --- | --- | --- |
| Contrato | `cd contracts && cargo test --locked` | 21 pruebas: inicialización y token nativo, transferencia al creador, autorización del donante (incluido el `transfer` anidado), reversión si falta saldo, acumulado global y por donante, evento `donate`, cierre al alcanzar la meta y los códigos de error. |
| Frontend | `cd frontend && npm test` | 20 pruebas unitarias: conversión XLM ⇄ stroops, formato, porcentaje, decodificación de `get_campaign` tal como la codifica Soroban y traducción de errores. |
| End-to-end | `cd frontend && npm run test:e2e` | Despliega el Wasm en **Testnet**, lo inicializa y ejecuta `fetchCampaign` / `fetchBalance` / `donate` de la dApp con una billetera simulada: el creador recibe exactamente lo donado, saldo insuficiente, monto inválido, cierre de la campaña y cuenta sin fondos. |

La prueba end-to-end necesita el Wasm compilado (`cargo build --target wasm32-unknown-unknown --release`
en `contracts/`, o la ruta en la variable `WASM_PATH`) y acceso a Internet: crea cuentas nuevas con
Friendbot en cada ejecución.

### Integración continua

`.github/workflows/ci.yml` se ejecuta en cada push a `main` y en cada pull request:

- **Contrato:** `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --locked` y build del Wasm
  (publicado como artefacto).
- **Frontend:** `npm ci`, `typecheck`, `npm test` y `npm run build`.
- **E2E en Testnet:** solo bajo demanda. En GitHub, ve a *Actions → CI → Run workflow* y marca
  *Ejecutar también la prueba e2e*.
