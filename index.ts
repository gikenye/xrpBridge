// Import Bridge Kit and its dependencies
import "dotenv/config";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createAdapterFromPrivateKey } from "@circle-fin/adapter-ethers-v6";
import { inspect } from "util";

// Initialize the SDK
const kit = new BridgeKit();

const bridgeUSDC = async (): Promise<void> => {
  try {
    // Initialize the adapter which lets you transfer tokens from your wallet on any EVM-compatible chain
    const adapter = createAdapterFromPrivateKey({
      privateKey: process.env.PRIVATE_KEY as string,
    });

    console.log("---------------Starting Bridging---------------");

    // Use the same adapter for the source and destination blockchains
    const result = await kit.bridge({
      from: { adapter, chain: "Ethereum" },
      to: { adapter, chain: "Base" }, //B
      amount: "0.1", //USDC to send from Eth to Base
    });

    console.log("RESULT", inspect(result, false, null, true));
  } catch (err) {
    console.log("ERROR", inspect(err, false, null, true));
  }
};

void bridgeUSDC();
