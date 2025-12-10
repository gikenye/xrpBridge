import SwapService from "./swapService.js";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createAdapterFromPrivateKey } from "@circle-fin/adapter-ethers-v6";
import { ethers } from "ethers";
import "dotenv/config";
import { logger } from "./logger.js";
import { database, TransactionRecord } from "./database.js";
import type {
  DepositResult,
  QuoteResponse,
  RebalanceResult,
  WalletHealth,
  HealthAlert,
  TokenSymbol,
} from "./types.js";

const swapService = new SwapService(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!
);

export class BackendSwapHandler {
  private swapService: SwapService;
  private bridgeKit: BridgeKit;
  private adapter: any;

  constructor(swapService: SwapService) {
    this.swapService = swapService;
    this.bridgeKit = new BridgeKit();
    this.adapter = createAdapterFromPrivateKey({
      privateKey: process.env.PRIVATE_KEY!,
    });
  }

  async handleUserDeposit(
    userAddress: string,
    tokenSymbol: TokenSymbol,
    amount: number,
    targetToken?: TokenSymbol
  ): Promise<DepositResult> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.setContext({ requestId, userAddress, operation: 'handleUserDeposit' });
    
    try {
      await database.connect();
      
      logger.info('Processing user deposit', {
        tokenSymbol,
        amount,
        targetToken
      });

      const walletSummary = await this.swapService.getWalletSummary();
      logger.info('Server wallet balance retrieved', {
        balances: {
          ETH: walletSummary.balances.ETH.formatted,
          USDC: walletSummary.balances.USDC.formatted,
          RLUSD: walletSummary.balances.RLUSD.formatted
        }
      });

      // Save wallet balance to database
      await database.saveWalletBalance({
        walletAddress: this.swapService.getWalletAddress(),
        balances: {
          ETH: walletSummary.balances.ETH.formatted,
          USDC: walletSummary.balances.USDC.formatted,
          RLUSD: walletSummary.balances.RLUSD.formatted
        },
        timestamp: new Date()
      });

      if (targetToken && targetToken !== tokenSymbol) {
        logger.info('Auto-converting tokens', { from: tokenSymbol, to: targetToken });

        // Generate tracking ID
        const trackingId = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Save initial transaction record
        const transactionRecord: Omit<TransactionRecord, '_id'> = {
          transactionHash: '',
          userAddress,
          operation: 'deposit_and_swap',
          fromToken: tokenSymbol,
          toToken: targetToken,
          amountIn: amount.toString(),
          status: 'pending',
          timestamp: new Date(),
          metadata: { trackingId }
        };

        // Round amount to avoid floating point precision issues
        const roundedAmount = parseFloat(amount.toFixed(6));
        
        const swapResult = await this.swapService.executeSwap(
          tokenSymbol,
          targetToken,
          roundedAmount,
          0.03
        );

        if (swapResult.success) {
          // Update transaction record
          transactionRecord.transactionHash = swapResult.transactionHash!;
          transactionRecord.status = 'success';
          transactionRecord.amountOut = swapResult.amountOut;
          transactionRecord.gasCost = swapResult.gasCost;
          
          await database.saveTransaction(transactionRecord);
          
          // Update user balance ledger (only for USDC)
          if (targetToken === 'USDC') {
            await database.updateUserBalance({
              userAddress,
              chain: 'Base',
              token: 'USDC',
              amount: swapResult.amountOut!,
              operation: 'swap',
              transactionHash: swapResult.transactionHash!
            });
          }
          
          logger.info('Swap completed successfully', {
            transactionHash: swapResult.transactionHash,
            amountIn: swapResult.amountIn,
            amountOut: swapResult.amountOut,
            gasCost: swapResult.gasCost
          });

          return {
            status: "success",
            operation: "deposit_and_swap",
            trackingId,
            originalAmount: amount.toString(),
            originalToken: tokenSymbol,
            finalAmount: swapResult.amountOut,
            finalToken: targetToken,
            transactionHash: swapResult.transactionHash,
            gasCost: swapResult.gasCost,
          };
        } else {
          // Save failed transaction
          transactionRecord.status = 'failed';
          transactionRecord.error = swapResult.error;
          await database.saveTransaction(transactionRecord);
          
          logger.error('Swap failed', new Error(swapResult.error!), {
            fromToken: tokenSymbol,
            toToken: targetToken,
            amount
          });
          
          return {
            status: "error",
            operation: "deposit_and_swap",
            error: swapResult.error,
          };
        }
      }

      logger.info('Deposit processed without conversion', {
        amount: amount.toString(),
        token: tokenSymbol
      });

      return {
        status: "success",
        operation: "deposit_only",
        amount: amount.toString(),
        token: tokenSymbol,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      logger.error('Error processing deposit', error as Error, {
        tokenSymbol,
        amount,
        targetToken
      });
      
      return {
        status: "error",
        operation: "deposit",
        error: errorMessage,
      };
    } finally {
      await database.disconnect();
    }
  }

  async getSwapQuote(
    fromToken: TokenSymbol,
    toToken: TokenSymbol,
    amount: number
  ): Promise<QuoteResponse> {
    const requestId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.setContext({ requestId, operation: 'getSwapQuote' });
    
    try {
      logger.info('Getting swap quote', { fromToken, toToken, amount });
      
      const quote = await this.swapService.getQuote(fromToken, toToken, amount);
      
      logger.info('Quote generated successfully', {
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        fee: quote.fee,
        priceImpact: quote.priceImpact
      });

      return {
        status: "success",
        quote: {
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          fromToken: quote.fromToken,
          toToken: quote.toToken,
          exchangeRate: (
            parseFloat(quote.amountOut) / parseFloat(quote.amountIn)
          ).toFixed(6),
          fee: quote.fee,
          priceImpact: quote.priceImpact.toFixed(4) + "%",
        },
      };
    } catch (error) {
      logger.error('Failed to get swap quote', error as Error, {
        fromToken,
        toToken,
        amount
      });
      
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async rebalanceWallet(
    targetRatio: { USDC: number; RLUSD: number } = { USDC: 0.5, RLUSD: 0.5 }
  ): Promise<RebalanceResult> {
    try {
      console.log(`\n⚖️  Rebalancing wallet to target ratio...`);

      const summary = await this.swapService.getWalletSummary();
      const usdcBalance = parseFloat(summary.balances.USDC.formatted);
      const rlusdBalance = parseFloat(summary.balances.RLUSD.formatted);

      const totalValue = usdcBalance + rlusdBalance;
      const targetUSDC = totalValue * targetRatio.USDC;
      const targetRLUSD = totalValue * targetRatio.RLUSD;

      console.log(`Current: ${usdcBalance} USDC, ${rlusdBalance} RLUSD`);
      console.log(
        `Target: ${targetUSDC.toFixed(4)} USDC, ${targetRLUSD.toFixed(4)} RLUSD`
      );

      let swapResult = null;

      if (usdcBalance > targetUSDC) {
        const excessUSDC = usdcBalance - targetUSDC;
        console.log(`Converting ${excessUSDC.toFixed(4)} USDC to RLUSD...`);
        swapResult = await this.swapService.executeSwap(
          "USDC",
          "RLUSD",
          excessUSDC
        );
      } else if (rlusdBalance > targetRLUSD) {
        const excessRLUSD = rlusdBalance - targetRLUSD;
        console.log(`Converting ${excessRLUSD.toFixed(4)} RLUSD to USDC...`);
        swapResult = await this.swapService.executeSwap(
          "RLUSD",
          "USDC",
          excessRLUSD
        );
      } else {
        console.log(`✅ Wallet already balanced`);
        return { status: "success", message: "Wallet already balanced" };
      }

      if (swapResult && swapResult.success) {
        console.log(`✅ Rebalancing completed!`);
        return {
          status: "success",
          rebalance: swapResult,
          newBalances: await this.swapService.getWalletSummary(),
        };
      } else {
        return {
          status: "error",
          error: swapResult?.error || "Rebalancing failed",
        };
      }
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async checkWalletHealth(): Promise<WalletHealth> {
    const summary = await this.swapService.getWalletSummary();
    const ethBalance = parseFloat(summary.balances.ETH.formatted);
    const usdcBalance = parseFloat(summary.balances.USDC.formatted);
    const rlusdBalance = parseFloat(summary.balances.RLUSD.formatted);

    const alerts: HealthAlert[] = [];

    if (ethBalance < 0.001) {
      alerts.push({
        type: "low_eth",
        message: `Low ETH balance: ${ethBalance}`,
      });
    }

    if (usdcBalance < 1) {
      alerts.push({
        type: "low_usdc",
        message: `Low USDC balance: ${usdcBalance}`,
      });
    }

    if (rlusdBalance < 1) {
      alerts.push({
        type: "low_rlusd",
        message: `Low RLUSD balance: ${rlusdBalance}`,
      });
    }

    return {
      status: alerts.length > 0 ? "warning" : "healthy",
      balances: summary.balances,
      alerts,
    };
  }

  async processOfframp(
    userAddress: string,
    rlusdAmount: number,
    shortcode: string,
    mobileNetwork: string,
    callbackUrl: string = `${process.env.BASE_URL}/callback`
  ) {
    try {
      console.log(`\n💸 Processing offramp for user: ${userAddress}`);
      console.log(`Amount: ${rlusdAmount} RLUSD`);

      // Step 1: Swap RLUSD to USDC on Ethereum
      console.log("\n🔄 Step 1: Swapping RLUSD to USDC on Ethereum...");
      const swapResult = await this.swapService.executeSwap(
        "RLUSD",
        "USDC",
        rlusdAmount,
        0.03
      );

      if (!swapResult.success) {
        throw new Error(`Swap failed: ${swapResult.error}`);
      }

      console.log(
        `✅ Swapped ${swapResult.amountIn} RLUSD → ${swapResult.amountOut} USDC`
      );

      // Step 2: Bridge USDC to Base using CCTP
      console.log("\n🌉 Step 2: Bridging USDC to Base via CCTP...");
      const bridgeResult = await this.bridgeKit.bridge({
        from: { adapter: this.adapter, chain: "Ethereum" },
        to: { adapter: this.adapter, chain: "Base" },
        amount: swapResult.amountOut!,
      });

      // Get the mint transaction hash from the bridge result
      const mintStep = bridgeResult.steps.find(
        (step: any) => step.name === "mint"
      );
      const bridgeTxHash =
        mintStep?.txHash ||
        bridgeResult.steps[bridgeResult.steps.length - 1]?.txHash;

      console.log(`✅ Bridged to Base: ${bridgeTxHash}`);

      // Step 3: Transfer USDC to settlement wallet on Base
      console.log("\n💸 Step 3: Transferring USDC to settlement wallet...");
      const baseProvider = new ethers.JsonRpcProvider(
        "https://mainnet.base.org"
      );
      const baseSigner = new ethers.Wallet(
        process.env.PRIVATE_KEY!,
        baseProvider
      );

      const baseUsdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
      const settlementWallet =
        process.env.SETTLEMENT_WALLET ||
        "0x8005ee53E57aB11E11eAA4EFe07Ee3835Dc02F98";

      const usdcContract = new ethers.Contract(
        baseUsdcAddress,
        [
          "function transfer(address to, uint256 amount) returns (bool)",
          "function balanceOf(address account) view returns (uint256)",
        ],
        baseSigner
      );

      const transferAmount = ethers.parseUnits(swapResult.amountOut!, 6);
      const transferTx = await usdcContract.transfer(
        settlementWallet,
        transferAmount
      );
      const transferReceipt = await transferTx.wait();

      console.log(
        `✅ Transferred ${swapResult.amountOut} USDC to settlement wallet: ${transferReceipt.hash}`
      );

      // Step 4: Get UGX exchange rate
      console.log("\n💱 Step 4: Getting UGX exchange rate...");
      const exchangeResponse = await fetch(
        `${process.env.RAMPS_SERVICE}/v1/exchange-rate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.RAMPS_KEY!,
          },
          body: JSON.stringify({ currency_code: "UGX" }),
        }
      );

      const exchangeData = await exchangeResponse.json();
      const sellingRate = exchangeData.data.selling_rate;
      const usdcAmount = parseFloat(swapResult.amountOut!);
      const ugxAmount = Math.floor(usdcAmount * sellingRate);

      console.log(`✅ Exchange rate: 1 USDC = ${sellingRate} UGX`);
      console.log(`✅ Converting ${usdcAmount} USDC to ${ugxAmount} UGX`);

      // Step 5: Send to offramp server
      console.log("\n📤 Step 5: Sending to UGX offramp service...");
      const offrampPayload = {
        transaction_hash: transferReceipt.hash,
        amount: ugxAmount.toString(),
        fee: "50",
        shortcode,
        mobile_network: mobileNetwork,
        chain: "BASE",
        callback_url: callbackUrl,
        user_address: userAddress,
      };

      const response = await fetch(`${process.env.RAMPS_SERVICE}/v1/pay/UGX`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.RAMPS_KEY!,
        },
        body: JSON.stringify(offrampPayload),
      });

      const offrampResult = await response.json();
      console.log(`✅ Offramp initiated: ${offrampResult.id}`);

      return {
        status: "success",
        swapHash: swapResult.transactionHash,
        bridgeHash: bridgeTxHash,
        settlementHash: transferReceipt.hash,
        bridgeState: bridgeResult.state,
        offrampId: offrampResult.id,
        rlusdAmount: rlusdAmount.toString(),
        usdcAmount: swapResult.amountOut,
        ugxAmount: ugxAmount.toString(),
        exchangeRate: sellingRate,
        payload: offrampPayload,
      };
    } catch (error) {
      console.error("❌ Offramp failed:", error);
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
error: Error instanceof Error ? Error.message : "Unknown error";

// Export for use in other modules
export { swapService };
