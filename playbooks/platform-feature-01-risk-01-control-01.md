## platform-feature-01-risk-01-control-01

### Title

Obfuscate plaintext literals

### Description

Obfuscate plaintext literals during the build process by replacing sensitive values with generated obfuscated accessors to prevent them from being easily recovered through static analysis.

### Demonstration
#### 01. Set up plaintext literals obfuscation

Set up the Swift Confidential build plugin in Xcode. This allows the plugin to access the app's source code and replace plaintext literals with obfuscated code during the build.

<img src="attachments/feature1_risk1_control1_ss1.png" width="400" alt="Alt text">

*Screenshot shows where to locate plugins*

<img src="attachments/feature1_risk1_control1_ss2.png" width="400" alt="Alt text">

*Screenshot shows list of plugins*

<img src="attachments/feature1_risk1_control1_ss3.png" width="400" alt="Alt text">

*Screenshot shows where to add the `swift-confidential` plugin to the project.*

<img src="attachments/feature1_risk1_control1_ss4.png" width="400" alt="Alt text">

*Screenshot shows the packages within the `swift-confidential` plugin*

#### 02. Specify plaintext literals for obfuscation

Move plaintext literals to `confidential.yml`. This allows the plugin to generate obfuscated Swift accessors for those literals during the build. Note: The `confidential.yml` file should not be built into the app bundle.

``` env
secrets:
	- name: apiKey
	  value: verySecureApiKey
```

*Code block shows example contents of `confidential.yml`*

#### 03. Replace plaintext literals with references

Replace plaintext literals with the generated Swift accessors. This ensures that the app references the obfuscated accessors instead of the original plaintext literals.

``` swift
// Secrets is generated from confidential.yml by the Swift Confidential build plugin.
let api_key = Secrets.$apiKey
```

*Code block shows accessing the `apiKey` defined in `confidential.yml` from the source code*

#### 04. Verify plaintext literals are obfuscated

Rebuild the app and use a static analysis tool, such as MobSF, to verify that the original plaintext literals are no longer easily recoverable from the `.ipa` file. Note: Swift Confidential prevents easy static extraction but not runtime attacks such as hooking, memory dumping, or patching.

### References

- https://github.com/securevale/swift-confidential.git
- https://github.com/securevale/swift-confidential-plugin.git

The source code with the implemented control can be found [here](implemented_controls/platform-feature-01-risk-01-control-01.zip).
