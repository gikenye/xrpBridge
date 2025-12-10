import { VercelRequest, VercelResponse } from '@vercel/node';
import { DepositVerifier } from '../depositVerifier.js';
import SwapService from '../swapService.js';
import { logger } from '../logger.js';
import { cache } from '../cache.js';
import { rateLimiter } from '../rateLimiter.js';

// Initialize services directly like other endpoints
const swapService = new SwapService(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!
);

const verifier = new DepositVerifier(
  process.env.RPC_URL!,
  swapService.getWalletAddress()
);

export default async function verifyDepositHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIP = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  if (!rateLimiter.isAllowed(clientIP as string)) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      retryAfter: 60 
    });
  }

  // Services are initialized at module level

  const requestId = `verify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/verify-deposit' });

  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      return res.status(400).json({ 
        error: 'Missing required parameter: transactionHash' 
      });
    }

    logger.info('Verifying deposit transaction', { transactionHash });

    // Check cache first
    const cacheKey = `deposit_${transactionHash}`;
    let verification = cache.get(cacheKey);
    
    if (!verification) {
      verification = await verifier.verifyDeposit(transactionHash);
      if (verification) {
        cache.set(cacheKey, verification, 300); // Cache for 5 minutes
      }
    }

    if (!verification) {
      return res.status(404).json({
        verified: false,
        error: 'No valid RLUSD deposit found in transaction'
      });
    }

    return res.status(200).json({
      verified: true,
      deposit: verification
    });

  } catch (error) {
    logger.error('Deposit verification failed', error as Error);
    console.error('DETAILED ERROR:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      details: String(error)
    });
  }
}