import { ethers } from 'ethers';
import FACTORY_ABI from './abis/factory.json' with { type: 'json' };
import QUOTER_ABI from './abis/quoter.json' with { type: 'json' };
import SWAP_ROUTER_ABI from './abis/swaprouter.json' with { type: 'json' };
import POOL_ABI from './abis/pool.json' with { type: 'json' };
import TOKEN_IN_ABI from './abis/weth.json' with { type: 'json' };
import 'dotenv/config';
import type {
  Token,
  TokenBalance,
  SwapQuote,
  SwapResult,
  WalletSummary,
  TokenSymbol,
  PoolInfo,
  SwapParams
} from './types.js';

const CONTRACTS = {
  FACTORY: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  QUOTER: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  SWAP_ROUTER: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
} as const;

const TOKENS: Record<TokenSymbol, Token> = {
  USDC: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    symbol: 'USDC'
  },
  RLUSD: {
    address: '0x8292bb45bf1ee4d140127049757c2e0ff06317ed',
    decimals: 18,
    symbol: 'RLUSD'
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
    symbol: 'WETH'
  }
};

export class SwapService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private factoryContract: ethers.Contract;
  private quoterContract: ethers.Contract;
  private rpcUrls: string[];
  private currentRpcIndex: number = 0;

  constructor(rpcUrl: string, privateKey: string) {
    this.rpcUrls = [
      rpcUrl,
      process.env.RPC_URL2 || '',
      process.env.RPC_URL_BACKUP_1 || '',
      process.env.RPC_URL_BACKUP_2 || ''
    ].filter(url => url);
    
    this.provider = new ethers.JsonRpcProvider(this.rpcUrls[0], undefined, { staticNetwork: true });
    this.signer = new ethers.Wallet(privateKey, this.provider);
    
    this.factoryContract = new ethers.Contract(CONTRACTS.FACTORY, FACTORY_ABI, this.provider);
    this.quoterContract = new ethers.Contract(CONTRACTS.QUOTER, QUOTER_ABI, this.provider);
  }

  private async switchRpcProvider(): Promise<void> {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
    this.provider = new ethers.JsonRpcProvider(this.rpcUrls[this.currentRpcIndex], undefined, { staticNetwork: true });
    this.signer = new ethers.Wallet(this.signer.privateKey, this.provider);
    this.factoryContract = new ethers.Contract(CONTRACTS.FACTORY, FACTORY_ABI, this.provider);
    this.quoterContract = new ethers.Contract(CONTRACTS.QUOTER, QUOTER_ABI, this.provider);
  }

  getWalletAddress(): string {
    return this.signer.address;
  }

  async getTokenBalance(tokenSymbol: TokenSymbol, walletAddress?: string): Promise<TokenBalance> {
    const address = walletAddress || this.signer.address;
    const token = TOKENS[tokenSymbol];
    
    if (!token) throw new Error(`Unsupported token: ${tokenSymbol}`);
    
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      try {
        const contract = new ethers.Contract(token.address, TOKEN_IN_ABI, this.provider);
        const balance = await contract.balanceOf(address);
        
        return {
          raw: balance,
          formatted: ethers.formatUnits(balance, token.decimals),
          symbol: token.symbol
        };
      } catch (error) {
        if (attempt < this.rpcUrls.length - 1) {
          await this.switchRpcProvider();
        } else {
          throw error;
        }
      }
    }
    throw new Error('Failed to get token balance from all RPC providers');
  }

  async getEthBalance(walletAddress?: string): Promise<TokenBalance> {
    const address = walletAddress || this.signer.address;
    
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      try {
        const balance = await this.provider.getBalance(address);
        
        return {
          raw: balance,
          formatted: ethers.formatEther(balance),
          symbol: 'ETH'
        };
      } catch (error) {
        if (attempt < this.rpcUrls.length - 1) {
          await this.switchRpcProvider();
        } else {
          throw error;
        }
      }
    }
    throw new Error('Failed to get ETH balance from all RPC providers');
  }

  async getQuote(fromToken: TokenSymbol, toToken: TokenSymbol, amount: number): Promise<SwapQuote> {
    const tokenIn = TOKENS[fromToken];
    const tokenOut = TOKENS[toToken];
    
    if (!tokenIn || !tokenOut) {
      throw new Error(`Unsupported token pair: ${fromToken}/${toToken}`);
    }

    const { fee } = await this._findPool(tokenIn, tokenOut);
    return this._getQuoteWithFee(fromToken, toToken, amount, fee);
  }

  private async _getQuoteWithFee(fromToken: TokenSymbol, toToken: TokenSymbol, amount: number, fee: number): Promise<SwapQuote> {
    const tokenIn = TOKENS[fromToken];
    const tokenOut = TOKENS[toToken];
    const amountIn = ethers.parseUnits(amount.toString(), tokenIn.decimals);

    const quotedAmountOut = await this.quoterContract.quoteExactInputSingle.staticCall({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: fee,
      recipient: this.signer.address,
      deadline: Math.floor(Date.now() / 1000) + 600,
      amountIn: amountIn,
      sqrtPriceLimitX96: 0,
    });

    return {
      amountIn: amount.toString(),
      amountOut: ethers.formatUnits(quotedAmountOut[0], tokenOut.decimals),
      fromToken,
      toToken,
      fee,
      priceImpact: this._calculatePriceImpact(amount, parseFloat(ethers.formatUnits(quotedAmountOut[0], tokenOut.decimals)))
    };
  }

  async executeSwap(
    fromToken: TokenSymbol, 
    toToken: TokenSymbol, 
    amount: number, 
    slippageTolerance: number = 0.05
  ): Promise<SwapResult> {
    try {
      const tokenIn = TOKENS[fromToken];
      const tokenOut = TOKENS[toToken];
      const amountIn = ethers.parseUnits(amount.toString(), tokenIn.decimals);

      // Validate balance
      const balance = await this.getTokenBalance(fromToken);
      if (BigInt(balance.raw) < amountIn) {
        throw new Error(`Insufficient ${fromToken} balance. Have: ${balance.formatted}, Need: ${amount}`);
      }

      // Check ETH for gas
      const ethBalance = await this.getEthBalance();
      const estimatedGasCost = await this._estimateGasCost();
      if (BigInt(ethBalance.raw) < estimatedGasCost) {
        throw new Error(`Insufficient ETH for gas fees`);
      }

      // Get pool fee first
      const { fee } = await this._findPool(tokenIn, tokenOut);
      
      // Approve token if needed (parallel with quote)
      const [approvalTx, quote] = await Promise.all([
        this._ensureApproval(tokenIn, amountIn),
        this._getQuoteWithFee(fromToken, toToken, amount, fee)
      ]);
      
      // Prepare swap parameters with proper decimal handling
      const minAmountOut = parseFloat(quote.amountOut) * (1 - slippageTolerance);
      const amountOutMinimum = ethers.parseUnits(
        minAmountOut.toFixed(tokenOut.decimals),
        tokenOut.decimals
      );

      const swapParams: SwapParams = {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        fee: fee,
        recipient: this.signer.address,
        deadline: Math.floor(Date.now() / 1000) + 1200,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0,
      };

      // Execute swap
      const swapTx = await this._executeSwapTransaction(swapParams);

      return {
        success: true,
        transactionHash: swapTx.hash,
        approvalHash: approvalTx?.hash,
        amountIn: amount.toString(),
        amountOut: quote.amountOut,
        fromToken,
        toToken,
        gasUsed: swapTx.gasUsed?.toString(),
        gasCost: swapTx.gasCost
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        fromToken,
        toToken,
        amountIn: amount.toString()
      };
    }
  }

  private async _findPool(tokenIn: Token, tokenOut: Token): Promise<PoolInfo> {
    // For RLUSD/USDC, only check 0.01% fee (100 basis points)
    const isRlusdUsdcPair = (tokenIn.symbol === 'RLUSD' && tokenOut.symbol === 'USDC') || 
                           (tokenIn.symbol === 'USDC' && tokenOut.symbol === 'RLUSD');
    
    const feeTiers = isRlusdUsdcPair ? [100] : [100, 500, 3000, 10000];
    
    for (const fee of feeTiers) {
      const poolAddress = await this.factoryContract.getPool(tokenIn.address, tokenOut.address, fee);
      if (poolAddress && poolAddress !== ethers.ZeroAddress) {
        const poolContract = new ethers.Contract(poolAddress, POOL_ABI, this.provider);
        return { poolContract, fee, poolAddress };
      }
    }
    throw new Error(`No pool found for ${tokenIn.symbol}/${tokenOut.symbol}`);
  }

  private async _ensureApproval(token: Token, amount: bigint): Promise<{ hash: string; gasUsed: string } | null> {
    let currentAllowance: bigint = 0n;
    
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      try {
        const tokenContract = new ethers.Contract(token.address, TOKEN_IN_ABI, this.provider);
        currentAllowance = await tokenContract.allowance(this.signer.address, CONTRACTS.SWAP_ROUTER);
        break;
      } catch (error) {
        if (attempt < this.rpcUrls.length - 1) {
          await this.switchRpcProvider();
        } else {
          throw error;
        }
      }
    }
    
    if (currentAllowance >= amount) {
      return null;
    }

    const tokenContract = new ethers.Contract(token.address, TOKEN_IN_ABI, this.signer);

    const feeData = await this.provider.getFeeData();
    const nonce = await this.signer.getNonce();
    const approvalTx = await tokenContract.approve.populateTransaction(CONTRACTS.SWAP_ROUTER, amount);
    
    const legacyTx = {
      to: approvalTx.to,
      data: approvalTx.data,
      gasLimit: 100000n,
      gasPrice: feeData.gasPrice,
      nonce: nonce,
      type: 0
    };

    const txResponse = await this.signer.sendTransaction(legacyTx);
    const receipt = await this._waitForTransaction(txResponse.hash);
    
    return {
      hash: receipt.hash,
      gasUsed: receipt.gasUsed.toString()
    };
  }

  private async _executeSwapTransaction(params: SwapParams): Promise<{ hash: string; gasUsed?: bigint; gasCost: string }> {
    const swapRouter = new ethers.Contract(CONTRACTS.SWAP_ROUTER, SWAP_ROUTER_ABI, this.signer);
    const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
    
    const feeData = await this.provider.getFeeData();
    const nonce = await this.signer.getNonce();
    
    const legacyTx = {
      to: transaction.to,
      data: transaction.data,
      gasLimit: 200000n,
      gasPrice: feeData.gasPrice,
      nonce: nonce,
      type: 0
    };
    
    const txResponse = await this.signer.sendTransaction(legacyTx);
    const receipt = await this._waitForTransaction(txResponse.hash);
    
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const gasCostEth = ethers.formatEther(gasUsed);
    
    return {
      hash: receipt.hash,
      gasUsed: receipt.gasUsed,
      gasCost: gasCostEth
    };
  }

  private async _waitForTransaction(txHash: string): Promise<ethers.TransactionReceipt> {
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      try {
        const receipt = await this.provider.waitForTransaction(txHash, 1, 60000);
        if (receipt) return receipt;
      } catch (error) {
        if (attempt < this.rpcUrls.length - 1) {
          await this.switchRpcProvider();
        } else {
          throw error;
        }
      }
    }
    throw new Error('Failed to get transaction receipt from all RPC providers');
  }

  private async _estimateGasCost(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return 300000n * feeData.gasPrice!;
  }

  private _calculatePriceImpact(amountIn: number, amountOut: number): number {
    const ratio = amountOut / amountIn;
    return Math.abs(1 - ratio) * 100;
  }

  async getWalletSummary(walletAddress?: string): Promise<WalletSummary> {
    const address = walletAddress || this.signer.address;
    const [ethBalance, usdcBalance, rlusdBalance] = await Promise.all([
      this.getEthBalance(walletAddress),
      this.getTokenBalance('USDC', walletAddress),
      this.getTokenBalance('RLUSD', walletAddress)
    ]);

    return {
      address,
      balances: {
        ETH: ethBalance,
        USDC: usdcBalance,
        RLUSD: rlusdBalance
      }
    };
  }
}

export default SwapService;