import { VercelRequest, VercelResponse } from '@vercel/node';
import { BridgeKit } from '@circle-fin/bridge-kit';
import { createAdapterFromPrivateKey } from '@circle-fin/adapter-ethers-v6';
import { logger } from '../logger.js';
import { storeBridgeTransaction } from '../storage/bridgeTransactions.js';
import { database } from '../database.js';

const bridgeKit = new BridgeKit();
const adapter = createAdapterFromPrivateKey({
  privateKey: process.env.PRIVATE_KEY!,
});

export default async function bridgeHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `bridge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/bridge' });

  try {
    const { amount, userAddress, swapTransaction } = req.body;

    // If swapTransaction is provided, use finalAmount for accounting
    const bridgeAmount = swapTransaction?.finalAmount || amount;
    const originalAmount = swapTransaction?.originalAmount;
    const swapTxHash = swapTransaction?.transactionHash;
    const trackingId = swapTransaction?.trackingId;

    if (!bridgeAmount || !userAddress) {
      logger.warn('Invalid request parameters', { body: req.body });
      return res.status(400).json({ 
        error: 'Missing required parameters: amount (or swapTransaction.finalAmount), userAddress' 
      });
    }

    logger.info('Processing bridge request', { 
      bridgeAmount, 
      originalAmount, 
      userAddress,
      swapTxHash,
      trackingId
    });

    // Bridge USDC from Ethereum to Base using Circle's CCTP
    const bridgeResult = await bridgeKit.bridge({
      from: { adapter, chain: 'Ethereum' },
      to: { adapter, chain: 'Base' },
      amount: bridgeAmount.toString(),
    });

    const approveStep = bridgeResult.steps.find((step: any) => step.name === 'approve');
    const burnStep = bridgeResult.steps.find((step: any) => step.name === 'burn');
    const attestationStep = bridgeResult.steps.find((step: any) => step.name === 'fetchAttestation');
    const mintStep = bridgeResult.steps.find((step: any) => step.name === 'mint');

    logger.info('Bridge completed', {
      state: bridgeResult.state,
      burnTxHash: burnStep?.txHash,
      mintTxHash: mintStep?.txHash,
      bridgeAmount,
      originalAmount,
      swapTxHash
    });

    // Check if bridge failed
    if (bridgeResult.state === 'error') {
      const errorStep = bridgeResult.steps.find((step: any) => step.state === 'error');
      return res.status(500).json({
        status: 'error',
        error: 'Bridge failed',
        message: (errorStep?.data as any)?.error || 'Unknown bridge error',
        bridgeState: bridgeResult.state,
        steps: bridgeResult.steps.map((step: any) => ({
          name: step.name,
          state: step.state,
          txHash: step.txHash,
          explorerUrl: step.explorerUrl
        })),
        bridgeAmount,
        originalAmount,
        swapTxHash
      });
    }

    const response = {
      status: 'success' as const,
      requestId,
      trackingId,
      bridgeState: bridgeResult.state,
      amount: bridgeResult.amount,
      token: bridgeResult.token,
      accounting: {
        userOriginalAmount: originalAmount,
        swappedAmount: bridgeAmount,
        bridgedAmount: bridgeResult.amount,
        swapTxHash,
        trackingId
      },
      source: {
        address: bridgeResult.source.address,
        chain: bridgeResult.source.chain.name
      },
      destination: {
        address: bridgeResult.destination.address,
        chain: bridgeResult.destination.chain.name
      },
      transactions: {
        approve: {
          txHash: approveStep?.txHash,
          explorerUrl: approveStep?.explorerUrl,
          state: approveStep?.state
        },
        burn: {
          txHash: burnStep?.txHash,
          explorerUrl: burnStep?.explorerUrl,
          state: burnStep?.state
        },
        mint: {
          txHash: mintStep?.txHash,
          explorerUrl: mintStep?.explorerUrl,
          state: mintStep?.state
        }
      },
      attestation: {
        status: (attestationStep?.data as any)?.status,
        eventNonce: (attestationStep?.data as any)?.eventNonce
      },
      steps: bridgeResult.steps.map((step: any) => ({
        name: step.name,
        state: step.state,
        txHash: step.txHash,
        explorerUrl: step.explorerUrl
      }))
    };

    storeBridgeTransaction({
      requestId,
      timestamp: Date.now(),
      userAddress,
      accounting: {
        userOriginalAmount: originalAmount,
        swappedAmount: bridgeAmount,
        bridgedAmount: bridgeResult.amount,
        swapTxHash,
        trackingId
      },
      transactions: {
        burnTxHash: burnStep?.txHash,
        mintTxHash: mintStep?.txHash
      },
      source: {
        address: bridgeResult.source.address,
        chain: bridgeResult.source.chain.name
      },
      destination: {
        address: bridgeResult.destination.address,
        chain: bridgeResult.destination.chain.name
      },
      status: 'success'
    });

    // Update user balance ledger - deduct from Ethereum, add to Base
    await database.connect();
    await database.updateUserBalance({
      userAddress,
      chain: 'Ethereum',
      token: 'USDC',
      amount: bridgeAmount,
      operation: 'bridge',
      transactionHash: burnStep?.txHash || ''
    });
    await database.updateUserBalance({
      userAddress,
      chain: 'Base',
      token: 'USDC',
      amount: bridgeResult.amount,
      operation: 'bridge',
      transactionHash: mintStep?.txHash || ''
    });
    await database.disconnect();

    return res.status(200).json(response);

  } catch (error) {
    logger.error('Bridge request failed', error as Error);
    
    return res.status(500).json({
      error: 'Bridge failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
