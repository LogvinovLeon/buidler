import { assert } from "chai";
import { BN } from "ethereumjs-util";

import { JsonRpcClient } from "../../../../src/internal/buidler-evm/jsonrpc/client";
import { HttpProvider } from "../../../../src/internal/core/providers/http";

// reused from ethers.js
const INFURA_URL = `https://mainnet.infura.io/v3/84842078b09946638c03157f83405213`;

describe("JsonRpcClient", () => {
  let response: any;
  const fakeProvider: HttpProvider = {
    send: () => Promise.resolve(response),
  } as any;

  it("can be constructed", () => {
    const client = JsonRpcClient.forUrl("");
    assert.instanceOf(client, JsonRpcClient);
  });

  it("can actually fetch real json-rpc", async () => {
    const client = JsonRpcClient.forUrl(INFURA_URL);
    const result = await client.getLatestBlockNumber();
    const minBlockNumber = 10494745; // mainnet block number at 20.07.20
    assert.isAtLeast(result.toNumber(), minBlockNumber);
  });

  describe("eth_blockNumber", () => {
    it("returns correct values", async () => {
      const client = new JsonRpcClient(fakeProvider);
      response = "0x1";
      const result = await client.getLatestBlockNumber();
      assert.isTrue(result.eq(new BN(1)));
    });

    it("validates the response", async () => {
      const client = new JsonRpcClient(fakeProvider);
      response = "foo";
      const result = await client.getLatestBlockNumber().catch((e) => e);
      assert.instanceOf(result, Error);
    });
  });
});
