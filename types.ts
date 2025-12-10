export interface Token {
  address: string;
  decimals: number;
  symbol: string;
}

export interface TokenBalance {
  raw: bigint;
  formatted: string;
  symbol: string;
}

export interface SwapQuote {
  amountIn: string;
  amountOut: string;
  fromToken: string;
  toToken: string;
  fee: number;
  priceImpact: number;
}

export interface SwapResult {
  success: boolean;
  transactionHash?: string;
  approvalHash?: string;
  amountIn?: string;
  amountOut?: string;
  fromToken?: string;
  toToken?: string;
  gasUsed?: string;
  gasCost?: string;
  error?: string;
}

export interface WalletSummary {
  address: string;
  balances: {
    ETH: TokenBalance;
    USDC: TokenBalance;
    RLUSD: TokenBalance;
  };
}

export interface DepositResult {
  status: 'success' | 'error';
  operation: 'deposit_only' | 'deposit_and_swap' | 'deposit';
  originalAmount?: string;
  originalToken?: string;
  finalAmount?: string;
  finalToken?: string;
  transactionHash?: string;
  gasCost?: string;
  amount?: string;
  token?: string;
  error?: string;
}

export interface QuoteResponse {
  status: 'success' | 'error';
  quote?: {
    amountIn: string;
    amountOut: string;
    fromToken: string;
    toToken: string;
    exchangeRate: string;
    fee: number;
    priceImpact: string;
  };
  error?: string;
}

export interface RebalanceResult {
  status: 'success' | 'error';
  message?: string;
  rebalance?: SwapResult;
  newBalances?: WalletSummary;
  error?: string;
}

export interface HealthAlert {
  type: 'low_eth' | 'low_usdc' | 'low_rlusd';
  message: string;
}

export interface WalletHealth {
  status: 'healthy' | 'warning';
  balances: WalletSummary['balances'];
  alerts: HealthAlert[];
}

export interface DepositVerification {
  transactionHash: string;
  userAddress: string;
  amount: string;
  blockNumber: number;
  timestamp: Date;
  verified: boolean;
}

export type TokenSymbol = 'USDC' | 'RLUSD' | 'WETH';

export interface PoolInfo {
  poolContract: any;
  fee: number;
  poolAddress: string;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  deadline: number;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96: number;
}

export interface DepositTrackingResult {
  success: boolean;
  trackingId?: string;
  backendWallet?: string;
  message?: string;
  error?: string;
}

export interface DepositVerificationResult {
  verified: boolean;
  deposit?: DepositVerification;
  error?: string;
}