interface BridgeTransaction {
  requestId: string;
  timestamp: number;
  userAddress: string;
  accounting: {
    userOriginalAmount?: string;
    swappedAmount: string;
    bridgedAmount: string;
    swapTxHash?: string;
    trackingId?: string;
  };
  transactions: {
    burnTxHash?: string;
    mintTxHash?: string;
  };
  source: { address: string; chain: string };
  destination: { address: string; chain: string };
  status: 'success' | 'error';
}

const bridgeTransactions = new Map<string, BridgeTransaction>();

export function storeBridgeTransaction(data: BridgeTransaction): void {
  bridgeTransactions.set(data.requestId, data);
}

export function getBridgeTransaction(requestId: string): BridgeTransaction | undefined {
  return bridgeTransactions.get(requestId);
}

export function getAllBridgeTransactions(): BridgeTransaction[] {
  return Array.from(bridgeTransactions.values());
}
