import { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../logger.js';
import { database } from '../database.js';

export default async function userDepositsHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `deposits_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/user-deposits' });

  try {
    const { userAddress } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({ error: 'Missing userAddress parameter' });
    }

    await database.connect();

    const transactions = await database.getRecentTransactions(userAddress, 1000);
    
    const deposits = transactions
      .filter((tx: any) => 
        tx.operation === 'deposit_and_swap' && 
        tx.status === 'success' &&
        tx.metadata?.trackingId &&
        !tx.metadata?.offramped
      )
      .map((tx: any) => ({
        trackingId: tx.metadata.trackingId,
        amountIn: tx.amountIn,
        amountOut: tx.amountOut,
        fromToken: tx.fromToken,
        toToken: tx.toToken,
        transactionHash: tx.transactionHash,
        timestamp: tx.timestamp
      }));

    return res.status(200).json({
      status: 'success',
      userAddress,
      deposits,
      count: deposits.length
    });

  } catch (error) {
    logger.error('Failed to get user deposits', error as Error);
    return res.status(500).json({
      error: 'Failed to retrieve deposits',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await database.disconnect();
  }
}
