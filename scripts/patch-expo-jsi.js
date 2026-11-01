// Works around a Swift 6 region-isolation error in expo-modules-jsi 58.0.21 when archiving with Xcode 26.x:
// "sending 'slot' risks causing data races" in JavaScriptObject.swift. Wraps the raw pointer in an @unchecked Sendable box.
const fs = require('fs'); const p = 'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/Values/JavaScriptObject.swift';
if (!fs.existsSync(p)) { console.log('patch-expo-jsi: file not found, skipping'); process.exit(0); }
let s = fs.readFileSync(p, 'utf8');
const before = `    try runtime._withUnsafeGuaranteedRef { runtime in
      try JavaScriptActor.assumeIsolated {
        try encode(JavaScriptValue.Slot(slot), runtime)
      }
    }`;
const after = `    struct PaperlySlotBox: @unchecked Sendable { let p: UnsafeMutablePointer<facebook.jsi.Value> }
    let slotBox = PaperlySlotBox(p: slot)
    try runtime._withUnsafeGuaranteedRef { runtime in
      try JavaScriptActor.assumeIsolated {
        try encode(JavaScriptValue.Slot(slotBox.p), runtime)
      }
    }`;
if (s.includes(after)) { console.log('patch-expo-jsi: already applied'); process.exit(0); }
if (!s.includes(before)) { console.log('patch-expo-jsi: pattern not found (version changed?) - skipping'); process.exit(0); }
fs.writeFileSync(p, s.replace(before, after)); console.log('patch-expo-jsi: applied');
