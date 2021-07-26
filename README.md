# cypress-msal-login
Cypress command extension to log into a SSO App through the Microsoft Authentication flow using the MSAL library in the app.

## Installation

This package depends on the MSAL browser library to be installed in your application (peerDependency)

```bash
npm install @azure/msal-browser
```

Add the cypress package as a dev dependency

```bash
npm install --dev cypress-msal-login
```


## Login with MSAL account

The login command requires three parameters. Here is a minimal example:

```
cy.msalLogin(
  {
    email: 'my-test-user@cypress.com',
    password: 'whatever'
  },
  {
    auth: {
    clientId: '<application-client-id>',
    authority: 'https://login.microsoftonline.com/<application-tenant-id>',
    },
    cache: {
      cacheLocation: BrowserCacheLocation.LocalStorage,
    },
  },
  ['openid', 'profile', 'user', 'offline_access'],
)
```

- User Credentials
The cypess test user's credentials (email and password). I strongly recommend to create a dedicated Cypress test user with specific rights.

- Configuration
The configuration as provided to your msal instance. If you set the settings using envirenment variables (which you probably should), you might need to adjust the configuration accordingly for Cypress. See example below and take a look at the documentation [cypress/environment-variables](https://docs.cypress.io/guides/guides/environment-variables)
```
import { Configuration, BrowserCacheLocation } from '@azure/msal-browser'

const msalConfig: Configuration = {
  auth: {
    clientId: Cypress.env('MSAL_CLIENT_ID'),
    authority: `https://login.microsoftonline.com/${Cypress.env('MSAL_TENANT_ID')}`,
  },
  cache: {
    cacheLocation: BrowserCacheLocation.LocalStorage,
    storeAuthStateInCookie: true,
  },
}
```

- Scope
The scope of the token. Make sure you include at least the `openid`, `profile`, `user` and `offline_access` 





## Trouble-shoot

