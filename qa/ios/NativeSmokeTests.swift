import XCTest
final class NativeSmokeTests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.paperly.study")
  override func setUp() { super.setUp(); continueAfterFailure = false }
  func emit(_ event: String, _ data: [String: Any] = [:]) {
    var row = data; row["event"] = event
    if let bytes = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]), let text = String(data: bytes, encoding: .utf8) { print("QA_JSON " + text) }
  }
  func element(_ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", label, label)).firstMatch
  }
  func healthy() {
    XCTAssertEqual(app.state, .runningForeground, "process_crash_or_background")
    XCTAssertFalse(element("qa-js-error").exists || element("review-videos-boundary-error").exists, "js_error")
  }
  @discardableResult func wait(_ label: String, _ seconds: Double = 25, contains: Bool = false) -> XCUIElement {
    let end = Date().addingTimeInterval(seconds)
    repeat {
      healthy()
      let unavailable = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "qa-unavailable-")).firstMatch
      if unavailable.exists { XCTFail("network_or_player_unavailable"); return unavailable }
      let target = contains ? app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch : element(label)
      if target.exists { return target }
      Thread.sleep(forTimeInterval: 0.25)
    } while Date() < end
    XCTFail(label.hasPrefix("qa-ready") || label.hasPrefix("qa-playing") ? "network_or_player_timeout" : "ui_timeout")
    return element(label)
  }
  func tap(_ label: String) { let target = wait(label); XCTAssertTrue(target.isHittable, "not_hittable"); target.tap() }
  func collect() {
    let telemetry = element("qa-telemetry")
    if let data = telemetry.label.data(using: .utf8), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      for row in rows { var values = row; let event = values.removeValue(forKey: "event") as? String ?? "invalid"; emit(event, values) }
    }
  }
  func testNativeSmoke() {
    app.launch(); defer { collect() }
    wait("open-review-videos", 60)
    for cycle in 1...20 {
      tap("open-review-videos"); wait("QA Video 1 재생")
      if cycle <= 3 {
        tap("QA Video 1 재생"); wait("qa-ready-\(cycle)", 65, contains: true)
        if element("컨트롤 표시").exists && !element("일시정지").exists { tap("컨트롤 표시") }
        if element("일시정지").exists { tap("일시정지"); wait("qa-state-paused-\(cycle)", 20, contains: true) }
        tap("재생"); wait("qa-state-playing-\(cycle)", 45, contains: true)
        if !element("일시정지").exists { tap("컨트롤 표시") }
        tap("일시정지"); wait("qa-state-paused-\(cycle)", 20, contains: true)
        tap("닫기"); wait("QA Video 1 재생")
      }
      tap("닫기"); wait("open-review-videos"); emit("cycle_complete", ["cycle": cycle])
    }
    tap("run-pdf-smoke")
    let end = Date().addingTimeInterval(300)
    repeat {
      healthy()
      if element("qa-pdf-pass").exists { collect(); emit("suite_result", ["platform": "ios", "result": "pass", "cycles": 20, "playbackCycles": 3]); return }
      if element("qa-pdf-fail").exists { XCTFail("pdf_failure"); return }
      if element("qa-pdf-inconclusive").exists { XCTFail("pdf_inconclusive"); return }
      Thread.sleep(forTimeInterval: 0.5)
    } while Date() < end
    XCTFail("pdf_timeout")
  }
}
