/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { AuthenticationResult } from '@azure/msal-browser'
import {
  BrowserCacheManager,
  DEFAULT_BROWSER_CACHE_MANAGER,
} from '@azure/msal-browser/dist/cache/BrowserCacheManager'
import {
  BrowserConfiguration,
  buildConfiguration,
  Configuration,
} from '@azure/msal-browser/dist/config/Configuration'
import { CryptoOps } from '@azure/msal-browser/dist/crypto/CryptoOps'
import { name, version } from '@azure/msal-browser/dist/packageMetadata'
import { BrowserCacheLocation } from '@azure/msal-browser/dist/utils/BrowserConstants'
import {
  AuthenticationScheme,
  Authority,
  AuthorityFactory,
  AuthorityOptions,
  BaseAuthRequest,
  DEFAULT_CRYPTO_IMPLEMENTATION,
  ICrypto,
  INetworkModule,
  Logger,
  ServerTelemetryManager,
  ServerTelemetryRequest,
  TimeUtils,
} from '@azure/msal-common'
import { ResponseHandler } from '@azure/msal-common/dist/response/ResponseHandler'
import { ServerAuthorizationTokenResponse } from '@azure/msal-common/dist/response/ServerAuthorizationTokenResponse'

export type OauthTokenResponse = {
  access_token: string
  refresh_token: string
  id_token: string
}

export type OauthCredentials = {
  username: string
  password: string
  options?: unknown
}

export class OauthClient {
  // Crypto interface implementation
  protected readonly browserCrypto: ICrypto

  // Storage interface implementation
  protected readonly browserStorage: BrowserCacheManager

  // Network interface implementation
  protected readonly networkClient: INetworkModule

  // Input configuration by developer/user
  protected config: BrowserConfiguration

  // Logger
  protected logger: Logger

  // Flag to indicate if in browser environment
  protected isBrowserEnvironment: boolean

  /**
   * @constructor
   * Constructor for the PublicClientApplication used to instantiate the PublicClientApplication object
   *
   * Important attributes in the Configuration object for auth are:
   * - clientID: the application ID of your application. You can obtain one by registering your application with our Application registration portal : https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredAppsPreview
   * - authority: the authority URL for your application.
   * - redirect_uri: the uri of your application registered in the portal.
   *
   * In Azure AD, authority is a URL indicating the Azure active directory that MSAL uses to obtain tokens.
   * It is of the form https://login.microsoftonline.com/{Enter_the_Tenant_Info_Here}
   * If your application supports Accounts in one organizational directory, replace "Enter_the_Tenant_Info_Here" value with the Tenant Id or Tenant name (for example, contoso.microsoft.com).
   * If your application supports Accounts in any organizational directory, replace "Enter_the_Tenant_Info_Here" value with organizations.
   * If your application supports Accounts in any organizational directory and personal Microsoft accounts, replace "Enter_the_Tenant_Info_Here" value with common.
   * To restrict support to Personal Microsoft accounts only, replace "Enter_the_Tenant_Info_Here" value with consumers.
   *
   * In Azure B2C, authority is of the form https://{instance}/tfp/{tenant}/{policyName}/
   * Full B2C functionality will be available in this library in future versions.
   *
   * @param configuration Object for the MSAL PublicClientApplication instance
   */
  constructor(configuration: Configuration) {
    /*
     * If loaded in an environment where window is not available,
     * set internal flag to false so that further requests fail.
     * This is to support server-side rendering environments.
     */
    this.isBrowserEnvironment = typeof window !== 'undefined'
    // Set the configuration.
    this.config = buildConfiguration(configuration, this.isBrowserEnvironment)

    // Initialize logger
    this.logger = new Logger(this.config.system.loggerOptions, name, version)

    // Initialize the network module class.
    this.networkClient = this.config.system.networkClient

    // Initialize redirectResponse Map

    if (!this.isBrowserEnvironment) {
      this.browserStorage = DEFAULT_BROWSER_CACHE_MANAGER(
        this.config.auth.clientId,
        this.logger,
      )
      this.browserCrypto = DEFAULT_CRYPTO_IMPLEMENTATION
      return
    }

    // Initialize the crypto class.
    this.browserCrypto = new CryptoOps()

    // Initialize the browser storage class.
    this.browserStorage = new BrowserCacheManager(
      this.config.auth.clientId,
      this.config.cache,
      this.browserCrypto,
      this.logger,
    )
  }

  async handleToken(
    request: BaseAuthRequest,
    response: ServerAuthorizationTokenResponse,
  ): Promise<AuthenticationResult> {
    const reqTimestamp = TimeUtils.nowSeconds()

    const responseHandler = new ResponseHandler(
      this.config.auth.clientId,
      this.browserStorage,
      this.browserCrypto,
      this.logger,
      null,
      null,
    )

    // Validate response. This function throws a server error if an error is returned by the server.
    responseHandler.validateTokenResponse(response)
    const discoveredAuthority = await this.getDiscoveredAuthority(
      request.authority,
      request.correlationId,
    )

    return await responseHandler.handleServerTokenResponse(
      response,
      discoveredAuthority,
      reqTimestamp,
      request,
    )
  }

  async setToken(response: ServerAuthorizationTokenResponse) {
    const baseRequest = this.initializeBaseRequest()    
    return await this.handleToken(baseRequest, response)
  }

  /**
   * Used to get a discovered version of the default authority.
   * @param requestAuthority
   * @param requestCorrelationId
   */
  async getDiscoveredAuthority(
    requestAuthority?: string,
    requestCorrelationId?: string,
  ): Promise<Authority> {
    this.logger.verbose('getDiscoveredAuthority called', requestCorrelationId)
    const authorityOptions: AuthorityOptions = {
      protocolMode: this.config.auth.protocolMode,
      knownAuthorities: this.config.auth.knownAuthorities,
      cloudDiscoveryMetadata: this.config.auth.cloudDiscoveryMetadata,
      authorityMetadata: this.config.auth.authorityMetadata,
    }

    if (requestAuthority) {
      this.logger.verbose(
        'Creating discovered authority with request authority',
        requestCorrelationId,
      )
      return await AuthorityFactory.createDiscoveredInstance(
        requestAuthority,
        this.config.system.networkClient,
        this.browserStorage,
        authorityOptions,
      )
    }

    this.logger.verbose(
      'Creating discovered authority with configured authority',
      requestCorrelationId,
    )
    return await AuthorityFactory.createDiscoveredInstance(
      this.config.auth.authority,
      this.config.system.networkClient,
      this.browserStorage,
      authorityOptions,
    )
  }

  /**
   * Initializer function for all request APIs
   * @param request
   */
  protected initializeBaseRequest(): BaseAuthRequest {
    const authenticationScheme = AuthenticationScheme.BEARER
    const authority = this.config.auth.authority
    const correlationId = this.browserCrypto.createNewGuid()
    const scopes = []

    const validatedRequest: BaseAuthRequest = {
      authenticationScheme,
      correlationId,
      authority,
      scopes,
    }

    return validatedRequest
  }

  /**
   *
   * @param apiId
   * @param correlationId
   * @param forceRefresh
   */
  protected initializeServerTelemetryManager(
    apiId: number,
    correlationId: string,
    forceRefresh?: boolean,
  ): ServerTelemetryManager {
    this.logger.verbose(
      'initializeServerTelemetryManager called',
      correlationId,
    )
    const telemetryPayload: ServerTelemetryRequest = {
      clientId: this.config.auth.clientId,
      correlationId: correlationId,
      apiId: apiId,
      forceRefresh: forceRefresh || false,
    }

    return new ServerTelemetryManager(telemetryPayload, this.browserStorage)
  }
}
