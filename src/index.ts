// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
import { Configuration } from '@azure/msal-browser'
import { ServerAuthorizationTokenResponse } from '@azure/msal-common/dist/response/ServerAuthorizationTokenResponse'
import { OauthClient, OauthCredentials } from './client/OauthClient'

declare global {
  namespace Cypress {
    interface Chainable {
      msalLogin(
        loginParams: OauthCredentials,
        configuration: Configuration,
        scopes: Array<string>,
      ): Chainable<any>
    }
  }
}

Cypress.Commands.add(
  'msalLogin',
  function (loginParams: OauthCredentials, configuration: Configuration, scopes: Array<string>) {
    Cypress.log({
      name: 'msal SSO login ',
    })

    const AzureTokenUrl = `${configuration.auth.authority}/oauth2/v2.0/token`
    const oauthClient = new OauthClient(configuration)
    const setToken = (authResponse: ServerAuthorizationTokenResponse) =>
      new Cypress.Promise((resolve, reject) => {
        oauthClient.setToken(authResponse).then(resolve).catch(reject)
      })

    cy.clearLocalStorage()
    cy.intercept('POST', AzureTokenUrl, (req) => {
      req.continue((res) => {
        res.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        res.headers['Access-Control-Allow-Origin'] = '*'
      })
    })

    const options = {
      method: 'POST',
      url: AzureTokenUrl,
      form: true, // we are submitting a regular form body
      body: {
        grant_type: 'password', //read up on the other grant types, they are all useful, client_credentials and authorization_code
        client_id: configuration.auth.clientId, //obtained from the application section in AzureAD
        client_info: 1,
        scope: scopes.join(' '),
        username: loginParams.username,
        password: loginParams.password,
      },
    }

    // allow us to override defaults with passed in overrides
    Cypress._.extend(options, loginParams.options)

    cy.request(options)
      .then((res) => {
        expect(res.status).to.eq(200)
        const tokenResponse = res.body as ServerAuthorizationTokenResponse
        cy.wrap(tokenResponse.access_token).as('sessionToken')
        return tokenResponse
      })
      .then(async (tokenResponse) => {
        await setToken(tokenResponse)
        cy.reload()
      })
  },
)
