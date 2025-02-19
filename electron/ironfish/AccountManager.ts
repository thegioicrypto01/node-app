import {
  AccountValue,
  ACCOUNT_SCHEMA_VERSION,
  CurrencyUtils,
  IronfishNode,
  Bech32m,
  JSONUtils,
  isValidPublicAddress,
} from '@ironfish/sdk'
import { v4 as uuid } from 'uuid'
import {
  Asset as NativeAsset,
  LanguageCode,
  spendingKeyToWords,
  generateKey,
  wordsToSpendingKey,
  generateKeyFromPrivateKey,
} from '@ironfish/rust-nodejs'
import { AccountImport } from '@ironfish/sdk/build/src/wallet/walletdb/accountValue'
import log from 'electron-log'
import { IIronfishAccountManager } from 'Types/IronfishManager/IIronfishAccountManager'
import WalletAccount from 'Types/Account'
import SortType from 'Types/SortType'
import CutAccount from 'Types/CutAccount'
import AccountBalance from 'Types/AccountBalance'
import AbstractManager from './AbstractManager'
import AssetManager from './AssetManager'
import Asset from 'Types/Asset'
import AccountCreateParams from 'Types/AccountCreateParams'
import EventType from 'Types/EventType'
import sendMessageToRender from '../utils/sendMessageToRender'

class AccountManager
  extends AbstractManager
  implements IIronfishAccountManager
{
  private assetManager: AssetManager

  constructor(node: IronfishNode, assetManager: AssetManager) {
    super(node)
    this.assetManager = assetManager
  }

  initEventListeners(): void {
    this.node.wallet.onAccountImported.on(this.onAccountCountChange.bind(this))
    this.node.wallet.onAccountRemoved.on(this.onAccountCountChange.bind(this))
  }

  private onAccountCountChange() {
    sendMessageToRender(
      EventType.ACCOUNTS_CHANGE,
      this.node.wallet.listAccounts().length
    )
  }

  async balance(
    id: string,
    assetId: string = NativeAsset.nativeId().toString('hex')
  ): Promise<AccountBalance> {
    const account = this.node.wallet.getAccount(id)
    if (!account) {
      throw new Error(`Account with id=${id} was not found.`)
    }

    const balance = await this.node.wallet.getBalance(
      account,
      Buffer.from(assetId, 'hex')
    )
    const asset = await this.assetManager.get(assetId)
    return {
      ...balance,
      asset: asset,
    }
  }

  async balances(id: string): Promise<{
    default: AccountBalance
    assets: AccountBalance[]
  }> {
    const account = this.node.wallet.getAccount(id)

    if (!account) {
      throw new Error(`Account with id=${id} was not found.`)
    }

    const assetBalances: AccountBalance[] = []
    let defaultBalance: AccountBalance = {
      unconfirmed: BigInt(0),
      confirmed: BigInt(0),
      available: BigInt(0),
      pending: BigInt(0),
      unconfirmedCount: 0,
      asset: await this.assetManager.get(NativeAsset.nativeId()),
    }

    const head = await account.getHead()
    if (head) {
      //This try/catch block is needed for catching errors on getting balances witn swithed off node.syncer.peerNetwork
      try {
        for await (const balance of this.node.wallet.getBalances(account)) {
          const asset: Asset = await this.assetManager.get(balance.assetId)
          const accountBalance: AccountBalance = {
            ...balance,
            asset: asset,
          }

          if (balance.assetId.equals(NativeAsset.nativeId())) {
            defaultBalance = accountBalance
          } else {
            assetBalances.push(accountBalance)
          }
        }
      } catch (e) {
        log.error(e)
      }
    }

    return {
      default: defaultBalance,
      assets: assetBalances,
    }
  }

  async create(name: string): Promise<WalletAccount> {
    return this.node.wallet.createAccount(name).then(account => {
      this.onAccountCountChange()
      return account.serialize()
    })
  }

  async delete(name: string): Promise<void> {
    await this.node.wallet.removeAccountByName(name)
  }

  async export(
    id: string,
    encoded?: boolean,
    viewOnly?: boolean
  ): Promise<string> {
    const account = this.node.wallet.getAccount(id)?.serialize()
    if (!account) {
      return null
    }
    delete account.createdAt
    const { id: _, ...accountInfo } = account
    if (viewOnly) {
      accountInfo.spendingKey = null
    }
    if (encoded) {
      return Bech32m.encode(JSON.stringify(accountInfo), 'ironfishaccount00000')
    }
    return JSON.stringify(account)
  }

  async get(id: string): Promise<WalletAccount | null> {
    const accounts = this.node.wallet.listAccounts()
    const accountIndex = accounts.findIndex(a => a.id === id)
    if (accountIndex === -1) {
      return null
    }
    const account: WalletAccount = accounts[accountIndex].serialize()
    account.balances = await this.balances(account.id)
    account.order = accountIndex
    account.mnemonicPhrase = account.spendingKey
      ? spendingKeyToWords(account.spendingKey, LanguageCode.English).split(' ')
      : null
    account.viewOnly = !account.spendingKey
    return account
  }

  async getMnemonicPhrase(id: string): Promise<string[] | null> {
    const account = this.node.wallet.getAccount(id)
    return account.spendingKey
      ? spendingKeyToWords(account.spendingKey, LanguageCode.English).split(' ')
      : null
  }

  async import(account: Omit<AccountValue, 'rescan'>): Promise<AccountValue> {
    return this.node.wallet.importAccount(account).then(data => {
      this.node.wallet.scanTransactions()
      return data.serialize()
    })
  }

  async importByEncodedKey(data: string): Promise<AccountValue> {
    const [decoded, error] = Bech32m.decode(data)
    if (error) {
      throw error
    }

    if (decoded) {
      const decodedData = JSONUtils.parse<AccountImport>(decoded)
      const accountData: Omit<AccountValue, 'rescan'> = {
        id: uuid(),
        ...decodedData,
        createdAt: decodedData.createdAt
          ? {
              hash: Buffer.from(decodedData.createdAt.hash, 'utf-8'),
              sequence: decodedData.createdAt.sequence,
            }
          : null,
      }

      return this.import(accountData)
    }
  }

  async importByMnemonic(
    name: string,
    mnemonic: string
  ): Promise<AccountValue> {
    let spendingKey: string | null = null
    if (mnemonic.trim().split(/\s+/).length !== 24) {
      return null
    }
    spendingKey = wordsToSpendingKey(mnemonic.trim(), LanguageCode.English)

    const key = generateKeyFromPrivateKey(spendingKey)
    const accountData: Omit<AccountValue, 'rescan'> = {
      id: uuid(),
      name,
      version: ACCOUNT_SCHEMA_VERSION,
      createdAt: null,
      ...key,
    }

    return this.import(accountData)
  }

  async isValidPublicAddress(address: string): Promise<boolean> {
    return isValidPublicAddress(address)
  }

  async list(searchTerm?: string, sort?: SortType): Promise<CutAccount[]> {
    const search = searchTerm?.toLowerCase()
    const accounts = this.node.wallet.listAccounts()

    const result: CutAccount[] = await Promise.all(
      accounts.map(async (account, index) => ({
        id: account.id,
        name: account.name,
        publicAddress: account.publicAddress,
        balances: await this.balances(account.id),
        viewOnly: account.spendingKey === null,
        order: index,
      }))
    )

    if (sort) {
      result.sort(
        (a, b) =>
          (SortType.ASC === sort ? 1 : -1) *
          (Number(a.balances.default.confirmed) -
            Number(b.balances.default.confirmed))
      )
    }

    return result.filter(
      account =>
        !search ||
        account.name.toLowerCase().includes(search) ||
        account.publicAddress.toLowerCase().includes(search) ||
        CurrencyUtils.renderIron(account.balances.default.confirmed).includes(
          search
        )
    )
  }

  async prepareAccount(): Promise<AccountCreateParams> {
    const key = generateKey()
    const createdAt =
      this.node.chain.head.sequence > 1
        ? {
            sequence: this.node.chain.head.sequence,
            hash: this.node.chain.head.hash,
          }
        : null
    return {
      version: ACCOUNT_SCHEMA_VERSION,
      id: uuid(),
      name: uuid(),
      incomingViewKey: key.incomingViewKey,
      outgoingViewKey: key.outgoingViewKey,
      publicAddress: key.publicAddress,
      spendingKey: key.spendingKey,
      viewKey: key.viewKey,
      createdAt,
      mnemonicPhrase: spendingKeyToWords(
        key.spendingKey,
        LanguageCode.English
      ).split(' '),
    }
  }

  async submitAccount(createParams: AccountValue): Promise<WalletAccount> {
    const create = createParams.createdAt
      ? {
          ...createParams,
          createdAt: {
            sequence: createParams.createdAt.sequence,
            hash: Buffer.from(createParams.createdAt.hash),
          },
        }
      : createParams
    const newAccount = await this.node.wallet.importAccount(create)
    this.node.wallet.scanTransactions()

    return newAccount.serialize()
  }
}

export default AccountManager
