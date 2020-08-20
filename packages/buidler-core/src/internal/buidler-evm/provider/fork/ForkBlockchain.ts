import Common from "ethereumjs-common";
import { Transaction } from "ethereumjs-tx";
import { BN, bufferToHex, bufferToInt } from "ethereumjs-util";
import { callbackify } from "util";

import { JsonRpcClient } from "../../jsonrpc/client";
import { RpcBlockWithTransactions, RpcTransaction } from "../../jsonrpc/types";
import { Block } from "../types/Block";
import { Blockchain } from "../types/Blockchain";
import { PBlockchain } from "../types/PBlockchain";

import { NotSupportedError } from "./errors";
import { rpcToBlockData } from "./rpcToBlockData";
import { rpcToTxData } from "./rpcToTxData";

// TODO: figure out what errors we wanna throw
/* tslint:disable only-buidler-error */

export class ForkBlockchain implements PBlockchain {
  private _blocksByNumber: Map<number, Block> = new Map();
  private _blocksByHash: Map<string, Block> = new Map();
  private _totalDifficultyByBlockHash: Map<string, BN> = new Map();
  private _transactions: Map<string, Transaction> = new Map();
  private _transactionToBlock: Map<string, Block> = new Map();
  private _latestBlockNumber = this._forkBlockNumber;

  constructor(
    private _jsonRpcClient: JsonRpcClient,
    private _forkBlockNumber: BN,
    private _common: Common
  ) {}

  public async getBlock(
    blockHashOrNumber: Buffer | number | BN
  ): Promise<Block> {
    if (Buffer.isBuffer(blockHashOrNumber)) {
      return this._getBlockByHash(blockHashOrNumber);
    }
    return this._getBlockByNumber(new BN(blockHashOrNumber));
  }

  public async getLatestBlock(): Promise<Block> {
    return this.getBlock(this._latestBlockNumber);
  }

  public async putBlock(block: Block): Promise<Block> {
    const blockNumber = new BN(block.header.number);
    if (!blockNumber.eq(this._latestBlockNumber.addn(1))) {
      throw new Error("Invalid block number");
    }
    const parent = await this.getLatestBlock();
    if (!block.header.parentHash.equals(parent.hash())) {
      throw new Error("Invalid parent hash");
    }
    this._latestBlockNumber = this._latestBlockNumber.addn(1);

    const blockHash = bufferToHex(block.hash());
    this._blocksByNumber.set(blockNumber.toNumber(), block);
    this._blocksByHash.set(blockHash, block);
    this._totalDifficultyByBlockHash.set(
      blockHash,
      await this._computeTotalDifficulty(block)
    );
    this._processTransactions(block);

    return block;
  }

  public async delBlock(blockHash: Buffer): Promise<void> {
    this._delBlock(blockHash);
  }

  public async getDetails(_: string): Promise<void> {}

  public async iterator(name: string, onBlock: any): Promise<void> {
    // this function is only ever used in runBlockchain which is not used in Buidler
    throw new NotSupportedError("iterator");
  }

  public deleteAllFollowingBlocks(block: Block): void {
    const blockNumber = bufferToInt(block.header.number);
    const savedBlock = this._blocksByNumber.get(blockNumber);
    if (savedBlock === undefined || !savedBlock.hash().equals(block.hash())) {
      throw new Error("Invalid block");
    }

    const nextBlockNumber = blockNumber + 1;
    if (this._forkBlockNumber.gten(nextBlockNumber)) {
      throw new Error("Cannot delete remote block");
    }
    const nextBlock = this._blocksByNumber.get(nextBlockNumber);
    if (nextBlock !== undefined) {
      return this._delBlock(nextBlock.hash());
    }
  }

  public async getBlockTotalDifficulty(blockHash: Buffer): Promise<BN> {
    let td = this._totalDifficultyByBlockHash.get(bufferToHex(blockHash));
    if (td !== undefined) {
      return td;
    }
    await this.getBlock(blockHash);
    td = this._totalDifficultyByBlockHash.get(bufferToHex(blockHash));
    if (td === undefined) {
      throw new Error("This should never happen");
    }

    return td;
  }

  public async getTransaction(transactionHash: Buffer): Promise<Transaction> {
    const tx = this._transactions.get(bufferToHex(transactionHash));
    if (tx === undefined) {
      const remote = await this._jsonRpcClient.getTransactionByHash(
        transactionHash
      );
      return this._processRemoteTransaction(remote);
    }
    return tx;
  }

  public async getBlockByTransactionHash(
    transactionHash: Buffer
  ): Promise<Block> {
    let block = this._transactionToBlock.get(bufferToHex(transactionHash));
    if (block === undefined) {
      const remote = await this._jsonRpcClient.getTransactionByHash(
        transactionHash
      );
      await this._processRemoteTransaction(remote);
      if (remote !== null && remote.blockHash !== null) {
        await this.getBlock(remote.blockHash);
        block = this._transactionToBlock.get(bufferToHex(transactionHash));
      }
    }
    if (block === undefined) {
      throw new Error("Transaction not found");
    }
    return block;
  }

  public asBlockchain(): Blockchain {
    return {
      getBlock: callbackify(this.getBlock.bind(this)),
      putBlock: callbackify(this.putBlock.bind(this)),
      delBlock: callbackify(this.delBlock.bind(this)),
      getDetails: callbackify(this.getDetails.bind(this)),
      iterator: callbackify(this.iterator.bind(this)),
    };
  }

  private _processTransactions(block: Block) {
    for (const transaction of block.transactions) {
      const transactionHash = bufferToHex(transaction.hash());
      this._transactions.set(transactionHash, transaction);
      this._transactionToBlock.set(transactionHash, block);
    }
  }

  private async _getBlockByHash(blockHash: Buffer) {
    const block = this._blocksByHash.get(bufferToHex(blockHash));
    if (block !== undefined) {
      return block;
    }
    const rpcBlock = await this._jsonRpcClient.getBlockByHash(blockHash, true);
    return this._processRemoteBlock(rpcBlock);
  }

  private async _getBlockByNumber(blockNumber: BN) {
    if (blockNumber.gt(this._latestBlockNumber)) {
      throw new Error("Block not found");
    }
    const block = this._blocksByNumber.get(blockNumber.toNumber());
    if (block !== undefined) {
      return block;
    }
    const rpcBlock = await this._jsonRpcClient.getBlockByNumber(
      blockNumber,
      true
    );
    return this._processRemoteBlock(rpcBlock);
  }

  private async _processRemoteBlock(rpcBlock: RpcBlockWithTransactions | null) {
    if (
      rpcBlock === null ||
      rpcBlock.hash === null ||
      rpcBlock.number === null ||
      rpcBlock.number.gt(this._forkBlockNumber)
    ) {
      throw new Error("Block not found");
    }
    const block = new Block(rpcToBlockData(rpcBlock), { common: this._common });
    this._blocksByNumber.set(rpcBlock.number.toNumber(), block);
    this._blocksByHash.set(bufferToHex(rpcBlock.hash), block);
    this._totalDifficultyByBlockHash.set(
      bufferToHex(rpcBlock.hash),
      rpcBlock.totalDifficulty
    );
    this._processTransactions(block);

    return block;
  }

  private async _processRemoteTransaction(
    rpcTransaction: RpcTransaction | null
  ) {
    if (
      rpcTransaction === null ||
      rpcTransaction.blockNumber === null ||
      rpcTransaction.blockNumber.gt(this._forkBlockNumber)
    ) {
      throw new Error("Transaction not found");
    }
    const transaction = new Transaction(rpcToTxData(rpcTransaction), {
      common: this._common,
    });
    this._transactions.set(bufferToHex(rpcTransaction.hash), transaction);
    return transaction;
  }

  private async _computeTotalDifficulty(block: Block): Promise<BN> {
    const difficulty = new BN(block.header.difficulty);
    const blockNumber = bufferToInt(block.header.number);
    if (blockNumber === 0) {
      return difficulty;
    }

    const parentBlock =
      this._blocksByNumber.get(blockNumber - 1) ??
      (await this.getBlock(blockNumber - 1));
    const parentHash = bufferToHex(parentBlock.hash());
    const parentTD = this._totalDifficultyByBlockHash.get(parentHash);
    if (parentTD === undefined) {
      throw new Error("This should never happen");
    }
    return parentTD.add(difficulty);
  }

  private _delBlock(blockHash: Buffer): void {
    const block = this._blocksByHash.get(bufferToHex(blockHash));
    if (block === undefined) {
      throw new Error("Block not found");
    }
    if (new BN(block.header.number).lte(this._forkBlockNumber)) {
      throw new Error("Cannot delete remote block");
    }

    const blockNumber = bufferToInt(block.header.number);
    for (let i = blockNumber; this._latestBlockNumber.gten(i); i++) {
      const currentBlock = this._blocksByNumber.get(i);
      if (currentBlock === undefined) {
        throw new Error("this should never happen");
      }
      const currentBlockHash = bufferToHex(currentBlock.hash());
      this._blocksByHash.delete(currentBlockHash);
      this._blocksByNumber.delete(i);
      this._totalDifficultyByBlockHash.delete(currentBlockHash);

      for (const transaction of currentBlock.transactions) {
        const transactionHash = bufferToHex(transaction.hash());
        this._transactions.delete(transactionHash);
        this._transactionToBlock.delete(transactionHash);
      }
    }

    this._latestBlockNumber = new BN(blockNumber).subn(1);
  }
}
