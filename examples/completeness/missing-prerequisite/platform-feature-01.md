## platform-feature-01
### Description
The iOS platform provides Secure Storage feature.
### Additional context
Secure Storage is a feature that protects sensitive data at rest.
### Demonstration
Set up demo app with the following configuration:
| Configuration | Detail |
| -------- | ------- |
| Build variant | Debug |
| Storage backend | EncryptedSharedPreferences |
Perform the following steps to enable Secure Storage:
1. Configure the app to store credentials locally
2. Read the credentials later to confirm the app can continue the session
