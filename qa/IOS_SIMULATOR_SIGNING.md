# Simulator signing (QA only)

The 43234132202 signing matrix showed that signature-slot ad-hoc entitlements
caused CODESIGNING/1 at dyld start; an entitlement-free signature booted but PDF
SecItemAdd failed with -34018. The smoke build now delegates simulator signing
to Xcode: `CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=-
CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=`.

A generated entitlements copy under `qa/build` preserves source capabilities and
keychain groups, resolves AppIdentifierPrefix to empty, and supplies the matching
application identifier/default keychain group. Only an explicit SIWA capability
signing refusal triggers a retry removing `com.apple.developer.applesignin` from
that copy. Production entitlements/project configuration are never modified.

Verification requires simulator bundle identity, no provisioning profile, embedded
Mach-O `__TEXT,__entitlements` containing the matching application identifier and
keychain group, deep/strict valid ad-hoc signature, and no Authority. `codesign -d
--entitlements :-` is captured privately; an empty signature-slot entitlement
response is permitted because simulator entitlements live in the Mach-O section.
Nested frameworks remain exactly as Xcode signed them. The old matrix helpers are
retained for historical tests but never invoked by the normal CLI. Manual `sign`
CLI is disabled. One sanitized launch probe runs before XCTest and must prove the
app remains live before the existing cold XCTest launch.

Raw build/section/codesign/XCTest output stays private. Only existing sanitized
JSON/JSONL is uploaded. This diagnostic run is not release or real-device proof.
