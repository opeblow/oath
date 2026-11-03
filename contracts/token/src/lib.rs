//! OATH token: a NEP-141 memecoin whose creator promises are contract rules.
//!
//! Sealed oaths are enforced by this code and cannot be broken:
//!   - liquidity is locked: the bonding-curve reserve has no withdraw path
//!   - creator vesting: the creator allocation unlocks linearly after a cliff
//!   - launch max wallet: no account may exceed a share of supply during the launch window
//!   - fixed fee: set at launch, capped at 2%
//!   - treasury rules: capped spending per period, only to recipients declared at launch
//!
//! Bonded oaths are promises the code can observe but not force. Each one stakes part of
//! the creator's bond. If one is broken, anyone may enforce it: 5% of the stake goes to the
//! enforcer and 95% is paid out to holders pro rata.
//!
//! There are no owner or admin methods. The factory deploys this code to a sub-account
//! without adding any access keys, so neither the code nor the parameters can change.

mod math;

use math::{bps, mul_div, mul_div_ceil, BPS};
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

const NS: u64 = 1_000_000_000;
/// Scale for the per-token payout accumulator.
const ACC_SCALE: u128 = 1_000_000_000_000_000_000_000_000_000; // 1e27
const MAX_FEE_BPS: u16 = 200;
const MAX_CREATOR_BPS: u16 = 1_000;
const MIN_MAX_WALLET_BPS: u16 = 10;
const ENFORCER_BPS: u128 = 500;
const MAX_BONDED_OATHS: usize = 4;
const MAX_RECIPIENTS: usize = 8;
const ACTIVITY_CAP: u32 = 64;
const MAX_MEMO: usize = 140;
const MAX_ICON: usize = 8_192;
/// Share of the curve supply kept as a virtual token offset so the price stays finite.
const VIRTUAL_TOKEN_BPS: u128 = 2_500;
/// Extra bytes per holder for the payout checkpoint, charged at registration.
const EXTRA_ACCOUNT_BYTES: u64 = 160;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Checkpoints,
    Oaths,
    Activity,
}

// ---------------------------------------------------------------- types

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TreasuryRule {
    /// Only these accounts can ever receive treasury funds.
    pub recipients: Vec<AccountId>,
    /// Maximum yoctoNEAR spent per period.
    pub max_per_period: U128,
    pub period_secs: u64,
}

/// Bonded promise as entered at launch. Durations are relative to launch.
#[near(serializers = [borsh, json])]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Clone)]
pub enum BondedTermsInput {
    /// Post a public update at least every `every_secs`, for `for_secs` after launch.
    Heartbeat { every_secs: u64, for_secs: u64 },
    /// Add `amount` yoctoNEAR to the liquidity floor within `within_secs` of launch.
    FloorTopUp { amount: U128, within_secs: u64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct BondedOathInput {
    pub terms: BondedTermsInput,
    /// yoctoNEAR of the bond staked on this promise.
    pub stake: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct LaunchParams {
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    /// Plain-language reason for the coin, shown on the certificate.
    pub manifesto: String,
    /// Whole tokens (18 decimals are applied).
    pub total_supply_whole: U128,
    pub creator_alloc_bps: u16,
    pub vest_cliff_secs: u64,
    pub vest_duration_secs: u64,
    /// Virtual NEAR reserve in yoctoNEAR. Sets the starting price.
    pub virtual_near: U128,
    pub fee_bps: u16,
    pub max_wallet_bps: u16,
    pub launch_window_secs: u64,
    pub treasury: TreasuryRule,
    pub bonded: Vec<BondedOathInput>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum OathStatus {
    /// Running; not yet kept or broken.
    Active,
    /// Broken right now; anyone can call `enforce`.
    Breakable,
    /// Enforced. The stake was paid out.
    Broken,
    /// Fulfilled. The creator may reclaim the stake.
    Kept,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub enum BondedTerms {
    Heartbeat { every_ns: u64, end_ns: u64, last_beat_ns: u64 },
    FloorTopUp { amount: u128, deadline_ns: u64, deposited: u128 },
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct BondedOath {
    pub terms: BondedTerms,
    pub stake: u128,
    pub broken: bool,
    pub reclaimed: bool,
    pub enforced_by: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Checkpoint {
    pub paid_acc: U128,
    pub owed: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Activity {
    pub seq: U64,
    pub kind: String,
    pub account: AccountId,
    pub near: U128,
    pub tokens: U128,
    pub at_ns: U64,
    pub memo: Option<String>,
}

// ---------------------------------------------------------------- views

#[near(serializers = [json])]
pub struct BondedOathView {
    pub index: u32,
    pub kind: String,
    pub stake: U128,
    pub status: OathStatus,
    pub reclaimed: bool,
    pub enforced_by: Option<AccountId>,
    /// Heartbeat: interval. Floor top-up: promised amount.
    pub every_secs: Option<u64>,
    pub amount: Option<U128>,
    /// Heartbeat: end of the promise. Floor top-up: deadline.
    pub ends_at_ns: U64,
    /// Heartbeat: next deadline for an update.
    pub next_due_ns: Option<U64>,
    pub last_beat_ns: Option<U64>,
    pub deposited: Option<U128>,
}

#[near(serializers = [json])]
pub struct CurveView {
    pub near_reserve_virtual: U128,
    pub token_reserve_virtual: U128,
    pub real_near_reserve: U128,
    pub tokens_for_sale: U128,
    pub tokens_sold: U128,
    pub curve_supply: U128,
    /// yoctoNEAR per whole token (1e18 units), scaled by 1e18 for precision.
    pub spot_price_scaled: U128,
    pub floor_added: U128,
}

#[near(serializers = [json])]
pub struct Accounting {
    pub contract_balance: U128,
    pub storage_cost: U128,
    pub real_near_reserve: U128,
    pub treasury: U128,
    pub bond_locked: U128,
    pub unclaimed_payouts: U128,
    pub liabilities: U128,
    pub solvent: bool,
}

#[near(serializers = [json])]
pub struct Certificate {
    pub contract_id: AccountId,
    pub factory_id: AccountId,
    pub creator: AccountId,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub manifesto: String,
    pub decimals: u8,
    pub total_supply: U128,
    pub launched_at_ns: U64,
    pub creator_alloc: U128,
    pub creator_locked_now: U128,
    pub vest_cliff_ns: U64,
    pub vest_end_ns: U64,
    pub fee_bps: u16,
    pub max_wallet_bps: u16,
    pub launch_window_end_ns: U64,
    pub treasury_rule: TreasuryRule,
    pub treasury_spent_this_period: U128,
    pub treasury_period_index: u64,
    pub bonded: Vec<BondedOathView>,
    pub bond_total: U128,
    pub bond_locked: U128,
    pub payouts_distributed: U128,
    pub holders: u64,
    pub curve: CurveView,
    pub accounting: Accounting,
    pub activity_count: U64,
    pub now_ns: U64,
}

#[near(serializers = [json])]
pub struct HolderView {
    pub account_id: AccountId,
    pub registered: bool,
    pub balance: U128,
    pub locked: U128,
    pub claimable: U128,
}

#[near(serializers = [json])]
pub struct BuyQuote {
    pub tokens_out: U128,
    pub near_used: U128,
    pub fee: U128,
    pub refund: U128,
    pub registration_cost: U128,
}

#[near(serializers = [json])]
pub struct SellQuote {
    pub near_out: U128,
    pub fee: U128,
}

// ---------------------------------------------------------------- state

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
    manifesto: String,
    factory_id: AccountId,
    creator: AccountId,
    launched_at_ns: u64,

    // curve
    x: u128,
    y: u128,
    x0: u128,
    y0: u128,
    offset: u128,
    curve_supply: u128,
    floor_added: u128,

    // sealed oaths
    creator_alloc: u128,
    vest_cliff_ns: u64,
    vest_end_ns: u64,
    fee_bps: u16,
    max_wallet_bps: u16,
    launch_window_end_ns: u64,
    treasury_rule: TreasuryRule,
    treasury: u128,
    treasury_period_index: u64,
    treasury_spent_in_period: u128,

    // bonded oaths and payouts
    oaths: Vector<BondedOath>,
    bond_total: u128,
    bond_locked: u128,
    acc_per_token: u128,
    checkpoints: LookupMap<AccountId, Checkpoint>,
    unclaimed: u128,
    payouts_distributed: u128,
    holders: u64,

    activity: Vector<Activity>,
    activity_count: u64,
}

fn now() -> u64 {
    env::block_timestamp()
}

fn whole(amount: u128) -> u128 {
    amount
        .checked_mul(10u128.pow(18))
        .unwrap_or_else(|| env::panic_str("supply overflow"))
}

fn valid_memo(memo: &str) {
    require!(!memo.trim().is_empty(), "A public memo is required");
    require!(memo.len() <= MAX_MEMO, "Memo is too long");
}

#[near]
impl Contract {
    /// Called once by the factory in the same batch that creates this account.
    /// The attached deposit is the creator bond and must equal the sum of all stakes.
    #[init]
    #[payable]
    pub fn new(creator: AccountId, params: LaunchParams) -> Self {
        let p = params;
        require!(!p.name.trim().is_empty() && p.name.len() <= 32, "Name must be 1-32 chars");
        require!(
            p.symbol.len() >= 2
                && p.symbol.len() <= 12
                && p.symbol.chars().all(|c| c.is_ascii_alphanumeric()),
            "Symbol must be 2-12 letters or digits"
        );
        require!(p.manifesto.len() <= 280, "Manifesto is too long");
        if let Some(icon) = &p.icon {
            require!(icon.len() <= MAX_ICON, "Icon is too large");
            require!(icon.starts_with("data:image/"), "Icon must be a data URL");
        }
        require!(p.fee_bps <= MAX_FEE_BPS, "Fee is capped at 2%");
        require!(p.creator_alloc_bps <= MAX_CREATOR_BPS, "Creator allocation is capped at 10%");
        require!(
            p.max_wallet_bps >= MIN_MAX_WALLET_BPS && p.max_wallet_bps <= 10_000,
            "Max wallet must be between 0.1% and 100%"
        );
        require!(
            p.creator_alloc_bps == 0 || p.vest_duration_secs > 0,
            "A creator allocation needs a vesting duration"
        );
        let supply_whole = p.total_supply_whole.0;
        require!(
            supply_whole >= 1_000 && supply_whole <= 1_000_000_000_000,
            "Supply must be between 1e3 and 1e12 tokens"
        );
        let virtual_near = p.virtual_near.0;
        require!(
            virtual_near >= NearToken::from_near(1).as_yoctonear()
                && virtual_near <= NearToken::from_near(100_000).as_yoctonear(),
            "Virtual reserve must be between 1 and 100000 NEAR"
        );
        let t = &p.treasury;
        require!(
            !t.recipients.is_empty() && t.recipients.len() <= MAX_RECIPIENTS,
            "Declare 1 to 8 treasury recipients"
        );
        require!(t.period_secs >= 3_600, "Treasury period must be at least one hour");
        require!(p.bonded.len() <= MAX_BONDED_OATHS, "At most 4 bonded oaths");

        let launched = now();
        let total_supply = whole(supply_whole);
        let creator_alloc = bps(total_supply, p.creator_alloc_bps as u128);
        let curve_supply = total_supply - creator_alloc;
        let offset = bps(curve_supply, VIRTUAL_TOKEN_BPS);
        let y0 = curve_supply + offset;

        let factory_id = env::predecessor_account_id();
        let self_id = env::current_account_id();
        require!(creator != self_id, "Creator cannot be the coin itself");

        let mut token = FungibleToken::new(StorageKey::Token);
        token.account_storage_usage += EXTRA_ACCOUNT_BYTES;
        token.internal_register_account(&self_id);
        token.internal_deposit(&self_id, curve_supply);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &self_id,
            amount: U128(curve_supply),
            memo: Some("bonding curve supply"),
        }
        .emit();
        token.internal_register_account(&creator);
        if creator_alloc > 0 {
            token.internal_deposit(&creator, creator_alloc);
            near_contract_standards::fungible_token::events::FtMint {
                owner_id: &creator,
                amount: U128(creator_alloc),
                memo: Some("creator allocation, vesting"),
            }
            .emit();
        }

        let mut oaths = Vector::new(StorageKey::Oaths);
        let mut bond_total: u128 = 0;
        for b in p.bonded.iter() {
            let stake = b.stake.0;
            require!(stake >= NearToken::from_millinear(100).as_yoctonear(), "Each stake must be at least 0.1 NEAR");
            bond_total = bond_total.checked_add(stake).unwrap_or_else(|| env::panic_str("bond overflow"));
            let terms = match &b.terms {
                BondedTermsInput::Heartbeat { every_secs, for_secs } => {
                    require!(*every_secs >= 60, "Heartbeat interval must be at least 60 seconds");
                    require!(for_secs >= every_secs, "Heartbeat term must cover at least one interval");
                    BondedTerms::Heartbeat {
                        every_ns: every_secs * NS,
                        end_ns: launched + for_secs * NS,
                        last_beat_ns: launched,
                    }
                }
                BondedTermsInput::FloorTopUp { amount, within_secs } => {
                    require!(amount.0 > 0, "Top-up amount must be positive");
                    require!(*within_secs >= 60, "Top-up window must be at least 60 seconds");
                    BondedTerms::FloorTopUp {
                        amount: amount.0,
                        deadline_ns: launched + within_secs * NS,
                        deposited: 0,
                    }
                }
            };
            oaths.push(BondedOath { terms, stake, broken: false, reclaimed: false, enforced_by: None });
        }
        require!(
            env::attached_deposit().as_yoctonear() == bond_total,
            "Attached deposit must equal the total bond"
        );

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: p.name.clone(),
            symbol: p.symbol.to_uppercase(),
            icon: p.icon.clone(),
            reference: None,
            reference_hash: None,
            decimals: 18,
        };

        let mut this = Self {
            token,
            metadata,
            manifesto: p.manifesto.clone(),
            factory_id,
            creator: creator.clone(),
            launched_at_ns: launched,
            x: virtual_near,
            y: y0,
            x0: virtual_near,
            y0,
            offset,
            curve_supply,
            floor_added: 0,
            creator_alloc,
            vest_cliff_ns: launched + p.vest_cliff_secs * NS,
            vest_end_ns: launched + (p.vest_cliff_secs + p.vest_duration_secs) * NS,
            fee_bps: p.fee_bps,
            max_wallet_bps: p.max_wallet_bps,
            launch_window_end_ns: launched + p.launch_window_secs * NS,
            treasury_rule: p.treasury.clone(),
            treasury: 0,
            treasury_period_index: 0,
            treasury_spent_in_period: 0,
            oaths,
            bond_total,
            bond_locked: bond_total,
            acc_per_token: 0,
            checkpoints: LookupMap::new(StorageKey::Checkpoints),
            unclaimed: 0,
            payouts_distributed: 0,
            holders: 0,
            activity: Vector::new(StorageKey::Activity),
            activity_count: 0,
        };
        this.log_activity("launch", &creator, bond_total, creator_alloc, Some(p.symbol.to_uppercase()));
        this.emit("launch", format!(r#"{{"creator":"{}","bond":"{}"}}"#, creator, bond_total));
        this
    }

    // ------------------------------------------------------------ trading

    /// Buy from the bonding curve with the attached NEAR. Registers the buyer if needed
    /// (the registration cost is taken from the deposit). Any unused NEAR is refunded.
    #[payable]
    pub fn buy(&mut self, min_tokens_out: U128) -> U128 {
        let buyer = env::predecessor_account_id();
        require!(buyer != self.creator || now() >= self.launch_window_end_ns, "The creator cannot buy during the launch window");
        let deposit = env::attached_deposit().as_yoctonear();
        let reg_cost = if self.token.accounts.contains_key(&buyer) {
            0
        } else {
            self.storage_balance_bounds().min.as_yoctonear()
        };
        require!(deposit > reg_cost, "Deposit does not cover registration");
        let q = self.quote_buy_inner(deposit - reg_cost);
        require!(q.tokens_out > 0, "Nothing to buy");
        require!(q.tokens_out >= min_tokens_out.0, "Slippage: fewer tokens than the minimum");

        if reg_cost > 0 {
            self.token.internal_register_account(&buyer);
        }
        self.settle(&buyer);
        self.x += q.near_used;
        self.y -= q.tokens_out;
        self.treasury += q.fee;
        let self_id = env::current_account_id();
        let was_holder = self.token.ft_balance_of(buyer.clone()).0 > 0;
        self.token.internal_transfer(&self_id, &buyer, q.tokens_out, Some("buy".into()));
        if !was_holder && !self.is_excluded(&buyer) {
            self.holders += 1;
        }
        self.assert_max_wallet(&buyer);
        self.log_activity("buy", &buyer, q.near_used + q.fee, q.tokens_out, None);
        self.emit("buy", format!(r#"{{"account":"{}","near":"{}","tokens":"{}"}}"#, buyer, q.near_used + q.fee, q.tokens_out));
        if q.refund > 0 {
            Promise::new(buyer).transfer(NearToken::from_yoctonear(q.refund)).detach();
        }
        U128(q.tokens_out)
    }

    /// Sell tokens back to the curve. Requires 1 yoctoNEAR for wallet confirmation.
    #[payable]
    pub fn sell(&mut self, amount: U128, min_near_out: U128) -> U128 {
        assert_one_yocto();
        let seller = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "Amount must be positive");
        let q = self.quote_sell_inner(amount);
        require!(q.near_out >= min_near_out.0, "Slippage: less NEAR than the minimum");
        self.settle(&seller);
        let self_id = env::current_account_id();
        self.token.internal_transfer(&seller, &self_id, amount, Some("sell".into()));
        self.assert_vesting(&seller);
        let gross = q.near_out + q.fee;
        self.x -= gross;
        self.y += amount;
        self.treasury += q.fee;
        if self.token.ft_balance_of(seller.clone()).0 == 0 && !self.is_excluded(&seller) && self.holders > 0 {
            self.holders -= 1;
        }
        self.log_activity("sell", &seller, gross, amount, None);
        self.emit("sell", format!(r#"{{"account":"{}","near":"{}","tokens":"{}"}}"#, seller, q.near_out, amount));
        Promise::new(seller).transfer(NearToken::from_yoctonear(q.near_out)).detach();
        U128(q.near_out)
    }

    /// Add NEAR to the liquidity floor. Anyone can do this. When the creator does it,
    /// the amount counts toward their unmet floor top-up oaths.
    #[payable]
    pub fn add_to_floor(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach NEAR to add to the floor");
        let caller = env::predecessor_account_id();
        self.x += amount;
        self.floor_added += amount;
        if caller == self.creator {
            let n = now();
            let mut left = amount;
            for i in 0..self.oaths.len() {
                if left == 0 {
                    break;
                }
                let status = Self::status_of(&self.oaths[i], n);
                if status != OathStatus::Active {
                    continue;
                }
                if let BondedTerms::FloorTopUp { amount: target, deposited, .. } = &mut self.oaths[i].terms {
                    let need = target.saturating_sub(*deposited);
                    let used = need.min(left);
                    *deposited += used;
                    left -= used;
                }
            }
        }
        self.log_activity("floor", &caller, amount, 0, None);
        self.emit("floor", format!(r#"{{"account":"{}","near":"{}"}}"#, caller, amount));
    }

    // ------------------------------------------------------------ creator

    /// Public check-in that keeps every active heartbeat oath alive.
    pub fn heartbeat(&mut self, message: String) {
        self.assert_creator();
        valid_memo(&message);
        let n = now();
        let mut any = false;
        for i in 0..self.oaths.len() {
            if Self::status_of(&self.oaths[i], n) != OathStatus::Active {
                continue;
            }
            if let BondedTerms::Heartbeat { last_beat_ns, .. } = &mut self.oaths[i].terms {
                *last_beat_ns = n;
                any = true;
            }
        }
        require!(any, "No active heartbeat oath");
        let creator = self.creator.clone();
        self.log_activity("heartbeat", &creator, 0, 0, Some(message.clone()));
        self.emit("heartbeat", format!(r#"{{"message":{}}}"#, near_sdk::serde_json::to_string(&message).unwrap()));
    }

    /// Spend from the treasury within the launch rules.
    #[payable]
    pub fn treasury_spend(&mut self, recipient: AccountId, amount: U128, memo: String) {
        assert_one_yocto();
        self.assert_creator();
        valid_memo(&memo);
        let amount = amount.0;
        require!(amount > 0, "Amount must be positive");
        require!(self.treasury_rule.recipients.contains(&recipient), "Recipient was not declared at launch");
        require!(amount <= self.treasury, "Not enough in the treasury");
        let period = (now() - self.launched_at_ns) / (self.treasury_rule.period_secs * NS);
        if period != self.treasury_period_index {
            self.treasury_period_index = period;
            self.treasury_spent_in_period = 0;
        }
        require!(
            self.treasury_spent_in_period + amount <= self.treasury_rule.max_per_period.0,
            "Over the treasury limit for this period"
        );
        self.treasury_spent_in_period += amount;
        self.treasury -= amount;
        self.log_activity("treasury", &recipient, amount, 0, Some(memo.clone()));
        self.emit(
            "treasury_spend",
            format!(r#"{{"recipient":"{}","near":"{}","memo":{}}}"#, recipient, amount, near_sdk::serde_json::to_string(&memo).unwrap()),
        );
        Promise::new(recipient).transfer(NearToken::from_yoctonear(amount)).detach();
    }

    /// Return the stake of a kept oath to the creator.
    pub fn reclaim_stake(&mut self, index: u32) -> U128 {
        self.assert_creator();
        require!(index < self.oaths.len(), "No such oath");
        let status = Self::status_of(&self.oaths[index], now());
        require!(status == OathStatus::Kept, "Oath is not kept yet");
        let oath = &mut self.oaths[index];
        require!(!oath.reclaimed, "Already reclaimed");
        oath.reclaimed = true;
        let stake = oath.stake;
        self.bond_locked -= stake;
        let creator = self.creator.clone();
        self.log_activity("reclaim", &creator, stake, 0, None);
        self.emit("reclaim", format!(r#"{{"index":{},"near":"{}"}}"#, index, stake));
        Promise::new(creator).transfer(NearToken::from_yoctonear(stake)).detach();
        U128(stake)
    }

    // ------------------------------------------------------------ anyone

    /// Enforce a broken oath. The caller receives 5% of its stake; the rest is paid out
    /// to holders (creator excluded) in proportion to their balance.
    pub fn enforce(&mut self, index: u32) -> U128 {
        require!(index < self.oaths.len(), "No such oath");
        let status = Self::status_of(&self.oaths[index], now());
        require!(status == OathStatus::Breakable, "This oath is not broken");
        let enforcer = env::predecessor_account_id();
        let oath = &mut self.oaths[index];
        oath.broken = true;
        oath.enforced_by = Some(enforcer.clone());
        let stake = oath.stake;
        self.bond_locked -= stake;
        let bounty = bps(stake, ENFORCER_BPS);
        let pool = stake - bounty;
        self.distribute(pool);
        self.log_activity("enforce", &enforcer, stake, 0, Some(format!("oath {} broken", index + 1)));
        self.emit("enforce", format!(r#"{{"index":{},"enforcer":"{}","stake":"{}"}}"#, index, enforcer, stake));
        if bounty > 0 {
            Promise::new(enforcer).transfer(NearToken::from_yoctonear(bounty)).detach();
        }
        U128(bounty)
    }

    /// Claim NEAR paid out from enforced oaths.
    pub fn claim(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        self.settle(&account);
        let mut cp = self.checkpoints.get(&account).cloned().unwrap_or_default();
        let owed = cp.owed.0;
        require!(owed > 0, "Nothing to claim");
        cp.owed = U128(0);
        self.checkpoints.insert(account.clone(), cp);
        self.unclaimed -= owed;
        self.log_activity("claim", &account, owed, 0, None);
        self.emit("claim", format!(r#"{{"account":"{}","near":"{}"}}"#, account, owed));
        Promise::new(account).transfer(NearToken::from_yoctonear(owed)).detach();
        U128(owed)
    }

    // ------------------------------------------------------------ views

    pub fn get_certificate(&self) -> Certificate {
        let n = now();
        let bonded = (0..self.oaths.len()).map(|i| self.oath_view(i, n)).collect();
        let period = (n - self.launched_at_ns) / (self.treasury_rule.period_secs * NS);
        let spent = if period == self.treasury_period_index { self.treasury_spent_in_period } else { 0 };
        Certificate {
            contract_id: env::current_account_id(),
            factory_id: self.factory_id.clone(),
            creator: self.creator.clone(),
            name: self.metadata.name.clone(),
            symbol: self.metadata.symbol.clone(),
            icon: self.metadata.icon.clone(),
            manifesto: self.manifesto.clone(),
            decimals: 18,
            total_supply: U128(self.token.total_supply),
            launched_at_ns: U64(self.launched_at_ns),
            creator_alloc: U128(self.creator_alloc),
            creator_locked_now: U128(self.locked_at(n)),
            vest_cliff_ns: U64(self.vest_cliff_ns),
            vest_end_ns: U64(self.vest_end_ns),
            fee_bps: self.fee_bps,
            max_wallet_bps: self.max_wallet_bps,
            launch_window_end_ns: U64(self.launch_window_end_ns),
            treasury_rule: self.treasury_rule.clone(),
            treasury_spent_this_period: U128(spent),
            treasury_period_index: period,
            bonded,
            bond_total: U128(self.bond_total),
            bond_locked: U128(self.bond_locked),
            payouts_distributed: U128(self.payouts_distributed),
            holders: self.holders,
            curve: self.get_curve(),
            accounting: self.get_accounting(),
            activity_count: U64(self.activity_count),
            now_ns: U64(n),
        }
    }

    pub fn get_curve(&self) -> CurveView {
        CurveView {
            near_reserve_virtual: U128(self.x),
            token_reserve_virtual: U128(self.y),
            real_near_reserve: U128(self.x - self.x0),
            tokens_for_sale: U128(self.y - self.offset),
            tokens_sold: U128(self.y0 - self.y),
            curve_supply: U128(self.curve_supply),
            spot_price_scaled: U128(mul_div(self.x, 10u128.pow(36), self.y)),
            floor_added: U128(self.floor_added),
        }
    }

    pub fn get_accounting(&self) -> Accounting {
        let balance = env::account_balance().as_yoctonear();
        let storage_cost = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
        let reserve = self.x - self.x0;
        let liabilities = reserve + self.treasury + self.bond_locked + self.unclaimed;
        Accounting {
            contract_balance: U128(balance),
            storage_cost: U128(storage_cost),
            real_near_reserve: U128(reserve),
            treasury: U128(self.treasury),
            bond_locked: U128(self.bond_locked),
            unclaimed_payouts: U128(self.unclaimed),
            liabilities: U128(liabilities),
            solvent: balance >= liabilities + storage_cost,
        }
    }

    pub fn get_holder(&self, account_id: AccountId) -> HolderView {
        let registered = self.token.accounts.contains_key(&account_id);
        let balance = self.token.ft_balance_of(account_id.clone()).0;
        let locked = if account_id == self.creator { self.locked_at(now()) } else { 0 };
        HolderView {
            claimable: U128(self.claimable_of(&account_id, balance)),
            account_id,
            registered,
            balance: U128(balance),
            locked: U128(locked),
        }
    }

    pub fn quote_buy(&self, near_in: U128, account_id: Option<AccountId>) -> BuyQuote {
        let reg = match account_id {
            Some(a) if self.token.accounts.contains_key(&a) => 0,
            _ => self.storage_balance_bounds().min.as_yoctonear(),
        };
        let mut q = self.quote_buy_inner(near_in.0.saturating_sub(reg));
        q.registration_cost = reg;
        q.into_view()
    }

    pub fn quote_sell(&self, amount: U128) -> SellQuote {
        let q = self.quote_sell_inner(amount.0);
        SellQuote { near_out: U128(q.near_out), fee: U128(q.fee) }
    }

    /// Newest first. `from` counts back from the newest entry.
    pub fn get_activity(&self, from: u32, limit: u32) -> Vec<Activity> {
        let len = self.activity.len();
        let limit = limit.min(ACTIVITY_CAP);
        let mut out = Vec::new();
        let total = self.activity_count;
        let mut k = from as u64;
        while (out.len() as u32) < limit && k < len as u64 {
            let seq = total - 1 - k;
            let slot = (seq % ACTIVITY_CAP as u64) as u32;
            if let Some(a) = self.activity.get(slot) {
                out.push(a.clone());
            }
            k += 1;
        }
        out
    }

    // ------------------------------------------------------------ internals

    fn assert_creator(&self) {
        require!(env::predecessor_account_id() == self.creator, "Only the creator can do this");
    }

    fn locked_at(&self, n: u64) -> u128 {
        if self.creator_alloc == 0 || n >= self.vest_end_ns {
            return 0;
        }
        if n < self.vest_cliff_ns {
            return self.creator_alloc;
        }
        let total = (self.vest_end_ns - self.vest_cliff_ns) as u128;
        let left = (self.vest_end_ns - n) as u128;
        mul_div_ceil(self.creator_alloc, left, total)
    }

    fn assert_vesting(&self, account: &AccountId) {
        if *account == self.creator {
            let bal = self.token.ft_balance_of(account.clone()).0;
            require!(bal >= self.locked_at(now()), "Oath: creator tokens are still vesting");
        }
    }

    fn assert_max_wallet(&self, account: &AccountId) {
        if now() >= self.launch_window_end_ns || *account == env::current_account_id() {
            return;
        }
        let mut cap = bps(self.token.total_supply, self.max_wallet_bps as u128);
        if *account == self.creator {
            cap += self.creator_alloc;
        }
        let bal = self.token.ft_balance_of(account.clone()).0;
        require!(bal <= cap, "Oath: launch max wallet exceeded");
    }

    fn is_excluded(&self, account: &AccountId) -> bool {
        *account == self.creator || *account == env::current_account_id()
    }

    fn claimable_of(&self, account: &AccountId, balance: u128) -> u128 {
        if self.is_excluded(account) {
            return 0;
        }
        let cp = self.checkpoints.get(account).cloned().unwrap_or_default();
        let pending = mul_div(balance, self.acc_per_token - cp.paid_acc.0, ACC_SCALE);
        cp.owed.0 + pending
    }

    /// Bring an account's payout checkpoint up to date. Call before any balance change.
    fn settle(&mut self, account: &AccountId) {
        if self.is_excluded(account) {
            return;
        }
        let balance = self.token.accounts.get(account).unwrap_or(0);
        let owed = self.claimable_of(account, balance);
        let acc = self.acc_per_token;
        let cp = Checkpoint { paid_acc: U128(acc), owed: U128(owed) };
        if balance == 0 && owed == 0 && !self.checkpoints.contains_key(account) {
            // Fresh account: start at the current accumulator.
            self.checkpoints.insert(account.clone(), cp);
            return;
        }
        self.checkpoints.insert(account.clone(), cp);
    }

    fn distribute(&mut self, pool: u128) {
        let self_id = env::current_account_id();
        let eligible = self.token.total_supply
            - self.token.ft_balance_of(self_id).0
            - self.token.ft_balance_of(self.creator.clone()).0;
        if eligible == 0 {
            self.x += pool;
            self.floor_added += pool;
            return;
        }
        let inc = mul_div(pool, ACC_SCALE, eligible);
        let distributed = mul_div(inc, eligible, ACC_SCALE);
        self.acc_per_token += inc;
        self.unclaimed += distributed;
        self.payouts_distributed += distributed;
        let dust = pool - distributed;
        self.x += dust;
        self.floor_added += dust;
    }

    fn status_of(o: &BondedOath, n: u64) -> OathStatus {
        if o.broken {
            return OathStatus::Broken;
        }
        match &o.terms {
            BondedTerms::Heartbeat { every_ns, end_ns, last_beat_ns } => {
                let due = last_beat_ns + every_ns;
                if due < *end_ns && n > due {
                    OathStatus::Breakable
                } else if n >= *end_ns {
                    OathStatus::Kept
                } else {
                    OathStatus::Active
                }
            }
            BondedTerms::FloorTopUp { amount, deadline_ns, deposited } => {
                if deposited >= amount {
                    OathStatus::Kept
                } else if n > *deadline_ns {
                    OathStatus::Breakable
                } else {
                    OathStatus::Active
                }
            }
        }
    }

    fn oath_view(&self, i: u32, n: u64) -> BondedOathView {
        let o = &self.oaths[i];
        let status = Self::status_of(o, n);
        let base = BondedOathView {
            index: i,
            kind: String::new(),
            stake: U128(o.stake),
            status,
            reclaimed: o.reclaimed,
            enforced_by: o.enforced_by.clone(),
            every_secs: None,
            amount: None,
            ends_at_ns: U64(0),
            next_due_ns: None,
            last_beat_ns: None,
            deposited: None,
        };
        match &o.terms {
            BondedTerms::Heartbeat { every_ns, end_ns, last_beat_ns } => BondedOathView {
                kind: "heartbeat".into(),
                every_secs: Some(every_ns / NS),
                ends_at_ns: U64(*end_ns),
                next_due_ns: Some(U64(last_beat_ns + every_ns)),
                last_beat_ns: Some(U64(*last_beat_ns)),
                ..base
            },
            BondedTerms::FloorTopUp { amount, deadline_ns, deposited } => BondedOathView {
                kind: "floor_top_up".into(),
                amount: Some(U128(*amount)),
                ends_at_ns: U64(*deadline_ns),
                deposited: Some(U128(*deposited)),
                ..base
            },
        }
    }

    fn quote_buy_inner(&self, deposit: u128) -> InnerBuy {
        let fee = bps(deposit, self.fee_bps as u128);
        let dx = deposit - fee;
        if dx == 0 {
            return InnerBuy { tokens_out: 0, near_used: 0, fee: 0, refund: deposit, registration_cost: 0 };
        }
        let mut dy = mul_div(self.y, dx, self.x + dx);
        let available = self.y - self.offset;
        let mut used = dx;
        let mut fee_used = fee;
        if dy > available {
            dy = available;
            if dy == 0 {
                return InnerBuy { tokens_out: 0, near_used: 0, fee: 0, refund: deposit, registration_cost: 0 };
            }
            used = mul_div_ceil(self.x, dy, self.y - dy);
            fee_used = mul_div_ceil(fee, used, dx);
        }
        InnerBuy {
            tokens_out: dy,
            near_used: used,
            fee: fee_used,
            refund: deposit - used - fee_used,
            registration_cost: 0,
        }
    }

    fn quote_sell_inner(&self, amount: u128) -> InnerSell {
        require!(self.y + amount <= self.y0, "Sell exceeds tokens sold by the curve");
        let gross = mul_div(self.x, amount, self.y + amount);
        let fee = bps(gross, self.fee_bps as u128);
        InnerSell { near_out: gross - fee, fee }
    }

    fn log_activity(&mut self, kind: &str, account: &AccountId, near: u128, tokens: u128, memo: Option<String>) {
        let entry = Activity {
            seq: U64(self.activity_count),
            kind: kind.into(),
            account: account.clone(),
            near: U128(near),
            tokens: U128(tokens),
            at_ns: U64(now()),
            memo,
        };
        if self.activity.len() < ACTIVITY_CAP {
            self.activity.push(entry);
        } else {
            let slot = (self.activity_count % ACTIVITY_CAP as u64) as u32;
            self.activity.set(slot, entry);
        }
        self.activity_count += 1;
    }

    fn emit(&self, event: &str, data: String) {
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"oath","version":"1.0.0","event":"{}","data":[{}]}}"#,
            event, data
        ));
    }
}

struct InnerBuy {
    tokens_out: u128,
    near_used: u128,
    fee: u128,
    refund: u128,
    registration_cost: u128,
}

impl InnerBuy {
    fn into_view(self) -> BuyQuote {
        BuyQuote {
            tokens_out: U128(self.tokens_out),
            near_used: U128(self.near_used),
            fee: U128(self.fee),
            refund: U128(self.refund),
            registration_cost: U128(self.registration_cost),
        }
    }
}

struct InnerSell {
    near_out: u128,
    fee: u128,
}

// ---------------------------------------------------------------- NEP-141 with oath hooks

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let sender = env::predecessor_account_id();
        require!(receiver_id != env::current_account_id(), "Sell to the curve instead of transferring to it");
        let was_holder = self.token.ft_balance_of(receiver_id.clone()).0 > 0;
        self.settle(&sender);
        self.settle(&receiver_id);
        self.token.ft_transfer(receiver_id.clone(), amount, memo);
        self.after_transfer(&sender, &receiver_id, was_holder);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let sender = env::predecessor_account_id();
        require!(receiver_id != env::current_account_id(), "Sell to the curve instead of transferring to it");
        let was_holder = self.token.ft_balance_of(receiver_id.clone()).0 > 0;
        self.settle(&sender);
        self.settle(&receiver_id);
        let r = self.token.ft_transfer_call(receiver_id.clone(), amount, memo, msg);
        self.after_transfer(&sender, &receiver_id, was_holder);
        r
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

impl Contract {
    fn after_transfer(&mut self, sender: &AccountId, receiver: &AccountId, receiver_was_holder: bool) {
        self.assert_vesting(sender);
        self.assert_max_wallet(receiver);
        if !receiver_was_holder && !self.is_excluded(receiver) {
            self.holders += 1;
        }
        if self.token.ft_balance_of(sender.clone()).0 == 0 && !self.is_excluded(sender) && self.holders > 0 {
            self.holders -= 1;
        }
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.settle(&sender_id);
        self.settle(&receiver_id);
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Unregistering forfeits nothing silently: it is refused while tokens or payouts remain.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let account = env::predecessor_account_id();
        require!(account != self.creator, "The creator cannot unregister");
        require!(force != Some(true), "Force unregister is disabled; sell or transfer first");
        self.settle(&account);
        let owed = self.checkpoints.get(&account).map(|c| c.owed.0).unwrap_or(0);
        require!(owed == 0, "Claim payouts before unregistering");
        let removed = self.token.internal_storage_unregister(Some(false)).is_some();
        if removed {
            self.checkpoints.remove(&account);
        }
        removed
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests;
