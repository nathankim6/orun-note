import ExpoModulesCore
import UIKit

/// In-memory page images for `PdfPageView`: PDFKit draws straight into a bitmap the view shows.
/// No JPEG encode, no file write, no bridge hop, no decode. Visible pages are served newest first;
/// prefetch ("warm") jobs only run when no visible page is waiting.
final class PageBitmaps {
  static let shared = PageBitmaps()
  let cache = NSCache<NSString, UIImage>()
  private let lock = NSLock()
  private struct Job { let key: String; let stillWanted: () -> Bool; let run: () -> Void }
  private var visible: [Job] = []
  private var warm: [Job] = []
  private init() {
    let bytes = min(ProcessInfo.processInfo.physicalMemory / 10, 256 << 20)
    cache.totalCostLimit = Int(max(bytes, 48 << 20))
  }
  static func key(_ uri: String, _ index: Int, _ width: Int) -> String { "\(uri)|\(index)|\(width)" }
  func get(_ key: String) -> UIImage? { cache.object(forKey: key as NSString) }
  func put(_ key: String, _ image: UIImage) {
    let cost = Int(image.size.width * image.scale * image.size.height * image.scale * 4)
    cache.setObject(image, forKey: key as NSString, cost: cost)
  }
  func clear() { cache.removeAllObjects(); lock.lock(); warm.removeAll(); lock.unlock() }
  /// `queue` is the module's reading queue: each dispatched block picks the most urgent job when it actually runs.
  func visible(_ key: String, on queue: DispatchQueue, stillWanted: @escaping () -> Bool, run: @escaping () -> Void) {
    lock.lock(); visible.append(Job(key: key, stillWanted: stillWanted, run: run)); lock.unlock()
    queue.async { self.runNext() }
  }
  func warm(_ jobs: [(String, () -> Void)], on queue: DispatchQueue) {
    lock.lock(); warm = jobs.filter { get($0.0) == nil }.map { Job(key: $0.0, stillWanted: { true }, run: $0.1) }; let n = warm.count; lock.unlock()
    for _ in 0..<n { queue.async { self.runNext() } }
  }
  private func runNext() {
    lock.lock()
    let job: Job? = visible.isEmpty ? (warm.isEmpty ? nil : warm.removeFirst()) : visible.removeLast()
    lock.unlock()
    guard let job, job.stillWanted() else { return }
    autoreleasepool { job.run() }
  }
}

/// Shows one PDF page from an in-memory bitmap. Ink, zoom tiles and fallbacks stay in JS above it.
public final class PdfPageView: ExpoView {
  let onPageReady = EventDispatcher()
  private let imageView = UIImageView()
  private var shownKey: String?
  private var wantedKey: String? { get { keyLock.lock(); defer { keyLock.unlock() }; return _wanted } set { keyLock.lock(); _wanted = newValue; keyLock.unlock() } }
  private var _wanted: String?
  private let keyLock = NSLock()
  var source: String?
  var index = 0
  var pixelWidth = 0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .white
    clipsToBounds = true
    imageView.contentMode = .scaleToFill
    imageView.layer.minificationFilter = .trilinear
    addSubview(imageView)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    imageView.frame = bounds
    if shownKey == nil { update() }
  }

  func update() {
    guard let uri = source, let module = PdfRendererModule.shared else { return }
    let w = min(PdfRendererModule.pageViewWidth, pixelWidth > 0 ? pixelWidth : Int(bounds.width * UIScreen.main.scale))
    guard w > 0 else { return }
    let key = PageBitmaps.key(uri, index, w)
    if key == shownKey || key == wantedKey { return }
    if let hit = PageBitmaps.shared.get(key) { wantedKey = nil; show(key, hit, ms: 0, cached: true); return }
    wantedKey = key
    let page = index, started = CACurrentMediaTime()
    PageBitmaps.shared.visible(key, on: module.pageViewQueue, stillWanted: { [weak self] in self?.wantedKey == key }) { [weak self] in
      let image = PageBitmaps.shared.get(key) ?? (try? module.pageBitmap(uri, page, w)).map { (image: UIImage) -> UIImage in PageBitmaps.shared.put(key, image); return image }
      DispatchQueue.main.async {
        guard let self, self.wantedKey == key else { return }
        self.wantedKey = nil
        if let image { self.show(key, image, ms: (CACurrentMediaTime() - started) * 1000, cached: false) }
        else { self.onPageReady(["ok": false, "page": page]) }
      }
    }
  }

  private func show(_ key: String, _ image: UIImage, ms: Double, cached: Bool) {
    shownKey = key
    imageView.image = image
    onPageReady(["ok": true, "page": index, "width": Int(image.size.width * image.scale), "ms": ms, "cached": cached])
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { wantedKey = nil } else if shownKey == nil { update() }
  }
}
