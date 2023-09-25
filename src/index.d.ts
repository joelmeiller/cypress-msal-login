/// <reference types="cypress" />

import type { Configuration } from '@azure/msal-browser'
import type { OauthCredentials } from './client/OauthClient'

declare namespace Cypress {
  interface Chainable {
    msalLogin(
      loginParams: OauthCredentials,
      configuration: Configuration,
      scopes: Array<string>,
    ): any
  }
}
