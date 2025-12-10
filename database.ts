import { MongoClient, Db, Collection } from 'mongodb';
import { logger } from './logger';

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

  private getCollection<T>(name: string): Collection<T> {
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
}

export const database = Database.getInstance();