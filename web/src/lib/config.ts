export type Network = "testnet" | "mainnet";

export interface NetworkConfig {
  network: Network;
  factoryId: string;
  /** Base58 hash of the published OATH token code (a NEAR global contract). */
  tokenCodeHash: string;
  rpc: string[];
  explorer: string;
}

const TESTNET: NetworkConfig = {
  network: "testnet",
  factoryId: import.meta.env.VITE_FACTORY_ID ?? "oathcoin.testnet",
  tokenCodeHash: import.meta.env.VITE_TOKEN_CODE_HASH ?? "DjVgSpu5TjKGe4BDjmLpQGGpLB5d7U1xRjSCoLsouKmi",
  rpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  explorer: "https://testnet.nearblocks.io",
};

export const config: NetworkConfig = TESTNET;

/** Base URL of the OATH API (NEAR AI auditor and helpers). Empty means same origin. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

/** NEAR Intents 1Click API (mainnet only; quotes work without a key). */
export const ONECLICK_API = "https://1click.chaindefuser.com/v0";

export const explorerTx = (hash: string) => `${config.explorer}/txns/${hash}`;
export const explorerAccount = (id: string) => `${config.explorer}/address/${id}`;
