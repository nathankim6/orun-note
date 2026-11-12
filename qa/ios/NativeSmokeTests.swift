import XCTest
final class NativeSmokeTests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.paperly.study")
  var currentStep = "startup"
  var lastTelemetry: [[String: Any]] = []
  override func setUp() { super.setUp(); continueAfterFailure = false }
  override func record(_ issue: XCTIssue) {
    defer { super.record(issue) }
    let descriptions = String(issue.compactDescription.prefix(16384)) + "\n" + String((issue.detailedDescription ?? "").prefix(16384))
    var row: [String: Any] = ["issueType": issue.type.rawValue, "isFailure": issue.isFailure, "associatedErrorPresent": issue.associatedError != nil, "reason": LaunchIssueDiagnostics.reason(descriptions), "errorChain": LaunchIssueDiagnostics.chain(issue.associatedError as NSError?, fallback: descriptions)]
    if let line = issue.sourceCodeContext.location?.lineNumber, line > 0 && line <= 100000 { row["sourceLine"] = line }
    emit("ios_xctest_issue", row)
  }
  func emit(_ event: String, _ data: [String: Any] = [:]) {
    var row = data; row["event"] = event
    if let bytes = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]), let text = String(data: bytes, encoding: .utf8) { print("QA_JSON " + text); fflush(stdout) }
  }
  func element(_ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", label, label)).firstMatch
  }
  func fail(_ reason: String) {
    // Emit fixed enums before XCTFail can abort execution. No assertion text/labels are exported.
    emit("driver_failure_step", ["step": currentStep])
    emit("suite_result", ["platform": "ios", "result": "fail", "reason": reason])
    collect()
    XCTFail(reason)
  }
  func healthy() {
    if app.state != .runningForeground { fail(app.state == .notRunning ? "process_crash" : "app_background"); return }
    captureTelemetry()
    if element("qa-js-error").exists || element("review-videos-boundary-error").exists { fail("js_error") }
  }
  @discardableResult func wait(_ label: String, _ seconds: Double = 25, contains: Bool = false) -> XCUIElement {
    let end = Date().addingTimeInterval(seconds)
    repeat {
      healthy()
      let unavailable = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "qa-unavailable-")).firstMatch
      if unavailable.exists { fail("network_or_player_unavailable"); return unavailable }
      let target = contains ? app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch : element(label)
      if target.exists { return target }
      Thread.sleep(forTimeInterval: 0.25)
    } while Date() < end
    fail(label.hasPrefix("qa-ready") || label.hasPrefix("qa-state-playing") || label.hasPrefix("qa-progressing") ? "network_or_player_timeout" : "ui_timeout")
    return element(label)
  }
  func tap(_ label: String) { let target = wait(label); if !target.isHittable { fail("not_hittable"); return }; target.tap() }
  func captureTelemetry() {
    guard app.state == .runningForeground else { return }
    let telemetry = element("qa-telemetry")
    guard telemetry.exists else { return }
    if let data = telemetry.label.data(using: .utf8), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]], rows.count <= 180 { lastTelemetry = rows }
  }
  func collect() {
    // Never re-enter healthy()/wait() on a failure. Keep the last successful snapshot if app died.
    captureTelemetry()
    for row in lastTelemetry { var values = row; let event = values.removeValue(forKey: "event") as? String ?? "invalid"; emit(event, values) }
  }
  func testNativeSmoke() {
    emit("ios_launch_checkpoint", ["stage": "before_launch"])
    app.launch(); defer { collect() }
    emit("ios_launch_checkpoint", ["stage": "after_launch"])
    currentStep = "root"; wait("open-review-videos", 60)
    // Collect native PDF timing evidence before external media can stop the suite.
    currentStep = "pdf"; tap("run-pdf-smoke")
    var pdfPassed = false
    let end = Date().addingTimeInterval(300)
    repeat {
      healthy()
      if element("qa-pdf-pass").exists { pdfPassed = true; break }
      if element("qa-pdf-fail").exists { fail("pdf_failure"); return }
      if element("qa-pdf-inconclusive").exists { fail("pdf_inconclusive"); return }
      Thread.sleep(forTimeInterval: 0.5)
    } while Date() < end
    if !pdfPassed { fail("pdf_timeout"); return }
    for cycle in 1...20 {
      currentStep = "list_open"; tap("open-review-videos"); currentStep = "wait_list"; wait("QA Video 1 재생")
      if cycle <= 3 {
        currentStep = "player_open"; tap("QA Video 1 재생"); currentStep = "wait_ready"; wait("qa-ready-\(cycle)", 65, contains: true)
        if element("컨트롤 표시").exists && !element("일시정지").exists { tap("컨트롤 표시") }
        if element("일시정지").exists { currentStep = "pause"; tap("일시정지"); wait("qa-state-paused-\(cycle)", 20, contains: true) }
        currentStep = "play"; tap("재생"); wait("qa-state-playing-\(cycle)", 45, contains: true)
        currentStep = "wait_progress"; wait("qa-progressing-\(cycle)", 60, contains: true)
        if !element("일시정지").exists { tap("컨트롤 표시") }
        currentStep = "pause"; tap("일시정지"); wait("qa-state-paused-\(cycle)", 20, contains: true)
        currentStep = "player_close"; tap("닫기"); wait("QA Video 1 재생")
      }
      currentStep = "list_close"; tap("닫기"); wait("open-review-videos"); emit("cycle_complete", ["cycle": cycle])
    }
    collect(); emit("suite_result", ["platform": "ios", "result": "pass", "cycles": 20, "playbackCycles": 3])
  }
}
