import { VercelRequest, VercelResponse } from '@vercel/node';
import { DepositVerifier } from '../depositVerifier.js';
import SwapService from '../swapService.js';
import { logger } from '../logger.js';

const swapService = new SwapService(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!
);

const verifier = new DepositVerifier(
  process.env.RPC_URL!,
  swapService.getWalletAddress()
);

export default async function trackDepositHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/track-deposit' });

  try {
    const { userAddress, expectedAmount } = req.body;

    if (!userAddress || !expectedAmount) {
      return res.status(400).json({ 
        error: 'Missing required parameters: userAddress, expectedAmount' 
      });
    }

    logger.info('Initiating deposit tracking', { userAddress, expectedAmount });

    const trackingId = await verifier.trackDeposit(userAddress, expectedAmount);

    return res.status(200).json({
      success: true,
      trackingId,
      backendWallet: swapService.getWalletAddress(),
      message: `Send ${expectedAmount} RLUSD to ${swapService.getWalletAddress()}`
    });

  } catch (error) {
    logger.error('Deposit tracking failed', error as Error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}