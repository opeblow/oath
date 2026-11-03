//! Reads an OATH certificate (the JSON from `get_certificate`) on stdin and prints the audit on stdout.
//! Rules match web/src/lib/audit.ts (oath-audit/1); the parity test in web checks ids, severities and grade.

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;

const NS: u128 = 1_000_000_000;
const DAY: u128 = 86_400;
const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;

#[derive(Deserialize)]
struct Rule { recipients: Vec<String>, max_per_period: String, period_secs: u64 }
#[derive(Deserialize)]
struct Bonded { index: u32, status: String, kind: String, next_due_ns: Option<String>, enforced_by: Option<String> }
#[derive(Deserialize)]
struct Accounting { solvent: bool }
#[derive(Deserialize)]
struct Cert {
    contract_id: String,
    creator: String,
    total_supply: String,
    launched_at_ns: String,
    creator_alloc: String,
    vest_cliff_ns: String,
    vest_end_ns: String,
    fee_bps: u32,
    max_wallet_bps: u32,
    launch_window_end_ns: String,
    treasury_rule: Rule,
    bonded: Vec<Bonded>,
    bond_total: String,
    accounting: Accounting,
    now_ns: String,
}

fn n(s: &str) -> u128 { s.parse().unwrap_or(0) }
fn pct(bps: u128) -> String { format!("{}%", trim(bps as f64 / 100.0)) }
fn trim(x: f64) -> String { let s = format!("{:.2}", x); s.trim_end_matches('0').trim_end_matches('.').to_string() }
fn near(y: u128) -> String { trim(y as f64 / 1e24) }
fn days(secs: u128) -> String { trim(secs as f64 / 86_400.0) + " days" }

fn finding(id: &str, severity: &str, title: String, detail: &str) -> Value {
    json!({ "id": id, "severity": severity, "title": title, "detail": detail })
}

fn audit(c: &Cert) -> Value {
    let mut f = Vec::new();
    let launched = n(&c.launched_at_ns);
    let now = n(&c.now_ns);
    let secs = |ns: &str| n(ns).saturating_sub(launched) / NS;

    f.push(if c.accounting.solvent {
        finding("solvent", "ok", "Fully backed".into(), "The contract balance covers liquidity, treasury, bond, payouts and storage.")
    } else {
        finding("solvent", "risk", "Not fully backed".into(), "The contract balance is below its liabilities.")
    });

    let alloc = n(&c.creator_alloc);
    if alloc == 0 {
        f.push(finding("alloc", "ok", "No creator allocation".into(), "Every token was sold through the curve."));
    } else {
        let share = alloc * 10_000 / n(&c.total_supply).max(1);
        let (cliff, end) = (secs(&c.vest_cliff_ns), secs(&c.vest_end_ns));
        f.push(finding("alloc", if share > 500 { "note" } else { "ok" }, format!("Creator holds {} of supply", pct(share)), if share > 500 { "Above 5%. Vesting limits how fast it can be sold." } else { "A small allocation." }));
        let short = cliff < 30 * DAY || end < 90 * DAY;
        f.push(finding("vesting", if short { "warn" } else { "ok" }, format!("Vesting: {} cliff, fully unlocked after {}", days(cliff), days(end)), if short { "Short. The creator can start selling soon after launch." } else { "The creator cannot sell early." }));
    }

    let window = secs(&c.launch_window_end_ns);
    let (sev, detail) = if c.max_wallet_bps > 300 {
        ("warn", "A loose cap. A few wallets can take a large share at launch.")
    } else if window < 3_600 {
        ("note", "A short window. Snipers only wait it out briefly.")
    } else {
        ("ok", "Limits early accumulation.")
    };
    f.push(finding("maxwallet", sev, format!("Max {} per wallet for {}", pct(c.max_wallet_bps as u128), days(window)), detail));

    f.push(finding("fee", if c.fee_bps > 100 { "note" } else { "ok" }, format!("Trading fee {}", pct(c.fee_bps as u128)), if c.fee_bps > 100 { "Above 1%. It funds the treasury." } else { "Fixed forever." }));

    let t = &c.treasury_rule;
    let self_pay = t.recipients.contains(&c.creator);
    f.push(finding("treasury", if self_pay { "warn" } else { "ok" }, format!("Treasury: {} NEAR per {} to {} account(s)", near(n(&t.max_per_period)), days(t.period_secs as u128), t.recipients.len()), if self_pay { "The creator's own account is a declared recipient." } else { "Only declared accounts, with a public memo for each spend." }));

    if c.bonded.is_empty() {
        f.push(finding("bond", "warn", "No bonded oaths".into(), "The creator staked nothing on future behaviour."));
    } else {
        let total = n(&c.bond_total);
        f.push(finding("bond", if total < YOCTO { "note" } else { "ok" }, format!("{} bonded oath(s), {} NEAR staked", c.bonded.len(), near(total)), if total < YOCTO { "Under 1 NEAR. Breaking a promise is cheap." } else { "Breaking a promise pays holders." }));
    }
    for b in &c.bonded {
        let id = format!("oath-{}", b.index + 1);
        match b.status.as_str() {
            "breakable" => f.push(finding(&id, "risk", format!("Bonded oath {} is broken", b.index + 1), "Anyone can enforce it now and the stake goes to holders.")),
            "broken" => f.push(finding(&id, "risk", format!("Bonded oath {} was broken{}", b.index + 1, b.enforced_by.as_ref().map(|e| format!(", enforced by {e}")).unwrap_or_default()), "The creator did not keep this promise.")),
            "active" => {
                if let Some(due) = &b.next_due_ns {
                    if n(due).saturating_sub(now) < DAY * NS {
                        f.push(finding(&id, "note", format!("Bonded oath {} is due within a day", b.index + 1), "Watch whether the creator posts an update in time."));
                    }
                }
                let _ = &b.kind;
            }
            _ => {}
        }
    }

    let count = |s: &str| f.iter().filter(|x| x["severity"] == s).count();
    let (ok, note, warn, risk) = (count("ok"), count("note"), count("warn"), count("risk"));
    let grade = if risk > 0 { "D" } else if warn > 1 { "C" } else if warn == 1 { "B" } else { "A" };
    json!({
        "version": "oath-audit/1",
        "coin_id": c.contract_id,
        "certificate_now_ns": c.now_ns,
        "grade": grade,
        "counts": { "ok": ok, "note": note, "warn": warn, "risk": risk },
        "findings": f,
    })
}

fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).expect("read stdin");
    let out = match serde_json::from_str::<Value>(&raw) {
        // Accept the certificate itself or {"certificate": {...}}.
        Ok(v) => {
            let cert = v.get("certificate").cloned().unwrap_or(v);
            match serde_json::from_value::<Cert>(cert) {
                Ok(c) => audit(&c),
                Err(e) => json!({ "error": format!("invalid certificate: {e}") }),
            }
        }
        Err(e) => json!({ "error": format!("invalid JSON: {e}") }),
    };
    print!("{out}");
}
