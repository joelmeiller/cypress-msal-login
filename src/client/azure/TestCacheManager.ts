/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { InteractionType, MemoryStorage } from '@azure/msal-browser'
import {
  Constants,
  PersistentCacheKeys,
  StringUtils,
  CommonAuthorizationCodeRequest,
  ICrypto,
  AccountEntity,
  IdTokenEntity,
  AccessTokenEntity,
  RefreshTokenEntity,
  AppMetadataEntity,
  CacheManager,
  ServerTelemetryEntity,
  ThrottlingEntity,
  ProtocolUtils,
  Logger,
  AuthorityMetadataEntity,
  DEFAULT_CRYPTO_IMPLEMENTATION,
  AccountInfo,
  ActiveAccountFilters,
  CcsCredential,
  CcsCredentialType,
  AuthToken,
  ValidCredentialType,
  ClientAuthError,
  TokenKeys,
  CredentialType,
  CacheRecord,
  CacheOptions,
  AuthenticationScheme,
} from '@azure/msal-common'

const testStorage = () => {
  const storage: Record<string, any> = {}

  return {
    setItem: (key: string, value: any) => {
      storage[key] = value
    },
    getItem: (key: string) => storage[key],
    removeItem: (key: string) => (storage[key] = undefined),
    containsKey: (key: string) => !!storage[key],
    getKeys: () => Object.keys(storage),
  }
}

export const StaticCacheKeys = {
  ACCOUNT_KEYS: 'msal.account.keys',
  TOKEN_KEYS: 'msal.token.keys',
} as const

export const InMemoryCacheKeys = {
  WRAPPER_SKU: 'wrapper.sku',
  WRAPPER_VER: 'wrapper.version',
} as const

const TemporaryCacheKeys = {
  AUTHORITY: 'authority',
  ACQUIRE_TOKEN_ACCOUNT: 'acquireToken.account',
  SESSION_STATE: 'session.state',
  REQUEST_STATE: 'request.state',
  NONCE_IDTOKEN: 'nonce.id_token',
  ORIGIN_URI: 'request.origin',
  RENEW_STATUS: 'token.renew.status',
  URL_HASH: 'urlHash',
  REQUEST_PARAMS: 'request.params',
  SCOPES: 'scopes',
  INTERACTION_STATUS_KEY: 'interaction.status',
  CCS_CREDENTIAL: 'ccs.credential',
  CORRELATION_ID: 'request.correlationId',
  NATIVE_REQUEST: 'request.native',
  REDIRECT_CONTEXT: 'request.redirect.context',
} as const

/**
 * This class implements the cache storage interface for MSAL through browser local or session storage.
 * Cookies are only used if storeAuthStateInCookie is true, and are only used for
 * parameters such as state and nonce, generally.
 */
export class TestCacheManager extends CacheManager {
  // Cache configuration, either set by user or default values.
  protected cacheConfig: Required<CacheOptions>
  // Internal in-memory storage object used for data used by msal that does not need to persist across page loads
  protected internalStorage: MemoryStorage<string>
  // Temporary cache
  // protected temporaryCacheStorage: IWindowStorage<string>
  // Logger instance
  protected logger: Logger

  protected testStorage: ReturnType<typeof testStorage>

  // Cookie life calculation (hours * minutes * seconds * ms)
  protected readonly COOKIE_LIFE_MULTIPLIER = 24 * 60 * 60 * 1000

  constructor(
    clientId: string,
    cacheConfig: Required<CacheOptions>,
    cryptoImpl: ICrypto,
    logger: Logger,
  ) {
    super(clientId, cryptoImpl, logger)
    this.cacheConfig = cacheConfig
    this.logger = logger
    this.internalStorage = new MemoryStorage()
    this.testStorage = testStorage()
  }

  /**
   * Parses passed value as JSON object, JSON.parse() will throw an error.
   * @param input
   */
  protected validateAndParseJson(jsonValue: string): object | null {
    try {
      const parsedJson = JSON.parse(jsonValue)
      /**
       * There are edge cases in which JSON.parse will successfully parse a non-valid JSON object
       * (e.g. JSON.parse will parse an escaped string into an unescaped string), so adding a type check
       * of the parsed value is necessary in order to be certain that the string represents a valid JSON object.
       *
       */
      return parsedJson && typeof parsedJson === 'object' ? parsedJson : null
    } catch (error) {
      return null
    }
  }

  /**
   * fetches the entry from the browser storage based off the key
   * @param key
   */
  getItem(key: string): string | null {
    return this.testStorage.getItem(key)
  }

  /**
   * sets the entry in the browser storage
   * @param key
   * @param value
   */
  setItem(key: string, value: string): void {
    this.testStorage.setItem(key, value)
  }

  /**
   * fetch the account entity from the platform cache
   * @param accountKey
   */
  getAccount(accountKey: string): AccountEntity | null {
    this.logger.trace('BrowserCacheManager.getAccount called')
    const account = this.getItem(accountKey)
    if (!account) {
      this.removeAccountKeyFromMap(accountKey)
      return null
    }

    const parsedAccount = this.validateAndParseJson(account)
    if (!parsedAccount || !AccountEntity.isAccountEntity(parsedAccount)) {
      this.removeAccountKeyFromMap(accountKey)
      return null
    }

    return CacheManager.toObject<AccountEntity>(new AccountEntity(), parsedAccount)
  }

  /**
   * set account entity in the platform cache
   * @param account
   */
  setAccount(account: AccountEntity): void {
    this.logger.trace('BrowserCacheManager.setAccount called')
    const key = account.generateAccountKey()
    this.setItem(key, JSON.stringify(account))
    this.addAccountKeyToMap(key)
  }

  /**
   * Returns the array of account keys currently cached
   * @returns
   */
  getAccountKeys(): Array<string> {
    this.logger.trace('BrowserCacheManager.getAccountKeys called')
    const accountKeys = this.getItem(StaticCacheKeys.ACCOUNT_KEYS)
    if (accountKeys) {
      return JSON.parse(accountKeys)
    }

    this.logger.verbose('BrowserCacheManager.getAccountKeys - No account keys found')
    return []
  }

  /**
   * Add a new account to the key map
   * @param key
   */
  addAccountKeyToMap(key: string): void {
    this.logger.trace('BrowserCacheManager.addAccountKeyToMap called')
    this.logger.tracePii(`BrowserCacheManager.addAccountKeyToMap called with key: ${key}`)
    const accountKeys = this.getAccountKeys()
    if (accountKeys.indexOf(key) === -1) {
      // Only add key if it does not already exist in the map
      accountKeys.push(key)
      this.setItem(StaticCacheKeys.ACCOUNT_KEYS, JSON.stringify(accountKeys))
      this.logger.verbose('BrowserCacheManager.addAccountKeyToMap account key added')
    } else {
      this.logger.verbose('BrowserCacheManager.addAccountKeyToMap account key already exists in map')
    }
  }

  /**
   * Remove an account from the key map
   * @param key
   */
  removeAccountKeyFromMap(key: string): void {
    this.logger.trace('BrowserCacheManager.removeAccountKeyFromMap called')
    this.logger.tracePii(`BrowserCacheManager.removeAccountKeyFromMap called with key: ${key}`)
    const accountKeys = this.getAccountKeys()
    const removalIndex = accountKeys.indexOf(key)
    if (removalIndex > -1) {
      accountKeys.splice(removalIndex, 1)
      this.setItem(StaticCacheKeys.ACCOUNT_KEYS, JSON.stringify(accountKeys))
      this.logger.trace('BrowserCacheManager.removeAccountKeyFromMap account key removed')
    } else {
      this.logger.trace('BrowserCacheManager.removeAccountKeyFromMap key not found in existing map')
    }
  }

  /**
   * Extends inherited removeAccount function to include removal of the account key from the map
   * @param key
   */
  async removeAccount(key: string): Promise<void> {
    void super.removeAccount(key)
    this.removeAccountKeyFromMap(key)
  }

  /**
   * Removes given idToken from the cache and from the key map
   * @param key
   */
  removeIdToken(key: string): void {
    super.removeIdToken(key)
    this.removeTokenKey(key, CredentialType.ID_TOKEN)
  }

  /**
   * Removes given accessToken from the cache and from the key map
   * @param key
   */
  async removeAccessToken(key: string): Promise<void> {
    void super.removeAccessToken(key)
    this.removeTokenKey(key, CredentialType.ACCESS_TOKEN)
  }

  /**
   * Removes given refreshToken from the cache and from the key map
   * @param key
   */
  removeRefreshToken(key: string): void {
    super.removeRefreshToken(key)
    this.removeTokenKey(key, CredentialType.REFRESH_TOKEN)
  }

  /**
   * Gets the keys for the cached tokens associated with this clientId
   * @returns
   */
  getTokenKeys(): TokenKeys {
    this.logger.trace('BrowserCacheManager.getTokenKeys called')
    const item = this.getItem(`${StaticCacheKeys.TOKEN_KEYS}.${this.clientId}`)
    if (item) {
      const tokenKeys = this.validateAndParseJson(item)
      if (
        tokenKeys &&
        tokenKeys.hasOwnProperty('idToken') &&
        tokenKeys.hasOwnProperty('accessToken') &&
        tokenKeys.hasOwnProperty('refreshToken')
      ) {
        return tokenKeys as TokenKeys
      } else {
        this.logger.error(
          'BrowserCacheManager.getTokenKeys - Token keys found but in an unknown format. Returning empty key map.',
        )
      }
    } else {
      this.logger.verbose('BrowserCacheManager.getTokenKeys - No token keys found')
    }

    return {
      idToken: [],
      accessToken: [],
      refreshToken: [],
    }
  }

  /**
   * Adds the given key to the token key map
   * @param key
   * @param type
   */
  addTokenKey(key: string, type: CredentialType): void {
    this.logger.trace('BrowserCacheManager addTokenKey called')
    const tokenKeys = this.getTokenKeys()

    switch (type) {
      case CredentialType.ID_TOKEN:
        if (tokenKeys.idToken.indexOf(key) === -1) {
          this.logger.info('BrowserCacheManager: addTokenKey - idToken added to map')
          tokenKeys.idToken.push(key)
        }
        break
      case CredentialType.ACCESS_TOKEN:
        if (tokenKeys.accessToken.indexOf(key) === -1) {
          this.logger.info('BrowserCacheManager: addTokenKey - accessToken added to map')
          tokenKeys.accessToken.push(key)
        }
        break
      case CredentialType.REFRESH_TOKEN:
        if (tokenKeys.refreshToken.indexOf(key) === -1) {
          this.logger.info('BrowserCacheManager: addTokenKey - refreshToken added to map')
          tokenKeys.refreshToken.push(key)
        }
        break
      default:
        this.logger.error(
          `BrowserCacheManager:addTokenKey - CredentialType provided invalid. CredentialType: ${type}`,
        )
        ClientAuthError.createUnexpectedCredentialTypeError()
    }

    this.setItem(`${StaticCacheKeys.TOKEN_KEYS}.${this.clientId}`, JSON.stringify(tokenKeys))
  }

  /**
   * Removes the given key from the token key map
   * @param key
   * @param type
   */
  removeTokenKey(key: string, type: CredentialType): void {
    this.logger.trace('BrowserCacheManager removeTokenKey called')
    const tokenKeys = this.getTokenKeys()

    switch (type) {
      case CredentialType.ID_TOKEN:
        this.logger.infoPii(
          `BrowserCacheManager: removeTokenKey - attempting to remove idToken with key: ${key} from map`,
        )
        const idRemoval = tokenKeys.idToken.indexOf(key)
        if (idRemoval > -1) {
          this.logger.info('BrowserCacheManager: removeTokenKey - idToken removed from map')
          tokenKeys.idToken.splice(idRemoval, 1)
        } else {
          this.logger.info(
            'BrowserCacheManager: removeTokenKey - idToken does not exist in map. Either it was previously removed or it was never added.',
          )
        }
        break
      case CredentialType.ACCESS_TOKEN:
        this.logger.infoPii(
          `BrowserCacheManager: removeTokenKey - attempting to remove accessToken with key: ${key} from map`,
        )
        const accessRemoval = tokenKeys.accessToken.indexOf(key)
        if (accessRemoval > -1) {
          this.logger.info('BrowserCacheManager: removeTokenKey - accessToken removed from map')
          tokenKeys.accessToken.splice(accessRemoval, 1)
        } else {
          this.logger.info(
            'BrowserCacheManager: removeTokenKey - accessToken does not exist in map. Either it was previously removed or it was never added.',
          )
        }
        break
      case CredentialType.REFRESH_TOKEN:
        this.logger.infoPii(
          `BrowserCacheManager: removeTokenKey - attempting to remove refreshToken with key: ${key} from map`,
        )
        const refreshRemoval = tokenKeys.refreshToken.indexOf(key)
        if (refreshRemoval > -1) {
          this.logger.info('BrowserCacheManager: removeTokenKey - refreshToken removed from map')
          tokenKeys.refreshToken.splice(refreshRemoval, 1)
        } else {
          this.logger.info(
            'BrowserCacheManager: removeTokenKey - refreshToken does not exist in map. Either it was previously removed or it was never added.',
          )
        }
        break
      default:
        this.logger.error(
          `BrowserCacheManager:removeTokenKey - CredentialType provided invalid. CredentialType: ${type}`,
        )
        ClientAuthError.createUnexpectedCredentialTypeError()
    }

    this.setItem(`${StaticCacheKeys.TOKEN_KEYS}.${this.clientId}`, JSON.stringify(tokenKeys))
  }

  /**
   * generates idToken entity from a string
   * @param idTokenKey
   */
  getIdTokenCredential(idTokenKey: string): IdTokenEntity | null {
    const value = this.getItem(idTokenKey)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getIdTokenCredential: called, no cache hit')
      this.removeTokenKey(idTokenKey, CredentialType.ID_TOKEN)
      return null
    }

    const parsedIdToken = this.validateAndParseJson(value)
    if (!parsedIdToken || !IdTokenEntity.isIdTokenEntity(parsedIdToken)) {
      this.logger.trace('BrowserCacheManager.getIdTokenCredential: called, no cache hit')
      this.removeTokenKey(idTokenKey, CredentialType.ID_TOKEN)
      return null
    }

    this.logger.trace('BrowserCacheManager.getIdTokenCredential: cache hit')
    return CacheManager.toObject(new IdTokenEntity(), parsedIdToken)
  }

  /**
   * set IdToken credential to the platform cache
   * @param idToken
   */
  setIdTokenCredential(idToken: IdTokenEntity): void {
    this.logger.trace('BrowserCacheManager.setIdTokenCredential called')
    const idTokenKey = idToken.generateCredentialKey()

    this.setItem(idTokenKey, JSON.stringify(idToken))

    this.addTokenKey(idTokenKey, CredentialType.ID_TOKEN)
  }

  /**
   * generates accessToken entity from a string
   * @param key
   */
  getAccessTokenCredential(accessTokenKey: string): AccessTokenEntity | null {
    const value = this.getItem(accessTokenKey)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getAccessTokenCredential: called, no cache hit')
      this.removeTokenKey(accessTokenKey, CredentialType.ACCESS_TOKEN)
      return null
    }
    const parsedAccessToken = this.validateAndParseJson(value)
    if (!parsedAccessToken || !AccessTokenEntity.isAccessTokenEntity(parsedAccessToken)) {
      this.logger.trace('BrowserCacheManager.getAccessTokenCredential: called, no cache hit')
      this.removeTokenKey(accessTokenKey, CredentialType.ACCESS_TOKEN)
      return null
    }

    this.logger.trace('BrowserCacheManager.getAccessTokenCredential: cache hit')
    return CacheManager.toObject(new AccessTokenEntity(), parsedAccessToken)
  }

  /**
   * set accessToken credential to the platform cache
   * @param accessToken
   */
  setAccessTokenCredential(accessToken: AccessTokenEntity): void {
    this.logger.trace('BrowserCacheManager.setAccessTokenCredential called')
    const accessTokenKey = accessToken.generateCredentialKey()
    this.setItem(accessTokenKey, JSON.stringify(accessToken))

    this.addTokenKey(accessTokenKey, CredentialType.ACCESS_TOKEN)
  }

  /**
   * generates refreshToken entity from a string
   * @param refreshTokenKey
   */
  getRefreshTokenCredential(refreshTokenKey: string): RefreshTokenEntity | null {
    const value = this.getItem(refreshTokenKey)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getRefreshTokenCredential: called, no cache hit')
      this.removeTokenKey(refreshTokenKey, CredentialType.REFRESH_TOKEN)
      return null
    }
    const parsedRefreshToken = this.validateAndParseJson(value)
    if (!parsedRefreshToken || !RefreshTokenEntity.isRefreshTokenEntity(parsedRefreshToken)) {
      this.logger.trace('BrowserCacheManager.getRefreshTokenCredential: called, no cache hit')
      this.removeTokenKey(refreshTokenKey, CredentialType.REFRESH_TOKEN)
      return null
    }

    this.logger.trace('BrowserCacheManager.getRefreshTokenCredential: cache hit')
    return CacheManager.toObject(new RefreshTokenEntity(), parsedRefreshToken)
  }

  /**
   * set refreshToken credential to the platform cache
   * @param refreshToken
   */
  setRefreshTokenCredential(refreshToken: RefreshTokenEntity): void {
    this.logger.trace('BrowserCacheManager.setRefreshTokenCredential called')
    const refreshTokenKey = refreshToken.generateCredentialKey()
    this.setItem(refreshTokenKey, JSON.stringify(refreshToken))

    this.addTokenKey(refreshTokenKey, CredentialType.REFRESH_TOKEN)
  }

  /**
   * fetch appMetadata entity from the platform cache
   * @param appMetadataKey
   */
  getAppMetadata(appMetadataKey: string): AppMetadataEntity | null {
    const value = this.getItem(appMetadataKey)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getAppMetadata: called, no cache hit')
      return null
    }

    const parsedMetadata = this.validateAndParseJson(value)
    if (!parsedMetadata || !AppMetadataEntity.isAppMetadataEntity(appMetadataKey, parsedMetadata)) {
      this.logger.trace('BrowserCacheManager.getAppMetadata: called, no cache hit')
      return null
    }

    this.logger.trace('BrowserCacheManager.getAppMetadata: cache hit')
    return CacheManager.toObject(new AppMetadataEntity(), parsedMetadata)
  }

  /**
   * set appMetadata entity to the platform cache
   * @param appMetadata
   */
  setAppMetadata(appMetadata: AppMetadataEntity): void {
    this.logger.trace('BrowserCacheManager.setAppMetadata called')
    const appMetadataKey = appMetadata.generateAppMetadataKey()
    this.setItem(appMetadataKey, JSON.stringify(appMetadata))
  }

  /**
   * fetch server telemetry entity from the platform cache
   * @param serverTelemetryKey
   */
  getServerTelemetry(serverTelemetryKey: string): ServerTelemetryEntity | null {
    const value = this.getItem(serverTelemetryKey)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getServerTelemetry: called, no cache hit')
      return null
    }
    const parsedMetadata = this.validateAndParseJson(value)
    if (
      !parsedMetadata ||
      !ServerTelemetryEntity.isServerTelemetryEntity(serverTelemetryKey, parsedMetadata)
    ) {
      this.logger.trace('BrowserCacheManager.getServerTelemetry: called, no cache hit')
      return null
    }

    this.logger.trace('BrowserCacheManager.getServerTelemetry: cache hit')
    return CacheManager.toObject(new ServerTelemetryEntity(), parsedMetadata)
  }

  /**
   * set server telemetry entity to the platform cache
   * @param serverTelemetryKey
   * @param serverTelemetry
   */
  setServerTelemetry(serverTelemetryKey: string, serverTelemetry: ServerTelemetryEntity): void {
    this.logger.trace('BrowserCacheManager.setServerTelemetry called')
    this.setItem(serverTelemetryKey, JSON.stringify(serverTelemetry))
  }

  /**
   *
   */
  getAuthorityMetadata(key: string): AuthorityMetadataEntity | null {
    const value = this.internalStorage.getItem(key)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getAuthorityMetadata: called, no cache hit')
      return null
    }
    const parsedMetadata = this.validateAndParseJson(value)
    if (parsedMetadata && AuthorityMetadataEntity.isAuthorityMetadataEntity(key, parsedMetadata)) {
      this.logger.trace('BrowserCacheManager.getAuthorityMetadata: cache hit')
      return CacheManager.toObject(new AuthorityMetadataEntity(), parsedMetadata)
    }
    return null
  }

  /**
   *
   */
  getAuthorityMetadataKeys(): Array<string> {
    const allKeys = this.internalStorage.getKeys()
    return allKeys.filter((key) => {
      return this.isAuthorityMetadata(key)
    })
  }

  /**
   * Sets wrapper metadata in memory
   * @param wrapperSKU
   * @param wrapperVersion
   */
  setWrapperMetadata(wrapperSKU: string, wrapperVersion: string): void {
    this.internalStorage.setItem(InMemoryCacheKeys.WRAPPER_SKU, wrapperSKU)
    this.internalStorage.setItem(InMemoryCacheKeys.WRAPPER_VER, wrapperVersion)
  }

  /**
   * Returns wrapper metadata from in-memory storage
   */
  getWrapperMetadata(): [string, string] {
    const sku = this.internalStorage.getItem(InMemoryCacheKeys.WRAPPER_SKU) || Constants.EMPTY_STRING
    const version = this.internalStorage.getItem(InMemoryCacheKeys.WRAPPER_VER) || Constants.EMPTY_STRING
    return [sku, version]
  }

  /**
   *
   * @param entity
   */
  setAuthorityMetadata(key: string, entity: AuthorityMetadataEntity): void {
    this.logger.trace('BrowserCacheManager.setAuthorityMetadata called')
    this.internalStorage.setItem(key, JSON.stringify(entity))
  }

  /**
   * Gets the active account
   */
  getActiveAccount(): AccountInfo | null {
    const activeAccountKeyFilters = this.generateCacheKey(PersistentCacheKeys.ACTIVE_ACCOUNT_FILTERS)
    const activeAccountValueFilters = this.getItem(activeAccountKeyFilters)
    if (!activeAccountValueFilters) {
      // if new active account cache type isn't found, it's an old version, so look for that instead
      this.logger.trace(
        'BrowserCacheManager.getActiveAccount: No active account filters cache schema found, looking for legacy schema',
      )
      const activeAccountKeyLocal = this.generateCacheKey(PersistentCacheKeys.ACTIVE_ACCOUNT)
      const activeAccountValueLocal = this.getItem(activeAccountKeyLocal)
      if (!activeAccountValueLocal) {
        this.logger.trace('BrowserCacheManager.getActiveAccount: No active account found')
        return null
      }
      const activeAccount =
        this.getAccountInfoByFilter({
          localAccountId: activeAccountValueLocal,
        })[0] || null
      if (activeAccount) {
        this.logger.trace(
          'BrowserCacheManager.getActiveAccount: Legacy active account cache schema found',
        )
        this.logger.trace(
          'BrowserCacheManager.getActiveAccount: Adding active account filters cache schema',
        )
        this.setActiveAccount(activeAccount)
        return activeAccount
      }
      return null
    }
    const activeAccountValueObj = this.validateAndParseJson(activeAccountValueFilters) as AccountInfo
    if (activeAccountValueObj) {
      this.logger.trace('BrowserCacheManager.getActiveAccount: Active account filters schema found')
      return (
        this.getAccountInfoByFilter({
          homeAccountId: activeAccountValueObj.homeAccountId,
          localAccountId: activeAccountValueObj.localAccountId,
        })[0] || null
      )
    }
    this.logger.trace('BrowserCacheManager.getActiveAccount: No active account found')
    return null
  }

  /**
   * Sets the active account's localAccountId in cache
   * @param account
   */
  setActiveAccount(account: AccountInfo | null): void {
    const activeAccountKey = this.generateCacheKey(PersistentCacheKeys.ACTIVE_ACCOUNT_FILTERS)
    const activeAccountKeyLocal = this.generateCacheKey(PersistentCacheKeys.ACTIVE_ACCOUNT)
    if (account) {
      this.logger.verbose('setActiveAccount: Active account set')
      const activeAccountValue: ActiveAccountFilters = {
        homeAccountId: account.homeAccountId,
        localAccountId: account.localAccountId,
      }
      this.testStorage.setItem(activeAccountKey, JSON.stringify(activeAccountValue))
      this.testStorage.setItem(activeAccountKeyLocal, account.localAccountId)
    } else {
      this.logger.verbose('setActiveAccount: No account passed, active account not set')
      this.testStorage.removeItem(activeAccountKey)
      this.testStorage.removeItem(activeAccountKeyLocal)
    }
  }

  /**
   * Gets a list of accounts that match all of the filters provided
   * @param account
   */
  getAccountInfoByFilter(
    accountFilter: Partial<Omit<AccountInfo, 'idTokenClaims' | 'name'>>,
  ): AccountInfo[] {
    const allAccounts = this.getAllAccounts()
    this.logger.trace(
      `BrowserCacheManager.getAccountInfoByFilter: total ${allAccounts.length} accounts found`,
    )

    return allAccounts.filter((accountObj) => {
      if (
        accountFilter.username &&
        accountFilter.username.toLowerCase() !== accountObj.username.toLowerCase()
      ) {
        return false
      }

      if (accountFilter.homeAccountId && accountFilter.homeAccountId !== accountObj.homeAccountId) {
        return false
      }

      if (accountFilter.localAccountId && accountFilter.localAccountId !== accountObj.localAccountId) {
        return false
      }

      if (accountFilter.tenantId && accountFilter.tenantId !== accountObj.tenantId) {
        return false
      }

      if (accountFilter.environment && accountFilter.environment !== accountObj.environment) {
        return false
      }

      return true
    })
  }

  /**
   * Checks the cache for accounts matching loginHint or SID
   * @param loginHint
   * @param sid
   */
  getAccountInfoByHints(loginHint?: string, sid?: string): AccountInfo | null {
    const matchingAccounts = this.getAllAccounts().filter((accountInfo) => {
      if (sid) {
        const accountSid = accountInfo.idTokenClaims && accountInfo.idTokenClaims['sid']
        return sid === accountSid
      }

      if (loginHint) {
        return loginHint === accountInfo.username
      }

      return false
    })

    if (matchingAccounts.length === 1) {
      return matchingAccounts[0]
    } else if (matchingAccounts.length > 1) {
      throw ClientAuthError.createMultipleMatchingAccountsInCacheError()
    }

    return null
  }

  /**
   * fetch throttling entity from the platform cache
   * @param throttlingCacheKey
   */
  getThrottlingCache(throttlingCacheKey: string): ThrottlingEntity | null {
    const value = this.getItem(throttlingCacheKey)
    if (!value) {
      this.logger.trace('BrowserCacheManager.getThrottlingCache: called, no cache hit')
      return null
    }

    const parsedThrottlingCache = this.validateAndParseJson(value)
    if (
      !parsedThrottlingCache ||
      !ThrottlingEntity.isThrottlingEntity(throttlingCacheKey, parsedThrottlingCache)
    ) {
      this.logger.trace('BrowserCacheManager.getThrottlingCache: called, no cache hit')
      return null
    }

    this.logger.trace('BrowserCacheManager.getThrottlingCache: cache hit')
    return CacheManager.toObject(new ThrottlingEntity(), parsedThrottlingCache)
  }

  /**
   * set throttling entity to the platform cache
   * @param throttlingCacheKey
   * @param throttlingCache
   */
  setThrottlingCache(throttlingCacheKey: string, throttlingCache: ThrottlingEntity): void {
    this.logger.trace('BrowserCacheManager.setThrottlingCache called')
    this.setItem(throttlingCacheKey, JSON.stringify(throttlingCache))
  }

  /**
   * Removes the cache item with the given key.
   * Will also clear the cookie item if storeAuthStateInCookie is set to true.
   * @param key
   */
  removeItem(key: string): void {
    this.testStorage.removeItem(key)
    // if (this.cacheConfig.storeAuthStateInCookie) {
    //   this.logger.trace(
    //     'BrowserCacheManager.removeItem: storeAuthStateInCookie is true, clearing item cookie',
    //   )
    //   this.clearItemCookie(key)
    // }
  }

  /**
   * Checks whether key is in cache.
   * @param key
   */
  containsKey(key: string): boolean {
    return this.testStorage.containsKey(key)
  }

  /**
   * Gets all keys in window.
   */
  getKeys(): string[] {
    return [...this.testStorage.getKeys()]
  }

  /**
   * Clears all cache entries created by MSAL.
   */
  async clear(): Promise<void> {
    // Removes all accounts and their credentials
    await this.removeAllAccounts()
    this.removeAppMetadata()

    // Removes all remaining MSAL cache items
    this.getKeys().forEach((cacheKey: string) => {
      // Check if key contains msal prefix; For now, we are clearing all the cache items created by MSAL.js
      if (
        this.testStorage.containsKey(cacheKey) &&
        (cacheKey.indexOf(Constants.CACHE_PREFIX) !== -1 || cacheKey.indexOf(this.clientId) !== -1)
      ) {
        this.removeItem(cacheKey)
      }
    })

    this.internalStorage.clear()
  }

  /**
   * Clears all access tokes that have claims prior to saving the current one
   * @param credential
   * @returns
   */
  async clearTokensAndKeysWithClaims(): Promise<void> {
    const tokenKeys = this.getTokenKeys()

    const removedAccessTokens: Array<Promise<void>> = []
    tokenKeys.accessToken.forEach((key: string) => {
      // if the access token has claims in its key, remove the token key and the token
      const credential = this.getAccessTokenCredential(key)
      if (
        credential?.requestedClaimsHash &&
        key.includes(credential.requestedClaimsHash.toLowerCase())
      ) {
        removedAccessTokens.push(this.removeAccessToken(key))
      }
    })
    await Promise.all(removedAccessTokens)

    // warn if any access tokens are removed
    if (removedAccessTokens.length > 0) {
      this.logger.warning(
        `${removedAccessTokens.length} access tokens with claims in the cache keys have been removed from the cache.`,
      )
    }
  }

  /**
   * Add value to cookies
   * @param cookieName
   * @param cookieValue
   * @param expires
   */
  setItemCookie(cookieName: string, cookieValue: string, expires?: number): void {
    let cookieStr = `${encodeURIComponent(cookieName)}=${encodeURIComponent(
      cookieValue,
    )};path=/;SameSite=Lax;`
    if (expires) {
      const expireTime = this.getCookieExpirationTime(expires)
      cookieStr += `expires=${expireTime};`
    }

    // if (this.cacheConfig.secureCookies) {
    //   cookieStr += 'Secure;'
    // }

    document.cookie = cookieStr
  }

  /**
   * Get one item by key from cookies
   * @param cookieName
   */
  getItemCookie(cookieName: string): string {
    const name = `${encodeURIComponent(cookieName)}=`
    const cookieList = document.cookie.split(';')
    for (let i: number = 0; i < cookieList.length; i++) {
      let cookie = cookieList[i]
      while (cookie.charAt(0) === ' ') {
        cookie = cookie.substring(1)
      }
      if (cookie.indexOf(name) === 0) {
        return decodeURIComponent(cookie.substring(name.length, cookie.length))
      }
    }
    return Constants.EMPTY_STRING
  }

  /**
   * Clear all msal-related cookies currently set in the browser. Should only be used to clear temporary cache items.
   */
  clearMsalCookies(): void {
    const cookiePrefix = `${Constants.CACHE_PREFIX}.${this.clientId}`
    const cookieList = document.cookie.split(';')
    cookieList.forEach((cookie: string): void => {
      while (cookie.charAt(0) === ' ') {
        // eslint-disable-next-line no-param-reassign
        cookie = cookie.substring(1)
      }
      if (cookie.indexOf(cookiePrefix) === 0) {
        const cookieKey = cookie.split('=')[0]
        this.clearItemCookie(cookieKey)
      }
    })
  }

  /**
   * Clear an item in the cookies by key
   * @param cookieName
   */
  clearItemCookie(cookieName: string): void {
    this.setItemCookie(cookieName, Constants.EMPTY_STRING, -1)
  }

  /**
   * Get cookie expiration time
   * @param cookieLifeDays
   */
  getCookieExpirationTime(cookieLifeDays: number): string {
    const today = new Date()
    const expr = new Date(today.getTime() + cookieLifeDays * this.COOKIE_LIFE_MULTIPLIER)
    return expr.toUTCString()
  }

  /**
   * Gets the cache object referenced by the browser
   */
  getCache(): object {
    return this.testStorage
  }

  /**
   * interface compat, we cannot overwrite browser cache; Functionality is supported by individual entities in browser
   */
  setCache(): void {
    // sets nothing
  }

  /**
   * Prepend msal.<client-id> to each key; Skip for any JSON object as Key (defined schemas do not need the key appended: AccessToken Keys or the upcoming schema)
   * @param key
   * @param addInstanceId
   */
  generateCacheKey(key: string): string {
    const generatedKey = this.validateAndParseJson(key)
    if (!generatedKey) {
      if (
        StringUtils.startsWith(key, Constants.CACHE_PREFIX) ||
        StringUtils.startsWith(key, PersistentCacheKeys.ADAL_ID_TOKEN)
      ) {
        return key
      }
      return `${Constants.CACHE_PREFIX}.${this.clientId}.${key}`
    }

    return JSON.stringify(key)
  }

  /**
   * Create authorityKey to cache authority
   * @param state
   */
  generateAuthorityKey(stateString: string): string {
    const {
      libraryState: { id: stateId },
    } = ProtocolUtils.parseRequestState(this.cryptoImpl, stateString)

    return this.generateCacheKey(`${TemporaryCacheKeys.AUTHORITY}.${stateId}`)
  }

  /**
   * Create Nonce key to cache nonce
   * @param state
   */
  generateNonceKey(stateString: string): string {
    const {
      libraryState: { id: stateId },
    } = ProtocolUtils.parseRequestState(this.cryptoImpl, stateString)

    return this.generateCacheKey(`${TemporaryCacheKeys.NONCE_IDTOKEN}.${stateId}`)
  }

  /**
   * Creates full cache key for the request state
   * @param stateString State string for the request
   */
  generateStateKey(stateString: string): string {
    // Use the library state id to key temp storage for uniqueness for multiple concurrent requests
    const {
      libraryState: { id: stateId },
    } = ProtocolUtils.parseRequestState(this.cryptoImpl, stateString)
    return this.generateCacheKey(`${TemporaryCacheKeys.REQUEST_STATE}.${stateId}`)
  }

  /**
   * Reset all temporary cache items
   * @param state
   */
  resetRequestCache(state: string): void {
    this.logger.trace('BrowserCacheManager.resetRequestCache called')
    // check state and remove associated cache items
    if (state) {
      this.getKeys().forEach((key) => {
        if (key.indexOf(state) !== -1) {
          this.removeItem(key)
        }
      })

      // delete generic interactive request parameters
      this.removeItem(this.generateStateKey(state))
      this.removeItem(this.generateNonceKey(state))
      this.removeItem(this.generateAuthorityKey(state))
    }
    this.removeItem(this.generateCacheKey(TemporaryCacheKeys.REQUEST_PARAMS))
    this.removeItem(this.generateCacheKey(TemporaryCacheKeys.ORIGIN_URI))
    this.removeItem(this.generateCacheKey(TemporaryCacheKeys.URL_HASH))
    this.removeItem(this.generateCacheKey(TemporaryCacheKeys.CORRELATION_ID))
    this.removeItem(this.generateCacheKey(TemporaryCacheKeys.CCS_CREDENTIAL))
    this.removeItem(this.generateCacheKey(TemporaryCacheKeys.NATIVE_REQUEST))
  }

  /**
   * Updates a credential's cache key if the current cache key is outdated
   */
  updateCredentialCacheKey(currentCacheKey: string, credential: ValidCredentialType): string {
    const updatedCacheKey = credential.generateCredentialKey()

    if (currentCacheKey !== updatedCacheKey) {
      const cacheItem = this.getItem(currentCacheKey)
      if (cacheItem) {
        this.removeItem(currentCacheKey)
        this.setItem(updatedCacheKey, cacheItem)
        this.logger.verbose(`Updated an outdated ${credential.credentialType} cache key`)
        return updatedCacheKey
      } else {
        this.logger.error(
          `Attempted to update an outdated ${credential.credentialType} cache key but no item matching the outdated key was found in storage`,
        )
      }
    }

    return currentCacheKey
  }
}

export const DEFAULT_TEST_CACHE_MANAGER = (clientId: string, logger: Logger): TestCacheManager => {
  const cacheOptions: Required<CacheOptions> = {
    claimsBasedCachingEnabled: true,
  }
  return new TestCacheManager(clientId, cacheOptions, DEFAULT_CRYPTO_IMPLEMENTATION, logger)
}
