import UIKit
import Security

// Simulator-only synthetic probe. Mirrors the app's generic-password account
// query/add attributes exactly. Only the account value is a unique probe identity;
// no service/access-group attribute is added and the production item is NEVER accessed.
func category(_ status: OSStatus) -> String {
  switch status {
  case errSecSuccess: return "success"
  case errSecItemNotFound: return "item_not_found"
  case errSecDuplicateItem: return "duplicate_item"
  case errSecMissingEntitlement: return "missing_entitlement"
  case errSecInteractionNotAllowed: return "interaction_not_allowed"
  case errSecParam: return "parameter"
  case errSecNotAvailable: return "not_available"
  case errSecAuthFailed: return "authentication_failed"
  default: return "unknown"
  }
}
func probe() -> [[String: Any]] {
  let scope = Bundle.main.bundleIdentifier!
  let identity: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: scope + ".pdfkey"]
  var query = identity
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne
  var item: CFTypeRef?
  let found = SecItemCopyMatching(query as CFDictionary, &item)
  var rows: [[String: Any]] = [["operation": "lookup", "status": category(found)]]
  let synthetic = Data(repeating: 0x5A, count: 32)
  if found == errSecSuccess, item is Data {
    rows.append(["operation": "add", "status": "not_attempted"])
  } else {
    var add = identity
    add[kSecValueData as String] = synthetic
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    rows.append(["operation": "add", "status": category(SecItemAdd(add as CFDictionary, nil))])
  }
  var verified: CFTypeRef?
  let read = SecItemCopyMatching(query as CFDictionary, &verified)
  let data = verified as? Data
  rows.append(["operation": "verify", "status": category(read), "matchesSynthetic": data == synthetic ? 1 : 0, "byteCount": data?.count == 32 ? 32 : 0])
  // Delete ONLY this fresh app's exact unique account/class, never a broad query.
  rows.append(["operation": "delete", "status": category(SecItemDelete(identity as CFDictionary))])
  return rows
}
@main final class ProbeApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let screen = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    screen.rootViewController = controller
    screen.makeKeyAndVisible()
    window = screen
    DispatchQueue.main.async {
      let rows = probe()
      if let data = try? JSONSerialization.data(withJSONObject: rows), let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
        try? data.write(to: directory.appendingPathComponent("synthetic-keychain-result.json"), options: .atomic)
      }
    }
    return true
  }
}
