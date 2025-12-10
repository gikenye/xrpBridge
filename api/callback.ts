import { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../logger';

export default async function callbackHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, operation: 'rampCallback' });
  
  try {
    logger.info('Received Ramp service callback', { body: req.body });
    
    const { status, transaction_id, user_address, amount, error } = req.body;
    
    switch (status) {
      case 'success':
        logger.info('Ramp transaction completed successfully', {
          transactionId: transaction_id,
          userAddress: user_address,
          amount
        });
        break;
      case 'failed':
        logger.error('Ramp transaction failed', new Error(error || 'Unknown error'), {
          transactionId: transaction_id,
          userAddress: user_address
        });
        break;
      default:
        logger.info('Ramp transaction status update', {
          status,
          transactionId: transaction_id,
          userAddress: user_address
        });
    }
    
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing Ramp callback', error as Error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}