import ExpoModulesCore
import PDFKit
import UIKit
import CryptoKit
import Security

// Expo forwards Error.localizedDescription, not Swift enum associated values. Keep paths/status details private.
enum PdfRendererError: Error, LocalizedError {
  case cannotOpen(String); case badPage(Int); case crypto(String); case unavailable
  var errorDescription: String? {
    switch self {
    case .cannotOpen: return "PDF_OPEN_FAILED"
    case .badPage: return "PDF_PAGE_INVALID"
    case .unavailable: return "PDF_UNAVAILABLE"
    case .crypto(let reason):
      if reason == "keychain -34018" { return "PDF_KEYCHAIN_ENTITLEMENT" }
      if reason == "keychain -25308" { return "PDF_KEYCHAIN_LOCKED" }
      return reason.hasPrefix("keychain ") ? "PDF_KEYCHAIN_FAILED" : "PDF_CRYPTO_FAILED"
    }
  }
}

// MARK: - Storage format v2 (streamed; a file is never held in memory as a whole)
//   header: "OPDF2" | u32 BE chunk size | u8 key mode (0 = device key, 1 = per-file data key wrapped by the device key)
//           [mode 1 only: 60-byte wrapped data key = nonce 12 + ciphertext 32 + tag 16, AAD = the 10 header bytes before it]
//   chunks: nonce 12 | AES-256-GCM ciphertext (chunk size; the last chunk may be shorter) | tag 16
//           AAD = full header + u64 BE chunk index + u8 isLast (chunks cannot be reordered, dropped or truncated)
// v1 (no magic) = one AES-GCM "combined" blob of the whole file; still readable.
private let pdfV2Magic: [UInt8] = Array("OPDF2".utf8)
private let pdfV2Chunk = 4 * 1024 * 1024

private func pdfV2Header(chunk: Int, mode: UInt8) -> [UInt8] {
  return pdfV2Magic + [UInt8(truncatingIfNeeded: chunk >> 24), UInt8(truncatingIfNeeded: chunk >> 16), UInt8(truncatingIfNeeded: chunk >> 8), UInt8(truncatingIfNeeded: chunk), mode]
}
private func pdfV2AAD(_ header: [UInt8], _ index: UInt64, last: Bool) -> Data {
  var a = header
  for shift in stride(from: 56, through: 0, by: -8) { a.append(UInt8(truncatingIfNeeded: index >> UInt64(shift))) }
  a.append(last ? 1 : 0)
  return Data(a)
}

/// Local Expo module: encrypted PDF storage + PDFKit rasterization.
/// Files are stored AES-GCM encrypted under Application Support (excluded from backup); the key lives in the Keychain
/// with ThisDeviceOnly accessibility so it is never exported with backups. Large (v2) files are decrypted chunk by chunk
/// into a private working copy in Caches that PDFKit reads lazily, so 200 MB+ textbooks open without loading into memory.
public class PdfRendererModule: Module {
  /// Live module for `PdfPageView` (views are created by the view manager, not by JS calls).
  static weak var shared: PdfRendererModule?
  static let pageViewWidth = 2400
  private static let pageViewPixels: CGFloat = 6_000_000
  /// The page view draws on the reading lane (it owns the reading PDFKit documents).
  var pageViewQueue: DispatchQueue { readingQueue }
  // MARK: - Parsed pages shared by every lane
  // PDFKit parses a page (fonts, patterns, shadings, transparency groups) the first time a PDFPage object draws, and keeps
  // that work only on that object. On the textbooks students use this parse costs 2.5–5 s per page, every draw after it
  // 0.06–0.3 s. The reading and detail lanes used to hold separate PDFDocuments, so a zoom tile re-parsed a page the
  // reading lane had just parsed; with lane LRUs and memory warnings a page could be parsed several times in one visit.
  // Every lane now draws the same PDFPage object per (file, page): the page a student is looking at is parsed once,
  // and its zoom tiles start warm. A page draws under its own lock (one draw per page at a time; different pages in
  // parallel across lanes). The entry keeps its PDFDocument alive (a PDFPage does not own its document) and pins the
  // decrypted working copy so trimming never pulls the file from under an open page.
  private struct ParsedPage { let document: PDFDocument; let page: PDFPage; let lock: NSLock; let backing: URL? }
  private let parsedLock = NSLock()
  private var parsed: [String: ParsedPage] = [:]
  private var parsedLRU: [String] = []
  private let maxParsedPages = 12
  private func parsedKey(_ uri: String, _ index: Int) -> String { "\(uri)|\(index)" }
  /// The shared parsed page for (uri, index), creating it from `open()` (the calling lane's document) when absent.
  private func parsedPage(_ uri: String, _ index: Int, open: () throws -> PDFDocument) throws -> ParsedPage {
    let key = parsedKey(uri, index)
    parsedLock.lock()
    if let hit = parsed[key] { parsedLRU.removeAll { $0 == key }; parsedLRU.append(key); parsedLock.unlock(); return hit }
    parsedLock.unlock()
    let doc = try open()
    guard let page = doc.page(at: index) else { throw PdfRendererError.badPage(index) }
    let entry = ParsedPage(document: doc, page: page, lock: NSLock(), backing: pinExistingPlain(uri))
    var evicted: [ParsedPage] = []
    parsedLock.lock()
    if let race = parsed[key] { parsedLock.unlock(); unpinPlain(entry.backing); return race }
    parsed[key] = entry; parsedLRU.append(key)
    while parsedLRU.count > maxParsedPages { let old = parsedLRU.removeFirst(); if let e = parsed.removeValue(forKey: old) { evicted.append(e) } }
    parsedLock.unlock()
    for e in evicted { e.lock.lock(); e.lock.unlock(); unpinPlain(e.backing) } // never unpin while a draw is in flight
    return entry
  }
  /// Draws with the shared parsed page. `body` runs under the page lock.
  private func withParsedPage<T>(_ uri: String, _ index: Int, open: () throws -> PDFDocument, _ body: (PDFPage) throws -> T) throws -> T {
    let entry = try parsedPage(uri, index, open: open)
    entry.lock.lock(); defer { entry.lock.unlock() }
    return try body(entry.page)
  }
  private func dropParsedPages(matching uri: String? = nil) {
    parsedLock.lock()
    let keys = parsed.keys.filter { uri == nil || $0.hasPrefix(uri! + "|") }
    let gone = keys.compactMap { parsed.removeValue(forKey: $0) }
    parsedLRU.removeAll { keys.contains($0) }
    parsedLock.unlock()
    for e in gone { e.lock.lock(); e.lock.unlock(); unpinPlain(e.backing) }
  }
  /// Open documents, least recently used first (at most `maxDocs`).
  private var cache: [String: PDFDocument] = [:]
  private var lru: [String] = []
  private let maxDocs = 3
  /// Decrypted working copies of v2 files kept on disk so reopening is instant (most recently used `maxPlainFiles`).
  private let maxPlainFiles = 3
  /// Detail PDFKit objects and the detail document cache are confined to this queue.
  private let queue = DispatchQueue(label: "com.paperly.study.pdf", qos: .userInitiated)
  /// Expo runs the async functions of every module on one shared serial queue. PDF work is dispatched here instead so a
  /// long import or render never blocks other native calls, and cached page images return without waiting behind a render.
  private let ioQueue = DispatchQueue(label: "com.paperly.study.pdf.io", qos: .userInitiated, attributes: .concurrent)
  // Each lane owns its PDFKit objects. The reading lane never waits on detail for a warm working copy.
  private let readingQueue = DispatchQueue(label: "com.paperly.study.pdf.reading", qos: .userInitiated)
  private struct ReadingDocument { let document: PDFDocument; let backing: URL? }
  private var readingCache: [String: ReadingDocument] = [:] // readingQueue only
  private var readingLRU: [String] = []
  private let maxReadingDocs = 2
  // Only filenames/refcounts cross lanes, never either lane's PDFDocument dictionary.
  private let plainMetadataLock = NSLock()
  private var readingPins: [String: Int] = [:]
  // Admission happens on ioQueue, before entering either PDF queue. Maintenance drains admitted work,
  // then visits the two queues separately. Neither PDF queue ever synchronously enters readingQueue.
  private let lifecycle = NSCondition()
  private let maintenanceLock = NSLock()
  private var activeOperations = 0
  private var maintaining = false
  private var destroyed = false
  private let timingLock = NSLock()
  private var renderTimings: [[String: Any]] = []
  private let maxRenderTimings = 20

  private func beginOperation() throws {
    lifecycle.lock(); defer { lifecycle.unlock() }
    while maintaining && !destroyed { lifecycle.wait() }
    guard !destroyed else { throw PdfRendererError.unavailable }
    activeOperations += 1
  }
  /// Never waits: callers already on readingQueue must not block while maintenance waits to sync onto readingQueue.
  private func tryBeginOperation() throws {
    lifecycle.lock(); defer { lifecycle.unlock() }
    guard !maintaining, !destroyed else { throw PdfRendererError.unavailable }
    activeOperations += 1
  }
  private func endOperation() {
    lifecycle.lock(); activeOperations -= 1
    if activeOperations == 0 { lifecycle.broadcast() }
    lifecycle.unlock()
  }
  private func withMaintenance(allowDestroyed: Bool = false, _ body: () throws -> Void) throws {
    maintenanceLock.lock(); defer { maintenanceLock.unlock() }
    lifecycle.lock()
    if destroyed && !allowDestroyed { lifecycle.unlock(); throw PdfRendererError.unavailable }
    maintaining = true
    while activeOperations > 0 { lifecycle.wait() }
    lifecycle.unlock()
    defer { lifecycle.lock(); maintaining = false; lifecycle.broadcast(); lifecycle.unlock() }
    try body()
  }
  private func milliseconds() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }
  private func recordTiming(lane: String, page: Int, width: Int, start: Double, opened: Double, drawn: Double, encoded: Double, written: Double) {
    let record: [String: Any] = ["lane": lane, "page": page, "width": width,
      "openMs": opened - start, "drawMs": drawn - opened, "encodeMs": encoded - drawn,
      "writeMs": written - encoded, "totalMs": written - start]
    timingLock.lock(); defer { timingLock.unlock() }
    renderTimings.append(record)
    if renderTimings.count > maxRenderTimings { renderTimings.removeFirst(renderTimings.count - maxRenderTimings) }
  }
  private let keyTag = "com.paperly.study.pdfkey"
  private var memoryObserver: NSObjectProtocol?

  // MARK: - Key management
  private func loadOrCreateKey() throws -> SymmetricKey {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: keyTag, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data { return SymmetricKey(data: data) }
    let key = SymmetricKey(size: .bits256)
    let keyData = key.withUnsafeBytes { Data($0) }
    let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: keyTag, kSecValueData as String: keyData, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let s = SecItemAdd(add as CFDictionary, nil)
    guard s == errSecSuccess || s == errSecDuplicateItem else { throw PdfRendererError.crypto("keychain \(s)") }
    return key
  }
  /// v1 files: the whole document is one AES-GCM combined blob.
  private func decrypt(_ data: Data) throws -> Data { let box = try AES.GCM.SealedBox(combined: data); return try AES.GCM.open(box, using: try loadOrCreateKey()) }

  // MARK: - Paths
  private func storeDir() throws -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("paperly-pdfs", isDirectory: true)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    var b = base; try? b.setResourceValues(values)
    return base
  }
  private func cachesDir() -> URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
  private func pagesDir() -> URL { let d = cachesDir().appendingPathComponent("pdf-pages", isDirectory: true); try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true); return d }
  private func plainDir() -> URL { let d = cachesDir().appendingPathComponent("pdf-plain", isDirectory: true); try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true); return d }
  private func url(from uri: String) -> URL { uri.hasPrefix("file://") ? (URL(string: uri) ?? URL(fileURLWithPath: uri)) : URL(fileURLWithPath: uri) }
  /// Stored URIs are absolute paths and iOS may move the app container (e.g. after an update): fall back to the same file in the current store.
  private func resolved(_ uri: String) -> URL {
    let u = url(from: uri)
    if u.pathExtension == "pdfenc", !FileManager.default.fileExists(atPath: u.path), let store = try? storeDir() {
      let alt = store.appendingPathComponent(u.lastPathComponent)
      if FileManager.default.fileExists(atPath: alt.path) { return alt }
    }
    return u
  }
  /// Stable cache key (String.hashValue is randomized per launch). Stored files are keyed by file name so a moved container keeps its cache.
  private func cacheKey(_ uri: String) -> String {
    let u = url(from: uri)
    let basis = u.pathExtension == "pdfenc" ? u.lastPathComponent : uri
    return SHA256.hash(data: Data(basis.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
  }
  private func plainURL(_ uri: String) -> URL { plainDir().appendingPathComponent("\(cacheKey(uri)).pdf") }
  private func fileSize(_ u: URL) -> Int64 { ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? NSNumber)?.int64Value ?? 0 }
  private func isV2(_ file: URL) -> Bool {
    guard let h = try? FileHandle(forReadingFrom: file) else { return false }
    defer { try? h.close() }
    guard let d = try? h.read(upToCount: 5), d.count == 5 else { return false }
    return [UInt8](d) == pdfV2Magic
  }

  // MARK: - v2 streaming encryption
  /// Streams `src` into the v2 format at `dst`, one 4 MiB chunk at a time. Returns the plaintext size.
  private func encryptFileV2(from src: URL, to dst: URL) throws -> Int {
    let fm = FileManager.default
    try? fm.removeItem(at: dst)
    // CompleteUnlessOpen: as protected as Complete at rest, but a write in progress survives the device locking.
    guard fm.createFile(atPath: dst.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUnlessOpen]) else { throw PdfRendererError.crypto("create") }
    let key = try loadOrCreateKey()
    let header = pdfV2Header(chunk: pdfV2Chunk, mode: 0)
    let inH = try FileHandle(forReadingFrom: src)
    defer { try? inH.close() }
    let outH = try FileHandle(forWritingTo: dst)
    var outOpen = true
    defer { if outOpen { try? outH.close() } }
    try outH.write(contentsOf: header)
    var cur = try inH.read(upToCount: pdfV2Chunk) ?? Data()
    guard !cur.isEmpty else { throw PdfRendererError.cannotOpen(src.path) }
    var index: UInt64 = 0
    var total = 0
    while true {
      let next = try autoreleasepool { () throws -> Data in try inH.read(upToCount: pdfV2Chunk) ?? Data() }
      let last = next.isEmpty
      try autoreleasepool { () throws -> Void in
        let box = try AES.GCM.seal(cur, using: key, authenticating: pdfV2AAD(header, index, last: last))
        guard let combined = box.combined else { throw PdfRendererError.crypto("seal") }
        try outH.write(contentsOf: combined)
      }
      total += cur.count
      if last { break }
      cur = next
      index += 1
    }
    try outH.synchronize()
    outOpen = false
    try outH.close()
    return total
  }

  /// Decrypts a v2 file chunk by chunk into `dst` (written to a .part file and renamed only when complete).
  private func decryptFileV2(from src: URL, to dst: URL) throws {
    let fm = FileManager.default
    let part = dst.appendingPathExtension("part")
    try? fm.removeItem(at: part)
    guard fm.createFile(atPath: part.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUnlessOpen]) else { throw PdfRendererError.crypto("create") }
    var done = false
    defer { if !done { try? fm.removeItem(at: part) } }
    let inH = try FileHandle(forReadingFrom: src)
    defer { try? inH.close() }
    let outH = try FileHandle(forWritingTo: part)
    var outOpen = true
    defer { if outOpen { try? outH.close() } }
    guard let base = try inH.read(upToCount: 10), base.count == 10 else { throw PdfRendererError.crypto("header") }
    var header = [UInt8](base)
    guard Array(header[0..<5]) == pdfV2Magic else { throw PdfRendererError.crypto("header") }
    let chunk = Int(header[5]) << 24 | Int(header[6]) << 16 | Int(header[7]) << 8 | Int(header[8])
    guard chunk > 0, chunk <= 64 * 1024 * 1024 else { throw PdfRendererError.crypto("chunk size") }
    var key = try loadOrCreateKey()
    if header[9] == 1 {
      guard let wrapped = try inH.read(upToCount: 60), wrapped.count == 60 else { throw PdfRendererError.crypto("wrapped key") }
      let dek = try AES.GCM.open(try AES.GCM.SealedBox(combined: wrapped), using: key, authenticating: Data(header))
      key = SymmetricKey(data: dek)
      header += [UInt8](wrapped)
    } else if header[9] != 0 {
      throw PdfRendererError.crypto("key mode")
    }
    let record = Int64(chunk + 28)
    let body = fileSize(src) - Int64(header.count)
    guard body > 28 else { throw PdfRendererError.crypto("truncated") }
    let count = (body + record - 1) / record
    var i: Int64 = 0
    while i < count {
      let last = i == count - 1
      let want = Int(last ? body - record * (count - 1) : record)
      try autoreleasepool { () throws -> Void in
        guard want > 28, let rec = try inH.read(upToCount: want), rec.count == want else { throw PdfRendererError.crypto("truncated") }
        let plain = try AES.GCM.open(try AES.GCM.SealedBox(combined: rec), using: key, authenticating: pdfV2AAD(header, UInt64(i), last: last))
        try outH.write(contentsOf: plain)
      }
      i += 1
    }
    try outH.synchronize()
    outOpen = false
    try outH.close()
    if fm.fileExists(atPath: dst.path) { try? fm.removeItem(at: dst) }
    try fm.moveItem(at: part, to: dst)
    done = true
  }

  // MARK: - Documents (call only on `queue`)
  private func touch(_ uri: String) { lru.removeAll { $0 == uri }; lru.append(uri) }
  private func remember(_ uri: String, _ d: PDFDocument) {
    cache[uri] = d; touch(uri)
    while lru.count > maxDocs { let old = lru.removeFirst(); cache.removeValue(forKey: old) }
  }
  private func forget(_ uri: String) { cache.removeValue(forKey: uri); lru.removeAll { $0 == uri } }

  private func document(_ uri: String) throws -> PDFDocument {
    if let d = cache[uri] { touch(uri); return d }
    let u = resolved(uri)
    var doc: PDFDocument?
    if u.pathExtension == "pdfenc" {
      if isV2(u) {
        let fm = FileManager.default
        let plain = plainURL(uri)
        // Trim and reading pins share this lock. Never replace a file backing a reading document.
        plainMetadataLock.lock()
        do {
          defer { plainMetadataLock.unlock() }
          if fm.fileExists(atPath: plain.path) { doc = PDFDocument(url: plain) }
          if doc == nil {
            guard readingPins[plain.lastPathComponent] == nil else { throw PdfRendererError.cannotOpen(uri) }
            try? fm.removeItem(at: plain)
          }
        }
        // Destination is absent until decrypt atomically publishes it. Do not hold the metadata lock
        // through cold crypto/I/O: unrelated warm reading copies can still be pinned immediately.
        if doc == nil { try decryptFileV2(from: u, to: plain); doc = PDFDocument(url: plain) }
        if doc != nil {
          try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: plain.path)
          trimPlainFiles(keeping: plain.lastPathComponent)
        }
      } else {
        let enc = try Data(contentsOf: u); doc = PDFDocument(data: try decrypt(enc))
      }
    } else {
      doc = PDFDocument(url: u)
    }
    guard let d = doc else { throw PdfRendererError.cannotOpen(uri) }
    remember(uri, d)
    return d
  }
  /// Keeps only the most recently used decrypted copies (never the ones backing open documents).
  private func trimPlainFiles(keeping current: String) {
    plainMetadataLock.lock(); defer { plainMetadataLock.unlock() }
    let fm = FileManager.default
    guard let items = try? fm.contentsOfDirectory(at: plainDir(), includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles]) else { return }
    var keep = Set(lru.map { plainURL($0).lastPathComponent }); keep.insert(current)
    keep.formUnion(readingPins.keys)
    let pdfs = items.filter { $0.pathExtension == "pdf" }.sorted { a, b in
      let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
      let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
      return da > db
    }
    for (n, f) in pdfs.enumerated() where n >= maxPlainFiles && !keep.contains(f.lastPathComponent) { try? fm.removeItem(at: f) }
  }
  private func pinExistingPlain(_ uri: String) -> URL? {
    let plain = plainURL(uri)
    plainMetadataLock.lock(); defer { plainMetadataLock.unlock() }
    guard FileManager.default.fileExists(atPath: plain.path) else { return nil }
    readingPins[plain.lastPathComponent, default: 0] += 1
    return plain
  }
  private func unpinPlain(_ plain: URL?) {
    guard let plain = plain else { return }
    plainMetadataLock.lock(); defer { plainMetadataLock.unlock() }
    let name = plain.lastPathComponent
    let count = (readingPins[name] ?? 1) - 1
    if count == 0 { readingPins.removeValue(forKey: name) } else { readingPins[name] = count }
  }
  // readingQueue only. Release PDFKit objects before releasing their backing-file pins.
  private func forgetReading(_ uri: String) {
    let backing = readingCache[uri]?.backing
    readingCache[uri] = nil; readingLRU.removeAll { $0 == uri }
    unpinPlain(backing)
  }
  private func clearReadingDocuments() {
    for uri in Array(readingCache.keys) { forgetReading(uri) }
  }
  private func readingDocument(_ uri: String) throws -> PDFDocument {
    if let entry = readingCache[uri] {
      readingLRU.removeAll { $0 == uri }; readingLRU.append(uri)
      return entry.document
    }
    let source = resolved(uri)
    var backing: URL?
    var document: PDFDocument?
    if source.pathExtension == "pdfenc" {
      // An imported/decrypted working copy is the common path: no detail-queue hop, not even for isV2.
      backing = pinExistingPlain(uri)
      if let plain = backing { document = PDFDocument(url: plain) }
      if document == nil {
        unpinPlain(backing); backing = nil
        // Cold decrypt is owned by detail. This is the only reading -> detail synchronous edge.
        backing = try queue.sync {
          _ = try self.document(uri)
          return self.pinExistingPlain(uri)
        }
        if let plain = backing { document = PDFDocument(url: plain) }
        else { document = PDFDocument(data: try decrypt(Data(contentsOf: source))) } // legacy v1
      }
    } else { document = PDFDocument(url: source) }
    guard let doc = document else { unpinPlain(backing); throw PdfRendererError.cannotOpen(uri) }
    readingCache[uri] = ReadingDocument(document: doc, backing: backing)
    readingLRU.append(uri)
    while readingLRU.count > maxReadingDocs { forgetReading(readingLRU[0]) }
    return doc
  }
  private func readingWidth(_ width: Int) -> Int { min(1200, width) }
  private func readingImageURL(_ uri: String, _ index: Int, _ width: Int) -> URL {
    pagesDir().appendingPathComponent("\(cacheKey(uri))-\(index)-read-\(readingWidth(width)).jpg")
  }
  private func cachedReadingURL(_ uri: String, _ index: Int, _ width: Int) -> URL? {
    guard width > 0 else { return nil }
    let reading = readingImageURL(uri, index, width)
    if FileManager.default.fileExists(atPath: reading.path) { return reading }
    let full = pagesDir().appendingPathComponent("\(cacheKey(uri))-\(index)-\(readingWidth(width)).jpg")
    return FileManager.default.fileExists(atPath: full.path) ? full : nil
  }
  private func pageSize(_ page: PDFPage) -> CGSize { let b = page.bounds(for: .mediaBox); let rotated = (page.rotation % 180) != 0; return CGSize(width: rotated ? b.height : b.width, height: rotated ? b.width : b.height) }

  /// Draws `page` scaled by `scale` (full page = `pageHeightPx` tall) into a `canvas`-sized bitmap whose top-left is `origin` of the scaled page.
  private func draw(_ page: PDFPage, canvas: CGSize, scale: CGFloat, origin: CGPoint, pageHeightPx: CGFloat) -> UIImage {
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1; format.opaque = true; format.preferredRange = .standard // 8-bit sRGB: faster to draw and encode than wide color
    return UIGraphicsImageRenderer(size: canvas, format: format).image { ctx in
      UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: canvas))
      let cg = ctx.cgContext
      cg.saveGState()
      cg.translateBy(x: -origin.x, y: -origin.y)
      cg.translateBy(x: 0, y: pageHeightPx); cg.scaleBy(x: scale, y: -scale)
      page.draw(with: .mediaBox, to: cg)
      cg.restoreGState()
    }
  }

  /// readingQueue only. Screen-resolution page bitmap for `PdfPageView`; drawn in memory, never encoded or written.
  func pageBitmap(_ uri: String, _ index: Int, _ width: Int) throws -> UIImage {
    try tryBeginOperation(); defer { endOperation() }
    guard width > 0 else { throw PdfRendererError.badPage(index) }
    let start = milliseconds()
    return try withParsedPage(uri, index, open: { try readingDocument(uri) }) { page in
    let size = pageSize(page)
    guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { throw PdfRendererError.badPage(index) }
    let ratio = size.height / size.width
    let target = CGFloat(min(width, PdfRendererModule.pageViewWidth))
    let pixelWidth = max(1, min(target, floor(sqrt(PdfRendererModule.pageViewPixels / ratio))))
    let pixelHeight = max(1, min(floor(PdfRendererModule.pageViewPixels / pixelWidth), floor(pixelWidth * ratio)))
    let scale = min(pixelWidth / size.width, pixelHeight / size.height)
    let opened = milliseconds()
    let image = draw(page, canvas: CGSize(width: pixelWidth, height: pixelHeight), scale: scale, origin: .zero, pageHeightPx: pixelHeight)
    let drawn = milliseconds()
    recordTiming(lane: "view", page: index, width: Int(pixelWidth), start: start, opened: opened, drawn: drawn, encoded: drawn, written: drawn)
    return image
    }
  }

  public func definition() -> ModuleDefinition {
    Name("PdfRenderer")

    OnCreate { [weak self] in
      guard let module = self else { return }
      PdfRendererModule.shared = module
      // Drop open documents (PDFKit caches) when iOS is short on memory; they reopen on demand.
      module.memoryObserver = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak module] _ in
        guard let m = module else { return }
        m.queue.async { m.cache.removeAll(); m.lru.removeAll() }
        m.readingQueue.async { m.clearReadingDocuments() }
        m.dropParsedPages()
        PageBitmaps.shared.clear()
      }
      // Page images written by older builds were keyed by a per-launch random hash and can never be reused.
      module.ioQueue.async {
        do { try module.beginOperation() } catch { return }
        defer { module.endOperation() }
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: module.pagesDir(), includingPropertiesForKeys: nil) else { return }
        for f in items { let name = f.lastPathComponent; if let dash = name.firstIndex(of: "-"), name.distance(from: name.startIndex, to: dash) != 24 { try? fm.removeItem(at: f) } }
      }
    }
    OnDestroy {
      PageBitmaps.shared.clear()
      self.dropParsedPages()
      if let o = self.memoryObserver { NotificationCenter.default.removeObserver(o) }
      self.memoryObserver = nil
      self.lifecycle.lock(); self.destroyed = true; self.lifecycle.broadcast(); self.lifecycle.unlock()
      // Do not block the main thread or release a backing file while a render is still using it.
      self.ioQueue.async {
        try? self.withMaintenance(allowDestroyed: true) {
          self.queue.sync { self.cache.removeAll(); self.lru.removeAll() }
          self.readingQueue.sync { self.clearReadingDocuments() }
        }
      }
    }

    /// Copies a picked PDF into encrypted app storage (v2, streamed in 4 MiB chunks) and returns the stored URI.
    /// The source is left untouched (caller deletes temp copies). A decrypted working copy is kept so the first open is instant.
    AsyncFunction("importFile") { (srcUri: String, id: String) throws -> [String: Any] in
      var result: [String: Any] = [:]
      try self.withMaintenance {
        let fm = FileManager.default
        let src = self.url(from: srcUri)
        let out = try self.storeDir().appendingPathComponent("\(id).pdfenc")
        let outUri = out.absoluteString
        self.queue.sync {
          for key in Array(self.cache.keys) where self.cacheKey(key) == self.cacheKey(outUri) { self.forget(key) }
        }
        self.readingQueue.sync {
          for key in Array(self.readingCache.keys) where self.cacheKey(key) == self.cacheKey(outUri) { self.forgetReading(key) }
        }
        let plain = self.plainURL(outUri)
        let plainPart = plain.appendingPathExtension("part")
        let encPart = out.appendingPathExtension("part")
        try? fm.removeItem(at: plainPart); try? fm.removeItem(at: encPart); try? fm.removeItem(at: plain)
        var ok = false
        defer { if !ok { try? fm.removeItem(at: plainPart); try? fm.removeItem(at: encPart); try? fm.removeItem(at: plain) } }
        // Working copy = APFS clone of the picked file (no extra time or space), validated before spending time on encryption.
        do { try fm.copyItem(at: src, to: plainPart) } catch { throw PdfRendererError.cannotOpen(srcUri) }
        try? fm.setAttributes([.protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: plainPart.path)
        try fm.moveItem(at: plainPart, to: plain)
        let doc: PDFDocument = try self.queue.sync { () throws -> PDFDocument in
          guard let d = PDFDocument(url: plain) else { throw PdfRendererError.cannotOpen(srcUri) }
          return d
        }
        let size = try self.encryptFileV2(from: src, to: encPart)
        if fm.fileExists(atPath: out.path) { try? fm.removeItem(at: out) }
        try fm.moveItem(at: encPart, to: out)
        var v = URLResourceValues(); v.isExcludedFromBackup = true; var o = out; try? o.setResourceValues(v)
        ok = true
        self.queue.sync { self.remember(outUri, doc); self.trimPlainFiles(keeping: plain.lastPathComponent) }
        result = ["uri": outUri, "size": size]
      }
      return result
    }.runOnQueue(self.ioQueue)

    AsyncFunction("deleteFile") { (uri: String) throws in
      PageBitmaps.shared.clear()
      self.dropParsedPages(matching: uri)
      try self.withMaintenance {
        self.queue.sync {
          for key in Array(self.cache.keys) where self.cacheKey(key) == self.cacheKey(uri) { self.forget(key) }
        }
        self.readingQueue.sync {
          for key in Array(self.readingCache.keys) where self.cacheKey(key) == self.cacheKey(uri) { self.forgetReading(key) }
        }
        let fm = FileManager.default
        try? fm.removeItem(at: self.resolved(uri))
        try? fm.removeItem(at: self.plainURL(uri))
        let prefix = "\(self.cacheKey(uri))-"
        if let items = try? fm.contentsOfDirectory(at: self.pagesDir(), includingPropertiesForKeys: nil) { for f in items where f.lastPathComponent.hasPrefix(prefix) { try? fm.removeItem(at: f) } }
      }
    }.runOnQueue(self.ioQueue)

    AsyncFunction("fileExists") { (uri: String) throws -> Bool in
      try self.beginOperation(); defer { self.endOperation() }
      return FileManager.default.fileExists(atPath: self.resolved(uri).path)
    }.runOnQueue(self.ioQueue)

    AsyncFunction("clearCaches") { () throws in
      PageBitmaps.shared.clear()
      self.dropParsedPages()
      try self.withMaintenance {
        self.queue.sync { self.cache.removeAll(); self.lru.removeAll() }
        self.readingQueue.sync { self.clearReadingDocuments() }
        let fm = FileManager.default
        try? fm.removeItem(at: self.cachesDir().appendingPathComponent("pdf-pages", isDirectory: true))
        try? fm.removeItem(at: self.cachesDir().appendingPathComponent("pdf-plain", isDirectory: true))
        // leftovers of interrupted imports
        if let store = try? self.storeDir(), let items = try? fm.contentsOfDirectory(at: store, includingPropertiesForKeys: nil) { for f in items where f.pathExtension == "part" { try? fm.removeItem(at: f) } }
      }
    }.runOnQueue(self.ioQueue)

    AsyncFunction("getInfo") { (uri: String) throws -> [String: Any] in
      try self.beginOperation(); defer { self.endOperation() }
      return try self.queue.sync { () throws -> [String: Any] in
        let doc = try self.document(uri)
        var pages: [[String: Double]] = []
        for i in 0..<doc.pageCount { guard let p = doc.page(at: i) else { continue }; let s = self.pageSize(p); pages.append(["width": Double(s.width), "height": Double(s.height)]) }
        let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? ""
        return ["pageCount": doc.pageCount, "pages": pages, "title": title]
      }
    }.runOnQueue(self.ioQueue)

    /// Native page surface: shows the page bitmap directly (see `PdfPageView`).
    View(PdfPageView.self) {
      Events("onPageReady")
      Prop("source") { (view: PdfPageView, v: String) in view.source = v }
      Prop("index") { (view: PdfPageView, v: Int) in view.index = v }
      Prop("pixelWidth") { (view: PdfPageView, v: Int) in view.pixelWidth = v }
      OnViewDidUpdateProps { (view: PdfPageView) in view.update() }
    }
    /// Prefetch page bitmaps for `PdfPageView` (next pages in the scroll direction). Replaces the previous list.
    Function("warmPages") { (uri: String, indices: [Int], width: Int) in
      let w = max(1, min(width, PdfRendererModule.pageViewWidth))
      PageBitmaps.shared.warm(indices.filter { $0 >= 0 }.map { (i: Int) -> (String, () -> Void) in
        let key = PageBitmaps.key(uri, i, w)
        return (key, { [weak self] in
          guard let self, PageBitmaps.shared.get(key) == nil, let image = try? self.pageBitmap(uri, i, w) else { return }
          PageBitmaps.shared.put(key, image)
        })
      }, on: self.readingQueue)
    }
    Function("clearPageBitmaps") { PageBitmaps.shared.clear() }

    AsyncFunction("takeRenderTimings") { () -> [[String: Any]] in
      self.timingLock.lock(); defer { self.timingLock.unlock() }
      let records = self.renderTimings; self.renderTimings.removeAll(keepingCapacity: true)
      return records
    }

    AsyncFunction("cachedReading") { (uri: String, index: Int, width: Int) throws -> String? in
      try self.beginOperation(); defer { self.endOperation() }
      return self.cachedReadingURL(uri, index, width)?.absoluteString
    }.runOnQueue(self.ioQueue)

    AsyncFunction("renderReading") { (uri: String, index: Int, width: Int) throws -> String in
      try self.beginOperation(); defer { self.endOperation() }
      guard width > 0 else { throw PdfRendererError.badPage(index) }
      if let cached = self.cachedReadingURL(uri, index, width) { return cached.absoluteString }
      return try self.readingQueue.sync {
        try autoreleasepool {
          if let cached = self.cachedReadingURL(uri, index, width) { return cached.absoluteString }
          let start = self.milliseconds()
          return try self.withParsedPage(uri, index, open: { try self.readingDocument(uri) }) { page in
          let size = self.pageSize(page)
          guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { throw PdfRendererError.badPage(index) }
          // Bound actual bitmap area as well as width, including unusually tall pages.
          let ratio = size.height / size.width
          guard ratio.isFinite, ratio > 0 else { throw PdfRendererError.badPage(index) }
          let target = CGFloat(self.readingWidth(width))
          let pixelWidth = max(1, min(target, floor(sqrt(4_000_000 / ratio))))
          let pixelHeight = max(1, min(floor(4_000_000 / pixelWidth), floor(pixelWidth * ratio)))
          let scale = min(pixelWidth / size.width, pixelHeight / size.height)
          let opened = self.milliseconds()
          let image = self.draw(page, canvas: CGSize(width: pixelWidth, height: pixelHeight), scale: scale, origin: .zero, pageHeightPx: pixelHeight)
          let drawn = self.milliseconds()
          guard let data = image.jpegData(compressionQuality: 0.84) else { throw PdfRendererError.badPage(index) }
          let encoded = self.milliseconds()
          let out = self.readingImageURL(uri, index, width)
          try data.write(to: out, options: [.atomic, .completeFileProtection])
          let written = self.milliseconds()
          self.recordTiming(lane: "reading", page: index, width: Int(pixelWidth), start: start, opened: opened, drawn: drawn, encoded: encoded, written: written)
          return out.absoluteString
          }
        }
      }
    }.runOnQueue(self.ioQueue)

    /// An already-rendered page (no rendering, no PDF queue): the viewer shows it at once instead of waiting for other work.
    AsyncFunction("cachedPage") { (uri: String, index: Int, width: Int) throws -> String? in
      try self.beginOperation(); defer { self.endOperation() }
      let out = self.pagesDir().appendingPathComponent("\(self.cacheKey(uri))-\(index)-\(width).jpg")
      return FileManager.default.fileExists(atPath: out.path) ? out.absoluteString : nil
    }.runOnQueue(self.ioQueue)

    /// Whole page at `width` px. Cached on disk under a stable key: a cached page returns without opening the document.
    /// Always JPEG (q 0.92): several times faster to encode and decode than PNG.
    AsyncFunction("renderPage") { (uri: String, index: Int, width: Int) throws -> String in
      try self.beginOperation(); defer { self.endOperation() }
      let jpeg = true
      let out = self.pagesDir().appendingPathComponent("\(self.cacheKey(uri))-\(index)-\(width).jpg")
      if FileManager.default.fileExists(atPath: out.path) { return out.absoluteString }
      return try self.queue.sync { () throws -> String in
        if FileManager.default.fileExists(atPath: out.path) { return out.absoluteString }
        let start = self.milliseconds()
        guard width > 0 else { throw PdfRendererError.badPage(index) }
        return try self.withParsedPage(uri, index, open: { try self.document(uri) }) { page in
        let size = self.pageSize(page); let scale = CGFloat(width) / size.width
        let h = max(1, (size.height * scale).rounded())
        let opened = self.milliseconds()
        let image = self.draw(page, canvas: CGSize(width: CGFloat(width), height: h), scale: scale, origin: .zero, pageHeightPx: h)
        let drawn = self.milliseconds()
        guard let data = jpeg ? image.jpegData(compressionQuality: 0.92) : image.pngData() else { throw PdfRendererError.badPage(index) }
        let encoded = self.milliseconds()
        try data.write(to: out, options: [.atomic, .completeFileProtection])
        let written = self.milliseconds()
        self.recordTiming(lane: "detail", page: index, width: width, start: start, opened: opened, drawn: drawn, encoded: encoded, written: written)
        return out.absoluteString
        }
      }
    }.runOnQueue(self.ioQueue)

    /// A `w`×`h` px window (top-left `x`,`y`) of the page as it looks scaled to `pageWidthPx` wide — sharp tiles when zoomed in.
    /// The region is clamped to the page. JPEG (q 0.92), cached separately from legacy lower-quality tiles.
    AsyncFunction("renderRegion") { (uri: String, index: Int, pageWidthPx: Int, x: Int, y: Int, w: Int, h: Int) throws -> String in
      try self.beginOperation(); defer { self.endOperation() }
      let out = self.pagesDir().appendingPathComponent("\(self.cacheKey(uri))-\(index)-\(pageWidthPx)-r92-\(x)_\(y)_\(w)_\(h).jpg")
      if FileManager.default.fileExists(atPath: out.path) { return out.absoluteString }
      return try self.queue.sync { () throws -> String in
        if FileManager.default.fileExists(atPath: out.path) { return out.absoluteString }
        let start = self.milliseconds()
        guard pageWidthPx > 0 else { throw PdfRendererError.badPage(index) }
        return try self.withParsedPage(uri, index, open: { try self.document(uri) }) { page in
        let size = self.pageSize(page); let scale = CGFloat(pageWidthPx) / size.width
        let fullH = max(1, Int((size.height * scale).rounded()))
        let x0 = min(max(0, x), pageWidthPx - 1), y0 = min(max(0, y), fullH - 1)
        let rw = max(1, min(w, pageWidthPx - x0)), rh = max(1, min(h, fullH - y0))
        let opened = self.milliseconds()
        let image = self.draw(page, canvas: CGSize(width: rw, height: rh), scale: scale, origin: CGPoint(x: x0, y: y0), pageHeightPx: CGFloat(fullH))
        let drawn = self.milliseconds()
        guard let data = image.jpegData(compressionQuality: 0.92) else { throw PdfRendererError.badPage(index) }
        let encoded = self.milliseconds()
        try data.write(to: out, options: [.atomic, .completeFileProtection])
        let written = self.milliseconds()
        self.recordTiming(lane: "tile", page: index, width: pageWidthPx, start: start, opened: opened, drawn: drawn, encoded: encoded, written: written)
        return out.absoluteString
        }
      }
    }.runOnQueue(self.ioQueue)

    AsyncFunction("getPageText") { (uri: String, index: Int) throws -> String in
      try self.beginOperation(); defer { self.endOperation() }
      return try self.queue.sync { () throws -> String in (try self.document(uri)).page(at: index)?.string ?? "" }
    }.runOnQueue(self.ioQueue)

    /// Words on a page with rectangles normalized to the displayed page (0..1, top-left origin) for tap-to-define.
    AsyncFunction("getWords") { (uri: String, index: Int) throws -> [[String: Any]] in
      try self.beginOperation(); defer { self.endOperation() }
      return try self.queue.sync { () throws -> [[String: Any]] in
      let doc = try self.document(uri)
      guard let page = doc.page(at: index), let text = page.string, !text.isEmpty else { return [] }
      let box = page.bounds(for: .mediaBox); let rot = ((page.rotation % 360) + 360) % 360
      var out: [[String: Any]] = []
      let ns = text as NSString
      ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byWords, .localized]) { sub, range, _, _ in
        guard let w = sub, w.rangeOfCharacter(from: .letters) != nil, let sel = page.selection(for: range) else { return }
        let b = sel.bounds(for: page); if b.isEmpty || b.width <= 0 { return }
        var nx = (b.minX - box.minX) / box.width, ny = 1 - (b.maxY - box.minY) / box.height, nw = b.width / box.width, nh = b.height / box.height
        if rot == 90 { (nx, ny, nw, nh) = (1 - ny - nh, nx, nh, nw) } else if rot == 180 { (nx, ny) = (1 - nx - nw, 1 - ny - nh) } else if rot == 270 { (nx, ny, nw, nh) = (ny, 1 - nx - nw, nh, nw) }
        out.append(["t": w, "x": Double(nx), "y": Double(ny), "w": Double(nw), "h": Double(nh)])
        if out.count > 4000 { return }
      }
      return out
      }
    }.runOnQueue(self.ioQueue)

    AsyncFunction("getOutline") { (uri: String) throws -> [[String: Any]] in
      try self.beginOperation(); defer { self.endOperation() }
      return try self.queue.sync { () throws -> [[String: Any]] in
      let doc = try self.document(uri); var out: [[String: Any]] = []
      func walk(_ node: PDFOutline, _ level: Int) { for i in 0..<node.numberOfChildren { guard let child = node.child(at: i) else { continue }; let idx = child.destination?.page.flatMap { doc.index(for: $0) } ?? 0; out.append(["title": child.label ?? "", "pageIndex": idx, "level": level]); walk(child, level + 1) } }
      if let root = doc.outlineRoot { walk(root, 0) }
      return out
      }
    }.runOnQueue(self.ioQueue)
  }
}
