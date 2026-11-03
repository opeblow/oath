use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const DAY: u64 = 86_400;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn near(n: u128) -> u128 {
    n * 10u128.pow(24)
}
fn milli(n: u128) -> u128 {
    n * 10u128.pow(21)
}

fn ctx(pred: &str, deposit: u128, ts_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("pepe.oath.testnet"))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(1_000))
        .block_timestamp(1_700_000_000 * NS + ts_secs * NS);
    testing_env!(b.build());
}

fn params(bonded: Vec<BondedOathInput>) -> LaunchParams {
    LaunchParams {
        name: "Pepe Keeps Promises".into(),
        symbol: "pepe".into(),
        icon: None,
        manifesto: "A frog who keeps his word.".into(),
        total_supply_whole: U128(1_000_000_000),
        creator_alloc_bps: 500,
        vest_cliff_secs: 30 * DAY,
        vest_duration_secs: 60 * DAY,
        virtual_near: U128(near(100)),
        fee_bps: 100,
        max_wallet_bps: 200,
        launch_window_secs: DAY,
        treasury: TreasuryRule {
            recipients: vec![acc("artist.testnet")],
            max_per_period: U128(near(1)),
            period_secs: 7 * DAY,
        },
        bonded,
    }
}

fn heartbeat_oath() -> BondedOathInput {
    BondedOathInput {
        terms: BondedTermsInput::Heartbeat { every_secs: 7 * DAY, for_secs: 28 * DAY },
        stake: U128(near(2)),
    }
}

fn topup_oath() -> BondedOathInput {
    BondedOathInput {
        terms: BondedTermsInput::FloorTopUp { amount: U128(near(1)), within_secs: 3 * DAY },
        stake: U128(near(1)),
    }
}

fn launch(bonded: Vec<BondedOathInput>) -> Contract {
    let bond: u128 = bonded.iter().map(|b| b.stake.0).sum();
    ctx("oath.testnet", bond, 0);
    Contract::new(acc("creator.testnet"), params(bonded))
}

fn bal(c: &Contract, a: &str) -> u128 {
    c.ft_balance_of(acc(a)).0
}

#[test]
fn launch_mints_curve_and_creator_allocation() {
    let c = launch(vec![]);
    let total = 1_000_000_000u128 * 10u128.pow(18);
    assert_eq!(c.ft_total_supply().0, total);
    assert_eq!(bal(&c, "creator.testnet"), total / 20);
    assert_eq!(bal(&c, "pepe.oath.testnet"), total - total / 20);
    let cert = c.get_certificate();
    assert_eq!(cert.symbol, "PEPE");
    assert_eq!(cert.creator_locked_now.0, total / 20);
    assert_eq!(cert.curve.real_near_reserve.0, 0);
}

#[test]
#[should_panic(expected = "Attached deposit must equal the total bond")]
fn launch_requires_exact_bond() {
    ctx("oath.testnet", near(1), 0);
    Contract::new(acc("creator.testnet"), params(vec![heartbeat_oath()]));
}

#[test]
#[should_panic(expected = "Fee is capped at 2%")]
fn fee_cap_is_sealed() {
    ctx("oath.testnet", 0, 0);
    let mut p = params(vec![]);
    p.fee_bps = 500;
    Contract::new(acc("creator.testnet"), p);
}

#[test]
fn buy_then_sell_returns_near_minus_fees() {
    let mut c = launch(vec![]);
    ctx("alice.testnet", near(1), 10);
    let got = c.buy(U128(0)).0;
    assert!(got > 0);
    assert_eq!(bal(&c, "alice.testnet"), got);
    let reserve = c.get_curve().real_near_reserve.0;
    assert!(reserve > 0);

    ctx("alice.testnet", 1, 20);
    let out = c.sell(U128(got), U128(0)).0;
    // Paid 1 NEAR minus registration; gets back roughly 98% (two 1% fees), never more than paid.
    assert!(out < near(1));
    assert!(out > milli(970));
    assert_eq!(bal(&c, "alice.testnet"), 0);
    // Reserve returns to zero (rounding favours the pool).
    assert!(c.get_curve().real_near_reserve.0 < 1_000);
    assert!(c.get_accounting().treasury.0 > 0);
}

#[test]
fn quote_matches_buy() {
    let mut c = launch(vec![]);
    ctx("alice.testnet", 0, 5);
    let q = c.quote_buy(U128(near(1)), Some(acc("alice.testnet")));
    ctx("alice.testnet", near(1), 5);
    let got = c.buy(U128(q.tokens_out.0)).0;
    assert_eq!(got, q.tokens_out.0);
}

#[test]
#[should_panic(expected = "Slippage")]
fn buy_respects_min_out() {
    let mut c = launch(vec![]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(u128::MAX));
}

#[test]
#[should_panic(expected = "Oath: launch max wallet exceeded")]
fn max_wallet_blocks_snipers_during_launch_window() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(30), 5);
    c.buy(U128(0));
}

#[test]
fn max_wallet_lifts_after_window() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(30), DAY + 1);
    let got = c.buy(U128(0)).0;
    assert!(got > bps(c.ft_total_supply().0, 200));
}

#[test]
fn buying_more_than_curve_refunds_the_rest() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(1_000), DAY + 1);
    let got = c.buy(U128(0)).0;
    let curve = c.get_curve();
    assert_eq!(curve.tokens_for_sale.0, 0);
    assert_eq!(got, curve.curve_supply.0);
    assert_eq!(bal(&c, "pepe.oath.testnet"), 0);
}

#[test]
#[should_panic(expected = "Oath: creator tokens are still vesting")]
fn creator_cannot_dump_before_cliff() {
    let mut c = launch(vec![]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));
    ctx("creator.testnet", 1, 10 * DAY);
    c.sell(U128(10u128.pow(18)), U128(0));
}

#[test]
#[should_panic(expected = "Oath: creator tokens are still vesting")]
fn creator_cannot_transfer_locked_tokens() {
    let mut c = launch(vec![]);
    ctx("friend.testnet", near(1), 5);
    c.storage_deposit(None, None);
    ctx("creator.testnet", 1, 10 * DAY);
    c.ft_transfer(acc("friend.testnet"), U128(10u128.pow(18)), None);
}

#[test]
fn creator_vests_linearly_after_cliff() {
    let mut c = launch(vec![]);
    let alloc = c.get_certificate().creator_alloc.0;
    ctx("alice.testnet", near(1), DAY + 1);
    c.buy(U128(0));
    // Halfway through the 60-day vesting after a 30-day cliff.
    ctx("creator.testnet", 1, 60 * DAY);
    let locked = c.get_holder(acc("creator.testnet")).locked.0;
    assert!(locked <= alloc / 2 + 1 && locked >= alloc / 2 - 10u128.pow(18));
    // Can sell what is unlocked (limited by what the curve has sold).
    let sold = c.get_curve().tokens_sold.0;
    c.sell(U128(sold.min(alloc / 4)), U128(0));
    ctx("creator.testnet", 0, 91 * DAY);
    assert_eq!(c.get_holder(acc("creator.testnet")).locked.0, 0);
}

#[test]
#[should_panic(expected = "The creator cannot buy during the launch window")]
fn creator_cannot_snipe_own_launch() {
    let mut c = launch(vec![]);
    ctx("creator.testnet", near(1), 5);
    c.buy(U128(0));
}

#[test]
fn heartbeat_kept_then_reclaimed() {
    let mut c = launch(vec![heartbeat_oath()]);
    for week in 1..=4u64 {
        ctx("creator.testnet", 0, week * 7 * DAY - 60);
        c.heartbeat(format!("week {} update", week));
    }
    ctx("creator.testnet", 0, 28 * DAY + 1);
    assert_eq!(c.get_certificate().bonded[0].status, OathStatus::Kept);
    assert_eq!(c.reclaim_stake(0).0, near(2));
    assert_eq!(c.get_certificate().bond_locked.0, 0);
}

#[test]
fn missed_heartbeat_is_enforced_and_paid_to_holders() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    let a = c.buy(U128(0)).0;
    ctx("bob.testnet", milli(1500), 6);
    let b = c.buy(U128(0)).0;

    ctx("watcher.testnet", 0, 7 * DAY + 1);
    assert_eq!(c.get_certificate().bonded[0].status, OathStatus::Breakable);
    let bounty = c.enforce(0).0;
    assert_eq!(bounty, near(2) / 20);

    let pool = near(2) - bounty;
    let ca = c.get_holder(acc("alice.testnet")).claimable.0;
    let cb = c.get_holder(acc("bob.testnet")).claimable.0;
    assert_eq!(c.get_holder(acc("creator.testnet")).claimable.0, 0);
    assert!(ca + cb <= pool && ca + cb >= pool - 10);
    // Pro rata to balances.
    let expected_a = mul_div(pool, a, a + b);
    assert!(ca.abs_diff(expected_a) < 10);

    ctx("alice.testnet", 0, 7 * DAY + 2);
    assert_eq!(c.claim().0, ca);
    assert_eq!(c.get_holder(acc("alice.testnet")).claimable.0, 0);
    assert_eq!(c.get_certificate().bonded[0].status, OathStatus::Broken);
}

#[test]
fn late_buyers_do_not_get_earlier_payouts() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    ctx("late.testnet", near(1), 7 * DAY + 2);
    c.buy(U128(0));
    assert_eq!(c.get_holder(acc("late.testnet")).claimable.0, 0);
}

#[test]
fn transferred_tokens_keep_payout_with_the_holder_at_enforcement() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    let a = c.buy(U128(0)).0;
    ctx("bob.testnet", near(1), 6);
    c.storage_deposit(None, None);
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    let owed = c.get_holder(acc("alice.testnet")).claimable.0;
    ctx("alice.testnet", 1, 7 * DAY + 2);
    c.ft_transfer(acc("bob.testnet"), U128(a), None);
    assert_eq!(c.get_holder(acc("alice.testnet")).claimable.0, owed);
    assert_eq!(c.get_holder(acc("bob.testnet")).claimable.0, 0);
}

#[test]
#[should_panic(expected = "This oath is not broken")]
fn cannot_enforce_an_active_oath() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("watcher.testnet", 0, DAY);
    c.enforce(0);
}

#[test]
fn floor_top_up_kept_raises_reserve() {
    let mut c = launch(vec![topup_oath()]);
    let before = c.get_curve().spot_price_scaled.0;
    ctx("creator.testnet", near(1), DAY);
    c.add_to_floor();
    let cert = c.get_certificate();
    assert_eq!(cert.bonded[0].status, OathStatus::Kept);
    assert!(cert.curve.spot_price_scaled.0 > before);
    assert_eq!(cert.curve.floor_added.0, near(1));
    assert_eq!(c.reclaim_stake(0).0, near(1));
}

#[test]
fn missed_top_up_with_no_holders_goes_to_floor() {
    let mut c = launch(vec![topup_oath()]);
    ctx("watcher.testnet", 0, 3 * DAY + 1);
    c.enforce(0);
    let curve = c.get_curve();
    assert_eq!(curve.floor_added.0, near(1) - near(1) / 20);
}

#[test]
fn treasury_respects_recipients_and_period_cap() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(200), DAY + 1);
    c.buy(U128(0));
    let t = c.get_accounting().treasury.0;
    assert!(t >= near(1));
    ctx("creator.testnet", 1, DAY + 2);
    c.treasury_spend(acc("artist.testnet"), U128(near(1)), "Commissioned the mascot".into());
    assert_eq!(c.get_certificate().treasury_spent_this_period.0, near(1));
}

#[test]
#[should_panic(expected = "Recipient was not declared at launch")]
fn treasury_rejects_undeclared_recipient() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(200), DAY + 1);
    c.buy(U128(0));
    ctx("creator.testnet", 1, DAY + 2);
    c.treasury_spend(acc("creator.testnet"), U128(1), "pay me".into());
}

#[test]
#[should_panic(expected = "Over the treasury limit for this period")]
fn treasury_rejects_overspend() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(300), DAY + 1);
    c.buy(U128(0));
    ctx("creator.testnet", 1, DAY + 2);
    c.treasury_spend(acc("artist.testnet"), U128(near(1)), "first".into());
    c.treasury_spend(acc("artist.testnet"), U128(1), "second".into());
}

#[test]
fn activity_log_is_newest_first_and_capped() {
    let mut c = launch(vec![]);
    for i in 0..80u64 {
        ctx("alice.testnet", milli(100), DAY + 10 + i);
        c.buy(U128(0));
    }
    let log = c.get_activity(0, 10);
    assert_eq!(log.len(), 10);
    assert_eq!(log[0].seq.0, 80);
    assert_eq!(log[1].seq.0, 79);
    assert_eq!(c.get_activity(0, 64).len(), 64);
}

#[test]
#[should_panic(expected = "Sell to the curve instead of transferring to it")]
fn cannot_transfer_into_curve() {
    let mut c = launch(vec![]);
    ctx("alice.testnet", near(1), 5);
    let a = c.buy(U128(0)).0;
    ctx("alice.testnet", 1, 6);
    c.ft_transfer(acc("pepe.oath.testnet"), U128(a), None);
}
