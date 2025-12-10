import { MongoClient, Db, Collection, Document } from 'mongodb';
import { logger } from './logger.js';

export interface TransactionRecord {
  _id?: string;
  transactionHash: string;
  userAddress: string;
  operation: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut?: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  gasCost?: string;
  timestamp: Date;
  metadata?: any;
}

export interface WalletBalanceRecord {
  _id?: string;
  walletAddress: string;
  balances: {
    ETH: string;
    USDC: string;
    RLUSD: string;
  };
  timestamp: Date;
}

export interface UserBalanceLedger {
  _id?: string;
  userAddress: string;
  chain: 'Ethereum' | 'Base';
  token: 'RLUSD' | 'USDC';
  amount: string;
  operation: 'deposit' | 'swap' | 'bridge' | 'offramp';
  transactionHash: string;
  balanceAfter: string;
  timestamp: Date;
}

class Database {
  private static instance: Database;
  private client: MongoClient | null = null;
  private db: Db | null = null;

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    try {
      const uri = process.env.MONGODB_URI;
      if (!uri) throw new Error('MONGODB_URI not configured');

      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db(process.env.DB_NAME || 'test');
      
      logger.info('Connected to MongoDB');
    } catch (error) {
      logger.error('Failed to connect to MongoDB', error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      logger.info('Disconnected from MongoDB');
    }
  }

  private getCollection<T extends Document>(name: string): Collection<T> {
    if (!this.db) throw new Error('Database not connected');
    return this.db.collection<T>(name);
  }

  async saveTransaction(record: Omit<TransactionRecord, '_id'>): Promise<string> {
    const collection = this.getCollection<TransactionRecord>('transactions');
    const result = await collection.insertOne(record);
    
    logger.info('Transaction saved', { 
      transactionId: result.insertedId.toString(),
      hash: record.transactionHash 
    });
    
    return result.insertedId.toString();
  }

  async updateTransaction(transactionHash: string, updates: Partial<TransactionRecord>): Promise<void> {
    const collection = this.getCollection<TransactionRecord>('transactions');
    await collection.updateOne(
      { transactionHash },
      { $set: { ...updates, updatedAt: new Date() } }
    );
    
    logger.info('Transaction updated', { transactionHash, updates });
  }

  async getTransaction(transactionHash: string): Promise<TransactionRecord | null> {
    const collection = this.getCollection<TransactionRecord>('transactions');
    return await collection.findOne({ transactionHash });
  }

  async saveWalletBalance(record: Omit<WalletBalanceRecord, '_id'>): Promise<void> {
    const collection = this.getCollection<WalletBalanceRecord>('wallet_balances');
    await collection.insertOne(record);
    
    logger.info('Wallet balance saved', { 
      walletAddress: record.walletAddress,
      timestamp: record.timestamp 
    });
  }

  async getRecentTransactions(userAddress: string, limit: number = 10): Promise<TransactionRecord[]> {
    const collection = this.getCollection<TransactionRecord>('transactions');
    return await collection
      .find({ userAddress })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  async findPendingDeposit(userAddress: string, amount: string): Promise<TransactionRecord | null> {
    const collection = this.getCollection<TransactionRecord>('transactions');
    return await collection.findOne({
      userAddress,
      operation: 'deposit_pending',
      status: 'pending',
      amountIn: amount
    });
  }

  async saveOfframpTransaction(record: any): Promise<string> {
    const collection = this.getCollection('offramp_transactions');
    const result = await collection.insertOne(record);
    
    logger.info('Offramp transaction saved', { 
      offrampId: result.insertedId.toString(),
      requestId: record.requestId
    });
    
    return result.insertedId.toString();
  }

  async getUserOfframpedAmount(userAddress: string): Promise<number> {
    const collection = this.getCollection('offramp_transactions');
    const offrampTxs = await collection.find({ userAddress, status: 'success' }).toArray();
    
    let total = 0;
    offrampTxs.forEach((tx: any) => {
      total += parseFloat(tx.usdcAmount || 0);
    });
    
    return total;
  }

  async updateUserBalance(record: Omit<UserBalanceLedger, '_id' | 'balanceAfter' | 'timestamp'>): Promise<void> {
    const collection = this.getCollection<UserBalanceLedger>('user_balance_ledger');
    
    // Get current balance
    const lastEntry = await collection.findOne(
      { userAddress: record.userAddress, chain: record.chain as any, token: record.token as any },
      { sort: { timestamp: -1 } }
    );
    
    const currentBalance = parseFloat(lastEntry?.balanceAfter || '0');
    const changeAmount = parseFloat(record.amount);
    
    // Calculate new balance based on operation
    let newBalance: number;
    if (record.operation === 'deposit' || record.operation === 'bridge' || record.operation === 'swap') {
      newBalance = currentBalance + changeAmount;
    } else if (record.operation === 'offramp') {
      newBalance = currentBalance - changeAmount;
    } else {
      newBalance = currentBalance;
    }
    
    await collection.insertOne({
      ...record,
      balanceAfter: newBalance.toFixed(6),
      timestamp: new Date()
    });
    
    logger.info('User balance updated', {
      userAddress: record.userAddress,
      operation: record.operation,
      chain: record.chain,
      token: record.token,
      amount: record.amount,
      balanceAfter: newBalance.toFixed(6)
    });
  }

  async getUserBalance(userAddress: string, chain: string, token: string): Promise<string> {
    const collection = this.getCollection<UserBalanceLedger>('user_balance_ledger');
    const lastEntry = await collection.findOne(
      { userAddress, chain: chain as any, token: token as any },
      { sort: { timestamp: -1 } }
    );
    
    return lastEntry?.balanceAfter || '0';
  }
}

export const database = Database.getInstance();