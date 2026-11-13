import Foundation
@main struct IssueFixture {
  static func main() {
    let secret = "PRIVATE_STUDENT_ACCOUNT_URL_PATH_CANARY"
    let pairs = [("Failed to launch " + secret, "launch_failed"), ("Request was denied " + secret, "launch_denied"), ("Application is unknown " + secret, "app_not_installed"), ("Timed out " + secret, "launch_timeout"), ("Failed to establish communication " + secret, "automation_connection"), ("Process exited " + secret, "app_exited"), (secret, "unknown")]
    for (text, expected) in pairs { precondition(LaunchIssueDiagnostics.reason(text) == expected) }
    let nested = NSError(domain: "NSPOSIXErrorDomain", code: 13, userInfo: [NSLocalizedDescriptionKey: secret])
    let typed = NSError(domain: "RBSRequestErrorDomain", code: 5, userInfo: [NSUnderlyingErrorKey: nested, NSLocalizedDescriptionKey: secret])
    let chain = LaunchIssueDiagnostics.chain(typed, fallback: "Error Domain=NSPOSIXErrorDomain Code=61")
    precondition(chain.count == 2 && chain[0]["code"] as? Int == 5 && chain[1]["code"] as? Int == 13)
    let fallback = LaunchIssueDiagnostics.chain(nil, fallback: "Error Domain=FBSOpenApplicationServiceErrorDomain Code=1 " + secret + " Error Domain=" + secret + " Code=4 Error Domain=NSPOSIXErrorDomain Code=13")
    precondition(fallback.count == 2)
    precondition(LaunchIssueDiagnostics.chain(NSError(domain: "NSPOSIXErrorDomain", code: Int.min), fallback: "").isEmpty)
    precondition(LaunchIssueDiagnostics.chain(nil, fallback: "Error Domain=" + secret + " Code=4").isEmpty)
    let output = String(data: try! JSONSerialization.data(withJSONObject: ["typed": chain, "fallback": fallback]), encoding: .utf8)!
    precondition(!output.contains(secret))
    print("swift_issue_fixture_pass")
  }
}
