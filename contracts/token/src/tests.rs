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

// ---------------------------------------------------------------- enforcement, exactly once

fn status(c: &Contract, i: usize) -> OathStatus {
    c.get_certificate().bonded[i].status
}

fn liabilities(c: &Contract) -> u128 {
    c.get_accounting().liabilities.0
}

#[test]
#[should_panic(expected = "This oath is not broken")]
fn a_broken_oath_cannot_be_enforced_twice() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    ctx("second.testnet", 0, 7 * DAY + 2);
    c.enforce(0);
}

#[test]
#[should_panic(expected = "No such oath")]
fn enforcing_an_unknown_oath_fails() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(1);
}

#[test]
fn each_broken_oath_is_enforced_separately_and_the_pools_add_up() {
    let mut c = launch(vec![heartbeat_oath(), topup_oath()]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));

    // Day 3: the top-up is overdue, the weekly heartbeat is not.
    ctx("watcher.testnet", 0, 3 * DAY + 1);
    assert_eq!(status(&c, 0), OathStatus::Active);
    assert_eq!(status(&c, 1), OathStatus::Breakable);
    assert_eq!(c.enforce(1).0, near(1) / 20);
    let cert = c.get_certificate();
    assert_eq!(cert.bond_total.0, near(3));
    assert_eq!(cert.bond_locked.0, near(2));
    assert_eq!(cert.bonded[0].status, OathStatus::Active);
    assert_eq!(cert.bonded[1].status, OathStatus::Broken);
    assert_eq!(cert.bonded[1].enforced_by, Some(acc("watcher.testnet")));

    // Day 7: the heartbeat is overdue too. A different account enforces it.
    ctx("second.testnet", 0, 7 * DAY + 1);
    assert_eq!(c.enforce(0).0, near(2) / 20);
    let cert = c.get_certificate();
    assert_eq!(cert.bond_locked.0, 0);
    let pools = near(3) - near(3) / 20;
    assert_eq!(cert.payouts_distributed.0 + cert.curve.floor_added.0, pools);
    assert_eq!(cert.accounting.unclaimed_payouts.0, cert.payouts_distributed.0);
    let owed = c.get_holder(acc("alice.testnet")).claimable.0;
    assert!(owed <= pools && owed + 4 >= pools);
}

// ---------------------------------------------------------------- claims, rounding and dust

#[test]
fn three_holders_claim_in_proportion_to_their_balances() {
    let mut c = launch(vec![heartbeat_oath()]);
    let buys = [("alice.testnet", milli(500)), ("bob.testnet", near(1)), ("carol.testnet", milli(1500))];
    let mut bals = vec![];
    for (i, &(who, amount)) in buys.iter().enumerate() {
        ctx(who, amount, 5 + i as u64);
        bals.push(c.buy(U128(0)).0);
    }
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    let bounty = c.enforce(0).0;
    let pool = near(2) - bounty;
    let total: u128 = bals.iter().sum();
    let mut paid = 0u128;
    for (i, &(who, _)) in buys.iter().enumerate() {
        ctx(who, 0, 7 * DAY + 2);
        let got = c.claim().0;
        assert!(got.abs_diff(mul_div(pool, bals[i], total)) <= 2);
        assert_eq!(c.get_holder(acc(who)).claimable.0, 0);
        paid += got;
    }
    assert!(paid <= pool && paid + 6 >= pool);
    // Whatever rounding left behind stays on the books as a liability; it is never over-paid.
    assert!(c.get_accounting().unclaimed_payouts.0 < 4);
    assert_eq!(c.get_certificate().holders, 3);
}

#[test]
fn payout_rounding_dust_goes_to_the_floor() {
    let stake = milli(100) + 12_345_677;
    let oath = BondedOathInput {
        terms: BondedTermsInput::FloorTopUp { amount: U128(near(1)), within_secs: 3 * DAY },
        stake: U128(stake),
    };
    let mut c = launch(vec![oath]);
    let buys = [("alice.testnet", milli(333)), ("bob.testnet", milli(777)), ("carol.testnet", milli(1111))];
    for (i, &(who, amount)) in buys.iter().enumerate() {
        ctx(who, amount, 5 + i as u64);
        c.buy(U128(0));
    }
    ctx("watcher.testnet", 0, 3 * DAY + 1);
    let bounty = c.enforce(0).0;
    assert_eq!(bounty, stake * 500 / 10_000);
    let pool = stake - bounty;
    let cert = c.get_certificate();
    // Bounty + paid to holders + dust added to the floor == the stake. Nothing is lost.
    assert_eq!(cert.payouts_distributed.0 + cert.curve.floor_added.0, pool);
    assert!(cert.curve.floor_added.0 <= 2);
    let sum: u128 = buys.iter().map(|&(who, _)| c.get_holder(acc(who)).claimable.0).sum();
    assert!(sum <= cert.payouts_distributed.0 && sum + 4 >= cert.payouts_distributed.0);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn a_payout_is_claimed_only_once() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    ctx("alice.testnet", 0, 7 * DAY + 2);
    assert!(c.claim().0 > 0);
    c.claim();
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn the_creator_earns_nothing_from_their_own_broken_oath() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    // The creator holds 5% of supply but is excluded from the payout.
    ctx("creator.testnet", 0, 7 * DAY + 2);
    c.claim();
}

#[test]
fn a_holder_who_sells_everything_keeps_the_payout_already_earned() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    let a = c.buy(U128(0)).0;
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    let owed = c.get_holder(acc("alice.testnet")).claimable.0;
    assert!(owed > 0);
    ctx("alice.testnet", 1, 7 * DAY + 2);
    c.sell(U128(a), U128(0));
    assert_eq!(c.get_holder(acc("alice.testnet")).claimable.0, owed);
    assert_eq!(c.get_certificate().holders, 0);
    ctx("alice.testnet", 0, 7 * DAY + 3);
    assert_eq!(c.claim().0, owed);
}

#[test]
#[should_panic(expected = "Claim payouts before unregistering")]
fn cannot_unregister_while_a_payout_is_owed() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    let a = c.buy(U128(0)).0;
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    ctx("alice.testnet", 1, 7 * DAY + 2);
    c.sell(U128(a), U128(0));
    ctx("alice.testnet", 1, 7 * DAY + 3);
    c.storage_unregister(None);
}

// ---------------------------------------------------------------- deadlines: expired and not

#[test]
fn heartbeat_deadline_is_exclusive() {
    let mut c = launch(vec![heartbeat_oath()]);
    // Exactly on the deadline the oath is still alive and the creator can still check in.
    ctx("creator.testnet", 0, 7 * DAY);
    assert_eq!(status(&c, 0), OathStatus::Active);
    c.heartbeat("right on time".into());
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    assert_eq!(status(&c, 0), OathStatus::Active);
}

#[test]
#[should_panic(expected = "No active heartbeat oath")]
fn a_late_heartbeat_cannot_rescue_a_missed_one() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("creator.testnet", 0, 7 * DAY + 1);
    c.heartbeat("sorry, late".into());
}

#[test]
fn a_missed_heartbeat_stays_enforceable_after_the_term_ends() {
    let mut c = launch(vec![heartbeat_oath()]);
    // Nobody enforced during the 28-day term. Waiting does not turn "missed" into "kept".
    ctx("watcher.testnet", 0, 40 * DAY);
    assert_eq!(status(&c, 0), OathStatus::Breakable);
    assert_eq!(c.enforce(0).0, near(2) / 20);
    assert_eq!(status(&c, 0), OathStatus::Broken);
}

#[test]
#[should_panic(expected = "Oath is not kept yet")]
fn the_creator_cannot_outwait_a_missed_heartbeat() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("creator.testnet", 0, 40 * DAY);
    c.reclaim_stake(0);
}

#[test]
#[should_panic(expected = "This oath is not broken")]
fn a_kept_heartbeat_cannot_be_enforced() {
    let mut c = launch(vec![heartbeat_oath()]);
    for week in 1..=4u64 {
        ctx("creator.testnet", 0, week * 7 * DAY - 60);
        c.heartbeat(format!("week {} update", week));
    }
    ctx("watcher.testnet", 0, 28 * DAY + 1);
    c.enforce(0);
}

#[test]
fn floor_oath_counts_only_creator_deposits_made_in_time() {
    let mut c = launch(vec![topup_oath()]);
    // Anyone may add to the floor, but a stranger's deposit does not keep the creator's promise.
    ctx("alice.testnet", near(1), DAY);
    c.add_to_floor();
    let cert = c.get_certificate();
    assert_eq!(cert.bonded[0].status, OathStatus::Active);
    assert_eq!(cert.bonded[0].deposited.unwrap().0, 0);
    // The creator may pay in parts, up to and including the deadline.
    ctx("creator.testnet", milli(400), DAY + 1);
    c.add_to_floor();
    assert_eq!(status(&c, 0), OathStatus::Active);
    assert_eq!(c.get_certificate().bonded[0].deposited.unwrap().0, milli(400));
    ctx("creator.testnet", milli(600), 3 * DAY);
    c.add_to_floor();
    assert_eq!(status(&c, 0), OathStatus::Kept);
    assert_eq!(c.get_curve().floor_added.0, near(2));
}

#[test]
fn a_late_floor_deposit_does_not_save_the_oath() {
    let mut c = launch(vec![topup_oath()]);
    ctx("creator.testnet", near(1), 3 * DAY + 1);
    c.add_to_floor();
    let cert = c.get_certificate();
    assert_eq!(cert.bonded[0].status, OathStatus::Breakable);
    assert_eq!(cert.bonded[0].deposited.unwrap().0, 0);
    ctx("watcher.testnet", 0, 3 * DAY + 2);
    assert_eq!(c.enforce(0).0, near(1) / 20);
}

#[test]
#[should_panic(expected = "This oath is not broken")]
fn a_kept_floor_oath_cannot_be_enforced_after_its_deadline() {
    let mut c = launch(vec![topup_oath()]);
    ctx("creator.testnet", near(1), DAY);
    c.add_to_floor();
    ctx("watcher.testnet", 0, 30 * DAY);
    c.enforce(0);
}

// ---------------------------------------------------------------- bond accounting and reclaim

#[test]
fn bond_accounting_follows_each_oath() {
    let mut c = launch(vec![heartbeat_oath(), topup_oath()]);
    assert_eq!(c.get_certificate().bond_total.0, near(3));
    assert_eq!(c.get_certificate().bond_locked.0, near(3));
    // Keep the top-up and take that stake back.
    ctx("creator.testnet", near(1), DAY);
    c.add_to_floor();
    ctx("creator.testnet", 0, DAY + 1);
    assert_eq!(c.reclaim_stake(1).0, near(1));
    let cert = c.get_certificate();
    assert_eq!(cert.bond_total.0, near(3));
    assert_eq!(cert.bond_locked.0, near(2));
    assert!(cert.bonded[1].reclaimed);
    // Break the heartbeat: the rest of the bond leaves through enforcement.
    ctx("watcher.testnet", 0, 7 * DAY + 1);
    c.enforce(0);
    assert_eq!(c.get_certificate().bond_locked.0, 0);
}

#[test]
#[should_panic(expected = "Already reclaimed")]
fn a_kept_stake_is_reclaimed_only_once() {
    let mut c = launch(vec![topup_oath()]);
    ctx("creator.testnet", near(1), DAY);
    c.add_to_floor();
    ctx("creator.testnet", 0, DAY + 1);
    c.reclaim_stake(0);
    c.reclaim_stake(0);
}

#[test]
#[should_panic(expected = "Oath is not kept yet")]
fn an_active_oath_cannot_be_reclaimed() {
    let mut c = launch(vec![topup_oath()]);
    ctx("creator.testnet", 0, DAY);
    c.reclaim_stake(0);
}

#[test]
#[should_panic(expected = "Oath is not kept yet")]
fn a_broken_oath_cannot_be_reclaimed() {
    let mut c = launch(vec![topup_oath()]);
    ctx("watcher.testnet", 0, 3 * DAY + 1);
    c.enforce(0);
    ctx("creator.testnet", 0, 3 * DAY + 2);
    c.reclaim_stake(0);
}

#[test]
#[should_panic(expected = "Only the creator can do this")]
fn only_the_creator_reclaims_a_kept_stake() {
    let mut c = launch(vec![topup_oath()]);
    ctx("creator.testnet", near(1), DAY);
    c.add_to_floor();
    ctx("alice.testnet", 0, DAY + 1);
    c.reclaim_stake(0);
}

// ---------------------------------------------------------------- vesting boundaries

#[test]
fn vesting_lock_is_full_until_the_cliff_and_zero_at_the_end() {
    let c = launch(vec![]);
    let alloc = c.get_certificate().creator_alloc.0;
    let locked = |t: u64| {
        ctx("creator.testnet", 0, t);
        c.get_holder(acc("creator.testnet")).locked.0
    };
    assert_eq!(locked(0), alloc);
    assert_eq!(locked(30 * DAY), alloc);
    assert_eq!(locked(60 * DAY), alloc / 2);
    assert!(locked(90 * DAY - 1) > 0);
    assert_eq!(locked(90 * DAY), 0);
    let mut prev = alloc;
    for d in 0..=95u64 {
        let l = locked(d * DAY);
        assert!(l <= prev, "the lock never grows");
        prev = l;
    }
}

#[test]
fn creator_can_move_exactly_the_vested_amount() {
    let mut c = launch(vec![]);
    let alloc = c.get_certificate().creator_alloc.0;
    ctx("friend.testnet", near(1), 5);
    c.storage_deposit(None, None);
    ctx("creator.testnet", 1, 60 * DAY);
    c.ft_transfer(acc("friend.testnet"), U128(alloc / 2), None);
    assert_eq!(bal(&c, "friend.testnet"), alloc / 2);
    assert_eq!(bal(&c, "creator.testnet"), alloc / 2);
}

#[test]
#[should_panic(expected = "Oath: creator tokens are still vesting")]
fn creator_cannot_move_one_unit_more_than_vested() {
    let mut c = launch(vec![]);
    let alloc = c.get_certificate().creator_alloc.0;
    ctx("friend.testnet", near(1), 5);
    c.storage_deposit(None, None);
    ctx("creator.testnet", 1, 60 * DAY);
    c.ft_transfer(acc("friend.testnet"), U128(alloc / 2 + 1), None);
}

#[test]
#[should_panic(expected = "Creator allocation is capped at 10%")]
fn creator_allocation_cap_is_sealed() {
    ctx("oath.testnet", 0, 0);
    let mut p = params(vec![]);
    p.creator_alloc_bps = 1_001;
    Contract::new(acc("creator.testnet"), p);
}

#[test]
#[should_panic(expected = "Sell exceeds tokens sold by the curve")]
fn vested_creator_tokens_cannot_take_more_near_than_buyers_put_in() {
    let mut c = launch(vec![]);
    // Fully vested, but nobody has bought: there is no reserve to sell into.
    ctx("creator.testnet", 1, 91 * DAY);
    c.sell(U128(10u128.pow(18)), U128(0));
}

// ---------------------------------------------------------------- treasury restrictions

#[test]
fn treasury_cap_resets_each_period() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(300), DAY + 1);
    c.buy(U128(0));
    ctx("creator.testnet", 1, DAY + 2);
    c.treasury_spend(acc("artist.testnet"), U128(near(1)), "week one".into());
    ctx("creator.testnet", 1, 7 * DAY + 10);
    let cert = c.get_certificate();
    assert_eq!(cert.treasury_spent_this_period.0, 0);
    assert_eq!(cert.treasury_period_index, 1);
    c.treasury_spend(acc("artist.testnet"), U128(near(1)), "week two".into());
    assert_eq!(c.get_certificate().treasury_spent_this_period.0, near(1));
}

#[test]
#[should_panic(expected = "Only the creator can do this")]
fn only_the_creator_spends_the_treasury() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(200), DAY + 1);
    c.buy(U128(0));
    ctx("artist.testnet", 1, DAY + 2);
    c.treasury_spend(acc("artist.testnet"), U128(1), "paying myself".into());
}

#[test]
#[should_panic(expected = "Not enough in the treasury")]
fn treasury_cannot_reach_the_reserve_or_the_bond() {
    let mut c = launch(vec![heartbeat_oath()]);
    ctx("alice.testnet", near(1), 5);
    c.buy(U128(0));
    // The contract holds about 3 NEAR (bond + reserve) but the treasury only holds the fee.
    assert!(c.get_accounting().treasury.0 < milli(11));
    ctx("creator.testnet", 1, DAY);
    c.treasury_spend(acc("artist.testnet"), U128(milli(500)), "reach for the reserve".into());
}

#[test]
#[should_panic(expected = "A public memo is required")]
fn treasury_spend_needs_a_public_memo() {
    let mut c = launch(vec![]);
    ctx("whale.testnet", near(200), DAY + 1);
    c.buy(U128(0));
    ctx("creator.testnet", 1, DAY + 2);
    c.treasury_spend(acc("artist.testnet"), U128(1), "   ".into());
}

// ---------------------------------------------------------------- conservation of NEAR

/// Every yoctoNEAR that enters the contract sits in exactly one bucket (reserve, treasury,
/// bond, unclaimed payouts) until it leaves. `liabilities` must move by exactly what came in
/// or went out on every step of a full lifecycle.
#[test]
fn every_yocto_is_accounted_for_through_a_full_lifecycle() {
    let mut c = launch(vec![heartbeat_oath(), topup_oath()]);
    let mut expected = near(3);
    assert_eq!(liabilities(&c), expected);

    let buys = [("alice.testnet", near(1), 5u64), ("bob.testnet", milli(700), 6), ("carol.testnet", milli(1300), 7)];
    for &(who, amount, ts) in buys.iter() {
        ctx(who, 0, ts);
        let q = c.quote_buy(U128(amount), Some(acc(who)));
        ctx(who, amount, ts);
        c.buy(U128(0));
        expected += q.near_used.0 + q.fee.0;
        assert_eq!(liabilities(&c), expected);
    }

    let half = bal(&c, "alice.testnet") / 2;
    ctx("alice.testnet", 1, 100);
    expected -= c.sell(U128(half), U128(0)).0;
    assert_eq!(liabilities(&c), expected);

    ctx("creator.testnet", near(1), DAY);
    c.add_to_floor();
    expected += near(1);
    assert_eq!(liabilities(&c), expected);

    ctx("creator.testnet", 0, DAY + 1);
    expected -= c.reclaim_stake(1).0;
    assert_eq!(liabilities(&c), expected);

    ctx("watcher.testnet", 0, 7 * DAY + 1);
    expected -= c.enforce(0).0;
    assert_eq!(liabilities(&c), expected);

    for &(who, _, _) in buys.iter() {
        ctx(who, 0, 7 * DAY + 2);
        expected -= c.claim().0;
        assert_eq!(liabilities(&c), expected);
    }

    let t = c.get_accounting().treasury.0;
    ctx("creator.testnet", 1, 7 * DAY + 3);
    c.treasury_spend(acc("artist.testnet"), U128(t), "Paid the artist".into());
    expected -= t;
    assert_eq!(liabilities(&c), expected);

    let a = c.get_accounting();
    assert_eq!(a.bond_locked.0, 0);
    assert_eq!(a.treasury.0, 0);
    assert!(a.unclaimed_payouts.0 < 4);
    assert_eq!(a.liabilities.0, a.real_near_reserve.0 + a.unclaimed_payouts.0);
}
