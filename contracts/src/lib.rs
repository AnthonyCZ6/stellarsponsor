#![no_std]

//! # StellarSponsor — Micro-mecenazgo transparente en Soroban
//!
//! Cada instancia del contrato administra **una** campaña. Cada donación transfiere
//! XLM real del donante al creador a través del Stellar Asset Contract (SAC) nativo,
//! y todo el estado (meta, acumulado, estado y aportes por donante) vive on-chain.
//! Cada donación emite además un evento, de modo que cualquiera puede auditar la campaña.
//!
//! Los montos se expresan en *stroops* (1 XLM = 10_000_000 stroops), la unidad
//! mínima de la red Stellar.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, Env, String,
};

/// Ledgers aproximados por día (~5 s por ledger).
const DAY_IN_LEDGERS: u32 = 17_280;

/// La campaña (storage de instancia) se renueva a 30 días en cada escritura.
const INSTANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Los aportes por donante (storage persistente) también se renuevan a 30 días.
const DONATION_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const DONATION_LIFETIME_THRESHOLD: u32 = DONATION_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Longitud máxima del título en bytes.
const MAX_TITLE_LEN: u32 = 100;

/// `Asset::Native` serializado en XDR (discriminante 0): identifica al XLM nativo.
const NATIVE_ASSET_XDR: [u8; 4] = [0, 0, 0, 0];

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// La campaña ya fue inicializada.
    AlreadyInitialized = 1,
    /// La campaña aún no fue inicializada.
    NotInitialized = 2,
    /// El título está vacío o supera `MAX_TITLE_LEN`.
    InvalidTitle = 3,
    /// La meta debe ser mayor que cero.
    InvalidTarget = 4,
    /// El monto donado debe ser mayor que cero.
    InvalidAmount = 5,
    /// La campaña ya alcanzó su meta y no acepta más donaciones.
    CampaignCompleted = 6,
    /// Desbordamiento aritmético al acumular montos.
    Overflow = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    /// Acepta donaciones.
    Active,
    /// Alcanzó (o superó) la meta; ya no acepta donaciones.
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    /// Cuenta que creó la campaña y recibe el apoyo.
    pub creator: Address,
    /// Título público de la campaña.
    pub title: String,
    /// Meta total en stroops.
    pub target_amount: i128,
    /// Monto acumulado en stroops.
    pub current_amount: i128,
    /// Estado actual de la campaña.
    pub status: CampaignStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Datos de la campaña (storage de instancia).
    Campaign,
    /// Total aportado por un donante (storage persistente).
    Donation(Address),
    /// Contrato del token con el que se dona: el SAC del XLM nativo (storage de instancia).
    Token,
}

#[contract]
pub struct CampaignContract;

#[contractimpl]
impl CampaignContract {
    /// Crea la campaña. Solo puede ejecutarse una vez y requiere la firma del creador.
    ///
    /// Las donaciones se harán en XLM nativo: su contrato (SAC) se deriva de la red en la que
    /// se despliega el contrato, así que no hace falta pasarlo como parámetro.
    pub fn initialize(env: Env, creator: Address, title: String, target_amount: i128) {
        if env.storage().instance().has(&DataKey::Campaign) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        creator.require_auth();

        if title.len() == 0 || title.len() > MAX_TITLE_LEN {
            panic_with_error!(&env, Error::InvalidTitle);
        }
        if target_amount <= 0 {
            panic_with_error!(&env, Error::InvalidTarget);
        }

        let campaign = Campaign {
            creator: creator.clone(),
            title,
            target_amount,
            current_amount: 0,
            status: CampaignStatus::Active,
        };

        let native_xlm = env
            .deployer()
            .with_stellar_asset(Bytes::from_array(&env, &NATIVE_ASSET_XDR))
            .deployed_address();

        env.storage().instance().set(&DataKey::Campaign, &campaign);
        env.storage().instance().set(&DataKey::Token, &native_xlm);
        extend_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("init"), creator), target_amount);
    }

    /// Transfiere `amount` stroops de XLM de `donor` al creador y registra la donación.
    ///
    /// Cuando el acumulado alcanza la meta, la campaña pasa a `Completed`. Si la
    /// transferencia falla (p. ej. saldo insuficiente), la transacción completa se revierte.
    pub fn donate(env: Env, donor: Address, amount: i128) {
        donor.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let mut campaign = read_campaign(&env);
        if campaign.status != CampaignStatus::Active {
            panic_with_error!(&env, Error::CampaignCompleted);
        }

        campaign.current_amount = campaign
            .current_amount
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

        if campaign.current_amount >= campaign.target_amount {
            campaign.status = CampaignStatus::Completed;
        }

        env.storage().instance().set(&DataKey::Campaign, &campaign);
        extend_instance_ttl(&env);

        let key = DataKey::Donation(donor.clone());
        let donated: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let donated = donated
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        env.storage().persistent().set(&key, &donated);
        env.storage().persistent().extend_ttl(
            &key,
            DONATION_LIFETIME_THRESHOLD,
            DONATION_BUMP_AMOUNT,
        );

        token::Client::new(&env, &read_token(&env)).transfer(&donor, &campaign.creator, &amount);

        env.events()
            .publish((symbol_short!("donate"), donor), amount);

        if campaign.status == CampaignStatus::Completed {
            env.events()
                .publish((symbol_short!("completed"),), campaign.current_amount);
        }
    }

    /// Devuelve el estado completo de la campaña.
    pub fn get_campaign(env: Env) -> Campaign {
        read_campaign(&env)
    }

    /// Devuelve el contrato del token con el que se dona (SAC del XLM nativo).
    pub fn get_token(env: Env) -> Address {
        read_token(&env)
    }

    /// Devuelve el total (en stroops) aportado por `donor`.
    pub fn get_donation(env: Env, donor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Donation(donor))
            .unwrap_or(0)
    }
}

fn read_campaign(env: &Env) -> Campaign {
    env.storage()
        .instance()
        .get(&DataKey::Campaign)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn read_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

mod test;
