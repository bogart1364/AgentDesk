import { http, createConfig, WagmiProvider as PlainWagmiProvider } from 'wagmi';
import { baseSepolia, base } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';
import {
  createConfig as privyCreateConfig,
  WagmiProvider as PrivyWagmiProvider,
} from '@privy-io/wagmi';

// Privy login is active when an app id is provided at build time.
// Without it the app falls back to the SIWE (wallet sign-in) flow.
export const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);

export const TARGET_CHAIN = import.meta.env.VITE_CHAIN_ID === '8453' ? base : baseSepolia;

const transports = {
  [baseSepolia.id]: http(import.meta.env.VITE_RPC_URL || 'https://sepolia.base.org'),
  [base.id]: http(import.meta.env.VITE_RPC_URL || 'https://mainnet.base.org'),
};

export const wagmiConfig = PRIVY_ENABLED
  ? // Privy drives the connectors itself (embedded + external wallets)
    privyCreateConfig({
      chains: [TARGET_CHAIN],
      transports,
      ssr: false,
    })
  : createConfig({
      chains: [TARGET_CHAIN],
      connectors: [
        // Coinbase Wallet first (extension or SDK popup) — Base-native login
        coinbaseWallet({
          appName: 'AgentDesk',
          preference: 'all',
        }),
        // fallback: any injected wallet (MetaMask / Rabby / Rainbow)
        injected({ shimDisconnect: true }),
      ],
      transports,
      ssr: false,
    });

export const WagmiProvider = PRIVY_ENABLED ? PrivyWagmiProvider : PlainWagmiProvider;

export const CHAIN_ID = TARGET_CHAIN.id;
export const CHAIN_NAME = TARGET_CHAIN.name;

// contract addresses injected at build time (Vercel env)
export const CONTRACTS = {
  registry: import.meta.env.VITE_AGENT_REGISTRY_ADDRESS || null,
  policy: import.meta.env.VITE_POLICY_ENGINE_ADDRESS || null,
  usdc: import.meta.env.VITE_USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

export const CHAIN_MODE = CONTRACTS.registry && CONTRACTS.policy ? 'chain' : 'local';
