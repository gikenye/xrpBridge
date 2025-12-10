import { VercelRequest, VercelResponse } from '@vercel/node';
import { DepositVerifier } from '../depositVerifier';
import SwapService from '../swapService';
import { logger } from '../logger';

const swapService = new SwapService(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!
);

const verifier = new DepositVerifier(
  process.env.RPC_URL!,
  swapService.getWalletAddress()
);

export default async function recentDepositsHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `recent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/recent-deposits' });

  try {
    const { fromBlock } = req.query;
    const blockNumber = fromBlock ? parseInt(fromBlock as string) : -1000;

    logger.info('Fetching recent deposits', { fromBlock: blockNumber });

    const deposits = await verifier.getRecentDeposits(blockNumber);

    return res.status(200).json({
      success: true,
      deposits,
      backendWallet: swapService.getWalletAddress(),
      count: deposits.length
    });

  } catch (error) {
    logger.error('Failed to fetch recent deposits', error as Error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}