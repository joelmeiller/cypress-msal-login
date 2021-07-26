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
import { ServerAuthorizationTokenResponse } from '@azure/msal-common/dist/response/ServerAuthorizationTokenResponse'
import { OauthClient, OauthCredentials } from './client/OauthClient'

export const AzureTokenUrl = `https://login.microsoftonline.com/${Cypress.env(
  'REACT_APP_TENANT_ID',
)}/oauth2/v2.0/token`

declare global {
  namespace Cypress {
    interface Chainable {
      msalCreateAccessToken(credentials: OauthCredentials): Chainable<any>;
      msalLogin(authResponse: unknown): Chainable<any>;
    }
  }
}

Cypress.Commands.add(
  'msalCreateAccessToken',
  function (loginParams: OauthCredentials) {
    // const loginClient = new UsernamePasswordClientApplication()
    // return loginClient.acquireTokenByUsernamePassword(credentials)
    // cy.exec(`az account get-access-token --resource api://04269503-a311-4d14-90ec-d486ff2413f8 --tenant b361b36b-d273-4bad-9010-8a2e74802720 | jq --raw-output '.accessToken'`).then()
    cy.clearLocalStorage()

    Cypress.log({
      name: 'loginBySingleSignOn',
    })

    cy.clearLocalStorage()

    const options = {
      method: 'POST',
      url: AzureTokenUrl,
      qs: {
        // use qs to set query string to the url that creates
        // http://auth.corp.com:8080?redirectTo=http://localhost:7074/set_token
        redirectTo: 'http://localhost:3002',
      },
      form: true, // we are submitting a regular form body
      body: {
        grant_type: 'password', //read up on the other grant types, they are all useful, client_credentials and authorization_code
        client_id: Cypress.env('REACT_APP_CLIENT_ID'), //obtained from the application section in AzureAD
        client_info: 1,
        // client_secret = {client-secret}//obtained from the application section in AzureAD
        scope:
          'api://04269503-a311-4d14-90ec-d486ff2413f8/all user.read openid profile offline_access',
        username: loginParams.username,
        password: loginParams.password,
      },
    }

    // allow us to override defaults with passed in overrides
    Cypress._.extend(options, loginParams.options)

    cy.request(options).then((res) => {
      expect(res.status).to.eq(200)
      return res.body as ServerAuthorizationTokenResponse
    })
  },
)

const oauthClient = new OauthClient()
const setToken = (authResponse: ServerAuthorizationTokenResponse) =>
  new Cypress.Promise((resolve, reject) => {
    oauthClient.setToken(authResponse).then(resolve).catch(reject)
  })
Cypress.Commands.add('msalLogin', function (response: unknown) {
  const authResponse = response as ServerAuthorizationTokenResponse

  cy.intercept('POST', AzureTokenUrl, (req) => {
    req.continue((res) => {
      res.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
      res.headers['Access-Control-Allow-Origin'] = '*'
    })
  })

  cy.wrap(null).then(async () => {
    await setToken(authResponse)
    cy.visit('/login')
  })
})

