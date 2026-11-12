import Foundation
// QA runner only. Never return descriptions, paths, identifiers, userInfo, or attachment contents.
enum LaunchIssueDiagnostics {
  static let domains: Set<String> = ["NSPOSIXErrorDomain", "CoreSimulatorErrorDomain", "DTXMessageErrorDomain", "IDETestOperationsObserverErrorDomain", "XCTestErrorDomain", "FBSOpenApplicationServiceErrorDomain", "FBSOpenApplicationErrorDomain", "FBProcessExit", "RBSRequestErrorDomain", "RBSServiceErrorDomain", "NSOSStatusErrorDomain", "NSCocoaErrorDomain", "NSMachErrorDomain", "NSLaunchdErrorDomain"]
  static func reason(_ text: String) -> String {
    let value = String(text.prefix(32768)).lowercased()
    if value.contains("not installed") || value.contains("application is unknown") { return "app_not_installed" }
    if value.contains("permission denied") || value.contains("request was denied") || value.contains("not authorized") { return "launch_denied" }
    if value.contains("timed out") || value.contains("timeout") { return "launch_timeout" }
    if value.contains("failed to establish communication") || value.contains("connection interrupted") || value.contains("connection invalidated") { return "automation_connection" }
    if value.contains("process exited") || value.contains("application crashed") || value.contains("application terminated") { return "app_exited" }
    if value.contains("failed to launch") || value.contains("unable to launch") { return "launch_failed" }
    return "unknown"
  }
  static func chain(_ error: NSError?, fallback: String) -> [[String: Any]] {
    var rows: [[String: Any]] = [], seen = Set<String>(), visited = Set<ObjectIdentifier>()
    func append(_ domain: String, _ code: Int) {
      guard rows.count < 8, domains.contains(domain), (-65535...65535).contains(code) else { return }
      let key = domain + ":" + String(code)
      if seen.insert(key).inserted { rows.append(["domain": domain, "code": code]) }
    }
    var current = error
    for _ in 0..<8 {
      guard let value = current, visited.insert(ObjectIdentifier(value)).inserted else { break }
      append(value.domain, value.code)
      current = value.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    // Only when typed associatedError is absent. Nothing from the text is exported except an allowlisted pair.
    if error == nil, let regex = try? NSRegularExpression(pattern: "(?i)(?:domain\\s*=\\s*|error\\s+domain\\s+)([A-Za-z][A-Za-z0-9]{0,63})\\s*(?:,?\\s*code\\s*=\\s*|\\s+code\\s+)(-?[0-9]{1,6})\\b") {
      let text = String(fallback.prefix(32768)) as NSString
      for match in regex.matches(in: text as String, range: NSRange(location: 0, length: text.length)).prefix(64) {
        if let code = Int(text.substring(with: match.range(at: 2))) { append(text.substring(with: match.range(at: 1)), code) }
      }
    }
    return rows
  }
}
