#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events},
    token, Address, Bytes, Env, IntoVal, String, Symbol, Val, Vec,
};

/// 1 XLM expresado en stroops.
const XLM: i128 = 10_000_000;

fn title(env: &Env) -> String {
    "Biblioteca comunitaria".into_val(env)
}

fn create_client<'a>(env: &Env) -> CampaignContractClient<'a> {
    CampaignContractClient::new(env, &env.register_contract(None, CampaignContract))
}

struct Setup<'a> {
    env: Env,
    client: CampaignContractClient<'a>,
    creator: Address,
    token: token::Client<'a>,
    token_admin: token::StellarAssetClient<'a>,
}

impl Setup<'_> {
    /// Crea un donante con `balance` stroops del token de prueba.
    fn donor(&self, balance: i128) -> Address {
        let donor = Address::generate(&self.env);
        self.token_admin.mint(&donor, &balance);
        donor
    }
}

/// Registra el contrato e inicializa una campaña con la meta indicada.
///
/// En el entorno de pruebas no hay cuentas con XLM nativo, así que el token guardado por
/// `initialize` se sustituye por un Stellar Asset Contract de prueba en el que se puede acuñar
/// saldo. La lógica del contrato es la misma: solo cambia la dirección del token.
fn setup<'a>(target_amount: i128) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let client = create_client(&env);
    let creator = Address::generate(&env);
    client.initialize(&creator, &title(&env), &target_amount);

    let token_id = env.register_stellar_asset_contract(Address::generate(&env));
    env.as_contract(&client.address, || {
        env.storage().instance().set(&DataKey::Token, &token_id)
    });

    Setup {
        token: token::Client::new(&env, &token_id),
        token_admin: token::StellarAssetClient::new(&env, &token_id),
        env,
        client,
        creator,
    }
}

#[test]
fn initialize_creates_active_campaign() {
    let env = Env::default();
    env.mock_all_auths();

    let client = create_client(&env);
    let creator = Address::generate(&env);
    client.initialize(&creator, &title(&env), &(500 * XLM));

    assert_eq!(
        env.auths(),
        std::vec![(
            creator.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "initialize"),
                    (creator.clone(), title(&env), 500 * XLM).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );

    assert_eq!(
        client.get_campaign(),
        Campaign {
            creator,
            title: title(&env),
            target_amount: 500 * XLM,
            current_amount: 0,
            status: CampaignStatus::Active,
        }
    );
}

#[test]
fn initialize_uses_native_xlm_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let client = create_client(&env);
    client.initialize(&Address::generate(&env), &title(&env), &(500 * XLM));

    let native_xlm = env
        .deployer()
        .with_stellar_asset(Bytes::from_array(&env, &NATIVE_ASSET_XDR))
        .deployed_address();
    assert_eq!(client.get_token(), native_xlm);
}

#[test]
fn donate_transfers_xlm_to_creator() {
    let s = setup(500 * XLM);
    let donor = s.donor(100 * XLM);

    s.client.donate(&donor, &(25 * XLM));

    assert_eq!(s.token.balance(&donor), 75 * XLM);
    assert_eq!(s.token.balance(&s.creator), 25 * XLM);
    assert_eq!(s.token.balance(&s.client.address), 0);

    let campaign = s.client.get_campaign();
    assert_eq!(campaign.current_amount, 25 * XLM);
    assert_eq!(campaign.status, CampaignStatus::Active);
    assert_eq!(s.client.get_donation(&donor), 25 * XLM);
}

#[test]
fn donate_requires_donor_auth_for_donation_and_transfer() {
    let s = setup(500 * XLM);
    let donor = s.donor(100 * XLM);

    s.client.donate(&donor, &(25 * XLM));

    assert_eq!(
        s.env.auths(),
        std::vec![(
            donor.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.client.address.clone(),
                    symbol_short!("donate"),
                    (donor.clone(), 25 * XLM).into_val(&s.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.token.address.clone(),
                        symbol_short!("transfer"),
                        (donor.clone(), s.creator.clone(), 25 * XLM).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
}

#[test]
fn donate_emits_transparency_event() {
    let s = setup(500 * XLM);
    let donor = s.donor(100 * XLM);

    s.client.donate(&donor, &(10 * XLM));

    let (contract_id, topics, data) = s.env.events().all().last().unwrap();
    let expected_topics: Vec<Val> = (symbol_short!("donate"), donor).into_val(&s.env);
    let amount: i128 = data.into_val(&s.env);

    assert_eq!(contract_id, s.client.address);
    assert_eq!(topics, expected_topics);
    assert_eq!(amount, 10 * XLM);
}

#[test]
fn donations_accumulate_globally_and_per_donor() {
    let s = setup(500 * XLM);
    let alice = s.donor(100 * XLM);
    let bob = s.donor(100 * XLM);

    s.client.donate(&alice, &(10 * XLM));
    s.client.donate(&bob, &(15 * XLM));
    s.client.donate(&alice, &(5 * XLM));

    assert_eq!(s.client.get_campaign().current_amount, 30 * XLM);
    assert_eq!(s.client.get_donation(&alice), 15 * XLM);
    assert_eq!(s.client.get_donation(&bob), 15 * XLM);
    assert_eq!(s.token.balance(&s.creator), 30 * XLM);
}

#[test]
fn get_donation_returns_zero_for_unknown_donor() {
    let s = setup(500 * XLM);

    assert_eq!(s.client.get_donation(&Address::generate(&s.env)), 0);
}

#[test]
fn campaign_completes_when_target_is_reached() {
    let s = setup(100 * XLM);
    let donor = s.donor(200 * XLM);

    s.client.donate(&donor, &(60 * XLM));
    assert_eq!(s.client.get_campaign().status, CampaignStatus::Active);

    // La última donación puede superar la meta.
    s.client.donate(&donor, &(50 * XLM));

    let campaign = s.client.get_campaign();
    assert_eq!(campaign.current_amount, 110 * XLM);
    assert_eq!(campaign.status, CampaignStatus::Completed);
    assert_eq!(s.token.balance(&s.creator), 110 * XLM);
}

#[test]
fn failed_transfer_reverts_the_donation() {
    let s = setup(500 * XLM);
    let donor = s.donor(5 * XLM);

    assert!(s.client.try_donate(&donor, &(10 * XLM)).is_err());

    assert_eq!(s.client.get_campaign().current_amount, 0);
    assert_eq!(s.client.get_donation(&donor), 0);
    assert_eq!(s.token.balance(&donor), 5 * XLM);
    assert_eq!(s.token.balance(&s.creator), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn donate_without_enough_balance_fails() {
    let s = setup(500 * XLM);
    let donor = s.donor(5 * XLM);

    // El SAC rechaza la transferencia con su error BalanceError (#10).
    s.client.donate(&donor, &(10 * XLM));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn initialize_twice_fails() {
    let s = setup(100 * XLM);

    s.client
        .initialize(&s.creator, &title(&s.env), &(100 * XLM));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn get_campaign_before_initialize_fails() {
    let env = Env::default();
    let client = create_client(&env);

    client.get_campaign();
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn get_token_before_initialize_fails() {
    let env = Env::default();
    let client = create_client(&env);

    client.get_token();
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn donate_before_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);

    client.donate(&Address::generate(&env), &XLM);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn initialize_with_empty_title_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);

    client.initialize(&Address::generate(&env), &"".into_val(&env), &(100 * XLM));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn initialize_with_non_positive_target_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = create_client(&env);

    client.initialize(&Address::generate(&env), &title(&env), &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn donate_zero_fails() {
    let s = setup(100 * XLM);

    s.client.donate(&s.donor(10 * XLM), &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn donate_negative_fails() {
    let s = setup(100 * XLM);

    s.client.donate(&s.donor(10 * XLM), &-XLM);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn donate_after_completion_fails() {
    let s = setup(100 * XLM);
    let donor = s.donor(200 * XLM);

    s.client.donate(&donor, &(100 * XLM));
    s.client.donate(&donor, &XLM);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn initialize_without_creator_auth_fails() {
    let env = Env::default();
    let client = create_client(&env);

    client.initialize(&Address::generate(&env), &title(&env), &(100 * XLM));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn donate_without_donor_auth_fails() {
    let env = Env::default();
    let client = create_client(&env);

    // `require_auth` es lo primero que valida `donate`, antes de leer la campaña.
    client.donate(&Address::generate(&env), &XLM);
}
