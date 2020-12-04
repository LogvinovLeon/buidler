import { assert } from "chai";
import { BN, bufferToHex, toBuffer, zeroAddress } from "ethereumjs-util";
import fsExtra from "fs-extra";
import { Context } from "mocha";
import path from "path";

import { InvalidInputError } from "../../../../../src/internal/hardhat-network/provider/errors";
import { randomAddress } from "../../../../../src/internal/hardhat-network/provider/fork/random";
import { COINBASE_ADDRESS } from "../../../../../src/internal/hardhat-network/provider/node";
import { TransactionParams } from "../../../../../src/internal/hardhat-network/provider/node-types";
import {
  numberToRpcQuantity,
  RpcBlockOutput,
  RpcReceiptOutput,
  RpcTransactionOutput,
} from "../../../../../src/internal/hardhat-network/provider/output";
import { getCurrentTimestamp } from "../../../../../src/internal/hardhat-network/provider/utils/getCurrentTimestamp";
import {
  EthereumProvider,
  EthSubscription,
  ProviderMessage,
} from "../../../../../src/types";
import {
  assertInvalidInputError,
  assertNodeBalances,
  assertNotSupported,
  assertPendingNodeBalances,
  assertQuantity,
  assertReceiptMatchesGethOne,
  assertTransaction,
  assertTransactionFailure,
} from "../../helpers/assertions";
import { EMPTY_ACCOUNT_ADDRESS } from "../../helpers/constants";
import {
  EXAMPLE_BLOCKHASH_CONTRACT,
  EXAMPLE_CONTRACT,
  EXAMPLE_READ_CONTRACT,
} from "../../helpers/contracts";
import {
  dataToNumber,
  quantityToBN,
  quantityToNumber,
} from "../../helpers/conversions";
import { setCWD } from "../../helpers/cwd";
import {
  DEFAULT_ACCOUNTS_ADDRESSES,
  DEFAULT_ACCOUNTS_BALANCES,
  DEFAULT_BLOCK_GAS_LIMIT,
  PROVIDERS,
} from "../../helpers/providers";
import { retrieveForkBlockNumber } from "../../helpers/retrieveForkBlockNumber";
import {
  deployContract,
  getSignedTxHash,
  sendTransactionFromTxParams,
  sendTxToZeroAddress,
} from "../../helpers/transactions";

const PRECOMPILES_COUNT = 8;

describe("Eth module", function () {
  PROVIDERS.forEach(({ name, useProvider, isFork, chainId }) => {
    describe(`${name} provider`, function () {
      setCWD();
      useProvider();

      const getFirstBlock = async () =>
        isFork ? retrieveForkBlockNumber(this.ctx.hardhatNetworkProvider) : 0;

      describe("eth_accounts", async function () {
        it("should return the genesis accounts in lower case", async function () {
          const accounts = await this.provider.send("eth_accounts");

          assert.deepEqual(accounts, DEFAULT_ACCOUNTS_ADDRESSES);
        });
      });

      describe("eth_blockNumber", async function () {
        let firstBlock: number;

        beforeEach(async function () {
          firstBlock = await getFirstBlock();
        });

        it("should return the current block number as QUANTITY", async function () {
          let blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock);

          await sendTxToZeroAddress(this.provider);

          blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock + 1);

          await sendTxToZeroAddress(this.provider);

          blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock + 2);

          await sendTxToZeroAddress(this.provider);

          blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock + 3);
        });

        it("Should increase if a transaction gets to execute and fails", async function () {
          let blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock);

          try {
            await this.provider.send("eth_sendTransaction", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                to: "0x0000000000000000000000000000000000000001",
                gas: numberToRpcQuantity(21000), // Address 1 is a precompile, so this will OOG
                gasPrice: numberToRpcQuantity(1),
              },
            ]);

            assert.fail("Tx should have failed");
          } catch (e) {
            assert.notInclude(e.message, "Tx should have failed");
          }

          blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock + 1);
        });

        it("Shouldn't increase if a call is made", async function () {
          let blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock);

          await this.provider.send("eth_call", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: "0x0000000000000000000000000000000000000000",
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
            },
          ]);

          blockNumber = await this.provider.send("eth_blockNumber");
          assertQuantity(blockNumber, firstBlock);
        });
      });

      describe("eth_call", async function () {
        describe("when called without blockTag param", () => {
          it("Should return the value returned by the contract", async function () {
            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_CONTRACT.bytecode.object}`
            );

            const result = await this.provider.send("eth_call", [
              { to: contractAddress, data: EXAMPLE_CONTRACT.selectors.i },
            ]);

            assert.equal(
              result,
              "0x0000000000000000000000000000000000000000000000000000000000000000"
            );

            await this.provider.send("eth_sendTransaction", [
              {
                to: contractAddress,
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: `${EXAMPLE_CONTRACT.selectors.modifiesState}000000000000000000000000000000000000000000000000000000000000000a`,
              },
            ]);

            const result2 = await this.provider.send("eth_call", [
              { to: contractAddress, data: EXAMPLE_CONTRACT.selectors.i },
            ]);

            assert.equal(
              result2,
              "0x000000000000000000000000000000000000000000000000000000000000000a"
            );
          });

          it("Should return the value returned by the contract using an unknown account as from", async function () {
            const from = "0x1234567890123456789012345678901234567890";

            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_CONTRACT.bytecode.object}`
            );

            const result = await this.provider.send("eth_call", [
              { to: contractAddress, data: EXAMPLE_CONTRACT.selectors.i, from },
            ]);

            assert.equal(
              result,
              "0x0000000000000000000000000000000000000000000000000000000000000000"
            );

            await this.provider.send("eth_sendTransaction", [
              {
                to: contractAddress,
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: `${EXAMPLE_CONTRACT.selectors.modifiesState}000000000000000000000000000000000000000000000000000000000000000a`,
              },
            ]);

            const result2 = await this.provider.send("eth_call", [
              { to: contractAddress, data: EXAMPLE_CONTRACT.selectors.i, from },
            ]);

            assert.equal(
              result2,
              "0x000000000000000000000000000000000000000000000000000000000000000a"
            );
          });

          it("Should be run in the context of the last block", async function () {
            const firstBlock = await getFirstBlock();
            const timestamp = getCurrentTimestamp() + 60;
            await this.provider.send("evm_setNextBlockTimestamp", [timestamp]);

            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_READ_CONTRACT.bytecode.object}`
            );

            const blockResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockNumber,
              },
            ]);

            assert.equal(dataToNumber(blockResult), firstBlock + 1);

            const timestampResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockTimestamp,
              },
            ]);

            assert.equal(timestampResult, timestamp);
          });

          it("Should return an empty buffer when a non-contract account is called", async function () {
            const result = await this.provider.send("eth_call", [
              {
                to: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: EXAMPLE_CONTRACT.selectors.i,
              },
            ]);

            assert.equal(result, "0x");
          });

          it("Should throw invalid input error if called in the context of a nonexistent block", async function () {
            const firstBlock = await getFirstBlock();
            const futureBlock = firstBlock + 1;

            await assertInvalidInputError(
              this.provider,
              "eth_call",
              [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                  value: numberToRpcQuantity(123),
                },
                numberToRpcQuantity(futureBlock),
              ],
              `Received invalid block number ${futureBlock}. Latest block number is ${firstBlock}`
            );
          });

          it("Should work with blockhashes calls", async function () {
            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_BLOCKHASH_CONTRACT.bytecode.object}`
            );

            const resultBlock0 = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_BLOCKHASH_CONTRACT.selectors.test0,
              },
            ]);

            assert.lengthOf(resultBlock0, 66);

            const resultBlock1 = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_BLOCKHASH_CONTRACT.selectors.test1,
              },
            ]);

            assert.lengthOf(resultBlock1, 66);

            const resultBlock1m = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_BLOCKHASH_CONTRACT.selectors.test1m,
              },
            ]);

            assert.equal(
              resultBlock1m,
              "0x0000000000000000000000000000000000000000000000000000000000000000"
            );
          });
        });

        describe("when called with 'latest' blockTag param", () => {
          it("Should be run in the context of the last block", async function () {
            const firstBlock = await getFirstBlock();
            const timestamp = getCurrentTimestamp() + 60;
            await this.provider.send("evm_setNextBlockTimestamp", [timestamp]);

            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_READ_CONTRACT.bytecode.object}`
            );

            const blockResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockNumber,
              },
              "latest",
            ]);

            assert.equal(dataToNumber(blockResult), firstBlock + 1);

            const timestampResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockTimestamp,
              },
              "latest",
            ]);

            assert.equal(timestampResult, timestamp);
          });
        });

        describe("when called with 'pending' blockTag param", () => {
          it("Should be run in the context of a new block", async function () {
            const firstBlock = await getFirstBlock();
            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_READ_CONTRACT.bytecode.object}`
            );

            const timestamp = getCurrentTimestamp() + 60;
            await this.provider.send("evm_setNextBlockTimestamp", [timestamp]);

            const blockResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockNumber,
              },
              "pending",
            ]);

            assert.equal(dataToNumber(blockResult), firstBlock + 2);

            const timestampResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockTimestamp,
              },
              "pending",
            ]);

            assert.equal(timestampResult, timestamp);
          });

          it("Should be run in the context with pending transactions mined", async function () {
            const snapshotId = await this.provider.send("evm_snapshot");
            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_CONTRACT.bytecode.object}`
            );

            await this.provider.send("evm_revert", [snapshotId]);
            await this.provider.send("evm_setAutomineEnabled", [false]);
            await this.provider.send("eth_sendTransaction", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: `0x${EXAMPLE_CONTRACT.bytecode.object}`,
                gas: numberToRpcQuantity(DEFAULT_BLOCK_GAS_LIMIT),
              },
            ]);

            const result = await this.provider.send("eth_call", [
              { to: contractAddress, data: EXAMPLE_CONTRACT.selectors.i },
              "pending",
            ]);

            // result would equal "0x" if the contract wasn't deployed
            assert.equal(
              result,
              "0x0000000000000000000000000000000000000000000000000000000000000000"
            );

            await this.provider.send("evm_mine");

            await this.provider.send("eth_sendTransaction", [
              {
                to: contractAddress,
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: `${EXAMPLE_CONTRACT.selectors.modifiesState}000000000000000000000000000000000000000000000000000000000000000a`,
              },
            ]);

            const result2 = await this.provider.send("eth_call", [
              { to: contractAddress, data: EXAMPLE_CONTRACT.selectors.i },
              "pending",
            ]);

            assert.equal(
              result2,
              "0x000000000000000000000000000000000000000000000000000000000000000a"
            );
          });
        });

        describe("when called with a block number as blockTag param", () => {
          it("Should be run in the context of the block passed as a parameter", async function () {
            const firstBlock = await getFirstBlock();

            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_READ_CONTRACT.bytecode.object}`
            );

            await this.provider.send("evm_mine");
            await this.provider.send("evm_mine");
            await this.provider.send("evm_mine");

            const blockResult = await this.provider.send("eth_call", [
              {
                to: contractAddress,
                data: EXAMPLE_READ_CONTRACT.selectors.blockNumber,
              },
              numberToRpcQuantity(firstBlock + 1),
            ]);

            assert.equal(dataToNumber(blockResult), firstBlock + 1);
          });

          it("Should leverage block tag parameter", async function () {
            const firstBlock = await getFirstBlock();

            const contractAddress = await deployContract(
              this.provider,
              `0x${EXAMPLE_CONTRACT.bytecode.object}`
            );

            const newState =
              "000000000000000000000000000000000000000000000000000000000000000a";

            await this.provider.send("eth_sendTransaction", [
              {
                to: contractAddress,
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
              },
            ]);

            assert.equal(
              await this.provider.send("eth_call", [
                {
                  to: contractAddress,
                  data: EXAMPLE_CONTRACT.selectors.i,
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                },
                numberToRpcQuantity(firstBlock + 1),
              ]),
              "0x0000000000000000000000000000000000000000000000000000000000000000"
            );

            assert.equal(
              await this.provider.send("eth_call", [
                {
                  to: contractAddress,
                  data: EXAMPLE_CONTRACT.selectors.i,
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                },
                "latest",
              ]),
              `0x${newState}`
            );
          });
        });
      });

      describe("eth_chainId", async function () {
        it("should return the chain id as QUANTITY", async function () {
          assertQuantity(await this.provider.send("eth_chainId"), chainId);
        });
      });

      describe("eth_coinbase", async function () {
        it("should return the the hardcoded coinbase address", async function () {
          assert.equal(
            await this.provider.send("eth_coinbase"),
            bufferToHex(COINBASE_ADDRESS)
          );
        });
      });

      describe("eth_compileLLL", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_compileLLL");
        });
      });

      describe("eth_compileSerpent", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_compileSerpent");
        });
      });

      describe("eth_compileSolidity", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_compileSolidity");
        });
      });

      describe("eth_estimateGas", async function () {
        it("should estimate the gas for a transfer", async function () {
          const estimation = await this.provider.send("eth_estimateGas", [
            {
              from: zeroAddress(),
              to: zeroAddress(),
            },
          ]);

          assert.isTrue(new BN(toBuffer(estimation)).lten(23000));
        });

        it("should leverage block tag parameter", async function () {
          const firstBlock = await getFirstBlock();
          const contractAddress = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000000a";

          await this.provider.send("eth_sendTransaction", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          const result = await this.provider.send("eth_estimateGas", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
            numberToRpcQuantity(firstBlock + 1),
          ]);

          const result2 = await this.provider.send("eth_estimateGas", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.isTrue(new BN(toBuffer(result)).gt(new BN(toBuffer(result2))));
        });

        it("should estimate gas in the context of pending block when called with 'pending' blockTag param", async function () {
          const contractAddress = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000000a";

          await this.provider.send("evm_setAutomineEnabled", [false]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          const result = await this.provider.send("eth_estimateGas", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
            "latest",
          ]);

          const result2 = await this.provider.send("eth_estimateGas", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
            "pending",
          ]);

          assert.isTrue(new BN(toBuffer(result)).gt(new BN(toBuffer(result2))));
        });

        it("Should throw invalid input error if called in the context of a nonexistent block", async function () {
          const firstBlock = await getFirstBlock();
          const futureBlock = firstBlock + 1;

          await assertInvalidInputError(
            this.provider,
            "eth_estimateGas",
            [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                value: numberToRpcQuantity(123),
              },
              numberToRpcQuantity(futureBlock),
            ],
            `Received invalid block number ${futureBlock}. Latest block number is ${firstBlock}`
          );
        });
      });

      describe("eth_gasPrice", async function () {
        it("should return a fixed gas price", async function () {
          assertQuantity(await this.provider.send("eth_gasPrice"), 8e9);
        });
      });

      describe("eth_getBalance", async function () {
        it("Should return 0 for empty accounts", async function () {
          if (!isFork) {
            assertQuantity(
              await this.provider.send("eth_getBalance", [zeroAddress()]),
              0
            );

            assertQuantity(
              await this.provider.send("eth_getBalance", [
                "0x0000000000000000000000000000000000000001",
              ]),
              0
            );
          }

          assertQuantity(
            await this.provider.send("eth_getBalance", [
              bufferToHex(EMPTY_ACCOUNT_ADDRESS),
            ]),
            0
          );
        });

        it("Should return the initial balance for the genesis accounts", async function () {
          await assertNodeBalances(this.provider, DEFAULT_ACCOUNTS_BALANCES);
        });

        it("Should return the updated balance after a transaction is made", async function () {
          await assertNodeBalances(this.provider, DEFAULT_ACCOUNTS_BALANCES);

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
            },
          ]);

          await assertNodeBalances(this.provider, [
            DEFAULT_ACCOUNTS_BALANCES[0].subn(1 + 21000),
            DEFAULT_ACCOUNTS_BALANCES[1].addn(1),
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(2),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(2),
            },
          ]);

          await assertNodeBalances(this.provider, [
            DEFAULT_ACCOUNTS_BALANCES[0].subn(1 + 21000 + 2 + 21000 * 2),
            DEFAULT_ACCOUNTS_BALANCES[1].addn(1 + 2),
          ]);
        });

        it("Should return the pending balance", async function () {
          await this.provider.send("evm_setAutomineEnabled", [false]);

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
              nonce: numberToRpcQuantity(0),
            },
          ]);

          await assertPendingNodeBalances(this.provider, [
            DEFAULT_ACCOUNTS_BALANCES[0].subn(1 + 21000),
            DEFAULT_ACCOUNTS_BALANCES[1].addn(1),
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(2),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(2),
              nonce: numberToRpcQuantity(1),
            },
          ]);

          await assertPendingNodeBalances(this.provider, [
            DEFAULT_ACCOUNTS_BALANCES[0].subn(1 + 21000 + 2 + 21000 * 2),
            DEFAULT_ACCOUNTS_BALANCES[1].addn(1 + 2),
          ]);
        });

        it("Should return the original balance after a call is made", async function () {
          await assertNodeBalances(this.provider, DEFAULT_ACCOUNTS_BALANCES);

          await this.provider.send("eth_call", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
            },
          ]);

          await assertNodeBalances(this.provider, DEFAULT_ACCOUNTS_BALANCES);

          await this.provider.send("eth_call", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[1],
              to: DEFAULT_ACCOUNTS_ADDRESSES[0],
              value: numberToRpcQuantity(1),
            },
          ]);

          await assertNodeBalances(this.provider, DEFAULT_ACCOUNTS_BALANCES);
        });

        it("should assign the block reward to the coinbase address", async function () {
          const coinbase = await this.provider.send("eth_coinbase");

          assertQuantity(
            await this.provider.send("eth_getBalance", [coinbase]),
            0
          );

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[0],
            },
          ]);

          const balance = new BN(
            toBuffer(await this.provider.send("eth_getBalance", [coinbase]))
          );

          assert.isTrue(balance.gtn(0));

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[0],
            },
          ]);

          const balance2 = new BN(
            toBuffer(await this.provider.send("eth_getBalance", [coinbase]))
          );

          assert.isTrue(balance2.gt(balance));
        });

        it("should leverage block tag parameter", async function () {
          const firstBlock = await getFirstBlock();
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: bufferToHex(EMPTY_ACCOUNT_ADDRESS),
              value: numberToRpcQuantity(1),
            },
          ]);

          if (!isFork) {
            assert.strictEqual(
              await this.provider.send("eth_getBalance", [
                bufferToHex(EMPTY_ACCOUNT_ADDRESS),
                "earliest",
              ]),
              "0x0"
            );
          }

          assert.strictEqual(
            await this.provider.send("eth_getBalance", [
              bufferToHex(EMPTY_ACCOUNT_ADDRESS),
              numberToRpcQuantity(firstBlock),
            ]),
            "0x0"
          );

          assert.strictEqual(
            await this.provider.send("eth_getBalance", [
              bufferToHex(EMPTY_ACCOUNT_ADDRESS),
              numberToRpcQuantity(firstBlock + 1),
            ]),
            "0x1"
          );

          assert.strictEqual(
            await this.provider.send("eth_getBalance", [
              bufferToHex(EMPTY_ACCOUNT_ADDRESS),
            ]),
            "0x1"
          );
        });

        it("Should throw invalid input error if called in the context of a nonexistent block", async function () {
          const firstBlock = await getFirstBlock();
          const futureBlock = firstBlock + 1;

          await assertInvalidInputError(
            this.provider,
            "eth_getBalance",
            [DEFAULT_ACCOUNTS_ADDRESSES[0], numberToRpcQuantity(futureBlock)],
            `Received invalid block number ${futureBlock}. Latest block number is ${firstBlock}`
          );
        });
      });

      describe("eth_getBlockByHash", async function () {
        it("should return null for non-existing blocks", async function () {
          assert.isNull(
            await this.provider.send("eth_getBlockByHash", [
              "0x0000000000000000000000000000000000000000000000000000000000000001",
              false,
            ])
          );

          assert.isNull(
            await this.provider.send("eth_getBlockByHash", [
              "0x0000000000000000000000000000000000000000000000000000000000000123",
              true,
            ])
          );
        });

        it("Should return the block with transaction hashes if the second argument is false", async function () {
          const firstBlock = await getFirstBlock();
          const txHash = await sendTxToZeroAddress(this.provider);
          const txOutput: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByHash",
            [txHash]
          );

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByHash",
            [txOutput.blockHash, false]
          );

          assert.equal(block.hash, txOutput.blockHash);
          assertQuantity(block.number, firstBlock + 1);
          assert.equal(block.transactions.length, 1);
          assert.include(block.transactions as string[], txHash);
          assert.equal(block.miner, bufferToHex(COINBASE_ADDRESS));
          assert.isEmpty(block.uncles);
        });

        it("Should return the block with the complete transactions if the second argument is true", async function () {
          const firstBlock = await getFirstBlock();
          const txHash = await sendTxToZeroAddress(this.provider);
          const txOutput: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByHash",
            [txHash]
          );

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByHash",
            [txOutput.blockHash, true]
          );

          assert.equal(block.hash, txOutput.blockHash);
          assertQuantity(block.number, firstBlock + 1);
          assert.equal(block.transactions.length, 1);
          assert.equal(block.miner, bufferToHex(COINBASE_ADDRESS));
          assert.deepEqual(
            block.transactions[0] as RpcTransactionOutput,
            txOutput
          );
          assert.isEmpty(block.uncles);
        });
      });

      describe("eth_getBlockByNumber", async function () {
        it("Should return the genesis block for number 0", async function () {
          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(0),
            false,
          ]);

          assert.equal(
            block.parentHash,
            "0x0000000000000000000000000000000000000000000000000000000000000000"
          );

          assertQuantity(block.number, 0);
          assert.isEmpty(block.transactions);
        });

        it("Should return null for unknown blocks", async function () {
          const firstBlock = await getFirstBlock();
          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 2),
            false,
          ]);

          assert.isNull(block);

          const block2 = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 1),
            true,
          ]);

          assert.isNull(block2);
        });

        it("Should return the new blocks", async function () {
          const firstBlockNumber = await getFirstBlock();
          const firstBlock: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(firstBlockNumber), false]
          );

          const txHash = await sendTxToZeroAddress(this.provider);

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(firstBlockNumber + 1), false]
          );

          assertQuantity(block.number, firstBlockNumber + 1);
          assert.equal(block.transactions.length, 1);
          assert.equal(block.parentHash, firstBlock.hash);
          assert.include(block.transactions as string[], txHash);
          assert.equal(block.miner, bufferToHex(COINBASE_ADDRESS));
          assert.isEmpty(block.uncles);
        });

        it("Should return the new pending block", async function () {
          const firstBlockNumber = await getFirstBlock();
          const firstBlock: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(firstBlockNumber), false]
          );

          await this.provider.send("evm_setAutomineEnabled", [false]);
          const txHash = await sendTxToZeroAddress(this.provider);

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            ["pending", false]
          );

          assert.equal(block.transactions.length, 1);
          assert.equal(block.parentHash, firstBlock.hash);
          assert.include(block.transactions as string[], txHash);
          assert.equal(block.miner, bufferToHex(COINBASE_ADDRESS));
          assert.isEmpty(block.uncles);
        });

        it("should return the complete transactions if the second argument is true", async function () {
          const firstBlockNumber = await getFirstBlock();
          const firstBlock: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(firstBlockNumber), false]
          );

          const txHash = await sendTxToZeroAddress(this.provider);

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(firstBlockNumber + 1), true]
          );

          assertQuantity(block.number, firstBlockNumber + 1);
          assert.equal(block.transactions.length, 1);
          assert.equal(block.parentHash, firstBlock.hash);
          assert.equal(block.miner, bufferToHex(COINBASE_ADDRESS));
          assert.isEmpty(block.uncles);

          const txOutput = block.transactions[0] as RpcTransactionOutput;
          assert.equal(txOutput.hash, txHash);
          assert.equal(block.hash, txOutput.blockHash);
          assert.equal(block.number, txOutput.blockNumber);
          assert.equal(txOutput.transactionIndex, numberToRpcQuantity(0));

          assert.deepEqual(
            txOutput,
            await this.provider.send("eth_getTransactionByHash", [txHash])
          );
        });

        it(
          "should return the right block total difficulty",
          isFork ? testTotalDifficultyFork : testTotalDifficulty
        );

        async function testTotalDifficultyFork(this: Context) {
          const forkBlockNumber = await getFirstBlock();
          const forkBlock: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(forkBlockNumber), false]
          );

          await sendTxToZeroAddress(this.provider);

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(forkBlockNumber + 1), false]
          );

          assertQuantity(
            block.totalDifficulty,
            quantityToBN(forkBlock.totalDifficulty).add(
              quantityToBN(block.difficulty)
            )
          );
        }

        async function testTotalDifficulty(this: Context) {
          const genesisBlock: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(0), false]
          );

          assertQuantity(genesisBlock.totalDifficulty, 1);
          assertQuantity(genesisBlock.difficulty, 1);

          await sendTxToZeroAddress(this.provider);

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(1), false]
          );

          assertQuantity(
            block.totalDifficulty,
            quantityToNumber(block.difficulty) + 1
          );
        }
      });

      describe("eth_getBlockTransactionCountByHash", async function () {
        it("should return null for non-existing blocks", async function () {
          assert.isNull(
            await this.provider.send("eth_getBlockTransactionCountByHash", [
              "0x1111111111111111111111111111111111111111111111111111111111111111",
            ])
          );
        });

        it("Should return 0 for the genesis block", async function () {
          const genesisBlock: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(0), false]
          );

          assertQuantity(
            await this.provider.send("eth_getBlockTransactionCountByHash", [
              genesisBlock.hash,
            ]),
            0
          );
        });

        it("Should return 1 for others", async function () {
          const txhash = await sendTxToZeroAddress(this.provider);

          const txOutput: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByHash",
            [txhash]
          );

          assertQuantity(
            await this.provider.send("eth_getBlockTransactionCountByHash", [
              txOutput.blockHash,
            ]),
            1
          );
        });
      });

      describe("eth_getBlockTransactionCountByNumber", async function () {
        it("should return null for non-existing blocks", async function () {
          const firstBlock = await getFirstBlock();
          assert.isNull(
            await this.provider.send("eth_getBlockTransactionCountByNumber", [
              numberToRpcQuantity(firstBlock + 1),
            ])
          );
        });

        it("Should return 0 for the genesis block", async function () {
          assertQuantity(
            await this.provider.send("eth_getBlockTransactionCountByNumber", [
              numberToRpcQuantity(0),
            ]),
            0
          );
        });

        it("Should return the number of transactions in the block", async function () {
          const firstBlock = await getFirstBlock();
          await sendTxToZeroAddress(this.provider);

          assertQuantity(
            await this.provider.send("eth_getBlockTransactionCountByNumber", [
              numberToRpcQuantity(firstBlock + 1),
            ]),
            1
          );
        });

        it("Should return the number of transactions in the 'pending' block", async function () {
          await this.provider.send("evm_setAutomineEnabled", [false]);
          await sendTxToZeroAddress(this.provider);

          assertQuantity(
            await this.provider.send("eth_getBlockTransactionCountByNumber", [
              "pending",
            ]),
            1
          );
        });
      });

      describe("eth_getCode", async function () {
        it("Should return an empty buffer for non-contract accounts", async function () {
          assert.equal(
            await this.provider.send("eth_getCode", [zeroAddress()]),
            "0x"
          );
        });

        it("Should return an empty buffer for precompiles", async function () {
          for (let i = 1; i <= PRECOMPILES_COUNT; i++) {
            const precompileNumber = i.toString(16);
            const zero = zeroAddress();

            assert.equal(
              await this.provider.send("eth_getCode", [
                zero.substr(0, zero.length - precompileNumber.length) +
                  precompileNumber,
              ]),
              "0x"
            );
          }
        });

        it("Should return the deployed code", async function () {
          // This a deployment transaction that pushes 0x41 (i.e. ascii A) followed by 31 0s to
          // the stack, stores that in memory, and then returns the first byte from memory.
          // This deploys a contract which a single byte of code, 0x41.
          const contractAddress = await deployContract(
            this.provider,
            "0x7f410000000000000000000000000000000000000000000000000000000000000060005260016000f3"
          );

          assert.equal(
            await this.provider.send("eth_getCode", [contractAddress]),
            "0x41"
          );
        });

        it("Should leverage block tag parameter", async function () {
          const firstBlock = await getFirstBlock();
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          assert.strictEqual(
            await this.provider.send("eth_getCode", [
              exampleContract,
              numberToRpcQuantity(firstBlock),
            ]),
            "0x"
          );
        });

        it("Should return the deployed code in the context of a new block with 'pending' block tag param", async function () {
          const snapshotId = await this.provider.send("evm_snapshot");
          const contractAddress = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          assert.isNotNull(contractAddress);

          const contractCodeBefore = await this.provider.send("eth_getCode", [
            contractAddress,
            "latest",
          ]);

          await this.provider.send("evm_revert", [snapshotId]);
          await this.provider.send("evm_setAutomineEnabled", [false]);

          const txHash = await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: `0x${EXAMPLE_CONTRACT.bytecode.object}`,
              gas: numberToRpcQuantity(DEFAULT_BLOCK_GAS_LIMIT),
            },
          ]);
          const txReceipt = await this.provider.send(
            "eth_getTransactionReceipt",
            [txHash]
          );
          const contractCodeAfter = await this.provider.send("eth_getCode", [
            contractAddress,
            "pending",
          ]);

          assert.isNull(txReceipt);
          assert.strictEqual(contractCodeAfter, contractCodeBefore);
        });

        it("Should throw invalid input error if called in the context of a nonexistent block", async function () {
          const firstBlock = await getFirstBlock();
          const futureBlock = firstBlock + 1;

          await assertInvalidInputError(
            this.provider,
            "eth_getCode",
            [randomAddress(), numberToRpcQuantity(futureBlock)],
            `Received invalid block number ${futureBlock}. Latest block number is ${firstBlock}`
          );
        });
      });

      describe("eth_getCompilers", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_getCompilers");
        });
      });

      describe("block filters", function () {
        it("Supports block filters", async function () {
          assert.isString(await this.provider.send("eth_newBlockFilter"));
        });

        it("Supports uninstalling an existing filter", async function () {
          const filterId = await this.provider.send("eth_newBlockFilter", []);
          const uninstalled = await this.provider.send("eth_uninstallFilter", [
            filterId,
          ]);

          assert.isTrue(uninstalled);
        });

        it("Doesn't fail on uninstalling a non-existent filter", async function () {
          const uninstalled = await this.provider.send("eth_uninstallFilter", [
            "0x1",
          ]);

          assert.isFalse(uninstalled);
        });

        it("should start returning at least one block", async function () {
          const filterId = await this.provider.send("eth_newBlockFilter", []);
          const blockHashes = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.isNotEmpty(blockHashes);
        });

        it("should not return the same block twice", async function () {
          const filterId = await this.provider.send("eth_newBlockFilter", []);

          await this.provider.send("eth_getFilterChanges", [filterId]);

          const blockHashes = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.isEmpty(blockHashes);
        });

        it("should return new blocks", async function () {
          const filterId = await this.provider.send("eth_newBlockFilter", []);

          const initialHashes = await this.provider.send(
            "eth_getFilterChanges",
            [filterId]
          );

          assert.lengthOf(initialHashes, 1);

          const empty = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.isEmpty(empty);

          await this.provider.send("evm_mine", []);
          await this.provider.send("evm_mine", []);
          await this.provider.send("evm_mine", []);

          const blockHashes = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.lengthOf(blockHashes, 3);
        });

        it("should return reorganized block", async function () {
          const filterId = await this.provider.send("eth_newBlockFilter", []);

          assert.lengthOf(
            await this.provider.send("eth_getFilterChanges", [filterId]),
            1
          );

          const snapshotId: string = await this.provider.send(
            "evm_snapshot",
            []
          );

          await this.provider.send("evm_mine", []);
          const block1 = await this.provider.send("eth_getBlockByNumber", [
            await this.provider.send("eth_blockNumber"),
            false,
          ]);

          await this.provider.send("evm_revert", [snapshotId]);

          await this.provider.send("evm_mine", []);
          const block2 = await this.provider.send("eth_getBlockByNumber", [
            await this.provider.send("eth_blockNumber"),
            false,
          ]);

          const blockHashes = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.deepEqual(blockHashes, [block1.hash, block2.hash]);
        });
      });

      describe("eth_getFilterLogs", async function () {
        let firstBlock: number;

        beforeEach(async function () {
          firstBlock = await getFirstBlock();
        });

        it("Supports get filter logs", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          const filterId = await this.provider.send("eth_newFilter", [{}]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          const logs = await this.provider.send("eth_getFilterLogs", [
            filterId,
          ]);
          assert.lengthOf(logs, 1);

          const log = logs[0];
          assert.equal(log.removed, false);
          assert.equal(log.logIndex, "0x0");
          assert.equal(log.transactionIndex, "0x0");
          assert.equal(quantityToNumber(log.blockNumber), firstBlock + 2);
          assert.equal(log.address, exampleContract);
          assert.equal(log.data, `0x${newState}`);
        });

        it("Supports uninstalling an existing log filter", async function () {
          const filterId = await this.provider.send("eth_newFilter", [{}]);
          const uninstalled = await this.provider.send("eth_uninstallFilter", [
            filterId,
          ]);

          assert.isTrue(uninstalled);
        });

        it("Supports get filter logs with address", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          const filterId = await this.provider.send("eth_newFilter", [
            {
              address: exampleContract,
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getFilterLogs", [filterId]),
            1
          );
        });

        it("Supports get filter logs with topics", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          const filterId = await this.provider.send("eth_newFilter", [
            {
              topics: [
                "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                "0x0000000000000000000000000000000000000000000000000000000000000000",
              ],
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getFilterLogs", [filterId]),
            1
          );
        });

        it("Supports get filter logs with null topic", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          const filterId = await this.provider.send("eth_newFilter", [
            {
              topics: [
                "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                null,
              ],
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getFilterLogs", [filterId]),
            1
          );
        });

        it("Supports get filter logs with multiple topics", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          const filterId = await this.provider.send("eth_newFilter", [
            {
              topics: [
                [
                  "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                ],
                [
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                ],
              ],
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getFilterLogs", [filterId]),
            1
          );
        });

        it("Supports get filter logs with fromBlock", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          const filterId = await this.provider.send("eth_newFilter", [
            {
              fromBlock: numberToRpcQuantity(firstBlock),
              address: exampleContract,
              topics: [
                [
                  "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                ],
                [
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                  "0x000000000000000000000000000000000000000000000000000000000000003b",
                ],
              ],
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getFilterLogs", [filterId]),
            2
          );
        });

        it("Supports get filter logs with toBlock", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          const filterId = await this.provider.send("eth_newFilter", [
            {
              fromBlock: numberToRpcQuantity(firstBlock),
              toBlock: numberToRpcQuantity(firstBlock + 2),
              address: exampleContract,
              topics: [
                [
                  "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                ],
                [
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                  "0x000000000000000000000000000000000000000000000000000000000000003b",
                ],
              ],
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getFilterLogs", [filterId]),
            1
          );
        });
      });

      describe("eth_getLogs", async function () {
        let firstBlock: number;

        beforeEach(async function () {
          firstBlock = await getFirstBlock();
        });

        it("Supports get logs", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000007b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                address: "0x0000000000000000000000000000000000000000",
              },
            ]),
            0
          );

          const logs = await this.provider.send("eth_getLogs", [
            {
              address: exampleContract,
            },
          ]);
          assert.lengthOf(logs, 1);

          const log = logs[0];
          assert.equal(log.removed, false);
          assert.equal(log.logIndex, "0x0");
          assert.equal(log.transactionIndex, "0x0");
          assert.equal(quantityToNumber(log.blockNumber), firstBlock + 2);
          assert.equal(log.address, exampleContract);
          assert.equal(log.data, `0x${newState}`);
        });

        it("Supports get logs with address", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                address: exampleContract,
              },
            ]),
            1
          );

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                address: "0x0000000000000000000000000000000000000000",
              },
            ]),
            0
          );
        });

        it("Supports get logs with topics", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                topics: [
                  "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                ],
              },
            ]),
            1
          );

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                topics: [
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                ],
              },
            ]),
            0
          );
        });

        it("Supports get logs with null topic", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                topics: [
                  null,
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                ],
              },
            ]),
            1
          );
        });

        it("Supports get logs with multiple topic", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                fromBlock: numberToRpcQuantity(firstBlock + 2),
                topics: [
                  [
                    "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
                  ],
                  [
                    "0x0000000000000000000000000000000000000000000000000000000000000000",
                    "0x000000000000000000000000000000000000000000000000000000000000003b",
                  ],
                ],
              },
            ]),
            2
          );
        });

        it("Supports get logs with fromBlock", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                fromBlock: numberToRpcQuantity(firstBlock + 3),
              },
            ]),
            1
          );
        });

        it("Supports get logs with toBlock", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(
            await this.provider.send("eth_getLogs", [
              {
                fromBlock: numberToRpcQuantity(firstBlock + 1),
                toBlock: numberToRpcQuantity(firstBlock + 2),
              },
            ]),
            1
          );
        });

        it("should accept out of bound block numbers", async function () {
          const logs = await this.provider.send("eth_getLogs", [
            {
              address: "0x0000000000000000000000000000000000000000",
              fromBlock: numberToRpcQuantity(firstBlock + 10000000),
            },
          ]);
          assert.lengthOf(logs, 0);

          const logs2 = await this.provider.send("eth_getLogs", [
            {
              address: "0x0000000000000000000000000000000000000000",
              fromBlock: numberToRpcQuantity(firstBlock),
              toBlock: numberToRpcQuantity(firstBlock + 1000000),
            },
          ]);
          assert.lengthOf(logs2, 0);
        });

        it("should return a new array every time", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const newState =
            "000000000000000000000000000000000000000000000000000000000000003b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          const logs1 = await this.provider.send("eth_getLogs", [
            {
              address: exampleContract,
            },
          ]);

          logs1[0].address = "changed";

          const logs2 = await this.provider.send("eth_getLogs", [
            {
              address: exampleContract,
            },
          ]);

          assert.notEqual(logs1, logs2);
          assert.notEqual(logs1[0], logs2[0]);
          assert.notEqual(logs2[0].address, "changed");
        });
      });

      describe("eth_getProof", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_getProof");
        });
      });

      describe("eth_getStorageAt", async function () {
        describe("Imitating Ganache", function () {
          describe("When a slot has not been written into", function () {
            it("Should return `0x0000000000000000000000000000000000000000000000000000000000000000`", async function () {
              const exampleContract = await deployContract(
                this.provider,
                `0x${EXAMPLE_CONTRACT.bytecode.object}`
              );

              assert.strictEqual(
                await this.provider.send("eth_getStorageAt", [
                  exampleContract,
                  numberToRpcQuantity(3),
                ]),
                "0x0000000000000000000000000000000000000000000000000000000000000000"
              );

              assert.strictEqual(
                await this.provider.send("eth_getStorageAt", [
                  exampleContract,
                  numberToRpcQuantity(4),
                ]),
                "0x0000000000000000000000000000000000000000000000000000000000000000"
              );

              assert.strictEqual(
                await this.provider.send("eth_getStorageAt", [
                  DEFAULT_ACCOUNTS_ADDRESSES[0],
                  numberToRpcQuantity(0),
                ]),
                "0x0000000000000000000000000000000000000000000000000000000000000000"
              );
            });
          });

          describe("When a slot has been written into", function () {
            describe("When 32 bytes were written", function () {
              it("Should return a 32-byte DATA string", async function () {
                const firstBlock = await getFirstBlock();
                const exampleContract = await deployContract(
                  this.provider,
                  `0x${EXAMPLE_CONTRACT.bytecode.object}`
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(2),
                    numberToRpcQuantity(firstBlock),
                  ]),
                  "0x0000000000000000000000000000000000000000000000000000000000000000"
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(2),
                  ]),
                  "0x1234567890123456789012345678901234567890123456789012345678901234"
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(2),
                    "latest",
                  ]),
                  "0x1234567890123456789012345678901234567890123456789012345678901234"
                );
              });

              it("Should return a 32-byte DATA string in the context of a new block with 'pending' block tag param", async function () {
                const snapshotId = await this.provider.send("evm_snapshot");
                const contractAddress = await deployContract(
                  this.provider,
                  `0x${EXAMPLE_CONTRACT.bytecode.object}`
                );

                await this.provider.send("evm_revert", [snapshotId]);
                await this.provider.send("evm_setAutomineEnabled", [false]);

                const txHash = await this.provider.send("eth_sendTransaction", [
                  {
                    from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                    data: `0x${EXAMPLE_CONTRACT.bytecode.object}`,
                    gas: numberToRpcQuantity(DEFAULT_BLOCK_GAS_LIMIT),
                  },
                ]);
                const txReceipt = await this.provider.send(
                  "eth_getTransactionReceipt",
                  [txHash]
                );

                assert.isNotNull(contractAddress);
                assert.isNull(txReceipt);

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    contractAddress,
                    numberToRpcQuantity(2),
                  ]),
                  "0x0000000000000000000000000000000000000000000000000000000000000000"
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    contractAddress,
                    numberToRpcQuantity(2),
                    "pending",
                  ]),
                  "0x1234567890123456789012345678901234567890123456789012345678901234"
                );
              });

              it("Should return a zero-value 32-byte DATA string in the context of the first block with 'earliest' block tag param", async function () {
                const exampleContract = await deployContract(
                  this.provider,
                  `0x${EXAMPLE_CONTRACT.bytecode.object}`
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(2),
                    "latest",
                  ]),
                  "0x1234567890123456789012345678901234567890123456789012345678901234"
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(2),
                    "earliest",
                  ]),
                  "0x0000000000000000000000000000000000000000000000000000000000000000"
                );
              });
            });

            describe("When less than 32 bytes where written", function () {
              it("Should return a DATA string with the same amount bytes that have been written", async function () {
                const firstBlock = await getFirstBlock();
                const exampleContract = await deployContract(
                  this.provider,
                  `0x${EXAMPLE_CONTRACT.bytecode.object}`
                );

                // We return as the EthereumJS VM stores it. This has been checked
                // against remix

                let newState =
                  "000000000000000000000000000000000000000000000000000000000000007b";

                await this.provider.send("eth_sendTransaction", [
                  {
                    to: exampleContract,
                    from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                    data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
                  },
                ]);

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(0),
                    numberToRpcQuantity(firstBlock + 1),
                  ]),
                  "0x0000000000000000000000000000000000000000000000000000000000000000"
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(0),
                  ]),
                  "0x000000000000000000000000000000000000000000000000000000000000007b"
                );

                newState =
                  "000000000000000000000000000000000000000000000000000000000000007c";

                await this.provider.send("eth_sendTransaction", [
                  {
                    to: exampleContract,
                    from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                    data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
                  },
                ]);

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(0),
                    numberToRpcQuantity(firstBlock + 2),
                  ]),
                  "0x000000000000000000000000000000000000000000000000000000000000007b"
                );

                assert.strictEqual(
                  await this.provider.send("eth_getStorageAt", [
                    exampleContract,
                    numberToRpcQuantity(0),
                  ]),
                  "0x000000000000000000000000000000000000000000000000000000000000007c"
                );
              });
            });
          });
        });
      });

      describe("eth_getTransactionByBlockHashAndIndex", async function () {
        it("should return null for non-existing blocks", async function () {
          assert.isNull(
            await this.provider.send("eth_getTransactionByBlockHashAndIndex", [
              "0x1231231231231231231231231231231231231231231231231231231231231231",
              numberToRpcQuantity(0),
            ])
          );
        });

        it("should return null for existing blocks but non-existing indexes", async function () {
          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(0),
            false,
          ]);

          assert.isNull(
            await this.provider.send("eth_getTransactionByBlockHashAndIndex", [
              block.hash,
              numberToRpcQuantity(0),
            ])
          );

          assert.isNull(
            await this.provider.send("eth_getTransactionByBlockHashAndIndex", [
              block.hash,
              numberToRpcQuantity(0),
            ])
          );
        });

        it("should return the right info for the existing ones", async function () {
          const firstBlock = await getFirstBlock();
          const txParams1: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer("0xaa"),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(25000),
            gasPrice: new BN(23912),
          };

          const txHash = await sendTransactionFromTxParams(
            this.provider,
            txParams1
          );

          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 1),
            false,
          ]);

          const tx: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByBlockHashAndIndex",
            [block.hash, numberToRpcQuantity(0)]
          );

          assertTransaction(
            tx,
            txHash,
            txParams1,
            firstBlock + 1,
            block.hash,
            0
          );

          const txParams2: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer([]),
            nonce: new BN(1),
            value: new BN(123),
            gasLimit: new BN(80000),
            gasPrice: new BN(239),
          };

          const txHash2 = await sendTransactionFromTxParams(
            this.provider,
            txParams2
          );

          const block2 = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 2),
            false,
          ]);

          const tx2: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByBlockHashAndIndex",
            [block2.hash, numberToRpcQuantity(0)]
          );

          assertTransaction(
            tx2,
            txHash2,
            txParams2,
            firstBlock + 2,
            block2.hash,
            0
          );
        });
      });

      describe("eth_getTransactionByBlockNumberAndIndex", async function () {
        it("should return null for non-existing blocks", async function () {
          assert.isNull(
            await this.provider.send(
              "eth_getTransactionByBlockNumberAndIndex",
              [numberToRpcQuantity(1), numberToRpcQuantity(0)]
            )
          );
        });

        it("should return null for existing blocks but non-existing indexes", async function () {
          assert.isNull(
            await this.provider.send(
              "eth_getTransactionByBlockNumberAndIndex",
              [numberToRpcQuantity(0), numberToRpcQuantity(0)]
            )
          );

          assert.isNull(
            await this.provider.send(
              "eth_getTransactionByBlockNumberAndIndex",
              [numberToRpcQuantity(1), numberToRpcQuantity(0)]
            )
          );
        });

        it("should return the right info for the existing ones", async function () {
          const firstBlock = await getFirstBlock();
          const txParams1: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer("0xaa"),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(25000),
            gasPrice: new BN(23912),
          };

          const txHash = await sendTransactionFromTxParams(
            this.provider,
            txParams1
          );

          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 1),
            false,
          ]);

          const tx: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByBlockNumberAndIndex",
            [numberToRpcQuantity(firstBlock + 1), numberToRpcQuantity(0)]
          );

          assertTransaction(
            tx,
            txHash,
            txParams1,
            firstBlock + 1,
            block.hash,
            0
          );

          const txParams2: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer([]),
            nonce: new BN(1),
            value: new BN(123),
            gasLimit: new BN(80000),
            gasPrice: new BN(239),
          };

          const txHash2 = await sendTransactionFromTxParams(
            this.provider,
            txParams2
          );

          const block2 = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 2),
            false,
          ]);

          const tx2: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByBlockNumberAndIndex",
            [numberToRpcQuantity(firstBlock + 2), numberToRpcQuantity(0)]
          );

          assertTransaction(
            tx2,
            txHash2,
            txParams2,
            firstBlock + 2,
            block2.hash,
            0
          );
        });

        it("should return the right transaction info when called with 'pending' block tag param", async function () {
          await this.provider.send("evm_setAutomineEnabled", [false]);

          const txParams1: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer("0xaa"),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(25000),
            gasPrice: new BN(23912),
          };

          const txHash = await sendTransactionFromTxParams(
            this.provider,
            txParams1
          );

          const tx: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByBlockNumberAndIndex",
            ["pending", numberToRpcQuantity(0)]
          );

          await this.provider.send("evm_mine");

          await sendTxToZeroAddress(this.provider);

          const txParams2: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer([]),
            nonce: new BN(2),
            value: new BN(123),
            gasLimit: new BN(80000),
            gasPrice: new BN(239),
          };

          const txHash2 = await sendTransactionFromTxParams(
            this.provider,
            txParams2
          );

          const tx2: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByBlockNumberAndIndex",
            ["pending", numberToRpcQuantity(1)]
          );

          assertTransaction(tx, txHash, txParams1);
          assertTransaction(tx2, txHash2, txParams2);
        });
      });

      describe("eth_getTransactionByHash", async function () {
        it("should return null for unknown txs", async function () {
          assert.isNull(
            await this.provider.send("eth_getTransactionByHash", [
              "0x1234567890123456789012345678901234567890123456789012345678902134",
            ])
          );

          assert.isNull(
            await this.provider.send("eth_getTransactionByHash", [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ])
          );
        });

        it("should return the right info for the existing ones", async function () {
          const firstBlock = await getFirstBlock();
          const txParams1: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer("0xaa"),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(25000),
            gasPrice: new BN(23912),
          };

          const txHash = await sendTransactionFromTxParams(
            this.provider,
            txParams1
          );

          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 1),
            false,
          ]);

          const tx: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByHash",
            [txHash]
          );

          assertTransaction(
            tx,
            txHash,
            txParams1,
            firstBlock + 1,
            block.hash,
            0
          );

          const txParams2: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer([]),
            nonce: new BN(1),
            value: new BN(123),
            gasLimit: new BN(80000),
            gasPrice: new BN(239),
          };

          const txHash2 = await sendTransactionFromTxParams(
            this.provider,
            txParams2
          );

          const block2 = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 2),
            false,
          ]);

          const tx2: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByHash",
            [txHash2]
          );

          assertTransaction(
            tx2,
            txHash2,
            txParams2,
            firstBlock + 2,
            block2.hash,
            0
          );
        });

        it("should return the transaction if it gets to execute and failed", async function () {
          const firstBlock = await getFirstBlock();
          const txParams: TransactionParams = {
            to: toBuffer([]),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer("0x60006000fd"),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(250000),
            gasPrice: new BN(23912),
          };

          const txHash = await getSignedTxHash(
            this.hardhatNetworkProvider,
            txParams,
            0
          );

          // Revert. This is a deployment transaction that immediately reverts without a reason
          await assertTransactionFailure(
            this.provider,
            {
              from: bufferToHex(txParams.from),
              data: bufferToHex(txParams.data),
              nonce: numberToRpcQuantity(txParams.nonce),
              value: numberToRpcQuantity(txParams.value),
              gas: numberToRpcQuantity(txParams.gasLimit),
              gasPrice: numberToRpcQuantity(txParams.gasPrice),
            },
            "Transaction reverted without a reason"
          );

          const tx = await this.provider.send("eth_getTransactionByHash", [
            txHash,
          ]);
          const block = await this.provider.send("eth_getBlockByNumber", [
            numberToRpcQuantity(firstBlock + 1),
            false,
          ]);

          assertTransaction(
            tx,
            txHash,
            txParams,
            firstBlock + 1,
            block.hash,
            0
          );
        });

        it("should return the right info for the pending transaction", async function () {
          const txParams: TransactionParams = {
            to: toBuffer(zeroAddress()),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer([]),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(25000),
            gasPrice: new BN(23912),
          };

          await this.provider.send("evm_setAutomineEnabled", [false]);

          const txHash = await sendTransactionFromTxParams(
            this.provider,
            txParams
          );

          const tx: RpcTransactionOutput = await this.provider.send(
            "eth_getTransactionByHash",
            [txHash]
          );

          assertTransaction(tx, txHash, txParams);
        });
      });

      describe("eth_getTransactionCount", async function () {
        it("Should return 0 for random accounts", async function () {
          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              zeroAddress(),
            ]),
            0
          );

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              "0x0000000000000000000000000000000000000001",
            ]),
            0
          );

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              "0x0001231287316387168230000000000000000001",
            ]),
            0
          );
        });

        it("Should return the updated count after a transaction is made", async function () {
          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ]),
            0
          );

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
            },
          ]);

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ]),
            1
          );

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[1],
            ]),
            0
          );

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[1],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
            },
          ]);

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ]),
            1
          );

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[1],
            ]),
            1
          );
        });

        it("Should not be affected by calls", async function () {
          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ]),
            0
          );

          await this.provider.send("eth_call", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
            },
          ]);

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ]),
            0
          );
        });

        it("Should leverage block tag parameter", async function () {
          const firstBlock = await getFirstBlock();
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
            },
          ]);

          if (!isFork) {
            assertQuantity(
              await this.provider.send("eth_getTransactionCount", [
                DEFAULT_ACCOUNTS_ADDRESSES[0],
                "earliest",
              ]),
              0
            );
          }

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
              numberToRpcQuantity(firstBlock),
            ]),
            0
          );

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
              "latest",
            ]),
            1
          );
        });

        it("Should return transaction count in context of a new block with 'pending' block tag param", async function () {
          await this.provider.send("evm_setAutomineEnabled", [false]);
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
            },
          ]);

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
              "latest",
            ]),
            0
          );

          assertQuantity(
            await this.provider.send("eth_getTransactionCount", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
              "pending",
            ]),
            1
          );
        });

        it("Should throw invalid input error if called in the context of a nonexistent block", async function () {
          const firstBlock = await getFirstBlock();
          const futureBlock = firstBlock + 1;

          await assertInvalidInputError(
            this.provider,
            "eth_getTransactionCount",
            [randomAddress(), numberToRpcQuantity(futureBlock)],
            `Received invalid block number ${futureBlock}. Latest block number is ${firstBlock}`
          );
        });
      });

      describe("eth_getTransactionReceipt", async function () {
        it("should return null for unknown txs", async function () {
          const receipt = await this.provider.send(
            "eth_getTransactionReceipt",
            [
              "0x1234567876543234567876543456765434567aeaeaed67616732632762762373",
            ]
          );

          assert.isNull(receipt);
        });

        it("should return the right values for successful txs", async function () {
          const firstBlock = await getFirstBlock();
          const contractAddress = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const txHash = await this.provider.send("eth_sendTransaction", [
            {
              to: contractAddress,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: `${EXAMPLE_CONTRACT.selectors.modifiesState}000000000000000000000000000000000000000000000000000000000000000a`,
            },
          ]);

          const block: RpcBlockOutput = await this.provider.send(
            "eth_getBlockByNumber",
            [numberToRpcQuantity(firstBlock + 2), false]
          );

          const receipt: RpcReceiptOutput = await this.provider.send(
            "eth_getTransactionReceipt",
            [txHash]
          );

          assert.equal(receipt.blockHash, block.hash);
          assertQuantity(receipt.blockNumber, firstBlock + 2);
          assert.isNull(receipt.contractAddress);
          assert.equal(receipt.cumulativeGasUsed, receipt.gasUsed);
          assert.equal(receipt.from, DEFAULT_ACCOUNTS_ADDRESSES[0]);
          assertQuantity(receipt.status, 1);
          assert.equal(receipt.logs.length, 1);
          assert.equal(receipt.to, contractAddress);
          assert.equal(receipt.transactionHash, txHash);
          assertQuantity(receipt.transactionIndex, 0);

          const log = receipt.logs[0];

          assert.isFalse(log.removed);
          assertQuantity(log.logIndex, 0);
          assertQuantity(log.transactionIndex, 0);
          assert.equal(log.transactionHash, txHash);
          assert.equal(log.blockHash, block.hash);
          assertQuantity(log.blockNumber, firstBlock + 2);
          assert.equal(log.address, contractAddress);

          // The new value of i is not indexed
          assert.equal(
            log.data,
            "0x000000000000000000000000000000000000000000000000000000000000000a"
          );

          assert.deepEqual(log.topics, [
            EXAMPLE_CONTRACT.topics.StateModified[0],
            "0x0000000000000000000000000000000000000000000000000000000000000000",
          ]);
        });

        it("should return the receipt for txs that were executed and failed", async function () {
          const txParams: TransactionParams = {
            to: toBuffer([]),
            from: toBuffer(DEFAULT_ACCOUNTS_ADDRESSES[0]),
            data: toBuffer("0x60006000fd"),
            nonce: new BN(0),
            value: new BN(123),
            gasLimit: new BN(250000),
            gasPrice: new BN(23912),
          };

          const txHash = await getSignedTxHash(
            this.hardhatNetworkProvider,
            txParams,
            0
          );

          // Revert. This is a deployment transaction that immediately reverts without a reason
          await assertTransactionFailure(
            this.provider,
            {
              from: bufferToHex(txParams.from),
              data: bufferToHex(txParams.data),
              nonce: numberToRpcQuantity(txParams.nonce),
              value: numberToRpcQuantity(txParams.value),
              gas: numberToRpcQuantity(txParams.gasLimit),
              gasPrice: numberToRpcQuantity(txParams.gasPrice),
            },
            "Transaction reverted without a reason"
          );

          const receipt = await this.provider.send(
            "eth_getTransactionReceipt",
            [txHash]
          );

          assert.isNotNull(receipt);
        });

        it("should return a new object every time", async function () {
          const txHash = await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: numberToRpcQuantity(1),
              gas: numberToRpcQuantity(21000),
              gasPrice: numberToRpcQuantity(1),
            },
          ]);

          const receipt1: RpcReceiptOutput = await this.provider.send(
            "eth_getTransactionReceipt",
            [txHash]
          );

          receipt1.blockHash = "changed";

          const receipt2: RpcReceiptOutput = await this.provider.send(
            "eth_getTransactionReceipt",
            [txHash]
          );

          assert.notEqual(receipt1, receipt2);
          assert.notEqual(receipt2.blockHash, "changed");
        });
      });

      describe("eth_getUncleByBlockHashAndIndex", async function () {
        it("is not supported", async function () {
          await assertNotSupported(
            this.provider,
            "eth_getUncleByBlockHashAndIndex"
          );
        });
      });

      describe("eth_getUncleByBlockNumberAndIndex", async function () {
        it("is not supported", async function () {
          await assertNotSupported(
            this.provider,
            "eth_getUncleByBlockNumberAndIndex"
          );
        });
      });

      describe("eth_getUncleCountByBlockHash", async function () {
        it("is not supported", async function () {
          await assertNotSupported(
            this.provider,
            "eth_getUncleCountByBlockHash"
          );
        });
      });

      describe("eth_getUncleCountByBlockNumber", async function () {
        it("is not supported", async function () {
          await assertNotSupported(
            this.provider,
            "eth_getUncleCountByBlockNumber"
          );
        });
      });

      describe("eth_getWork", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_getWork");
        });
      });

      describe("eth_hashrate", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_hashrate");
        });
      });

      describe("eth_mining", async function () {
        it("should return false", async function () {
          assert.deepEqual(await this.provider.send("eth_mining"), false);
        });
      });

      describe("eth_newPendingTransactionFilter", async function () {
        it("Supports pending transaction filter", async function () {
          assert.isString(
            await this.provider.send("eth_newPendingTransactionFilter")
          );
        });

        it("Supports uninstalling an existing filter", async function () {
          const filterId = await this.provider.send(
            "eth_newPendingTransactionFilter",
            []
          );
          const uninstalled = await this.provider.send("eth_uninstallFilter", [
            filterId,
          ]);

          assert.isTrue(uninstalled);
        });

        it("Should return new pending transactions", async function () {
          const filterId = await this.provider.send(
            "eth_newPendingTransactionFilter",
            []
          );

          const accounts = await this.provider.send("eth_accounts");
          const burnTxParams = {
            from: accounts[0],
            to: zeroAddress(),
            gas: numberToRpcQuantity(21000),
          };

          await this.provider.send("eth_sendTransaction", [burnTxParams]);
          const txHashes = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.isNotEmpty(txHashes);
        });

        it("Should not return new pending transactions after uninstall", async function () {
          const filterId = await this.provider.send(
            "eth_newPendingTransactionFilter",
            []
          );

          const uninstalled = await this.provider.send("eth_uninstallFilter", [
            filterId,
          ]);

          assert.isTrue(uninstalled);

          const accounts = await this.provider.send("eth_accounts");
          const burnTxParams = {
            from: accounts[0],
            to: zeroAddress(),
            gas: numberToRpcQuantity(21000),
          };

          await this.provider.send("eth_sendTransaction", [burnTxParams]);
          const txHashes = await this.provider.send("eth_getFilterChanges", [
            filterId,
          ]);

          assert.isNull(txHashes);
        });
      });

      describe("eth_pendingTransactions", async function () {
        it("should return an empty array, as there is no pending transactions support", async function () {
          assert.deepEqual(
            await this.provider.send("eth_pendingTransactions"),
            []
          );
        });
      });

      describe("eth_protocolVersion", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_protocolVersion");
        });
      });

      describe("eth_sendRawTransaction", async function () {
        it("Should throw if the data isn't a proper transaction", async function () {
          await assertInvalidInputError(
            this.provider,
            "eth_sendRawTransaction",
            ["0x123456"],
            "Invalid transaction"
          );
        });

        it("Should throw if the signature is invalid", async function () {
          if (isFork) {
            this.skip();
            return;
          }
          await assertInvalidInputError(
            this.provider,
            "eth_sendRawTransaction",
            [
              // This transaction was obtained with eth_sendTransaction, and its r value was wiped
              "0xf3808501dcd6500083015f9080800082011a80a00dbd1a45b7823be518540ca77afb7178a470b8054281530a6cdfd0ad3328cf96",
            ],
            "Invalid Signature"
          );
        });

        it("Should throw if the signature is invalid but for another chain (EIP155)", async function () {
          if (isFork) {
            this.skip();
            return;
          }
          await assertInvalidInputError(
            this.provider,
            "eth_sendRawTransaction",
            [
              "0xf86e820a0f843b9aca0083030d40941aad5e821c667e909c16a49363ca48f672b46c5d88169866e539efe0008025a07bc6a357d809c9d27f8f5a826861e7f9b4b7c9cff4f91f894b88e98212069b3da05dbadbdfa67bab1d76d2d81e33d90162d508431362331f266dd6aa0cb4b525aa",
            ],
            "Incompatible EIP155-based"
          );
        });

        it("Should send the raw transaction", async function () {
          if (isFork) {
            this.skip();
            return;
          }
          // This test is a copy of: Should work with just from and data

          const hash = await this.provider.send("eth_sendRawTransaction", [
            "0xf853808501dcd6500083015f9080800082011aa09c8def73818f79b6493b7a3f7ce47b557694ca195d1b54bb74e3d98990041b44a00dbd1a45b7823be518540ca77afb7178a470b8054281530a6cdfd0ad3328cf96",
          ]);

          const receipt = await this.provider.send(
            "eth_getTransactionReceipt",
            [hash]
          );

          const receiptFromGeth = {
            blockHash:
              "0x01490da2af913e9a868430b7b4c5060fc29cbdb1692bb91d3c72c734acd73bc8",
            blockNumber: "0x6",
            contractAddress: "0x6ea84fcbef576d66896dc2c32e139b60e641170c",
            cumulativeGasUsed: "0xcf0c",
            from: "0xda4585f6e68ed1cdfdad44a08dbe3979ec74ad8f",
            gasUsed: "0xcf0c",
            logs: [],
            logsBloom:
              "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            status: "0x1",
            to: null,
            transactionHash:
              "0xbd24cbe9c1633b98e61d93619230341141d2cff49470ed6afa739cee057fd0aa",
            transactionIndex: "0x0",
          };

          assertReceiptMatchesGethOne(receipt, receiptFromGeth, 1);
        });
      });

      describe("eth_sendTransaction", async function () {
        // Because of the way we are testing this (i.e. integration testing) it's almost impossible to
        // fully test this method in a reasonable amount of time. This is because it executes the core
        // of Ethereum: its state transition function.
        //
        // We have mostly test about logic added on top of that, and will add new ones whenever
        // suitable. This is approximately the same as assuming that ethereumjs-vm is correct, which
        // seems reasonable, and if it weren't we should address the issues there.

        describe("Params validation", function () {
          it("Should fail for tx sent from account that is neither local nor marked as impersonated", async function () {
            await assertTransactionFailure(
              this.provider,
              {
                from: zeroAddress(),
                to: DEFAULT_ACCOUNTS_ADDRESSES[0],
                gas: numberToRpcQuantity(21000),
                gasPrice: numberToRpcQuantity(1),
              },
              "unknown account",
              InvalidInputError.CODE
            );
          });

          it("Should fail if sending to the null address without data", async function () {
            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              },
              "contract creation without any data provided",
              InvalidInputError.CODE
            );

            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                gas: numberToRpcQuantity(21000),
                gasPrice: numberToRpcQuantity(1),
              },
              "contract creation without any data provided",
              InvalidInputError.CODE
            );

            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: "0x",
                gas: numberToRpcQuantity(21000),
                gasPrice: numberToRpcQuantity(1),
              },
              "contract creation without any data provided",
              InvalidInputError.CODE
            );
          });
        });

        describe("when automine is enabled", () => {
          it("Should return a valid transaction hash", async function () {
            const hash = await this.provider.send("eth_sendTransaction", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                value: numberToRpcQuantity(1),
                gas: numberToRpcQuantity(21000),
                gasPrice: numberToRpcQuantity(1),
              },
            ]);

            assert.match(hash, /^0x[a-f\d]{64}$/);
          });

          it("Should work with just from and data", async function () {
            const firstBlock = await getFirstBlock();
            const hash = await this.provider.send("eth_sendTransaction", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: "0x00",
              },
            ]);

            const receipt = await this.provider.send(
              "eth_getTransactionReceipt",
              [hash]
            );

            const receiptFromGeth = {
              blockHash:
                "0x01490da2af913e9a868430b7b4c5060fc29cbdb1692bb91d3c72c734acd73bc8",
              blockNumber: "0x6",
              contractAddress: "0x6ea84fcbef576d66896dc2c32e139b60e641170c",
              cumulativeGasUsed: "0xcf0c",
              from: "0xda4585f6e68ed1cdfdad44a08dbe3979ec74ad8f",
              gasUsed: "0xcf0c",
              logs: [],
              logsBloom:
                "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
              status: "0x1",
              to: null,
              transactionHash:
                "0xbd24cbe9c1633b98e61d93619230341141d2cff49470ed6afa739cee057fd0aa",
              transactionIndex: "0x0",
            };

            assertReceiptMatchesGethOne(
              receipt,
              receiptFromGeth,
              firstBlock + 1
            );
          });

          it("Should throw if the tx nonce is higher than the account nonce", async function () {
            await assertInvalidInputError(
              this.provider,
              "eth_sendTransaction",
              [
                {
                  nonce: numberToRpcQuantity(1),
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                },
              ],
              "Nonce too high. Expected nonce to be 0 but got 1. Note that transactions can't be queued when automining."
            );
          });

          it("Should throw if the tx nonce is lower than the account nonce", async function () {
            await sendTxToZeroAddress(this.provider);
            await assertInvalidInputError(
              this.provider,
              "eth_sendTransaction",
              [
                {
                  nonce: numberToRpcQuantity(0),
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                },
              ],
              "Nonce too low. Expected nonce to be 1 but got 0."
            );
          });

          it("Should throw if the transaction fails", async function () {
            // Not enough gas
            await assertInvalidInputError(
              this.provider,
              "eth_sendTransaction",
              [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: zeroAddress(),
                  gas: numberToRpcQuantity(1),
                },
              ],
              "Transaction requires at least 21000 gas but got 1"
            );

            // Not enough balance
            await assertInvalidInputError(
              this.provider,
              "eth_sendTransaction",
              [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: zeroAddress(),
                  gas: numberToRpcQuantity(21000),
                  gasPrice: numberToRpcQuantity(DEFAULT_ACCOUNTS_BALANCES[0]),
                },
              ],
              "sender doesn't have enough funds to send tx"
            );

            // Gas is larger than block gas limit
            await assertInvalidInputError(
              this.provider,
              "eth_sendTransaction",
              [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: zeroAddress(),
                  gas: numberToRpcQuantity(DEFAULT_BLOCK_GAS_LIMIT + 1),
                },
              ],
              `Transaction gas limit is ${
                DEFAULT_BLOCK_GAS_LIMIT + 1
              } and exceeds block gas limit of ${DEFAULT_BLOCK_GAS_LIMIT}`
            );

            // Invalid opcode. We try to deploy a contract with an invalid opcode in the deployment code
            // The transaction gets executed anyway, so the account is updated
            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: "0xAA",
              },
              "Transaction reverted without a reason"
            );

            // Out of gas. This a deployment transaction that pushes 0x00 multiple times
            // The transaction gets executed anyway, so the account is updated.
            //
            // Note: this test is pretty fragile, as the tx needs to have enough gas
            // to pay for the calldata, but not enough to execute. This costs changed
            // with istanbul, and may change again in the future.
            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data:
                  "0x6000600060006000600060006000600060006000600060006000600060006000600060006000600060006000600060006000",
                gas: numberToRpcQuantity(53500),
              },
              "out of gas"
            );

            // Revert. This is a deployment transaction that immediately reverts without a reason
            // The transaction gets executed anyway, so the account is updated
            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: "0x60006000fd",
              },
              "Transaction reverted without a reason"
            );

            // This is a contract that reverts with A in its constructor
            await assertTransactionFailure(
              this.provider,
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data:
                  "0x6080604052348015600f57600080fd5b506040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260018152602001807f410000000000000000000000000000000000000000000000000000000000000081525060200191505060405180910390fdfe",
              },
              "revert A"
            );
          });

          describe("when there are pending transactions in the mempool", () => {
            describe("when the sent transaction fits in the first block", () => {
              it("Should throw if the sender doesn't have enough balance as a result of mining pending transactions first", async function () {
                const firstBlock = await getFirstBlock();
                const wholeAccountBalance = numberToRpcQuantity(
                  DEFAULT_ACCOUNTS_BALANCES[0].subn(21_000)
                );
                await this.provider.send("evm_setAutomineEnabled", [false]);
                await this.provider.send("eth_sendTransaction", [
                  {
                    from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                    to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                    nonce: numberToRpcQuantity(0),
                    gas: numberToRpcQuantity(21000),
                    gasPrice: numberToRpcQuantity(1),
                    value: wholeAccountBalance,
                  },
                ]);
                await this.provider.send("evm_setAutomineEnabled", [true]);

                await assertInvalidInputError(
                  this.provider,
                  "eth_sendTransaction",
                  [
                    {
                      from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                      to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                      gas: numberToRpcQuantity(21000),
                      gasPrice: numberToRpcQuantity(1),
                      value: wholeAccountBalance,
                    },
                  ],
                  "sender doesn't have enough funds to send tx"
                );
                assert.equal(
                  quantityToNumber(await this.provider.send("eth_blockNumber")),
                  firstBlock
                );
                assert.lengthOf(
                  await this.provider.send("eth_pendingTransactions"),
                  1
                );
              });
            });

            describe("when multiple blocks have to be mined before the sent transaction is included", () => {
              beforeEach(async function () {
                await this.provider.send("evm_setBlockGasLimit", [
                  numberToRpcQuantity(45000),
                ]);
              });

              it("Should eventually mine the sent transaction", async function () {
                const sendDummyTransaction = async (nonce: number) => {
                  return this.provider.send("eth_sendTransaction", [
                    {
                      from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                      to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                      nonce: numberToRpcQuantity(nonce),
                    },
                  ]);
                };

                await this.provider.send("evm_setAutomineEnabled", [false]);
                const blockNumberBefore = quantityToNumber(
                  await this.provider.send("eth_blockNumber")
                );

                await sendDummyTransaction(0);
                await sendDummyTransaction(1);
                await sendDummyTransaction(2);
                await sendDummyTransaction(3);
                await this.provider.send("evm_setAutomineEnabled", [true]);
                const txHash = await sendDummyTransaction(4);

                const blockAfter = await this.provider.send(
                  "eth_getBlockByNumber",
                  ["latest", false]
                );
                const blockNumberAfter = quantityToNumber(blockAfter.number);

                assert.equal(blockNumberAfter, blockNumberBefore + 3);
                assert.lengthOf(blockAfter.transactions, 1);
                assert.sameDeepMembers(blockAfter.transactions, [txHash]);
              });

              it("Should throw if the sender doesn't have enough balance as a result of mining pending transactions first", async function () {
                const sendTransaction = async (
                  nonce: number,
                  value: BN | number
                ) => {
                  return this.provider.send("eth_sendTransaction", [
                    {
                      from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                      to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                      nonce: numberToRpcQuantity(nonce),
                      gas: numberToRpcQuantity(21000),
                      gasPrice: numberToRpcQuantity(1),
                      value: numberToRpcQuantity(value),
                    },
                  ]);
                };
                const initialBalance = DEFAULT_ACCOUNTS_BALANCES[0];
                const firstBlock = await getFirstBlock();

                await this.provider.send("evm_setAutomineEnabled", [false]);
                await sendTransaction(0, 0);
                await sendTransaction(1, 0);
                await sendTransaction(2, initialBalance.subn(3 * 21_000));

                await this.provider.send("evm_setAutomineEnabled", [true]);

                await assertInvalidInputError(
                  this.provider,
                  "eth_sendTransaction",
                  [
                    {
                      from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                      to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                      gas: numberToRpcQuantity(21000),
                      gasPrice: numberToRpcQuantity(1),
                      value: numberToRpcQuantity(100),
                    },
                  ],
                  "sender doesn't have enough funds to send tx"
                );
                assert.equal(
                  quantityToNumber(await this.provider.send("eth_blockNumber")),
                  firstBlock
                );
                assert.lengthOf(
                  await this.provider.send("eth_pendingTransactions"),
                  3
                );
              });
            });
          });

          describe("test logging", () => {
            beforeEach(async function () {
              const buildInfo = path.join(
                __dirname,
                "build-info",
                "fb5caf8e-5153-45b3-a7b8-be3f25713f52.json"
              );
              const { solcVersion, input, output } = await fsExtra.readJSON(
                buildInfo,
                {
                  encoding: "utf8",
                }
              );
              await this.provider.send("hardhat_addCompilationResult", [
                solcVersion,
                input,
                output,
              ]);
            });

            /**
              contract Greeter {
                string greeting;
              
                constructor(string memory _greeting) {
                  console.log("Deploying a Greeter with greeting:", _greeting);
                  greeting = _greeting;
                }
              
                function greet() public view returns (string memory) {
                  return greeting;
                }
              
                function setGreeting(string memory _greeting, bool shouldThrow) public {
                  console.log("Changing greeting from '%s' to '%s'", greeting, _greeting);
                  require(!shouldThrow, "shouldThrow set to true");
                  greeting = _greeting;
                }
              }
             */

            it.only("prints console logs", async function () {
              await this.provider.send("hardhat_setLoggingEnabled", [true]);
              await this.provider.send("evm_setAutomineEnabled", [false]);
              
              // Deploys contract
              await this.provider.send("eth_sendTransaction", [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  data:
                    "0x608060405234801561001057600080fd5b5060405162000b7c38038062000b7c8339818101604052602081101561003557600080fd5b810190808051604051939291908464010000000082111561005557600080fd5b8382019150602082018581111561006b57600080fd5b825186600182028301116401000000008211171561008857600080fd5b8083526020830192505050908051906020019080838360005b838110156100bc5780820151818401526020810190506100a1565b50505050905090810190601f1680156100e95780820380516001836020036101000a031916815260200191505b5060405250505061011d60405180606001604052806022815260200162000b5a602291398261013a60201b6103731760201c565b80600090805190602001906101339291906102d5565b5050610372565b6102a88282604051602401808060200180602001838103835285818151815260200191508051906020019080838360005b8381101561018657808201518184015260208101905061016b565b50505050905090810190601f1680156101b35780820380516001836020036101000a031916815260200191505b50838103825284818151815260200191508051906020019080838360005b838110156101ec5780820151818401526020810190506101d1565b50505050905090810190601f1680156102195780820380516001836020036101000a031916815260200191505b509450505050506040516020818303038152906040527f4b5c4277000000000000000000000000000000000000000000000000000000007bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff83818316178352505050506102ac60201b60201c565b5050565b60008151905060006a636f6e736f6c652e6c6f679050602083016000808483855afa5050505050565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061031657805160ff1916838001178555610344565b82800160010185558215610344579182015b82811115610343578251825591602001919060010190610328565b5b5090506103519190610355565b5090565b5b8082111561036e576000816000905550600101610356565b5090565b6107d880620003826000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80634495ef8a1461003b578063cfae321714610102575b600080fd5b6101006004803603604081101561005157600080fd5b810190808035906020019064010000000081111561006e57600080fd5b82018360208201111561008057600080fd5b803590602001918460018302840111640100000000831117156100a257600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050509192919290803515159060200190929190505050610185565b005b61010a6102d1565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561014a57808201518184015260208101905061012f565b50505050905090810190601f1680156101775780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b6102426040518060600160405280602381526020016107806023913960008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156102375780601f1061020c57610100808354040283529160200191610237565b820191906000526020600020905b81548152906001019060200180831161021a57829003601f168201915b5050505050846104df565b80156102b6576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260178152602001807f73686f756c645468726f772073657420746f207472756500000000000000000081525060200191505060405180910390fd5b81600090805190602001906102cc9291906106e2565b505050565b606060008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156103695780601f1061033e57610100808354040283529160200191610369565b820191906000526020600020905b81548152906001019060200180831161034c57829003601f168201915b5050505050905090565b6104db8282604051602401808060200180602001838103835285818151815260200191508051906020019080838360005b838110156103bf5780820151818401526020810190506103a4565b50505050905090810190601f1680156103ec5780820380516001836020036101000a031916815260200191505b50838103825284818151815260200191508051906020019080838360005b8381101561042557808201518184015260208101905061040a565b50505050905090810190601f1680156104525780820380516001836020036101000a031916815260200191505b509450505050506040516020818303038152906040527f4b5c4277000000000000000000000000000000000000000000000000000000007bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff83818316178352505050506106b9565b5050565b6106b483838360405160240180806020018060200180602001848103845287818151815260200191508051906020019080838360005b83811015610530578082015181840152602081019050610515565b50505050905090810190601f16801561055d5780820380516001836020036101000a031916815260200191505b50848103835286818151815260200191508051906020019080838360005b8381101561059657808201518184015260208101905061057b565b50505050905090810190601f1680156105c35780820380516001836020036101000a031916815260200191505b50848103825285818151815260200191508051906020019080838360005b838110156105fc5780820151818401526020810190506105e1565b50505050905090810190601f1680156106295780820380516001836020036101000a031916815260200191505b5096505050505050506040516020818303038152906040527f2ced7cef000000000000000000000000000000000000000000000000000000007bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff83818316178352505050506106b9565b505050565b60008151905060006a636f6e736f6c652e6c6f679050602083016000808483855afa5050505050565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061072357805160ff1916838001178555610751565b82800160010185558215610751579182015b82811115610750578251825591602001919060010190610735565b5b50905061075e9190610762565b5090565b5b8082111561077b576000816000905550600101610763565b509056fe4368616e67696e67206772656574696e672066726f6d202725732720746f2027257327a264697066735822122091cbfdac8b83aaac9e2d8b70b36aae7ad9b4134c4a1a3c26b082f8dfe20a678f64736f6c634300070300334465706c6f79696e67206120477265657465722077697468206772656574696e673a0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d48656c6c6f2c20776f726c642100000000000000000000000000000000000000",
                },
              ]);
              
              // Calls setGreeting with shouldThrow = true
              const txHash = await this.provider.send("eth_sendTransaction", [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: "0x61de9dc6f6cff1df2809480882cfd3c2364b28f7",
                  data:
                    "0x4495ef8a00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000c486f6c612c206d756e646f210000000000000000000000000000000000000000",
                },
              ]);
              await this.provider.send("evm_setAutomineEnabled", [true]);
              
              // Failed deployment tx
              await this.provider.send("eth_sendTransaction", [
                {
                  from: DEFAULT_ACCOUNTS_ADDRESSES[1],
                  data: "0xAA",
                },
              ]);
            });
          });
        });

        describe("when automine is disabled", () => {
          beforeEach(async function () {
            await this.provider.send("evm_setAutomineEnabled", [false]);
          });

          it("Should not throw if the tx nonce is higher than the account nonce", async function () {
            await assert.isFulfilled(
              this.provider.send("eth_sendTransaction", [
                {
                  nonce: numberToRpcQuantity(1),
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                },
              ])
            );
          });

          it("Should throw if the tx nonce is lower than the account nonce", async function () {
            await sendTxToZeroAddress(this.provider);
            await assertInvalidInputError(
              this.provider,
              "eth_sendTransaction",
              [
                {
                  nonce: numberToRpcQuantity(0),
                  from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                  to: DEFAULT_ACCOUNTS_ADDRESSES[1],
                },
              ],
              "Nonce too low. Expected nonce to be at least 1 but got 0."
            );
          });

          it("Should throw an error if the same transaction is sent twice", async function () {
            const txParams = {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[0],
              nonce: numberToRpcQuantity(0),
            };

            const hash = await this.provider.send("eth_sendTransaction", [
              txParams,
            ]);

            await assertTransactionFailure(
              this.provider,
              txParams,
              `Known transaction: ${bufferToHex(hash)}`
            );
          });
        });
      });

      describe("eth_sign", async function () {
        // TODO: Test this. Note that it's implementation is tested in one of
        // our provider wrappers, but re-test it here anyway.
      });

      describe("eth_signTransaction", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_signTransaction");
        });
      });

      describe("eth_signTypedData", async function () {
        // TODO: Test this. Note that it just forwards to/from eth-sign-util
      });

      describe("eth_submitHashrate", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_submitHashrate");
        });
      });

      describe("eth_submitWork", async function () {
        it("is not supported", async function () {
          await assertNotSupported(this.provider, "eth_submitWork");
        });
      });

      describe("eth_subscribe", async function () {
        if (name === "JSON-RPC") {
          return;
        }

        function createFilterResultsGetter(
          ethereumProvider: EthereumProvider,
          filter: string
        ) {
          const notificationsResults: any[] = [];
          const notificationsListener = (payload: {
            subscription: string;
            result: any;
          }) => {
            if (filter === payload.subscription) {
              notificationsResults.push(payload.result);
            }
          };

          ethereumProvider.addListener("notifications", notificationsListener);

          const messageResults: any[] = [];
          const messageListener = (event: ProviderMessage) => {
            if (event.type === "eth_subscription") {
              const subscriptionMessage = event as EthSubscription;
              if (filter === subscriptionMessage.data.subscription) {
                messageResults.push(subscriptionMessage.data.result);
              }
            }
          };

          ethereumProvider.addListener("message", messageListener);

          let shouldUnsubscribe = true;

          return () => {
            if (shouldUnsubscribe) {
              ethereumProvider.removeListener(
                "notifications",
                notificationsListener
              );

              ethereumProvider.removeListener("message", messageListener);
              shouldUnsubscribe = false;
            }

            return {
              notificationsResults,
              messageResults,
            };
          };
        }

        it("Supports newHeads subscribe", async function () {
          const filterId = await this.provider.send("eth_subscribe", [
            "newHeads",
          ]);

          const getResults = createFilterResultsGetter(this.provider, filterId);

          await this.provider.send("evm_mine", []);
          await this.provider.send("evm_mine", []);
          await this.provider.send("evm_mine", []);

          assert.isTrue(
            await this.provider.send("eth_unsubscribe", [filterId])
          );

          assert.lengthOf(getResults().notificationsResults, 3);
          assert.lengthOf(getResults().messageResults, 3);
        });

        it("Supports newPendingTransactions subscribe", async function () {
          const filterId = await this.provider.send("eth_subscribe", [
            "newPendingTransactions",
          ]);

          const getResults = createFilterResultsGetter(this.provider, filterId);

          const accounts = await this.provider.send("eth_accounts");
          const burnTxParams = {
            from: accounts[0],
            to: zeroAddress(),
            gas: numberToRpcQuantity(21000),
          };

          await this.provider.send("eth_sendTransaction", [burnTxParams]);

          assert.isTrue(
            await this.provider.send("eth_unsubscribe", [filterId])
          );

          await this.provider.send("eth_sendTransaction", [burnTxParams]);

          assert.lengthOf(getResults().notificationsResults, 1);
          assert.lengthOf(getResults().messageResults, 1);
        });

        it("Supports logs subscribe", async function () {
          const exampleContract = await deployContract(
            this.provider,
            `0x${EXAMPLE_CONTRACT.bytecode.object}`
          );

          const filterId = await this.provider.send("eth_subscribe", [
            "logs",
            {
              address: exampleContract,
            },
          ]);

          const getResults = createFilterResultsGetter(this.provider, filterId);

          const newState =
            "000000000000000000000000000000000000000000000000000000000000007b";

          await this.provider.send("eth_sendTransaction", [
            {
              to: exampleContract,
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              data: EXAMPLE_CONTRACT.selectors.modifiesState + newState,
            },
          ]);

          assert.lengthOf(getResults().notificationsResults, 1);
          assert.lengthOf(getResults().messageResults, 1);
        });
      });

      describe("eth_syncing", async function () {
        it("Should return false", async function () {
          assert.deepEqual(await this.provider.send("eth_syncing"), false);
        });
      });

      describe("eth_unsubscribe", async function () {
        it("Supports unsubscribe", async function () {
          const filterId = await this.provider.send("eth_subscribe", [
            "newHeads",
          ]);

          assert.isTrue(
            await this.provider.send("eth_unsubscribe", [filterId])
          );
        });

        it("Doesn't fail when unsubscribe is called for a non-existent filter", async function () {
          assert.isFalse(await this.provider.send("eth_unsubscribe", ["0x1"]));
        });
      });
    });
  });
});
