import { VercelRequest, VercelResponse } from '@vercel/node';
import { BackendSwapHandler } from '../server';
import SwapService from '../swapService';
import { logger } from '../logger';

const swapService = new SwapService(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!
);

const handler = new BackendSwapHandler(swapService);

export default async function quoteHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/quote' });

  try {
    const { fromToken, toToken, amount } = req.body;

    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({ 
        error: 'Missing required parameters: fromToken, toToken, amount' 
      });
    }

    const result = await handler.getSwapQuote(fromToken, toToken, amount);
    return res.status(200).json(result);

  } catch (error) {
    logger.error('Quote request failed', error as Error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}