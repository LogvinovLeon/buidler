import StateManager from "@nomiclabs/ethereumjs-vm/dist/state/stateManager";
import { assert } from "chai";
import Account from "ethereumjs-account";
import { BN } from "ethereumjs-util";

import { randomAddressBuffer } from "../../../../src/internal/hardhat-network/provider/fork/random";
import { TransactionPool } from "../../../../src/internal/hardhat-network/provider/TransactionPool";
import { PStateManager } from "../../../../src/internal/hardhat-network/provider/types/PStateManager";
import { asPStateManager } from "../../../../src/internal/hardhat-network/provider/utils/asPStateManager";
import { createTestFakeTransaction } from "../helpers/blockchain";

describe("Transaction Pool", () => {
  let stateManager: PStateManager;
  let txPool: TransactionPool;

  beforeEach(() => {
    stateManager = asPStateManager(new StateManager());
    txPool = new TransactionPool(stateManager);
  });

  describe("addTransaction", () => {
    it("can add a transaction", async () => {
      const address = randomAddressBuffer();
      const toPut = new Account({ nonce: new BN(0) });
      await stateManager.putAccount(address, toPut);
      const tx = createTestFakeTransaction({ from: address, nonce: 0 });
      await txPool.addTransaction(tx);

      const pendingTxs = txPool.getPendingTransactions();
      assert.lengthOf(pendingTxs, 1);
      assert.deepEqual(pendingTxs[0].raw, tx.raw);
    });

    it("can add multiple transactions", async () => {
      const address = randomAddressBuffer();
      const toPut = new Account({ nonce: new BN(0) });
      await stateManager.putAccount(address, toPut);
      const tx1 = createTestFakeTransaction({ from: address, nonce: 0 });
      const tx2 = createTestFakeTransaction({ from: address, nonce: 1 });

      await txPool.addTransaction(tx1);
      await txPool.addTransaction(tx2);

      const pendingTxs = txPool.getPendingTransactions();
      assert.sameDeepMembers(
        pendingTxs.map((tx) => tx.raw),
        [tx1, tx2].map((tx) => tx.raw)
      );
    });

    it("throws as error when transaction nonce is too low", async () => {
      const address = randomAddressBuffer();
      const toPut = new Account({ nonce: new BN(1) });
      await stateManager.putAccount(address, toPut);

      await assert.isRejected(
        txPool.addTransaction(
          createTestFakeTransaction({ from: address, nonce: 0 })
        ),
        Error,
        "Nonce too low"
      );
    });

    it("can track account's nonce", async () => {
      const address = randomAddressBuffer();
      const toPut = new Account({ nonce: new BN(0) });
      await stateManager.putAccount(address, toPut);

      await txPool.addTransaction(
        createTestFakeTransaction({ from: address, nonce: 0 })
      );
      assert.equal((await txPool.getExecutableNonce(address)).toNumber(), 1);

      await txPool.addTransaction(
        createTestFakeTransaction({ from: address, nonce: 1 })
      );
      assert.equal((await txPool.getExecutableNonce(address)).toNumber(), 2);
    });

    it("can add transactions to pending and queued", async () => {
      const address = randomAddressBuffer();
      const toPut = new Account({ nonce: new BN(0) });
      await stateManager.putAccount(address, toPut);
      const tx1 = createTestFakeTransaction({ from: address, nonce: 0 });
      const tx2 = createTestFakeTransaction({ from: address, nonce: 4 });

      await txPool.addTransaction(tx1);
      assert.equal((await txPool.getExecutableNonce(address)).toNumber(), 1);
      const pendingTxs = txPool.getPendingTransactions();
      assert.lengthOf(pendingTxs, 1);
      assert.deepEqual(pendingTxs[0].raw, tx1.raw);

      await txPool.addTransaction(tx2);
      assert.equal((await txPool.getExecutableNonce(address)).toNumber(), 1);
      assert.lengthOf(txPool.getPendingTransactions(), 1);
    });
  });
});
