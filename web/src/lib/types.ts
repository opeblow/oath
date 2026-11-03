// Types mirror the JSON views of the OATH token and factory contracts.

export type OathStatus = "active" | "breakable" | "broken" | "kept";

export interface TreasuryRule {
  recipients: string[];
  max_per_period: string;
  period_secs: number;
}

export interface BondedOathView {
  index: number;
  kind: "heartbeat" | "floor_top_up";
  stake: string;
  status: OathStatus;
  reclaimed: boolean;
  enforced_by: string | null;
  every_secs: number | null;
  amount: string | null;
  ends_at_ns: string;
  next_due_ns: string | null;
  last_beat_ns: string | null;
  deposited: string | null;
}

export interface CurveView {
  near_reserve_virtual: string;
  token_reserve_virtual: string;
  real_near_reserve: string;
  tokens_for_sale: string;
  tokens_sold: string;
  curve_supply: string;
  spot_price_scaled: string;
  floor_added: string;
}

export interface Accounting {
  contract_balance: string;
  storage_cost: string;
  real_near_reserve: string;
  treasury: string;
  bond_locked: string;
  unclaimed_payouts: string;
  liabilities: string;
  solvent: boolean;
}

export interface Certificate {
  contract_id: string;
  factory_id: string;
  creator: string;
  name: string;
  symbol: string;
  icon: string | null;
  manifesto: string;
  decimals: number;
  total_supply: string;
  launched_at_ns: string;
  creator_alloc: string;
  creator_locked_now: string;
  vest_cliff_ns: string;
  vest_end_ns: string;
  fee_bps: number;
  max_wallet_bps: number;
  launch_window_end_ns: string;
  treasury_rule: TreasuryRule;
  treasury_spent_this_period: string;
  treasury_period_index: number;
  bonded: BondedOathView[];
  bond_total: string;
  bond_locked: string;
  payouts_distributed: string;
  holders: number;
  curve: CurveView;
  accounting: Accounting;
  activity_count: string;
  now_ns: string;
}

export interface HolderView {
  account_id: string;
  registered: boolean;
  balance: string;
  locked: string;
  claimable: string;
}

export interface BuyQuote {
  tokens_out: string;
  near_used: string;
  fee: string;
  refund: string;
  registration_cost: string;
}

export interface SellQuote {
  near_out: string;
  fee: string;
}

export interface Activity {
  seq: string;
  kind: string;
  account: string;
  near: string;
  tokens: string;
  at_ns: string;
  memo: string | null;
}

export interface CoinEntry {
  coin_id: string;
  creator: string;
  symbol: string;
  name: string;
  created_at_ns: string;
  bond: string;
}

export interface BondedOathInput {
  terms:
    | { kind: "heartbeat"; every_secs: number; for_secs: number }
    | { kind: "floor_top_up"; amount: string; within_secs: number };
  stake: string;
}

export interface LaunchParams {
  name: string;
  symbol: string;
  icon: string | null;
  manifesto: string;
  total_supply_whole: string;
  creator_alloc_bps: number;
  vest_cliff_secs: number;
  vest_duration_secs: number;
  virtual_near: string;
  fee_bps: number;
  max_wallet_bps: number;
  launch_window_secs: number;
  treasury: TreasuryRule;
  bonded: BondedOathInput[];
}
