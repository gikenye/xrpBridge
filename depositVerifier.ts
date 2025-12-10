import { ethers } from 'ethers';
import { logger } from './logger.js';
import { database, TransactionRecord } from './database.js';
import TOKEN_ABI from './abis/weth.json' with { type: 'json' };

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

      // Find RLUSD Transfer events to backend wallet
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const toAddressTopic = ethers.zeroPadValue(this.backendWallet.toLowerCase(), 32);

      const depositLog = receipt.logs.find(log => 
        log.address.toLowerCase() === this.rlusdContract.target.toString().toLowerCase() &&
        log.topics[0] === transferTopic &&
        log.topics[2].toLowerCase() === toAddressTopic.toLowerCase()
      );

      if (!depositLog) {
        logger.warn('No RLUSD transfer to backend wallet found', { 
          transactionHash,
          backendWallet: this.backendWallet 
        });
        return null;
      }

      // Manually decode Transfer event
      const fromAddress = ethers.getAddress('0x' + depositLog.topics[1].slice(26));
      const value = BigInt(depositLog.data);
      const block = await this.provider.getBlock(receipt.blockNumber);
      const amount = ethers.formatUnits(value, 18);

      const verification: DepositVerification = {
        transactionHash,
        userAddress: fromAddress,
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

      logger.info('Scanning for deposits using eth_getLogs', { 
        startBlock,
        latestBlock,
        blockRange: latestBlock - startBlock,
        backendWallet: this.backendWallet 
      });

      // Transfer event topic: keccak256("Transfer(address,address,uint256)")
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const toAddressTopic = ethers.zeroPadValue(this.backendWallet.toLowerCase(), 32);

      const logs = await this.provider.getLogs({
        address: this.rlusdContract.target.toString(),
        topics: [transferTopic, null, toAddressTopic],
        fromBlock: startBlock,
        toBlock: latestBlock
      });

      logger.info('Raw logs fetched', { logsCount: logs.length });

      const deposits: DepositVerification[] = [];

      for (const log of logs) {
        try {
          // Manually decode Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
          const fromAddress = ethers.getAddress('0x' + log.topics[1].slice(26));
          const toAddress = ethers.getAddress('0x' + log.topics[2].slice(26));
          const value = BigInt(log.data);

          const block = await this.provider.getBlock(log.blockNumber);
          const amount = ethers.formatUnits(value, 18);

          deposits.push({
            transactionHash: log.transactionHash,
            userAddress: fromAddress,
            amount,
            blockNumber: log.blockNumber,
            timestamp: new Date(block!.timestamp * 1000),
            verified: true
          });
        } catch (parseError) {
          logger.warn('Failed to parse log', { log, error: parseError });
        }
      }

      logger.info('Deposits scan completed', { 
        depositsFound: deposits.length,
        blockRange: `${startBlock}-${latestBlock}`,
        deposits: deposits.map(d => ({
          tx: d.transactionHash,
          from: d.userAddress,
          amount: d.amount,
          block: d.blockNumber
        }))
      });

      return deposits;

    } catch (error) {
      logger.error('Failed to scan for deposits', error as Error, {
        errorDetails: error instanceof Error ? error.message : 'Unknown'
      });
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