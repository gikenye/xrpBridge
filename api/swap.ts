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
    const { userAddress, fromToken, toToken, amount, targetToken, depositTxHash } = req.body;

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
      targetToken,
      depositTxHash: depositTxHash || 'not_provided'
    });

    // Verify deposit only if depositTxHash is explicitly provided
    if (depositTxHash && depositTxHash !== 'not_provided') {
      const { database } = await import('../database.js');
      const { ethers } = await import('ethers');
      
      await database.connect();
      let depositTx = await database.getTransaction(depositTxHash);
      
      // If not in database, check onchain
      if (!depositTx) {
        logger.info('Deposit not in database, checking onchain', { depositTxHash });
        
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
        const receipt = await provider.getTransactionReceipt(depositTxHash);
        
        if (!receipt) {
          await database.disconnect();
          return res.status(400).json({
            error: 'Transaction not found',
            message: `Transaction ${depositTxHash} not found onchain`
          });
        }
        
        // Parse transfer event to backend wallet
        const backendWallet = swapService.getWalletAddress();
        const transferEvent = receipt.logs.find((log: any) => {
          return log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
                 log.topics[2]?.toLowerCase().includes(backendWallet.toLowerCase().slice(2));
        });
        
        if (!transferEvent) {
          await database.disconnect();
          return res.status(400).json({
            error: 'Invalid deposit',
            message: 'No transfer to backend wallet found in transaction'
          });
        }
        
        const depositAmount = ethers.formatUnits(transferEvent.data, 18);
        logger.info('Onchain deposit verified', { depositTxHash, depositAmount });
        
        // Verify amount
        if (parseFloat(depositAmount) < amount) {
          await database.disconnect();
          return res.status(400).json({
            error: 'Insufficient deposit',
            message: `Deposit amount ${depositAmount} is less than requested ${amount}`
          });
        }
      } else {
        // Verify from database record
        if (depositTx.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
          await database.disconnect();
          return res.status(403).json({
            error: 'Unauthorized',
            message: 'Deposit transaction does not belong to this user'
          });
        }
        
        if (parseFloat(depositTx.amountIn) < amount) {
          await database.disconnect();
          return res.status(400).json({
            error: 'Insufficient deposit',
            message: `Deposit amount ${depositTx.amountIn} is less than requested ${amount}`
          });
        }
        
        logger.info('Database deposit verified', { depositTxHash, depositAmount: depositTx.amountIn });
      }
      
      await database.disconnect();
    }

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