import Common from "ethereumjs-common";
import { BN, bufferToInt } from "ethereumjs-util";
import { callbackify } from "util";

import { JsonRpcClient } from "../../jsonrpc/client";
import { RpcBlockWithTransactions } from "../../jsonrpc/types";
import { Block } from "../Block";
import { BlockchainInterface } from "../BlockchainInterface";

import { rpcToBlockData } from "./rpcToBlockData";

// TODO: figure out what errors we wanna throw
/* tslint:disable only-buidler-error */

export class ForkBlockchain {
  private _blocksByNumber: Map<number, Block> = new Map();
  private _blocksByHash: Map<string, Block> = new Map();
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
    if (!new BN(block.header.number).eq(this._latestBlockNumber.addn(1))) {
      throw new Error("Invalid block number");
    }
    this._latestBlockNumber = this._latestBlockNumber.addn(1);
    this._blocksByNumber.set(bufferToInt(block.header.number), block);
    this._blocksByHash.set(block.hash().toString("hex"), block);
    return block;
  }

  public async delBlock(blockHash: Buffer): Promise<void> {
    throw new Error("not implemented");
  }

  public async getDetails(_: string): Promise<void> {}

  public async iterator(name: string, onBlock: any): Promise<void> {
    throw new Error("not implemented");
  }

  public deleteAllFollowingBlocks(block: Block): void {
    throw new Error("not implemented");
  }

  public asBlockchain(): BlockchainInterface {
    return {
      getBlock: callbackify(this.getBlock.bind(this)),
      getLatestBlock: callbackify(this.getLatestBlock.bind(this)),
      putBlock: callbackify(this.putBlock.bind(this)),
      delBlock: callbackify(this.delBlock.bind(this)),
      getDetails: callbackify(this.getDetails.bind(this)),
      iterator: callbackify(this.iterator.bind(this)),
      deleteAllFollowingBlocks: this.deleteAllFollowingBlocks.bind(this),
    };
  }

  private async _getBlockByHash(blockHash: Buffer) {
    const block = this._blocksByHash.get(blockHash.toString("hex"));
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
    this._blocksByHash.set(rpcBlock.hash.toString("hex"), block);
    return block;
  }
}
