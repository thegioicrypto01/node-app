import { Asset } from '@ironfish/rust-nodejs'
import { DecryptedNoteValue } from '@ironfish/sdk/build/src/wallet/walletdb/decryptedNoteValue'
import {
  Account,
  IDatabaseTransaction,
  IronfishNode,
  RawTransaction,
  TransactionType,
} from '@ironfish/sdk'
import { TransactionValue } from '@ironfish/sdk/build/src/wallet/walletdb/transactionValue'
import { getAccountDecryptedNotes } from '@ironfish/sdk/build/src/rpc/routes/wallet/utils'
import { sizeVarBytes } from 'bufio'
import {
  IIronfishTransactionManager,
  TransactionFeeEstimate,
} from 'Types/IronfishManager/IIronfishTransactionManager'
import SortType from 'Types/SortType'
import Transaction, {
  Amount,
  Payment,
  TransactionStatus,
} from 'Types/Transaction'
import AbstractManager from './AbstractManager'
import AssetManager from './AssetManager'
import { abs } from 'Utils/number'

class TransactionManager
  extends AbstractManager
  implements IIronfishTransactionManager
{
  private assetManager: AssetManager

  constructor(node: IronfishNode, assetManager: AssetManager) {
    super(node)
    this.assetManager = assetManager
  }

  private async resolveTransactionFields(
    account: Account,
    headSequence: number,
    transaction: Readonly<TransactionValue>
  ): Promise<Transaction> {
    const status = await this.status(account, headSequence, transaction)
    const created = transaction?.blockHash
      ? await this.node.chain.getBlock(transaction.blockHash)
      : null
    const spends = []
    const creatorNotes: DecryptedNoteValue[] = []
    for await (const spend of transaction?.transaction?.spends) {
      const noteHash = await account.getNoteHash(spend.nullifier)

      if (noteHash) {
        const decryptedNote = await account.getDecryptedNote(noteHash)
        creatorNotes.push(decryptedNote)
      }

      spends.push(spend)
    }

    const notes = await getAccountDecryptedNotes(
      this.node,
      account,
      transaction
    )

    const serializedNotes = await Promise.all(
      notes.map(async note => {
        const asset = await this.assetManager.get(note.assetId)
        return {
          ...note,
          value: BigInt(note.value),
          asset,
        }
      })
    )

    const assetAmounts: Amount[] = []
    const feePaid = transaction.transaction.fee()
    const transactionType = await this.node.wallet.getTransactionType(
      account,
      transaction
    )

    for (const [assetId, delta] of transaction.assetBalanceDeltas.entries()) {
      let amount = delta
      if (assetId.equals(Asset.nativeId())) {
        if (transactionType === TransactionType.SEND) {
          amount += feePaid
          if (amount === BigInt(0)) {
            continue
          }
        }
      }
      assetAmounts.push({
        asset: await this.assetManager.get(assetId),
        value: abs(amount),
      })
    }

    return {
      accountId: account.id,
      hash: transaction.transaction.hash().toString('hex'),
      isMinersFee: transaction.transaction.isMinersFee(),
      fee: feePaid.toString(),
      notesCount: transaction.transaction.notes.length,
      spendsCount: transaction.transaction.spends.length,
      expiration: transaction.transaction.expiration(),
      status,
      inputs: await Promise.all(
        creatorNotes.map(async n => ({
          value: n.note.value(),
          memo: n.note.memo(),
          sender: n.note.sender(),
          asset: await this.assetManager.get(n.note.assetId()),
          owner: n.note.owner(),
        }))
      ),
      outputs: serializedNotes,
      spends: spends.map(spend => ({
        commitment: spend.commitment.toString('hex'),
        nullifier: spend.nullifier.toString('hex'),
        size: spend.size,
      })),
      creator: creatorNotes.length > 0,
      blockHash: transaction.blockHash?.toString('hex'),
      size: sizeVarBytes(transaction.transaction.serialize()),
      from:
        creatorNotes.length > 0
          ? account.publicAddress
          : serializedNotes.at(0)?.sender,
      to: serializedNotes.filter(n => !n.isOwner).map(n => n.owner),
      created: created?.header?.timestamp || transaction.timestamp,
      amount: assetAmounts.find(
        ({ asset }) => asset.id === Asset.nativeId().toString('hex')
      ),
      assetAmounts: assetAmounts,
    }
  }

  private async status(
    account: Account,
    headSequence: number,
    transaction: Readonly<TransactionValue>
  ) {
    let status
    try {
      status = await this.node.wallet.getTransactionStatus(
        account,
        transaction,
        { headSequence }
      )
    } catch (e) {
      status = TransactionStatus.UNKNOWN
    }

    return status
  }

  async estimateFeeWithPriority(
    accountId: string,
    receive: Payment
  ): Promise<TransactionFeeEstimate> {
    const estimatedFeeRates = this.node.memPool.feeEstimator.estimateFeeRates()
    const feeRates = [
      estimatedFeeRates.slow || BigInt(1),
      estimatedFeeRates.average || BigInt(1),
      estimatedFeeRates.fast || BigInt(1),
    ]

    const account = this.node.wallet.getAccount(accountId)

    const allPromises: Promise<RawTransaction>[] = []

    feeRates.forEach(feeRate => {
      allPromises.push(
        this.node.wallet.createTransaction({
          account,
          outputs: [
            {
              publicAddress: receive.publicAddress,
              amount: receive.amount,
              memo: receive.memo,
              assetId: Buffer.from(receive.assetId, 'hex'),
            },
          ],
          feeRate,
        })
      )
    })

    const [slow, average, fast]: Array<RawTransaction> = await Promise.all(
      allPromises
    )

    return {
      slow: slow.fee,
      average: average.fee,
      fast: fast.fee,
    }
  }

  async getPaginatedTransactionsByAccountId(
    accountId: string,
    count = 20,
    offset = 0
  ) {
    const account = this.node.wallet.getAccount(accountId)

    if (!account) {
      throw new Error(`Account with id=${accountId} was not found.`)
    }

    const head = await account.getHead()
    const transactions = []

    let i = 0
    let hasNext = false

    for await (const transaction of account.getTransactionsByTime()) {
      if (i < offset) {
        i++
        continue
      }

      if (transactions.length >= count) {
        hasNext = true
        break
      }

      transactions.push(
        await this.resolveTransactionFields(account, head.sequence, transaction)
      )
    }

    return {
      transactions,
      hasNext,
    }
  }

  async findByAccountId(
    accountId: string,
    searchTerm?: string,
    sort?: SortType
  ): Promise<Transaction[]> {
    const account = this.node.wallet.getAccount(accountId)

    if (!account) {
      throw new Error(`Account with id=${accountId} was not found.`)
    }

    const head = await account.getHead()
    const transactions = []
    for await (const transaction of account.getTransactions()) {
      transactions.push(
        await this.resolveTransactionFields(account, head.sequence, transaction)
      )
    }
    const search = searchTerm?.toLowerCase()

    return transactions
      .filter(
        transaction =>
          !search ||
          transaction.from.toLowerCase().includes(search) ||
          transaction.to.find(a => a.toLowerCase().includes(search)) ||
          transaction.outputs.find(note =>
            note.memo?.toLowerCase().includes(search)
          ) ||
          transaction.inputs.find(note =>
            note.memo?.toLowerCase().includes(search)
          ) ||
          transaction.amount?.value.toString().includes(search)
      )
      .sort((t1, t2) => {
        const date1: number = (t1.created || new Date()).getTime()
        const date2: number = (t2.created || new Date()).getTime()

        return sort === SortType.ASC ? date1 - date2 : date2 - date1
      })
  }

  async findByAddress(address: string, searchTerm?: string, sort?: SortType) {
    const transactions: Transaction[] = []
    let accounts: Account[] = this.node.wallet.listAccounts()
    const accountIndex = accounts.findIndex(
      account => account.publicAddress === address
    )
    //check transactions of account first is its exists in list
    if (accountIndex !== -1) {
      const existingAccount = accounts.splice(accountIndex, 1)
      accounts = [...existingAccount, ...accounts]
    }

    for (const account of accounts) {
      const head = await account.getHead()
      for await (const transaction of account.getTransactions()) {
        //in case account in accounts list is in contacts list and transaction sent from another account in list
        if (
          transactions.find(
            st => st.hash === transaction.transaction.hash().toString('hex')
          )
        ) {
          continue
        }
        const serializedTransaction = await this.resolveTransactionFields(
          account,
          head.sequence,
          transaction
        )

        if (
          serializedTransaction.from === address ||
          serializedTransaction.outputs.find(
            note => note.sender === address || note.owner === address
          )
        ) {
          transactions.push(serializedTransaction)
        }
      }
    }

    return transactions
      .filter(
        transaction =>
          !searchTerm ||
          transaction.from.toLowerCase().includes(searchTerm) ||
          transaction.to.find(a => a.toLowerCase().includes(searchTerm)) ||
          transaction.inputs.find(note =>
            note.memo?.toLowerCase().includes(searchTerm)
          ) ||
          transaction.outputs.find(note =>
            note.memo?.toLowerCase().includes(searchTerm)
          ) ||
          transaction.amount?.value.toString().includes(searchTerm)
      )
      .sort((t1, t2) => {
        const date1: number = (t1.created || new Date()).getTime()
        const date2: number = (t2.created || new Date()).getTime()

        return sort === SortType.ASC ? date1 - date2 : date2 - date1
      })
  }

  async get(hash: string, accountId: string): Promise<Transaction> {
    const account = this.node.wallet.getAccount(accountId)

    if (!account) {
      throw new Error(`Account with id=${accountId} was not found.`)
    }

    const head = await account.getHead()
    const transaction = await account.getTransaction(Buffer.from(hash, 'hex'))

    if (!transaction) {
      throw new Error(
        `Transaction with hash=${hash} was not found in account with id=${accountId}`
      )
    }

    return await this.resolveTransactionFields(
      account,
      head.sequence,
      transaction
    )
  }

  async send(
    accountId: string,
    payment: Payment,
    transactionFee?: bigint
  ): Promise<Transaction> {
    const account = this.node.wallet.getAccount(accountId)
    const head = await account.getHead()

    const transaction = await this.node.wallet.send(
      account,
      [{ ...payment, assetId: Buffer.from(payment.assetId, 'hex') }],
      transactionFee,
      this.node.config.get('transactionExpirationDelta')
    )

    const result = await this.resolveTransactionFields(
      account,
      head.sequence,
      await account.getTransaction(transaction.hash())
    )

    return result
  }
}

export default TransactionManager
