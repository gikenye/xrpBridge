import { VercelRequest, VercelResponse } from '@vercel/node';
import { BackendSwapHandler } from '../server.js';
import SwapService from '../swapService.js';
import { logger } from '../logger.js';

const swapService = new SwapService(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!
);

const handler = new BackendSwapHandler(swapService);

export default async function swapHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `swap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/swap' });

  try {
    const { userAddress, fromToken, toToken, amount, targetToken } = req.body;

    if (!userAddress || !fromToken || !amount) {
      logger.warn('Invalid request parameters', { body: req.body });
      return res.status(400).json({ 
        error: 'Missing required parameters: userAddress, fromToken, amount' 
      });
    }

    logger.info('Processing swap request', {
      userAddress,
      fromToken,
      toToken,
      amount,
      targetToken
    });

    const result = await handler.handleUserDeposit(
      userAddress,
      fromToken,
      amount,
      targetToken || toToken
    );

    logger.info('Swap request completed', { 
      status: result.status,
      operation: result.operation 
    });

    return res.status(200).json(result);

  } catch (error) {
    logger.error('Swap request failed', error as Error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}