import { Transaction } from "ethereumjs-tx";
import { BN } from "ethereumjs-util";
import { callbackify } from "util";

import { Block } from "./Block";
import { Blockchain } from "./Blockchain";
import { Callback } from "./Callback";

export interface PBlockchain {
  getLatestBlock(): Promise<Block>;
  getBlock(blockHashOrNumber: Buffer | number | BN): Promise<Block | undefined>;
  addBlock(block: Block): Promise<Block>;
  deleteBlock(blockHash: Buffer): void;
  deleteLaterBlocks(block: Block): void;
  getTotalDifficulty(blockHash: Buffer): Promise<BN>;
  getTransaction(transactionHash: Buffer): Promise<Transaction | undefined>;
  getBlockByTransactionHash(
    transactionHash: Buffer
  ): Promise<Block | undefined>;
}

export function toBlockchain(pb: PBlockchain): Blockchain {
  async function getBlock(blockTag: number | Buffer | BN) {
    const block = await pb.getBlock(blockTag);
    if (block === undefined) {
      // tslint:disable-next-line only-buidler-error
      throw new Error("Block not found");
    }
  }
  function delBlock(blockHash: Buffer, cb: Callback) {
    try {
      pb.deleteBlock(blockHash);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null);
  }
  return {
    getBlock: callbackify(getBlock),
    putBlock: callbackify(pb.addBlock.bind(pb)),
    delBlock,
    getDetails,
    iterator,
  };
}

function getDetails(_: string, cb: Callback<void>) {
  cb(null);
}

function iterator() {
  // tslint:disable-next-line only-buidler-error
  throw new Error(".iterator() is not supported");
}
