import { assert } from "chai";
import Common from "ethereumjs-common";
import { BufferLike, Transaction } from "ethereumjs-tx";
import { BN, toBuffer, zeros } from "ethereumjs-util";
import { unknown } from "io-ts";

import { JsonRpcClient } from "../../../../../src/internal/buidler-evm/jsonrpc/client";
import { NotSupportedError } from "../../../../../src/internal/buidler-evm/provider/fork/errors";
import { ForkBlockchain } from "../../../../../src/internal/buidler-evm/provider/fork/ForkBlockchain";
import {
  randomAddressBuffer,
  randomHashBuffer,
} from "../../../../../src/internal/buidler-evm/provider/fork/random";
import { Block } from "../../../../../src/internal/buidler-evm/provider/types/Block";
import {
  BLOCK_HASH_OF_10496585,
  BLOCK_NUMBER_OF_10496585,
  FIRST_TX_HASH_OF_10496585,
  INFURA_URL,
  LAST_TX_HASH_OF_10496585,
  TOTAL_DIFFICULTY_OF_BLOCK_10496585,
} from "../../helpers/constants";

describe("ForkBlockchain", () => {
  let client: JsonRpcClient;
  let forkBlockNumber: BN;
  let common: Common;
  let fb: ForkBlockchain;

  function createBlock(parent: Block, difficulty: BufferLike = zeros(32)) {
    return new Block(
      {
        header: {
          number: new BN(parent.header.number).addn(1),
          parentHash: parent.hash(),
          difficulty,
        },
      },
      { common }
    );
  }

  function createRandomTransaction() {
    return new Transaction({ to: randomAddressBuffer() });
  }

  before(async () => {
    client = JsonRpcClient.forUrl(INFURA_URL);
    forkBlockNumber = await client.getLatestBlockNumber();
    common = new Common("mainnet");
    common.setHardfork(common.activeHardfork(forkBlockNumber.toNumber()));
  });

  beforeEach(async () => {
    fb = new ForkBlockchain(client, forkBlockNumber, common);
  });

  it("can be constructed", () => {
    assert.instanceOf(fb, ForkBlockchain);
  });

  describe("getBlock", () => {
    it("can get remote block object by block number", async () => {
      const block = await fb.getBlock(BLOCK_NUMBER_OF_10496585);

      assert.isTrue(block?.hash().equals(BLOCK_HASH_OF_10496585));
      assert.equal(block?.transactions.length, 192);
      assert.isTrue(
        block?.transactions[0].hash().equals(FIRST_TX_HASH_OF_10496585)
      );
      assert.isTrue(
        block?.transactions[191].hash().equals(LAST_TX_HASH_OF_10496585)
      );
    });

    it("can get remote block object by hash", async () => {
      const block = await fb.getBlock(BLOCK_HASH_OF_10496585);

      assert.isTrue(block?.hash().equals(BLOCK_HASH_OF_10496585));
      assert.equal(block?.transactions.length, 192);
      assert.isTrue(
        block?.transactions[0].hash().equals(FIRST_TX_HASH_OF_10496585)
      );
      assert.isTrue(
        block?.transactions[191].hash().equals(LAST_TX_HASH_OF_10496585)
      );
    });

    it("caches the block object and returns the same one for subsequent calls", async () => {
      const blockOne = await fb.getBlock(BLOCK_NUMBER_OF_10496585);
      const blockTwo = await fb.getBlock(BLOCK_HASH_OF_10496585);
      const blockThree = await fb.getBlock(BLOCK_NUMBER_OF_10496585);
      const blockFour = await fb.getBlock(BLOCK_HASH_OF_10496585);
      assert.equal(blockOne, blockTwo);
      assert.equal(blockTwo, blockThree);
      assert.equal(blockThree, blockFour);
    });

    it("returns undefined for non-existent block", async () => {
      assert.equal(await fb.getBlock(randomHashBuffer()), undefined);
    });

    it("can get remote block object with create transaction", async () => {
      const daiCreationBlock = new BN(4719568);
      const daiCreateTxPosition = 85;
      const block = await fb.getBlock(daiCreationBlock);
      assert.isTrue(
        block?.transactions[daiCreateTxPosition].to.equals(Buffer.from([]))
      );
      assert.isTrue(
        block?.transactions[daiCreateTxPosition]
          .hash()
          .equals(
            toBuffer(
              "0xb95343413e459a0f97461812111254163ae53467855c0d73e0f1e7c5b8442fa3"
            )
          )
      );
    });

    it("cannot get remote blocks that are newer than forkBlockNumber", async () => {
      fb = new ForkBlockchain(client, forkBlockNumber.subn(10), common);
      const newerBlock = await client.getBlockByNumber(forkBlockNumber.subn(5));

      assert.equal(await fb.getBlock(newerBlock!.hash!), undefined);
      assert.equal(await fb.getBlock(newerBlock!.hash!), undefined);
    });

    it("can retrieve inserted block by hash", async () => {
      const block = createBlock(await fb.getLatestBlock());
      await fb.putBlock(block);
      const savedBlock = await fb.getBlock(block.hash());
      assert.equal(savedBlock, block);
    });
  });

  describe("getLatestBlock", () => {
    it("returns the block at which we fork if no blocks were added", async () => {
      fb = new ForkBlockchain(client, BLOCK_NUMBER_OF_10496585, common);
      const block = await fb.getLatestBlock();

      assert.isTrue(block?.hash().equals(BLOCK_HASH_OF_10496585));
      assert.equal(block?.transactions.length, 192);
      assert.isTrue(
        block?.transactions[0].hash().equals(FIRST_TX_HASH_OF_10496585)
      );
      assert.isTrue(
        block?.transactions[191].hash().equals(LAST_TX_HASH_OF_10496585)
      );
    });

    it("returns the latest added block", async () => {
      const block = createBlock(await fb.getLatestBlock());
      await fb.putBlock(block);
      const latestBlock = await fb.getLatestBlock();
      assert.equal(latestBlock, block);
    });
  });

  describe("putBlock", () => {
    it("can save a new block in the blockchain", async () => {
      const block = createBlock(await fb.getLatestBlock());
      const returnedBlock = await fb.putBlock(block);
      const savedBlock = await fb.getBlock(forkBlockNumber.addn(1));
      assert.equal(returnedBlock, block);
      assert.equal(savedBlock, block);
    });

    it("rejects blocks with invalid block number", async () => {
      await assert.isRejected(
        fb.putBlock(new Block({ header: { number: forkBlockNumber.addn(2) } })),
        Error,
        "Invalid block number"
      );
    });

    it("rejects blocks with invalid parent hash", async () => {
      await assert.isRejected(
        fb.putBlock(new Block({ header: { number: forkBlockNumber.addn(1) } })),
        Error,
        "Invalid parent hash"
      );
    });

    it("can save more than one block", async () => {
      const blockOne = createBlock(await fb.getLatestBlock());
      const blockTwo = createBlock(blockOne);
      const blockThree = createBlock(blockTwo);

      await fb.putBlock(blockOne);
      await fb.putBlock(blockTwo);
      await fb.putBlock(blockThree);

      assert.equal(await fb.getBlock(forkBlockNumber.addn(1)), blockOne);
      assert.equal(await fb.getBlock(forkBlockNumber.addn(2)), blockTwo);
      assert.equal(await fb.getBlock(forkBlockNumber.addn(3)), blockThree);
    });
  });

  describe("getDetails", () => {
    it("resolves", async () => {
      await assert.isFulfilled(fb.getDetails(""));
    });

    it("calls callback with null", async () => {
      const result = await new Promise((resolve) =>
        fb.asBlockchain().getDetails("", resolve)
      );
      assert.isNull(result);
    });
  });

  describe("delBlock", () => {
    it("removes the block and all subsequent ones", async () => {
      const blockOne = createBlock(await fb.getLatestBlock());
      const blockTwo = createBlock(blockOne);
      const blockThree = createBlock(blockTwo);

      await fb.putBlock(blockOne);
      await fb.putBlock(blockTwo);
      await fb.putBlock(blockThree);

      await fb.delBlock(blockOne.hash());

      assert.equal(await fb.getBlock(blockOne.hash()), undefined);
      assert.equal(await fb.getBlock(blockTwo.hash()), undefined);
      assert.equal(await fb.getBlock(blockThree.hash()), undefined);
    });

    it("updates the latest block number", async () => {
      const blockOne = createBlock(await fb.getLatestBlock());
      const blockTwo = createBlock(blockOne);
      const blockThree = createBlock(blockTwo);

      await fb.putBlock(blockOne);
      await fb.putBlock(blockTwo);
      await fb.delBlock(blockTwo.hash());

      assert.equal(await fb.getLatestBlock(), blockOne);
      await assert.isRejected(
        fb.putBlock(blockThree),
        Error,
        "Invalid block number"
      );
    });

    it("is possible to add a block after delete", async () => {
      const block = createBlock(await fb.getLatestBlock());
      const otherBlock = createBlock(
        await fb.getLatestBlock(),
        randomHashBuffer()
      );
      await fb.putBlock(block);
      await fb.delBlock(block.hash());
      await fb.putBlock(otherBlock);
      assert.equal(await fb.getBlock(otherBlock.hash()), otherBlock);
    });

    it("throws when hash of non-existent block is given", async () => {
      await assert.isRejected(
        fb.delBlock(new Block().hash()),
        Error,
        "Block not found"
      );
    });

    it("throws when hash of not previously fetched remote block is given", async () => {
      // This is here because we do not want to fetch remote blocks for this operation
      await assert.isRejected(
        fb.delBlock(BLOCK_HASH_OF_10496585),
        Error,
        "Block not found"
      );
    });

    it("throws on attempt to remove remote block", async () => {
      const remoteBlock = await fb.getBlock(BLOCK_NUMBER_OF_10496585);
      await assert.isRejected(
        fb.delBlock(remoteBlock!.hash()),
        Error,
        "Cannot delete remote block"
      );
    });

    it("throws on attempt to remove the block from which we fork", async () => {
      const forkBlock = await fb.getLatestBlock();
      await assert.isRejected(
        fb.delBlock(forkBlock.hash()),
        Error,
        "Cannot delete remote block"
      );
    });
  });

  describe("iterator", () => {
    it("throws not supported error", async () => {
      await assert.isRejected(
        fb.iterator("", () => {}),
        NotSupportedError,
        "iterator"
      );
    });
  });

  describe("deleteAllFollowingBlocks", () => {
    it("removes all blocks subsequent to the given block", async () => {
      const blockOne = await fb.getLatestBlock();
      const blockTwo = createBlock(blockOne);
      const blockThree = createBlock(blockTwo);

      await fb.putBlock(blockTwo);
      await fb.putBlock(blockThree);

      fb.deleteAllFollowingBlocks(blockOne);

      assert.equal(await fb.getBlock(blockOne.hash()), blockOne);
      assert.equal(await fb.getBlock(blockTwo.hash()), undefined);
      assert.equal(await fb.getBlock(blockThree.hash()), undefined);
    });

    it("throws if given block is not present in blockchain", async () => {
      const blockOne = createBlock(await fb.getLatestBlock());
      const notAddedBlock = createBlock(blockOne);
      const fakeBlockOne = createBlock(
        await fb.getLatestBlock(),
        randomHashBuffer()
      );

      await fb.putBlock(blockOne);

      assert.throws(
        () => fb.deleteAllFollowingBlocks(notAddedBlock),
        Error,
        "Invalid block"
      );
      assert.throws(
        () => fb.deleteAllFollowingBlocks(fakeBlockOne),
        Error,
        "Invalid block"
      );
    });

    it("does not throw if there are no following blocks", async () => {
      const blockOne = createBlock(await fb.getLatestBlock());
      await fb.putBlock(blockOne);
      assert.doesNotThrow(() => fb.deleteAllFollowingBlocks(blockOne));
    });

    it("throws on attempt to remove remote blocks", async () => {
      const block = await fb.getBlock(BLOCK_NUMBER_OF_10496585);
      assert.throws(
        () => fb.deleteAllFollowingBlocks(block!),
        Error,
        "Cannot delete remote block"
      );
    });
  });

  describe("getBlockTotalDifficulty", () => {
    it("rejects when hash of non-existent block is given", async () => {
      await assert.isRejected(
        fb.getBlockTotalDifficulty(randomHashBuffer()),
        Error,
        "Block not found"
      );
    });

    it("can get difficulty of the genesis block", async () => {
      const genesis = await client.getBlockByNumber(new BN(0), false);
      const difficulty = await fb.getBlockTotalDifficulty(genesis?.hash!);
      assert.equal(difficulty.toNumber(), genesis?.difficulty.toNumber());
    });

    it("does not return total difficulty of a deleted block", async () => {
      const block = createBlock(await fb.getLatestBlock());
      await fb.putBlock(block);
      await fb.delBlock(block.hash());

      await assert.isRejected(
        fb.getBlockTotalDifficulty(block.hash()),
        Error,
        "Block not found"
      );
    });

    it("can get total difficulty of a remote block", async () => {
      const td = await fb.getBlockTotalDifficulty(BLOCK_HASH_OF_10496585);

      assert.equal(
        td.toString(),
        TOTAL_DIFFICULTY_OF_BLOCK_10496585.toString()
      );
    });

    it("can get total difficulty of a new block", async () => {
      const latest = await fb.getLatestBlock();
      const block = createBlock(latest, 1000);

      const latestDifficulty = await fb.getBlockTotalDifficulty(latest.hash());

      await fb.putBlock(block);

      const totalDifficulty = await fb.getBlockTotalDifficulty(block.hash());

      assert.equal(
        totalDifficulty.toString(),
        latestDifficulty.addn(1000).toString()
      );
    });
  });

  describe("getTransaction", () => {
    it("returns undefined for unknown transactions", async () => {
      const transaction = createRandomTransaction();
      assert.equal(await fb.getTransaction(transaction.hash()), undefined);
    });

    it("returns a known transaction", async () => {
      const block = createBlock(await fb.getLatestBlock());
      const transaction = createRandomTransaction();
      block.transactions.push(transaction);
      await fb.putBlock(block);

      const result = await fb.getTransaction(transaction.hash());
      assert.equal(result, transaction);
    });

    it("returns a known remote transaction", async () => {
      const result = await fb.getTransaction(FIRST_TX_HASH_OF_10496585);
      assert.isTrue(result?.hash().equals(FIRST_TX_HASH_OF_10496585));
    });

    it("returns undefined for newer remote transactions", async () => {
      fb = new ForkBlockchain(client, BLOCK_NUMBER_OF_10496585.subn(1), common);
      assert.equal(
        await fb.getTransaction(FIRST_TX_HASH_OF_10496585),
        undefined
      );
    });

    it("forgets transactions after block is removed", async () => {
      const block = createBlock(await fb.getLatestBlock());
      const transaction = createRandomTransaction();
      block.transactions.push(transaction);
      await fb.putBlock(block);
      await fb.delBlock(block.hash());

      assert.equal(await fb.getTransaction(transaction.hash()), undefined);
    });
  });

  describe("getBlockByTransactionHash", () => {
    it("returns undefined for unknown transactions", async () => {
      const transaction = createRandomTransaction();
      assert.equal(
        await fb.getBlockByTransactionHash(transaction.hash()),
        undefined
      );
    });

    it("returns block for a known transaction", async () => {
      const block = createBlock(await fb.getLatestBlock());
      const transaction = createRandomTransaction();
      block.transactions.push(transaction);
      await fb.putBlock(block);

      const result = await fb.getBlockByTransactionHash(transaction.hash());
      assert.equal(result, block);
    });

    it("returns a block for known remote transaction", async () => {
      const result = await fb.getBlockByTransactionHash(
        FIRST_TX_HASH_OF_10496585
      );
      const block = await fb.getBlock(BLOCK_HASH_OF_10496585);
      assert.equal(result, block);
    });

    it("returns undefined for newer remote transactions", async () => {
      fb = new ForkBlockchain(client, BLOCK_NUMBER_OF_10496585.subn(1), common);
      assert.equal(
        await fb.getBlockByTransactionHash(FIRST_TX_HASH_OF_10496585),
        undefined
      );
    });

    it("forgets transactions after block is removed", async () => {
      const block = createBlock(await fb.getLatestBlock());
      const transaction = createRandomTransaction();
      block.transactions.push(transaction);
      await fb.putBlock(block);
      await fb.delBlock(block.hash());

      assert.equal(
        await fb.getBlockByTransactionHash(transaction.hash()),
        undefined
      );
    });
  });
});
