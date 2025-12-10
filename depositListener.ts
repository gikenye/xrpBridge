import { WebSocketProvider } from 'ethers';
import { logger } from './logger.js';
import { database } from './database.js';
import { DepositVerifier } from './depositVerifier.js';
import SwapService from './swapService.js';
import 'dotenv/config';

export class DepositListener {
  private provider: WebSocketProvider;
  private verifier: DepositVerifier;
  private backendWallet: string;
  private rlusdAddress = '0x8292bb45bf1ee4d140127049757c2e0ff06317ed';

  constructor(alchemyWsUrl: string, rpcUrl: string, privateKey: string) {
    this.provider = new WebSocketProvider(alchemyWsUrl);
    const swapService = new SwapService(rpcUrl, privateKey);
    this.backendWallet = swapService.getWalletAddress();
    this.verifier = new DepositVerifier(rpcUrl, this.backendWallet);

    logger.info('Deposit listener initialized', { 
      backendWallet: this.backendWallet,
      rlusdAddress: this.rlusdAddress
    });
  }

  start() {
    logger.info('Starting deposit listener via WebSocket');

    this.provider.on('block', async (blockNumber) => {
      try {
        const block = await this.provider.getBlock(blockNumber, true);

        if (block && block.transactions) {
          const rlusdTxs = block.transactions.filter((tx: any) => 
            tx.to?.toLowerCase() === this.rlusdAddress.toLowerCase()
          );

          if (rlusdTxs.length > 0) {
            logger.info('Found RLUSD transactions', { 
              count: rlusdTxs.length, 
              block: blockNumber 
            });
            
            for (const tx of rlusdTxs) {
              await this.checkTransaction((tx as any).hash);
            }
          }
        }
      } catch (error) {
        logger.error('Error processing block', error as Error, { blockNumber });
      }
    });
  }

  private async checkTransaction(txHash: string) {
    try {
      const verification = await this.verifier.verifyDeposit(txHash);
      
      if (!verification) return;

      logger.info('Deposit detected', {
        txHash,
        from: verification.userAddress,
        amount: verification.amount,
        block: verification.blockNumber
      });

      await database.connect();

      const existing = await database.getTransaction(txHash);
      if (existing) {
        logger.info('Deposit already processed', { txHash });
        await database.disconnect();
        return;
      }

      const pendingRecord = await database.findPendingDeposit(
        verification.userAddress,
        verification.amount
      );

      if (pendingRecord) {
        await database.updateTransaction(txHash, {
          transactionHash: txHash,
          status: 'success',
          amountOut: verification.amount,
          metadata: {
            verified: true,
            blockNumber: verification.blockNumber,
            verificationTimestamp: new Date()
          }
        });
        logger.info('Updated tracked deposit', { 
          trackingId: pendingRecord._id,
          txHash 
        });
      } else {
        await database.saveTransaction({
          transactionHash: txHash,
          userAddress: verification.userAddress,
          operation: 'deposit',
          fromToken: 'RLUSD',
          toToken: 'RLUSD',
          amountIn: verification.amount,
          amountOut: verification.amount,
          status: 'success',
          timestamp: verification.timestamp,
          metadata: {
            verified: true,
            blockNumber: verification.blockNumber,
            depositType: 'untracked_deposit'
          }
        });
        logger.info('Created untracked deposit', { txHash });
      }

      await database.disconnect();

    } catch (error) {
      logger.error('Failed to process transaction', error as Error, { txHash });
    }
  }

  stop() {
    this.provider.removeAllListeners();
    this.provider.destroy();
    logger.info('Deposit listener stopped');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const listener = new DepositListener(
    process.env.ALCHEMY_WS_URL!,
    process.env.RPC_URL!,
    process.env.PRIVATE_KEY!
  );

  listener.start();

  process.on('SIGINT', () => {
    listener.stop();
    process.exit(0);
  });
}
