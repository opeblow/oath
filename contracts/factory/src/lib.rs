//! OATH factory: launches OATH coins as keyless sub-accounts that run the published
//! OATH token code (a global contract pinned by its code hash).
//!
//! The factory has no owner methods. The token code hash is fixed at initialization,
//! so every coin in the registry provably runs the same audited code.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

/// Balance given to each new coin account to pay for its own storage.
const COIN_STORAGE_FUND: NearToken = NearToken::from_millinear(500);
/// Kept by the factory to pay for the registry entry.
const REGISTRY_FEE: NearToken = NearToken::from_millinear(20);
const GAS_FOR_INIT: Gas = Gas::from_tgas(60);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(20);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Coins,
    ByCreator,
    ByCreatorList { hash: CryptoHash },
    Index,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CoinEntry {
    pub coin_id: AccountId,
    pub creator: AccountId,
    pub symbol: String,
    pub name: String,
    pub created_at_ns: U64,
    pub bond: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    token_code_hash: CryptoHash,
    coins: Vector<CoinEntry>,
    index: LookupMap<AccountId, u32>,
    by_creator: LookupMap<AccountId, Vector<u32>>,
}

#[near]
impl Factory {
    #[init]
    pub fn new(token_code_hash: Base58CryptoHash) -> Self {
        Self {
            token_code_hash: token_code_hash.into(),
            coins: Vector::new(StorageKey::Coins),
            index: LookupMap::new(StorageKey::Index),
            by_creator: LookupMap::new(StorageKey::ByCreator),
        }
    }

    /// Launch a coin. Attach: the total bond + 0.52 NEAR (coin storage and registry).
    /// `sub` becomes the coin account: `<sub>.<factory>`.
    /// `params` is passed unchanged to the token's `new` (see the token's LaunchParams).
    #[payable]
    pub fn create_coin(&mut self, sub: String, params: Value) -> Promise {
        require!(
            sub.len() >= 2 && sub.len() <= 24 && sub.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "Sub-account must be 2-24 chars: a-z, 0-9 or -"
        );
        require!(!sub.starts_with('-') && !sub.ends_with('-'), "Sub-account cannot start or end with -");
        let coin_id: AccountId = format!("{}.{}", sub, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Invalid sub-account"));
        require!(!self.index.contains_key(&coin_id), "Coin already exists");

        let bond = bond_of(&params);
        let deposit = env::attached_deposit();
        let required = bond
            .saturating_add(COIN_STORAGE_FUND.as_yoctonear())
            .saturating_add(REGISTRY_FEE.as_yoctonear());
        require!(
            deposit.as_yoctonear() == required,
            format!("Attach exactly {} yoctoNEAR (bond + 0.52 NEAR)", required)
        );

        let creator = env::predecessor_account_id();
        let symbol = params.get("symbol").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let args = serde_json::to_vec(&json!({ "creator": creator, "params": params })).unwrap();

        // One atomic batch: if `new` fails, the account is not created and funds return.
        // No access key is added, so the coin account is sealed forever.
        Promise::new(coin_id.clone())
            .create_account()
            .transfer(COIN_STORAGE_FUND)
            .use_global_contract(self.token_code_hash)
            .function_call("new", args, NearToken::from_yoctonear(bond), GAS_FOR_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_coin_created(coin_id, creator, symbol, name, U128(bond), U128(deposit.as_yoctonear())),
            )
    }

    #[private]
    pub fn on_coin_created(
        &mut self,
        coin_id: AccountId,
        creator: AccountId,
        symbol: String,
        name: String,
        bond: U128,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_err() {
            // The batch reverted; refund everything except nothing (the registry fee is
            // returned too, since nothing was stored).
            Promise::new(creator).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            env::log_str(&format!("Launch of {} failed; deposit refunded", coin_id));
            return false;
        }
        let entry = CoinEntry {
            coin_id: coin_id.clone(),
            creator: creator.clone(),
            symbol,
            name,
            created_at_ns: U64(env::block_timestamp()),
            bond,
        };
        let idx = self.coins.len();
        self.coins.push(entry);
        self.index.insert(coin_id.clone(), idx);
        let list = self.by_creator.entry(creator.clone()).or_insert_with(|| {
            Vector::new(StorageKey::ByCreatorList { hash: env::sha256_array(creator.as_bytes()) })
        });
        list.push(idx);
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"oath","version":"1.0.0","event":"coin_created","data":[{{"coin_id":"{}","creator":"{}"}}]}}"#,
            coin_id, creator
        ));
        true
    }

    // ------------------------------------------------------------ views

    pub fn get_token_code_hash(&self) -> Base58CryptoHash {
        self.token_code_hash.into()
    }

    pub fn get_launch_cost(&self, bond: U128) -> U128 {
        U128(bond.0 + COIN_STORAGE_FUND.as_yoctonear() + REGISTRY_FEE.as_yoctonear())
    }

    pub fn get_coin_count(&self) -> u32 {
        self.coins.len()
    }

    /// Newest first.
    pub fn get_coins(&self, from: u32, limit: u32) -> Vec<CoinEntry> {
        let len = self.coins.len();
        (from..len.min(from.saturating_add(limit.min(100))))
            .map(|k| self.coins[len - 1 - k].clone())
            .collect()
    }

    pub fn get_coin(&self, coin_id: AccountId) -> Option<CoinEntry> {
        self.index.get(&coin_id).map(|i| self.coins[*i].clone())
    }

    pub fn get_coins_by_creator(&self, creator: AccountId) -> Vec<CoinEntry> {
        match self.by_creator.get(&creator) {
            Some(list) => list.iter().map(|i| self.coins[*i].clone()).collect(),
            None => vec![],
        }
    }
}

fn bond_of(params: &Value) -> u128 {
    params
        .get("bonded")
        .and_then(|b| b.as_array())
        .map(|arr| {
            arr.iter()
                .map(|o| {
                    o.get("stake")
                        .and_then(|s| s.as_str())
                        .and_then(|s| s.parse::<u128>().ok())
                        .unwrap_or_else(|| env::panic_str("Each bonded oath needs a stake string"))
                })
                .fold(0u128, |a, b| a.checked_add(b).unwrap_or_else(|| env::panic_str("bond overflow")))
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn setup(deposit: u128) -> Factory {
        let mut b = VMContextBuilder::new();
        b.current_account_id("oath.testnet".parse().unwrap())
            .predecessor_account_id("creator.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
        Factory::new(Base58CryptoHash::from([7u8; 32]))
    }

    fn params(stake: &str) -> Value {
        json!({"symbol": "pepe", "name": "Pepe", "bonded": [{"terms": {"kind": "heartbeat", "every_secs": 60, "for_secs": 600}, "stake": stake}]})
    }

    #[test]
    fn bond_is_summed_from_params() {
        assert_eq!(bond_of(&params("1000")), 1000);
        assert_eq!(bond_of(&json!({})), 0);
    }

    #[test]
    fn create_coin_accepts_exact_deposit() {
        let bond = 10u128.pow(24);
        let cost = bond + COIN_STORAGE_FUND.as_yoctonear() + REGISTRY_FEE.as_yoctonear();
        let mut f = setup(cost);
        let _ = f.create_coin("pepe".into(), params(&bond.to_string()));
    }

    #[test]
    #[should_panic(expected = "Attach exactly")]
    fn create_coin_rejects_wrong_deposit() {
        let mut f = setup(1);
        let _ = f.create_coin("pepe".into(), params("1000"));
    }

    #[test]
    #[should_panic(expected = "Sub-account must be")]
    fn create_coin_rejects_bad_names() {
        let mut f = setup(1);
        let _ = f.create_coin("Bad_Name".into(), params("1000"));
    }

    #[test]
    fn registry_is_empty_at_start() {
        let f = setup(0);
        assert_eq!(f.get_coin_count(), 0);
        assert!(f.get_coins(0, 10).is_empty());
        assert_eq!(f.get_launch_cost(U128(0)).0, 520 * 10u128.pow(21));
    }
}
