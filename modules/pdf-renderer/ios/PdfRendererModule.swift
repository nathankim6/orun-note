import ExpoModulesCore
import PDFKit
import UIKit
import CryptoKit
import Security

enum PdfRendererError: Error { case cannotOpen(String); case badPage(Int); case crypto(String) }

/// Local Expo module: encrypted PDF storage + PDFKit rasterization.
/// Files are stored AES-GCM encrypted under Application Support (excluded from backup); the key lives in the Keychain
/// with ThisDeviceOnly accessibility so it is never exported with backups.
public class PdfRendererModule: Module {
  private var cache: [String: PDFDocument] = [:]
  /// PDFKit and the document cache are not thread-safe; every native call is serialized on this queue.
  private let queue = DispatchQueue(label: "com.paperly.study.pdf", qos: .userInitiated)
  private let keyTag = "com.paperly.study.pdfkey"

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
  private func encrypt(_ data: Data) throws -> Data { let sealed = try AES.GCM.seal(data, using: try loadOrCreateKey()); guard let c = sealed.combined else { throw PdfRendererError.crypto("seal") }; return c }
  private func decrypt(_ data: Data) throws -> Data { let box = try AES.GCM.SealedBox(combined: data); return try AES.GCM.open(box, using: try loadOrCreateKey()) }

  private func storeDir() throws -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("paperly-pdfs", isDirectory: true)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    var b = base; try? b.setResourceValues(values)
    return base
  }
  private func url(from uri: String) -> URL { uri.hasPrefix("file://") ? (URL(string: uri) ?? URL(fileURLWithPath: uri)) : URL(fileURLWithPath: uri) }

  private func document(_ uri: String) throws -> PDFDocument {
    if let d = cache[uri] { return d }
    let u = url(from: uri)
    let doc: PDFDocument?
    if u.pathExtension == "pdfenc" { let enc = try Data(contentsOf: u); doc = PDFDocument(data: try decrypt(enc)) } else { doc = PDFDocument(url: u) }
    guard let d = doc else { throw PdfRendererError.cannotOpen(uri) }
    if cache.count > 4 { cache.removeAll() }
    cache[uri] = d
    return d
  }
  private func pageSize(_ page: PDFPage) -> CGSize { let b = page.bounds(for: .mediaBox); let rotated = (page.rotation % 180) != 0; return CGSize(width: rotated ? b.height : b.width, height: rotated ? b.width : b.height) }

  public func definition() -> ModuleDefinition {
    Name("PdfRenderer")

    /// Copies a picked PDF into encrypted app storage and returns the stored URI. The source is left untouched (caller deletes temp copies).
    AsyncFunction("importFile") { (srcUri: String, id: String) throws -> [String: Any] in
      try self.queue.sync { () throws -> [String: Any] in
      let data = try Data(contentsOf: self.url(from: srcUri))
      guard PDFDocument(data: data) != nil else { throw PdfRendererError.cannotOpen(srcUri) }
      let out = try self.storeDir().appendingPathComponent("\(id).pdfenc")
      try self.encrypt(data).write(to: out, options: [.atomic, .completeFileProtection])
      var v = URLResourceValues(); v.isExcludedFromBackup = true; var o = out; try? o.setResourceValues(v)
      return ["uri": out.absoluteString, "size": data.count]
      }
    }
    AsyncFunction("deleteFile") { (uri: String) in
      self.queue.sync {
      self.cache.removeValue(forKey: uri)
      try? FileManager.default.removeItem(at: self.url(from: uri))
      let pages = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pdf-pages", isDirectory: true)
      let prefix = "\(abs(uri.hashValue))-"
      if let items = try? FileManager.default.contentsOfDirectory(at: pages, includingPropertiesForKeys: nil) { for f in items where f.lastPathComponent.hasPrefix(prefix) { try? FileManager.default.removeItem(at: f) } }
      }
    }
    AsyncFunction("fileExists") { (uri: String) throws -> Bool in
      try self.queue.sync { () throws -> Bool in FileManager.default.fileExists(atPath: self.url(from: uri).path) }
    AsyncFunction("clearCaches") {
      self.queue.sync {
      self.cache.removeAll()
      let pages = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pdf-pages", isDirectory: true)
      try? FileManager.default.removeItem(at: pages)
      }
    }

    AsyncFunction("getInfo") { (uri: String) throws -> [String: Any] in
      try self.queue.sync { () throws -> [String: Any] in
      let doc = try self.document(uri)
      var pages: [[String: Double]] = []
      for i in 0..<doc.pageCount { guard let p = doc.page(at: i) else { continue }; let s = self.pageSize(p); pages.append(["width": Double(s.width), "height": Double(s.height)]) }
      let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? ""
      return ["pageCount": doc.pageCount, "pages": pages, "title": title]
      }
    }

    AsyncFunction("renderPage") { (uri: String, index: Int, width: Int) throws -> String in
      try self.queue.sync { () throws -> String in
      let doc = try self.document(uri)
      guard let page = doc.page(at: index) else { throw PdfRendererError.badPage(index) }
      let size = self.pageSize(page); let scale = CGFloat(width) / size.width
      let px = CGSize(width: CGFloat(width), height: (size.height * scale).rounded())
      let format = UIGraphicsImageRendererFormat.default(); format.scale = 1; format.opaque = true
      let image = UIGraphicsImageRenderer(size: px, format: format).image { ctx in
        UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: px))
        let cg = ctx.cgContext; cg.saveGState(); cg.translateBy(x: 0, y: px.height); cg.scaleBy(x: scale, y: -scale)
        page.draw(with: .mediaBox, to: cg); cg.restoreGState()
      }
      let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pdf-pages", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let out = dir.appendingPathComponent("\(abs(uri.hashValue))-\(index)-\(width).png")
      if !FileManager.default.fileExists(atPath: out.path) { guard let data = image.pngData() else { throw PdfRendererError.badPage(index) }; try data.write(to: out, options: [.atomic, .completeFileProtection]) }
      return out.absoluteString
      }
    }

    AsyncFunction("getPageText") { (uri: String, index: Int) throws -> String in
      try self.queue.sync { () throws -> String in (try self.document(uri)).page(at: index)?.string ?? "" }

    AsyncFunction("getOutline") { (uri: String) throws -> [[String: Any]] in
      try self.queue.sync { () throws -> [[String: Any]] in
      let doc = try self.document(uri); var out: [[String: Any]] = []
      func walk(_ node: PDFOutline, _ level: Int) { for i in 0..<node.numberOfChildren { guard let child = node.child(at: i) else { continue }; let idx = child.destination?.page.flatMap { doc.index(for: $0) } ?? 0; out.append(["title": child.label ?? "", "pageIndex": idx, "level": level]); walk(child, level + 1) } }
      if let root = doc.outlineRoot { walk(root, 0) }
      return out
      }
    }
  }
}
