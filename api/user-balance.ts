import { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../logger.js';
import { database } from '../database.js';

export default async function userBalanceHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `balance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/user-balance' });

  try {
    const { userAddress } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({ error: 'Missing userAddress parameter' });
    }

    await database.connect();

    const availableBalance = await database.getUserBalance(userAddress, 'Base', 'USDC');
    const totalOfframped = await database.getUserOfframpedAmount(userAddress);
    const totalSwapped = parseFloat(availableBalance) + totalOfframped;
    
    const transactions = await database.getRecentTransactions(userAddress, 1000);
    let totalDeposited = 0;
    let availableDeposits = 0;
    transactions.forEach((tx: any) => {
      if (tx.operation === 'deposit_and_swap' && tx.status === 'success') {
        totalDeposited += parseFloat(tx.amountIn || 0);
        if (!tx.metadata?.offramped) {
          availableDeposits++;
        }
      }
    });

    logger.info('User balance retrieved', { userAddress, availableBalance });

    return res.status(200).json({
      status: 'success',
      userAddress,
      balances: {
        totalDeposited: totalDeposited.toFixed(6),
        totalSwapped: totalSwapped.toFixed(6),
        totalOfframped: totalOfframped.toFixed(6),
        available: availableBalance
      },
      transactions: {
        total: transactions.length,
        availableForOfframp: availableDeposits
      }
    });

  } catch (error) {
    logger.error('Failed to get user balance', error as Error);
    return res.status(500).json({
      error: 'Failed to retrieve balance',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await database.disconnect();
  }
}
