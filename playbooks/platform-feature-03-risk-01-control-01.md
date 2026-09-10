## platform-feature-03-risk-01-control-01

### Title

Protect sensitive text fields

### Description

Protect sensitive text fields by using SecureField for sensitive inputs to prevent their contents from being exposed in screenshots, screen recordings, or screen sharing.

### Demonstration
#### 01. Protect sensitive text fields

Replace standard `TextField` inputs for sensitive fields like `Password` with `SecureField`. This automatically prevents the password from showing up in screen recordings, screen shares, or screenshots.

``` swift
SecureField("Password", text: $password)
	.textFieldStyle(.roundedBorder)
```

*Code block shows implementation of `SecureField` on the `Password` input*

References:
- [https://medium.com/@lakshimi.cg/screenshot-prevention-in-ios-f059dc82b046](https://medium.com/@lakshimi.cg/screenshot-prevention-in-ios-f059dc82b046)

The source code with the implemented control can be found [here](implemented_controls/platform-feature-03-risk-01-control-01.zip).
