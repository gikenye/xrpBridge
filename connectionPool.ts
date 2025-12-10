import { ethers } from 'ethers';
import { MongoClient } from 'mongodb';

class ConnectionPool {
  private static instance: ConnectionPool;
  private providers: ethers.JsonRpcProvider[] = [];
  private mongoClient: MongoClient | null = null;
  private currentProviderIndex = 0;

  static getInstance(): ConnectionPool {
    if (!ConnectionPool.instance) {
      ConnectionPool.instance = new ConnectionPool();
    }
    return ConnectionPool.instance;
  }

  async initialize() {
    // Initialize multiple RPC providers for load balancing
    const rpcUrls = [
      process.env.RPC_URL!,
      process.env.RPC_URL_BACKUP_1,
      process.env.RPC_URL_BACKUP_2,
    ].filter(Boolean);

    this.providers = rpcUrls.map(url => new ethers.JsonRpcProvider(url));

    // Initialize MongoDB connection pool
    if (!this.mongoClient) {
      this.mongoClient = new MongoClient(process.env.MONGODB_URI!, {
        maxPoolSize: 100,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000
      });
      await this.mongoClient.connect();
    }
  }

  getProvider(): ethers.JsonRpcProvider {
    const provider = this.providers[this.currentProviderIndex];
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
    return provider;
  }

  getDatabase() {
    if (!this.mongoClient) throw new Error('Database not initialized');
    return this.mongoClient.db(process.env.DB_NAME || 'uniswap_service');
  }
}

export const connectionPool = ConnectionPool.getInstance();