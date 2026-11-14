import XCTest
/// Drives the real app (already launched by the workflow, signed in with the admin code through seeded storage) to the
/// screens we photograph for the App Store iPhone Duo listing. The app is attached, never launched/terminated here, so
/// it keeps its state after each test and the shell can take `simctl io screenshot`s of both displays.
final class DuoShotsTests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.paperly.study")
  var title: String { ProcessInfo.processInfo.environment["DUO_MATERIAL_TITLE"] ?? "흑석고 어휘" }
  override func setUp() { super.setUp(); continueAfterFailure = false; app.activate() }
  func element(_ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", label, label)).firstMatch
  }
  @discardableResult func wait(_ label: String, _ seconds: Double = 60) -> XCUIElement {
    let e = element(label); XCTAssertTrue(e.waitForExistence(timeout: seconds), "missing: \(label)"); return e
  }
  /// Library (내 교재) is on screen.
  func testALibrary() { wait("내 PDF 추가", 90) }
  /// Download the material (tap once), then open it once the download finished (the tile ignores taps while busy).
  func testBDownloadAndOpen() {
    wait("내 PDF 추가", 90)
    let tile = app.staticTexts[title].firstMatch; XCTAssertTrue(tile.waitForExistence(timeout: 60), "material tile")
    tile.tap()
    let end = Date().addingTimeInterval(240)
    while Date() < end {
      if element("뒤로가기").exists { return }
      if tile.exists && tile.isHittable { tile.tap() }
      Thread.sleep(forTimeInterval: 3)
    }
    XCTFail("viewer did not open")
  }
  /// Re-open the (now downloaded) document after a relaunch.
  func testCOpenViewer() {
    wait("내 PDF 추가", 90)
    let tile = app.staticTexts[title].firstMatch; XCTAssertTrue(tile.waitForExistence(timeout: 60), "doc tile"); tile.tap()
    wait("뒤로가기", 60); Thread.sleep(forTimeInterval: 6)
  }
}
