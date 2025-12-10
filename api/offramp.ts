import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { logger } from '../logger.js';
import { getBridgeTransaction } from '../storage/bridgeTransactions.js';
import { database } from '../database.js';

export default async function offrampHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `offramp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.setContext({ requestId, endpoint: '/api/offramp' });

  try {
    const { 
      bridgeRequestId,
      trackingId,
      amount,
      userAddress,
      shortcode,
      mobile_network,
      currency = 'UGX',
      type,
      fee,
      callback_url = `${process.env.BASE_URL}/callback`
    } = req.body;

    if (!shortcode || !mobile_network) {
      logger.warn('Invalid request parameters', { body: req.body });
      return res.status(400).json({ 
        error: 'Missing required parameters: shortcode, mobile_network' 
      });
    }

    if (!trackingId && !userAddress) {
      return res.status(400).json({
        error: 'Either trackingId or userAddress is required'
      });
    }

    // Get user's available balance
    let usdcAmount: string;
    let resolvedUserAddress: string;
    await database.connect();
    
    if (amount) {
      usdcAmount = amount;
      resolvedUserAddress = userAddress || '';
    } else {
      // Get user from trackingId or use provided userAddress
      if (trackingId) {
        logger.info('Fetching transaction by trackingId', { trackingId });
        // @ts-ignore
        const txCollection = database['db'].collection('transactions');
        const tx = await txCollection.findOne({ 'metadata.trackingId': trackingId });
        
        if (!tx) {
          await database.disconnect();
          return res.status(400).json({
            error: 'Tracking ID not found',
            message: `No transaction found with trackingId ${trackingId}`
          });
        }
        
        resolvedUserAddress = tx.userAddress;
        usdcAmount = tx.amountOut || '0';
        logger.info('Found transaction by trackingId', { trackingId, userAddress: resolvedUserAddress, amount: usdcAmount });
      } else {
        resolvedUserAddress = userAddress!;
        logger.info('Fetching user balance from ledger', { userAddress: resolvedUserAddress });
        const balance = await database.getUserBalance(resolvedUserAddress, 'Base', 'USDC');
        
        if (parseFloat(balance) <= 0) {
          await database.disconnect();
          return res.status(400).json({ 
            error: 'Insufficient balance',
            message: `No USDC available for user ${resolvedUserAddress}`,
            availableBalance: balance
          });
        }
        
        usdcAmount = balance;
        logger.info('Using user ledger balance', { userAddress: resolvedUserAddress, usdcAmount });
      }
    }

    logger.info('Processing offramp request', { 
      bridgeRequestId,
      trackingId,
      userAddress: resolvedUserAddress,
      usdcAmount,
      currency,
      shortcode,
      mobile_network
    });

    // Get exchange rate
    logger.info('Fetching exchange rate', { currency });
    const exchangeResponse = await fetch(`${process.env.RAMPS_SERVICE}/v1/exchange-rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.RAMPS_KEY!
      },
      body: JSON.stringify({ currency_code: currency })
    });

    const exchangeData = await exchangeResponse.json();
    const sellingRate = exchangeData.data.selling_rate;
    const parsedUsdcAmount = parseFloat(usdcAmount);
    const fiatAmount = Math.floor(parsedUsdcAmount * sellingRate);

    logger.info('Exchange rate calculated', {
      usdcAmount: parsedUsdcAmount,
      sellingRate,
      fiatAmount,
      currency
    });

    // Get bridge transaction data if provided
    let bridgeData;
    if (bridgeRequestId) {
      bridgeData = getBridgeTransaction(bridgeRequestId);
      logger.info('Retrieved bridge transaction', { bridgeData });
    }

    // Check Base USDC balance and bridge if needed
    logger.info('Checking Base USDC balance');
    const baseProvider = new ethers.JsonRpcProvider('https://mainnet.base.org');
    const baseSigner = new ethers.Wallet(process.env.PRIVATE_KEY!, baseProvider);
    const baseUsdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    
    const baseUsdcContract = new ethers.Contract(
      baseUsdcAddress,
      ['function balanceOf(address account) view returns (uint256)'],
      baseProvider
    );
    
    const baseBalance = await baseUsdcContract.balanceOf(baseSigner.address);
    const baseBalanceFormatted = parseFloat(ethers.formatUnits(baseBalance, 6));
    const requiredAmount = parseFloat(usdcAmount);
    
    logger.info('Base balance check', { baseBalance: baseBalanceFormatted, required: requiredAmount });
    
    if (baseBalanceFormatted < requiredAmount) {
      logger.info('Insufficient Base balance, bridging from Ethereum');
      const { BridgeKit } = await import('@circle-fin/bridge-kit');
      const { createAdapterFromPrivateKey } = await import('@circle-fin/adapter-ethers-v6');
      
      const bridgeKit = new BridgeKit();
      const adapter = createAdapterFromPrivateKey({ privateKey: process.env.PRIVATE_KEY! });
      
      await bridgeKit.bridge({
        from: { adapter, chain: 'Ethereum' },
        to: { adapter, chain: 'Base' },
        amount: usdcAmount
      });
      
      logger.info('USDC bridged to Base', { amount: usdcAmount });
    }
    
    // Transfer USDC to settlement wallet on Base
    logger.info('Transferring USDC to settlement wallet on Base');
    const settlementWallet = process.env.SETTLEMENT_WALLET || '0x8005ee53E57aB11E11eAA4EFe07Ee3835Dc02F98';
    
    const usdcContract = new ethers.Contract(
      baseUsdcAddress,
      ['function transfer(address to, uint256 amount) returns (bool)'],
      baseSigner
    );
    
    const transferAmount = ethers.parseUnits(usdcAmount, 6);
    const transferTx = await usdcContract.transfer(settlementWallet, transferAmount);
    const transferReceipt = await transferTx.wait();

    logger.info('USDC transferred to settlement wallet', {
      txHash: transferReceipt.hash,
      amount: usdcAmount,
      settlementWallet
    });

    // Build offramp payload with fiat amount
    const offrampPayload: any = {
      transaction_hash: transferReceipt.hash,
      amount: fiatAmount.toString(),
      shortcode,
      mobile_network,
      chain: 'BASE',
      callback_url
    };

    if (fee) offrampPayload.fee = fee;
    if (type) offrampPayload.type = type;

    // Send to offramp service
    logger.info('Sending to offramp service', { currency, payload: offrampPayload });
    const response = await fetch(`${process.env.RAMPS_SERVICE}/v1/pay/${currency}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.RAMPS_KEY!
      },
      body: JSON.stringify(offrampPayload)
    });

    const offrampResult = await response.json();

    if (!response.ok) {
      logger.error('Offramp service error', new Error(JSON.stringify(offrampResult)));
      return res.status(response.status).json({
        status: 'error',
        error: 'Offramp service failed',
        details: offrampResult
      });
    }

    logger.info('Offramp completed successfully', { offrampResult });

    // Store offramp transaction and update balance ledger
    await database.saveOfframpTransaction({
      requestId,
      trackingId,
      userAddress: resolvedUserAddress,
      usdcAmount,
      fiatAmount: fiatAmount.toString(),
      currency,
      exchangeRate: sellingRate,
      shortcode,
      settlementTxHash: transferReceipt.hash,
      offrampId: offrampResult.id,
      status: 'success',
      timestamp: new Date()
    });
    
    // Update user balance ledger - deduct offramped amount
    await database.updateUserBalance({
      userAddress: resolvedUserAddress,
      chain: 'Base',
      token: 'USDC',
      amount: usdcAmount,
      operation: 'offramp',
      transactionHash: transferReceipt.hash
    });
    
    // Mark original transaction as offramped if trackingId provided
    if (trackingId) {
      // @ts-ignore
      const txCollection = database['db'].collection('transactions');
      await txCollection.updateOne(
        { 'metadata.trackingId': trackingId },
        { $set: { 'metadata.offramped': true, 'metadata.offrampedAt': new Date() } }
      );
    }
    
    await database.disconnect();

    return res.status(200).json({
      status: 'success',
      requestId,
      trackingId,
      settlementTxHash: transferReceipt.hash,
      offrampId: offrampResult.id,
      usdcAmount,
      fiatAmount: fiatAmount.toString(),
      exchangeRate: sellingRate,
      currency,
      shortcode,
      offrampResponse: offrampResult
    });

  } catch (error) {
    logger.error('Offramp request failed', error as Error);
    
    return res.status(500).json({
      error: 'Offramp failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
