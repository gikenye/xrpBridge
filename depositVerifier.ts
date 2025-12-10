import { ethers } from 'ethers';
import { logger } from './logger';
import { database, TransactionRecord } from './database';
import TOKEN_ABI from './abis/weth.json';

export interface DepositVerification {
  transactionHash: string;
  userAddress: string;
  amount: string;
  blockNumber: number;
  timestamp: Date;
  verified: boolean;
}

export class DepositVerifier {
  private provider: ethers.JsonRpcProvider;
  private rlusdContract: ethers.Contract;
  private backendWallet: string;

  constructor(rpcUrl: string, backendWallet: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.backendWallet = backendWallet;
    this.rlusdContract = new ethers.Contract(
      '0x8292bb45bf1ee4d140127049757c2e0ff06317ed',
      TOKEN_ABI,
      this.provider
    );
  }

  async verifyDeposit(transactionHash: string): Promise<DepositVerification | null> {
    try {
      logger.info('Verifying deposit transaction', { transactionHash });

      const receipt = await this.provider.getTransactionReceipt(transactionHash);
      if (!receipt) {
        logger.warn('Transaction not found', { transactionHash });
        return null;
      }

      // Parse transfer events
      const transferEvents = receipt.logs
        .filter(log => log.address.toLowerCase() === this.rlusdContract.target.toString().toLowerCase())
        .map(log => {
          try {
            return this.rlusdContract.interface.parseLog({
              topics: log.topics,
              data: log.data
            });
          } catch {
            return null;
          }
        })
        .filter(event => event !== null);

      // Find transfer to backend wallet
      const depositEvent = transferEvents.find(event => 
        event?.name === 'Transfer' && 
        event.args && event.args.to.toLowerCase() === this.backendWallet.toLowerCase()
      );

      if (!depositEvent || !depositEvent.args) {
        logger.warn('No RLUSD transfer to backend wallet found', { 
          transactionHash,
          backendWallet: this.backendWallet 
        });
        return null;
      }

      const block = await this.provider.getBlock(receipt.blockNumber);
      const amount = ethers.formatUnits(depositEvent.args.value, 18);

      const verification: DepositVerification = {
        transactionHash,
        userAddress: depositEvent.args.from,
        amount,
        blockNumber: receipt.blockNumber,
        timestamp: new Date(block!.timestamp * 1000),
        verified: true
      };

      logger.info('Deposit verified successfully', {
        transactionHash,
        userAddress: verification.userAddress,
        amount,
        blockNumber: receipt.blockNumber
      });

      return verification;

    } catch (error) {
      logger.error('Failed to verify deposit', error as Error, { transactionHash });
      return null;
    }
  }

  async getRecentDeposits(fromBlock: number = -1000): Promise<DepositVerification[]> {
    try {
      const latestBlock = await this.provider.getBlockNumber();
      const startBlock = fromBlock < 0 ? latestBlock + fromBlock : fromBlock;

      logger.info('Scanning for deposits', { 
        startBlock, 
        latestBlock,
        backendWallet: this.backendWallet 
      });

      const filter = this.rlusdContract.filters.Transfer(null, this.backendWallet);
      const events = await this.rlusdContract.queryFilter(filter, startBlock, latestBlock);

      const deposits: DepositVerification[] = [];

      for (const event of events) {
        const block = await this.provider.getBlock(event.blockNumber);
        const amount = ethers.formatUnits(event.args.value, 18);

        deposits.push({
          transactionHash: event.transactionHash,
          userAddress: event.args.from,
          amount,
          blockNumber: event.blockNumber,
          timestamp: new Date(block!.timestamp * 1000),
          verified: true
        });
      }

      logger.info('Deposits scan completed', { 
        depositsFound: deposits.length,
        blockRange: `${startBlock}-${latestBlock}`
      });

      return deposits;

    } catch (error) {
      logger.error('Failed to scan for deposits', error as Error);
      return [];
    }
  }

  async trackDeposit(userAddress: string, expectedAmount: string): Promise<string> {
    try {
      await database.connect();

      const depositRecord: Omit<TransactionRecord, '_id'> = {
        transactionHash: '',
        userAddress,
        operation: 'deposit_pending',
        fromToken: 'RLUSD',
        toToken: 'RLUSD',
        amountIn: expectedAmount,
        status: 'pending',
        timestamp: new Date(),
        metadata: {
          expectedAmount,
          depositType: 'user_deposit'
        }
      };

      const recordId = await database.saveTransaction(depositRecord);
      
      logger.info('Deposit tracking initiated', {
        recordId,
        userAddress,
        expectedAmount
      });

      return recordId;

    } catch (error) {
      logger.error('Failed to track deposit', error as Error, {
        userAddress,
        expectedAmount
      });
      throw error;
    } finally {
      await database.disconnect();
    }
  }

  async confirmDeposit(recordId: string, transactionHash: string): Promise<boolean> {
    try {
      await database.connect();

      const verification = await this.verifyDeposit(transactionHash);
      if (!verification) {
        return false;
      }

      await database.updateTransaction(transactionHash, {
        transactionHash,
        status: 'success',
        amountOut: verification.amount,
        metadata: {
          verified: true,
          blockNumber: verification.blockNumber,
          verificationTimestamp: new Date()
        }
      });

      logger.info('Deposit confirmed and updated', {
        recordId,
        transactionHash,
        userAddress: verification.userAddress,
        amount: verification.amount
      });

      return true;

    } catch (error) {
      logger.error('Failed to confirm deposit', error as Error, {
        recordId,
        transactionHash
      });
      return false;
    } finally {
      await database.disconnect();
    }
  }
}